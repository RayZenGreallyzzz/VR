/**
 * Independent, testable avatar metadata and inspection helpers.
 * Does not claim Unity / VRChat SDK validation: that check belongs to Unity.
 */
export const PART_TYPES = Object.freeze(['hair', 'ears', 'horns', 'tail', 'wings', 'glasses', 'hat', 'accessory']);
export const ANCHORS = Object.freeze({
  head: [/^(head)$/i,/head$/i,/mixamorig:head/i],
  neck: [/^neck/i,/neck$/i],
  chest: [/chest/i,/spine2/i,/upperchest/i],
  hips: [/hips/i,/pelvis/i],
  back: [/chest/i,/spine2/i,/spine1/i]
});
export const PART_ANCHORS = Object.freeze({ hair:'head', ears:'head', horns:'head', glasses:'head', hat:'head', tail:'hips', wings:'back', accessory:'chest' });

export function selectAnchorBone(root, anchor='head') {
  if (!root?.traverse) return null;
  const bones=[];
  root.traverse(o => { if(o.isBone) bones.push(o); });
  const patterns=ANCHORS[anchor] || ANCHORS.head;
  for(const re of patterns) { const match=bones.find(b=>re.test(b.name)); if(match) return match; }
  return null;
}
export function inspectAvatar(root) {
  const result={ vertices:0, triangles:0, bones:0, meshes:0, skinnedMeshes:0, morphs:[], hasHead:false, hasHips:false, warnings:[] };
  if(!root?.traverse){result.warnings.push('Сначала импортируйте GLB');return result;}
  const morphs=new Set();
  root.traverse(o=>{
    if(o.isBone)result.bones++;
    if(o.isMesh){
      result.meshes++;
      if(o.isSkinnedMesh)result.skinnedMeshes++;
      const g=o.geometry;
      if(g){ const count=g.getAttribute?.('position')?.count||0;result.vertices+=count;result.triangles+=g.index?Math.floor(g.index.count/3):Math.floor(count/3); }
      for(const key of Object.keys(o.morphTargetDictionary||{})) morphs.add(key);
    }
  });
  result.morphs=[...morphs].sort();
  result.hasHead=!!selectAnchorBone(root,'head');
  result.hasHips=!!selectAnchorBone(root,'hips');
  if(!result.bones)result.warnings.push('Нет скелета: для гуманоидного VRChat-аватара нужен риг');
  if(result.bones&&!result.hasHead)result.warnings.push('Не найдена кость головы');
  if(result.bones&&!result.hasHips)result.warnings.push('Не найдена кость таза / Hips');
  if(!result.skinnedMeshes)result.warnings.push('Нет skinned mesh: проверьте привязку модели к костям');
  result.warnings.push('Проверка Humanoid, Eye View, PhysBones и лимитов VRChat выполняется в Unity');
  return result;
}
export function makePartConfig({id,type='accessory',name='Detail',anchor,position=[0,0,0],rotation=[0,0,0],scale=1,visible=true}){
  if(!PART_TYPES.includes(type))throw new Error('Unknown part type');
  return { id:String(id), type, name:String(name), anchor:anchor||PART_ANCHORS[type], position:position.map(Number), rotation:rotation.map(Number), scale:Number(scale), visible:Boolean(visible) };
}
export function assertPartTransform(part){
  if(part.position.length!==3||part.rotation.length!==3||![...part.position,...part.rotation,part.scale].every(Number.isFinite)) throw new Error('Invalid part transform');
  if(part.scale<=0||part.scale>50)throw new Error('Part scale outside safe range');
  return part;
}
export function exportProjectMetadata(parts, modelName=''){
  return {schema:'phoenix-vr-avatar-project',version:1,baseModelName:modelName,attachments:parts.map(p=>assertPartTransform(makePartConfig(p))),note:'Файл содержит настройки, но НЕ геометрию моделей. Сохраните исходные GLB отдельно.'};
}
