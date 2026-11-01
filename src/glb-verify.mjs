/**
 * A fast, low-memory GLB structural inspection for Android export. This reads
 * the JSON chunk and a few BIN signatures without decoding mesh arrays
 * (a 100 MB avatar must not be loaded into memory a second time).
 */
const PNG=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
const isInt=n=>Number.isSafeInteger(n)&&n>=0;
function parseGLB(data){
 const bytes=data instanceof Uint8Array?data:data instanceof ArrayBuffer?new Uint8Array(data):null;
 if(!bytes||bytes.byteLength<20)throw new Error('GLB слишком короткий или неправильного типа');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(0,true)!==0x46546c67)throw new Error('Неверный заголовок GLB');
 if(view.getUint32(4,true)!==2)throw new Error('Неподдерживаемая версия GLB');
 if(view.getUint32(8,true)!==bytes.byteLength)throw new Error('Неверный размер GLB');
 const jsonLen=view.getUint32(12,true);
 if(view.getUint32(16,true)!==0x4e4f534a||jsonLen>bytes.byteLength-20||jsonLen%4!==0)
  throw new Error('В GLB отсутствует правильный блок JSON');
 let json;
 try{json=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+jsonLen)));}
 catch{throw new Error('Повреждён JSON в GLB');}
 if(json.asset?.version!=='2.0')throw new Error('Не поддерживается GLB asset');
 const next=20+jsonLen;
 let binaryStart=null,binarySize=0;
 if(bytes.byteLength>next){
  if(bytes.byteLength-next<8)throw new Error('Обрезан бинарный блок GLB');
  binarySize=view.getUint32(next,true);
  if(view.getUint32(next+4,true)!==0x004e4942||next+8+binarySize!==bytes.byteLength)
   throw new Error('Неверная длина бинарного блока GLB');
  binaryStart=next+8;
 }
 return {bytes,json,binaryStart,binarySize};
}
function hasDescendantMesh(nodes,nodeId,seen=new Set()){
 if(seen.has(nodeId))return false;
 seen.add(nodeId);
 const node=nodes[nodeId];
 if(!node)return false;
 if(isInt(node.mesh))return true;
 for(const id of node.children||[])if(hasDescendantMesh(nodes,id,seen))return true;
 return false;
}
function ensurePNGBytes(decoded){
 const {bytes,json,binaryStart,binarySize}=decoded;
 for(let i=0;i<(json.images||[]).length;i++){
  const image=json.images[i],view=json.bufferViews?.[image.bufferView];
  if(!view||!isInt(view.byteOffset||0)||!isInt(view.byteLength)||
     binaryStart===null||view.buffer!==0||((view.byteOffset||0)+view.byteLength)>binarySize)
   throw new Error('PNG '+(i+1)+' имеет повреждённый или отсутствующий BIN bufferView');
  const at=binaryStart+(view.byteOffset||0);
  if(view.byteLength<8||PNG.some((v,j)=>bytes[at+j]!==v))
   throw new Error('Текстура '+(i+1)+' не содержит настоящий заголовок PNG');
 }
}
export function inspectGLBBytes(data,requiredAttachmentIds=[],{
 requireEmbeddedPNG=false,verifyPNGData=false,requireRenderableAttachments=false
}={}){
 const decoded=parseGLB(data);
 const {json:gltf,bytes}=decoded;
 const ids=new Set(),meshIds=new Map();
 const nodes=gltf.nodes||[];
 for(let i=0;i<nodes.length;i++){
  const node=nodes[i],id=node.extras?.avatarPart?.id;
  if(typeof id==='string'){
   ids.add(id);
   if(!meshIds.has(id))meshIds.set(id,new Set());
   meshIds.get(id).add(i);
  }
 }
 const missing=requiredAttachmentIds.filter(id=>!ids.has(id));
 const meshes=gltf.meshes?.length||0;
 if(!meshes)throw new Error('В GLB нет ни одного меша');
 if(missing.length)throw new Error('GLB потерял детали: '+missing.join(', '));
 const empty=requiredAttachmentIds.filter(id=>{
  const matches=meshIds.get(id)||new Set();
  return ![...matches].some(i=>hasDescendantMesh(nodes,i));
 });
 if(requireRenderableAttachments&&empty.length)
  throw new Error('В GLB сохранились пустые детали без геометрии: '+empty.join(', '));
 if(requireRenderableAttachments)for(let i=0;i<meshes;i++){
  const mesh=gltf.meshes[i];
  if(!mesh.primitives?.length||mesh.primitives.some(p=>!isInt(p.attributes?.POSITION)||
    p.attributes.POSITION>=(gltf.accessors?.length||0)))
   throw new Error('Некорректная геометрия меша '+(mesh.name||i));
 }
 for(const [i,skin] of (gltf.skins||[]).entries()){
  if(!skin.joints?.length||skin.joints.some(j=>!isInt(j)||j>=nodes.length))
   throw new Error('Повреждённые кости скина '+i);
 }
 for(const [i,animation] of (gltf.animations||[]).entries()){
  if(!Array.isArray(animation.channels)||!Array.isArray(animation.samplers)||
   animation.channels.some(ch=>!isInt(ch.sampler)||ch.sampler>=animation.samplers.length||
    (ch.target?.node!==undefined&&(!isInt(ch.target.node)||ch.target.node>=nodes.length))))
   throw new Error('Повреждённая анимация '+i);
 }
 const images=gltf.images||[];
 const invalidImages=images.filter(im=>im.mimeType!=='image/png'||!isInt(im.bufferView));
 if(requireEmbeddedPNG&&invalidImages.length)
  throw new Error('В GLB остались невстроенные или несовместимые текстуры: '+invalidImages.map(im=>im.mimeType||'URI').join(', '));
 if(requireEmbeddedPNG&&(gltf.extensionsRequired||[]).includes('EXT_texture_webp'))
  throw new Error('GLB всё ещё требует EXT_texture_webp');
 if(verifyPNGData&&images.length)ensurePNGBytes(decoded);
 return {meshes,attachments:ids.size,nodes:nodes.length,bytes:bytes.byteLength,
  pngImages:images.length-invalidImages.length,skins:gltf.skins?.length||0,
  animations:gltf.animations?.length||0,emptyAttachments:empty};
}
