import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {serializeProject,readEmbeddedProject,TransformHistory} from '../src/project-state.mjs';
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
test('history records bounded transform snapshots and discards redo after new edit',()=>{
 const hist=new TransformHistory(3);
 hist.record([{id:'a',position:[0,0,0]}]);
 hist.record([{id:'a',position:[1,0,0]}]);
 hist.record([{id:'a',position:[2,0,0]}]);
 assert.equal(hist.undo()[0].position[0],1);
 assert.equal(hist.undo()[0].position[0],0);
 assert.equal(hist.undo(),null);
 assert.equal(hist.redo()[0].position[0],1);
 hist.record([{id:'a',position:[5,0,0]}]);
 assert.equal(hist.redo(),null);
 hist.record([{id:'a',position:[6,0,0]}]);
 assert.equal(hist.states.length,3);
 hist.clear();assert.equal(hist.canUndo,false);
});
test('project metadata reimports from complete GLB with hidden layers and transforms intact',async()=>{
 const avatar=new THREE.Group();avatar.name='PhoenixAvatarRoot';
 const body=new THREE.Mesh(new THREE.BoxGeometry(1,2,.4),new THREE.MeshStandardMaterial());
 avatar.add(body);
 const part=new THREE.Group();part.name='Attachment:Tail';
 part.userData.avatarPart={id:'part-4',type:'tail',anchor:'hips'};
 part.position.set(.11,.22,.33);part.rotation.set(.2,.1,0);part.scale.setScalar(.8);
 const tail=new THREE.Mesh(new THREE.BoxGeometry(.2,1,.2),new THREE.MeshStandardMaterial());
 part.add(tail);avatar.add(part);
 const config={id:'part-4',type:'tail',name:'Tail from GLB',anchor:'hips',position:[.11,.22,.33],rotation:[11.459,5.729,0],scale:.8,visible:false};
 avatar.userData.phoenixProject=serializeProject([{config}],'body.glb');
 const binary=await new Promise((ok,no)=>new GLTFExporter().parse(avatar,ok,no,{binary:true,onlyVisible:false}));
 const report=inspectGLBBytes(binary,['part-4']);
 assert.ok(report.meshes>=2);
 const loaded=await new Promise((ok,no)=>new GLTFLoader().parse(binary,'',ok,no));
 const project=readEmbeddedProject(loaded.scene);
 assert.equal(project.attachments.length,1);
 assert.equal(project.attachments[0].visible,false);
 assert.equal(project.attachments[0].position[1],.22);
 let found=null;loaded.scene.traverse(o=>{if(o.userData?.avatarPart?.id==='part-4')found=o;});
 assert.ok(found);assert.ok(found.isGroup);assert.ok(Math.abs(found.position.x-.11)<1e-5);
 assert.equal(readEmbeddedProject(new THREE.Group()),null);
});
test('malformed project metadata rejected with clear error',()=>{
 const parent=new THREE.Group();parent.userData.phoenixProject={schema:'phoenix-vr-editable',version:10,attachments:[]};
 assert.throws(()=>readEmbeddedProject(parent),/Неподдерживаемая/);
});
test('undo/redo and GLB project UI are present and wired',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 for(const id of ['undoEdit','redoEdit','projectFile','saveProject'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(js,/serializeProject\(included,modelName\)/);
 assert.match(js,/readEmbeddedProject\(base\)/);
 assert.match(js,/saveCombinedGLB\(true\)/);
 assert.match(js,/history\.record\(snapshot\(\)\)/);
});
