import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {scanBodyFitZones,formatBodyFitReport} from '../src/fit-diagnostics.mjs';
import {readFileSync} from 'node:fs';

function avatarGeometry(){
 // Mimics a single dense GLB torso/legs mesh: y=0..2, with A/T-pose arms.
 const geo=new THREE.CylinderGeometry(.23,.17,2,36,90);
 geo.translate(0,1,0);
 return geo;
}
test('Body Fit Inspector extracts shoulder/chest/waist/hip/leg measurements without a skeleton',()=>{
 const body=new THREE.Mesh(avatarGeometry(),new THREE.MeshStandardMaterial());
 const result=scanBodyFitZones(body);
 assert.ok(result.height>1.95&&result.height<2.05);
 assert.ok(result.zones.chest.ok);
 assert.ok(result.zones.waist.ok);
 assert.ok(result.zones.hips.ok);
 assert.ok(result.zones.calves.ok);
 assert.ok(result.zones.chest.width>.2);
 assert.ok(result.zones.shoulders.width>.2);
 assert.match(formatBodyFitReport(result),/Грудь/);
 assert.equal(result.confidence,'high');
});
test('Wide T-pose attachment points do not drive estimated torso width',()=>{
 const base=avatarGeometry(),pos=base.getAttribute('position');
 const arr=Array.from(pos.array);
 // A few wide outlier vertices at shoulder height, simulating T-pose arms.
 arr.push(-2,1.5,0, 2,1.5,0, -2,1.55,0, 2,1.55,0);
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
 const body=new THREE.Mesh(geo,new THREE.MeshStandardMaterial());
 const report=scanBodyFitZones(body);
 assert.ok(report.zones.chest.width<.6,'must ignore 4m arm span');
 assert.ok(report.warnings.some(t=>t.includes('размах')));
});
test('GLB with no usable surfaces is reported as invalid, not marked as fitted',()=>{
 const group=new THREE.Group();
 assert.throws(()=>scanBodyFitZones(group),/3D-меш тела/);
 const degenerate=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial());
 degenerate.geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,0,0,0,0,0],3));
 assert.throws(()=>scanBodyFitZones(degenerate),/рост/);
});
test('Android SmartFit includes visible on-demand measurement preflight without new 3D engine',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 assert.match(html,/id="inspectBodyFit"/);
 assert.match(html,/id="fitZoneReport"/);
 assert.match(main,/scanBodyFitZones\(/);
 assert.match(main,/formatBodyFitReport\(/);
});
