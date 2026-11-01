import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {captureWingGeometry,deformWingGeometry} from '../src/wing-geometry.mjs';
import {checkWingGeometryQuality,restoreWingGeometry} from '../src/wing-quality.mjs';
import {inspectGLBBytes} from '../src/glb-verify.mjs';
import {readFileSync} from 'node:fs';

if(!globalThis.FileReader)globalThis.FileReader=class{
 result=null;onloadend=null;onerror=null;
 readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
 readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result='data:'+(blob.type||'application/octet-stream')+';base64,'+Buffer.from(v).toString('base64');this.onloadend?.(this);});}
};
function makeSource(){
 const scene=new THREE.Group();
 const geometry=new THREE.BoxGeometry(2,.04,.2,20,1,2);
 const uv=Float32Array.from(geometry.getAttribute('uv').array);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());
 scene.add(mesh);
 return {scene,mesh,uv,source:captureWingGeometry(scene)};
}
test('Wing quality guard detects a crushed triangle and restores source without changing UV',()=>{
 const {mesh,source,uv}=makeSource();
 const a=mesh.geometry.getAttribute('position');
 // Move only one point far from its neighbors to create a visible tear.
 a.setXYZ(0,9,11,13);
 const quality=checkWingGeometryQuality(source);
 assert.equal(quality.ok,false);
 assert.ok(quality.invalid>0);
 restoreWingGeometry(source);
 assert.equal(checkWingGeometryQuality(source).ok,true);
 assert.deepEqual(mesh.geometry.getAttribute('uv').array,uv);
 assert.ok(Math.abs(mesh.geometry.getAttribute('position').getX(0)-source.entries[0].original[0])<1e-8);
});
test('Wing deformation at modest angles keeps triangle areas and UVs within topology budget',()=>{
 const {mesh,source,uv}=makeSource();
 deformWingGeometry(source,{bendDegrees:25,hingeFraction:.08,wingSpanAxis:'x'});
 const report=checkWingGeometryQuality(source);
 assert.equal(report.ok,true,report.reason);
 assert.ok(report.checked>0);
 assert.deepEqual(mesh.geometry.getAttribute('uv').array,uv);
 deformWingGeometry(source,{bendDegrees:0,hingeFraction:.08});
 assert.equal(checkWingGeometryQuality(source).ok,true);
});
test('GLB exported attachment must contain actual descendant mesh; an empty metadata node is rejected',async()=>{
 const root=new THREE.Group();root.name='AvatarRoot';
 const base=new THREE.Mesh(new THREE.BoxGeometry(.5,1,.2),new THREE.MeshStandardMaterial());
 base.name='CharacterBody';root.add(base);
 const tailNode=new THREE.Group();
 tailNode.name='Attachment:Tail';tailNode.userData.avatarPart={id:'part-tail',type:'tail',anchor:'hips'};
 root.add(tailNode);
 const exported=await new Promise((resolve,reject)=>new GLTFExporter().parse(root,resolve,reject,{binary:true}));
 assert.throws(()=>inspectGLBBytes(exported,['part-tail'],{requireRenderableAttachments:true}),/пустые детали|потерял детали/);
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.03,.1,.6,9),new THREE.MeshStandardMaterial());
 mesh.name='TailGeometry';tailNode.add(mesh);
 const good=await new Promise((resolve,reject)=>new GLTFExporter().parse(root,resolve,reject,{binary:true}));
 const info=inspectGLBBytes(good,['part-tail'],{requireRenderableAttachments:true,verifyPNGData:true});
 assert.ok(info.meshes>=2);
 const parsed=await new Promise((resolve,reject)=>new GLTFLoader().parse(good,'',resolve,reject));
 assert.ok(parsed.scene.getObjectByName('TailGeometry'));
 assert.ok(parsed.scene.getObjectByName('CharacterBody'));
 assert.ok(info.attachments>=1,'GLB binary must retain attachment metadata');
 // Some GLTFLoader versions flatten an otherwise metadata-only parent group,
 // so physical geometry and on-disk extras are the compatibility contract.
});
function makeGLB(json,bin=new Uint8Array()){
 const raw=new TextEncoder().encode(JSON.stringify(json));
 const jsonLen=(raw.length+3)&~3,binLen=(bin.length+3)&~3;
 const size=20+jsonLen+(binLen?8+binLen:0);
 const out=new Uint8Array(size),dv=new DataView(out.buffer);
 dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);
 dv.setUint32(8,size,true);dv.setUint32(12,jsonLen,true);
 dv.setUint32(16,0x4e4f534a,true);out.set(raw,20);
 out.fill(0x20,20+raw.length,20+jsonLen);
 if(binLen){
  dv.setUint32(20+jsonLen,binLen,true);
  dv.setUint32(20+jsonLen+4,0x004e4942,true);
  out.set(bin,28+jsonLen);
 }
 return out.buffer;
}
test('Portable PNG validator checks *actual embedded bytes*, not MIME metadata only',()=>{
 const image=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
 const json={asset:{version:'2.0'},meshes:[{}],images:[{mimeType:'image/png',bufferView:0}],
  bufferViews:[{buffer:0,byteOffset:0,byteLength:image.length}]};
 const good=makeGLB(json,image);
 assert.equal(inspectGLBBytes(good,[],{requireEmbeddedPNG:true,verifyPNGData:true}).pngImages,1);
 image[0]=0;
 assert.throws(()=>inspectGLBBytes(makeGLB(json,image),[],{requireEmbeddedPNG:true,verifyPNGData:true}),/настоящий заголовок PNG/);
});
test('Export UI requires strict reimport-friendly GLB structural verification',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(main,/requireRenderableAttachments:true/);
 assert.match(main,/verifyPNGData:true/);
 assert.match(main,/result.skins/);
 assert.match(main,/result.animations/);
});
