import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createAuthEarth } from './authEarthScene.js';
const fake = vi.hoisted(() => ({ loads: [], render: vi.fn(), dispose: vi.fn() }));
vi.mock('three', async original => {
  const actual = await original();
  return { ...actual,
    WebGLRenderer: class {
      constructor() {
        this.domElement = Object.assign(new EventTarget(), { setAttribute: vi.fn(), remove: vi.fn() });
        this.capabilities = { getMaxAnisotropy: () => 8 };
        this.render = fake.render; this.dispose = fake.dispose;
      }
      setPixelRatio() {} getPixelRatio() { return 1; } setSize() {} forceContextLoss() {}
    },
    TextureLoader: class {
      load(url, done, progress, error) { const texture = new actual.Texture(); fake.loads.push({ texture, done, error }); return texture; }
    },
  };
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); fake.loads = []; vi.clearAllMocks(); });
function environment() {
  vi.useFakeTimers();
  let intersection; const frames = new Map(); let id = 0;
  const reduce = Object.assign(new EventTarget(), { matches: false });
  const doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('matchMedia', () => reduce); vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { constructor(cb) { intersection = cb; } observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', cb => { frames.set(++id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', n => frames.delete(n));
  const host = { clientWidth: 600, appendChild: vi.fn() }, ready = vi.fn(), fail = vi.fn();
  const controller = createAuthEarth(host, { ready, fail });
  let now = 0;
  const step = (ms = 16) => { now += ms; const [n, cb] = frames.entries().next().value; frames.delete(n); cb(now); };
  return { controller, ready, fail, reduce, doc, frames, host, step, offscreen: value => intersection([{ isIntersecting: !value }]) };
}
async function loaded() {
  const r = environment(); fake.loads.forEach(({ texture, done }) => done(texture));
  await vi.advanceTimersByTimeAsync(0);
  const scene = fake.render.mock.calls.at(-1)[0];
  return { ...r, scene, planet: scene.getObjectByName('planet') };
}
// Direction of a lon/lat texel on Three.js SphereGeometry's equirectangular UV layout.
function texel(lon, lat) {
  const phi = (lon + 180) / 360 * Math.PI * 2, theta = (90 - lat) * Math.PI / 180;
  return new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
}
it('maps lon/lat texels the way SphereGeometry lays out its UVs', () => {
  const g = new THREE.SphereGeometry(1, 64, 48), uv = g.attributes.uv, pos = g.attributes.position;
  let best = 0, bestErr = Infinity;
  for (let i = 0; i < uv.count; i++) {
    const err = Math.hypot(uv.getX(i) - (79 + 180) / 360, uv.getY(i) - (90 + 22) / 180);
    if (err < bestErr) { bestErr = err; best = i; }
  }
  expect(new THREE.Vector3().fromBufferAttribute(pos, best).distanceTo(texel(79, 22))).toBeLessThan(.06);
});
it('opens with India facing the viewer', async () => {
  const r = await loaded(); r.scene.updateMatrixWorld(true);
  const india = texel(79, 22).applyMatrix4(r.planet.matrixWorld);
  expect(india.z).toBeGreaterThan(.99);
  r.controller.dispose();
});
it('draws three fixed orbit rings carrying two satellites each', async () => {
  const r = await loaded();
  const rings = r.scene.getObjectByName('orbits');
  expect(rings.parent).toBe(r.scene);
  expect(rings.children.filter(o => o.name === 'orbit')).toHaveLength(3);
  expect(rings.getObjectByName('satellites').userData.count).toBe(6);
  r.controller.dispose();
});
it('keeps satellites moving while a drag holds the globe, then resumes spin from the dragged angle', async () => {
  const r = await loaded(); const sats = r.scene.getObjectByName('satellites');
  r.step(); r.step();
  r.controller.setDragging(true); r.controller.rotate(.5, 0);
  const held = r.planet.rotation.y, before = Array.from(sats.geometry.attributes.position.array);
  r.step(100); r.step(100);
  expect(r.planet.rotation.y).toBe(held);
  expect(Array.from(sats.geometry.attributes.position.array)).not.toEqual(before);
  r.controller.setDragging(false); r.step(16); r.step(16);
  expect(r.planet.rotation.y).toBeGreaterThan(held);
  expect(r.planet.rotation.y - held).toBeLessThan(.01);
  r.controller.dispose();
});
it('suspends GPU frames for motion preference, visibility, offscreen, drag and pause', async () => {
  const r = environment(); fake.loads.forEach(({ texture, done }) => done(texture));
  await vi.advanceTimersByTimeAsync(0); expect(r.ready).toHaveBeenCalledOnce(); expect(r.frames.size).toBe(1);
  r.reduce.matches = true; r.reduce.dispatchEvent(new Event('change')); expect(r.frames.size).toBe(0);
  r.controller.rotate(.2, .1); expect(fake.render).toHaveBeenCalled();
  r.reduce.matches = false; r.reduce.dispatchEvent(new Event('change')); expect(r.frames.size).toBe(1);
  r.doc.hidden = true; r.doc.dispatchEvent(new Event('visibilitychange')); expect(r.frames.size).toBe(0);
  r.doc.hidden = false; r.doc.dispatchEvent(new Event('visibilitychange'));
  r.offscreen(true); expect(r.frames.size).toBe(0); r.offscreen(false); expect(r.frames.size).toBe(1);
  r.controller.setDragging(true); expect(r.frames.size).toBe(1); r.controller.setDragging(false);
  r.controller.setPaused(true); expect(r.frames.size).toBe(0); r.controller.setPaused(false);
  r.controller.dispose(); expect(r.frames.size).toBe(0); expect(fake.dispose).toHaveBeenCalledOnce();
  r.reduce.dispatchEvent(new Event('change')); expect(r.frames.size).toBe(0);
});
it('falls back on texture failure without starting or leaking an animation loop', async () => {
  const r = environment(); fake.loads[0].error(new Error('fixture texture failure'));
  await vi.advanceTimersByTimeAsync(0);
  expect(r.fail).toHaveBeenCalledOnce(); expect(r.ready).not.toHaveBeenCalled(); expect(r.frames.size).toBe(0);
  expect(fake.dispose).toHaveBeenCalledOnce(); r.controller.dispose();
});
it('bounds a hung texture load and ignores late completion after unmount', async () => {
  const r = environment(); await vi.advanceTimersByTimeAsync(15000);
  expect(r.fail).toHaveBeenCalledOnce(); expect(r.frames.size).toBe(0);
  r.controller.dispose(); fake.loads.forEach(({ texture, done }) => done(texture));
  await vi.advanceTimersByTimeAsync(0); expect(r.ready).not.toHaveBeenCalled();
});
