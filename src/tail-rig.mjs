import * as THREE from 'three';
import {captureWingGeometry,detectWingSpanAxis} from './wing-geometry.mjs';

const axisIndex={x:0,y:1,z:2};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export function tailAxisFrame(source,{axis='auto',base='min'}={}){
 if(!source?.entries?.length)throw new Error('Нет геометрии хвоста');
 if(!['auto','x','y','z'].includes(axis)||!['min','max'].includes(base))throw new Error('Некорректная ориентация хвоста');
 const chosen=detectWingSpanAxis(source,axis);
 const dim=axisIndex[chosen],lo=source.min[dim],hi=source.max[dim],len=hi-lo;
 if(!(len>1e-5))throw new Error('Хвост слишком короткий для суставов');
 const center=source.min.map((n,i)=>(n+source.max[i])/2);
 return {axis:chosen,dim,base,lo,hi,len,center};
}
/** 4 bones (root+3 segments), smooth normalized weights and original UVs preserved */
export function createTailRig(source,{id='tail',axis='auto',base='min'}={}){
 const frame=tailAxisFrame(source,{axis,base});
 for(const e of source.entries)if(e.mesh.isSkinnedMesh)throw new Error('Хвост уже имеет скелет. Повторный риг отключён.');
 const chains=[],temp=new THREE.Vector3();
 for(let part=0;part<source.entries.length;part++){
  const entry=source.entries[part],{mesh,original,fromRoot,toRoot}=entry;
  const geometry=mesh.geometry,positions=geometry.getAttribute('position');
  if(!positions||positions.count*3!==original.length)throw new Error('Неполные данные вершин хвоста');
  const root=new THREE.Bone(),segments=Array.from({length:3},()=>new THREE.Bone());
  root.name='TailRoot_'+id+'_'+part;
  segments.forEach((b,i)=>b.name='Tail'+(i+1)+'_'+id+'_'+part);
  const anchorPoint=frame.center.slice();
  anchorPoint[frame.dim]=frame.base==='min'?frame.lo:frame.hi;
  root.position.fromArray(anchorPoint).applyMatrix4(fromRoot);
  let parent=root,prior=0;
  for(let i=0;i<segments.length;i++){
   const frac=(i+.5)/3;
   const point=frame.center.slice();
   point[frame.dim]=frame.base==='min'?frame.lo+frame.len*frac:frame.hi-frame.len*frac;
   temp.fromArray(point).applyMatrix4(fromRoot);
   if(i===0)segments[i].position.copy(temp).sub(root.position);
   else{
    const previous=frame.center.slice(),prFrac=(i-.5)/3;
    previous[frame.dim]=frame.base==='min'?frame.lo+frame.len*prFrac:frame.hi-frame.len*prFrac;
    segments[i].position.copy(temp).sub(new THREE.Vector3().fromArray(previous).applyMatrix4(fromRoot));
   }
   parent.add(segments[i]);parent=segments[i];
  }
  const idx=new Uint16Array(positions.count*4),wt=new Float32Array(positions.count*4);
  for(let i=0;i<positions.count;i++){
   temp.set(original[3*i],original[3*i+1],original[3*i+2]).applyMatrix4(toRoot);
   const value=temp.getComponent(frame.dim);
   const t=clamp((frame.base==='min'?value-frame.lo:frame.hi-value)/frame.len,0,1);
   // Root controls the first eighth; weights smoothly blend to joint 1/2/3.
   const scaled=clamp(t*3.5,0,3),left=Math.floor(scaled),right=Math.min(left+1,3);
   const f=scaled-left;
   idx[4*i]=left;idx[4*i+1]=right;
   wt[4*i]=1-f;wt[4*i+1]=f;
  }
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(idx,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(wt,4));
  const skinned=new THREE.SkinnedMesh(geometry,mesh.material);
  skinned.name=mesh.name||('TailMesh_'+part);skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);skinned.scale.copy(mesh.scale);
  skinned.userData={...mesh.userData};skinned.visible=mesh.visible;skinned.frustumCulled=false;
  skinned.castShadow=mesh.castShadow;skinned.receiveShadow=mesh.receiveShadow;
  skinned.add(root);
  const parentObject=mesh.parent;
  if(!parentObject)throw new Error('Меш хвоста потерял родителя');
  parentObject.add(skinned);parentObject.remove(mesh);
  skinned.updateWorldMatrix(true,true);
  skinned.bind(new THREE.Skeleton([root,...segments]));
  entry.mesh=skinned;
  chains.push({root,segments,mesh:skinned});
 }
 return {chains,frame};
}
export function poseTailRig(rig,phase=0,amplitude=15){
 if(!rig?.chains?.length)throw new Error('Нет костей хвоста');
 if(![phase,amplitude].every(Number.isFinite)||Math.abs(amplitude)>70)throw new Error('Некорректные углы');
 for(const {segments} of rig.chains){
  segments.forEach((bone,i)=>{
   bone.rotation.set(0,0,0);
   const a=THREE.MathUtils.degToRad(amplitude*Math.sin(phase-i*.55));
   if(rig.frame.axis==='x')bone.rotation.y=a;
   else bone.rotation.x=a;
  });
 }
}
export function makeTailWagClip(rig,{amplitude=18,duration=2}={}){
 if(!rig?.chains?.length)throw new Error('Нет костей хвоста');
 if(![amplitude,duration].every(Number.isFinite)||amplitude<0||amplitude>70||duration<=0)throw new Error('Недопустимая анимация');
 const steps=9,times=Array.from({length:steps},(_,i)=>i*duration/(steps-1)),tracks=[];
 for(const {segments} of rig.chains)segments.forEach((bone,j)=>{
  const values=[];
  for(const t of times){
   const angle=THREE.MathUtils.degToRad(amplitude*Math.sin(2*Math.PI*t/duration-j*.5));
   const q=new THREE.Quaternion().setFromAxisAngle(
    rig.frame.axis==='x'?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0),angle);
   values.push(...q.toArray());
  }
  tracks.push(new THREE.QuaternionKeyframeTrack(bone.name+'.quaternion',times,values));
 });
 return new THREE.AnimationClip('Phoenix_TailWag',duration,tracks);
}
