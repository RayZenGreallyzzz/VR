import * as THREE from 'three';

/**
 * Mobile-safe topology guard for wing bends. Checks only a deterministic
 * spread of triangles (at most 2400 per mesh) so 600k-vertex GLBs remain
 * responsive on 4 GB devices. No mesh copy, UV edits, or allocations per face.
 *
 * Relative edge/area checks detect paper-crumple and collapsed faces;
 * nearly-degenerate source faces are skipped rather than giving false alarms.
 * This is a guardrail, not an exhaustive collision/self-intersection test.
 */
export const WING_QUALITY_SAMPLES=2400;
const EPS=1e-12;
const len=(dx,dy,dz)=>Math.hypot(dx,dy,dz);
const triangleSides=(pos,a,b,c)=>{
 const x0=pos.getX(a),y0=pos.getY(a),z0=pos.getZ(a);
 const x1=pos.getX(b),y1=pos.getY(b),z1=pos.getZ(b);
 const x2=pos.getX(c),y2=pos.getY(c),z2=pos.getZ(c);
 const e1=[x1-x0,y1-y0,z1-z0],e2=[x2-x0,y2-y0,z2-z0];
 const l01=len(...e1),l02=len(...e2),l12=len(x2-x1,y2-y1,z2-z1);
 const cross=new THREE.Vector3().set(...e1).cross(new THREE.Vector3().set(...e2));
 return {sides:[l01,l02,l12],area:cross.length()*.5};
};
const triVertices=(geo,tri)=>{
 const index=geo.index;
 return index?[index.getX(tri*3),index.getX(tri*3+1),index.getX(tri*3+2)]
  :[tri*3,tri*3+1,tri*3+2];
};
function originalAttribute(entry){
 return {
  count:entry.original.length/3,
  getX:i=>entry.original[i*3],
  getY:i=>entry.original[i*3+1],
  getZ:i=>entry.original[i*3+2]
 };
}
export function checkWingGeometryQuality(source,{
 sampleLimit=WING_QUALITY_SAMPLES,maxEdgeRatio=2.8,minEdgeRatio=.32,
 maxAreaRatio=3.25,minAreaRatio=.23
}={}){
 if(!source?.entries?.length)return {ok:false,reason:'Нет геометрии крыльев',checked:0,invalid:0};
 if(!Number.isInteger(sampleLimit)||sampleLimit<1||sampleLimit>10000)
  throw new Error('Некорректное число проверок крыльев');
 let checked=0,invalid=0,collapsed=0,stretched=0,nonFinite=0;
 let worstEdge=1,worstArea=1;
 for(const entry of source.entries){
  const geo=entry.mesh.geometry,now=geo.getAttribute('position');
  const pristine=originalAttribute(entry);
  if(now.count!==pristine.count)
   return {ok:false,reason:'Число вершин крыльев изменилось',checked,invalid:1};
  // Imported assets may contain a few trailing helper vertices/points.
  // Validate full triangles only; there is no surface to tear in a point pair.
  const numTriangles=Math.floor((geo.index?.count||now.count)/3);
  const step=Math.max(1,Math.ceil(numTriangles/sampleLimit));
  for(let tri=0;tri<numTriangles;tri+=step){
   const [a,b,c]=triVertices(geo,tri);
   if(Math.max(a,b,c)>=now.count)return {ok:false,reason:'Индекс крыла вне геометрии',checked,invalid:1};
   const orig=triangleSides(pristine,a,b,c);
   const cur=triangleSides(now,a,b,c);
   checked++;
   if(!Number.isFinite(cur.area)||cur.sides.some(x=>!Number.isFinite(x))){
    invalid++;nonFinite++;continue;
   }
   // Invalid source microtriangles are not evidence of damage by bending.
   if(orig.area<EPS||Math.min(...orig.sides)<1e-8)continue;
   const areaRatio=cur.area/orig.area;
   const ratios=cur.sides.map((s,i)=>s/orig.sides[i]);
   const maxE=Math.max(...ratios),minE=Math.min(...ratios);
   worstArea=Math.max(worstArea,areaRatio,1/Math.max(areaRatio,EPS));
   worstEdge=Math.max(worstEdge,maxE,1/Math.max(minE,EPS));
   if(areaRatio<minAreaRatio||areaRatio>maxAreaRatio||
      minE<minEdgeRatio||maxE>maxEdgeRatio){
    invalid++;
    if(areaRatio<minAreaRatio||minE<minEdgeRatio)collapsed++;
    else stretched++;
   }
  }
 }
 return {ok:invalid===0,checked,invalid,collapsed,stretched,nonFinite,worstEdge,worstArea,
  reason:invalid?('Сгиб повреждает '+invalid+' из '+checked+' проверенных треугольников (сжатие: '+collapsed+', растяжение: '+stretched+'). Исходная форма восстановлена. Попробуй другой угол/ось или режим костей.'):'Геометрия проверена'};
}
export function restoreWingGeometry(source){
 if(!source)return;
 for(const entry of source.entries){
  const a=entry.mesh.geometry?.getAttribute('position');
  if(!a||a.count*3!==entry.original.length)continue;
  a.array.set(entry.original);
  a.needsUpdate=true;
  entry.mesh.geometry.computeVertexNormals();
  entry.mesh.geometry.computeBoundingBox();
  entry.mesh.geometry.computeBoundingSphere();
  // Tangents for normal maps are derived again at the next successful bake.
  entry.mesh.geometry.deleteAttribute('tangent');
 }
}
