import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureWingGeometry,deformWingGeometry} from '../src/wing-geometry.mjs';
test('wing geometry is modified for export and can be restored without drift',()=>{
 const group=new THREE.Group();
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute([-2,0,0,0,0,0,2,0,0],3));
 const wing=new THREE.Mesh(geo,new THREE.MeshBasicMaterial());group.add(wing);
 const s=captureWingGeometry(group);
 deformWingGeometry(s,{bendDegrees:90,wingStretch:1.2,hingeFraction:0});
 const arr=wing.geometry.attributes.position.array;
 assert.ok(arr[2]>2.0&&arr[2]<2.4,'arc bend must rise smoothly without tearing');
 assert.ok(Math.abs(arr[8]-arr[2])<1e-4,'left and right wings must fold symmetrically');
 deformWingGeometry(s,{bendDegrees:0,wingStretch:1,hingeFraction:0});
 assert.ok(Math.abs(arr[0]+2)<1e-4);
 assert.ok(Math.abs(arr[8])<1e-4);
});
test('wing modifier preserves texture coordinates and vertex counts',()=>{
 const g=new THREE.Group(),geometry=new THREE.BoxGeometry(1,1,0.2);
 const uv=Float32Array.from(geometry.attributes.uv.array);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());
 g.add(mesh);
 const source=captureWingGeometry(g);
 deformWingGeometry(source,{bendDegrees:30,wingStretch:1.3});
 assert.equal(mesh.geometry.attributes.position.count,geometry.attributes.position.count);
 assert.deepEqual(mesh.geometry.attributes.uv.array,uv);
});

test('nonzero-thickness wing surface has no hinge jump or crumple at the old sharp boundary',()=>{
 const root=new THREE.Group(),geo=new THREE.BufferGeometry();
 const x=.16;
 geo.setAttribute('position',new THREE.Float32BufferAttribute([
  x-.00005,0,.22,x+.00005,0,.22,
  x-.00005,.1,.22,x+.00005,.1,.22,
  -x+.00005,0,.22,-x-.00005,0,.22,
  -x+.00005,.1,.22,-x-.00005,.1,.22,
  2,0,0,-2,0,0],3));
 const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial());
 root.add(mesh);
 const s=captureWingGeometry(root);
 deformWingGeometry(s,{bendDegrees:60,hingeFraction:.08,wingSpanAxis:'x'});
 const p=mesh.geometry.getAttribute('position');
 const d=(a,b)=>new THREE.Vector3().fromBufferAttribute(p,a).distanceTo(new THREE.Vector3().fromBufferAttribute(p,b));
 assert.ok(d(0,1)<.005,'no discontinuity across the outer hinge edge');
 assert.ok(d(2,3)<.005,'no surface rip across the hinge');
 for(let i=0;i<p.count;i++)for(const dim of ['getX','getY','getZ'])assert.ok(Number.isFinite(p[dim](i)));
});
test('KHR_mesh_quantization normalized vertices are decoded to float instead of crushed into integer noise',()=>{
 const group=new THREE.Group(),geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Uint16BufferAttribute([
  0,32768,32768,65535,32768,32768,32768,65535,32768,
  32768,0,32768,32768,32768,65535],3,true));
 geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,.5,1,.2,.2,.8,.8],2));
 const uv=Float32Array.from(geometry.attributes.uv.array);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());group.add(mesh);
 const source=captureWingGeometry(group),attr=mesh.geometry.getAttribute('position');
 assert.ok(attr.array instanceof Float32Array);
 assert.equal(attr.normalized,false);
 deformWingGeometry(source,{bendDegrees:35,wingSpanAxis:'x',hingeFraction:.1});
 assert.ok(attr.getX(0)>=-1&&attr.getX(0)<=2);
 assert.deepEqual(mesh.geometry.attributes.uv.array,uv);
 deformWingGeometry(source,{bendDegrees:0});
 const p=mesh.geometry.attributes.position;
 assert.ok(Math.abs(p.getX(1)-1)<1e-5);
 assert.ok(Math.abs(p.getY(0)-32768/65535)<1e-5);
});
test('isolated feather pieces keep rigid lengths instead of being smeared',()=>{
 const root=new THREE.Group();
 const points=[
  [-2,0,0],[-1.5,0,.05],
  [1.5,0,.04],[2,0,.11],
  [-.1,0,0],[.1,0,0]
 ];
 const geo=new THREE.BufferGeometry();
 geo.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));
 const {mesh,material}={mesh:new THREE.Mesh(geo,new THREE.MeshBasicMaterial()),material:null};
 // A single combined mesh intentionally bends as membrane; independent
 // feather meshes are guarded with a rigid transform.
 for(const [start,end] of [[0,2],[2,4],[4,6]]){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(points.slice(start,end).flat(),3));
  root.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial()));
 }
 const s=captureWingGeometry(root),before=root.children.map(o=>new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.position,0).distanceTo(new THREE.Vector3().fromBufferAttribute(o.geometry.attributes.position,1)));
 deformWingGeometry(s,{bendDegrees:48,hingeFraction:.1,wingSpanAxis:'x'});
 for(let i=0;i<2;i++){
  const m=root.children[i];
  const distance=new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.position,0).distanceTo(new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.position,1));
  assert.ok(Math.abs(distance-before[i])<1e-4,'feather length must stay constant');
 }
});
