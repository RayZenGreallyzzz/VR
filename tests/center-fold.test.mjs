import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {bendWingPoint} from '../src/wing-bend.mjs';
import {captureWingGeometry,deformWingGeometry,detectWingSpanAxis} from '../src/wing-geometry.mjs';
import {makePartConfig,exportProjectMetadata} from '../src/avatar-core.mjs';
import {readFileSync} from 'node:fs';
const near=(actual,expected,label)=>assert.ok(Math.abs(actual-expected)<1e-5,`${label}: got ${actual}, expected ${expected}`);
test('30 degree rear-facing center fold makes matching V wings in top-down view',()=>{
 const opts={centerX:0,halfSpan:2,hingeFraction:0,bendDegrees:30,direction:-1};
 const left=bendWingPoint([-2,0,0],opts);
 const right=bendWingPoint([2,0,0],opts);
 near(left[0],-Math.sqrt(3),'left X');near(right[0],Math.sqrt(3),'right X');
 near(left[2],-1,'left Z');near(right[2],-1,'right Z');
 near(bendWingPoint([0,0,0],opts)[2],0,'center remains attached');
 near(Math.hypot(right[0],right[2]),2,'original wing length remains');
});
test('user can reverse fold direction and preserve both halves',()=>{
 const values={centerX:0,halfSpan:2,hingeFraction:0,bendDegrees:25,direction:1};
 const left=bendWingPoint([-2,0,0],values);
 const right=bendWingPoint([2,0,0],values);
 assert.ok(left[2]>0);near(left[2],right[2],'mirror front fold');
});
test('central hinge can be shifted for asymmetric wing files',()=>{
 const opts={centerX:.4,halfSpan:2,hingeFraction:.1,bendDegrees:30,direction:-1};
 assert.deepEqual(bendWingPoint([.4,0,0],opts),[.4,0,0]);
 assert.deepEqual(bendWingPoint([.5,0,0],opts),[.5,0,0]);
 assert.ok(bendWingPoint([1.5,0,0],opts)[2]<0);
});
test('automatic span detection and explicit axis override work for vertical/nonstandard GLB',()=>{
 const group=new THREE.Group();
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,-2,0,0,0,0,0,2],3));
 const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial());group.add(mesh);
 const source=captureWingGeometry(group);
 assert.equal(detectWingSpanAxis(source),'z');
 assert.equal(detectWingSpanAxis(source,'x'),'x');
 deformWingGeometry(source,{wingSpanAxis:'auto',bendDegrees:30,wingFoldDirection:-1,hingeFraction:0});
 const array=mesh.geometry.attributes.position;
 assert.ok(array.getX(0)<-.85&&array.getX(0)>-1,'rear fold depth is curved smoothly');
 near(array.getX(0),array.getX(2),'left/right fold depth remains mirrored');
 near(array.getZ(0),-array.getZ(2),'left/right span remains mirrored');
 assert.ok(Math.abs(array.getZ(0))>Math.sqrt(3)&&Math.abs(array.getZ(0))<2,'wing tip sits on smooth arc');
});
test('fold orientation and hinge offset are saved in project metadata',()=>{
 const part=makePartConfig({id:'wing-1',type:'wings',wingSpanAxis:'z',wingCenterOffset:.2,wingFoldDirection:-1,bendDegrees:30});
 const config=exportProjectMetadata([part],'character.glb').attachments[0];
 assert.equal(config.wingSpanAxis,'z');
 assert.equal(config.wingCenterOffset,.2);
 assert.equal(config.wingFoldDirection,-1);
 assert.equal(config.bendDegrees,30);
});
test('Android UI offers one-tap 25 and 30 degree center fold and protected axis controls',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 for(const id of ['fold25','fold30','wingAxis','wingDirection','wingCenter','centerValue','wingUnlock']){
  assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 }
 assert.match(js,/\['fold25',25\]/);
 assert.match(js,/\['fold30',30\]/);
 assert.match(html,/id="wingCenter"[^>]*disabled/);
});
