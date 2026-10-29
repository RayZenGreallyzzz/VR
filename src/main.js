import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {selectAnchorBone, inspectAvatar, PART_ANCHORS, makePartConfig, exportProjectMetadata} from './avatar-core.mjs';
import {captureWingGeometry,deformWingGeometry} from './wing-geometry.mjs';
import {saveOutput} from './save-output.mjs';

const $ = id => document.getElementById(id);
const canvas=$('canvas');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
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
let base=null,modelName='',clips=[],parts=[],selection=null,serial=0;
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
renderer.setAnimationLoop(()=>{orbit.update();renderer.render(scene,camera);});
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
 for(const p of parts)p.container.parent?.remove(p.container);
 parts=[];selection=null;
 if(base){avatar.remove(base);dispose(base);}
 base=gltf.scene;base.name='BaseAvatar';avatar.add(base);modelName=file.name||'avatar.glb';clips=gltf.animations||[];
 centerView();writeMetrics();writeMorphs();renderParts();
 toast('Модель загружена: '+modelName+'. Можно добавлять волосы и аксессуары.');
}
function selected(){return parts.find(p=>p.id===selection)||null;}
function placePart(p){
 p.container.position.fromArray(p.config.position);
 p.container.rotation.set(...p.config.rotation.map(THREE.MathUtils.degToRad));
 p.container.scale.setScalar(p.config.scale);p.container.visible=p.config.visible;
}
function readObjectTransform(p){
 p.config.position=p.container.position.toArray();
 p.config.rotation=[p.container.rotation.x,p.container.rotation.y,p.container.rotation.z].map(THREE.MathUtils.radToDeg);
 p.config.scale=p.container.scale.x;
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
  ['wingHinge',p.config.hingeFraction,'hingeValue']
 ]){
  $(id).value=String(val);
  $(label).textContent=id==='wingBend'?val+'°':Math.round(val*100)+'%';
 }
}
function updateWingDeformation(){
 const p=selected();
 if(!p?.wingSource)return;
 p.config.bendDegrees=Number($('wingBend').value);
 p.config.wingStretch=Number($('wingStretch').value);
 p.config.hingeFraction=Number($('wingHinge').value);
 deformWingGeometry(p.wingSource,p.config);
 syncWingSliders(p);
}
for(const id of ['wingBend','wingStretch','wingHinge'])$(id).addEventListener('input',updateWingDeformation);
$('resetWings').addEventListener('click',()=>{
 const p=selected();if(!p?.wingSource)return;
 p.config.bendDegrees=0;p.config.wingStretch=1;p.config.hingeFraction=.08;
 deformWingGeometry(p.wingSource,p.config);syncWingSliders(p);
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
 if(p)updateTransformFields(p);
 $('wingTools').hidden=!(p?.config.type==='wings'&&p?.wingSource);
 if(p?.wingSource)syncWingSliders(p);
}
async function addPart(file){
 if(!base){toast('Сначала загрузите основную модель');return;}
 const kind=$('kind').value,anchor=$('anchor').value,loaded=await parseGLB(file);
 const config=makePartConfig({id:'part-'+(++serial),name:file.name,type:kind,anchor});
 const bone=selectAnchorBone(base,anchor);
 const container=new THREE.Group();container.name='Attachment:'+config.name;
 container.userData.avatarPart={id:config.id,type:kind,anchor};
 container.add(loaded.scene);(bone||base).add(container);
 const p={id:config.id,config,container};
 placePart(p);
 if(kind==='wings'){
  p.wingSource=captureWingGeometry(container);
  if(!p.wingSource)toast('В модели крыльев не обнаружен меш для сгибания.');
 }
 parts.push(p);selection=p.id;renderParts();
 toast(bone?'Деталь закреплена на '+bone.name+'. Отрегулируй положение.':'Кость не найдена, деталь добавлена к корню модели.');
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
 const pos=['pX','pY','pZ'].map(read),rot=['rX','rY','rZ'].map(read),scale=read('pScale');
 if(![...pos,...rot,scale].every(Number.isFinite)||scale<=0){toast('Нужны корректные числа и положительный масштаб.');return;}
 p.config.position=pos;p.config.rotation=rot;p.config.scale=scale;
 placePart(p);
}
for(const id of ['pX','pY','pZ','rX','rY','rZ']) $(id).addEventListener('change',applyTypedTransform);
$('pScale').addEventListener('input',applyTypedTransform);
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
 if(what==='all')p.config.scale=1;
 placePart(p);updateTransformFields(p);
}
$('resetPosition').addEventListener('click',()=>resetTransform('position'));
$('resetRotation').addEventListener('click',()=>resetTransform('rotation'));
$('resetAll').addEventListener('click',()=>resetTransform('all'));
$('delPart').addEventListener('click',()=>{const p=selected();if(!p)return;transform.detach();p.container.parent?.remove(p.container);dispose(p.container);parts=parts.filter(x=>x!==p);selection=parts.at(-1)?.id||null;renderParts();});
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
 const btn=$('exportGlb');btn.disabled=true;toast('Запекание добавленных деталей в GLB…');
 try{
  // All attached accessory meshes belong to the avatar export hierarchy.
  // Deformed wing geometry is already real BufferGeometry, not a shader effect.
  const exported=await new Promise((resolve,reject)=>new GLTFExporter().parse(avatar,resolve,reject,{
   binary:true,onlyVisible:true,animations:clips
  }));
  const roundtrip=await new Promise((resolve,reject)=>loader.parse(exported,'',resolve,reject));
  const expected=parts.filter(p=>p.config.visible).length;
  let recovered=0;
  roundtrip.scene.traverse(o=>{if(o.name?.startsWith('Attachment:'))recovered++;});
  if(recovered<expected)throw new Error('Проверка запекания: найдено '+recovered+' деталей из '+expected+'. Сохранение отменено.');
  const info=inspectAvatar(roundtrip.scene);
  if(info.meshes<1)throw new Error('GLB после повторного открытия не содержит мешей.');
  toast('Проверено: '+recovered+'/'+expected+' деталей внутри GLB. Выбери папку…');
  await saveOutput(exported,'Phoenix_VR_Avatar.glb','model/gltf-binary',(done,total)=>{
   if(total>10*1024*1024)toast('Сохранение GLB: '+Math.round(done/total*100)+'%');
  });
  toast('GLB сохранён: '+info.meshes+' мешей, '+recovered+' добавленных деталей. Они остаются отдельными мешами, не объединены с кожей.');
  dispose(roundtrip.scene);
 }catch(e){
  if(String(e).includes('SAVE_CANCELLED'))toast('Сохранение отменено.');
  else error(e);
 }finally{btn.disabled=false;}
});
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',async e=>{e.preventDefault();const f=[...(e.dataTransfer?.files||[])].find(f=>f.name.toLowerCase().endsWith('.glb'));if(f)try{await loadBase(f)}catch(err){error(err)}});
