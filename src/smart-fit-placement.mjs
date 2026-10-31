import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {MAX_GARMENT_VERTICES} from './clothing-weights.mjs';

// SmartFit v1.3: profile-based placement, THEN optional conservative collision
// relief. Never shrink an entire garment onto the nearest surface: that
// destroys sleeves, skirt volume, and leg openings.
const clamp=(x,min,max)=>Math.min(max,Math.max(min,x));
const yieldFrame=()=>new Promise(resolve=>typeof requestAnimationFrame==='function'
 ?requestAnimationFrame(resolve):setTimeout(resolve,0));
function percentile(values,p){
 if(!values.length)return null;
 values.sort((a,b)=>a-b);
 return values[Math.min(values.length-1,Math.floor((values.length-1)*p))];
}
function sampledBodyProfile(body,box){
 const attr=body.geometry?.getAttribute('position');
 if(!attr?.count)throw new Error('У выбранного тела нет вершин');
 const h=box.max.y-box.min.y;
 if(h<.1)throw new Error('Некорректная высота тела');
 const cx=(box.min.x+box.max.x)/2,cz=(box.min.z+box.max.z)/2;
 const mid=(box.min.y+box.max.y)/2;
 const maxR=h*.145,step=Math.max(1,Math.floor(attr.count/22000));
 const rTorso=[],rHips=[],zTorso=[],zHips=[];
 const point=new THREE.Vector3();
 body.updateWorldMatrix(true,false);
 for(let i=0;i<attr.count;i+=step){
  point.fromBufferAttribute(attr,i).applyMatrix4(body.matrixWorld);
  const q=(point.y-box.min.y)/h;
  const r=Math.abs(point.x-cx),z=Math.abs(point.z-cz);
  // Arms can cross torso Y even on A-posed models. Restrict to the
  // central silhouette rather than the full character's arm span.
  if(r>maxR)continue;
  if(q>=.50&&q<=.67){rTorso.push(r);zTorso.push(z);}
  if(q>=.39&&q<=.56){rHips.push(r);zHips.push(z);}
 }
 const safe=(values,fallback)=>Math.max(fallback,percentile(values,.88)||0);
 return {box,cx,cz,h,mid,
  torsoR:safe(rTorso,h*.085),hipR:safe(rHips,h*.09),
  torsoZ:safe(zTorso,h*.065),hipZ:safe(zHips,h*.07),
  torsoSamples:rTorso.length,hipSamples:rHips.length};
}
function inspectGarment(root,style){
 const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});
 if(!meshes.length||meshes.some(m=>m.isSkinnedMesh))
  throw new Error('Нужен незариганный GLB-элемент одежды');
 const total=meshes.reduce((sum,m)=>sum+(m.geometry?.getAttribute('position')?.count||0),0);
 if(!total||total>MAX_GARMENT_VERTICES)
  throw new Error('Слишком тяжёлая одежда: '+total+' вершин, максимум '+MAX_GARMENT_VERTICES);
 root.updateWorldMatrix(true,true);
 const box=new THREE.Box3().setFromObject(root),height=box.max.y-box.min.y;
 if(height<=1e-6)throw new Error('У одежды отсутствует высота');
 const gx=(box.min.x+box.max.x)/2,gz=(box.min.z+box.max.z)/2;
 const radii=[],depths=[];
 const point=new THREE.Vector3();
 const band=style==='skirt'?[.77,1.005]:style==='pants'?[.75,1.005]:
  style==='dress'?[.65,.93]:[.18,.53];
 for(const mesh of meshes){
  const attr=mesh.geometry.getAttribute('position'),step=Math.max(1,Math.floor(attr.count/12000));
  for(let i=0;i<attr.count;i+=step){
   point.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);
   const q=(point.y-box.min.y)/height;
   if(q<band[0]||q>band[1])continue;
   const rx=Math.abs(point.x-gx);
   // Do not count T-pose sleeves as the width of a shirt's torso.
   if(style==='top' && rx>height*.43)continue;
   radii.push(rx);depths.push(Math.abs(point.z-gz));
  }
 }
 const halfWidth=percentile(radii,.85)||Math.max((box.max.x-box.min.x)*.17,.01);
 const halfDepth=percentile(depths,.85)||Math.max((box.max.z-box.min.z)*.30,.01);
 return {meshes,total,box,height,gx,gz,halfWidth,halfDepth};
}
function positionRootByWorldDelta(root,delta){
 const parent=root.parent;
 if(parent){
  parent.updateWorldMatrix(true,false);
  const old=root.getWorldPosition(new THREE.Vector3());
  root.position.copy(parent.worldToLocal(old.add(delta)));
 }else root.position.add(delta);
 root.updateWorldMatrix(true,true);
}
const TOP={dress:.82,top:.82,skirt:.53,pants:.53};
export async function fitClothingByProfile(root,body,cage,{
 style='dress',strength=.72,clearance=.012,
 yieldControl=yieldFrame,onProgress=()=>{},chunkSize=1500
}={}){
 if(!['dress','top','skirt','pants'].includes(style))throw new Error('Выбери тип одежды');
 if(!Number.isFinite(strength)||strength<0||strength>1)throw new Error('Неверная сила облегания');
 if(!Number.isFinite(clearance)||clearance<=0)throw new Error('Неверный зазор одежды');
 if(!body?.isMesh||!cage?.mesh?.isMesh)throw new Error('Сначала подготовь Body Cage');
 const g=inspectGarment(root,style),bodyBox=new THREE.Box3().setFromObject(body),b=sampledBodyProfile(body,bodyBox);
 const oldPosition=root.position.clone(),oldScale=root.scale.clone();
 const backups=g.meshes.map(mesh=>({mesh,geometry:mesh.geometry.clone()}));
 let surfaceGeo=null;
 try{
  const targetRadius=style==='pants'||style==='skirt'?b.hipR:b.torsoR;
  const targetDepth=style==='pants'||style==='skirt'?b.hipZ:b.torsoZ;
  // Uniform scale retains garment design, thickness, and sleeve openings.
  // Unlike v1.2 this width ignores protruding arms and remains valid with
  // the head/hair cut away from the collision cage.
  const ratio=clamp(targetRadius*1.14/Math.max(.005,g.halfWidth),.13,6);
  root.scale.multiplyScalar(ratio);
  root.updateWorldMatrix(true,true);
  const fittedBox=new THREE.Box3().setFromObject(root);
  const center=fittedBox.getCenter(new THREE.Vector3());
  const targetTop=bodyBox.min.y+b.h*TOP[style];
  positionRootByWorldDelta(root,new THREE.Vector3(
   b.cx-center.x,targetTop-fittedBox.max.y,b.cz-center.z
  ));
  // At this point placement is already usable even if expensive surface
  // collision relief is unavailable. Do not ever pull fabric inward.
  let modified=0,checked=0;
  if(strength>0){
   surfaceGeo=cage.mesh.geometry.clone();
   cage.mesh.updateWorldMatrix(true,false);
   surfaceGeo.applyMatrix4(cage.mesh.matrixWorld);
   const bvh=new MeshBVH(surfaceGeo,{maxLeafTris:12});
   const hit={},world=new THREE.Vector3(),out=new THREE.Vector3();
   const maxDist=b.h*.085,limit=b.h*.045,bodyClearance=Math.min(clearance,b.h*.02);
   const staged=[];
   for(const mesh of g.meshes){
    const attr=mesh.geometry.getAttribute('position'),next=new Float32Array(attr.count*3);
    // Meshy/Tripo may use normalized Uint16 or interleaved GLB positions.
    // Read decoded coordinates, not raw integer bytes: always promote the
    // edited position stream to float32 before exporting.
    for(let j=0;j<attr.count;j++){
     next[j*3]=attr.getX(j);next[j*3+1]=attr.getY(j);next[j*3+2]=attr.getZ(j);
    }
    const inverse=mesh.matrixWorld.clone().invert();
    for(let i=0;i<attr.count;i++){
     world.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);
     const q=(world.y-bodyBox.min.y)/b.h;
     const xDist=Math.abs(world.x-b.cx);
     // Never flatten sleeves, loose skirts or separate trouser legs.
     const isTorso=q>.45&&q<.84&&xDist<Math.max(b.torsoR*1.85,b.h*.14);
     const isHip=style==='pants'&&q>.40&&q<.60&&xDist<b.h*.25;
     if(isTorso||isHip){
      const nearest=bvh.closestPointToPoint(world,hit,0,maxDist);
      if(nearest){
       const r=Math.hypot(world.x-b.cx,world.z-b.cz);
       const hitR=Math.hypot(hit.point.x-b.cx,hit.point.z-b.cz);
       const amount=Math.min(limit,(hitR+bodyClearance-r)*strength);
       // Positive outward push only. No global suction or volume loss.
       if(amount>1e-6 && r>1e-5){
        out.set((world.x-b.cx)/r,0,(world.z-b.cz)/r);
        world.addScaledVector(out,amount).applyMatrix4(inverse);
        next[i*3]=world.x;next[i*3+1]=world.y;next[i*3+2]=world.z;
        modified++;
       }
      }
     }
     checked++;
     if(checked%chunkSize===0){onProgress(checked,g.total);await yieldControl();}
    }
    staged.push({mesh,next});
   }
   for(const {mesh,next} of staged){
    mesh.geometry=mesh.geometry.clone();
    mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(next,3));
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
   }
  }
  onProgress(g.total,g.total);
  return {scaleRatio:ratio,modified,vertices:g.total,
   bodyTorsoWidth:b.torsoR*2,garmentTorsoWidth:g.halfWidth*2*ratio,
   bodyHeight:b.h,garmentTop:targetTop,clearance:bodyClearanceOrDefault(clearance)};
 }catch(error){
  root.position.copy(oldPosition);root.scale.copy(oldScale);
  for(const {mesh,geometry} of backups){mesh.geometry.dispose();mesh.geometry=geometry;}
  root.updateWorldMatrix(true,true);
  throw error;
 }finally{
  surfaceGeo?.dispose();
  for(const {mesh,geometry} of backups)if(mesh.geometry!==geometry)geometry.dispose();
 }
}
function bodyClearanceOrDefault(clearance){return clearance;}
