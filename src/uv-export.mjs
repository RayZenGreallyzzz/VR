import * as THREE from 'three';
import {EXPORTED_TEXTURE_SLOTS} from './texture-bake.mjs';

const epsilon=1e-6;
const approx=(a,b)=>Math.abs(a-b)<epsilon;
function texTransform(tex){
 return {u:tex.offset.x,v:tex.offset.y,
  sx:tex.repeat.x,sy:tex.repeat.y,
  rotation:tex.rotation,channel:tex.channel??0};
}
function same(a,b){
 return approx(a.u,b.u)&&approx(a.v,b.v)&&approx(a.sx,b.sx)&&approx(a.sy,b.sy)
  &&approx(a.rotation,b.rotation)&&a.channel===b.channel;
}
function neutral(t){
 return approx(t.u,0)&&approx(t.v,0)&&approx(t.sx,1)&&approx(t.sy,1)
  &&approx(t.rotation,0);
}
/**
 * Preserve high-frequency tiling (e.g. 16x tail material) without the optional
 * KHR_texture_transform extension, whenever one material consistently uses
 * a single UV0 transform. Full 16x tiling is represented by UV coordinates
 * outside 0..1 and the regular glTF REPEAT sampler — no 16x resolution loss.
 * Unsafe multi-material / rotated / mixed-channel cases retain the standard
 * KHR_texture_transform instead of corrupting the UV map.
 */
export async function withBakedUVTransforms(root,exportFn){
 if(typeof exportFn!=='function')throw new Error('Не задан экспорт GLB');
 const matMeshes=new Map(),texMaterials=new Map(),geoMeshes=new Map();
 root.traverse(mesh=>{
  if(!mesh.isMesh)return;
  geoMeshes.set(mesh.geometry,(geoMeshes.get(mesh.geometry)||0)+1);
  if(!mesh.material||Array.isArray(mesh.material))return;
  const mat=mesh.material;
  if(!matMeshes.has(mat))matMeshes.set(mat,[]);
  matMeshes.get(mat).push(mesh);
  for(const key of EXPORTED_TEXTURE_SLOTS)if(mat[key]?.isTexture){
   const tex=mat[key];
   if(!texMaterials.has(tex))texMaterials.set(tex,new Set());
   texMaterials.get(tex).add(mat);
  }
 });
 const planned=new Map();
 for(const [mat,meshes] of matMeshes){
  const textures=EXPORTED_TEXTURE_SLOTS.map(key=>mat[key]).filter(tex=>tex?.isTexture);
  if(!textures.length)continue;
  const t=texTransform(textures[0]);
  if(neutral(t)||t.channel!==0||!approx(t.rotation,0))continue;
  if(!textures.every(tex=>same(texTransform(tex),t)))continue;
  if(!meshes.every(mesh=>mesh.geometry?.getAttribute('uv')?.itemSize===2
   &&geoMeshes.get(mesh.geometry)===1))continue;
  planned.set(mat,{meshes,textures,t});
 }
 // If a texture is shared with a material that cannot bake its UV, leave
 // that texture alone in every material.
 for(const [mat,p] of [...planned]){
  if(p.textures.some(tex=>[...(texMaterials.get(tex)||[])].some(owner=>!planned.has(owner))))
   planned.delete(mat);
 }
 const originalUVs=[],originalTex=new Map();
 try{
  for(const {meshes,textures,t} of planned.values()){
   for(const mesh of meshes){
    const geo=mesh.geometry,uv=geo.getAttribute('uv');
    originalUVs.push({geo,uv});
    const baked=new Float32Array(uv.count*2);
    for(let i=0;i<uv.count;i++){
     baked[i*2]=uv.getX(i)*t.sx+t.u;
     baked[i*2+1]=uv.getY(i)*t.sy+t.v;
    }
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(baked,2));
   }
   for(const tex of textures){
    if(originalTex.has(tex))continue;
    originalTex.set(tex,texTransform(tex));
    tex.offset.set(0,0);tex.repeat.set(1,1);
    tex.rotation=0;tex.center.set(0,0);
    tex.updateMatrix();
   }
  }
  return await exportFn({uvBakedMaterials:planned.size});
 }finally{
  for(const {geo,uv} of originalUVs)geo.setAttribute('uv',uv);
  for(const [tex,t] of originalTex){
   tex.offset.set(t.u,t.v);tex.repeat.set(t.sx,t.sy);tex.rotation=t.rotation;
   tex.updateMatrix();
  }
 }
}
