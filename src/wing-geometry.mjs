import * as THREE from 'three';
import {WING_AXES} from './wing-bend.mjs';

// A reusable point avoids per-vertex allocations on 300,000+ vertex meshes.
export function detectWingSpanAxis(source,requested='auto'){
 if(requested!=='auto'){
  if(!WING_AXES.includes(requested))throw new Error('Unknown wing axis');
  return requested;
 }
 const sizes=source.max.map((value,i)=>value-source.min[i]);
 return WING_AXES[sizes.indexOf(Math.max(...sizes))];
}

export function captureWingGeometry(root){
 root.updateWorldMatrix(true,true);
 const inverseRoot=root.matrixWorld.clone().invert(),entries=[];
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 const v=new THREE.Vector3();
 root.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.getAttribute('position'))return;
  // Keep original GLB geometry immutable: clone for the modifier.
  mesh.geometry=mesh.geometry.clone();
  const attr=mesh.geometry.getAttribute('position');
  const original=new Float32Array(attr.array);
  const toRoot=inverseRoot.clone().multiply(mesh.matrixWorld);
  const fromRoot=toRoot.clone().invert();
  for(let i=0;i<attr.count;i++){
   v.fromBufferAttribute(attr,i).applyMatrix4(toRoot);
   for(let j=0;j<3;j++){
    min[j]=Math.min(min[j],v.getComponent(j));
    max[j]=Math.max(max[j],v.getComponent(j));
   }
  }
  entries.push({mesh,original,toRoot,fromRoot});
 });
 if(!entries.length)return null;
 return {entries,min,max,centerX:(min[0]+max[0])/2,halfSpan:Math.max((max[0]-min[0])/2,1e-6)};
}

export function totalWingVertices(source){
 return source?.entries.reduce((sum,{mesh})=>sum+(mesh.geometry.getAttribute('position')?.count||0),0)||0;
}

function wingContext(source,{
 bendDegrees=0,wingStretch=1,hingeFraction=.08,
 wingSpanAxis='auto',wingCenterOffset=0,wingFoldDirection=1
}={}){
 const axis=detectWingSpanAxis(source,wingSpanAxis);
 if(![bendDegrees,wingStretch,hingeFraction,wingCenterOffset,wingFoldDirection].every(Number.isFinite)||
    wingStretch<=0||hingeFraction<0||hingeFraction>=1||Math.abs(wingCenterOffset)>.8||
    ![-1,1].includes(wingFoldDirection))throw new Error('Invalid wing fold settings');
 const spanIndex={x:0,y:1,z:2}[axis];
 const depthIndex=axis==='z'?0:2;
 const halfSpan=Math.max((source.max[spanIndex]-source.min[spanIndex])/2,1e-6);
 const mid=(source.min[spanIndex]+source.max[spanIndex])/2;
 const radians=bendDegrees*wingFoldDirection*Math.PI/180;
 return {
  axis,spanIndex,depthIndex,halfSpan,
  centerX:mid+wingCenterOffset*halfSpan,
  centerDepth:(source.min[depthIndex]+source.max[depthIndex])/2,
  hinge:halfSpan*hingeFraction,
  cosine:Math.cos(radians),sine:Math.sin(radians),
  stretch:wingStretch,neutral:bendDegrees===0&&wingStretch===1
 };
}
function modifyRange(entry,start,end,params,vec){
 const {original,toRoot,fromRoot,mesh}=entry;
 const attr=mesh.geometry.getAttribute('position');
 const {spanIndex,depthIndex,centerX,centerDepth,hinge,cosine,sine,stretch,neutral}=params;
 for(let i=start;i<end;i++){
  vec.set(original[i*3],original[i*3+1],original[i*3+2]).applyMatrix4(toRoot);
  const position=vec.getComponent(spanIndex),depth=vec.getComponent(depthIndex);
  const offset=position-centerX;
  if(!neutral&&Math.abs(offset)>hinge){
   const side=offset>0?1:-1,hingePos=centerX+side*hinge,radial=position-hingePos,depthOffset=depth-centerDepth;
   vec.setComponent(spanIndex,hingePos+radial*stretch*cosine-side*depthOffset*sine);
   vec.setComponent(depthIndex,centerDepth+Math.abs(radial)*stretch*sine+depthOffset*cosine);
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
const nextFrame=()=>new Promise(resolve=>{
 if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>resolve());
 else setTimeout(resolve,0);
});

/**
 * For heavy wings, edit a bounded number of vertices each frame.
 * The caller can supersede an old job. All changes are baked in BufferGeometry.
 * Finish the active job before exporting GLB to avoid partial geometry.
 */
export async function deformWingGeometryAsync(source,config={},{
 chunkSize=6000,onProgress=()=>{},cancelled=()=>false,yieldControl=nextFrame
}={}){
 if(!source)return {cancelled:false,processed:0,total:0};
 if(!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>200000)throw new Error('Invalid chunk size');
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
