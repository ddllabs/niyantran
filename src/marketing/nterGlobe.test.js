import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

// F140 T1: the homepage globe module (<nter-data-globe>). It is imported here in
// Node, where there is no window, document or customElements, so the import
// itself is part of what is tested.
const SOURCE = readFileSync(new URL('./nterGlobe.js', import.meta.url), 'utf8');
const PUBLIC = new URL('../../public/', import.meta.url);

describe('nterGlobe module', () => {
  it('imports in Node without touching window, document or customElements', async () => {
    expect(typeof customElements).toBe('undefined');
    await expect(import('./nterGlobe.js')).resolves.toBeDefined();
  });

  it('lists the seven design items, in order, with the design titles', async () => {
    const { ITEMS } = await import('./nterGlobe.js');
    expect(ITEMS.map(i => [i.key, i.title])).toEqual([
      ['bills', 'Bills'],
      ['law', 'Laws & judgments'],
      ['regulatory', 'Regulatory notes'],
      ['news', 'News & reporting'],
      ['questions', 'Parliamentary questions'],
      ['economics', 'Economic indicators'],
      ['global', 'Global affairs'],
    ]);
    ITEMS.forEach(i => {
      expect(i.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(i.icon.length).toBeGreaterThan(10);
    });
  });

  it('loads the textures and the still from /brand/auth-earth files that exist', async () => {
    const { TEXTURE_URLS } = await import('./nterGlobe.js');
    expect(Object.keys(TEXTURE_URLS).sort()).toEqual(['clouds', 'day', 'fallback', 'oceans']);
    Object.values(TEXTURE_URLS).forEach(url => {
      expect(url).toMatch(/^\/brand\/auth-earth\/[a-z-]+\.(jpg|webp)$/);
      expect(existsSync(new URL(url.slice(1), PUBLIC)), url).toBe(true);
    });
  });

  // F145: the stand-in was a photo of Earth on black space, which flashed on every page change.
  it('stands in with a still of our own globe on a transparent background', async () => {
    const { TEXTURE_URLS } = await import('./nterGlobe.js');
    expect(TEXTURE_URLS.fallback).toBe('/brand/auth-earth/globe-still.webp');
    const bytes = readFileSync(new URL(TEXTURE_URLS.fallback.slice(1), PUBLIC));
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(bytes.subarray(8, 16).toString('latin1')).toBe('WEBPVP8X');
    expect(bytes[20] & 0x10, 'alpha flag').toBe(0x10);
    expect(bytes.length).toBeLessThan(120 * 1024);
  });

  it('places the still over the shader globe: the disc and its glow, 16% to 84% of the box', () => {
    const css = readFileSync(new URL('./nterGlobe.css', import.meta.url), 'utf8');
    const rule = css.match(/\.data-orbit-fallback\{([^}]*)\}/)[1];
    expect(rule).toMatch(/left:16%/);
    expect(rule).toMatch(/top:16%/);
    expect(rule).toMatch(/width:68%/);
    expect(rule).toMatch(/height:68%/);
    expect(rule).not.toMatch(/border-radius|object-fit|box-shadow/);
    expect(css).toMatch(/\.globe-instant \.data-orbit-earth,\.globe-instant \.data-orbit-fallback\{transition:none;?\}/);
  });

  it('embeds no base64 data (the textures are served files)', () => {
    expect(SOURCE).not.toMatch(/base64,/);
    expect(SOURCE).not.toMatch(/[A-Za-z0-9+/=]{300,}/);
  });

  it('puts each orbit plane half in front of Earth and half behind it', async () => {
    const { PLANES, projectOrbit } = await import('./nterGlobe.js');
    expect(PLANES).toHaveLength(2);
    PLANES.forEach(plane => {
      const zs = Array.from({ length: 72 }, (_, i) => projectOrbit(plane, i * 2 * Math.PI / 72, 600).z);
      expect(zs.some(z => z < 0)).toBe(true);
      expect(zs.some(z => z > 0)).toBe(true);
    });
  });

  it('scales and fades a label with depth: nearer is larger and more opaque', async () => {
    const { PLANES, projectOrbit } = await import('./nterGlobe.js');
    PLANES.forEach(plane => {
      const front = projectOrbit(plane, Math.PI / 2, 600);
      const back = projectOrbit(plane, -Math.PI / 2, 600);
      expect(front.z).toBeGreaterThan(0);
      expect(back.z).toBeLessThan(0);
      expect(front.scale).toBeGreaterThan(back.scale);
      expect(front.opacity).toBeGreaterThan(back.opacity);
      expect(back.opacity).toBeGreaterThan(0.75);
      expect(front.opacity).toBeLessThanOrEqual(1.0001);
    });
  });

  it('registers the element only through a guarded define', () => {
    expect(SOURCE).toMatch(/typeof customElements/);
    expect(SOURCE).toMatch(/customElements\.get\('nter-data-globe'\)/);
    expect(SOURCE).toMatch(/new CustomEvent\('data-select',\s*\{\s*detail:\s*\{\s*key/);
  });
});

// F145: the globe carries over between pages. Each page mounts its own element, so the decoded
// images, the animation time and the WebGL context are handled across elements.
describe('nterGlobe across page changes', () => {
  // The tests share one Node process (singleFork), so stubbed browser globals are removed after each.
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  });
  const flush = () => new Promise(r => setTimeout(r, 0));
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  const classes = () => { const set = new Set(); return { set, add: (...c) => c.forEach(x => set.add(x)), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c) }; };
  // A WebGL context that accepts every call; shaders compile and link.
  const fakeGl = (loseContext = () => {}) => new Proxy({}, {
    get: (_, key) => (key === 'getExtension' ? (name => (name === 'WEBGL_lose_context' ? { loseContext } : null)) : () => true),
  });
  class FakeBase { hasAttribute() { return false; } toggleAttribute() {} }
  const element = async () => {
    const mod = await import('./nterGlobe.js');
    const el = new (mod.createGlobeClass(FakeBase))();
    el.classList = classes();
    el.isConnected = true;
    el._render = () => {};
    return { mod, el };
  };

  it('decodes each texture once and shares the result with every later globe', async () => {
    const { sharedTextures, texturesReady, resetSharedTextures, TEXTURE_URLS } = await import('./nterGlobe.js');
    resetSharedTextures();
    const loaded = [];
    const load = url => { loaded.push(url); return Promise.resolve({ url }); };
    const first = sharedTextures(load);
    expect(texturesReady()).toBe(false);
    const images = await first;
    expect(sharedTextures(load)).toBe(first);
    expect(texturesReady()).toBe(true);
    expect(loaded).toEqual([TEXTURE_URLS.day, TEXTURE_URLS.clouds, TEXTURE_URLS.oceans]);
    expect(images.map(i => i.url)).toEqual(loaded);
  });

  it('tries again on the next globe when a texture failed to load', async () => {
    const { sharedTextures, texturesReady, resetSharedTextures } = await import('./nterGlobe.js');
    resetSharedTextures();
    await expect(sharedTextures(() => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(texturesReady()).toBe(false);
    await expect(sharedTextures(url => Promise.resolve({ url }))).resolves.toHaveLength(3);
  });

  it('starts a new globe at the shared time and moves the shared time as it runs', async () => {
    const { mod, el: first } = await element();
    mod.sharedClock.time = 12.5;
    const { el } = await element();
    expect(el._time).toBe(12.5);
    globalThis.document = { hidden: false };
    globalThis.requestAnimationFrame = () => 1;
    el._motion = { matches: false };
    el._tick(1000);
    el._tick(1050);
    expect(el._time).toBeCloseTo(12.55, 5);
    expect(mod.sharedClock.time).toBeCloseTo(12.55, 5);
    first.seek(3);
    expect(mod.sharedClock.time).toBe(3);
  });

  it('releases its WebGL context when it leaves the page', async () => {
    const { el } = await element();
    let lost = 0;
    globalThis.cancelAnimationFrame = () => {};
    globalThis.document = { hidden: false, removeEventListener() {} };
    el._gl = fakeGl(() => { lost += 1; });
    el.classList.add('globe-ready', 'globe-instant');
    el.disconnectedCallback();
    expect(lost).toBe(1);
    expect(el._gl).toBe(null);
    expect(el.classList.contains('globe-ready')).toBe(false);
  });

  it('draws at once, with no fade, when the textures are already decoded', async () => {
    const { mod, el } = await element();
    mod.resetSharedTextures();
    await mod.sharedTextures(url => Promise.resolve({ url }));
    el._canvas = { getContext: () => fakeGl() };
    await el._initGL();
    expect(el.classList.contains('globe-ready')).toBe(true);
    expect(el.classList.contains('globe-instant')).toBe(true);
  });

  it('fades in, as before, when the textures arrive after the globe mounts', async () => {
    const { mod, el } = await element();
    mod.resetSharedTextures();
    const pending = deferred();
    mod.sharedTextures(() => pending.promise);
    el._canvas = { getContext: () => fakeGl() };
    const init = el._initGL();
    pending.resolve({});
    await init;
    expect(el.classList.contains('globe-ready')).toBe(true);
    expect(el.classList.contains('globe-instant')).toBe(false);
  });

  it('releases the context it made when it left the page while the textures loaded', async () => {
    const { mod, el } = await element();
    mod.resetSharedTextures();
    const pending = deferred();
    mod.sharedTextures(() => pending.promise);
    let lost = 0;
    el._canvas = { getContext: () => fakeGl(() => { lost += 1; }) };
    const init = el._initGL();
    el.isConnected = false;
    pending.resolve({});
    await init;
    await flush();
    expect(lost).toBe(1);
    expect(el._gl).toBeUndefined();
    expect(el.classList.contains('globe-ready')).toBe(false);
  });
});

