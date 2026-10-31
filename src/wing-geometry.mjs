import * as THREE from 'three';
import {WING_AXES} from './wing-bend.mjs';

const indexOf={x:0,y:1,z:2};
const clamp=(v,low,high)=>Math.max(low,Math.min(high,v));
const nextFrame=()=>new Promise(resolve=>typeof requestAnimationFrame==='function'
 ?requestAnimationFrame(resolve):setTimeout(resolve,0));

export function detectWingSpanAxis(source,requested='auto'){
 if(requested!=='auto'){
  if(!WING_AXES.includes(requested))throw new Error('Unknown wing axis');
  return requested;
 }
 // Auto is only a best guess for arbitrary imported assets; expose axis
 // control for wings oriented vertically or folded in the source GLB.
 const sizes=source.max.map((v,i)=>v-source.min[i]);
 return WING_AXES[sizes.indexOf(Math.max(...sizes))];
}
export function captureWingGeometry(root){
 root.updateWorldMatrix(true,true);
 const inverseRoot=root.matrixWorld.clone().invert();
 const entries=[],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 const point=new THREE.Vector3();
 root.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.getAttribute('position'))return;
  if(mesh.isSkinnedMesh)throw new Error('У крыльев уже есть кости. Для их изгиба используй риг, а не прямую деформацию сетки.');
  const morph=mesh.geometry.morphAttributes?.position;
  if(morph?.length)throw new Error('В крыльях есть Blend Shapes. Прямой сгиб нарушит морфы — сначала сохрани копию без морфов.');
  const cloned=mesh.geometry.clone();
  const attr=cloned.getAttribute('position');
  const count=attr.count,original=new Float32Array(count*3);
  const toRoot=inverseRoot.clone().multiply(mesh.matrixWorld),fromRoot=toRoot.clone().invert();
  const localMin=[Infinity,Infinity,Infinity],localMax=[-Infinity,-Infinity,-Infinity],center=[0,0,0];
  for(let i=0;i<count;i++){
   // GLB KHR_mesh_quantization can use normalized integers or interleaved
   // buffer views. Float32Array(attribute.array) copies *encoded* integers,
   // NOT the decoded positions: folding them crumples the mesh.
   point.fromBufferAttribute(attr,i);
   if(![point.x,point.y,point.z].every(Number.isFinite))
    throw new Error('В крыльях есть неверные координаты');
   original[i*3]=point.x;original[i*3+1]=point.y;original[i*3+2]=point.z;
   point.applyMatrix4(toRoot);
   for(let a=0;a<3;a++){
    const v=point.getComponent(a);
    min[a]=Math.min(min[a],v);max[a]=Math.max(max[a],v);
    localMin[a]=Math.min(localMin[a],v);localMax[a]=Math.max(localMax[a],v);
    center[a]+=v;
   }
  }
  for(let a=0;a<3;a++)center[a]/=Math.max(count,1);
  // Use full precision storage for editor deformation. All UVs, colors,
  // material groups, skin-independent attributes and indices stay intact.
  cloned.setAttribute('position',new THREE.Float32BufferAttribute(original.slice(),3));
  mesh.geometry=cloned;
  entries.push({mesh,original,toRoot,fromRoot,min:localMin,max:localMax,center});
 });
 if(!entries.length)return null;
 return {entries,min,max,centerX:(min[0]+max[0])/2,
  halfSpan:Math.max((max[0]-min[0])/2,1e-6)};
}
export function totalWingVertices(source){
 return source?.entries.reduce((sum,e)=>sum+(e.mesh.geometry.getAttribute('position')?.count||0),0)||0;
}

/**
 * C1-continuous bend: the centreline starts flat and smoothly curves to
 * the final angle, then the remaining membrane rotates rigidly. The old
 * piecewise transform had a POSITION JUMP at the hinge for any wing with
 * thickness (z != hinge depth), which tore the surface like crumpled paper.
 *
 * Precompute the arc once per modifier call, not once per vertex.
 */
function arcLookup(angle,transition){
 const n=128,table=new Float64Array((n+1)*3);
 const dx=transition/n;
 for(let i=1;i<=n;i++){
  const mid=(i-.5)/n;
  const theta=angle*Math.sin(mid*Math.PI*.5)**2;
  table[i*3]=table[(i-1)*3]+Math.cos(theta)*dx;
  table[i*3+1]=table[(i-1)*3+1]+Math.sin(theta)*dx;
 }
 for(let i=0;i<=n;i++){
  const u=i/n;
  table[i*3+2]=angle*Math.sin(u*Math.PI*.5)**2;
 }
 return function evaluate(distance){
  if(distance>=transition){
   const excess=distance-transition;
   return {x:table[n*3]+excess*Math.cos(angle),
    z:table[n*3+1]+excess*Math.sin(angle),theta:angle};
  }
  const t=clamp(distance/transition*n,0,n);
  const i=Math.min(n-1,Math.floor(t)),a=t-i;
  return {x:table[i*3]*(1-a)+table[(i+1)*3]*a,
   z:table[i*3+1]*(1-a)+table[(i+1)*3+1]*a,
   theta:table[i*3+2]*(1-a)+table[(i+1)*3+2]*a};
 };
}
function wingContext(source,{
 bendDegrees=0,wingStretch=1,hingeFraction=.08,
 wingSpanAxis='auto',wingCenterOffset=0,wingFoldDirection=1
}={}){
 const axis=detectWingSpanAxis(source,wingSpanAxis);
 if(![bendDegrees,wingStretch,hingeFraction,wingCenterOffset,wingFoldDirection].every(Number.isFinite)||
  Math.abs(bendDegrees)>100||wingStretch<=0||wingStretch>2.5||hingeFraction<0||hingeFraction>=.9||
  Math.abs(wingCenterOffset)>.8||![-1,1].includes(wingFoldDirection))
  throw new Error('Неверные параметры сгиба крыльев');
 const spanIndex=indexOf[axis],depthIndex=axis==='z'?0:2;
 const halfSpan=Math.max((source.max[spanIndex]-source.min[spanIndex])/2,1e-6);
 const mid=(source.min[spanIndex]+source.max[spanIndex])/2;
 const hinge=halfSpan*hingeFraction;
 const angle=bendDegrees*wingFoldDirection*Math.PI/180;
 const transition=Math.max(halfSpan*.15,hinge*2,.000001);
 return {axis,spanIndex,depthIndex,halfSpan,hinge,
  center:mid+wingCenterOffset*halfSpan,
  depth:(source.min[depthIndex]+source.max[depthIndex])/2,
  stretch:wingStretch,neutral:bendDegrees===0&&wingStretch===1,
  evaluate:arcLookup(angle,transition)};
}
function rootWarp(span,depth,params){
 const {center,hinge,stretch,evaluate}=params;
 const dx=span-center,side=dx<0?-1:1,abs=Math.abs(dx);
 const distance=abs<=hinge?abs:hinge+(abs-hinge)*stretch;
 const point=evaluate(distance);
 const perpendicular=depth-params.depth;
 return {s:center+side*(point.x-perpendicular*Math.sin(point.theta)),
  d:params.depth+point.z+perpendicular*Math.cos(point.theta),
  theta:point.theta,side};
}
function modifyRange(entry,start,end,params,vec){
 const {original,toRoot,fromRoot,mesh}=entry,attr=mesh.geometry.getAttribute('position');
 const {spanIndex,depthIndex,center,halfSpan,neutral}=params;
 // Individual imported feathers/plates are rigid when they occupy a small
 // piece of wing span: preserves their UV islands and sharp silhouette.
 const thinSpan=entry.max[spanIndex]-entry.min[spanIndex];
 const midpoint=entry.center[spanIndex];
 const rigid=thinSpan<halfSpan*.36&&Math.abs(midpoint-center)>halfSpan*.2;
 const anchor=rigid?rootWarp(midpoint,entry.center[depthIndex],params):null;
 for(let i=start;i<end;i++){
  vec.set(original[i*3],original[i*3+1],original[i*3+2]).applyMatrix4(toRoot);
  if(!neutral){
   const x=vec.getComponent(spanIndex),z=vec.getComponent(depthIndex);
   if(rigid){
    const delta=x-midpoint,perp=z-entry.center[depthIndex];
    const s=anchor.s+delta*Math.cos(anchor.theta)-anchor.side*perp*Math.sin(anchor.theta);
    const d=anchor.d+anchor.side*delta*Math.sin(anchor.theta)+perp*Math.cos(anchor.theta);
    vec.setComponent(spanIndex,s);vec.setComponent(depthIndex,d);
   }else{
    const mapped=rootWarp(x,z,params);
    vec.setComponent(spanIndex,mapped.s);vec.setComponent(depthIndex,mapped.d);
   }
  }
  vec.applyMatrix4(fromRoot);
  attr.setXYZ(i,vec.x,vec.y,vec.z);
 }
 attr.needsUpdate=true;
}
function finalizeMesh(entry){
 entry.mesh.geometry.computeVertexNormals();
 entry.mesh.geometry.computeBoundingBox();
 entry.mesh.geometry.computeBoundingSphere();
}
export function deformWingGeometry(source,config={}){
 if(!source)return;
 const params=wingContext(source,config),vec=new THREE.Vector3();
 for(const entry of source.entries){
  const count=entry.mesh.geometry.getAttribute('position').count;
  modifyRange(entry,0,count,params,vec);
  finalizeMesh(entry);
 }
 return params.axis;
}
export async function deformWingGeometryAsync(source,config={},{
 chunkSize=6000,onProgress=()=>{},cancelled=()=>false,yieldControl=nextFrame
}={}){
 if(!source)return {cancelled:false,processed:0,total:0};
 if(!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>200000)
  throw new Error('Неправильная партия вершин');
 const params=wingContext(source,config),total=totalWingVertices(source),vec=new THREE.Vector3();
 let processed=0;
 for(const entry of source.entries){
  const count=entry.mesh.geometry.getAttribute('position').count;
  for(let i=0;i<count;i+=chunkSize){
   if(cancelled())return {cancelled:true,processed,total,axis:params.axis};
   const end=Math.min(count,i+chunkSize);
   modifyRange(entry,i,end,params,vec);
   processed+=end-i;
   onProgress(processed,total);
   if(processed<total)await yieldControl();
  }
  if(cancelled())return {cancelled:true,processed,total,axis:params.axis};
  finalizeMesh(entry);
 }
 return {cancelled:false,processed,total,axis:params.axis};
}
