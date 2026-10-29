import * as THREE from 'three';
import {bendWingPoint,WING_AXES} from './wing-bend.mjs';
const v=new THREE.Vector3();

export function detectWingSpanAxis(source,requested='auto'){
 if(requested!=='auto'){
  if(!WING_AXES.includes(requested))throw new Error('Unknown wing axis');
  return requested;
 }
 // The largest dimension usually corresponds to the two outstretched wings.
 const sizes=source.max.map((value,i)=>value-source.min[i]);
 const best=sizes.indexOf(Math.max(...sizes));
 return WING_AXES[best];
}
// Keep a pristine, per-mesh position buffer. Repeated edits NEVER accumulate.
export function captureWingGeometry(root){
 root.updateWorldMatrix(true,true);
 const inverseRoot=root.matrixWorld.clone().invert(),entries=[];
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 root.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.getAttribute('position'))return;
  mesh.geometry=mesh.geometry.clone();
  const attr=mesh.geometry.getAttribute('position');
  const original=new Float32Array(attr.array);
  const toRoot=inverseRoot.clone().multiply(mesh.matrixWorld);
  const fromRoot=toRoot.clone().invert();
  for(let i=0;i<attr.count;i++){
   v.fromBufferAttribute(attr,i).applyMatrix4(toRoot);
   for(let j=0;j<3;j++){min[j]=Math.min(min[j],v.getComponent(j));max[j]=Math.max(max[j],v.getComponent(j));}
  }
  entries.push({mesh,original,toRoot,fromRoot});
 });
 if(!entries.length)return null;
 return {
  entries,min,max,
  centerX:(min[0]+max[0])/2,
  halfSpan:Math.max((max[0]-min[0])/2,1e-6)
 };
}

export function deformWingGeometry(source,{
 bendDegrees=0,wingStretch=1,hingeFraction=.08,
 wingSpanAxis='auto',wingCenterOffset=0,wingFoldDirection=1
}={}){
 if(!source)return;
 const spanAxis=detectWingSpanAxis(source,wingSpanAxis);
 const axisIndex={x:0,y:1,z:2}[spanAxis];
 const depthIndex=spanAxis==='z'?0:2;
 const mid=(source.min[axisIndex]+source.max[axisIndex])/2;
 const halfSpan=Math.max((source.max[axisIndex]-source.min[axisIndex])/2,1e-6);
 const centerX=mid+wingCenterOffset*halfSpan;
 const centerDepth=(source.min[depthIndex]+source.max[depthIndex])/2;
 for(const {mesh,original,toRoot,fromRoot} of source.entries){
  const attr=mesh.geometry.getAttribute('position');
  for(let i=0;i<attr.count;i++){
   v.set(original[i*3],original[i*3+1],original[i*3+2]).applyMatrix4(toRoot);
   const target=bendWingPoint([v.x,v.y,v.z],{
    centerX,centerDepth,halfSpan,hingeFraction,bendDegrees,stretch:wingStretch,
    spanAxis,direction:wingFoldDirection
   });
   v.set(target[0],target[1],target[2]).applyMatrix4(fromRoot);
   attr.setXYZ(i,v.x,v.y,v.z);
  }
  attr.needsUpdate=true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
 }
 return spanAxis;
}
