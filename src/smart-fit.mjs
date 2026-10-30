import {autoFitClothing} from './clothing-fit.mjs';
import {findWeightSources,transferClothingWeights} from './clothing-weights.mjs';

/**
 * First usable SmartFit pipeline. A surface-fit cage is a collision guide;
 * it does not invent missing body skin, cloth physics, or skeleton bones.
 * On rigged bodies we try skin transfer; on ordinary Meshy/Tripo bodies
 * fitting completes but reports "requires rigging" explicitly.
 */
export async function smartDress(garmentRoot,{cage,body,style='dress',
 strength=.70,clearance=.012,maxWeightDistance=.30,
 yieldControl,onProgress=()=>{}
}={}){
 if(!cage?.mesh?.isMesh||!body?.isMesh)
  throw new Error('Сначала создай оболочку тела Body Cage');
 if(!['dress','top','skirt','pants'].includes(style))
  throw new Error('Выбери тип одежды');
 if(!garmentRoot?.isObject3D)
  throw new Error('Нужна импортированная одежда');
 const fit=await autoFitClothing(garmentRoot,cage.mesh,{
  style,strength,clearance,yieldControl,
  onProgress:(done,total)=>onProgress('fit',done,total)
 });
 const sources=findWeightSources(body);
 if(!sources.includes(body)){
  return {stage:'fitted',fit,weightTransfer:null,warning:'✅ Одежда подогнана. У тела пока нет скелета: чтобы одежда повторяла анимации, сперва создай риг персонажа.'};
 }
 try{
  const weightTransfer=await transferClothingWeights(garmentRoot,body,{
   maxDistance:maxWeightDistance,yieldControl,
   onProgress:(done,total)=>onProgress('weights',done,total)
  });
  return {stage:'skinned',fit,weightTransfer,warning:''};
 }catch(e){
  // Never pretend the model is ready to animate when only shape fit succeeds.
  return {stage:'fitted',fit,weightTransfer:null,warning:'⚠️ Форма одежды подогнана, но веса не перенесены: '+(e?.message||String(e))};
 }
}
