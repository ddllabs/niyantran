import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ canvas: null, cleanup: null }));
vi.mock('react', () => ({
  useId: () => 'test-artwork',
  useRef: () => ({ current: lifecycle.canvas }),
  useEffect: effect => { lifecycle.cleanup = effect(); },
}));
import GlobalGlobe from './GlobalLandingArtwork.jsx';

describe('Global globe motion restrictions', () => {
  let reduced, page, frames, context, observers;
  beforeEach(() => {
    reduced = Object.assign(new EventTarget(), { matches: false });
    page = Object.assign(new EventTarget(), { hidden: false });
    frames = new Map(); observers = []; let nextFrame = 0;
    context = Object.fromEntries(['clearRect', 'beginPath', 'arc', 'fill', 'ellipse', 'stroke', 'save', 'translate', 'rotate', 'setLineDash', 'restore', 'setTransform'].map(name => [name, vi.fn()]));
    context.createRadialGradient = () => ({ addColorStop() {} });
    lifecycle.canvas = { clientWidth: 640, clientHeight: 640, dataset: {}, getContext: () => context, closest: selector => ({ dataset: selector === '.national-landing' ? { motion: 'on' } : { offscreen: 'false' } }) };
    vi.stubGlobal('document', page);
    vi.stubGlobal('matchMedia', () => reduced);
    vi.stubGlobal('devicePixelRatio', 1);
    vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
    for (const name of ['MutationObserver', 'ResizeObserver']) vi.stubGlobal(name, class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    });
  });
  afterEach(() => { lifecycle.cleanup?.(); lifecycle.cleanup = null; vi.unstubAllGlobals(); });

  it('draws a static initial globe without scheduling animation for reduced motion', () => {
    reduced.matches = true;
    GlobalGlobe();
    expect(context.clearRect).toHaveBeenCalled();
    expect(context.arc).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(lifecycle.canvas.dataset.animating).toBe('false');
  });

  it.each(['hidden', 'reduced'])('cancels queued animation on %s and resumes only when the restriction clears', state => {
    GlobalGlobe();
    expect(frames.size).toBe(1);
    const target = state === 'hidden' ? page : reduced;
    const property = state === 'hidden' ? 'hidden' : 'matches';
    const event = state === 'hidden' ? 'visibilitychange' : 'change';
    target[property] = true; target.dispatchEvent(new Event(event));
    expect(frames.size).toBe(0);
    expect(lifecycle.canvas.dataset.animating).toBe('false');
    expect(context.clearRect).toHaveBeenCalled();
    target[property] = false; target.dispatchEvent(new Event(event));
    expect(frames.size).toBe(1);
    expect(lifecycle.canvas.dataset.animating).toBe('true');
  });

  it('cleans up frames, observers and event listeners when leaving the desk', () => {
    GlobalGlobe(); lifecycle.cleanup(); lifecycle.cleanup = null;
    expect(frames.size).toBe(0);
    expect(observers.every(observer => observer.disconnected)).toBe(true);
    page.dispatchEvent(new Event('visibilitychange'));
    reduced.dispatchEvent(new Event('change'));
    expect(frames.size).toBe(0);
  });
});
