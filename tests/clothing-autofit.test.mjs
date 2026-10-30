import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {prepareFlare,applyFlare,getHemHandle,autoFitClothing,findFitSources} from '../src/clothing-fit.mjs';
import {readFileSync} from 'node:fs';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
if(!globalThis.FileReader)globalThis.FileReader=class{
 result=null;onloadend=null;onerror=null;
 readAsArrayBuffer(blob){blob.arrayBuffer().then(v=>{this.result=v;this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
 readAsDataURL(blob){blob.arrayBuffer().then(v=>{this.result='data:'+(blob.type||'application/octet-stream')+';base64,'+Buffer.from(v).toString('base64');this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}
};
const almost=(a,b,tol=1e-5)=>assert.ok(Math.abs(a-b)<tol,`${a} differs from ${b}`);
function dress(){
 const root=new THREE.Group();root.name='Attachment:Skirt';
 root.userData.avatarPart={id:'skirt-1',type:'clothing',anchor:'hips'};
 const material=new THREE.MeshStandardMaterial({color:0xff99ff});
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.25,.65,1.3,16,7),material);
 mesh.name='DressSkirt';mesh.position.y=1;root.add(mesh);
 root.updateWorldMatrix(true,true);
 return {root,mesh,material};
}
function body(){
 const geo=new THREE.CylinderGeometry(.28,.3,2,20,16);
 const b=new THREE.Mesh(geo,new THREE.MeshStandardMaterial());b.name='Body';
 b.position.y=1;
 b.updateWorldMatrix(true,true);
 return b;
}
test('flare expands hem outward without moving waist or altering UV attributes',()=>{
 const {root,mesh}=dress();
 const uv=Float32Array.from(mesh.geometry.attributes.uv.array);
 const mod=prepareFlare(root);
 const original=Float32Array.from(mesh.geometry.attributes.position.array);
 applyFlare(mod,1.8,.7);
 const attr=mesh.geometry.attributes.position;
 let changedBottom=false;
 for(let i=0;i<attr.count;i++){
  const y=original[i*3+1];
  if(y>.5)almost(attr.getX(i),original[i*3]);
  if(y<-.45 && Math.abs(attr.getX(i))>Math.abs(original[i*3])+.05)changedBottom=true;
 }
 assert.ok(changedBottom);
 assert.deepEqual(mesh.geometry.attributes.uv.array,uv);
 const first=Float32Array.from(attr.array);
 applyFlare(mod,1.8,.7);assert.deepEqual(attr.array,first,'Repeated edit does not drift');
 applyFlare(mod,1,.7);assert.deepEqual(attr.array,original,'Reset restores all vertices');
});
test('flare 3d handle moves with width and stays at bottom edge',()=>{
 const {root}=dress();const m=prepareFlare(root);
 const h1=getHemHandle(m,1),h2=getHemHandle(m,2);
 almost(h2.world.x-h2.center.x,2*(h1.world.x-h1.center.x));
 almost(h1.world.y,h2.world.y);
 assert.throws(()=>applyFlare(m,9),/Неправильная/);
});
test('auto fit centers garment on body, adjusts uniform size and saves geometry without altering UVs',async()=>{
 const {root,mesh}=dress(),b=body();
 root.position.set(1.5,0,-.6);root.scale.setScalar(.8);
 const uv=Float32Array.from(mesh.geometry.attributes.uv.array);
 const result=await autoFitClothing(root,b,{style:'dress',strength:.65,clearance:.016,yieldControl:async()=>{}});
 assert.ok(result.scaleRatio>=.55 && result.scaleRatio<=1.75);
 const bodyBox=new THREE.Box3().setFromObject(b);
 const garmentBox=new THREE.Box3().setFromObject(root);
 const bodyCenter=bodyBox.getCenter(new THREE.Vector3());
 const garmentCenter=garmentBox.getCenter(new THREE.Vector3());
 assert.ok(Math.abs(bodyCenter.x-garmentCenter.x)<.08);
 assert.ok(Math.abs(bodyCenter.z-garmentCenter.z)<.08);
 assert.deepEqual(mesh.geometry.attributes.uv.array,uv);
 assert.ok(result.vertices>100);
});
test('failed invalid fit never changes garment geometry or scale',async()=>{
 const {root,mesh}=dress();
 const original=Float32Array.from(mesh.geometry.attributes.position.array),scale=root.scale.x;
 await assert.rejects(()=>autoFitClothing(root,null,{strength:.6}),/меш тела/);
 assert.deepEqual(mesh.geometry.attributes.position.array,original);
 assert.equal(root.scale.x,scale);
});
test('baked skirt flare is preserved after GLB export and re-import',async()=>{
 const {root}=dress(),scene=new THREE.Group();scene.add(root);
 const mod=prepareFlare(root);applyFlare(mod,2,.7);
 const attr=root.children[0].geometry.attributes.position;
 let maxBefore=0;for(let i=0;i<attr.count;i++)maxBefore=Math.max(maxBefore,Math.abs(attr.getX(i)));
 const exported=await new Promise((ok,no)=>new GLTFExporter().parse(scene,ok,no,{binary:true}));
 const loaded=await new Promise((ok,no)=>new GLTFLoader().parse(exported,'',ok,no));
 let maxAfter=0;loaded.scene.traverse(o=>{
  if(!o.isMesh)return;
  const a=o.geometry.attributes.position;
  for(let i=0;i<a.count;i++)maxAfter=Math.max(maxAfter,Math.abs(a.getX(i)));
 });
 almost(maxBefore,maxAfter);
});
test('UI includes one-click body wrap, intentional hem expansion and 3D touch drag',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 for(const id of ['dressFitSection','fitBodySource','fitStyle','fitStrength','autoFitClothes','flareMinus','flarePlus','flareApply','flareValue','hemHandleToggle','flareReset','fitStatus']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(main,/autoFitClothing\(/);
 assert.match(main,/applyFlare\(/);
 assert.match(main,/canvas\.addEventListener\('pointerdown'/);
 assert.match(main,/canvas\.addEventListener\('pointermove'/);
 assert.match(main,/getHemHandle\(/);
});

test('auto-fit can choose body mesh without a skeleton and ignores imported attachments',()=>{
 const avatar=new THREE.Group(),bodyMesh=body(),accessory=dress().root;
 avatar.add(bodyMesh);avatar.add(accessory);
 const found=findFitSources(avatar);
 assert.equal(found.length,1);
 assert.strictEqual(found[0],bodyMesh);
});
