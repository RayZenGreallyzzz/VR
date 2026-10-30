import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {MAX_GARMENT_VERTICES} from './clothing-weights.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const tick=()=>new Promise(r=>typeof requestAnimationFrame==='function'?requestAnimationFrame(r):setTimeout(r,0));
function clothingMeshes(root){
 const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});
 if(!meshes.length||meshes.some(x=>x.isSkinnedMesh))throw new Error('Облегание и подол редактируются до переноса весов. Уже зариганная одежда не изменяется.');
 const count=meshes.reduce((n,m)=>n+(m.geometry?.getAttribute('position')?.count||0),0);
 if(count>MAX_GARMENT_VERTICES)throw new Error('Слишком много вершин для мобильной подгонки: '+count);
 return meshes;
}
function unskinnedBody(body){
 if(!body?.isMesh||!body.geometry?.getAttribute('position'))throw new Error('Выбери меш тела для подгонки');
 body.updateWorldMatrix(true,false);
 const geo=body.geometry.clone();
 geo.applyMatrix4(body.matrixWorld);
 const bbox=geo.boundingBox||new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position'));
 return {geo,bbox};
}
function atBandWidth(geo,bandMin,bandMax,centerX){
 const pos=geo.getAttribute('position'),r=[];
 for(let i=0;i<pos.count;i++){
  const y=pos.getY(i);
  if(y>=bandMin&&y<=bandMax)r.push(Math.abs(pos.getX(i)-centerX));
 }
 if(r.length<4)return null;
 r.sort((a,b)=>a-b);
 return 2*r[Math.floor((r.length-1)*.72)];
}
export function prepareFlare(root){
 const meshes=clothingMeshes(root);
 root.updateWorldMatrix(true,true);
 const inverseRoot=root.matrixWorld.clone().invert();
 const entries=[],min=new THREE.Vector3(Infinity,Infinity,Infinity),max=new THREE.Vector3(-Infinity,-Infinity,-Infinity);
 const v=new THREE.Vector3();
 for(const mesh of meshes){
  mesh.geometry=mesh.geometry.clone();
  const attr=mesh.geometry.getAttribute('position');
  const toRoot=inverseRoot.clone().multiply(mesh.matrixWorld);
  const fromRoot=toRoot.clone().invert();
  for(let i=0;i<attr.count;i++){
   v.fromBufferAttribute(attr,i).applyMatrix4(toRoot);
   min.min(v);max.max(v);
  }
  entries.push({mesh,original:new Float32Array(attr.array),toRoot,fromRoot});
 }
 if(max.y-min.y<1e-5)throw new Error('Не найдена высота одежды для подола (ось Y)');
 const center=new THREE.Vector3().addVectors(min,max).multiplyScalar(.5);
 const radius=Math.max((max.x-min.x)/2,(max.z-min.z)/2,.01);
 return {root,entries,min,max,center,radius};
}
/**
 * Flare only the lower garment: the waist/upper body stays fixed. Every edit
 * recomputes from pristine positions (no accumulated distortion).
 */
export function applyFlare(modifier,factor=1,startFraction=.7){
 if(!modifier||!Number.isFinite(factor)||factor<.7||factor>3
    ||!Number.isFinite(startFraction)||startFraction<.3||startFraction>.95)throw new Error('Неправильная форма подола');
 const {min,max,center,entries}=modifier,waist=min.y+(max.y-min.y)*startFraction;
 const d=Math.max(waist-min.y,1e-6);
 const v=new THREE.Vector3();
 for(const {mesh,original,toRoot,fromRoot} of entries){
  const attr=mesh.geometry.getAttribute('position');
  for(let i=0;i<attr.count;i++){
   v.set(original[i*3],original[i*3+1],original[i*3+2]).applyMatrix4(toRoot);
   const t=clamp((waist-v.y)/d,0,1);
   const ease=t*t*(3-2*t);
   const multiplier=1+(factor-1)*ease;
   v.x=center.x+(v.x-center.x)*multiplier;
   v.z=center.z+(v.z-center.z)*multiplier;
   v.applyMatrix4(fromRoot);
   attr.setXYZ(i,v.x,v.y,v.z);
  }
  attr.needsUpdate=true;
  mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();
  mesh.geometry.computeBoundingBox();
 }
 return factor;
}
export function getHemHandle(modifier,factor=1){
 const {root,center,min,radius}=modifier;
 root.updateWorldMatrix(true,false);
 return {
  world:root.localToWorld(new THREE.Vector3(center.x+radius*factor,min.y+(modifier.max.y-min.y)*.06,center.z)),
  center:root.localToWorld(new THREE.Vector3(center.x,min.y+(modifier.max.y-min.y)*.06,center.z)),
  radius:root.localToWorld(new THREE.Vector3(center.x+radius,min.y,center.z)).distanceTo(
    root.localToWorld(new THREE.Vector3(center.x,min.y,center.z))
  )
 };
}
/**
 * Semi-automatic surface hug: place garment upper edge at torso/waist, uniform
 * size by the body torso, and pull nearby shell vertices gently towards the
 * closest body surface. Loose skirt hem remains untouched in dress/skirt mode.
 */
export async function autoFitClothing(root,body,{
 style='dress',strength=.7,clearance=.015,
 chunkSize=1500,onProgress=()=>{},yieldControl=tick
}={}){
 if(!['dress','top','skirt'].includes(style)||!Number.isFinite(strength)||strength<0||strength>1)
  throw new Error('Неправильный режим подгонки');
 if(!Number.isFinite(clearance)||clearance<=0||clearance>1)throw new Error('Неправильный зазор одежды');
 const meshes=clothingMeshes(root);
 root.updateWorldMatrix(true,true);
 const bodyData=unskinnedBody(body),{geo:bodyGeo,bbox:bodyBox}=bodyData;
 let bvh=null;
 // Full backup means no partial edits if an imported model has bad geometry.
 const backup=meshes.map(mesh=>({mesh,geometry:mesh.geometry.clone()}));
 const origin={position:root.position.clone(),scale:root.scale.clone()};
 try{
  const bsize=bodyBox.getSize(new THREE.Vector3());
  if(bsize.y<.1)throw new Error('Слишком маленькое тело для авто-подгонки');
  const cx=(bodyBox.min.x+bodyBox.max.x)/2,cz=(bodyBox.min.z+bodyBox.max.z)/2;
  const lower=bodyBox.min.y+bsize.y*.60,upper=bodyBox.min.y+bsize.y*.83;
  const bodyTorso=atBandWidth(bodyGeo,lower,upper,cx)||bsize.x*.65;
  const gBox=new THREE.Box3().setFromObject(root),gsize=gBox.getSize(new THREE.Vector3());
  if(gsize.y<=1e-6||gsize.x<=1e-6)throw new Error('Одежда не имеет объёма');
  // Top zone of the garment, so a wide skirt hem does not shrink the waist.
  const garmentTop=[],v=new THREE.Vector3();
  for(const mesh of meshes){
   const a=mesh.geometry.getAttribute('position');
   for(let i=0;i<a.count;i++){
    v.fromBufferAttribute(a,i).applyMatrix4(mesh.matrixWorld);
    if(v.y>=gBox.min.y+gsize.y*.70)garmentTop.push(Math.abs(v.x-(gBox.min.x+gBox.max.x)/2));
   }
  }
  garmentTop.sort((a,b)=>a-b);
  const garmentWidth=garmentTop.length>4 ? 2*garmentTop[Math.floor((garmentTop.length-1)*.80)]:gsize.x;
  const scaleRatio=clamp(bodyTorso/Math.max(garmentWidth,1e-5),.55,1.75);
  root.scale.multiplyScalar(scaleRatio);
  root.updateWorldMatrix(true,true);
  const scaledBox=new THREE.Box3().setFromObject(root);
  const scaledCenter=scaledBox.getCenter(new THREE.Vector3());
  const goalTop=bodyBox.min.y+bsize.y*(style==='skirt'?.59:style==='top'?.88:.89);
  const delta=new THREE.Vector3(cx-scaledCenter.x,goalTop-scaledBox.max.y,cz-scaledCenter.z);
  const parent=root.parent;
  if(parent){
   parent.updateWorldMatrix(true,false);
   const now=root.getWorldPosition(new THREE.Vector3());
   root.position.copy(parent.worldToLocal(now.add(delta)));
  }else root.position.add(delta);
  root.updateWorldMatrix(true,true);
  if(strength===0)return {scaleRatio,modified:0,vertices:0};
  bvh=new MeshBVH(bodyGeo,{maxLeafTris:12});
  const hit={},vWorld=new THREE.Vector3(),nearest=new THREE.Vector3(),centerRadial=new THREE.Vector3();
  let total=0,changed=0;
  const maxDist=bsize.y*.24;
  const staged=[];
  for(const mesh of meshes){
   const attr=mesh.geometry.getAttribute('position');
   const next=new Float32Array(attr.array);
   const inverse=mesh.matrixWorld.clone().invert();
   for(let i=0;i<attr.count;i++){
    vWorld.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);
    const yRatio=(vWorld.y-bodyBox.min.y)/bsize.y;
    // Keep dress/skirt volume below the hips intact. Hips transition smoothly.
    const lowerFade=style==='top'?1:style==='dress'?clamp((yRatio-.51)/.16,0,1):clamp((yRatio-.51)/.12,0,1);
    if(lowerFade>0){
     const h=bvh.closestPointToPoint(vWorld,hit,0,maxDist);
     if(h){
      nearest.copy(h.point);
      centerRadial.set(vWorld.x-cx,0,vWorld.z-cz);
      if(centerRadial.lengthSq()<1e-8)centerRadial.set(1,0,0);
      centerRadial.normalize();
      nearest.addScaledVector(centerRadial,clearance);
      const mix=strength*lowerFade;
      if(vWorld.distanceToSquared(nearest)>1e-10){
       vWorld.lerp(nearest,mix).applyMatrix4(inverse);
       next[i*3]=vWorld.x;next[i*3+1]=vWorld.y;next[i*3+2]=vWorld.z;
       changed++;
      }
     }
    }
    total++;
    if(total%chunkSize===0){onProgress(total,total);await yieldControl();}
   }
   staged.push({mesh,next});
  }
  for(const {mesh,next} of staged){
   const a=mesh.geometry.getAttribute('position');
   a.array.set(next);a.needsUpdate=true;
   mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();mesh.geometry.computeBoundingBox();
  }
  return {scaleRatio,modified:changed,vertices:total};
 }catch(e){
  root.position.copy(origin.position);root.scale.copy(origin.scale);
  for(const {mesh,geometry} of backup){mesh.geometry.dispose();mesh.geometry=geometry;}
  root.updateWorldMatrix(true,true);
  throw e;
 }finally{
  bodyGeo.dispose();
  if(bvh?.geometry && bvh.geometry!==bodyGeo)bvh.geometry.dispose();
  // On success, temporary backups are no longer needed.
  for(const {mesh,geometry} of backup)if(mesh.geometry!==geometry)geometry.dispose();
 }
}
