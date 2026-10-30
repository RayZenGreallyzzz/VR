import * as THREE from 'three';
import {detectWingSpanAxis} from './wing-geometry.mjs';

// Optional, explicit rig creation: each wing half gets its own bone with
// feathered weights at the shared central attachment. No original body
// skeleton is modified, no material or UV coordinates are discarded.
function rootSpanInfo(source,config={}){
 const spanAxis=detectWingSpanAxis(source,config.wingSpanAxis||'auto');
 const axisIndex={x:0,y:1,z:2}[spanAxis],depthIndex=spanAxis==='z'?0:2;
 const halfSpan=Math.max((source.max[axisIndex]-source.min[axisIndex])/2,1e-6);
 return {
  spanAxis,axisIndex,depthIndex,halfSpan,
  center: (source.max[axisIndex]+source.min[axisIndex])/2 + (config.wingCenterOffset||0)*halfSpan,
  depth:(source.min[depthIndex]+source.max[depthIndex])/2,
  hinge:halfSpan*(config.hingeFraction??0.08)
 };
}

export function createWingBoneRig(source,{id='wing',config={}}={}){
 if(!source?.entries?.length)throw new Error('Сначала загрузи крылья с геометрией');
 const frame=rootSpanInfo(source,config);
 const controls=[],replacements=[];
 const vertex=new THREE.Vector3(),rootPoint=new THREE.Vector3();
 // Pre-validate geometry before changing the model.
 for(const entry of source.entries){
  const {mesh,original,fromRoot,toRoot}=entry;
  if(mesh.isSkinnedMesh)throw new Error('Крылья уже содержат скелет. Нужен отдельный режим редактирования существующих костей.');
  const count=mesh.geometry.getAttribute('position')?.count||0;
  if(!count||original.length!==count*3)throw new Error('Неполная геометрия крыльев');
  replacements.push(entry);
 }
 replacements.forEach((entry,index)=>{
  const {mesh,original,fromRoot,toRoot}=entry,geometry=mesh.geometry;
  const skinned=new THREE.SkinnedMesh(geometry,mesh.material);
  skinned.name=mesh.name||('WingMesh'+index);
  skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);
  skinned.scale.copy(mesh.scale);
  skinned.visible=mesh.visible;
  skinned.castShadow=mesh.castShadow;
  skinned.receiveShadow=mesh.receiveShadow;
  skinned.frustumCulled=false;
  skinned.userData={...mesh.userData};
  const rootBone=new THREE.Bone(),left=new THREE.Bone(),right=new THREE.Bone();
  rootBone.name='WingRoot_'+id+'_'+index;
  left.name='WingLeft_'+id+'_'+index;right.name='WingRight_'+id+'_'+index;
  // Bones are local to the wing mesh. Bind matrices can be exported as GLB skins.
  const pivot=new THREE.Vector3();
  pivot.setComponent(frame.axisIndex,frame.center-frame.hinge);
  pivot.setComponent(frame.depthIndex,frame.depth);
  left.position.copy(pivot.applyMatrix4(fromRoot));
  pivot.set(0,0,0).setComponent(frame.axisIndex,frame.center+frame.hinge);
  pivot.setComponent(frame.depthIndex,frame.depth);
  right.position.copy(pivot.applyMatrix4(fromRoot));
  rootBone.add(left,right);
  skinned.add(rootBone);
  // Non-destructive weights: central strip to root, outer halves to L/R.
  const skinIndex=new Uint16Array(geometry.getAttribute('position').count*4);
  const skinWeight=new Float32Array(skinIndex.length);
  const strip=Math.max(frame.hinge,frame.halfSpan*.03);
  for(let i=0;i<geometry.getAttribute('position').count;i++){
   vertex.set(original[i*3],original[i*3+1],original[i*3+2]).applyMatrix4(toRoot);
   const relative=vertex.getComponent(frame.axisIndex)-frame.center;
   const outer=Math.max(0,Math.min(1,(Math.abs(relative)-frame.hinge)/strip));
   skinIndex[i*4]=0;
   skinIndex[i*4+1]=relative<0?1:2;
   skinWeight[i*4]=1-outer;
   skinWeight[i*4+1]=outer;
  }
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndex,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeight,4));
  const parent=mesh.parent;
  if(!parent)throw new Error('Wing mesh has no parent');
  parent.add(skinned);
  parent.remove(mesh);
  skinned.updateWorldMatrix(true,true);
  skinned.bind(new THREE.Skeleton([rootBone,left,right]));
  entry.mesh=skinned;
  controls.push({root:rootBone,left,right,mesh:skinned});
 });
 return {controls,frame};
}

function rotationFor(side,spanAxis,angleRadians,direction=-1){
 const axis=spanAxis==='y'?'x':'y';
 const basis=spanAxis==='z'?-1:1;
 const signed=side*basis*direction*angleRadians;
 return new THREE.Quaternion().setFromAxisAngle(
  axis==='x'?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0),signed
 );
}
export function poseWingRig(rig,angleDegrees=0,direction=-1){
 if(!rig?.controls?.length)throw new Error('Кости крыльев не созданы');
 if(!Number.isFinite(angleDegrees)||Math.abs(angleDegrees)>90)throw new Error('Неправильный угол взмаха');
 const radians=angleDegrees*Math.PI/180;
 for(const {left,right} of rig.controls){
  left.quaternion.copy(rotationFor(-1,rig.frame.spanAxis,radians,direction));
  right.quaternion.copy(rotationFor(1,rig.frame.spanAxis,radians,direction));
 }
}

export function makeWingFlapClip(rig,{angle=25,direction=-1,duration=2}={}){
 if(!rig?.controls?.length)throw new Error('Нет костей для анимации');
 if(![angle,duration].every(Number.isFinite)||angle<0||angle>90||duration<=0)throw new Error('Неверные параметры анимации');
 const positions=[0,.25,.5,.75,1];
 const degrees=[0,angle,-angle*.25,angle,0];
 const times=positions.map(t=>duration*t);
 const tracks=[];
 for(const {left,right} of rig.controls){
  for(const [bone,side] of [[left,-1],[right,1]]){
   const values=[];
   for(const degreesAt of degrees){
    const q=rotationFor(side,rig.frame.spanAxis,degreesAt*Math.PI/180,direction);
    values.push(q.x,q.y,q.z,q.w);
   }
   tracks.push(new THREE.QuaternionKeyframeTrack(bone.name+'.quaternion',times,values));
  }
 }
 return new THREE.AnimationClip('Phoenix_WingFlap',duration,tracks);
}
