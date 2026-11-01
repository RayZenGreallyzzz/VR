import * as THREE from 'three';

/**
 * Preflight measurements for arbitrary humanoid GLBs. No skeleton or
 * decimation is required, and only a bounded vertex sample is inspected.
 * Measurements are a diagnostic, NOT an inferred collision-free body mesh.
 * The torso window ignores extended T-pose arms where possible.
 */
const ZONES=Object.freeze([
 {key:'shoulders',label:'Плечи',from:.70,to:.79,radius:.22},
 {key:'chest',label:'Грудь',from:.58,to:.70,radius:.16},
 {key:'waist',label:'Талия',from:.48,to:.58,radius:.155},
 {key:'hips',label:'Бёдра',from:.38,to:.50,radius:.20},
 {key:'upperLegs',label:'Верх ног',from:.24,to:.39,radius:.22},
 {key:'calves',label:'Голени',from:.08,to:.23,radius:.19}
]);
function percentile(list,q){
 if(list.length===0)return null;
 list.sort((a,b)=>a-b);
 return list[Math.min(list.length-1,Math.floor(q*(list.length-1)))];
}
export function scanBodyFitZones(mesh,{maxVertices=24000}={}){
 if(!mesh?.isMesh||!mesh.geometry?.getAttribute('position'))
  throw new Error('Выбери 3D-меш тела для диагностики SmartFit');
 if(!Number.isInteger(maxVertices)||maxVertices<100||maxVertices>100000)
  throw new Error('Неверный лимит диагностики');
 mesh.updateWorldMatrix(true,false);
 const box=new THREE.Box3().setFromObject(mesh);
 const height=box.max.y-box.min.y;
 if(!(height>.05)||!Number.isFinite(height))
  throw new Error('Не удалось определить рост: проверь масштаб модели и ось Y');
 const midX=(box.min.x+box.max.x)/2,midZ=(box.min.z+box.max.z)/2;
 const lists=ZONES.map(()=>({horizontal:[],depth:[]}));
 const attr=mesh.geometry.getAttribute('position'),step=Math.max(1,Math.ceil(attr.count/maxVertices));
 const v=new THREE.Vector3();
 let checked=0;
 for(let i=0;i<attr.count;i+=step){
  v.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);
  if(![v.x,v.y,v.z].every(Number.isFinite))continue;
  checked++;
  const q=(v.y-box.min.y)/height;
  for(let j=0;j<ZONES.length;j++){
   const spec=ZONES[j];
   if(q<spec.from||q>spec.to||Math.abs(v.x-midX)>height*spec.radius)continue;
   lists[j].horizontal.push(Math.abs(v.x-midX));
   lists[j].depth.push(Math.abs(v.z-midZ));
  }
 }
 const zones={};
 let missing=0;
 for(let j=0;j<ZONES.length;j++){
  const z=ZONES[j],list=lists[j],samples=list.horizontal.length;
  if(samples<8)missing++;
  zones[z.key]={label:z.label,samples,ok:samples>=8,
   width:samples>=8?percentile(list.horizontal,.90)*2:null,
   depth:samples>=8?percentile(list.depth,.90)*2:null,
   y:box.min.y+height*(z.from+z.to)*.5};
 }
 const warnings=[];
 if(missing>1)warnings.push('Не удалось измерить '+missing+' зоны: в GLB могут быть волосы, броня, неверная ось или раздельные меши.');
 if((box.max.x-box.min.x)>height*2.5)warnings.push('Очень большой размах по X: возможно, крылья или аксессуар включены в основной меш.');
 if((box.max.z-box.min.z)>height*1.8)warnings.push('Необычно большая глубина: возможен хвост или дополнительные детали.');
 if(checked<100)warnings.push('Слишком мало вершин для надёжного измерения фигуры.');
 if(zones.chest.width&&zones.hips.width&&zones.chest.width/zones.hips.width>2)
  warnings.push('Ширина груди вдвое больше бёдер: проверь выбранный меш и Т-позу.');
 return {height,sampledVertices:checked,zones,warnings,
  confidence:missing>2?'low':missing>0?'medium':'high'};
}
export function formatBodyFitReport(report){
 const fmt=n=>Number.isFinite(n)?n.toFixed(3):'—';
 const zoneLines=Object.values(report.zones).map(z=>
  z.label+': '+(z.ok?fmt(z.width)+' × '+fmt(z.depth)+' м':'не удалось определить'));
 return '📐 Измерения фигуры · рост '+fmt(report.height)+' м\n'+
  zoneLines.join('\n')+'\n'+
  (report.warnings.length?'⚠️ '+report.warnings.join(' '):'✅ Основные зоны распознаны.')+
  '\nЭто предварительные размеры, не полноценный Body Cage 2.0.';
}
