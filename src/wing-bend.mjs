// Two-wing root fold. Mirror the wing halves around a central hinge.
// All math is performed in accessory-local coordinates; positive direction
// folds toward positive depth, negative direction toward negative depth.
// Existing UVs and rigging attributes are not altered by this transform.
export const WING_AXES = Object.freeze(['x','y','z']);
export function wingDepthAxis(spanAxis='x'){return spanAxis==='z'?'x':'z';}
export function bendWingPoint(point,{
 centerX=0,centerDepth=0,halfSpan=1,hingeFraction=.08,
 bendDegrees=0,stretch=1,spanAxis='x',direction=1
}={}){
 if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite))throw new Error('Invalid wing vertex');
 if(!WING_AXES.includes(spanAxis))throw new Error('Unknown wing span axis');
 if(![centerX,centerDepth,halfSpan,hingeFraction,bendDegrees,stretch,direction].every(Number.isFinite))
  throw new Error('Invalid wing deformation value');
 if(halfSpan<=0||stretch<=0||hingeFraction<0||hingeFraction>=1||![1,-1].includes(direction))
  throw new Error('Invalid wing deformation range');
 const indices={x:0,y:1,z:2};
 const spanIndex=indices[spanAxis],depthIndex=indices[wingDepthAxis(spanAxis)];
 const span=point[spanIndex],depth=point[depthIndex],offset=span-centerX;
 const hinge=halfSpan*hingeFraction;
 if(Math.abs(offset)<=hinge || (bendDegrees===0 && stretch===1))return [...point];
 const side=offset>0?1:-1,hingePos=centerX+side*hinge;
 const radial=span-hingePos,depthOffset=depth-centerDepth;
 const radians=(bendDegrees*direction)*Math.PI/180;
 const cosine=Math.cos(radians),sine=Math.sin(radians);
 // Rotate both halves around their own vertical hinge with mirrored signs.
 // This preserves the width/thickness of each rigid half instead of shearing.
 const out=[...point];
 out[spanIndex]=hingePos+radial*stretch*cosine-side*depthOffset*sine;
 out[depthIndex]=centerDepth+Math.abs(radial)*stretch*sine+depthOffset*cosine;
 return out;
}
