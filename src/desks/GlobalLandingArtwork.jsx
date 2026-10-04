import { useEffect, useId, useRef } from 'react';
import { WORLD_PATHS } from './globalLandingGeometry.js';

const INK = '#1e2a5a';
const PALETTES = [['#e3ebff', '#bdccff'], ['#ece3ff', '#cabaff'], ['#ddf4f0', '#a9dcd4'], ['#fff0da', '#ffd59d'], ['#ffe1e7', '#ffbfcd']];

export function GlobalTile({ scene }) {
  const id = useId().replace(/:/g, '');
  const index = ['radar', 'flags', 'satellite', 'mine', 'port'].indexOf(scene);
  const colors = PALETTES[Math.max(0, index)];
  return <svg className="tile" viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <defs><linearGradient id={`${id}-fill`} x2="1" y2="1"><stop stopColor={colors[0]}/><stop offset="1" stopColor={colors[1]}/></linearGradient><radialGradient id={`${id}-light`} cx=".8" cy=".2" r=".8"><stop stopColor="#fff" stopOpacity=".55"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></radialGradient></defs>
    <rect width="240" height="110" fill={`url(#${id}-fill)`}/><rect width="240" height="110" fill={`url(#${id}-light)`}/>
    {scene === 'radar' && <g transform="translate(176 56)"><g fill="none" stroke={INK} strokeOpacity=".5" strokeWidth="1.5"><circle r="44"/><circle r="30"/><circle r="16"/><path d="M-44 0 H44 M0 -44 V44"/></g><path className="gl-sweep" d="M0 0 L44 0 A44 44 0 0 0 22 -38 Z" fill={INK} fillOpacity=".35"/>{[[-18,-20],[26,12],[-8,30]].map(([x,y],i)=><circle className={`gl-blip b${i}`} key={x} cx={x} cy={y} r="3.5" fill="#fff"/>)}<circle r="3" fill={INK}/></g>}
    {scene === 'flags' && <><g stroke={INK} strokeWidth="3" strokeLinecap="round" strokeOpacity=".85"><path d="M140 104 V22 M176 104 V14 M212 104 V22"/></g>{['M141 24 Q158 20 172 26 V48 Q158 42 141 46 Z','M177 16 Q194 12 208 18 V40 Q194 34 177 38 Z','M213 24 Q230 20 244 26 V48 Q230 42 213 46 Z'].map((d,i)=><g className="gl-pennant" key={d} style={{animationDelay:`${i*.4}s`}}><path d={d} fill={i===1?INK:'#fff'} fillOpacity=".95"/></g>)}<rect x="120" y="104" width="120" height="6" rx="3" fill={INK} fillOpacity=".3"/></>}
    {scene === 'satellite' && <><circle cx="176" cy="150" r="82" fill={INK} fillOpacity=".85"/><circle cx="176" cy="150" r="90" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2"/><ellipse cx="176" cy="66" rx="60" ry="22" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.5" strokeDasharray="3 5"/><g className="gl-orbit"><g transform="translate(236 66)"><rect x="-6" y="-5" width="12" height="10" rx="2" fill="#fff"/><g fill={INK}><rect x="-20" y="-3" width="12" height="6" rx="1"/><rect x="8" y="-3" width="12" height="6" rx="1"/></g></g></g></>}
    {scene === 'mine' && <><g fill={INK}><path d="M110 110 L150 70 H240 V110 Z" fillOpacity=".85"/><path d="M130 110 L162 84 H240 V110 Z" fillOpacity=".55"/><path d="M150 110 L176 96 H240 V110 Z" fillOpacity=".35"/></g><g className="gl-crystal"><path d="M190 22 L206 40 L198 70 L182 70 L174 40 Z" fill="#fff" fillOpacity=".95"/><path d="M190 22 L190 70" stroke={INK} strokeOpacity=".25" strokeWidth="2"/></g><path className="gl-spark" d="M218 30 l3 6 6 3 -6 3 -3 6 -3 -6 -6 -3 6 -3 z" fill="#fff"/></>}
    {scene === 'port' && <><g stroke={INK} strokeWidth="3" strokeLinecap="round" strokeOpacity=".85" fill="none"><path d="M226 96 V22 L196 40 M226 30 H206"/></g><g className="gl-ship"><path d="M118 84 L128 100 H198 L206 84 Z" fill={INK} fillOpacity=".9"/><g fill="#fff" fillOpacity=".95">{[[130,70],[148,70],[166,70],[139,57],[157,57]].map(([x,y])=><rect key={`${x}-${y}`} x={x} y={y} width="16" height="12" rx="1"/>)}</g><rect x="186" y="60" width="12" height="22" rx="2" fill="#fff" fillOpacity=".7"/></g><path className="gl-wave" d="M0 100 Q15 92 30 100 T60 100 T90 100 T120 100 T150 100 T180 100 T210 100 T240 100 T270 100 T300 100 V110 H0 Z" fill="#fff" fillOpacity=".55"/><path className="gl-wave gl-wave2" d="M0 104 Q15 98 30 104 T60 104 T90 104 T120 104 T150 104 T180 104 T210 104 T240 104 T270 104 T300 104 V110 H0 Z" fill={INK} fillOpacity=".35"/></>}
  </svg>;
}

let dots;
function landDots() {
  if (dots) return dots;
  const polygons = WORLD_PATHS.map(path => [...path.matchAll(/[ML]\s*([\d.]+)\s+([\d.]+)/g)].map(match => [+match[1], +match[2]]));
  const inside = (x,y) => polygons.some(poly => {
    let hit = false;
    for (let i=0,j=poly.length-1;i<poly.length;j=i++) {
      const [xi,yi]=poly[i], [xj,yj]=poly[j];
      if ((yi>y)!==(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi) hit=!hit;
    }
    return hit;
  });
  dots=[];
  for(let lat=-58;lat<=80;lat+=3.4) for(let lon=-180;lon<180;lon+=3.4/Math.max(.25,Math.cos(lat*Math.PI/180))) if(inside((lon+180)/360*1000,(90-lat)/180*460)) dots.push([lon*Math.PI/180,lat*Math.PI/180]);
  return dots;
}

export default function GlobalGlobe() {
  const ref=useRef(null);
  useEffect(()=>{
    const canvas=ref.current, ctx=canvas?.getContext('2d');
    if(!ctx) return;
    const root=canvas.closest('.national-landing'), backdrop=canvas.closest('.backdrop');
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    let raf=0, elapsed=0, last=0, width=0, height=0;
    const enabled=()=>!document.hidden&&!reduced.matches&&root?.dataset.motion==='on'&&backdrop?.dataset.offscreen!=='true';
    const draw=()=>{
      const R=Math.min(width,height)*.4,cx=width/2,cy=height/2,ct=Math.cos(-.42),st=Math.sin(-.42),rot=.6+elapsed*.09;
      ctx.clearRect(0,0,width,height);
      const halo=ctx.createRadialGradient(cx,cy,R*.9,cx,cy,R*1.18);halo.addColorStop(0,'rgba(121,150,255,.35)');halo.addColorStop(1,'rgba(121,150,255,0)');
      ctx.fillStyle=halo;ctx.beginPath();ctx.arc(cx,cy,R*1.18,0,Math.PI*2);ctx.fill();
      const ocean=ctx.createRadialGradient(cx-R*.35,cy-R*.4,R*.1,cx,cy,R);ocean.addColorStop(0,'#f4f7ff');ocean.addColorStop(1,'#cbd8fb');
      ctx.fillStyle=ocean;ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(29,63,184,.10)';ctx.lineWidth=1;
      for(let k=-2;k<=2;k++){const y=Math.sin(k*Math.PI/7),r=R*Math.sqrt(1-y*y);ctx.beginPath();ctx.ellipse(cx,cy-y*R*ct,r,Math.max(.5,r*Math.abs(st)),0,0,Math.PI*2);ctx.stroke();}
      for(const [longitude,lat] of landDots()){const lon=longitude+rot,x=Math.cos(lat)*Math.sin(lon),y=Math.sin(lat),z=Math.cos(lat)*Math.cos(lon),y2=y*ct-z*st,z2=y*st+z*ct;if(z2<=0)continue;ctx.fillStyle=`rgba(29,63,184,${.18+.82*z2})`;ctx.beginPath();ctx.arc(cx+x*R,cy-y2*R,1.15+1.35*z2,0,Math.PI*2);ctx.fill();}
      ctx.save();ctx.translate(cx,cy);ctx.rotate(-.35);ctx.strokeStyle='rgba(76,43,179,.25)';ctx.setLineDash([3,6]);ctx.beginPath();ctx.ellipse(0,0,R*1.28,R*.34,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#4c2bb3';ctx.beginPath();ctx.arc(Math.cos(elapsed*.5)*R*1.28,Math.sin(elapsed*.5)*R*.34,3.2,0,Math.PI*2);ctx.fill();ctx.restore();
    };
    const frame=now=>{raf=0;if(!enabled()){last=0;return;}if(last)elapsed+=(now-last)/1000;last=now;draw();raf=requestAnimationFrame(frame);};
    const sync=()=>{cancelAnimationFrame(raf);raf=0;last=0;canvas.dataset.animating=String(enabled());if(enabled())raf=requestAnimationFrame(frame);else draw();};
    const resize=()=>{width=canvas.clientWidth;height=canvas.clientHeight;const dpr=Math.min(2,devicePixelRatio||1);canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);sync();};
    const observer=new MutationObserver(sync);if(root)observer.observe(root,{attributes:true,attributeFilter:['data-motion']});if(backdrop)observer.observe(backdrop,{attributes:true,attributeFilter:['data-offscreen']});
    const sizes=new ResizeObserver(resize);sizes.observe(canvas);reduced.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);resize();
    return()=>{cancelAnimationFrame(raf);observer.disconnect();sizes.disconnect();reduced.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);};
  },[]);
  return <div className="bgglobe"><canvas ref={ref} className="globe" aria-hidden="true"/></div>;
}
