import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ root: null, cleanup: null }));
vi.mock('react', () => ({
  useRef: () => ({ current: lifecycle.root }),
  useEffect: effect => { lifecycle.cleanup = effect(); },
}));
import { useNationalMotion } from './useNationalMotion.js';

function node() {
  const classes = new Set();
  return Object.assign(new EventTarget(), {
    style: {}, dataset: {},
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
  });
}

describe('National decorative motion lifecycle', () => {
  let root, card, layer, backdrop, reduced, page, frames;
  beforeEach(() => {
    root = node(); card = node(); layer = node(); backdrop = node();
    reduced = Object.assign(new EventTarget(), { matches: false });
    page = Object.assign(new EventTarget(), { hidden: false });
    frames = new Map(); let nextFrame = 0;
    layer.dataset.d = '1';
    card.closest = () => card;
    card.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
    root.contains = value => value === card;
    root.closest = () => null;
    root.querySelector = () => backdrop;
    root.querySelectorAll = selector => selector === '.seg' ? [card] : selector.includes('.lyr') ? [layer] : [card, backdrop];
    lifecycle.root = root;
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', Object.assign(new EventTarget(), {
      innerWidth: 1000, innerHeight: 1000, scrollY: 0,
      matchMedia: query => query.includes('reduced') ? reduced : { matches: true },
    }));
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  });
  afterEach(() => { lifecycle.cleanup?.(); vi.unstubAllGlobals(); });

  function queuePointer() {
    const event = new Event('pointermove');
    Object.defineProperties(event, { target: { value: card }, clientX: { value: 150 }, clientY: { value: 150 } });
    root.dispatchEvent(event);
  }
  function flushFrames() {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());
  }

  it.each(['hidden', 'reduced'])('does not restore tilt from a queued frame after becoming %s', state => {
    useNationalMotion(false);
    queuePointer();
    if (state === 'hidden') { page.hidden = true; page.dispatchEvent(new Event('visibilitychange')); }
    else { reduced.matches = true; reduced.dispatchEvent(new Event('change')); }
    flushFrames();
    expect(root.dataset.motion).toBe('off');
    expect(card.style.transform).toBe('');
    expect(layer.style.transform).toBe('');
    expect(card.classList.contains('tilting')).toBe(false);
  });

  it('resumes pointer motion only after visibility returns and reduced motion is disabled', () => {
    page.hidden = true; reduced.matches = true;
    useNationalMotion(false);
    queuePointer(); flushFrames();
    expect(root.dataset.motion).toBe('off');
    page.hidden = false; page.dispatchEvent(new Event('visibilitychange'));
    expect(root.dataset.motion).toBe('off');
    reduced.matches = false; reduced.dispatchEvent(new Event('change'));
    queuePointer(); flushFrames();
    expect(root.dataset.motion).toBe('on');
    expect(card.style.transform).toContain('rotateX');
  });

  it('keeps the manual pause in force when environmental restrictions clear', () => {
    useNationalMotion(true);
    page.dispatchEvent(new Event('visibilitychange'));
    reduced.dispatchEvent(new Event('change'));
    queuePointer(); flushFrames();
    expect(root.dataset.motion).toBe('off');
    expect(card.style.transform).toBe('');
  });

  it('does not restore a tilt after the pointer leaves before its frame renders', () => {
    useNationalMotion(false);
    queuePointer(); root.dispatchEvent(new Event('pointerleave')); flushFrames();
    expect(card.style.transform).toBe('');
    expect(card.classList.contains('tilting')).toBe(false);
  });
});
