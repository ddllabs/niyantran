import * as THREE from 'three';
import { createEarthMotion } from './earthMotion.js';

// Homepage hero rings (public/brand/earth/nter-earth.js) in globe radii: same
// flattening, tilt, colours, phases and laps per 48 s cycle. Opacity and dot
// sizes are raised because the auth pages are light, not the dark hero.
const ORBITS = [
  { r: 393 / 292, flat: .34, angle: -.31, color: '#356fff', phase: .13, speed: 2 },
  { r: 365 / 292, flat: .56, angle: .54, color: '#b07bff', phase: .53, speed: 1 },
  { r: 416 / 292, flat: .31, angle: .20, color: '#deb97e', phase: .79, speed: 2 },
];
const CYCLE = 48, TRAIL = 18;
// India (about 79°E, 22°N) faces the camera: SphereGeometry puts longitude L
// at u = (L + 180) / 360, so a y-turn of π/2 − 2πu brings it to +z.
const INDIA = { x: 22 * Math.PI / 180, y: Math.PI / 2 - (79 + 180) / 360 * Math.PI * 2 };

function createOrbits(resources) {
  const group = new THREE.Group(); group.name = 'orbits';
  const count = ORBITS.length * 2 * (TRAIL + 2);
  const geometry = new THREE.BufferGeometry();
  const position = new Float32Array(count * 3), color = new Float32Array(count * 3);
  const alpha = new Float32Array(count), size = new Float32Array(count), glow = new Float32Array(count);
  let i = 0;
  ORBITS.forEach(def => {
    const ring = new THREE.Group(); ring.name = 'orbit';
    // Tip the ring so its far half sits behind the globe and the near half
    // passes in front, as on the homepage; then turn it in the screen plane.
    ring.rotation.set(-Math.acos(def.flat), 0, -def.angle, 'ZXY');
    const torus = new THREE.TorusGeometry(def.r, .0042, 6, 240);
    const material = new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: .55, depthWrite: false });
    resources.push(torus, material); ring.add(new THREE.Mesh(torus, material)); group.add(ring);
    const c = new THREE.Color(def.color);
    for (let j = 0; j < 2; j++) {
      const head = j ? .008 : .014;
      [[.085, .55, 1], [head, 1, 0], ...Array.from({ length: TRAIL }, (_, k) => [.005, .5 * (1 - (k + 1) / 19), 0])]
        .forEach(([s, a, g]) => { c.toArray(color, i * 3); size[i] = s; alpha[i] = a; glow[i] = g; i++; });
    }
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  geometry.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('glow', new THREE.BufferAttribute(glow, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { scale: { value: 1 } },
    vertexShader: 'attribute vec3 color; attribute float alpha, size, glow; uniform float scale; varying vec3 c; varying float a, g; void main(){ c=color; a=alpha; g=glow; gl_PointSize=max(1.0,size*scale); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 c; varying float a, g; void main(){ float d=length(gl_PointCoord-0.5)*2.0; if(d>1.0) discard; float s=mix(1.0-smoothstep(0.6,1.0,d), pow(1.0-d,2.0), g); gl_FragColor=vec4(mix(c,vec3(1.0,0.96,0.86),(1.0-g)*0.25*(1.0-d)),a*s); }',
  });
  resources.push(geometry, material);
  const points = new THREE.Points(geometry, material);
  points.name = 'satellites'; points.userData.count = ORBITS.length * 2; points.frustumCulled = false;
  group.add(points);
  const local = new THREE.Vector3();
  function place(time) {
    let n = 0;
    ORBITS.forEach((def, o) => {
      const ring = group.children[o];
      ring.updateMatrix();
      for (let j = 0; j < 2; j++) {
        const a = Math.PI * 2 * (time / CYCLE * def.speed + def.phase + j * .5);
        for (let k = -1; k < TRAIL + 1; k++) {
          const t = a - Math.max(0, k) * .012;
          local.set(def.r * Math.cos(t), -def.r * Math.sin(t), 0).applyMatrix4(ring.matrix).toArray(position, n++ * 3);
        }
      }
    });
    geometry.attributes.position.needsUpdate = true;
  }
  return { group, place, setScale(value) { material.uniforms.scale.value = value; } };
}

export function createAuthEarth(host, { ready, fail }) {
  let renderer, disposed = false, failed = false, loaded = false, paused = false, dragging = false, visible = true;
  const resources = [], textures = [], listeners = [];
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .1, 20);
  // Wider than the globe alone so the rings fit; CSS enlarges the canvas to keep the globe's size.
  camera.position.z = 4.54;
  const planet = new THREE.Group(); planet.name = 'planet'; planet.rotation.set(INDIA.x, INDIA.y, 0); scene.add(planet);
  let clouds, orbits, elapsed = 0;
  const render = () => { if (loaded && !disposed && !failed) renderer.render(scene, camera); };
  // A held globe stops spinning but its satellites keep moving.
  const motion = createEarthMotion(dt => {
    if (!dragging) {
      planet.rotation.y += dt * Math.PI * 2 / 90;
      if (clouds) clouds.rotation.y += dt * .007;
    }
    elapsed += dt; orbits?.place(elapsed);
    render();
  });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const sync = () => motion.setRunning(loaded && !failed && !disposed && !paused && !reduce.matches && !document.hidden && visible);
  function listen(target, name, fn) { target.addEventListener(name, fn); listeners.push(() => target.removeEventListener(name, fn)); }
  const resize = new ResizeObserver(() => {
    if (!renderer || disposed || failed) return;
    fit(); render();
  });
  const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); });
  function fit() {
    const size = Math.max(1, renderer.domElement.clientWidth || host.clientWidth);
    renderer.setSize(size, size, false);
    orbits?.setScale(size * renderer.getPixelRatio());
  }
  function failure() {
    if (disposed || failed) return;
    failed = true; clearTimeout(timeout); motion.dispose();
    renderer?.domElement.remove(); renderer?.dispose();
    resources.forEach(resource => resource.dispose()); textures.forEach(texture => texture.dispose());
    resize.disconnect(); intersection.disconnect(); listeners.splice(0).forEach(remove => remove());
    fail();
  }
  const timeout = setTimeout(failure, 15000);
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);
    listen(renderer.domElement, 'webglcontextlost', event => { event.preventDefault(); failure(); });
    listen(reduce, 'change', sync); listen(document, 'visibilitychange', sync);
    resize.observe(host); intersection.observe(host);
    const loader = new THREE.TextureLoader();
    const texture = name => new Promise((resolve, reject) => {
      const asset = loader.load(`/brand/auth-earth/${name}.jpg`, value => {
        if (disposed || failed) value.dispose();
        resolve(value);
      }, undefined, reject);
      textures.push(asset);
    });
    Promise.all(['day', 'clouds', 'oceans'].map(texture)).then(([day, cloud, ocean]) => {
      if (disposed || failed) return;
      clearTimeout(timeout);
      day.colorSpace = THREE.SRGBColorSpace;
      day.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      const geometry = new THREE.SphereGeometry(1, 64, 48); resources.push(geometry);
      const surface = new THREE.MeshPhongMaterial({ map: day, specularMap: ocean, specular: new THREE.Color('#537087'), shininess: 24 });
      const cloudMaterial = new THREE.MeshPhongMaterial({ color: '#ffffff', alphaMap: cloud, transparent: true, opacity: .85, depthWrite: false });
      resources.push(surface, cloudMaterial);
      planet.add(new THREE.Mesh(geometry, surface));
      clouds = new THREE.Mesh(geometry, cloudMaterial); clouds.scale.setScalar(1.006); planet.add(clouds);
      scene.add(new THREE.AmbientLight('#ffffff', .9));
      const sun = new THREE.DirectionalLight('#fff5e8', 2.4); sun.position.set(-3, 2, 5); scene.add(sun);
      orbits = createOrbits(resources); scene.add(orbits.group); orbits.place(elapsed);
      loaded = true; fit();
      render(); ready(); sync();
    }).catch(failure);
  } catch { failure(); }
  return {
    setPaused(value) { paused = value; sync(); },
    setDragging(value) { dragging = value; sync(); },
    rotate(x, y) { planet.rotation.y += x; planet.rotation.x = THREE.MathUtils.clamp(planet.rotation.x + y, -1.2, 1.2); render(); },
    dispose() {
      disposed = true; clearTimeout(timeout); motion.dispose();
      resize.disconnect(); intersection.disconnect(); listeners.splice(0).forEach(remove => remove());
      resources.forEach(resource => resource.dispose()); textures.forEach(texture => texture.dispose());
      renderer?.domElement.remove(); renderer?.dispose(); renderer?.forceContextLoss();
    },
  };
}
