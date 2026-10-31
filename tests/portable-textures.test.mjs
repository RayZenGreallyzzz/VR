import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {withPortablePNGTextures,convertTextureToPNG,EXPORTED_TEXTURE_SLOTS} from '../src/texture-bake.mjs';
import {withBakedUVTransforms} from '../src/uv-export.mjs';
import {inspectGLBBytes} from '../src/glb-verify.mjs';
import {readFileSync} from 'node:fs';

function scene(){
 const root=new THREE.Group();
 const geo=new THREE.BoxGeometry(1,1,.05);
 const material=new THREE.MeshStandardMaterial();
 const base=new THREE.Texture();
 base.image={width:2048,height:2048}; // Imported WebP-like image metadata
 base.flipY=false;base.repeat.set(16.0031662,16.0035496);
 base.offset.set(.000028,.000001013);
 base.wrapS=THREE.RepeatWrapping;base.wrapT=THREE.RepeatWrapping;
 base.userData={mimeType:'image/webp'};
 material.map=base;
 const normal=new THREE.Texture();normal.image={width:2048,height:2048};
 normal.repeat.copy(base.repeat);normal.offset.copy(base.offset);
 normal.flipY=false;normal.wrapS=base.wrapS;normal.wrapT=base.wrapT;
 material.normalMap=normal;
 const mesh=new THREE.Mesh(geo,material);root.add(mesh);
 return {root,mesh,material,base,normal};
}
function identityPng(original){
 const texture=new THREE.Texture();
 texture.image={width:1024,height:1024};
 texture.repeat.copy(original.repeat);texture.offset.copy(original.offset);
 texture.wrapS=original.wrapS;texture.wrapT=original.wrapT;
 texture.channel=original.channel;texture.flipY=original.flipY;
 return texture;
}
test('All material PBR slots are included for portable PNG export',()=>{
 for(const name of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap','clearcoatMap','transmissionMap','thicknessMap']){
  assert.ok(EXPORTED_TEXTURE_SLOTS.includes(name),name);
 }
});
test('UV bake preserves exact 16x tiling but removes KHR_texture_transform requirement',async()=>{
 const {root,mesh,base,normal}=scene();
 const originalUv=Float32Array.from(mesh.geometry.attributes.uv.array);
 const oldRepeat=base.repeat.clone(),oldOffset=base.offset.clone();
 let convertedCount=0;
 const result=await withBakedUVTransforms(root,async(meta)=>{
  assert.equal(meta.uvBakedMaterials,1);
  assert.equal(base.repeat.x,1);
  assert.equal(base.offset.x,0);
  const uv=mesh.geometry.attributes.uv;
  assert.ok(Math.abs(uv.getX(0)-originalUv[0]*oldRepeat.x-oldOffset.x)<1e-5);
  const result=await withPortablePNGTextures(root,async()=>{
   assert.notEqual(mesh.material.map,base);
   assert.notEqual(mesh.material.normalMap,normal);
   assert.equal(mesh.material.map.repeat.x,1);
   return 'GLB-exported';
  },{convert:async(t)=>{convertedCount++;return identityPng(t)},yieldControl:async()=>{}});
  return result;
 });
 assert.equal(result.result,'GLB-exported');
 assert.equal(convertedCount,2);
 assert.deepEqual(mesh.geometry.attributes.uv.array,originalUv);
 assert.strictEqual(mesh.material.map,base);
 assert.strictEqual(mesh.material.normalMap,normal);
 assert.ok(Math.abs(base.repeat.x-16.0031662)<1e-5);
 assert.deepEqual(base.offset.toArray(),oldOffset.toArray());
});
test('Global conversion keeps shared texture identity and restores editor state after export error',async()=>{
 const {root,material,base}=scene();
 material.emissiveMap=base;
 let count=0;
 await assert.rejects(()=>withPortablePNGTextures(root,async()=>{
  assert.strictEqual(material.map,material.emissiveMap);
  throw new Error('expected failed export');
 },{convert:async original=>{count++;return identityPng(original)},yieldControl:async()=>{}}),/expected failed export/);
 assert.equal(count,2);
 assert.strictEqual(material.map,base);
 assert.strictEqual(material.emissiveMap,base);
});
test('UV baking exception restores UV attributes and exact repeated texture transform',async()=>{
 const {root,mesh,base}=scene(),initial=mesh.geometry.getAttribute('uv');
 await assert.rejects(()=>withBakedUVTransforms(root,async()=>{throw new Error('cancel save')}),/cancel save/);
 assert.strictEqual(mesh.geometry.getAttribute('uv'),initial);
 assert.ok(Math.abs(base.repeat.x-16.0031662)<1e-5);
});
test('Mixed UV transforms never overwrite multi-map texture mapping',async()=>{
 const {root,mesh,base,normal}=scene();
 normal.repeat.set(2,2);
 const oldUV=mesh.geometry.getAttribute('uv');
 const result=await withBakedUVTransforms(root,async m=>{
  assert.equal(m.uvBakedMaterials,0);
  assert.strictEqual(mesh.geometry.getAttribute('uv'),oldUV);
  assert.equal(base.repeat.x,16.0031662);
  return true;
 });
 assert.equal(result,true);
});
test('PNG renderer downscales to selected maximum but copies UV tiling and flips',async()=>{
 const tex=new THREE.Texture();
 tex.image={width:4096,height:2048};tex.repeat.set(16,16);tex.offset.set(.03,.02);
 tex.colorSpace=THREE.SRGBColorSpace;tex.flipY=false;tex.userData={mimeType:'image/webp'};
 const canvas={width:0,height:0,getContext(){return {drawImage(...params){assert.ok(params.length===5)}}}};
 const converted=await convertTextureToPNG(tex,{maxSize:2048,canvasFactory:()=>canvas});
 assert.equal(converted.image.width,2048);
 assert.equal(converted.image.height,1024);
 assert.equal(converted.repeat.x,16);
 assert.equal(converted.offset.x,.03);
 assert.equal(converted.flipY,false);
 assert.equal(converted.colorSpace,THREE.SRGBColorSpace);
 assert.ok(!converted.userData.mimeType);
});
function makeGLB(j){
 const raw=new TextEncoder().encode(JSON.stringify(j));
 const len=(raw.length+3)&~3;
 const bytes=new Uint8Array(20+len);
 const v=new DataView(bytes.buffer);
 v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);
 v.setUint32(8,bytes.length,true);
 v.setUint32(12,len,true);v.setUint32(16,0x4e4f534a,true);
 bytes.set(raw,20);
 for(let i=20+raw.length;i<bytes.length;i++)bytes[i]=32;
 return bytes.buffer;
}
test('GLB export validator blocks WebP/extensions and nonembedded image URIs',()=>{
 const j={asset:{version:'2.0'},meshes:[{}],images:[{mimeType:'image/webp',bufferView:0}]};
 assert.throws(()=>inspectGLBBytes(makeGLB(j),[],{requireEmbeddedPNG:true}),/несовместимые/);
 j.images=[{mimeType:'image/png',bufferView:0}];
 assert.equal(inspectGLBBytes(makeGLB(j),[],{requireEmbeddedPNG:true}).pngImages,1);
 j.images=[{uri:'external.png'}];
 assert.throws(()=>inspectGLBBytes(makeGLB(j),[],{requireEmbeddedPNG:true}),/невстроенные/);
});
test('Universal texture bake UI covers all attachment types and both export routes',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(html,/id="exportTextureSize"/);
 assert.match(html,/id="exportTextureStatus"/);
 assert.match(main,/withPortablePNGTextures\(avatar/);
 assert.match(main,/withBakedUVTransforms\(avatar/);
 assert.match(main,/requireEmbeddedPNG:true/);
});
