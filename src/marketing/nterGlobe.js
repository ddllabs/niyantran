/* NTER data orbit: the marketing site's <nter-data-globe> custom element (F140; on every page with
 * a globe since F141, through DataGlobe.jsx).
 *
 * Ported from the client-approved package globe-animation/nter-globe.js. The
 * rendering, shader, orbits, label projection and occlusion are unchanged. Two
 * adaptations: the textures are our served files instead of embedded image data,
 * and the module is safe to import in Node (nothing browser-only runs until
 * the element class is built, and only when customElements exists).
 *
 * Importing this file defines <nter-data-globe>. It fires a bubbling
 * 'data-select' CustomEvent with { key } and does no navigation itself.
 * Pair it with nterGlobe.css. Credits: public/brand/auth-earth/CREDITS.md.
 *
 * F145: each page mounts its own element, so what can outlive one is kept at module level: the
 * decoded textures (sharedTextures), the animation time (sharedClock). An element leaving the page
 * releases its WebGL context. */

export const TEXTURE_URLS = {
  day: '/brand/auth-earth/day.jpg',
  clouds: '/brand/auth-earth/clouds.jpg',
  oceans: '/brand/auth-earth/oceans.jpg',
  // A still of this globe at time 0, rendered from the shader on a transparent background (F145).
  fallback: '/brand/auth-earth/globe-still.webp',
};
const TEXTURE_KEYS = ['day', 'clouds', 'oceans'];

/** Fetches and decodes one texture, off the main thread where the browser can. */
export function decodeTexture(url) {
  if (typeof createImageBitmap === 'function') {
    return fetch(url).then(r => { if (!r.ok) throw new Error(`Globe texture ${r.status}`); return r.blob(); }).then(b => createImageBitmap(b));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img); img.onerror = reject; img.src = url;
  });
}

let textures = null, texturesLoaded = false;
/** The day, clouds and oceans images, decoded once per visit; a failure lets the next globe retry. */
export function sharedTextures(load = decodeTexture) {
  if (!textures) {
    textures = Promise.all(TEXTURE_KEYS.map(key => load(TEXTURE_URLS[key]))).then(
      images => { texturesLoaded = true; return images; },
      error => { textures = null; throw error; },
    );
  }
  return textures;
}
export const texturesReady = () => texturesLoaded;
export function resetSharedTextures() { textures = null; texturesLoaded = false; }

/** The animation time, so the next page's globe continues where the last one was. */
export const sharedClock = { time: 0 };

export function releaseContext(gl) {
  gl?.getExtension?.('WEBGL_lose_context')?.loseContext();
}

export const ITEMS = [
  { key: 'bills', title: 'Bills', color: '#293fa5', icon: 'M7 3h7l4 4v14H7z M14 3v5h4 M10 12h5 M10 16h5' },
  { key: 'law', title: 'Laws & judgments', color: '#572c91', icon: 'M12 3v18 M5 6h14 M5 6l-3 7h6L5 6 M19 6l-3 7h6l-3-7 M7 21h10' },
  { key: 'regulatory', title: 'Regulatory notes', color: '#c2353d', icon: 'M12 3l8 4v6c0 4-8 8-8 8s-8-4-8-8V7z M8 12l3 3 5-6' },
  { key: 'news', title: 'News & reporting', color: '#293fa5', icon: 'M5 4h16v17H5z M2 8v11c0 1 1 2 3 2 M8 8h9 M8 12h9 M8 16h6' },
  { key: 'questions', title: 'Parliamentary questions', color: '#572c91', icon: 'M3 9l9-6 9 6 M4 10h16 M6 11v7 M10 11v7 M14 11v7 M18 11v7 M3 21h18' },
  { key: 'economics', title: 'Economic indicators', color: '#956f42', icon: 'M4 3v17h17 M8 15l4-5 4 3 5-7 M17 6h4v4' },
  { key: 'global', title: 'Global affairs', color: '#c2353d', icon: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18 M12 3c-5 5-5 13 0 18' },
];

const VERTEX = 'attribute vec2 aPosition; varying vec2 vPosition; void main(){ vPosition=aPosition;gl_Position=vec4(aPosition,0.,1.);}';

const FRAGMENT = `precision highp float;
varying vec2 vPosition;
uniform sampler2D uDay; uniform sampler2D uClouds; uniform sampler2D uOceans; uniform float uTime;
const float PI=3.14159265359;
vec3 rotateY(vec3 p,float a){return vec3(cos(a)*p.x+sin(a)*p.z,p.y,-sin(a)*p.x+cos(a)*p.z);}
vec2 mapped(vec3 p){return vec2(fract(.5+atan(p.x,p.z)/(2.*PI)),.5-asin(clamp(p.y,-1.,1.))/PI);}
void main(){
 const float radius=.64; float r=length(vPosition);
 if(r>radius){float a=exp(-(r-radius)*120.)*.17;if(a<.001)discard;gl_FragColor=vec4(.20,.36,.76,a);return;}
 vec2 q=vPosition/radius;vec3 n=vec3(q,sqrt(max(0.,1.-dot(q,q))));
 float tilt=-.12;vec3 axis=vec3(n.x,cos(tilt)*n.y-sin(tilt)*n.z,sin(tilt)*n.y+cos(tilt)*n.z);
 // Inverse texture rotation: a negative lookup angle spins the surface
 // west-to-east (counterclockwise when viewed from above the north pole).
 vec3 world=rotateY(axis,1.16-uTime*.022);vec2 uv=mapped(world);
 vec3 earth=texture2D(uDay,uv).rgb;float water=texture2D(uOceans,uv).r;
 earth=mix(earth,earth*vec3(.82,.98,1.12),water*.52);
 float cloud=texture2D(uClouds,mapped(rotateY(world,-uTime*.0008))).r;
 cloud=smoothstep(.12,.95,cloud)*.83;earth=mix(earth,vec3(.97,.985,1.),cloud);
 vec3 light=normalize(vec3(-.6,.45,1.4));float diffuse=max(0.,dot(n,light));
 earth*=.49+.61*diffuse;
 vec3 halfway=normalize(light+vec3(0.,0.,1.));earth+=vec3(.35,.44,.56)*pow(max(0.,dot(n,halfway)),38.)*water*(1.-cloud)*.26;
 float fresnel=pow(1.-n.z,3.2);earth=mix(earth,vec3(.24,.42,.73),fresnel*.4);
 earth=pow(earth,vec3(.92));float alpha=1.-smoothstep(radius-.0018,radius,r);
 gl_FragColor=vec4(earth,alpha);
}`;

// Orbital positions live in 3D; projection never pushes cards off their paths.
// Positive Z faces the viewer. X-axis inclination gives every orbit real depth.
const TAU = Math.PI * 2;
export const PLANES = [
  { roll: -22 * Math.PI / 180, tilt: 65 * Math.PI / 180, a: .415, b: .365, period: 52, color: '#572c91' },
  { roll: 53 * Math.PI / 180, tilt: 58 * Math.PI / 180, a: .43, b: .37, period: 61, color: '#c2353d' },
];
const SATELLITES = [
  { plane: 0, phase: 5.44 }, { plane: 1, phase: .32 },
  { plane: 0, phase: 7.0107963268 }, { plane: 1, phase: 2.4143951024 },
  { plane: 0, phase: 8.5815926536 }, { plane: 1, phase: 4.5087902048 },
  { plane: 0, phase: 10.1523889804 },
];

export function projectOrbit(plane, angle, width, fit = 1) {
  const u = Math.cos(angle) * plane.a * width * fit;
  const v = Math.sin(angle) * plane.b * width * fit;
  const vy = v * Math.cos(plane.tilt), z = v * Math.sin(plane.tilt);
  const x = u * Math.cos(plane.roll) - vy * Math.sin(plane.roll);
  const y = u * Math.sin(plane.roll) + vy * Math.cos(plane.roll);
  const perspective = width * 1.8 / (width * 1.8 - z);
  return {
    x: width / 2 + x * perspective,
    y: width / 2 + y * perspective,
    z,
    scale: .96 * perspective,
    opacity: .89 + .11 * z / (plane.b * width * fit * Math.sin(plane.tilt)),
  };
}

function orbitalPath(plane, width, fit, front) {
  const start = front ? 0 : Math.PI;
  return Array.from({ length: 121 }, (_, i) => {
    const p = projectOrbit(plane, start + i * Math.PI / 120, width, fit);
    return `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }).join(' ');
}

// The class extends HTMLElement, so it is built only where custom elements
// exist. In Node (tests, SSR) the module imports and does nothing else; tests pass their own base.
export function createGlobeClass(Base = HTMLElement) {
  return class NterDataGlobe extends Base {
    static get observedAttributes() { return ['paused']; }

    constructor() {
      super();
      this._time = sharedClock.time; this._last = 0; this._frame = 0;
      this._visible = true; this._hovered = false; this._focused = false; this._ready = false;
      this._onTick = this._tick.bind(this);
    }

    connectedCallback() {
      if (this._ready) { this._sync(); return; }
      this._ready = true;
      this._time = sharedClock.time;
      this.classList.add('data-orbit');
      this.setAttribute('role', 'group');
      this.setAttribute('aria-label', 'Explore seven connected kinds of research data');
      this.innerHTML = `<div class="data-orbit-halo" aria-hidden="true"></div>
   <svg class="data-orbit-rings data-orbit-rings-back" aria-hidden="true">${PLANES.map(p => `<path stroke="${p.color}"/>`).join('')}</svg>
   <svg class="data-orbit-rings data-orbit-rings-front" aria-hidden="true">${PLANES.map(p => `<path stroke="${p.color}"/>`).join('')}</svg>
   <img class="data-orbit-fallback" src="${TEXTURE_URLS.fallback}" alt="" aria-hidden="true">
   <canvas class="data-orbit-earth" aria-hidden="true"></canvas>
   <div class="data-orbit-labels">${ITEMS.map(i => `<button class="data-orbit-label" type="button" data-key="${i.key}" style="--orbit-label-color:${i.color}" aria-label="Explore ${i.title.toLowerCase()}"><span class="data-orbit-label-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${i.icon}"/></svg></span><span>${i.title}</span><span class="data-orbit-label-arrow" aria-hidden="true">↗</span></button>`).join('')}</div>`;
      this._canvas = this.querySelector('canvas');
      this._labels = [...this.querySelectorAll('.data-orbit-label')];
      this._rings = [...this.querySelectorAll('.data-orbit-rings')];
      this._labels.forEach(b => {
        b.addEventListener('click', () => this.dispatchEvent(new CustomEvent('data-select', { detail: { key: b.dataset.key }, bubbles: true })));
        b.addEventListener('pointerenter', () => { this._hovered = true; this._sync(); });
        b.addEventListener('pointerleave', () => { this._hovered = false; this._sync(); });
      });
      this.addEventListener('focusin', () => { this._focused = true; this._sync(); });
      this.addEventListener('focusout', () => queueMicrotask(() => { this._focused = this.contains(document.activeElement); this._sync(); }));
      this._motion = matchMedia('(prefers-reduced-motion: reduce)');
      this._onMotion = () => { this.toggleAttribute('reduced-motion', this._motion.matches); this._sync(); };
      this._motion.addEventListener('change', this._onMotion);
      this._onMotion();
      this._onVisibility = () => this._sync();
      document.addEventListener('visibilitychange', this._onVisibility);
      this._resize = new ResizeObserver(() => this._size());
      this._resize.observe(this);
      this._observer = new IntersectionObserver(entries => { this._visible = entries[0].isIntersecting; this._sync(); }, { rootMargin: '100px' });
      this._observer.observe(this);
      this._canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.classList.remove('globe-ready'); this._gl = null; });
      this._canvas.addEventListener('webglcontextrestored', () => this._initGL());
      this._size(); this._initGL(); this._sync();
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._frame); this._frame = 0;
      this._resize?.disconnect(); this._observer?.disconnect();
      document.removeEventListener('visibilitychange', this._onVisibility);
      this._motion?.removeEventListener('change', this._onMotion);
      this._ready = false;
      releaseContext(this._gl); this._gl = null;
      this.classList.remove('globe-ready', 'globe-instant');
    }

    attributeChangedCallback() { if (this._ready) this._sync(); }
    get paused() { return this.hasAttribute('paused'); }
    set paused(value) { this.toggleAttribute('paused', !!value); }
    pause() { this.paused = true; }
    play() { this.paused = false; }
    get currentTime() { return this._time; }
    set currentTime(seconds) { this.seek(seconds); }
    seek(seconds) {
      if (!Number.isFinite(Number(seconds))) return;
      this._time = sharedClock.time = Math.max(0, Number(seconds)); this._last = 0; this._render();
    }

    _shouldRun() {
      return this.isConnected && !this.paused && !this._motion?.matches && !this._hovered && !this._focused && this._visible && !document.hidden;
    }

    _sync() {
      if (!this._ready) return;
      cancelAnimationFrame(this._frame); this._frame = 0; this._last = 0;
      this._render();
      if (this._shouldRun()) this._frame = requestAnimationFrame(this._onTick);
    }

    _tick(now) {
      if (!this._shouldRun()) { this._frame = 0; return; }
      if (this._last) sharedClock.time = this._time += Math.min((now - this._last) / 1000, .08);
      this._last = now; this._render();
      this._frame = requestAnimationFrame(this._onTick);
    }

    _size() {
      const w = this.clientWidth; if (!w) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      this._canvas.width = Math.round(w * dpr); this._canvas.height = Math.round(w * dpr); this._width = w;
      this._dimensions = this._labels.map(label => ({ w: label.offsetWidth, h: label.offsetHeight }));
      // Fit entire fixed orbital planes to the available stage, including billboards.
      // This is calculated once per resize, never a per-frame collision correction.
      this._fit = 1;
      for (let step = 0; step < 40; step++) {
        const fits = SATELLITES.every((sat, i) => Array.from({ length: 72 }, (_, j) => {
          const p = projectOrbit(PLANES[sat.plane], j * TAU / 72, w, this._fit), d = this._dimensions[i];
          return p.x - d.w * p.scale / 2 >= 4 && p.x + d.w * p.scale / 2 <= w - 4 && p.y - d.h * p.scale / 2 >= 4 && p.y + d.h * p.scale / 2 <= w - 4;
        }).every(Boolean));
        if (fits || this._fit <= .88) break;
        this._fit = Math.max(.88, this._fit * .985);
      }
      this._rings.forEach((svg, index) => {
        svg.setAttribute('viewBox', `0 0 ${w} ${w}`);
        [...svg.children].forEach((path, i) => path.setAttribute('d', orbitalPath(PLANES[i], w, this._fit, index === 1)));
      });
      this._render();
    }

    async _initGL() {
      const canvas = this._canvas;
      // Textures already decoded by an earlier globe: draw on the first frame, with no fade.
      const instant = texturesReady();
      try {
        const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, powerPreference: 'low-power' });
        if (!gl) return;
        const compile = (type, source) => {
          const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Globe shader compilation failed');
          return shader;
        };
        const program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Globe shader link failed');
        gl.useProgram(program);
        const vertices = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'aPosition');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        const images = await sharedTextures();
        // Left the page (or rebuilt its canvas) while the textures loaded: this context is not used.
        if (!this.isConnected || canvas !== this._canvas) { releaseContext(gl); return; }
        TEXTURE_KEYS.forEach((key, i) => {
          gl.activeTexture(gl.TEXTURE0 + i);
          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, images[i]);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.uniform1i(gl.getUniformLocation(program, 'u' + key[0].toUpperCase() + key.slice(1)), i);
        });
        this._gl = gl; this._program = program;
        this._timeLocation = gl.getUniformLocation(program, 'uTime');
        if (instant) this.classList.add('globe-instant');
        this.classList.add('globe-ready');
        this._render();
      } catch (_error) {
        this.classList.remove('globe-ready'); this._gl = null;
      }
    }

    _render() {
      if (!this._labels || !this._width) return;
      const w = this._width;
      this._labels.forEach((label, i) => {
        const sat = SATELLITES[i], plane = PLANES[sat.plane];
        // Decreasing phase gives these inclined paths prograde motion:
        // foreground satellites travel west-to-east with the Earth's surface.
        const p = projectOrbit(plane, sat.phase - this._time * TAU / plane.period, w, this._fit || 1);
        const focused = document.activeElement === label;
        label.style.transform = `translate3d(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px,0) translate(-50%,-50%) scale(${p.scale.toFixed(4)})`;
        // Rear billboards share the Earth stacking context, so its opaque globe
        // physically occludes only the overlapping part of the card.
        label.style.zIndex = focused ? '30' : p.z < 0 ? '1' : String(6 + Math.round(p.z / w * 20));
        label.style.opacity = focused ? '1' : p.opacity.toFixed(3);
        label.dataset.depth = p.z < 0 ? 'behind' : 'front';
        const d = this._dimensions?.[i];
        const hiddenByEarth = p.z < 0 && d && Math.hypot(Math.abs(p.x - w / 2) + d.w * p.scale / 2, Math.abs(p.y - w / 2) + d.h * p.scale / 2) < w * .32;
        label.style.pointerEvents = hiddenByEarth && !focused ? 'none' : 'auto';
      });
      if (this._gl) {
        const gl = this._gl;
        gl.viewport(0, 0, this._canvas.width, this._canvas.height);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this._program);
        gl.uniform1f(this._timeLocation, this._time);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
  };
}

if (typeof customElements !== 'undefined' && typeof HTMLElement !== 'undefined' && !customElements.get('nter-data-globe')) {
  customElements.define('nter-data-globe', createGlobeClass());
}
