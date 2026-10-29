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
 assert.ok(Math.abs(arr[2]-2.4)<1e-4);
 assert.ok(Math.abs(arr[8]-2.4)<1e-4);
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
