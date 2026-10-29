// Piecewise wing root hinge: bend each half about its inner hinge line.
// Positions and dimensions are in the attachment-local coordinate space.
export function bendWingPoint(point,{centerX=0,halfSpan=1,hingeFraction=0.08,bendDegrees=0,stretch=1}={}){
 const [x,y,z]=point;
 if(![x,y,z,centerX,halfSpan,hingeFraction,bendDegrees,stretch].every(Number.isFinite))throw new Error('Invalid wing deformation value');
 if(halfSpan<=0||stretch<=0||hingeFraction<0||hingeFraction>=1)throw new Error('Invalid wing deformation range');
 const d=Math.abs(x-centerX),hinge=halfSpan*hingeFraction,sign=Math.sign(x-centerX)||1;
 if(d<=hinge)return [x,y,z];
 const s=(d-hinge)*stretch,angle=bendDegrees*Math.PI/180;
 return [centerX+sign*(hinge+s*Math.cos(angle)),y,z+s*Math.sin(angle)];
}
