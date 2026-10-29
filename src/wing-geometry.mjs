import * as THREE from 'three';
import {bendWingPoint} from './wing-bend.mjs';
const v=new THREE.Vector3();

// Retain pristine, per-mesh vertices. Deformation is non-cumulative,
// so moving a slider in either direction does not destroy the original shape.
export function captureWingGeometry(root){
 root.updateWorldMatrix(true,true);
 const inverseRoot=root.matrixWorld.clone().invert(),entries=[];
 let minX=Infinity,maxX=-Infinity;
 root.traverse(mesh=>{
  if(!mesh.isMesh||!mesh.geometry?.getAttribute('position'))return;
  mesh.geometry=mesh.geometry.clone(); // avoid editing a shared glTF geometry
  const attr=mesh.geometry.getAttribute('position');
  const original=new Float32Array(attr.array);
  const toRoot=inverseRoot.clone().multiply(mesh.matrixWorld);
  const fromRoot=toRoot.clone().invert();
  for(let i=0;i<attr.count;i++){
   v.fromBufferAttribute(attr,i).applyMatrix4(toRoot);
   minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);
  }
  entries.push({mesh,original,toRoot,fromRoot});
 });
 if(!entries.length)return null;
 return {entries,centerX:(minX+maxX)/2,halfSpan:Math.max((maxX-minX)/2,1e-6)};
}

export function deformWingGeometry(source,{bendDegrees=0,wingStretch=1,hingeFraction=.08}={}){
 if(!source)return;
 for(const {mesh,original,toRoot,fromRoot} of source.entries){
  const attr=mesh.geometry.getAttribute('position');
  for(let i=0;i<attr.count;i++){
   v.set(original[i*3],original[i*3+1],original[i*3+2]).applyMatrix4(toRoot);
   const [x,y,z]=bendWingPoint(v.toArray(),{
    centerX:source.centerX,halfSpan:source.halfSpan,hingeFraction,bendDegrees,stretch:wingStretch
   });
   v.set(x,y,z).applyMatrix4(fromRoot);
   attr.setXYZ(i,v.x,v.y,v.z);
  }
  attr.needsUpdate=true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
 }
}
