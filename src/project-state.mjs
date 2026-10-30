import {makePartConfig,assertPartTransform} from './avatar-core.mjs';
export const PROJECT_SCHEMA='phoenix-vr-editable';
export function serializeProject(parts,modelName=''){
 const attachments=parts.map(p=>{
  const source=p.config||p;
  return assertPartTransform(makePartConfig(source));
 });
 return {schema:PROJECT_SCHEMA,version:2,baseModelName:String(modelName),attachments,
  savedAt:new Date().toISOString(),note:'Самодостаточный GLB: геометрия и слои деталей внутри файла. Модификатор запечён в вершины.'};
}
export function readEmbeddedProject(root){
 let data=null;
 root?.traverse?.(o=>{
  if(o.userData?.phoenixProject?.schema===PROJECT_SCHEMA)data=o.userData.phoenixProject;
 });
 if(!data)return null;
 if(data.version!==2||!Array.isArray(data.attachments)||data.attachments.length>500)
  throw new Error('Неподдерживаемая версия проекта');
 const ids=new Set();
 const attachments=data.attachments.map(record=>{
  const part=assertPartTransform(makePartConfig(record));
  if(!part.id||ids.has(part.id))throw new Error('Повторяются идентификаторы деталей проекта');
  ids.add(part.id);
  return part;
 });
 return {...data,attachments};
}
export class TransformHistory {
 constructor(limit=80){this.limit=limit;this.states=[];this.index=-1;}
 clear(){this.states=[];this.index=-1;}
 record(snapshot){
  const json=JSON.stringify(snapshot);
  if(this.states[this.index]===json)return false;
  this.states=this.states.slice(0,this.index+1);
  this.states.push(json);
  if(this.states.length>this.limit)this.states.shift();
  this.index=this.states.length-1;
  return true;
 }
 get canUndo(){return this.index>0;}
 get canRedo(){return this.index>=0&&this.index<this.states.length-1;}
 undo(){if(!this.canUndo)return null;return JSON.parse(this.states[--this.index]);}
 redo(){if(!this.canRedo)return null;return JSON.parse(this.states[++this.index]);}
}
