import * as THREE from 'three';

// A collision/fit PROXY, not a replacement body and not a true volumetric SDF.
// Triangle sampling works even when a single scanned GLB consists of hundreds
// of disconnected geometry islands. Original body geometry is never modified.
export const CAGE_TRIANGLE_LIMIT=48_000;
const nextFrame=()=>new Promise(resolve=>typeof requestAnimationFrame==='function'
 ?requestAnimationFrame(resolve):setTimeout(resolve,0));
function validate(mesh){
 if(!mesh?.isMesh)throw new Error('Для оболочки выбери 3D-меш тела');
 const attr=mesh.geometry?.getAttribute('position');
 if(!attr||attr.itemSize!==3||attr.count<3)throw new Error('У тела нет корректных вершин');
 const index=mesh.geometry.index;
 const total=(index?.count||attr.count)/3;
 if(!Number.isInteger(total)||total<2)throw new Error('Повреждённая геометрия тела');
 return {attr,index,total};
}
/**
 * Low-memory surface sampling: input remains untouched, and at most 48k
 * triangles are collected into a compact static editor-only mesh. Because
 * scan models can be fragmented into thousands of islands, do not assume
 * their largest connected component is the body.
 */
export async function createBodyCage(mesh,{
 maxTriangles=CAGE_TRIANGLE_LIMIT,topFraction=.86,bottomFraction=0,
 batch=3000,onProgress=()=>{},yieldControl=nextFrame
}={}){
 if(!Number.isInteger(maxTriangles)||maxTriangles<12||maxTriangles>CAGE_TRIANGLE_LIMIT)
  throw new Error('Неправильный лимит треугольников Body Cage');
 if(!Number.isFinite(topFraction)||topFraction<.55||topFraction>1
  ||!Number.isFinite(bottomFraction)||bottomFraction<0||bottomFraction>=topFraction-.1)
  throw new Error('Неправильная высота оболочки тела');
 const {attr,index,total}=validate(mesh);
 mesh.updateWorldMatrix(true,false);
 const bbox=mesh.geometry.boundingBox?.clone()||new THREE.Box3().setFromBufferAttribute(attr);
 const height=bbox.max.y-bbox.min.y;
 if(height<.000001)throw new Error('Невозможно определить высоту тела');
 const minY=bbox.min.y+height*bottomFraction,maxY=bbox.min.y+height*topFraction;
 const sampleCount=Math.min(maxTriangles,total);
 const vertices=new Float32Array(sampleCount*9);
 let written=0;
 const scratch=new THREE.Vector3();
 for(let start=0;start<sampleCount;start+=batch){
  const end=Math.min(start+batch,sampleCount);
  for(let s=start;s<end;s++){
   // Stratified sampling spans all original triangle-index ranges and avoids
   // placing every sample in a single (often highly detailed) patch.
   const tri=Math.min(total-1,Math.floor((s+.5)*total/sampleCount));
   const ids=[
    index?index.getX(tri*3):tri*3,
    index?index.getX(tri*3+1):tri*3+1,
    index?index.getX(tri*3+2):tri*3+2
   ];
   if(ids.some(i=>i<0||i>=attr.count))throw new Error('Неверный индекс в геометрии тела');
   let averageY=0;
   for(let k=0;k<3;k++)averageY+=attr.getY(ids[k]);
   averageY/=3;
   if(averageY<minY||averageY>maxY)continue;
   const offset=written*9;
   for(let k=0;k<3;k++){
    scratch.fromBufferAttribute(attr,ids[k]);
    if(![scratch.x,scratch.y,scratch.z].every(Number.isFinite))
     throw new Error('В меше тела есть некорректные вершины');
    vertices[offset+k*3]=scratch.x;
    vertices[offset+k*3+1]=scratch.y;
    vertices[offset+k*3+2]=scratch.z;
   }
   written++;
  }
  onProgress(end,sampleCount);
  await yieldControl();
 }
 if(written<12)throw new Error('Недостаточно поверхности тела: выбери другой меш или увеличь высоту Body Cage');
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices.subarray(0,written*9),3));
 // The closest-surface BVH used by SmartFit needs indexed triangles.
 const indices=new Uint32Array(written*3);
 for(let i=0;i<indices.length;i++)indices[i]=i;
 geometry.setIndex(new THREE.BufferAttribute(indices,1));
 geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.computeVertexNormals();
 const material=new THREE.MeshBasicMaterial({
  color:0x35e8aa,transparent:true,opacity:.19,wireframe:true,
  side:THREE.DoubleSide,depthWrite:false
 });
 const cage=new THREE.Mesh(geometry,material);
 cage.name='PhoenixEditorBodyCage';
 cage.userData.editorOnly=true;
 cage.frustumCulled=false;
 // Kept OUTSIDE PhoenixAvatarRoot: never exported into a finished GLB.
 cage.matrixAutoUpdate=false;
 cage.matrix.copy(mesh.matrixWorld);
 cage.updateWorldMatrix(true,false);
 return {mesh:cage,source:mesh,originalTriangles:total,triangles:written,
  topFraction,bottomFraction,dispose(){
   cage.parent?.remove(cage);geometry.dispose();material.dispose();
  }};
}
