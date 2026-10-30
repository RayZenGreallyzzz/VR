import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Mobile-safe defaults. Keep the body mesh intact; sample its bind pose, not
// its currently animated pose. The attachment becomes a genuine SkinnedMesh.
export const MAX_BODY_TRIANGLES=240_000;
export const MAX_GARMENT_VERTICES=120_000;
export const MAX_GARMENT_MESHES=24;
const yieldFrame=()=>new Promise(resolve=>typeof requestAnimationFrame==='function'?requestAnimationFrame(()=>resolve()):setTimeout(resolve,0));

export function findWeightSources(root){
 const result=[];
 root?.traverse(o=>{
  if(o.isSkinnedMesh && o.skeleton?.bones?.length && o.geometry?.getAttribute('skinIndex') && o.geometry?.getAttribute('skinWeight')){
   result.push(o);
  }
 });
 return result;
}
export function clothingStatus(root,source){
 const clothing=[];
 root?.traverse(o=>{if(o.isMesh)clothing.push(o);});
 if(!source?.isSkinnedMesh||!source.skeleton?.bones.length)throw new Error('У персонажа нет выбранного SkinnedMesh с костями');
 if(!clothing.length)throw new Error('В выбранной одежде нет геометрии');
 if(clothing.some(x=>x.isSkinnedMesh))throw new Error('Одежда уже имеет скелет. Повторный перенос отключён');
 if(clothing.length>MAX_GARMENT_MESHES)throw new Error('Слишком много мешей в одной детали одежды');
 const garmentVertices=clothing.reduce((n,m)=>n+(m.geometry?.getAttribute('position')?.count||0),0);
 if(!garmentVertices||garmentVertices>MAX_GARMENT_VERTICES)throw new Error('Одежда превышает предел '+MAX_GARMENT_VERTICES.toLocaleString('ru-RU')+' вершин');
 const geo=source.geometry,triangles=(geo.index?.count||geo.getAttribute('position')?.count||0)/3;
 if(!geo.getAttribute('position')||!geo.getAttribute('skinIndex')||!geo.getAttribute('skinWeight')||triangles>MAX_BODY_TRIANGLES)
  throw new Error('Меш тела слишком сложен или не содержит весов');
 return {clothing,garmentVertices,bodyTriangles:triangles};
}
function surfaceSampler(body){
 const working=body.geometry.clone();
 // Transform bind-pose source vertices into world coordinates. Geometry and
 // skeleton inverses are left untouched; do NOT call skeleton.pose().
 working.applyMatrix4(body.bindMatrix);
 // BVH constructor may re-order the copied index. Its indices still refer
 // to original vertices and skin attributes; it never mutates body.geometry.
 const bvh=new MeshBVH(working,{maxLeafTris:12,strategy:0});
 const idx=working.index,pointAttr=working.getAttribute('position');
 if(!idx)throw new Error('Не удалось подготовить треугольники тела');
 const skinI=body.geometry.getAttribute('skinIndex'),skinW=body.geometry.getAttribute('skinWeight');
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 const bary=new THREE.Vector3(),best=new THREE.Vector3();
 const candidates=new Map();
 const hit={};
 function sample(worldPoint,maxDistance){
  const match=bvh.closestPointToPoint(worldPoint,hit,0,maxDistance);
  if(!match)return null;
  const face=match.faceIndex;
  const vertices=[idx.getX(face*3),idx.getX(face*3+1),idx.getX(face*3+2)];
  a.fromBufferAttribute(pointAttr,vertices[0]);
  b.fromBufferAttribute(pointAttr,vertices[1]);
  c.fromBufferAttribute(pointAttr,vertices[2]);
  best.copy(match.point);
  THREE.Triangle.getBarycoord(best,a,b,c,bary);
  if(![bary.x,bary.y,bary.z].every(Number.isFinite))return null;
  candidates.clear();
  const fractions=[bary.x,bary.y,bary.z];
  for(let j=0;j<3;j++){
   const v=vertices[j],factor=fractions[j];
   for(let k=0;k<4;k++){
    const weight=skinW.getComponent(v,k)*factor;
    if(weight<=0)continue;
    const bone=skinI.getComponent(v,k);
    if(bone<0||bone>=body.skeleton.bones.length)continue;
    candidates.set(bone,(candidates.get(bone)||0)+weight);
   }
  }
  const highest=[...candidates.entries()].sort((x,y)=>y[1]-x[1]).slice(0,4);
  const sum=highest.reduce((n,[,w])=>n+w,0);
  if(sum<1e-8)return null;
  return {indices:highest.map(([bone])=>bone),weights:highest.map(([,weight])=>weight/sum),distance:match.distance};
 }
 return {sample,dispose:()=>working.dispose()};
}

export async function transferClothingWeights(partRoot,body,{
 maxDistance=0.22,chunkSize=1500,onProgress=()=>{},yieldControl=yieldFrame
}={}){
 if(!Number.isFinite(maxDistance)||maxDistance<=0||maxDistance>5)throw new Error('Неправильное расстояние переноса весов');
 if(!Number.isInteger(chunkSize)||chunkSize<1||chunkSize>20000)throw new Error('Неправильный размер партии вершин');
 const {clothing,garmentVertices}=clothingStatus(partRoot,body);
 partRoot.updateWorldMatrix(true,true);
 body.updateWorldMatrix(true,true);
 const sampler=surfaceSampler(body),staged=[];
 let checked=0,far=0,maximumDistance=0;
 try{
  for(const mesh of clothing){
   const geo=mesh.geometry,attr=geo.getAttribute('position');
   if(!attr)throw new Error('Одежда имеет меш без вершин');
   const count=attr.count;
   const skinIndex=new Uint16Array(count*4),skinWeight=new Float32Array(count*4);
   const world=new THREE.Vector3();
   for(let start=0;start<count;start+=chunkSize){
    for(let i=start;i<Math.min(count,start+chunkSize);i++){
     world.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);
     const skin=sampler.sample(world,maxDistance);
     if(!skin){far++;continue;}
     maximumDistance=Math.max(maximumDistance,skin.distance);
     for(let j=0;j<skin.indices.length;j++){
      skinIndex[i*4+j]=skin.indices[j];
      skinWeight[i*4+j]=skin.weights[j];
     }
    }
    checked+=Math.min(count-start,chunkSize);
    onProgress(checked,garmentVertices);
    await yieldControl();
   }
   staged.push({mesh,skinIndex,skinWeight});
  }
  if(far>0)throw new Error('Вес не найден для '+far+' из '+garmentVertices+' вершин. Прижми одежду к телу или выбери другой меш тела / допуск.');
  // Full validation before scene mutation; no half-skinned items.
  const outputs=[];
  for(const {mesh,skinIndex,skinWeight} of staged){
   const geometry=mesh.geometry.clone();
   geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndex,4));
   geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeight,4));
   const skin=new THREE.SkinnedMesh(geometry,mesh.material);
   skin.name=mesh.name;skin.userData={...mesh.userData,weightTransfer:{source:body.name}};
   skin.position.copy(mesh.position);skin.quaternion.copy(mesh.quaternion);skin.scale.copy(mesh.scale);
   skin.visible=mesh.visible;skin.castShadow=mesh.castShadow;skin.receiveShadow=mesh.receiveShadow;
   skin.frustumCulled=false;skin.renderOrder=mesh.renderOrder;
   outputs.push({mesh,skin});
  }
  // Save world matrices. The part itself is reparented by the editor to
  // the avatar root BEFORE weights can animate, avoiding double movement.
  for(const {mesh,skin} of outputs){
   const parent=mesh.parent;
   parent.add(skin);
   skin.updateWorldMatrix(true,true);
   // Skeleton is shared; the body owns the bones and inverses.
   skin.bind(body.skeleton,skin.matrixWorld.clone());
   skin.bindMode=THREE.DetachedBindMode;
   parent.remove(mesh);
  }
  return {meshes:outputs.length,vertices:garmentVertices,maxDistance:maximumDistance};
 }finally{sampler.dispose();}
}
