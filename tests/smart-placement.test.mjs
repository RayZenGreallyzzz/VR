import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {fitClothingByProfile} from '../src/smart-fit-placement.mjs';
import {smartDress} from '../src/smart-fit.mjs';
import {readFileSync} from 'node:fs';

const fast=async()=>{};
function character(arms='t'){
 const geometries=[];
 const put=(geo,x,y,z,angle=0)=>{
  const g=geo.clone();
  g.rotateZ(angle);g.translate(x,y,z);geometries.push(g);
 };
 put(new THREE.CylinderGeometry(.21,.175,1.0,24,14),0,1.15,0);
 put(new THREE.SphereGeometry(.165,18,10),0,1.9,0);
 for(const side of [-1,1]){
  put(new THREE.CylinderGeometry(.1,.12,.83,16,10),side*.12,.4,0);
  put(new THREE.CylinderGeometry(.075,.08,.8,12,8),side*.54,arms==='t'?1.57:1.23,0,side*(arms==='t'?Math.PI/2:.8));
 }
 const merged=mergeGeometries(geometries,true);
 const mesh=new THREE.Mesh(merged,new THREE.MeshStandardMaterial());mesh.name='Body';
 mesh.updateWorldMatrix(true,false);
 return mesh;
}
function createGarment(style){
 const root=new THREE.Group();root.name='Clothing';
 const mat=new THREE.MeshStandardMaterial({side:THREE.DoubleSide});
 const place=(geo,x,y,z)=>{
  const mesh=new THREE.Mesh(geo,mat);
  mesh.position.set(x,y,z);root.add(mesh);return mesh;
 };
 if(style==='top'){
  place(new THREE.CylinderGeometry(.235,.205,.67,22,12,true),0,.17,0);
  for(const side of [-1,1])
   place(new THREE.CylinderGeometry(.115,.115,.52,14,6,true),side*.40,.39,0).rotation.z=Math.PI/2;
 }else if(style==='dress'){
  place(new THREE.CylinderGeometry(.24,.39,1.12,28,24,true),0,-.1,0);
 }else if(style==='pants'){
  place(new THREE.CylinderGeometry(.25,.23,.20,24,4,true),0,-.11,0);
  for(const side of [-1,1])place(new THREE.CylinderGeometry(.115,.13,.73,18,14,true),side*.135,-.55,0);
 }else if(style==='skirt'){
  place(new THREE.CylinderGeometry(.20,.46,.55,28,10,true),0,-.31,0);
 }
 root.updateWorldMatrix(true,true);
 return root;
}
test('SmartFit accurately centers garments on T-posed and A-posed bodies, regardless of arm width',async()=>{
 for(const arms of ['t','a']){
  const body=character(arms),cage={mesh:body};
  for(const style of ['top','dress','skirt','pants']){
   const root=createGarment(style);
   root.position.set(4.5,-3.3,7.2);
   const beforeScale=root.scale.x;
   const result=await fitClothingByProfile(root,body,cage,{style,strength:0,yieldControl:fast});
   const bodyBox=new THREE.Box3().setFromObject(body);
   const gBox=new THREE.Box3().setFromObject(root);
   const bCenter=bodyBox.getCenter(new THREE.Vector3()),gCenter=gBox.getCenter(new THREE.Vector3());
   assert.ok(Math.abs(bCenter.x-gCenter.x)<1e-5,style+' X on '+arms);
   assert.ok(Math.abs(bCenter.z-gCenter.z)<1e-5,style+' Z on '+arms);
   const top=bodyBox.min.y+(bodyBox.max.y-bodyBox.min.y)*(style==='top'||style==='dress'?.82:.53);
   assert.ok(Math.abs(top-gBox.max.y)<1e-4,style+' top Y on '+arms+': '+gBox.max.y+' vs '+top);
   assert.ok(root.scale.x>0 && Math.abs(root.scale.x-beforeScale)>.001);
   assert.equal(result.vertices>0,true);
  }
 }
});
test('SmartFit torso estimate does not use full T-pose arm span as chest circumference',async()=>{
 const a=character('t'),b=character('a');
 const shirtA=createGarment('top'),shirtB=createGarment('top');
 const rA=await fitClothingByProfile(shirtA,a,{mesh:a},{style:'top',strength:0,yieldControl:fast});
 const rB=await fitClothingByProfile(shirtB,b,{mesh:b},{style:'top',strength:0,yieldControl:fast});
 assert.ok(Math.abs(rA.scaleRatio-rB.scaleRatio)<rB.scaleRatio*.15,
  'changing arm pose should not arbitrarily stretch the shirt torso');
});
test('SmartFit handles clothes originally nested under a chest bone without hidden screen offset',async()=>{
 const characterRoot=new THREE.Group(),body=character();
 characterRoot.add(body);
 const shoulder=new THREE.Group();shoulder.position.set(0,1.55,0);characterRoot.add(shoulder);
 const clothes=createGarment('top');shoulder.add(clothes);
 shoulder.updateWorldMatrix(true,true);
 characterRoot.attach(clothes);
 const result=await fitClothingByProfile(clothes,body,{mesh:body},{style:'top',strength:0,yieldControl:fast});
 const bounds=new THREE.Box3().setFromObject(clothes);
 const bodyBounds=new THREE.Box3().setFromObject(body);
 assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x-bodyBounds.getCenter(new THREE.Vector3()).x)<1e-5);
 assert.ok(result.scaleRatio>0);
});
test('SmartFit collision relaxation pushes only outward and does not collapse a loose skirt',async()=>{
 const body=character('t'),root=createGarment('dress'),original=[];
 root.traverse(o=>{if(o.isMesh)original.push(new Float32Array(o.geometry.attributes.position.array));});
 const result=await fitClothingByProfile(root,body,{mesh:body},{style:'dress',strength:.7,clearance:.018,yieldControl:fast});
 assert.ok(result.vertices>0);
 assert.equal(original.length,1);
 const verts=root.children[0].geometry.attributes.position;
 const transformedBox=new THREE.Box3().setFromObject(root);
 assert.ok(transformedBox.max.x-transformedBox.min.x>.3,'hem volume must remain');
 for(let i=0;i<verts.count;i++)assert.ok(Number.isFinite(verts.getX(i)));
});
test('Real one-click flow on unrigged character says correctly that skinning still remains',async()=>{
 const body=character('t'),cage={mesh:body},root=createGarment('top');
 const result=await smartDress(root,{body,cage,style:'top',strength:0,yieldControl:fast});
 assert.equal(result.stage,'fitted');
 assert.match(result.warning,/нет скелета/);
});
test('Manual UI preserves imported garment under avatar root (not chest bone)',()=>{
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(main,/if\(kind==='clothing'\)base.add\(container\)/);
 assert.match(main,/base.attach\(p.container\)/);
 assert.match(main,/anchor='root'/);
});

test('Quantized normalized GLB garment vertices are decoded to float32 before SmartFit writes geometry',async()=>{
 const body=character('t'),root=createGarment('dress'),mesh=root.children[0];
 const attr=mesh.geometry.getAttribute('position'),packed=new Uint16Array(attr.count*3);
 for(let i=0;i<attr.count;i++){
  packed[i*3]=Math.round((attr.getX(i)+1)/2*65535);
  packed[i*3+1]=Math.round((attr.getY(i)+1)/2*65535);
  packed[i*3+2]=Math.round((attr.getZ(i)+1)/2*65535);
 }
 mesh.geometry.setAttribute('position',new THREE.Uint16BufferAttribute(packed,3,true));
 mesh.position.add(new THREE.Vector3(-1,-1,-1));
 mesh.scale.multiplyScalar(2);
 root.updateWorldMatrix(true,true);
 const beforeUV=Float32Array.from(mesh.geometry.attributes.uv.array);
 const fitted=await fitClothingByProfile(root,body,{mesh:body},
  {style:'dress',strength:.25,yieldControl:fast});
 const updated=mesh.geometry.getAttribute('position');
 assert.ok(updated.array instanceof Float32Array,'must not round fractional coordinates to integers');
 assert.equal(updated.normalized,false);
 assert.deepEqual(mesh.geometry.attributes.uv.array,beforeUV);
 assert.ok(fitted.vertices>0);
 const box=new THREE.Box3().setFromObject(root);
 assert.ok(box.getSize(new THREE.Vector3()).x>.15);
});
