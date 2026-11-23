/* NTER record transition. No dependencies; styles are isolated in Shadow DOM. */
(()=>{
 if(customElements.get('nter-record-loader'))return;
 const defaultLogo=new URL('logo.svg',document.currentScript?.src||location.href).href;
 class NterRecordLoader extends HTMLElement{
  constructor(){super();this.attachShadow({mode:'open'});this._version=0;}
  connectedCallback(){if(this.shadowRoot.childNodes.length)return;this.shadowRoot.innerHTML=`
  <style>
  :host{display:block;position:relative;min-height:470px;background:#fff;color:#252425;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;border-radius:inherit}
  *{box-sizing:border-box}.stage{min-height:470px;display:flex;align-items:center;justify-content:center;flex-direction:column;position:relative;padding:22px 24px 36px;text-align:center;isolation:isolate}
  .stage:before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 47% 39%,#572c9110,transparent 59%),radial-gradient(ellipse at 64% 43%,#e5d3bb50,transparent 50%);z-index:-1}
  .visual{width:min(350px,100%);height:310px;position:relative;margin-bottom:5px;display:grid;place-items:center}
  .aura{position:absolute;inset:40px 28px 35px;border-radius:50%;background:radial-gradient(ellipse at 35% 32%,#ddd2ee85,transparent 62%),radial-gradient(ellipse at 67% 60%,#ead7bc70,transparent 65%);filter:blur(21px)}
  .floor-shadow{position:absolute;bottom:11px;left:calc(50% - 84px);width:168px;height:21px;background:radial-gradient(ellipse,#54416725,transparent 70%);filter:blur(7px);animation:shadow-breathe 4.5s ease-in-out infinite}
  .scene{width:300px;height:280px;position:relative;perspective:760px;perspective-origin:50% 43%}
  .sculpture{position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(-9deg) rotateY(-15deg);animation:contemplate 4.5s cubic-bezier(.45,0,.55,1) infinite}
  .core{position:absolute;left:62px;top:52px;width:176px;height:176px;transform-style:preserve-3d;transform:translateZ(0)}
  .disc{position:absolute;inset:0;border-radius:50%;background:linear-gradient(135deg,#f2eaf7,#c7bfd9 55%,#efe1ce);box-shadow:inset 0 0 0 1px #ffffff70;transform:translateZ(var(--z))}
  .disc.front{background:radial-gradient(ellipse at 32% 22%,#ffffff 3%,#fbf9fd 42%,#e4dbee 77%,#bbaccd 100%);border:1px solid #fff;box-shadow:inset 2px 3px 6px white,inset -3px -4px 10px #78628725,0 0 0 1px #e3d9eb;transform:translateZ(12px)}
  .disc.front:before{content:'';position:absolute;inset:8px;border:1px solid #ffffffb0;border-radius:50%;border-bottom-color:#9478ab20;border-right-color:#9478ab20}
  .disc.front:after{content:'';position:absolute;left:25px;top:12px;width:83px;height:23px;border-radius:50%;background:radial-gradient(ellipse,#ffffffed,transparent 70%);transform:rotate(-28deg)}
  .logo,.logo-depth{position:absolute;width:100px;height:120px;left:38px;top:27px;object-fit:contain;transform:translateZ(var(--z,23px));backface-visibility:hidden}
  .logo-depth{filter:brightness(.53) saturate(.55)}
  .logo-shadow{position:absolute;inset:0;border-radius:50%;background:radial-gradient(ellipse at 53% 61%,#39225b2e,transparent 48%);transform:translateZ(12.1px)}
  .thought-tile{position:absolute;left:127px;top:113px;width:46px;height:54px;transform-style:preserve-3d;transform:translate3d(var(--x),var(--y),var(--depth)) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz));animation:absorb var(--ingest-duration,1500ms) cubic-bezier(.45,0,.3,1) both;animation-delay:var(--delay)}
  .tile-body{position:absolute;inset:0;transform-style:preserve-3d;}
  .tile-edge{position:absolute;inset:0;border-radius:9px;background:linear-gradient(135deg,#dfd5e9,#a895b8 65%,#d9c2a7);transform:translateZ(var(--layer))}
  .tile-face{position:absolute;inset:0;border-radius:9px;border:1px solid #fff;background:linear-gradient(135deg,#fff 10%,#f7f1fa 60%,#ddcfe9);box-shadow:inset 1px 1px 2px white,inset -1px -2px 3px #9573ad22,2px 7px 13px #40245212;transform:translateZ(5px);display:flex;flex-direction:column;align-items:flex-start;padding:9px;gap:5px}
  .tile-face svg{width:17px;height:17px;stroke:var(--ink,#572c91);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;margin-bottom:1px}
  .tile-face i{width:23px;height:2px;background:var(--ink,#572c91);opacity:.3;border-radius:2px}.tile-face i:last-child{width:15px;opacity:.18}
  .thought-tile.a{--x:-113px;--y:-71px;--from-x:-149px;--from-y:-96px;--depth:30px;--rx:12deg;--ry:-23deg;--rz:-14deg;--delay:calc(var(--delay-step,150ms) * 0);--float-delay:-.6s;--ink:#572c91}
  .thought-tile.b{--x:108px;--y:-88px;--from-x:139px;--from-y:-126px;--depth:-35px;--rx:-12deg;--ry:30deg;--rz:15deg;--delay:calc(var(--delay-step,150ms) * 1);--float-delay:-1.4s;--ink:#293fa5}
  .thought-tile.c{--x:119px;--y:51px;--from-x:157px;--from-y:74px;--depth:37px;--rx:8deg;--ry:26deg;--rz:13deg;--delay:calc(var(--delay-step,150ms) * 2);--float-delay:-2.1s;--ink:#ad7a45}
  .thought-tile.c .tile-face{background:linear-gradient(135deg,#fffefa,#f3e7d7 65%,#d9bd98)}
  .thought-tile.d{--x:-100px;--y:84px;--from-x:-133px;--from-y:120px;--depth:38px;--rx:-16deg;--ry:-28deg;--rz:-17deg;--delay:calc(var(--delay-step,150ms) * 3);--float-delay:-2.7s;--ink:#293fa5}
  .thought-tile.e{--x:16px;--y:-116px;--from-x:28px;--from-y:-152px;--depth:9px;--rx:25deg;--ry:23deg;--rz:18deg;--delay:calc(var(--delay-step,150ms) * 4);--float-delay:-.1s;width:29px;height:29px;left:135px;top:126px;--ink:#b83a48}
  .thought-tile.e .tile-face{padding:6px;background:linear-gradient(135deg,#fff9f6,#f2d4d7 65%,#c88a94)}.thought-tile.e .tile-face svg{width:15px;height:15px}.thought-tile.e .tile-face i{display:none}
  .eyebrow{color:#86758f;font-size:9px;letter-spacing:2.1px;font-weight:650;margin:0 0 10px}.title{font-size:28px;line-height:1.25;letter-spacing:-.9px;font-weight:600;margin:0;color:#29252d}.title span{color:#572c91}.dots{display:inline-flex;gap:3px;margin-left:3px;vertical-align:baseline}.dots i{width:4px;height:4px;border-radius:50%;background:#572c91;animation:dot 1.1s ease-in-out infinite}.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
  .caption{font-size:12px;line-height:1.6;color:#8c7d95;margin:13px 0 20px;max-width:320px;overflow-wrap:anywhere}.steps{display:flex;align-items:center;gap:8px;color:#a89bae;font-size:9px;letter-spacing:.7px;text-transform:uppercase}.step{display:flex;align-items:center;gap:6px;transition:color .4s}.step:before{content:'';height:5px;width:5px;border:1px solid currentColor;border-radius:50%;transition:background .4s,box-shadow .4s}.connector{height:1px;width:22px;background:#e8e0ed}.stage[data-phase="0"] .step:first-child,.stage[data-phase="1"] .step:nth-of-type(2),.stage[data-phase="2"] .step:last-child{color:#572c91}.stage[data-phase="0"] .step:first-child:before,.stage[data-phase="1"] .step:nth-of-type(2):before,.stage[data-phase="2"] .step:last-child:before{background:#572c91;box-shadow:0 0 0 4px #572c910a}
  .track{height:2px;width:190px;background:#eee9f2;border-radius:4px;overflow:hidden;margin-top:18px}.track i{display:block;width:45%;height:100%;border-radius:4px;background:linear-gradient(90deg,#293fa5,#572c91,#c2353d,#d4b997);animation:scan 1.5s ease-in-out infinite}.foot{margin:11px 0 0;color:#9b8fa3;font-size:10px;min-height:15px}.result{padding:24px;animation:reveal .5s cubic-bezier(.2,.8,.2,1) both}.error{text-align:center;padding:50px 25px;color:#572c91}.error button{font:inherit;padding:10px 16px;border:1px solid #d8cee4;border-radius:8px;background:white;cursor:pointer}.error button:focus-visible{outline:3px solid #bba6d5;outline-offset:3px}.status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.hidden{display:none!important}
  @keyframes contemplate{0%,100%{transform:translateY(3px) rotateX(-9deg) rotateY(-15deg)}50%{transform:translateY(-5px) rotateX(9deg) rotateY(18deg)}}
  @keyframes absorb{
   0%,20%{transform:translate3d(var(--x),var(--y),var(--depth)) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz)) scale(1)}
   52%{transform:translate3d(calc(var(--x) * .61),calc(var(--y) * .48),65px) rotateX(8deg) rotateY(-12deg) rotateZ(calc(var(--rz) * .6)) scale(.92)}
   79%{transform:translate3d(calc(var(--x) * .17),calc(var(--y) * .12),35px) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(.42)}
   94%{transform:translate3d(0,-1px,24px) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(.05)}
   100%{transform:translate3d(0,-1px,23px) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(0)}
  }
  .stage[data-phase="2"] .core{animation:receive var(--pulse-duration,300ms) ease-out both}
  .stage[data-phase="2"] .disc.front:after{animation:illuminate var(--pulse-duration,300ms) ease-out both}
  @keyframes receive{0%,100%{transform:translateZ(0) scale(1)}45%{transform:translateZ(5px) scale(1.045)}}
  @keyframes illuminate{0%,100%{opacity:.6;transform:rotate(-28deg) scale(1)}45%{opacity:1;transform:rotate(-28deg) scale(1.7)}}
  @keyframes shadow-breathe{50%{transform:scale(.87);opacity:.6}}
  @keyframes dot{50%{opacity:.25;transform:translateY(-3px)}}@keyframes scan{0%{transform:translateX(-110%)}100%{transform:translateX(340%)}}
  @keyframes reveal{from{opacity:0;transform:translateY(9px);filter:blur(2px)}to{opacity:1;transform:none;filter:none}}
  @media(max-width:360px){.scene{transform:scale(.84)}.visual{height:270px}.title{font-size:25px}.stage{padding-inline:16px}}
  @media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}.track i{width:100%;opacity:.5}.thought-tile{display:none}}

  </style>
  <div class="stage hidden" data-phase="0"><div class="visual" aria-hidden="true"><div class="aura"></div><div class="floor-shadow"></div><div class="scene"><div class="sculpture"><div class="core"><div class="disc" style="--z:0px"></div><div class="disc" style="--z:2px"></div><div class="disc" style="--z:4px"></div><div class="disc" style="--z:6px"></div><div class="disc" style="--z:8px"></div><div class="disc" style="--z:10px"></div><div class="disc front"></div><div class="logo-shadow"></div><img class="logo-depth" alt="" style="--z:15px"><img class="logo-depth" alt="" style="--z:16px"><img class="logo-depth" alt="" style="--z:17px"><img class="logo-depth" alt="" style="--z:18px"><img class="logo-depth" alt="" style="--z:19px"><img class="logo-depth" alt="" style="--z:20px"><img class="logo-depth" alt="" style="--z:21px"><img class="logo-depth" alt="" style="--z:22px"><img class="logo" alt=""></div><div class="thought-tile a"><div class="tile-body"><div class="tile-edge" style="--layer:0px"></div><div class="tile-edge" style="--layer:1px"></div><div class="tile-edge" style="--layer:2px"></div><div class="tile-edge" style="--layer:3px"></div><div class="tile-edge" style="--layer:4px"></div><div class="tile-face"><svg viewBox="0 0 24 24"><path d="M5 2h8l4 4v14H5Z M13 2v5h4 M8 11h6 M8 15h6"/></svg><i></i><i></i></div></div></div><div class="thought-tile b"><div class="tile-body"><div class="tile-edge" style="--layer:0px"></div><div class="tile-edge" style="--layer:1px"></div><div class="tile-edge" style="--layer:2px"></div><div class="tile-edge" style="--layer:3px"></div><div class="tile-edge" style="--layer:4px"></div><div class="tile-face"><svg viewBox="0 0 24 24"><path d="M4 19V5 M4 19h16 M8 15v-4 M13 15V7 M18 15V3"/></svg><i></i><i></i></div></div></div><div class="thought-tile c"><div class="tile-body"><div class="tile-edge" style="--layer:0px"></div><div class="tile-edge" style="--layer:1px"></div><div class="tile-edge" style="--layer:2px"></div><div class="tile-edge" style="--layer:3px"></div><div class="tile-edge" style="--layer:4px"></div><div class="tile-face"><svg viewBox="0 0 24 24"><path d="M4 6h16 M4 11h12 M4 16h16 M4 21h9"/></svg><i></i><i></i></div></div></div><div class="thought-tile d"><div class="tile-body"><div class="tile-edge" style="--layer:0px"></div><div class="tile-edge" style="--layer:1px"></div><div class="tile-edge" style="--layer:2px"></div><div class="tile-edge" style="--layer:3px"></div><div class="tile-edge" style="--layer:4px"></div><div class="tile-face"><svg viewBox="0 0 24 24"><path d="M4 4h7v7H4Z M14 4h6v7h-6Z M4 14h7v6H4Z M14 14h6v6h-6Z"/></svg><i></i><i></i></div></div></div><div class="thought-tile e"><div class="tile-body"><div class="tile-edge" style="--layer:0px"></div><div class="tile-edge" style="--layer:1px"></div><div class="tile-edge" style="--layer:2px"></div><div class="tile-edge" style="--layer:3px"></div><div class="tile-edge" style="--layer:4px"></div><div class="tile-face"><svg viewBox="0 0 24 24"><path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8Z"/></svg><i></i><i></i></div></div></div></div></div></div><p class="eyebrow">INTELLIGENCE IN MOTION</p><h2 class="title"><span>NTER</span> is thinking<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span></h2><p class="caption"></p><div class="steps" aria-hidden="true"><span class="step">Record</span><i class="connector"></i><span class="step">Context</span><i class="connector"></i><span class="step">Your view</span></div><div class="track" aria-hidden="true"><i></i></div><p class="foot" aria-hidden="true">Bringing your record into focus</p></div><p class="status" role="status" aria-live="polite" aria-atomic="true"></p><div class="result"><slot></slot></div><div class="error hidden" role="alert"><p>We couldn’t open this record.</p><button type="button">Try again</button></div>`;
  this.shadowRoot.querySelectorAll('.logo,.logo-depth').forEach(img=>{img.src=this.getAttribute('logo-src')||defaultLogo});
  this.shadowRoot.querySelector('.error button').onclick=()=>{if(this._last)this.load(...this._last)};
  }
  /** task(signal) returns data; render(data) returns a DOM Node. Latest selection wins. */
  async load(task,render,{label='Bringing the public record into view.',duration=2500}={}){
   if(!this.shadowRoot.childNodes.length)this.connectedCallback();
   this.cancel();const version=this._version;const controller=new AbortController();this._controller=controller;
   this._last=[task,render,{label,duration}];const s=this.shadowRoot;
   s.querySelector('.caption').textContent=label;s.querySelector('.stage').classList.remove('hidden');s.querySelector('.result').classList.add('hidden');s.querySelector('.error').classList.add('hidden');s.querySelector('.result').setAttribute('aria-busy','true');
   const stage=s.querySelector('.stage');stage.dataset.phase='0';
   const foot=s.querySelector('.status');foot.textContent='NTER is thinking. Opening your record.';
   const ms=Number.isFinite(duration)?Math.max(0,Math.min(10000,duration)):2500;
   stage.style.setProperty('--ingest-duration',ms*.60+'ms');
   stage.style.setProperty('--delay-step',ms*.06+'ms');
   stage.style.setProperty('--pulse-duration',ms*.12+'ms');
   const visual=stage.querySelector('.visual');visual.replaceWith(visual.cloneNode(true));
   this._phaseTimers=[setTimeout(()=>{if(version===this._version)stage.dataset.phase='1'},ms*.28),setTimeout(()=>{if(version===this._version)stage.dataset.phase='2'},ms*.86)];
   this.dispatchEvent(new CustomEvent('nter:loading',{bubbles:true}));
   const wait=new Promise(resolve=>{this._resolveWait=resolve;this._timer=setTimeout(resolve,ms)});
   try{
    const [data]=await Promise.all([Promise.resolve().then(()=>task(controller.signal)),wait]);
    if(version!==this._version||!this.isConnected)return;
    const node=render(data);if(!(node instanceof Node))throw new TypeError('render must return a DOM Node');
    this.replaceChildren(node);s.querySelector('.stage').classList.add('hidden');s.querySelector('.result').classList.remove('hidden');s.querySelector('.result').setAttribute('aria-busy','false');foot.textContent='Record ready.';
    this._clearTimers();
    this.dispatchEvent(new CustomEvent('nter:loaded',{bubbles:true}));
   }catch(error){if(version!==this._version||controller.signal.aborted)return;s.querySelector('.stage').classList.add('hidden');s.querySelector('.error').classList.remove('hidden');s.querySelector('.result').setAttribute('aria-busy','false');foot.textContent='';this._clearTimers();this.dispatchEvent(new CustomEvent('nter:error',{detail:{error},bubbles:true}));}
  }
  _clearTimers(){clearTimeout(this._timer);(this._phaseTimers||[]).forEach(clearTimeout);this._phaseTimers=[];this._resolveWait?.();this._resolveWait=null;}
  cancel(){this._version++;this._controller?.abort();this._clearTimers();if(this.shadowRoot.childNodes.length){this.shadowRoot.querySelector('.stage').classList.add('hidden');this.shadowRoot.querySelector('.result').classList.remove('hidden');this.shadowRoot.querySelector('.result').setAttribute('aria-busy','false');this.shadowRoot.querySelector('.status').textContent='';this.shadowRoot.querySelector('.error').classList.add('hidden');}}
  disconnectedCallback(){this.cancel()}
 }
 customElements.define('nter-record-loader',NterRecordLoader);
})();
