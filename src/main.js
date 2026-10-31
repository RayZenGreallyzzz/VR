import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {selectAnchorBone, inspectAvatar, PART_ANCHORS, makePartConfig, exportProjectMetadata} from './avatar-core.mjs';
import {captureWingGeometry,deformWingGeometry,deformWingGeometryAsync,detectWingSpanAxis} from './wing-geometry.mjs';
import {saveOutput} from './save-output.mjs';
import {inspectGLBBytes} from './glb-verify.mjs';
import {createWingBoneRig,makeWingFlapClip,poseWingRig} from './wing-rig.mjs';
import {createTailRig,makeTailWagClip,poseTailRig} from './tail-rig.mjs';
import {serializeProject,readEmbeddedProject,TransformHistory} from './project-state.mjs';
import {findWeightSources,transferClothingWeights,clothingStatus,MAX_GARMENT_VERTICES} from './clothing-weights.mjs';
import {prepareFlare,applyFlare,getHemHandle,autoFitClothing,findFitSources} from './clothing-fit.mjs';
import {createBodyCage} from './body-cage.mjs';
import {smartDress as runSmartDress} from './smart-fit.mjs';
import {limitAccessoryScale,parseScaleText,defaultAnchorPoint,MAX_WING_VERTICES,INTERACTIVE_WING_VERTICES} from './placement-safety.mjs';

const $ = id => document.getElementById(id);
const canvas=$('canvas');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,/Android|iPhone|iPad/i.test(navigator.userAgent)?1:1.5));
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(40,1,.02,500);
camera.position.set(0,1.45,4.5);
const orbit=new OrbitControls(camera,canvas);
orbit.enableDamping=true; orbit.target.set(0,1,0);
scene.add(new THREE.HemisphereLight(0xffffff,0x535372,2.6));
const key=new THREE.DirectionalLight(0xffd7b0,2.6);key.position.set(3,6,4);scene.add(key);
const rim=new THREE.DirectionalLight(0xb1a5ff,2);rim.position.set(-4,3,-2);scene.add(rim);
const grid=new THREE.GridHelper(12,24,0x57586a,0x2e3342);grid.position.y=-.012;scene.add(grid);
const loader=new GLTFLoader();
const avatar=new THREE.Group();avatar.name='PhoenixAvatarRoot';scene.add(avatar);
let base=null,modelName='',clips=[],parts=[],selection=null,serial=0,avatarHeight=1,baseBoundingBox=null;
let bodyCage=null,smartBusy=false;
function releaseBodyCage(){
 if(bodyCage){bodyCage.dispose();bodyCage=null;}
}
let wingMixer=new THREE.AnimationMixer(avatar);
const hemHandle=new THREE.Mesh(
 new THREE.SphereGeometry(1,16,12),
 new THREE.MeshBasicMaterial({color:0xffc430,depthTest:false,transparent:true,opacity:.95})
);
hemHandle.name='EditorHemDragHandle';hemHandle.renderOrder=9999;hemHandle.visible=false;scene.add(hemHandle);
const hemRay=new THREE.Raycaster(),hemPointer=new THREE.Vector2(),hemPlane=new THREE.Plane(),hemPoint=new THREE.Vector3();
let hemEditEnabled=false,hemDrag=null;
function canEditHem(p){
 return p?.config.type==='clothing'&&!p?.clothingWeighted&&!p?.container?.getObjectByProperty('isSkinnedMesh',true);
}
function ensureHem(p){
 if(!canEditHem(p))return null;
 if(!p.flareModifier)p.flareModifier=prepareFlare(p.container);
 return p.flareModifier;
}
function updateHemHandle(){
 const p=selected();
 const ok=hemEditEnabled&&canEditHem(p)&&p?.flareModifier;
 hemHandle.visible=!!ok;
 if(ok){
  const handle=getHemHandle(p.flareModifier,p.config.hemFlare||1);
  hemHandle.position.copy(handle.world);
  hemHandle.scale.setScalar(Math.max(.03,avatarHeight*.055));
 }
}
function changeHem(factor,record=true){
 const p=selected();if(!canEditHem(p))return;
 const mod=ensureHem(p);
 const value=THREE.MathUtils.clamp(factor,.7,3);
 applyFlare(mod,value,p.config.hemStart||.7);
 p.config.hemFlare=value;
 $('flareValue').value=String(Math.round(value*100)/100);
 updateHemHandle();
 if(record)recordEdit();
}
function hemPointerCoordinates(e){
 const rect=canvas.getBoundingClientRect();
 hemPointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
 hemRay.setFromCamera(hemPointer,camera);
}
canvas.addEventListener('pointerdown',e=>{
 const p=selected();if(!hemEditEnabled||!canEditHem(p))return;
 const mod=ensureHem(p);hemPointerCoordinates(e);
 let startPoint=null;
 const ballHit=hemRay.intersectObject(hemHandle,false);
 if(ballHit.length)startPoint=ballHit[0].point.clone();
 else {
  const meshes=[];p.container.traverse(o=>{if(o.isMesh)meshes.push(o);});
  const hits=hemRay.intersectObjects(meshes,false);
  if(hits.length){
   const local=mod.root.worldToLocal(hits[0].point.clone());
   const height=mod.max.y-mod.min.y;
   if(local.y<mod.min.y+height*.18)startPoint=hits[0].point.clone();
  }
 }
 if(!startPoint)return;
 e.preventDefault();e.stopImmediatePropagation();
 const center=getHemHandle(mod,p.config.hemFlare||1).center;
 hemPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0,1,0),startPoint);
 hemDrag={id:e.pointerId,part:p,startX:e.clientX,startY:e.clientY,
  base:p.config.hemFlare||1,
  radius:Math.max(.001,getHemHandle(mod,1).radius),
  center,originRadius:new THREE.Vector2(startPoint.x-center.x,startPoint.z-center.z).length()};
 orbit.enabled=false;
 canvas.setPointerCapture?.(e.pointerId);
},true);
canvas.addEventListener('pointermove',e=>{
 if(!hemDrag||e.pointerId!==hemDrag.id)return;
 e.preventDefault();e.stopImmediatePropagation();
 hemPointerCoordinates(e);
 let delta=(e.clientX-hemDrag.startX)*.006;
 if(hemRay.ray.intersectPlane(hemPlane,hemPoint)){
  const dist=new THREE.Vector2(hemPoint.x-hemDrag.center.x,hemPoint.z-hemDrag.center.z).length();
  delta=(dist-hemDrag.originRadius)/hemDrag.radius;
 }
 selection=hemDrag.part.id;
 changeHem(hemDrag.base+delta,false);
},true);
function endHemDrag(e){
 if(!hemDrag||e.pointerId!==hemDrag.id)return;
 e.preventDefault();e.stopImmediatePropagation();
 orbit.enabled=true;
 canvas.releasePointerCapture?.(e.pointerId);
 hemDrag=null;recordEdit();
}
canvas.addEventListener('pointerup',endHemDrag,true);
canvas.addEventListener('pointercancel',endHemDrag,true);

const history=new TransformHistory(80);
let historyApplying=false;
function snapshot(){return parts.map(p=>({id:p.id,config:structuredClone(p.config)}));}
function recordEdit(){if(historyApplying)return;history.record(snapshot());updateHistoryButtons();}
function updateHistoryButtons(){$('undoEdit').disabled=!history.canUndo;$('redoEdit').disabled=!history.canRedo;}
async function applySnapshot(state){
 historyApplying=true;
 try{
  for(const data of state){const p=parts.find(x=>x.id===data.id);if(!p)continue;
   p.config=structuredClone(data.config);placePart(p);
   if(p.flareModifier&&canEditHem(p))applyFlare(p.flareModifier,p.config.hemFlare||1,p.config.hemStart||.7);
   if(p.wingSource&&!p.wingRig)await queueWingDeformation(p);
  }
  renderParts();
 }finally{historyApplying=false;updateHistoryButtons();}
}
$('undoEdit').addEventListener('click',async()=>{const state=history.undo();if(state)await applySnapshot(state);});
$('redoEdit').addEventListener('click',async()=>{const state=history.redo();if(state)await applySnapshot(state);});

const transform=new TransformControls(camera,renderer.domElement);
transform.setMode('translate');
transform.setSpace('local');
transform.setSize(1.15);
scene.add(transform.getHelper());
let transformMode='move';
let freeBall=false;
let coordinateSpace='local';
transform.addEventListener('dragging-changed', e=>{orbit.enabled=!e.value;});
transform.addEventListener('objectChange', ()=>{
 const p=selected();
 if(!p || transform.object!==p.container) return;
 readObjectTransform(p);
 updateTransformFields(p);
});
transform.addEventListener('mouseUp',recordEdit);
const toast=message=>{$('toast').textContent=message;};
const error=e=>{console.error(e);toast('Ошибка: '+(e?.message||String(e)));};
// Use the Android system document picker for save locations; browser fallback in save-output.mjs.
const parseGLB=async file=>new Promise(async(resolve,reject)=>{
 try{loader.parse(await file.arrayBuffer(),'',resolve,reject);}catch(e){reject(e);}
});
const dispose=o=>o?.traverse?.(child=>{child.geometry?.dispose?.();for(const m of (Array.isArray(child.material)?child.material:[child.material||null]))m?.dispose?.();});
function resize(){const w=canvas.clientWidth||1,h=canvas.clientHeight||1;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(canvas);resize();
let lastFrameTime=0;
renderer.setAnimationLoop((time)=>{
 if(document.hidden||time-lastFrameTime<33) return;
 const dt=Math.min((time-lastFrameTime)/1000,.08);
 lastFrameTime=time;
 wingMixer.update(dt);
 orbit.update();renderer.render(scene,camera);
});
function centerView(){
 if(!base)return;const box=new THREE.Box3().setFromObject(base);if(box.isEmpty())return;
 const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
 const radius=Math.max(size.x,size.y,size.z,.4);
 orbit.target.copy(center);camera.position.copy(center.clone().add(new THREE.Vector3(radius*.1,radius*.08,radius*2.2)));
 camera.near=Math.max(.01,radius/1000);camera.far=Math.max(100,radius*60);camera.updateProjectionMatrix();orbit.update();
}
function writeMetrics(){
 if(!base){$('metrics').textContent='Нет модели';return;}
 const m=inspectAvatar(base);
 $('metrics').textContent='Полигонов: '+m.triangles.toLocaleString('ru-RU')+'\nВершин: '+m.vertices.toLocaleString('ru-RU')+'\nКостей: '+m.bones+'\nSkinnedMesh: '+m.skinnedMeshes+'\nBlend Shapes: '+m.morphs.length+'\n\n'+m.warnings.map(w=>'• '+w).join('\n');
}
function writeMorphs(){
 const elem=$('morphs');elem.replaceChildren();
 const m=inspectAvatar(base);
 if(!m.morphs.length){const s=document.createElement('span');s.className='hint';s.textContent='В модели нет Blend Shapes — создание мимики требует исходных морфов.';elem.append(s);return;}
 for(const name of m.morphs){
  const label=document.createElement('label');label.textContent=name;
  const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='1';slider.step='.01';slider.value='0';
  slider.addEventListener('input',()=>base.traverse(o=>{const idx=o.morphTargetDictionary?.[name];if(typeof idx==='number'&&o.morphTargetInfluences)o.morphTargetInfluences[idx]=Number(slider.value);}));
  label.append(slider);elem.append(label);
 }
}
async function loadBase(file){
 toast('Загрузка 3D-модели…');const gltf=await parseGLB(file);
 transform.detach(); orbit.enabled=true;
 restorePosePreview();
 wingMixer.stopAllAction(); wingMixer=new THREE.AnimationMixer(avatar);
 for(const p of parts){p.removed=true;p.container.parent?.remove(p.container);}
 parts=[];selection=null;
 if(base){avatar.remove(base);dispose(base);}
 hemEditEnabled=false;hemHandle.visible=false;hemDrag=null;
 releaseBodyCage();
 base=gltf.scene;base.name='BaseAvatar';avatar.add(base);modelName=file.name||'avatar.glb';clips=gltf.animations||[];
 const avatarBox=new THREE.Box3().setFromObject(base);
 avatarHeight=Math.max(.1,avatarBox.getSize(new THREE.Vector3()).y);
 baseBoundingBox=avatarBox.clone();
 const saved=readEmbeddedProject(base);
 if(saved)recoverParts(saved);
 history.clear();recordEdit();
 centerView();writeMetrics();writeMorphs();renderParts();
 toast(saved?'✅ Проект открыт: '+parts.length+' деталей; геометрия и слои восстановлены.':'Модель загружена: '+modelName+'. Можно добавлять волосы и аксессуары.');
}
function recoverParts(project){
 const found=new Map();
 base.traverse(o=>{
  const id=o.userData?.avatarPart?.id;
  if(typeof id==='string')found.set(id,o);
 });
 for(const record of project.attachments){
  const container=found.get(record.id);
  if(!container)continue;
  const bounds=new THREE.Box3().setFromObject(container);
  const size=bounds.getSize(new THREE.Vector3());
  const sourceSpan=Math.max(size.x,size.y,size.z,.000001)/Math.max(record.scale,.000001);
  const p={id:record.id,config:record,container,sourceSpan,
   maxScale:limitAccessoryScale(1,sourceSpan,avatarHeight,record.type).maxScale,
   fallback:null};
  if(record.type==='wings'){
   p.wingVertices=countPartVertices(container);
   const alreadySkinned=!!container.getObjectByProperty('isSkinnedMesh',true);
   if(alreadySkinned){
    p.wingProblem='В загруженных крыльях уже есть кости. Сгиб и авториг поверх существующего скелета отключены; анимации GLB сохранены.';
   }else if(p.wingVertices<=MAX_WING_VERTICES){
    p.wingSource=captureWingGeometry(container);
    // The GLB contains already-baked geometry; avoid bending it a second time.
    p.config.bendDegrees=0;p.config.wingStretch=1;
    p.config.wingCenterOffset=0;
   }
  }else if(record.type==='clothing'){
   p.clothingWeighted=!!container.getObjectByProperty('isSkinnedMesh',true);
   // The imported GLB geometry is already baked; new edits use it as baseline.
   if(!p.clothingWeighted)p.config.hemFlare=1;
  }else if(record.type==='tail'){
   p.tailVertices=countPartVertices(container);
   p.tailSkinned=!!container.getObjectByProperty('isSkinnedMesh',true);
  }
  // Exported transform nodes already carry their positions and rotations.
  // Restore visibility explicitly because standard glTF node visibility is not persistent.
  container.visible=record.visible;
  parts.push(p);
 }
 serial=Math.max(serial,...parts.map(p=>Number(p.id.match(/^part-(\d+)$/)?.[1])||0),0);
 selection=parts[0]?.id||null;
}
function selected(){return parts.find(p=>p.id===selection)||null;}
function placePart(p){
 if(p.sourceSpan){
  const sourceSpan=p.sourceSpan*(p.config.type==='wings'?Math.max(1,p.config.wingStretch):1);
  const safety=limitAccessoryScale(p.config.scale,sourceSpan,avatarHeight,p.config.type);
  p.config.scale=safety.scale;
 }
 p.container.position.fromArray(p.config.position);
 p.container.rotation.set(...p.config.rotation.map(THREE.MathUtils.degToRad));
 p.container.scale.setScalar(p.config.scale);p.container.visible=p.config.visible;
}
function readObjectTransform(p){
 p.config.position=p.container.position.toArray();
 p.config.rotation=[p.container.rotation.x,p.container.rotation.y,p.container.rotation.z].map(THREE.MathUtils.radToDeg);
 p.config.scale=p.container.scale.x;
}
function updateScaleStatus(p,limited=false){
 const max=p.sourceSpan?limitAccessoryScale(1,p.sourceSpan*(p.config.type==='wings'?Math.max(1,p.config.wingStretch):1),avatarHeight,p.config.type).maxScale:4;
 $('scaleStatus').textContent=limited
  ? '⚠️ Достигнут безопасный размер для персонажа: '+Math.round(max*100)/100+'×'
  : 'Безопасный максимум: '+Math.round(max*100)/100+'×. Размер меняется только через кнопку / явное подтверждение.';
}
function updateTransformFields(p){
 const values={pScale:p.config.scale,pX:p.config.position[0],pY:p.config.position[1],pZ:p.config.position[2],rX:p.config.rotation[0],rY:p.config.rotation[1],rZ:p.config.rotation[2]};
 for(const [id,value] of Object.entries(values)){
  const input=$(id);
  if(input && document.activeElement!==input) input.value=String(Math.round(value*1000)/1000);
 }
}
function activateGizmo(p){
 if(!p || !p.config.visible){transform.detach();orbit.enabled=true;return;}
 if(transform.object!==p.container)transform.attach(p.container);
}
function setTransformMode(mode){
 transformMode=mode;
 freeBall=mode==='ball';
 transform.setMode(mode==='move'?'translate':'rotate');
 transform.showX=!freeBall;transform.showY=!freeBall;transform.showZ=!freeBall;
 for(const [id,active] of Object.entries({modeMove:mode==='move',modeRotate:mode==='rotate',modeBall:mode==='ball'})){
  $(id).classList.toggle('active',active);
  $(id).setAttribute('aria-pressed',String(active));
 }
}
function syncWingSliders(p){
 for(const [id,val,label] of [
  ['wingBend',p.config.bendDegrees,'bendValue'],
  ['wingStretch',p.config.wingStretch,'stretchValue'],
  ['wingHinge',p.config.hingeFraction,'hingeValue'],
  ['wingCenter',p.config.wingCenterOffset,'centerValue']
 ]){
  $(id).value=String(val);
  $(label).textContent=id==='wingBend'?val+'°':Math.round(val*100)+'%';
 }
 $('wingAxis').value=p.config.wingSpanAxis;
 $('wingDirection').value=String(p.config.wingFoldDirection);
 const detected=detectWingSpanAxis(p.wingSource,p.config.wingSpanAxis).toUpperCase();
 $('axisHint').textContent='Текущая ось размаха: '+detected+'. Если два крыла гнутся неправильно, выбери другую ось; смена направления разворачивает изгиб.';
}
const wingInputs=['wingBend','wingStretch','wingHinge','wingCenter'];
let wingLockTimer=null;
function lockWings(){
 clearTimeout(wingLockTimer);
 for(const id of wingInputs)$(id).disabled=true;
 $('wingUnlock').textContent='🔒 Разблокировать ползунки крыльев';
}
function unlockWings(){
 if(!selected()?.wingSource)return;
 for(const id of wingInputs)$(id).disabled=false;
 $('wingUnlock').textContent='🔓 Заблокировать ползунки';
 clearTimeout(wingLockTimer);
 wingLockTimer=setTimeout(lockWings,12000);
}
$('wingUnlock').addEventListener('click',()=>wingInputs.some(id=>$(id).disabled)?unlockWings():lockWings());
function queueWingDeformation(p){
 if(!p?.wingSource || p.removed)return Promise.resolve();
 // Coalesce repeated slider moves; obsolete jobs stop between batches.
 p.wingRevision=(p.wingRevision||0)+1;
 if(p.wingTask)return p.wingTask;
 const work=(async()=>{
  while(!p.removed && p.wingApplied!==p.wingRevision){
   const revision=p.wingRevision;
   const config={...p.config};
   if(p.wingVertices>INTERACTIVE_WING_VERTICES){
    const result=await deformWingGeometryAsync(p.wingSource,config,{
     chunkSize:6000,
     cancelled:()=>p.removed||p.wingRevision!==revision,
     onProgress:(done,total)=>{
      if(selected()===p)$('wingStatus').textContent='🪽 Запекание тяжёлых крыльев: '+Math.round(done/total*100)+'% · '+total.toLocaleString('ru-RU')+' вершин. Экспорт дождётся завершения.';
     }
    });
    if(result.cancelled)continue;
   }else{
    // Small wings remain responsive to every user edit.
    deformWingGeometry(p.wingSource,config);
   }
   p.wingApplied=revision;
   if(selected()===p){
    $('wingStatus').textContent='✅ Сгиб применён к геометрии ('+p.wingVertices.toLocaleString('ru-RU')+' вершин). Экспорт GLB сохранит форму.';
   }
  }
 })().catch(e=>{
  p.wingProblem='Ошибка сгиба крыльев: '+e.message;
  error(e);
 }).finally(()=>{p.wingTask=null;});
 p.wingTask=work;
 return work;
}
function updateWingDeformation(){
 const p=selected();
 if(!p?.wingSource)return;
 p.config.bendDegrees=Number($('wingBend').value);
 const requestedStretch=Number($('wingStretch').value);
 p.config.wingStretch=Math.max(.01,Math.min(requestedStretch,p.maxScale/p.config.scale,1.8));
 p.config.hingeFraction=Number($('wingHinge').value);
 p.config.wingCenterOffset=Number($('wingCenter').value);
 p.config.wingSpanAxis=$('wingAxis').value;
 p.config.wingFoldDirection=Number($('wingDirection').value);
 syncWingSliders(p);queueWingDeformation(p);recordEdit();
 clearTimeout(wingLockTimer);wingLockTimer=setTimeout(lockWings,12000);
}
for(const id of wingInputs)$(id).addEventListener('input',updateWingDeformation);
for(const id of ['wingAxis','wingDirection'])$(id).addEventListener('change',updateWingDeformation);
document.querySelector('.sidebar').addEventListener('scroll',lockWings,{passive:true});
for(const [id,angle] of [['fold25',25],['fold30',30]]){
 $(id).addEventListener('click',()=>{
  const p=selected();if(!p?.wingSource)return;
  p.config.bendDegrees=angle;
  p.config.wingFoldDirection=-1;
  syncWingSliders(p);
  queueWingDeformation(p);recordEdit();
  toast('Обе половины крыла сложены назад на '+angle+'° у центра. При необходимости сдвинь центр или поменяй ось.');
 });
}
$('resetWings').addEventListener('click',()=>{
 const p=selected();if(!p?.wingSource)return;
 p.config.bendDegrees=0;p.config.wingStretch=1;p.config.hingeFraction=.08;
 p.config.wingCenterOffset=0;p.config.wingSpanAxis='auto';p.config.wingFoldDirection=-1;
 queueWingDeformation(p);syncWingSliders(p);lockWings();recordEdit();
});
const MAX_RIG_VERTICES=250_000;
function updateRigPanel(p){
 const canRig=!!p?.wingSource && !p?.wingRig && p.wingVertices<=MAX_RIG_VERTICES;
 $('rigWings').disabled=!canRig;
 $('previewWingFlap').disabled=!p?.wingRig;
 $('stopWingFlap').disabled=!p?.wingRig;
 $('rigWingStatus').textContent= !p?.wingSource
  ? 'Сначала загрузи крылья GLB и подготовь их для сгиба.'
  : p.wingRig
   ? '✅ Две независимые кости и автоматические веса готовы. Можно включить махи, затем сохранить GLB с анимацией.'
   : p.wingVertices>MAX_RIG_VERTICES
    ? '⚠️ Крылья: '+p.wingVertices.toLocaleString('ru-RU')+' вершин. Сгиб доступен, но автокости ограничены '+MAX_RIG_VERTICES.toLocaleString('ru-RU')+' вершинами для безопасности.'
    : p.rigProblem||'Согни и установи крылья, затем нажми «Создать 2 кости». Риг не изменит скелет тела.';
}
$('rigWings').addEventListener('click',async()=>{
 const p=selected();if(!p?.wingSource||p.wingRig||p.wingVertices>MAX_RIG_VERTICES)return;
 $('rigWings').disabled=true;
 try{
  if(p.wingTask)await p.wingTask;
  if(p.removed)return;
  p.wingRig=createWingBoneRig(p.wingSource,{id:p.id,config:p.config});
  p.wingClip=makeWingFlapClip(p.wingRig,{angle:25,direction:p.config.wingFoldDirection,duration:2});
  p.rigProblem='';
  toast('Крыльям добавлены левая и правая кости, создана анимация махов. GLB сохранит скин и клип.');
 }catch(e){p.rigProblem=e.message;error(e);}
 updateRigPanel(p);
});
$('previewWingFlap').addEventListener('click',()=>{
 const p=selected();if(!p?.wingRig||!p.wingClip)return;
 poseWingRig(p.wingRig,0,p.config.wingFoldDirection);
 wingMixer.clipAction(p.wingClip).reset().play();
 toast('Предпросмотр махов крыльями. Две кости двигаются независимо от скелета персонажа.');
});
$('stopWingFlap').addEventListener('click',()=>{
 const p=selected();if(!p?.wingRig||!p.wingClip)return;
 wingMixer.clipAction(p.wingClip).stop();
 poseWingRig(p.wingRig,0,p.config.wingFoldDirection);
});
function movePartToBack(p){
 if(!base||p.config.anchor==='back')return;
 // Re-anchoring a detail previously imported as hair/other makes wings
 // actually sit on the back rather than stay parented to a head bone.
 if(p.fallback){p.fallback.parent?.remove(p.fallback);p.fallback=null;}
 let back=selectAnchorBone(base,'back');
 if(!back){
  back=new THREE.Group();
  back.name='AvatarAnchor:back';
  const pos=defaultAnchorPoint(baseBoundingBox,'back');
  base.add(back);
  base.updateWorldMatrix(true,true);
  back.position.copy(base.worldToLocal(new THREE.Vector3(pos.x,pos.y,pos.z)));
  p.fallback=back;
 }
 back.add(p.container);
 p.config.anchor='back';
 p.container.userData.avatarPart.anchor='back';
 p.config.position=[0,0,0];
 p.config.rotation=[0,0,0];
 placePart(p);
}
function assignPartAsWings(p){
 if(!p)return false;
 if(p.wingSource)return true;
 const total=p.wingVertices ?? countPartVertices(p.container);
 p.wingVertices=total;
 if(total===0){p.wingProblem='В этой детали нет 3D-вершин.';return false;}
 if(total>MAX_WING_VERTICES){
  p.wingProblem='В детали '+total.toLocaleString('ru-RU')+' вершин — больше лимита '+MAX_WING_VERTICES.toLocaleString('ru-RU')+' для планшета. Понадобится облегчённая модель крыльев.';
  return false;
 }
 try{
  p.wingSource=captureWingGeometry(p.container);
  p.wingProblem=p.wingSource?'':'Не удалось прочитать геометрию крыльев.';
  if(p.wingSource){
   p.config.type='wings';
   p.container.userData.avatarPart.type='wings';
   p.maxScale=limitAccessoryScale(1,p.sourceSpan,avatarHeight,'wings').maxScale;
   movePartToBack(p);
   placePart(p);
  }
  return !!p.wingSource;
 }catch(e){
  p.wingProblem='Ошибка подготовки сгиба: '+e.message;
  return false;
 }
}
function countPartVertices(root){
 let count=0;
 root.traverse(o=>{if(o.isMesh)count+=o.geometry?.getAttribute('position')?.count||0;});
 return count;
}
function renderWingPanel(){
 const p=selected(),picker=$('wingTarget'),oldValue=picker.value;
 picker.replaceChildren();
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='— Выбери импортированную деталь —';picker.append(placeholder);
 for(const item of parts){
  const option=document.createElement('option');
  option.value=item.id;
  option.textContent=item.config.name+(item.config.type==='wings'?' 🪽':'');
  picker.append(option);
 }
 picker.value=p?.id||'';
 const ready=!!p?.wingSource;
 $('wingStatus').textContent=ready
  ? '✅ '+p.config.name+' · '+p.wingVertices.toLocaleString('ru-RU')+' вершин. '+(p.wingVertices>INTERACTIVE_WING_VERTICES?'Режим обработки по частям — кнопки 25°/30° доступны.':'Быстрое сгибание 25°/30° доступно.')
  : !p
   ? 'Загрузи персонажа и крылья GLB. После импорта выбери деталь в списке выше.'
   : p.wingProblem
    ? '⚠️ '+p.wingProblem
    : 'ℹ️ Выбрана «'+p.config.name+'» как «'+p.config.type+'». Нажми «Назначить выбранную деталь крыльями».';
 $('makeWings').disabled=!p||ready||!!p.wingProblem;
 $('makeWings').textContent=ready?'✅ Крылья готовы':'🪽 Назначить выбранную деталь крыльями';
 for(const id of ['fold25','fold30','wingAxis','wingDirection','resetWings','wingUnlock']){
  $(id).disabled=!ready;
 }
 lockWings();
 if(ready)syncWingSliders(p);
 updateRigPanel(p);
}
$('goWings').addEventListener('click',()=>{
 $('wingSection').scrollIntoView({behavior:'smooth',block:'start'});
});
$('wingTarget').addEventListener('change',e=>{
 const id=e.target.value;
 selection=parts.some(p=>p.id===id)?id:null;
 renderParts();
});
$('makeWings').addEventListener('click',()=>{
 const p=selected();if(!p)return;
 if(assignPartAsWings(p))toast('Сгиб доступен для '+p.config.name+'. Выбери угол 25° или 30°.');
 else toast(p.wingProblem||'Не удалось подготовить крылья');
 renderParts();
});
const MAX_TAIL_RIG_VERTICES=250_000;
function updateTailPanel(){
 const picker=$('tailTarget'),p=selected();
 picker.replaceChildren();
 const empty=document.createElement('option');empty.value='';empty.textContent='— Выбери хвост —';picker.append(empty);
 for(const detail of parts.filter(q=>q.config.type==='tail')){
  const o=document.createElement('option');o.value=detail.id;o.textContent=detail.config.name;picker.append(o);
 }
 picker.value=p?.config.type==='tail'?p.id:'';
 const isTail=p?.config.type==='tail',skinned=p?.tailSkinned;
 $('rigTail').disabled=!isTail||!!p.tailRig||!!skinned||p.tailVertices>MAX_TAIL_RIG_VERTICES;
 $('previewTail').disabled=!p?.tailRig;$('stopTail').disabled=!p?.tailRig;
 $('tailStatus').textContent=!isTail
  ? 'Выбери импортированный хвост. Риг создаётся отдельно от скелета персонажа.'
  : p.tailRig
   ? '✅ Хвост с 3 суставами и анимацией. Можно запустить предпросмотр и экспортировать GLB.'
   : skinned
    ? 'ℹ️ У этого хвоста уже есть скин и кости. Повторный автоскининг отключён.'
    : p.tailVertices>MAX_TAIL_RIG_VERTICES
     ? '⚠️ Для мобильного авторигинга нужно не более '+MAX_TAIL_RIG_VERTICES.toLocaleString('ru-RU')+' вершин. Сейчас: '+p.tailVertices.toLocaleString('ru-RU')
     : 'Готово к автоматическому созданию 3 суставов хвоста.';
}
$('tailTarget').addEventListener('change',e=>{
 const chosen=parts.find(p=>p.id===e.target.value);
 selection=chosen?.id||null;renderParts();
});
$('rigTail').addEventListener('click',()=>{
 const p=selected();if(p?.config.type!=='tail'||p.tailRig||p.tailSkinned||p.tailVertices>MAX_TAIL_RIG_VERTICES)return;
 try{
  const source=captureWingGeometry(p.container);
  p.tailRig=createTailRig(source,{id:p.id,axis:$('tailAxis').value,base:$('tailRootSide').value});
  p.tailClip=makeTailWagClip(p.tailRig,{amplitude:18,duration:2});
  p.tailSkinned=true;
  toast('Хвост зариган: 3 сустава, веса и клип покачивания готовы.');
 }catch(e){error(e);}
 updateTailPanel();
});
$('previewTail').addEventListener('click',()=>{
 const p=selected();if(!p?.tailRig||!p.tailClip)return;
 wingMixer.clipAction(p.tailClip).reset().play();toast('Анимация хвоста запущена');
});
$('stopTail').addEventListener('click',()=>{
 const p=selected();if(!p?.tailRig||!p.tailClip)return;
 wingMixer.clipAction(p.tailClip).stop();poseTailRig(p.tailRig,0,0);
});

let poseBackup=null;
function restorePosePreview(){
 if(!poseBackup)return;
 for(const [bone,quaternion] of poseBackup)bone.quaternion.copy(quaternion);
 poseBackup=null;
 base?.updateWorldMatrix(true,true);
}
function updateClothingPanel(){
 const p=selected(),picker=$('clothingTarget'),sourceSelect=$('weightSource');
 picker.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='— Выбери одежду —';picker.append(empty);
 for(const item of parts.filter(x=>x.config.type==='clothing')){
  const opt=document.createElement('option');opt.value=item.id;opt.textContent=item.config.name;picker.append(opt);
 }
 picker.value=p?.config.type==='clothing'?p.id:'';
 const old=sourceSelect.value;sourceSelect.replaceChildren();
 const meshes=findWeightSources(base);
 for(let i=0;i<meshes.length;i++){
  const item=meshes[i],option=document.createElement('option');
  option.value=String(i);
  const count=item.geometry.getAttribute('position')?.count||0;
  option.textContent=(item.name||'SkinnedMesh '+(i+1))+' · '+count.toLocaleString('ru-RU')+' вершин · '+item.skeleton.bones.length+' костей';
  sourceSelect.append(option);
 }
 sourceSelect.value=meshes.length?(old && Number(old)<meshes.length?old:'0'):'';
 const isClothing=p?.config.type==='clothing';
 const alreadyRigged=!!p?.clothingWeighted||!!p?.container?.getObjectByProperty('isSkinnedMesh',true);
 $('transferWeights').disabled=!isClothing||!meshes.length||alreadyRigged;
 $('poseCheck').disabled=!meshes.length;
 $('poseReset').disabled=!poseBackup;
 $('weightStatus').textContent=!meshes.length
  ? '⚠️ У загруженного персонажа нет SkinnedMesh с весами. Нужна настоящая зариганная модель.'
  : !isClothing
   ? 'Загрузи GLB с типом «👕 Одежда» и выбери его в этом разделе.'
   : alreadyRigged
    ? '✅ Одежда уже получила веса и использует скелет персонажа. Повторный перенос отключён. Проверь позу, затем сохрани GLB.'
    : 'Готово: подгони одежду по положению и размеру; затем нажми «Перенести веса».';
}
$('clothingTarget').addEventListener('change',e=>{
 const p=parts.find(x=>x.id===e.target.value);
 selection=p?.id||null;renderParts();
});
$('transferWeights').addEventListener('click',async()=>{
 const p=selected(),sources=findWeightSources(base);
 const body=sources[Number($('weightSource').value)];
 if(!p||p.config.type!=='clothing'||!body)return;
 const button=$('transferWeights');button.disabled=true;
 try{
  if(p.clothingWeighted||p.container.getObjectByProperty('isSkinnedMesh',true))throw new Error('Одежда уже имеет веса');
  restorePosePreview();
  clothingStatus(p.container,body);
  const distance=Number($('weightDistance').value)*avatarHeight;
  const result=await transferClothingWeights(p.container,body,{
   maxDistance:distance,chunkSize:1200,
   onProgress:(done,total)=>{$('weightStatus').textContent='Перенос весов: '+Math.round(done/total*100)+'% ('+done.toLocaleString('ru-RU')+'/'+total.toLocaleString('ru-RU')+' вершин)';}
  });
  // Bone parenting would move the garment twice. Keep the same world
  // placement, but reparent to the avatar scene root.
  avatar.attach(p.container);
  if(p.fallback){p.fallback.parent?.remove(p.fallback);p.fallback=null;}
  p.config.anchor='root';
  p.container.userData.avatarPart.anchor='root';
  readObjectTransform(p);
  p.clothingWeighted=true;
  p.weightSource=body.name||'body';
  recordEdit();renderParts();
  hemEditEnabled=false;hemHandle.visible=false;
  $('weightStatus').textContent='✅ Готово: '+result.vertices+' вершин, '+result.meshes+' мешей. Привязано к костям персонажа, без двойной привязки к груди.';
  toast('Веса одежды перенесены на '+result.vertices+' вершин. Можно проверить плечи и ноги.');
 }catch(e){error(e);$('weightStatus').textContent='⚠️ '+(e?.message||String(e));}
 finally{if(!p?.clothingWeighted)button.disabled=false;}
});
function getSmartBody(){
 const sources=findFitSources(base);
 return sources[Number($('smartBodySource').value)]||sources[0]||null;
}
function updateSmartPanel(){
 const selector=$('smartBodySource'),old=selector.value;
 const sources=findFitSources(base);
 selector.replaceChildren();
 for(let i=0;i<sources.length;i++){
  const option=document.createElement('option');
  option.value=String(i);
  option.textContent=(sources[i].name||'Меш '+(i+1))+' · '+sources[i].geometry.getAttribute('position').count.toLocaleString('ru-RU')+' вершин';
  selector.append(option);
 }
 selector.value=sources.length&&old!==''&&Number(old)<sources.length?old:sources.length?'0':'';
 const p=selected(),ready=p?.config.type==='clothing'
  &&!p?.clothingWeighted&&!p.container?.getObjectByProperty('isSkinnedMesh',true);
 $('buildBodyCage').disabled=!sources.length||smartBusy;
 $('toggleBodyCage').disabled=!bodyCage||smartBusy;
 $('smartDress').disabled=!sources.length||!ready||smartBusy;
 $('toggleBodyCage').textContent=bodyCage?.mesh.visible?'🙈 Скрыть оболочку':'👁 Показать оболочку';
 $('smartFitStatus').textContent=smartBusy?'⏳ SmartFit работает…'
  : p?.smartFitStatus||(!sources.length?'Загрузи персонажа GLB.'
   : !ready?'Импортируй одежду GLB с типом «👕 Одежда», выбери её в списке.'
    : bodyCage?'✅ Body Cage готова: '+bodyCage.triangles.toLocaleString('ru-RU')+' треугольников. Нажми «Надеть».'
     :'Готово к созданию облегчённой оболочки тела. Нажми «Надеть» для автоматического процесса.');
}
async function ensureBodyCage(){
 const source=getSmartBody(),topFraction=Number($('smartCageTop').value);
 if(!source)throw new Error('Загрузи модель персонажа и выбери поверхность тела');
 if(bodyCage?.source===source&&bodyCage.topFraction===topFraction)return bodyCage;
 releaseBodyCage();
 const created=await createBodyCage(source,{maxTriangles:48000,topFraction,
  onProgress:(done,total)=>{
   $('smartFitStatus').textContent='Создание оболочки: '+Math.round(done/total*100)+'%';
  }});
 bodyCage=created;
 scene.add(created.mesh);
 created.mesh.visible=true;
 return created;
}
$('smartBodySource').addEventListener('change',()=>{
 releaseBodyCage();updateSmartPanel();
});
$('smartCageTop').addEventListener('change',()=>{
 releaseBodyCage();updateSmartPanel();
});
$('buildBodyCage').addEventListener('click',async()=>{
 if(smartBusy)return;smartBusy=true;
 try{
  const cage=await ensureBodyCage();
  $('smartFitStatus').textContent='✅ Оболочка готова: '+cage.triangles.toLocaleString('ru-RU')+' из '+cage.originalTriangles.toLocaleString('ru-RU')+' треугольников. Тело не изменено.';
  toast('Body Cage создана без изменений оригинального GLB.');
 }catch(e){error(e);$('smartFitStatus').textContent='⚠️ '+(e?.message||String(e));}
 finally{smartBusy=false;updateSmartPanel();}
});
$('toggleBodyCage').addEventListener('click',()=>{
 if(!bodyCage)return;
 bodyCage.mesh.visible=!bodyCage.mesh.visible;updateSmartPanel();
});
$('smartDress').addEventListener('click',async()=>{
 const p=selected();
 if(smartBusy||!p||p.config.type!=='clothing'||p.clothingWeighted)return;
 smartBusy=true;let stage='error';
 try{
  restorePosePreview();
  // Clothes from v1.2 can still be attached to a chest bone. Fitting must
  // happen in the avatar root frame while preserving world coordinates.
  if(p.container.parent!==base){
   base.attach(p.container);
   if(p.fallback){p.fallback.parent?.remove(p.fallback);p.fallback=null;}
   p.config.anchor='root';
   p.container.userData.avatarPart.anchor='root';
   readObjectTransform(p);
  }
  // Never modify the imported body mesh; only the clothing attachment.
  const cage=await ensureBodyCage(),source=getSmartBody();
  cage.mesh.visible=false;
  const result=await runSmartDress(p.container,{
   cage,body:source,style:$('smartClothesStyle').value,
   strength:.72,clearance:Math.max(.003,avatarHeight*.006),
   maxWeightDistance:Math.min(3,avatarHeight*.30),
   onProgress:(step,done,total)=>{
    $('smartFitStatus').textContent=(step==='fit'?'Подгонка формы: ':'Перенос весов: ')+Math.round(done/total*100)+'%';
   }
  });
  stage=result.stage;
  p.flareModifier=null;
  p.config.hemFlare=1;
  readObjectTransform(p);
  if(stage==='skinned'){
   // A garment tied to a chest bone would be transformed twice.
   avatar.attach(p.container);
   if(p.fallback){p.fallback.parent?.remove(p.fallback);p.fallback=null;}
   p.config.anchor='root';
   p.container.userData.avatarPart.anchor='root';
   readObjectTransform(p);
   p.clothingWeighted=true;
  }
  p.smartFitStatus=stage==='skinned'
   ?'✅ Готово: одежда подогнана и привязана к '+source.skeleton.bones.length+' костям. Можно проверять анимацию и сохранять GLB.'
   :'✅ Одежда размещена: масштаб ×'+result.fit.scaleRatio.toFixed(2)+', '+result.fit.vertices+' вершин. '+result.warning;
  recordEdit();
  renderParts();
  toast(p.smartFitStatus);
 }catch(e){error(e);p.smartFitStatus='⚠️ '+(e?.message||String(e));}
 finally{
  smartBusy=false;
  updateSmartPanel();updateFitUI();
 }
});

function updateFitUI(){
 const p=selected(),ready=canEditHem(p);
 const options=$('fitBodySource'),old=options.value;
 const sources=findFitSources(base);
 options.replaceChildren();
 for(let i=0;i<sources.length;i++){
  const o=document.createElement('option');o.value=String(i);
  o.textContent=(sources[i].name||'Mesh '+(i+1))+(sources[i].isSkinnedMesh?' 🦴':'')+' · '+sources[i].geometry.getAttribute('position').count.toLocaleString('ru-RU')+' вершин';
  options.append(o);
 }
 options.value=sources.length&&Number(old)<sources.length&&old!==''?old:sources.length?'0':'';

 for(const id of ['autoFitClothes','flareMinus','flarePlus','flareApply','hemHandleToggle','flareReset']){
  $(id).disabled=!ready;
 }
 if(!ready){
  hemHandle.visible=false;
  $('fitStatus').textContent=p?.config.type==='clothing'
   ? 'Одежда уже заригана: форму надо менять до переноса весов.'
   : 'Выбери импортированную деталь с типом «👕 Одежда».';
 }else{
  $('flareValue').value=String(Math.round((p.config.hemFlare||1)*100)/100);
  $('fitStatus').textContent=p.fitStatus||'Сначала «Авто-подгонка», затем потяни подол или нажимай + / −.';
 }
 $('hemHandleToggle').textContent=hemEditEnabled?'🟡 Скрыть ручку':'🟡 Показать ручку подола';
 updateHemHandle();
}
$('autoFitClothes').addEventListener('click',async()=>{
 const p=selected();if(!canEditHem(p))return;
 if(p.fitBusy)return;
 p.fitBusy=true;const btn=$('autoFitClothes');btn.disabled=true;
 try{
  restorePosePreview();
  const bodies=findFitSources(base),body=bodies[Number($('fitBodySource').value)]||bodies[0];
  if(!body)throw new Error('Загрузи меш тела для подгонки');
  const result=await autoFitClothing(p.container,body,{
   style:$('fitStyle').value,strength:Number($('fitStrength').value),
   clearance:Math.max(.003,avatarHeight*.006),
   onProgress:(done,total)=>{$('fitStatus').textContent='✨ Подгонка: '+done.toLocaleString('ru-RU')+' вершин…';}
  });
  // Auto-fit changes both transform and mesh; take fresh baseline for hem.
  readObjectTransform(p);p.flareModifier=null;
  p.config.hemFlare=1;
  ensureHem(p);recordEdit();
  p.fitStatus='✅ Подгонка применена, обработано '+result.modified+' вершин. Теперь тяни жёлтую ручку у подола.';
  toast(p.fitStatus);
 }catch(e){error(e);p.fitStatus='⚠️ '+(e?.message||String(e));}
 finally{p.fitBusy=false;btn.disabled=false;updateFitUI();updateTransformFields(p);}
});
$('flareMinus').addEventListener('click',()=>changeHem((selected()?.config.hemFlare||1)-.1));
$('flarePlus').addEventListener('click',()=>changeHem((selected()?.config.hemFlare||1)+.1));
$('flareApply').addEventListener('click',()=>{
 try{
  const value=Number(String($('flareValue').value).trim().replace(',','.'));
  if(!Number.isFinite(value)||value<.7||value>3)throw new Error('Подол: укажи число от 0,7 до 3');
  changeHem(value);
 }catch(e){error(e);}
});
$('flareValue').addEventListener('keydown',e=>{if(e.key==='Enter'){$('flareApply').click();$('flareValue').blur();}});
$('hemHandleToggle').addEventListener('click',()=>{
 if(!canEditHem(selected()))return;
 try{ensureHem(selected());hemEditEnabled=!hemEditEnabled;updateFitUI();}
 catch(e){error(e);}
});
$('flareReset').addEventListener('click',()=>changeHem(1));
$('poseCheck').addEventListener('click',()=>{
 if(!base)return;
 restorePosePreview();
 const bones=[];base.traverse(o=>{if(o.isBone)bones.push(o);});
 const matches=bones.filter(b=>/(upper.?arm|shoulder|forearm|lower.?arm|thigh|upper.?leg|calf|lower.?leg)/i.test(b.name));
 if(!matches.length){toast('В скелете нет распознанных костей рук/ног для тестовой позы');return;}
 poseBackup=matches.map(b=>[b,b.quaternion.clone()]);
 for(const bone of matches){
  const name=bone.name.toLowerCase(),side=/right|_r\b|\.r\b/.test(name)?-1:1;
  if(/shoulder|upper.?arm/.test(name))bone.rotateZ(side*.38);
  else if(/forearm|lower.?arm/.test(name))bone.rotateY(side*.35);
  else if(/thigh|upper.?leg/.test(name))bone.rotateX(.25);
  else if(/calf|lower.?leg/.test(name))bone.rotateX(-.30);
 }
 base.updateWorldMatrix(true,true);
 $('poseReset').disabled=false;
 toast('Проверка позы: согнуты плечи, локти и ноги. Посмотри, не тянет ли ткань через тело.');
});
$('poseReset').addEventListener('click',()=>{restorePosePreview();$('poseReset').disabled=true;toast('Исходная поза восстановлена');});

function renderParts(){
 $('partsPanel').hidden=parts.length===0;const list=$('partList');list.replaceChildren();
 for(const p of parts){
  const row=document.createElement('div');row.className='part'+(p.id===selection?' active':'');
  const btn=document.createElement('button');btn.className='part-name';btn.textContent=p.config.name+' · '+p.config.type;btn.addEventListener('click',()=>{selection=p.id;renderParts();});row.append(btn);
  const visibility=document.createElement('span');visibility.textContent=p.config.visible?'👁':'—';row.append(visibility);list.append(row);
 }
 const p=selected();$('partEditor').hidden=!p;
 activateGizmo(p);
 if(p)updateScaleStatus(p);
 if(p)updateTransformFields(p);
 renderWingPanel();
 updateTailPanel();
 updateClothingPanel();
 updateFitUI();
 updateSmartPanel();
 updateHemHandle();
}
async function addPart(file){
 if(!base){toast('Сначала загрузите основную модель');return;}
 const kind=$('kind').value,anchor=$('kind').value==='clothing'?'root':$('anchor').value,loaded=await parseGLB(file);
 const config=makePartConfig({id:'part-'+(++serial),name:file.name,type:kind,anchor});
 const initialBox=new THREE.Box3().setFromObject(loaded.scene);
 if(initialBox.isEmpty())throw new Error('В файле детали нет видимой геометрии.');
 const size=initialBox.getSize(new THREE.Vector3());
 const sourceSpan=Math.max(size.x,size.y,size.z,0.000001);
 const sizeLimit=limitAccessoryScale(1,sourceSpan,avatarHeight,kind);
 config.scale=sizeLimit.scale;
 const bone=kind==='clothing'?null:selectAnchorBone(base,anchor);
 const container=new THREE.Group();container.name='Attachment:'+config.name;
 container.userData.avatarPart={id:config.id,type:kind,anchor};
 container.add(loaded.scene);
 let fallback=null;
 if(kind==='clothing')base.add(container);
 else if(bone)bone.add(container);
 else {
  fallback=new THREE.Group();fallback.name='AvatarAnchor:'+anchor;
  const pos=defaultAnchorPoint(baseBoundingBox,anchor);
  base.add(fallback);
  base.updateWorldMatrix(true,true);
  const point=base.worldToLocal(new THREE.Vector3(pos.x,pos.y,pos.z));
  fallback.position.copy(point);
  fallback.add(container);
 }
 const p={id:config.id,config,container,sourceSpan,maxScale:sizeLimit.maxScale,fallback};
 if(kind==='tail'){
  p.tailVertices=countPartVertices(container);
  p.tailSkinned=!!container.getObjectByProperty('isSkinnedMesh',true);
 }
 placePart(p);
 if(kind==='wings')assignPartAsWings(p);
 parts.push(p);selection=p.id;renderParts();recordEdit();
 if(p.wingProblem)toast(p.wingProblem);
 else if(kind==='clothing')toast('👕 Одежда загружена отдельно от костей. Выбери SmartFit → Надеть автоматически.');
 else toast(bone?'Деталь на кости '+bone.name+'. Масштаб ограничен безопасным пределом.':
  'Кость '+anchor+' не найдена: использована фиксированная точка крепления '+anchor+' на теле (без скелета).');
}
$('kind').addEventListener('change',()=>{$('anchor').value=PART_ANCHORS[$('kind').value]||'chest';});
$('baseFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(f)try{await loadBase(f);}catch(err){error(err)}e.target.value='';});
$('partFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(f)try{await addPart(f);}catch(err){error(err)}e.target.value='';});
$('demo').addEventListener('click',async()=>{
 try{const response=await fetch('./demo/Human_Male_Android.glb');if(!response.ok)throw new Error('В репозитории демо-модель не включена; загрузи свой GLB или распакуй полный архив с демо.');
 await loadBase(new File([await response.blob()],'Human_Male_Android.glb',{type:'model/gltf-binary'}));}catch(e){
  try {
    const dummy=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:0x9a8aa0,roughness:.85});
    const add=(geo,x,y,z)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);dummy.add(m);};
    add(new THREE.BoxGeometry(.58,.68,.30),0,1.25,0);
    add(new THREE.SphereGeometry(.24,16,12),0,1.87,0);
    for(const x of [-.43,.43])add(new THREE.BoxGeometry(.19,.71,.2),x,1.24,0);
    for(const x of [-.16,.16])add(new THREE.BoxGeometry(.20,.77,.22),x,.53,0);
    const result=await new Promise((resolve,reject)=>new GLTFExporter().parse(dummy,resolve,reject,{binary:true}));
    await loadBase(new File([result],'Demo_Mannequin_No_Rig.glb',{type:'model/gltf-binary'}));
    toast('Демо-манекен без скелета. Импортируй зариганный GLB для настройки костей.');
  }catch(err){error(err);}
 }
});
$('fit').addEventListener('click',centerView);
// Numerical controls use the bone-local coordinate system (unbounded precision).
function applyTypedTransform(){
 const p=selected();if(!p)return;
 const read=id=>Number.parseFloat($(id).value);
 const pos=['pX','pY','pZ'].map(read),rot=['rX','rY','rZ'].map(read);
 if(![...pos,...rot].every(Number.isFinite)){toast('Нужны корректные координаты.');return;}
 p.config.position=pos;p.config.rotation=rot;
 placePart(p);recordEdit();
}
for(const id of ['pX','pY','pZ','rX','rY','rZ']) $(id).addEventListener('change',applyTypedTransform);
function setIntentionalScale(value){
 const p=selected();if(!p)return;
 const span=p.sourceSpan*(p.config.type==='wings'?Math.max(1,p.config.wingStretch):1);
 const {scale,limited}=limitAccessoryScale(value,span,avatarHeight,p.config.type);
 p.config.scale=scale;placePart(p);
 $('pScale').value=String(Math.round(scale*10000)/10000);
 updateScaleStatus(p,limited);
 recordEdit();
}
$('scaleApply').addEventListener('click',()=>{
 try{setIntentionalScale(parseScaleText($('pScale').value));}
 catch(e){toast(e.message);$('pScale').value=String(selected()?.config.scale||1);}
});
$('pScale').addEventListener('keydown',e=>{if(e.key==='Enter'){$('scaleApply').click();$('pScale').blur();}});
for(const [id,sign] of [['scaleMinus',-1],['scalePlus',1]]){
 $(id).addEventListener('click',()=>{
  const p=selected();if(!p)return;
  const next=Math.max(.00001,p.config.scale+sign*.05);
  setIntentionalScale(next);
 });
}
for(const button of document.querySelectorAll('[data-adjust]')){
 button.addEventListener('click',()=>{
  const input=$(button.dataset.adjust);
  const delta=Number(button.dataset.delta);
  input.value=String(Math.round((Number(input.value||0)+delta)*100000)/100000);
  applyTypedTransform();
  updateTransformFields(selected());
 });
}
$('modeMove').addEventListener('click',()=>setTransformMode('move'));
$('modeRotate').addEventListener('click',()=>setTransformMode('rotate'));
$('modeBall').addEventListener('click',()=>setTransformMode('ball'));
$('spaceMode').addEventListener('click',()=>{
 coordinateSpace=coordinateSpace==='local'?'world':'local';
 transform.setSpace(coordinateSpace);
 $('spaceMode').textContent=coordinateSpace==='local'?'Оси: локальные':'Оси: мировые';
 toast(coordinateSpace==='local'?'Оси гизмо ориентированы по детали. Числа остаются относительно кости.':'Оси гизмо ориентированы по миру. Числа остаются относительно кости.');
});
function resetTransform(what){
 const p=selected();if(!p)return;
 if(what==='position'||what==='all')p.config.position=[0,0,0];
 if(what==='rotation'||what==='all')p.config.rotation=[0,0,0];
 if(what==='all')p.config.scale=limitAccessoryScale(1,p.sourceSpan*(p.config.type==='wings'?Math.max(1,p.config.wingStretch):1),avatarHeight,p.config.type).scale;
 placePart(p);updateTransformFields(p);updateScaleStatus(p);recordEdit();
}
$('resetPosition').addEventListener('click',()=>resetTransform('position'));
$('resetRotation').addEventListener('click',()=>resetTransform('rotation'));
$('resetAll').addEventListener('click',()=>resetTransform('all'));
$('delPart').addEventListener('click',()=>{const p=selected();if(!p)return;p.removed=true;transform.detach();p.container.parent?.remove(p.container);if(p.fallback)p.fallback.parent?.remove(p.fallback);if(p.wingClip)wingMixer.clipAction(p.wingClip).stop();dispose(p.container);parts=parts.filter(x=>x!==p);selection=parts.at(-1)?.id||null;renderParts();history.clear();recordEdit();});
$('togglePart').addEventListener('click',()=>{const p=selected();if(!p)return;p.config.visible=!p.config.visible;placePart(p);renderParts();recordEdit();});
$('saveJson').addEventListener('click',async()=>{
 if(!base){toast('Нет проекта для сохранения');return;}
 try{
  const contents=JSON.stringify(exportProjectMetadata(parts.map(p=>p.config),modelName),null,2);
  await saveOutput(contents,'phoenix-avatar-settings.json','application/json');
  toast('Настройки сохранены в выбранную папку. Исходные GLB храните отдельно.');
 }catch(e){
  if(String(e).includes('SAVE_CANCELLED'))toast('Выбор папки отменён.');
  else error(e);
 }
});
$('projectFile').addEventListener('change',async e=>{
 const file=e.target.files?.[0];
 if(file)try{await loadBase(file);}catch(err){error(err);}
 e.target.value='';
});
async function saveCombinedGLB(asProject=false){
 if(!base){toast('Сначала загрузите модель');return;}
 const btn=asProject?$('saveProject'):$('exportGlb');
 btn.disabled=true;
 try{
  toast('Проверка завершения деформаций…');
  await Promise.all(parts.map(p=>p.wingTask).filter(Boolean));
  restorePosePreview();
  for(const p of parts){
   if(p.wingRig&&p.wingClip){wingMixer.clipAction(p.wingClip).stop();poseWingRig(p.wingRig,0,p.config.wingFoldDirection);}
   if(p.tailRig&&p.tailClip){wingMixer.clipAction(p.tailClip).stop();poseTailRig(p.tailRig,0,0);}
  }
  if(parts.some(p=>p.wingProblem?.startsWith('Ошибка сгиба')))throw new Error('Сгиб крыльев завершился ошибкой');
  // A complete editable project retains even hidden accessory geometry.
  const included=parts.filter(p=>asProject||p.config.visible);
  avatar.userData.phoenixProject=serializeProject(included,modelName);
  // Keep the inner attachment groups as nodes, never fuse their materials/skin.
  const animations=[...clips,...parts.flatMap(p=>[p.wingClip,p.tailClip]).filter(Boolean)];
  const exported=await new Promise((resolve,reject)=>new GLTFExporter().parse(avatar,resolve,reject,{
   binary:true,onlyVisible:!asProject,animations
  }));
  const required=included.map(p=>p.id);
  const result=inspectGLBBytes(exported,required);
  await saveOutput(exported,asProject?'Phoenix_VR_Editable_Project.glb':'Phoenix_VR_Avatar.glb','model/gltf-binary',(done,total)=>{
   if(total>10*1024*1024)toast('Сохранение GLB: '+Math.round(done/total*100)+'%');
  });
  toast((asProject?'Проект':'Аватар')+' сохранён: '+result.meshes+' мешей, '+required.length+' деталей. Все слои остались внутри GLB.');
 }catch(e){
  if(String(e).includes('SAVE_CANCELLED'))toast('Сохранение отменено.');
  else error(e);
 }finally{btn.disabled=false;}
}
$('exportGlb').addEventListener('click',()=>saveCombinedGLB(false));
$('saveProject').addEventListener('click',()=>saveCombinedGLB(true));

window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',async e=>{e.preventDefault();const f=[...(e.dataTransfer?.files||[])].find(f=>f.name.toLowerCase().endsWith('.glb'));if(f)try{await loadBase(f)}catch(err){error(err)}});
