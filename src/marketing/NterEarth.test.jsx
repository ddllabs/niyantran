import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async (original) => ({ ...await original(), useState: () => [true, vi.fn()], useEffect: vi.fn() }));
const home = () => readFileSync(new URL('./HomePage.jsx', import.meta.url), 'utf8');
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('homepage Earth integration', () => {
  it('uses spherical artwork without either baked globe image', () => {
    expect(home()).toContain('<NterEarth paused={earthPaused} />');
    expect(home()).not.toContain('src="/brand/globe.png');
    expect(home()).not.toContain('src="/brand/bg.png');
    expect(home()).toContain('Pause globe');
  });
});

async function loader() {
  vi.resetModules();
  let registered = false;
  const scripts = [];
  vi.stubGlobal('customElements', { get: () => registered });
  vi.stubGlobal('document', {
    createElement: () => ({ remove: vi.fn() }),
    head: { appendChild: (script) => scripts.push(script) },
  });
  const { loadEarth } = await import('./NterEarth.jsx');
  return { loadEarth, scripts, register: () => { registered = true; } };
}

describe('Earth runtime loading', () => {
  it('avoids assigning the read-only duration property through React 19', async () => {
    const { default: NterEarth } = await import('./NterEarth.jsx');
    const element = NterEarth({ paused: true }).props.children;
    expect(element.type).toBe('nter-earth');
    expect(element.props).not.toHaveProperty('duration');
    expect(element.props.paused).toBe('');
    expect(earthRuntime().el.duration).toBe(48);
  });
  it('shares one script across simultaneous consumers and remounts', async () => {
    const { loadEarth, scripts, register } = await loader();
    const a = loadEarth(), b = loadEarth();
    expect(a).toBe(b);
    expect(scripts).toHaveLength(1);
    register(); scripts[0].onload();
    await a; await loadEarth();
    expect(scripts).toHaveLength(1);
  });
  it('rejects failed loading and allows a later mount to retry', async () => {
    const { loadEarth, scripts, register } = await loader();
    const first = loadEarth(); const failed = expect(first).rejects.toThrow('loading failed');
    scripts[0].onerror(); await failed;
    expect(scripts[0].remove).toHaveBeenCalled();
    const retry = loadEarth(); register(); scripts[1].onload(); await retry;
  });
  it('does not replace the poster with an unregistered element', async () => {
    const { loadEarth, scripts } = await loader();
    const failed = expect(loadEarth()).rejects.toThrow('registration failed');
    scripts[0].onload(); await failed;
  });
  it('settles a hung load after the bounded timeout', async () => {
    vi.useFakeTimers();
    const { loadEarth, scripts } = await loader();
    const failed = expect(loadEarth()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000); await failed;
    expect(scripts[0].remove).toHaveBeenCalled();
  });
});

function earthRuntime() {
  let Earth, frame, observer;
  const attrs = new Map();
  const reduce = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const document = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const canvas = { getContext: () => null };
  class Element {
    attachShadow() { this.shadowRoot = { querySelector: () => canvas }; }
    getBoundingClientRect() { return { width: 500, height: 500 }; }
    getAttribute(n) { return attrs.get(n) ?? null; }
    hasAttribute(n) { return attrs.has(n); }
    setAttribute(n, v) { attrs.set(n, v); this.attributeChangedCallback(); }
    removeAttribute(n) { attrs.delete(n); this.attributeChangedCallback(); }
  }
  class ResizeObserver { observe() {} disconnect() {} }
  class IntersectionObserver {
    constructor(fn) { observer = fn; }
    observe() {} disconnect() {}
  }
  const scope = { HTMLElement: Element, customElements: { get: () => null, define: (_, C) => { Earth = C; } },
    window: {}, document, matchMedia: () => reduce, devicePixelRatio: 1,
    ResizeObserver, IntersectionObserver, requestAnimationFrame: (fn) => { frame = fn; return 1; }, cancelAnimationFrame: () => { frame = null; } };
  vm.runInNewContext(readFileSync(new URL('../../public/brand/earth/nter-earth.js', import.meta.url), 'utf8'), scope);
  const el = new Earth(); el.connectedCallback();
  return { el, document, reduce, frame: () => frame, offscreen: () => observer([{ isIntersecting: false }]) };
}

describe('supplied Earth lifecycle', () => {
  it('advances geography while running, pauses and resumes without time jumps', () => {
    const r = earthRuntime(); r.frame()(100); r.frame()(116);
    expect(r.el._elapsed).toBeGreaterThan(0);
    const elapsed = r.el._elapsed; r.el.pause(); expect(r.frame()).toBeNull();
    r.el.play(); r.frame()(10000); expect(r.el._elapsed).toBe(elapsed);
    r.frame()(10016); expect(r.el._elapsed).toBeGreaterThan(elapsed);
  });
  it('stops for reduced motion, hidden tab, offscreen and disconnect', () => {
    const r = earthRuntime();
    r.reduce.matches = true; r.el._sync(); expect(r.frame()).toBeNull();
    r.reduce.matches = false; r.el._sync(); expect(r.frame()).toBeTypeOf('function');
    r.document.hidden = true; r.el._sync(); expect(r.frame()).toBeNull();
    r.document.hidden = false; r.el._sync(); r.offscreen(); expect(r.frame()).toBeNull();
    r.el.disconnectedCallback(); expect(r.frame()).toBeNull();
    expect(r.document.removeEventListener).toHaveBeenCalledWith('visibilitychange', r.el._sync);
    r.el.connectedCallback(); expect(r.el._connected).toBe(true);
  });
});
