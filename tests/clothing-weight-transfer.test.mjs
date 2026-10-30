import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {findWeightSources,transferClothingWeights,clothingStatus,MAX_GARMENT_VERTICES} from '../src/clothing-weights.mjs';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {readFileSync} from 'node:fs';

if(!globalThis.FileReader)globalThis.FileReader=class {
 result=null;onloadend=null;onerror=null;
 readAsArrayBuffer(blob){blob.arrayBuffer().then(value=>{this.result=value;this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
 readAsDataURL(blob){blob.arrayBuffer().then(value=>{this.result='data:'+(blob.type||'application/octet-stream')+';base64,'+Buffer.from(value).toString('base64');this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
};
function avatarWithClothes({far=false}={}){
 const avatar=new THREE.Group();
 const bodyGeo=new THREE.BoxGeometry(1,2,.5,6,8,2);
 const count=bodyGeo.attributes.position.count;
 const indices=new Uint16Array(count*4),weights=new Float32Array(count*4);
 const position=bodyGeo.attributes.position;
 for(let i=0;i<count;i++){
  indices[i*4]=position.getX(i)<0?1:2;
  weights[i*4]=1;
 }
 bodyGeo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));
 bodyGeo.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));
 const body=new THREE.SkinnedMesh(bodyGeo,new THREE.MeshStandardMaterial());
 body.name='OriginalRiggedBody';
 avatar.add(body);
 const hips=new THREE.Bone(),left=new THREE.Bone(),right=new THREE.Bone();
 hips.name='Hips';left.name='LeftShoulder';right.name='RightShoulder';
 left.position.x=-.5;right.position.x=.5;
 hips.add(left,right);body.add(hips);body.updateWorldMatrix(true,true);
 body.bind(new THREE.Skeleton([hips,left,right]),body.matrixWorld);
 const attachment=new THREE.Group();attachment.name='Attachment:Clothes';
 attachment.userData.avatarPart={id:'shirt1',type:'clothing',anchor:'chest'};
 const clothGeometry=new THREE.BoxGeometry(1.08,2.04,.54,5,8,1);
 const uv=Float32Array.from(clothGeometry.getAttribute('uv').array);
 const shirt=new THREE.Mesh(clothGeometry,new THREE.MeshStandardMaterial({color:0x883311}));
 shirt.name='Shirt';
 attachment.add(shirt);avatar.add(attachment);
 if(far)attachment.position.set(15,0,0);
 avatar.updateWorldMatrix(true,true);
 return {avatar,body,attachment,uv,left,right,shirt};
}
const close=(x,y)=>assert.ok(Math.abs(x-y)<1e-4,`expected ${x} ≈ ${y}`);
test('body SkinnedMesh sources detected and no-skeleton case rejected',()=>{
 const {avatar,body,attachment}=avatarWithClothes();
 assert.deepEqual(findWeightSources(avatar),[body]);
 assert.equal(clothingStatus(attachment,body).clothing.length,1);
 assert.throws(()=>clothingStatus(attachment,new THREE.Mesh()),/SkinnedMesh/);
 assert.ok(MAX_GARMENT_VERTICES>=100000);
});
test('surface weight transfer gives 4 normalized weights and leaves UVs/material unchanged',async()=>{
 const {body,attachment,uv,shirt}=avatarWithClothes();
 const original=shirt.material;
 const result=await transferClothingWeights(attachment,body,{maxDistance:.3,yieldControl:async()=>{}});
 assert.ok(result.vertices>100);
 assert.equal(result.meshes,1);
 const cloth=attachment.children[0];
 assert.ok(cloth.isSkinnedMesh);
 assert.strictEqual(cloth.skeleton,body.skeleton);
 assert.strictEqual(cloth.material,original);
 assert.deepEqual(cloth.geometry.getAttribute('uv').array,uv);
 const w=cloth.geometry.attributes.skinWeight,idx=cloth.geometry.attributes.skinIndex;
 for(let i=0;i<w.count;i++){
  const total=w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i);
  close(total,1);
  for(let k=0;k<4;k++)assert.ok(idx.getComponent(i,k)<body.skeleton.bones.length);
 }
 assert.throws(()=>clothingStatus(attachment,body),/уже имеет скелет/);
});
test('weights follow left and right bones without crossing into opposite shoulder',async()=>{
 const {body,attachment,left,right}=avatarWithClothes();
 await transferClothingWeights(attachment,body,{maxDistance:.3,yieldControl:async()=>{}});
 const cloth=attachment.children[0],attr=cloth.geometry.getAttribute('position');
 let leftVertex=-1,rightVertex=-1;
 for(let i=0;i<attr.count;i++){
  if(attr.getX(i)<-.50&&leftVertex<0)leftVertex=i;
  if(attr.getX(i)>.50&&rightVertex<0)rightVertex=i;
 }
 assert.ok(leftVertex>=0&&rightVertex>=0);
 const initialLeft=new THREE.Vector3(),initialRight=new THREE.Vector3();
 cloth.getVertexPosition(leftVertex,initialLeft);
 cloth.getVertexPosition(rightVertex,initialRight);
 left.rotation.z=.5;
 body.updateWorldMatrix(true,true);
 const movedLeft=new THREE.Vector3(),movedRight=new THREE.Vector3();
 cloth.getVertexPosition(leftVertex,movedLeft);cloth.getVertexPosition(rightVertex,movedRight);
 assert.ok(movedLeft.distanceTo(initialLeft)>.02,'left sleeve must deform');
 assert.ok(movedRight.distanceTo(initialRight)<.015,'right sleeve must not be pulled by left shoulder');
});
test('rejects distant clothing without partially changing geometry or original mesh',async()=>{
 const {attachment,body,shirt}=avatarWithClothes({far:true});
 await assert.rejects(()=>transferClothingWeights(attachment,body,{maxDistance:.3,yieldControl:async()=>{}}),/Вес не найден/);
 assert.strictEqual(attachment.children[0],shirt);
 assert.ok(!shirt.geometry.getAttribute('skinWeight'));
});
test('clothing skin and shared skeleton survive GLB exporter/importer',async()=>{
 const {avatar,body,attachment}=avatarWithClothes();
 await transferClothingWeights(attachment,body,{maxDistance:.3,yieldControl:async()=>{}});
 avatar.updateWorldMatrix(true,true);
 const exported=await new Promise((yes,no)=>new GLTFExporter().parse(avatar,yes,no,{binary:true}));
 const gltf=await new Promise((yes,no)=>new GLTFLoader().parse(exported,'',yes,no));
 const meshes=[];gltf.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
 assert.equal(meshes.length,2);
 const cloth=meshes.find(m=>m.name.includes('Shirt'));
 assert.ok(cloth);
 assert.equal(cloth.geometry.attributes.skinIndex.itemSize,4);
 assert.equal(cloth.skeleton.bones.length,3);
 assert.equal(cloth.geometry.attributes.uv.itemSize,2);
});
test('Android UI has dedicated clothing controls, exact skin transfer, source selector, pose preview',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 for(const id of ['clothingSection','clothingTarget','weightSource','weightDistance','transferWeights','poseCheck','poseReset','weightStatus']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(main,/transferClothingWeights\(/);
 assert.match(main,/avatar\.attach\(p\.container\)/);
 assert.match(main,/readObjectTransform\(p\)/);
});
