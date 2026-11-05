// OKLCH -> sRGB and WCAG contrast, with no dependencies.
//
// The palette in styles.css is generated perceptually and then verified as a
// set. This file is the arithmetic; scripts/check-palette.mjs is the set of
// assertions. Keeping them in the repository is the point: a palette whose
// constraints live only in a comment is a palette that drifts.
// OKLCH -> sRGB hex, plus WCAG contrast. No deps.
const m1=[[1,0.3963377774,0.2158037573],[1,-0.1055613458,-0.0638541728],[1,-0.0894841775,-1.2914855480]];
const m2=[[4.0767416621,-3.3077115913,0.2309699292],[-1.2684380046,2.6097574011,-0.3413193965],[-0.0041960863,-0.7034186147,1.7076147010]];
function oklchToRgb(L,C,H){
  const h=H*Math.PI/180, a=C*Math.cos(h), b=C*Math.sin(h);
  const lab=[L,a,b];
  const lms=m1.map(r=>r[0]*lab[0]+r[1]*lab[1]+r[2]*lab[2]).map(v=>v**3);
  const lin=m2.map(r=>r[0]*lms[0]+r[1]*lms[1]+r[2]*lms[2]);
  return lin.map(v=>{
    const s=v<=0.0031308?12.92*v:1.055*Math.pow(Math.max(v,0),1/2.4)-0.055;
    return Math.round(Math.min(1,Math.max(0,s))*255);
  });
}
function clipped(L,C,H){
  const h=H*Math.PI/180, a=C*Math.cos(h), b=C*Math.sin(h);
  const lms=m1.map(r=>r[0]*L+r[1]*a+r[2]*b).map(v=>v**3);
  const lin=m2.map(r=>r[0]*lms[0]+r[1]*lms[1]+r[2]*lms[2]);
  return lin.some(v=>v<-0.0005||v>1.0005);
}
export function hex(L,C,H){
  const [r,g,b]=oklchToRgb(L,C,H);
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0').toUpperCase()).join('');
}
export function inGamut(L,C,H){ return !clipped(L,C,H); }
// Largest in-gamut chroma at this L/H, to 0.001
export function maxC(L,H){ let lo=0,hi=0.45; for(let i=0;i<40;i++){const mid=(lo+hi)/2; if(inGamut(L,mid,H)) lo=mid; else hi=mid;} return Math.floor(lo*1000)/1000; }
function lum(h){
  const [r,g,b]=h.replace('#','').match(/../g).map(v=>parseInt(v,16)/255)
    .map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));
  return 0.2126*r+0.7152*g+0.0722*b;
}
export function cr(a,b){const l1=lum(a),l2=lum(b);return +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05))).toFixed(2);}
export function okL(h){ // sRGB hex -> OKLCH L, for surface separation checks
  const lin=h.replace('#','').match(/../g).map(v=>parseInt(v,16)/255)
    .map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));
  const M=[[0.4122214708,0.5363325363,0.0514459929],[0.2119034982,0.6806995451,0.1073969566],[0.0883024619,0.2817188376,0.6299787005]];
  const lms=M.map(r=>r[0]*lin[0]+r[1]*lin[1]+r[2]*lin[2]).map(v=>Math.cbrt(v));
  return +(0.2104542553*lms[0]+0.7936177850*lms[1]-0.0040720468*lms[2]).toFixed(4);
}
