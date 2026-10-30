import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureWingGeometry} from '../src/wing-geometry.mjs';
import {createTailRig,makeTailWagClip,poseTailRig,tailAxisFrame} from '../src/tail-rig.mjs';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {readFileSync} from 'node:fs';
if(!globalThis.FileReader){
 globalThis.FileReader=class {
  result=null;onloadend=null;onerror=null;
  readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
  readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result='data:'+(blob.type||'application/octet-stream')+';base64,'+Buffer.from(value).toString('base64');this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
 };
}
function scene(){
 const root=new THREE.Group(),attachment=new THREE.Group();
 attachment.name='Attachment:Tail.glb';attachment.userData.avatarPart={id:'tail-1',type:'tail',anchor:'hips'};
 root.add(attachment);
 const geometry=new THREE.CylinderGeometry(.08,.3,3,8,24);
 const uv=Float32Array.from(geometry.getAttribute('uv').array);
 const tail=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xaa5500}));
 tail.name='TailGeometry';attachment.add(tail);
 const source=captureWingGeometry(attachment);
 return {root,attachment,tail,source,uv};
}
test('tail rig creates root plus three joints, normalized weights and preserves UVs',()=>{
 const {attachment,source,uv}=scene();
 assert.equal(tailAxisFrame(source).axis,'y');
 const rig=createTailRig(source,{id:'test',axis:'y',base:'min'});
 assert.equal(rig.chains.length,1);
 const skinned=attachment.children[0];
 assert.ok(skinned.isSkinnedMesh);
 assert.equal(skinned.skeleton.bones.length,4);
 assert.deepEqual(skinned.geometry.getAttribute('uv').array,uv);
 const idx=skinned.geometry.getAttribute('skinIndex'),wt=skinned.geometry.getAttribute('skinWeight');
 const used=new Set();
 for(let i=0;i<wt.count;i++){
  assert.ok(Math.abs(wt.getX(i)+wt.getY(i)-1)<1e-5);
  if(wt.getX(i)>.5)used.add(idx.getX(i));
  if(wt.getY(i)>.5)used.add(idx.getY(i));
 }
 assert.ok(used.has(0)&&used.has(3),'weights reach tail root and tip');
 poseTailRig(rig,Math.PI/2,20);
 assert.ok(Math.abs(rig.chains[0].segments[0].rotation.x)>.01);
 assert.throws(()=>createTailRig(source,{id:'again'}),/уже имеет скелет/);
});
test('tail wag clip exports and reimports with 3 real animation tracks',async()=>{
 const {root,source}=scene();
 const rig=createTailRig(source,{id:'export'});
 const clip=makeTailWagClip(rig,{amplitude:20,duration:2});
 assert.equal(clip.tracks.length,3);
 const binary=await new Promise((resolve,reject)=>new GLTFExporter().parse(root,resolve,reject,{binary:true,animations:[clip]}));
 const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(binary,'',resolve,reject));
 let skin=0;gltf.scene.traverse(o=>{if(o.isSkinnedMesh){skin++;assert.equal(o.skeleton.bones.length,4);}});
 assert.equal(skin,1);
 assert.equal(gltf.animations.length,1);
 assert.equal(gltf.animations[0].tracks.length,3);
});
test('UI wires tail bones + preview and adds the tail clip to GLB export',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 for(const id of ['tailTarget','tailAxis','tailRootSide','rigTail','previewTail','stopTail','tailStatus'])
  assert.ok(html.includes('id="'+id+'"'));
 assert.match(js,/createTailRig\(/);assert.match(js,/makeTailWagClip\(/);
 assert.match(js,/p\.tailClip/);
});
