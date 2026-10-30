import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {limitAccessoryScale,parseScaleText,defaultAnchorPoint,MAX_WING_VERTICES,INTERACTIVE_WING_VERTICES} from '../src/placement-safety.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');

test('wing spans never grow beyond avatar-relative cap, even if 8x was requested',()=>{
 const r=limitAccessoryScale(8,10,2,'wings');
 assert.ok(r.limited);
 assert.equal(r.maxScale,.6);
 assert.equal(r.scale,.6);
 assert.equal(limitAccessoryScale(.3,10,2,'wings').scale,.3);
});
test('small accessories can be sized normally, invalid / infinite rejected',()=>{
 assert.equal(limitAccessoryScale(1,1,2,'hair').scale,1);
 assert.throws(()=>limitAccessoryScale(Infinity,2,2));
 assert.throws(()=>limitAccessoryScale(-1,2,2));
});
test('scale requires intentional numeric input, supports comma',()=>{
 assert.equal(parseScaleText('1,25'),1.25);
 assert.equal(parseScaleText('.5'),.5);
 for(const x of ['','-1','0','8evil','NaN','1e309'])assert.throws(()=>parseScaleText(x));
});
test('fallback back anchor is mid-body rather than at head height',()=>{
 const b={min:{x:-.3,y:0,z:-.1},max:{x:.3,y:2,z:.3}};
 const p=defaultAnchorPoint(b,'back');
 assert.equal(p.x,0);assert.ok(Math.abs(p.y-1.4)<1e-9);assert.ok(Math.abs(p.z-.1)<1e-9);
 assert.ok(defaultAnchorPoint(b,'head').y>defaultAnchorPoint(b,'back').y);
});
test('scale has no touch slider and only buttons / explicit Apply',()=>{
 assert.match(html,/id="pScale" type="text"/);
 assert.doesNotMatch(html,/id="pScale" type="range"/);
 for(const id of ['scaleApply','scaleMinus','scalePlus','scaleStatus'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(!main.includes("$('pScale').addEventListener('input'"));
 assert.match(main,/parseScaleText/);
});
test('wing deformation controls are locked by default and throttled',()=>{
 for(const id of ['wingBend','wingStretch','wingHinge']){
  assert.match(html,new RegExp('id="'+id+'"[^>]*disabled'));
 }
 assert.match(main,/lockWings\(\)/);
 const deformation=readFileSync(new URL('../src/wing-geometry.mjs',import.meta.url),'utf8');
 assert.match(deformation,/requestAnimationFrame/);
 assert.match(main,/deformWingGeometryAsync/);
 assert.ok(INTERACTIVE_WING_VERTICES<=100000);
 assert.ok(MAX_WING_VERTICES>=600000);
});
test('scale cannot change attachment anchor; missing back bone receives stable back locator',()=>{
 assert.match(main,/defaultAnchorPoint\(baseBoundingBox,anchor\)/);
 assert.match(main,/baseBoundingBox=avatarBox\.clone\(\)/);
 assert.ok(main.includes('const bone=selectAnchorBone(base,anchor)'));
 assert.ok(!main.includes('const bone=selectAnchorBone(base,\'head\')'));
});
