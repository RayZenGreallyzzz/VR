import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {selectAnchorBone, inspectAvatar, PART_ANCHORS, makePartConfig, exportProjectMetadata} from './avatar-core.mjs';

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
const toast=message=>{$('toast').textContent=message;};
const error=e=>{console.error(e);toast('Ошибка: '+(e?.message||String(e)));};
const saveFile=(bytes,name,type)=>{
 const blob=bytes instanceof Blob?bytes:new Blob([bytes],{type});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
};
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
function renderParts(){
 $('partsPanel').hidden=parts.length===0;const list=$('partList');list.replaceChildren();
 for(const p of parts){
  const row=document.createElement('div');row.className='part'+(p.id===selection?' active':'');
  const btn=document.createElement('button');btn.className='part-name';btn.textContent=p.config.name+' · '+p.config.type;btn.addEventListener('click',()=>{selection=p.id;renderParts();});row.append(btn);
  const visibility=document.createElement('span');visibility.textContent=p.config.visible?'👁':'—';row.append(visibility);list.append(row);
 }
 const p=selected();$('partEditor').hidden=!p;
 if(p)for(const [id,value] of Object.entries({pScale:p.config.scale,pX:p.config.position[0],pY:p.config.position[1],pZ:p.config.position[2],pRot:p.config.rotation[1]}))$(id).value=value;
}
async function addPart(file){
 if(!base){toast('Сначала загрузите основную модель');return;}
 const kind=$('kind').value,anchor=$('anchor').value,loaded=await parseGLB(file);
 const config=makePartConfig({id:'part-'+(++serial),name:file.name,type:kind,anchor});
 const bone=selectAnchorBone(base,anchor);
 const container=new THREE.Group();container.name='Attachment:'+config.name;
 container.userData.avatarPart={id:config.id,type:kind,anchor};
 container.add(loaded.scene);(bone||base).add(container);
 const p={id:config.id,config,container};placePart(p);parts.push(p);selection=p.id;renderParts();
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
for(const id of ['pScale','pX','pY','pZ','pRot']) $(id).addEventListener('input',()=>{
 const p=selected();if(!p)return;
 p.config.position=[+$('pX').value,+$('pY').value,+$('pZ').value];
 p.config.rotation=[0,+$('pRot').value,0];p.config.scale=+$('pScale').value;placePart(p);
});
$('delPart').addEventListener('click',()=>{const p=selected();if(!p)return;p.container.parent?.remove(p.container);dispose(p.container);parts=parts.filter(x=>x!==p);selection=parts.at(-1)?.id||null;renderParts();});
$('togglePart').addEventListener('click',()=>{const p=selected();if(!p)return;p.config.visible=!p.config.visible;placePart(p);renderParts();});
$('saveJson').addEventListener('click',()=>{
 if(!base){toast('Нет проекта для сохранения');return;}
 saveFile(JSON.stringify(exportProjectMetadata(parts.map(p=>p.config),modelName),null,2),'phoenix-avatar-settings.json','application/json');
 toast('Настройки сохранены. Исходные файлы GLB храните отдельно.');
});
$('exportGlb').addEventListener('click',async()=>{
 if(!base){toast('Сначала загрузите модель');return;}
 const btn=$('exportGlb');btn.disabled=true;toast('Экспорт GLB…');
 try{
  const output=await new Promise((resolve,reject)=>new GLTFExporter().parse(avatar,resolve,reject,{binary:true,onlyVisible:false,animations:clips}));
  saveFile(output,'Phoenix_VR_Avatar.glb','model/gltf-binary');
  toast('GLB экспортирован. Для VRChat потребуется Unity + VRChat SDK.');
 }catch(e){error(e)}finally{btn.disabled=false;}
});
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',async e=>{e.preventDefault();const f=[...(e.dataTransfer?.files||[])].find(f=>f.name.toLowerCase().endsWith('.glb'));if(f)try{await loadBase(f)}catch(err){error(err)}});
