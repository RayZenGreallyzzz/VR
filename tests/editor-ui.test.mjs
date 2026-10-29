import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
test('all three translation and rotation axes have touch-friendly numeric inputs',()=>{
 for (const id of ['pX','pY','pZ','rX','rY','rZ']){
  assert.match(html,new RegExp('id="'+id+'" type="number"'));
  assert.match(html,new RegExp('data-adjust="'+id+'" data-delta="-'));
  assert.match(main,new RegExp("'"+id+"'"));
 }
});
test('toolbar has translation, rotation rings, ball, world/local and reset actions',()=>{
 for (const id of ['modeMove','modeRotate','modeBall','spaceMode','resetPosition','resetRotation','resetAll']){
  assert.ok(html.includes('id="'+id+'"'), 'Missing control '+id);
  assert.ok(main.includes("$('"+id+"').addEventListener"),'Missing handler '+id);
 }
 assert.match(main,/TransformControls/);
 assert.match(main,/transform\.setSpace\(coordinateSpace\)/);
 assert.match(main,/transform\.addEventListener\('objectChange'/);
});
test('gizmo is detached before base replacement and accessory deletion',()=>{
 assert.match(main,/transform\.detach\(\); orbit\.enabled=true;/);
 assert.match(main,/transform\.detach\(\);p\.container\.parent/);
});
test('old one-axis rotation slider is removed',()=>{
 assert.ok(!html.includes('id="pRot"'));
 assert.ok(!main.includes("$('pRot')"));
});
