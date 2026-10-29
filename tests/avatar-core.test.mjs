import test from 'node:test';
import assert from 'node:assert/strict';
import {selectAnchorBone,inspectAvatar,makePartConfig,exportProjectMetadata,assertPartTransform} from '../src/avatar-core.mjs';
const makeRoot=(bones=[],meshes=[])=>({traverse(fn){[...bones.map(name=>({isBone:true,name})),...meshes].forEach(fn)}});
test('detect human bone aliases',()=>{
 const r=makeRoot(['mixamorig:Hips','mixamorig:Spine','mixamorig:Head']);
 assert.equal(selectAnchorBone(r,'head')?.name,'mixamorig:Head');
 assert.equal(selectAnchorBone(r,'hips')?.name,'mixamorig:Hips');
});
test('report mesh and skinned state',()=>{
 const root=makeRoot(['Hips','Head'],[{isMesh:true,isSkinnedMesh:true,geometry:{getAttribute(){return {count:9}},index:{count:12}},morphTargetDictionary:{Smile:0}}]);
 const report=inspectAvatar(root);
 assert.equal(report.triangles,4);
 assert.equal(report.skinnedMeshes,1);
 assert.deepEqual(report.morphs,['Smile']);
 assert.equal(report.hasHead,true);
});
test('missing bones produce warnings',()=>{assert.ok(inspectAvatar(makeRoot()).warnings.some(s=>s.includes('скелет')))});
test('select correct default anchors',()=>{
 assert.equal(makePartConfig({id:'1',type:'hair'}).anchor,'head');
 assert.equal(makePartConfig({id:'2',type:'tail'}).anchor,'hips');
 assert.equal(makePartConfig({id:'3',type:'wings'}).anchor,'back');
});
test('invalid dimensions rejected',()=>{
 assert.throws(()=>assertPartTransform(makePartConfig({id:'x',scale:-1})));
 assert.throws(()=>assertPartTransform(makePartConfig({id:'x',position:[0,NaN,0]})));
});
test('project metadata has no binary payload',()=>{
 const meta=exportProjectMetadata([makePartConfig({id:'a',name:'hair.glb',type:'hair'})],'woman.glb');
 assert.equal(meta.baseModelName,'woman.glb');
 assert.equal(meta.attachments[0].anchor,'head');
 assert.equal(meta.schema,'phoenix-vr-avatar-project');
});
