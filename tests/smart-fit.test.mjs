import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createBodyCage,CAGE_TRIANGLE_LIMIT} from '../src/body-cage.mjs';
import {smartDress} from '../src/smart-fit.mjs';
import {readFileSync} from 'node:fs';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

if(!globalThis.FileReader)globalThis.FileReader=class {
 result=null;onloadend=null;onerror=null;
 readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
 readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result='data:'+(blob.type||'application/octet-stream')+';base64,'+Buffer.from(v).toString('base64');this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
};

function highDensityBody(){
 const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,128,96),new THREE.MeshStandardMaterial());
 mesh.name='FusedBodyWithShorts';
 mesh.scale.set(1,1.2,1);mesh.position.set(0,1.3,0);
 mesh.updateWorldMatrix(true,false);
 return mesh;
}
function boxGarment(){
 const obj=new THREE.Group();obj.name='Attachment:Top';obj.userData.avatarPart={id:'shirt',type:'clothing',anchor:'chest'};
 const fabric=new THREE.Mesh(new THREE.CylinderGeometry(.82,.8,1.55,32,20),new THREE.MeshStandardMaterial({color:0xaa4477}));
 fabric.name='Clothing';fabric.position.y=1.3;obj.add(fabric);
 obj.updateWorldMatrix(true,true);
 return {obj,fabric};
}
test('Body Cage trims head range and reduces high-poly body without modifying original vertices',async()=>{
 const body=highDensityBody(),geometry=body.geometry;
 const original=Float32Array.from(geometry.attributes.position.array);
 const count=geometry.index.count/3;
 const cage=await createBodyCage(body,{maxTriangles:900,topFraction:.85,yieldControl:async()=>{}});
 assert.strictEqual(body.geometry,geometry);
 assert.deepEqual(geometry.attributes.position.array,original);
 assert.equal(cage.originalTriangles,count);
 assert.ok(cage.triangles<=900&&cage.triangles>50);
 assert.equal(cage.mesh.userData.editorOnly,true);
 assert.ok(cage.mesh.geometry.index.count/3===cage.triangles);
 assert.equal(cage.mesh.material.transparent,true);
 const visible=cage.mesh.geometry.boundingBox;
 assert.ok(visible.max.y<.8,'topmost horn/head range should be clipped in mesh local space');
 cage.dispose();
});
test('Disconnected mesh islands are sampled in aggregate, not limited to largest fragment',async()=>{
 const count=1200,pts=new Float32Array(count*9);
 for(let i=0;i<count;i++){
  const p=i*9,y=i/count;
  pts.set([i*.00001,y,0,i*.00001+.003,y,0,i*.00001,y,.003],p);
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
 const body=new THREE.Mesh(geo,new THREE.MeshStandardMaterial());
 const cage=await createBodyCage(body,{maxTriangles:300,topFraction:1,yieldControl:async()=>{}});
 assert.equal(cage.triangles,300);
 const pos=cage.mesh.geometry.attributes.position;
 assert.ok(pos.getY(0)<.1);
 assert.ok(pos.getY(pos.count-1)>.9);
 cage.dispose();
});
test('Invalid cage settings refuse the request without changing body',async()=>{
 const b=highDensityBody();
 await assert.rejects(()=>createBodyCage(b,{maxTriangles:CAGE_TRIANGLE_LIMIT+1}),/лимит/);
 await assert.rejects(()=>createBodyCage(b,{topFraction:.1}),/высота/);
});
test('Unrigged 3D body: one-button Smart Dress fits cloth, reports rigging requirement accurately',async()=>{
 const body=highDensityBody(),{obj}=boxGarment();
 const cage=await createBodyCage(body,{maxTriangles:2500,topFraction:.93,yieldControl:async()=>{}});
 const start=obj.position.clone();
 const result=await smartDress(obj,{body,cage,style:'top',strength:.3,yieldControl:async()=>{}});
 assert.equal(result.stage,'fitted');
 assert.match(result.warning,/нет скелета/);
 assert.ok(!obj.getObjectByProperty('isSkinnedMesh',true));
 assert.ok(obj.position.distanceTo(start)>0.05);
 assert.ok(obj.children[0].geometry.attributes.uv.count>0);
 cage.dispose();
});
test('Smart Dress rejects prefit without cage and does not mutate garment',async()=>{
 const {obj,fabric}=boxGarment(),body=highDensityBody();
 const geo=fabric.geometry,position=obj.position.clone();
 await assert.rejects(()=>smartDress(obj,{body,style:'top'}),/оболочку тела/);
 assert.strictEqual(fabric.geometry,geo);
 assert.deepEqual(obj.position.toArray(),position.toArray());
});
test('Body Cage is editor-only: saved GLB contains unchanged body and garment but not the cage',async()=>{
 const scene=new THREE.Group(),body=highDensityBody(),{obj}=boxGarment();scene.add(body,obj);
 const cage=await createBodyCage(body,{maxTriangles:600,topFraction:.86,yieldControl:async()=>{}});
 const editor=new THREE.Scene();editor.add(scene,cage.mesh);
 const data=await new Promise((resolve,reject)=>new GLTFExporter().parse(scene,resolve,reject,{binary:true}));
 const loaded=await new Promise((resolve,reject)=>new GLTFLoader().parse(data,'',resolve,reject));
 const names=[];loaded.scene.traverse(o=>names.push(o.name));
 assert.ok(names.includes('FusedBodyWithShorts'));
 assert.ok(names.includes('Clothing'));
 assert.ok(!names.includes('PhoenixEditorBodyCage'));
 cage.dispose();
});
test('UI provides one-click SmartFit, separate cage preview, top filtering and pants style',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 for(const id of ['smartFitSection','smartBodySource','smartCageTop','buildBodyCage','toggleBodyCage','smartClothesStyle','smartDress','smartFitStatus']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(html,/<option value="pants">/);
 assert.match(main,/createBodyCage\(/);
 assert.match(main,/runSmartDress\(/);
 assert.match(main,/releaseBodyCage\(\)/);
});
