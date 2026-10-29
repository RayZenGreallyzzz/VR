import {Capacitor,registerPlugin} from '@capacitor/core';
const NativeSave=registerPlugin('NativeSave');
function asBytes(data){return data instanceof Uint8Array?data:data instanceof ArrayBuffer?new Uint8Array(data):new TextEncoder().encode(String(data));}
function downloadWeb(bytes,name,mime){
 const url=URL.createObjectURL(new Blob([bytes],{type:mime}));
 const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function base64Chunk(chunk){
 let str='';
 // Small batches avoid argument length limits and large bridge allocations.
 for(let i=0;i<chunk.length;i+=8192) str+=String.fromCharCode(...chunk.subarray(i,i+8192));
 return btoa(str);
}
export async function saveOutput(data,name,mime='application/octet-stream',progress=()=>{}){
 const bytes=asBytes(data);
 if(Capacitor.isNativePlatform()){
  await NativeSave.createDocument({name,mime});
  try{
   const sliceSize=96*1024;
   for(let at=0;at<bytes.length;at+=sliceSize){
    const end=Math.min(bytes.length,at+sliceSize);
    await NativeSave.writeChunk({base64:base64Chunk(bytes.subarray(at,end))});
    progress(end,bytes.length);
   }
   await NativeSave.finishDocument();
   return 'android-document';
  }catch(e){
   await NativeSave.cancelDocument().catch(()=>{});
   throw e;
  }
 }
 if(typeof window.showSaveFilePicker==='function'){
  const handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:'3D model / data',accept:{[mime]:[name.substring(name.lastIndexOf('.'))]}}]});
  const file=await handle.createWritable();await file.write(bytes);await file.close();return 'file-picker';
 }
 downloadWeb(bytes,name,mime);return 'download';
}
