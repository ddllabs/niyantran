import { afterEach, expect, it, vi } from 'vitest';
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
      setPixelRatio() {} setSize() {} forceContextLoss() {}
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
  return { controller, ready, fail, reduce, doc, frames, host, offscreen: value => intersection([{ isIntersecting: !value }]) };
}
it('suspends GPU frames for motion preference, visibility, offscreen, drag and pause', async () => {
  const r = environment(); fake.loads.forEach(({ texture, done }) => done(texture));
  await vi.advanceTimersByTimeAsync(0); expect(r.ready).toHaveBeenCalledOnce(); expect(r.frames.size).toBe(1);
  r.reduce.matches = true; r.reduce.dispatchEvent(new Event('change')); expect(r.frames.size).toBe(0);
  r.controller.rotate(.2, .1); expect(fake.render).toHaveBeenCalled();
  r.reduce.matches = false; r.reduce.dispatchEvent(new Event('change')); expect(r.frames.size).toBe(1);
  r.doc.hidden = true; r.doc.dispatchEvent(new Event('visibilitychange')); expect(r.frames.size).toBe(0);
  r.doc.hidden = false; r.doc.dispatchEvent(new Event('visibilitychange'));
  r.offscreen(true); expect(r.frames.size).toBe(0); r.offscreen(false); expect(r.frames.size).toBe(1);
  r.controller.setDragging(true); expect(r.frames.size).toBe(0); r.controller.setDragging(false);
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
