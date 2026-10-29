import test from 'node:test';
import assert from 'node:assert/strict';
import {bendWingPoint} from '../src/wing-bend.mjs';
const eq=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`Expected ${a} ≈ ${b}`);
test('unchanged neutral wings',()=>{const p=[.8,.2,-.1];assert.deepEqual(bendWingPoint(p),p)});
test('mirror left and right wing bend and preserve anchor strip',()=>{
 const opt={halfSpan:2,hingeFraction:.1,bendDegrees:90,stretch:1};
 const r=bendWingPoint([1.2,0,0],opt),l=bendWingPoint([-1.2,0,0],opt);
 eq(r[0],.2);eq(l[0],-.2);eq(r[2],1);eq(l[2],1);
 assert.deepEqual(bendWingPoint([.12,.4,.4],opt),[.12,.4,.4]);
});
test('stretched wings retain center and extend tips',()=>{
 const opt={halfSpan:2,bendDegrees:0,stretch:1.2,hingeFraction:0.1};
 eq(bendWingPoint([2,0,0],opt)[0],2.36);
 eq(bendWingPoint([-2,0,0],opt)[0],-2.36);
});
test('cannot deform with invalid geometry controls',()=>{
 assert.throws(()=>bendWingPoint([1,0,0],{halfSpan:0}));
 assert.throws(()=>bendWingPoint([1,0,0],{stretch:0}));
});
