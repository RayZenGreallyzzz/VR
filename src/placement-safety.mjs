export const MAX_WING_VERTICES = 100_000;

/** Hard-limit screen-filling imported accessories relative to the avatar. */
export function limitAccessoryScale(requested,sourceSpan,avatarHeight,type='accessory'){
 if(![requested,sourceSpan,avatarHeight].every(Number.isFinite)||requested<=0||sourceSpan<=0||avatarHeight<=0)throw new Error('Invalid scale bounds');
 const ratio=type==='wings'?3:type==='tail'?2:1.6;
 const cap=Math.min(4,ratio*avatarHeight/sourceSpan);
 return {scale:Math.min(Math.max(0.00001,requested),cap),maxScale:cap,limited:requested>cap};
}
export function parseScaleText(input){
 const str=String(input).trim().replace(',','.');
 if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(str))throw new Error('Масштаб должен быть положительным числом');
 const n=Number(str);
 if(!Number.isFinite(n)||n<=0)throw new Error('Масштаб должен быть больше нуля');
 return n;
}
export function defaultAnchorPoint(box,anchor='back'){
 const center={x:(box.min.x+box.max.x)/2,z:(box.min.z+box.max.z)/2};
 const size={y:box.max.y-box.min.y};
 const y={head:.9,neck:.81,chest:.72,back:.70,hips:.48}[anchor]??.70;
 return {x:center.x,y:box.min.y+size.y*y,z:center.z};
}
