import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {captureWingGeometry,deformWingGeometry} from '../src/wing-geometry.mjs';

// Node.js does not supply FileReader; Three's exporter uses it for binary GLB.
if(!globalThis.FileReader){
 globalThis.FileReader=class {
  result=null;onloadend=null;onerror=null;
  readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
  readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result='data:'+(blob.type||'application/octet-stream')+';base64,'+Buffer.from(value).toString('base64');this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
 };
}
test('a bone-attached, bent wing is physically present in exported and re-imported GLB',async()=>{
 const avatar=new THREE.Group();avatar.name='PhoenixAvatarRoot';
 const body=new THREE.Mesh(new THREE.BoxGeometry(.5,1,.3),new THREE.MeshStandardMaterial());body.name='Body';
 avatar.add(body);
 const bone=new THREE.Bone();bone.name='Hips';avatar.add(bone);
 const container=new THREE.Group();container.name='Attachment:Wings.glb';bone.add(container);
 const wing=new THREE.Mesh(new THREE.BoxGeometry(4,.2,.2),new THREE.MeshStandardMaterial({color:0x7777ff}));wing.name='WingGeometry';
 container.add(wing);
 const source=captureWingGeometry(container);
 deformWingGeometry(source,{bendDegrees:35,wingStretch:1.12,hingeFraction:.08});
 const after=wing.geometry.attributes.position.array;
 const bendDepth=Math.max(...Array.from(after).filter((_,i)=>i%3===2));
 assert.ok(bendDepth>0.5,'must bend actual mesh vertex data');
 const exported=await new Promise((resolve,reject)=>new GLTFExporter().parse(avatar,resolve,reject,{binary:true,onlyVisible:true}));
 assert.ok(exported instanceof ArrayBuffer);
 const imported=await new Promise((resolve,reject)=>new GLTFLoader().parse(exported,'',resolve,reject));
 let recoveredParts=0,recoveredMeshes=0,wingFound=false;
 imported.scene.traverse(o=>{
  if(o.name==='Attachment:Wings.glb')recoveredParts++;
  if(o.isMesh)recoveredMeshes++;
  if(o.name==='WingGeometry'){wingFound=true;const a=o.geometry.attributes.position;
   let maxZ=-Infinity;for(let i=0;i<a.count;i++)maxZ=Math.max(maxZ,a.getZ(i));
   assert.ok(maxZ>0.5,'GLB must retain baked curved geometry');
  }
 });
 assert.equal(recoveredParts,1);
 assert.equal(recoveredMeshes,2);
 assert.equal(wingFound,true);
});
test('Android document picker registered before native Gradle compile',()=>{
 const fs=import('node:fs');
 return fs.then(({readFileSync})=>{
  const plugin=readFileSync(new URL('../native/android/NativeSavePlugin.java',import.meta.url),'utf8');
  const install=readFileSync(new URL('../scripts/install-native-save.mjs',import.meta.url),'utf8');
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.match(plugin,/ACTION_CREATE_DOCUMENT/);
  assert.match(plugin,/writeChunk/);
  assert.match(install,/registerPlugin\(NativeSavePlugin\.class\)/);
  assert.match(pkg.scripts['android:apk'],/install-native-save/);
 });
});
