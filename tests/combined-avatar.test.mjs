import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureWingGeometry} from '../src/wing-geometry.mjs';
import {createWingBoneRig,makeWingFlapClip} from '../src/wing-rig.mjs';
import {createTailRig,makeTailWagClip} from '../src/tail-rig.mjs';
import {serializeProject,readEmbeddedProject} from '../src/project-state.mjs';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {inspectGLBBytes} from '../src/glb-verify.mjs';

if(!globalThis.FileReader)globalThis.FileReader=class{
 result=null;onloadend=null;onerror=null;
 readAsArrayBuffer(blob){blob.arrayBuffer().then(data=>{this.result=data;this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
 readAsDataURL(blob){blob.arrayBuffer().then(data=>{this.result='data:'+(blob.type||'application/octet-stream')+';base64,'+Buffer.from(data).toString('base64');this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
};
test('combined project: rigged wings + rigged tail + hidden layer re-open in one binary GLB',async()=>{
 const root=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(.8,2,.5),new THREE.MeshStandardMaterial());
 root.name='PhoenixAvatarRoot';root.add(body);
 const wings=new THREE.Group();wings.userData.avatarPart={id:'part-1',type:'wings',anchor:'back'};wings.name='Attachment:WingPair';
 wings.add(new THREE.Mesh(new THREE.BoxGeometry(4,1,.2),new THREE.MeshStandardMaterial()));root.add(wings);
 const tail=new THREE.Group();tail.userData.avatarPart={id:'part-2',type:'tail',anchor:'hips'};tail.name='Attachment:Tail';
 tail.add(new THREE.Mesh(new THREE.CylinderGeometry(.1,.2,2,6,16),new THREE.MeshStandardMaterial()));root.add(tail);
 const wingRig=createWingBoneRig(captureWingGeometry(wings),{id:'combo',config:{wingSpanAxis:'x'}});
 const tailRig=createTailRig(captureWingGeometry(tail),{id:'combo',axis:'y',base:'min'});
 const clips=[makeWingFlapClip(wingRig),makeTailWagClip(tailRig)];
 const configs=[
  {id:'part-1',name:'WingPair',type:'wings',anchor:'back',visible:false},
  {id:'part-2',name:'Tail',type:'tail',anchor:'hips',visible:true}
 ];
 root.userData.phoenixProject=serializeProject(configs,'Body.glb');
 wings.visible=false; // hidden wings must remain stored in editable project
 const bytes=await new Promise((ok,no)=>new GLTFExporter().parse(root,ok,no,{binary:true,onlyVisible:false,animations:clips}));
 const summary=inspectGLBBytes(bytes,['part-1','part-2']);
 assert.ok(summary.meshes>=3);
 const reopened=await new Promise((ok,no)=>new GLTFLoader().parse(bytes,'',ok,no));
 const meta=readEmbeddedProject(reopened.scene);
 assert.deepEqual(meta.attachments.map(x=>x.id),['part-1','part-2']);
 assert.equal(meta.attachments[0].visible,false);
 assert.equal(reopened.animations.length,2);
 const skins=[];reopened.scene.traverse(o=>{if(o.isSkinnedMesh)skins.push(o);});
 assert.equal(skins.length,2);
 assert.deepEqual(skins.map(m=>m.skeleton.bones.length).sort(),[3,4]);
});
