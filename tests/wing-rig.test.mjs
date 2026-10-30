import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureWingGeometry,deformWingGeometry} from '../src/wing-geometry.mjs';
import {createWingBoneRig,makeWingFlapClip,poseWingRig} from '../src/wing-rig.mjs';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {inspectGLBBytes} from '../src/glb-verify.mjs';
import {readFileSync} from 'node:fs';

if(!globalThis.FileReader){
 globalThis.FileReader=class {
  result=null;onloadend=null;onerror=null;
  readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
  readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result='data:'+(blob.type||'application/octet-stream')+';base64,'+Buffer.from(value).toString('base64');this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
 };
}
function wingScene(){
 const avatar=new THREE.Group();
 avatar.name='PhoenixAvatarRoot';
 const skin=new THREE.Mesh(new THREE.BoxGeometry(.8,1.6,.4),new THREE.MeshStandardMaterial());
 skin.name='Body';avatar.add(skin);
 const part=new THREE.Group();part.name='Attachment:Wings';
 part.userData.avatarPart={id:'two-wings',type:'wings',anchor:'back'};
 avatar.add(part);
 const geo=new THREE.BoxGeometry(4,1,.15);
 const uv=new Float32Array(geo.getAttribute('uv').array);
 const wings=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0xff4444,side:THREE.DoubleSide}));
 wings.name='WingsTwo';part.add(wings);
 const source=captureWingGeometry(part);
 return {avatar,part,wings,source,uv};
}
test('auto-rig splits wings into root, left and right joints with normalized weights',()=>{
 const {source,part,uv}=wingScene();
 const rig=createWingBoneRig(source,{id:'wing-1',config:{wingSpanAxis:'x',hingeFraction:.08}});
 const skinned=part.children[0];
 assert.equal(skinned.isSkinnedMesh,true);
 assert.equal(skinned.skeleton.bones.length,3);
 assert.equal(rig.controls[0].left.name,'WingLeft_wing-1_0');
 assert.equal(rig.controls[0].right.name,'WingRight_wing-1_0');
 assert.deepEqual(skinned.geometry.getAttribute('uv').array,uv);
 const index=skinned.geometry.getAttribute('skinIndex');
 const weight=skinned.geometry.getAttribute('skinWeight');
 const position=skinned.geometry.getAttribute('position');
 let hasLeft=false,hasRight=false;
 for(let i=0;i<position.count;i++){
  assert.ok(Math.abs(weight.getX(i)+weight.getY(i)-1)<1e-5);
  const w=weight.getY(i);
  if(w>.5 && index.getY(i)===1)hasLeft=true;
  if(w>.5 && index.getY(i)===2)hasRight=true;
 }
 assert.ok(hasLeft&&hasRight,'both wings have their own influence');
 poseWingRig(rig,30,-1);
 assert.ok(Math.abs(rig.controls[0].left.quaternion.y)>0.1);
 assert.ok(Math.abs(rig.controls[0].right.quaternion.y)>0.1);
 assert.ok(Math.abs(rig.controls[0].left.quaternion.y+rig.controls[0].right.quaternion.y)<1e-5);
});
test('GLB round trip retains real skin joints and flap animation tracks',async()=>{
 const {avatar,part,source}=wingScene();
 deformWingGeometry(source,{bendDegrees:25,wingFoldDirection:-1,wingSpanAxis:'x'});
 const rig=createWingBoneRig(source,{id:'wing-test',config:{wingSpanAxis:'x',hingeFraction:.08}});
 const clip=makeWingFlapClip(rig,{angle:25,duration:2});
 assert.equal(clip.tracks.length,2);
 const binary=await new Promise((ok,no)=>new GLTFExporter().parse(avatar,ok,no,{binary:true,onlyVisible:true,animations:[clip]}));
 assert.ok(binary instanceof ArrayBuffer);
 const report=inspectGLBBytes(binary,['two-wings']);
 assert.ok(report.meshes>=2);
 const output=await new Promise((ok,no)=>new GLTFLoader().parse(binary,'',ok,no));
 let skinned=0,skinBones=0,left=0,right=0;
 output.scene.traverse(o=>{
  if(o.isSkinnedMesh){skinned++;skinBones+=o.skeleton.bones.length;}
  if(o.isBone&&o.name.startsWith('WingLeft'))left++;
  if(o.isBone&&o.name.startsWith('WingRight'))right++;
 });
 assert.equal(skinned,1);
 assert.equal(skinBones,3);
 assert.equal(left,1);assert.equal(right,1);
 assert.equal(output.animations.length,1);
 assert.ok(output.animations[0].tracks.length>=2);
});
test('rig controls are opt-in and not available for already-rigged models',()=>{
 const {source}=wingScene();
 createWingBoneRig(source,{id:'first'});
 assert.throws(()=>createWingBoneRig(source,{id:'second'}),/уже содержат скелет/);
});
test('UI offers preview, stop and bone creation, export includes generated clip',()=>{
 const h=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 for(const id of ['rigWings','previewWingFlap','stopWingFlap','rigWingStatus'])assert.ok(h.includes('id="'+id+'"'));
 assert.match(js,/createWingBoneRig/);
 assert.match(js,/new THREE\.AnimationMixer\(avatar\)/);
 assert.match(js,/parts\.flatMap\(p=>\[p\.wingClip,p\.tailClip\]\)\.filter\(Boolean\)/);
});
