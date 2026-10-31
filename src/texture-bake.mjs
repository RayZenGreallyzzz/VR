import * as THREE from 'three';

// Export compatibility pass for EVERY material in the avatar, not just tails.
// This embeds PNG images in GLB while retaining separate meshes, UVs,
// skeletons, PBR slots and animation tracks. It is not a UV atlas generator.
export const EXPORTED_TEXTURE_SLOTS=Object.freeze([
 'map','normalMap','metalnessMap','roughnessMap','aoMap','emissiveMap',
 'alphaMap','bumpMap','displacementMap','clearcoatMap','clearcoatNormalMap',
 'clearcoatRoughnessMap','sheenColorMap','sheenRoughnessMap',
 'specularColorMap','specularIntensityMap','transmissionMap','thicknessMap',
 'iridescenceMap','iridescenceThicknessMap','anisotropyMap','lightMap'
]);
const nextFrame=()=>new Promise(resolve=>typeof requestAnimationFrame==='function'
 ?requestAnimationFrame(resolve):setTimeout(resolve,0));
function makeCanvas(){
 if(typeof document==='undefined')throw new Error('Для запекания PNG требуется графический Canvas Android/Web');
 return document.createElement('canvas');
}
function textureImage(texture){
 return texture?.image || texture?.source?.data || null;
}
/**
 * Re-render the decoded original image into a portable PNG canvas source.
 * glTF exporter serializes a canvas as PNG (not EXT_texture_webp).
 * Texture.transform is preserved as KHR_texture_transform: no downsampled
 * 16x atlas and no damage to painted UVs.
 */
export async function convertTextureToPNG(texture,{maxSize=2048,canvasFactory=makeCanvas}={}){
 if(!texture?.isTexture)throw new Error('Некорректная текстура');
 if(!Number.isInteger(maxSize)||maxSize<128||maxSize>4096)
  throw new Error('Максимальный размер PNG должен быть от 128 до 4096');
 const image=textureImage(texture),w=image?.width,h=image?.height;
 if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<1||h<1)
  throw new Error('Не загружена исходная текстура материала');
 const factor=Math.min(1,maxSize/Math.max(w,h)),width=Math.max(1,Math.round(w*factor)),height=Math.max(1,Math.round(h*factor));
 const canvas=canvasFactory();canvas.width=width;canvas.height=height;
 const ctx=canvas.getContext?.('2d',{willReadFrequently:false});
 if(!ctx)throw new Error('Не удалось открыть Canvas для PNG');
 try{
  if(image.data&&ArrayBuffer.isView(image.data)){
   // Three.js DataTexture: support 8-bit RGBA or RGB. Avoid silently
   // misinterpreting half-float normal/roughness maps.
   if(!(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray))
    throw new Error('Нельзя запечь HDR/16-битную текстуру в PNG без преобразования цвета');
   const pixelCount=w*h,channels=image.data.length/pixelCount;
   if(channels!==3&&channels!==4)throw new Error('Неизвестный формат пикселей материала');
   const rgba=new Uint8ClampedArray(pixelCount*4);
   for(let i=0;i<pixelCount;i++){
    rgba[i*4]=image.data[i*channels];rgba[i*4+1]=image.data[i*channels+1];
    rgba[i*4+2]=image.data[i*channels+2];
    rgba[i*4+3]=channels===4?image.data[i*channels+3]:255;
   }
   const originalCanvas=canvasFactory();originalCanvas.width=w;originalCanvas.height=h;
   const originalCtx=originalCanvas.getContext('2d');
   originalCtx.putImageData(new ImageData(rgba,w,h),0,0);
   ctx.drawImage(originalCanvas,0,0,width,height);
   originalCanvas.width=0;originalCanvas.height=0;
  }else{
   ctx.drawImage(image,0,0,width,height);
  }
 }catch(e){
  canvas.width=0;canvas.height=0;
  throw new Error('Не удалось преобразовать текстуру в PNG: '+e.message);
 }
 const converted=new THREE.CanvasTexture(canvas);
 converted.name=texture.name||'Phoenix_PNG_Baked';
 converted.colorSpace=texture.colorSpace;
 converted.mapping=texture.mapping;
 converted.wrapS=texture.wrapS;converted.wrapT=texture.wrapT;
 converted.magFilter=texture.magFilter;converted.minFilter=texture.minFilter;
 converted.anisotropy=texture.anisotropy;
 converted.flipY=texture.flipY;
 converted.premultiplyAlpha=texture.premultiplyAlpha;
 converted.generateMipmaps=texture.generateMipmaps;
 converted.offset.copy(texture.offset);converted.repeat.copy(texture.repeat);
 converted.center.copy(texture.center);converted.rotation=texture.rotation;
 converted.channel=texture.channel;
 // Deliberately discard imported WebP-specific mimeType and extension hints.
 converted.userData={phoenixBake:'PNG'};
 converted.needsUpdate=true;
 return converted;
}
function allTextureSlots(root){
 const items=[],seenMaterials=new Set();
 root.traverse(obj=>{
  if(!obj.isMesh)return;
  const materials=Array.isArray(obj.material)?obj.material:[obj.material];
  for(const mat of materials){
   if(!mat||seenMaterials.has(mat))continue;
   seenMaterials.add(mat);
   for(const key of EXPORTED_TEXTURE_SLOTS)if(mat[key]?.isTexture)
    items.push({material:mat,key,original:mat[key]});
  }
 });
 return items;
}
/**
 * Temporarily swap PNG-backed textures only for the export call.
 * Always restore the live editor's original textures and memory after a
 * successful GLB save OR an exception/cancel.
 */
export async function withPortablePNGTextures(root,exportFn,{
 maxSize=2048,convert=convertTextureToPNG,onProgress=()=>{},yieldControl=nextFrame
}={}){
 if(typeof exportFn!=='function')throw new Error('Нет функции экспорта GLB');
 const slots=allTextureSlots(root),converted=new Map(),applied=[];
 try{
  for(let i=0;i<slots.length;i++){
   const slot=slots[i];
   let tex=converted.get(slot.original);
   if(!tex){
    tex=await convert(slot.original,{maxSize});
    if(!tex?.isTexture)throw new Error('Преобразование материала не вернуло PNG');
    converted.set(slot.original,tex);
   }
   slot.material[slot.key]=tex;
   slot.material.needsUpdate=true;
   applied.push(slot);
   onProgress(i+1,slots.length);
   if(i<slots.length-1)await yieldControl();
  }
  const result=await exportFn();
  return {result,convertedImages:converted.size,textureSlots:slots.length};
 }finally{
  for(const {material,key,original} of applied){
   material[key]=original;material.needsUpdate=true;
  }
  for(const tex of converted.values()){
   const canvas=textureImage(tex);
   tex.dispose();
   if(canvas&&'width' in canvas){canvas.width=0;canvas.height=0;}
  }
 }
}
