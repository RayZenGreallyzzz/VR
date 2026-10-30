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
let wingMixer=new THREE.AnimationMixer(avatar);
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
 wingMixer.stopAllAction(); wingMixer=new THREE.AnimationMixer(avatar);
 for(const p of parts){p.removed=true;p.container.parent?.remove(p.container);}
 parts=[];selection=null;
 if(base){avatar.remove(base);dispose(base);}
 base=gltf.scene;base.name='BaseAvatar';avatar.add(base);modelName=file.name||'avatar.glb';clips=gltf.animations||[];
 const avatarBox=new THREE.Box3().setFromObject(base);
 avatarHeight=Math.max(.1,avatarBox.getSize(new THREE.Vector3()).y);
 baseBoundingBox=avatarBox.clone();
 centerView();writeMetrics();writeMorphs();renderParts();
 toast('Модель загружена: '+modelName+'. Можно добавлять волосы и аксессуары.');
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
 syncWingSliders(p);queueWingDeformation(p);
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
  queueWingDeformation(p);
  toast('Обе половины крыла сложены назад на '+angle+'° у центра. При необходимости сдвинь центр или поменяй ось.');
 });
}
$('resetWings').addEventListener('click',()=>{
 const p=selected();if(!p?.wingSource)return;
 p.config.bendDegrees=0;p.config.wingStretch=1;p.config.hingeFraction=.08;
 p.config.wingCenterOffset=0;p.config.wingSpanAxis='auto';p.config.wingFoldDirection=-1;
 queueWingDeformation(p);syncWingSliders(p);lockWings();
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
}
async function addPart(file){
 if(!base){toast('Сначала загрузите основную модель');return;}
 const kind=$('kind').value,anchor=$('anchor').value,loaded=await parseGLB(file);
 const config=makePartConfig({id:'part-'+(++serial),name:file.name,type:kind,anchor});
 const initialBox=new THREE.Box3().setFromObject(loaded.scene);
 if(initialBox.isEmpty())throw new Error('В файле детали нет видимой геометрии.');
 const size=initialBox.getSize(new THREE.Vector3());
 const sourceSpan=Math.max(size.x,size.y,size.z,0.000001);
 const sizeLimit=limitAccessoryScale(1,sourceSpan,avatarHeight,kind);
 config.scale=sizeLimit.scale;
 const bone=selectAnchorBone(base,anchor);
 const container=new THREE.Group();container.name='Attachment:'+config.name;
 container.userData.avatarPart={id:config.id,type:kind,anchor};
 container.add(loaded.scene);
 let fallback=null;
 if(bone)bone.add(container);
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
 placePart(p);
 if(kind==='wings')assignPartAsWings(p);
 parts.push(p);selection=p.id;renderParts();
 if(p.wingProblem)toast(p.wingProblem);
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
 placePart(p);
}
for(const id of ['pX','pY','pZ','rX','rY','rZ']) $(id).addEventListener('change',applyTypedTransform);
function setIntentionalScale(value){
 const p=selected();if(!p)return;
 const span=p.sourceSpan*(p.config.type==='wings'?Math.max(1,p.config.wingStretch):1);
 const {scale,limited}=limitAccessoryScale(value,span,avatarHeight,p.config.type);
 p.config.scale=scale;placePart(p);
 $('pScale').value=String(Math.round(scale*10000)/10000);
 updateScaleStatus(p,limited);
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
 placePart(p);updateTransformFields(p);updateScaleStatus(p);
}
$('resetPosition').addEventListener('click',()=>resetTransform('position'));
$('resetRotation').addEventListener('click',()=>resetTransform('rotation'));
$('resetAll').addEventListener('click',()=>resetTransform('all'));
$('delPart').addEventListener('click',()=>{const p=selected();if(!p)return;p.removed=true;transform.detach();p.container.parent?.remove(p.container);if(p.fallback)p.fallback.parent?.remove(p.fallback);if(p.wingClip)wingMixer.clipAction(p.wingClip).stop();dispose(p.container);parts=parts.filter(x=>x!==p);selection=parts.at(-1)?.id||null;renderParts();});
$('togglePart').addEventListener('click',()=>{const p=selected();if(!p)return;p.config.visible=!p.config.visible;placePart(p);renderParts();});
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
$('exportGlb').addEventListener('click',async()=>{
 if(!base){toast('Сначала загрузите модель');return;}
 const btn=$('exportGlb');btn.disabled=true;toast('Проверка завершения деформаций перед экспортом…');
 try{
  // Never export half-written vertex buffers from a chunked high-poly fold.
  await Promise.all(parts.map(p=>p.wingTask).filter(Boolean));
  // Skin inverse matrices should match the wing rest pose at export time.
  for(const p of parts){if(p.wingRig&&p.wingClip){wingMixer.clipAction(p.wingClip).stop();poseWingRig(p.wingRig,0,p.config.wingFoldDirection);}}
  if(parts.some(p=>p.wingProblem?.startsWith('Ошибка сгиба'))){throw new Error('Не удалось завершить сгиб крыльев. Экспорт отменён.');}
  toast('Запекание добавленных деталей в GLB…');
  // All attached accessory meshes belong to the avatar export hierarchy.
  // Deformed wing geometry is already real BufferGeometry, not a shader effect.
  const exported=await new Promise((resolve,reject)=>new GLTFExporter().parse(avatar,resolve,reject,{
   binary:true,onlyVisible:true,animations:[...clips,...parts.map(p=>p.wingClip).filter(Boolean)]
  }));
  // Verify attachment IDs via the GLB JSON chunk. Parsing it without
  // reloading all textures/meshes avoids doubling memory on Android.
  const expected=parts.filter(p=>p.config.visible).map(p=>p.id);
  const info=inspectGLBBytes(exported,expected);
  toast('Проверено: '+expected.length+' из '+expected.length+' деталей внутри GLB. Выбери папку…');
  await saveOutput(exported,'Phoenix_VR_Avatar.glb','model/gltf-binary',(done,total)=>{
   if(total>10*1024*1024)toast('Сохранение GLB: '+Math.round(done/total*100)+'%');
  });
  toast('GLB сохранён: '+info.meshes+' мешей, '+expected.length+' добавленных деталей. Они остаются отдельными мешами, не объединены с кожей.');
 }catch(e){
  if(String(e).includes('SAVE_CANCELLED'))toast('Сохранение отменено.');
  else error(e);
 }finally{btn.disabled=false;}
});
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',async e=>{e.preventDefault();const f=[...(e.dataTransfer?.files||[])].find(f=>f.name.toLowerCase().endsWith('.glb'));if(f)try{await loadBase(f)}catch(err){error(err)}});
