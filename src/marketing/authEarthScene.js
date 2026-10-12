import * as THREE from 'three';
import { createEarthMotion } from './earthMotion.js';

export function createAuthEarth(host, { ready, fail }) {
  let renderer, disposed = false, failed = false, loaded = false, paused = false, dragging = false, visible = true;
  const resources = [], textures = [], listeners = [];
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .1, 20);
  camera.position.z = 3.55;
  const planet = new THREE.Group(); planet.rotation.set(.12, -1.65, -.08); scene.add(planet);
  let clouds;
  const render = () => { if (loaded && !disposed && !failed) renderer.render(scene, camera); };
  const motion = createEarthMotion(dt => {
    planet.rotation.y += dt * Math.PI * 2 / 90;
    if (clouds) clouds.rotation.y += dt * .007;
    render();
  });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const sync = () => motion.setRunning(loaded && !failed && !disposed && !paused && !dragging && !reduce.matches && !document.hidden && visible);
  function listen(target, name, fn) { target.addEventListener(name, fn); listeners.push(() => target.removeEventListener(name, fn)); }
  const resize = new ResizeObserver(() => {
    if (!renderer || disposed || failed) return;
    const size = Math.max(1, host.clientWidth);
    renderer.setSize(size, size, false); render();
  });
  const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); });
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
      const atmosphere = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec3 n; varying vec3 p; void main(){ n=normalize(normalMatrix*normal); vec4 v=modelViewMatrix*vec4(position,1.0); p=v.xyz; gl_Position=projectionMatrix*v; }',
        fragmentShader: 'varying vec3 n; varying vec3 p; void main(){ float rim=pow(1.0-max(dot(normalize(n),normalize(-p)),0.0),4.0); gl_FragColor=vec4(0.22,0.5,0.9,rim*0.55); }',
      });
      resources.push(surface, cloudMaterial, atmosphere);
      planet.add(new THREE.Mesh(geometry, surface));
      clouds = new THREE.Mesh(geometry, cloudMaterial); clouds.scale.setScalar(1.006); planet.add(clouds);
      const halo = new THREE.Mesh(geometry, atmosphere); halo.scale.setScalar(1.025); planet.add(halo);
      scene.add(new THREE.AmbientLight('#ffffff', .9));
      const sun = new THREE.DirectionalLight('#fff5e8', 2.4); sun.position.set(-3, 2, 5); scene.add(sun);
      loaded = true; renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientWidth), false);
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
