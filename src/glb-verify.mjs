/** Inspect a generated binary GLB's JSON chunk without duplicating mesh/texture memory. */
export function inspectGLBBytes(data,requiredAttachmentIds=[],{requireEmbeddedPNG=false}={}){
 const bytes=data instanceof Uint8Array?data:data instanceof ArrayBuffer?new Uint8Array(data):null;
 if(!bytes||bytes.byteLength<20)throw new Error('GLB слишком короткий или неправильного типа');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(v.getUint32(0,true)!==0x46546c67)throw new Error('Неверный заголовок GLB');
 if(v.getUint32(4,true)!==2)throw new Error('Неподдерживаемая версия GLB');
 if(v.getUint32(8,true)!==bytes.byteLength)throw new Error('Неверный размер GLB');
 const len=v.getUint32(12,true);
 if(v.getUint32(16,true)!==0x4e4f534a||len>bytes.byteLength-20)
  throw new Error('В GLB отсутствует правильный блок JSON');
 let gltf;
 try{gltf=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+len)));}
 catch{throw new Error('Повреждён JSON в GLB');}
 if(gltf.asset?.version!=='2.0')throw new Error('Не поддерживается GLB asset');
 const ids=new Set();
 for(const node of gltf.nodes||[]){
  const id=node.extras?.avatarPart?.id;
  if(typeof id==='string')ids.add(id);
 }
 const missing=requiredAttachmentIds.filter(id=>!ids.has(id));
 const meshes=gltf.meshes?.length||0;
 if(meshes===0)throw new Error('В GLB нет ни одного меша');
 if(missing.length)throw new Error('GLB потерял детали: '+missing.join(', '));
 const images=gltf.images||[];
 const invalidImages=images.filter(im=>im.mimeType!=='image/png'||!Number.isInteger(im.bufferView));
 if(requireEmbeddedPNG&&invalidImages.length)
  throw new Error('В GLB остались невстроенные или несовместимые текстуры: '+invalidImages.map(im=>im.mimeType||'URI').join(', '));
 const badExtensions=(gltf.extensionsRequired||[]).filter(ext=>ext==='EXT_texture_webp');
 if(requireEmbeddedPNG&&badExtensions.length)
  throw new Error('GLB всё ещё требует EXT_texture_webp');
 return {meshes,attachments:ids.size,nodes:gltf.nodes?.length||0,bytes:bytes.byteLength,pngImages:images.length-invalidImages.length};
}
