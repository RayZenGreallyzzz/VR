import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureWingGeometry,deformWingGeometryAsync} from '../src/wing-geometry.mjs';
import {MAX_WING_VERTICES,INTERACTIVE_WING_VERTICES} from '../src/placement-safety.mjs';
import {readFileSync} from 'node:fs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);

function bigWing(vertexCount=120003){
 const vertices=new Float32Array(vertexCount*3);
 for(let i=0;i<vertexCount;i++){
  vertices[i*3]=i%2===0?-2:2;
  vertices[i*3+1]=Math.floor(i/2)%3*.01;
  vertices[i*3+2]=0;
 }
 const root=new THREE.Group(),geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));
 root.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));
 return {root,original:vertices};
}
test('high-poly (>100k vertices) 30-degree V fold is processed in bounded chunks',async()=>{
 const {root}=bigWing();
 const source=captureWingGeometry(root);
 let yields=0,events=0;
 const result=await deformWingGeometryAsync(source,{bendDegrees:30,hingeFraction:0,wingFoldDirection:-1},{
  chunkSize:7000,onProgress:(done,total)=>{events++;assert.ok(done<=total);},
  yieldControl:async()=>{yields++;}
 });
 assert.equal(result.cancelled,false);
 assert.equal(result.total,120003);
 assert.equal(result.processed,result.total);
 assert.ok(yields>10 && events>10);
 const arr=root.children[0].geometry.getAttribute('position');
 assert.ok(arr.getX(0)<-Math.sqrt(3)&&arr.getX(0)>-2);
 near(arr.getX(0),-arr.getX(1));
 assert.ok(arr.getZ(0)<-.8&&arr.getZ(0)>-1);
 near(arr.getZ(0),arr.getZ(1));
});
test('cancelled heavy bend does not block subsequent full re-bake from original vertices',async()=>{
 const {root}=bigWing();
 const source=captureWingGeometry(root);
 let calls=0;
 const cancelled=await deformWingGeometryAsync(source,{bendDegrees:30,hingeFraction:0,wingFoldDirection:-1},{
  chunkSize:9000,onProgress:()=>{calls++;},cancelled:()=>calls>3,yieldControl:async()=>{}
 });
 assert.equal(cancelled.cancelled,true);
 assert.ok(cancelled.processed<cancelled.total);
 const result=await deformWingGeometryAsync(source,{bendDegrees:0,hingeFraction:0,wingFoldDirection:-1},{
  chunkSize:9000,yieldControl:async()=>{}
 });
 assert.equal(result.cancelled,false);
 const attr=root.children[0].geometry.getAttribute('position');
 near(attr.getX(0),-2);near(attr.getX(1),2);
 near(attr.getZ(0),0);near(attr.getZ(1),0);
});
test('APK UI supports high-poly editing while capping maximum safe wing vertices',()=>{
 assert.ok(MAX_WING_VERTICES>=600000);
 assert.ok(INTERACTIVE_WING_VERTICES<=100000);
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(main,/deformWingGeometryAsync/);
 assert.match(main,/chunkSize:6000/);
 assert.match(main,/await Promise\.all\(parts\.map\(p=>p\.wingTask\)/);
 assert.match(main,/p\.wingRevision!==revision/);
});
