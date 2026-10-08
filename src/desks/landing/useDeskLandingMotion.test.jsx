import { afterEach, describe, expect, it, vi } from 'vitest';
import useDeskLandingMotion, { installHeroPan, exploreDeskSectors, deskMotionPaused, subscribeDeskVisibility } from './useDeskLandingMotion.js';

const lifecycle = vi.hoisted(() => ({ refs: [], effects: [], index: 0, manualPause: false }));
vi.mock('react', () => ({
  useRef: initial => {
    const index = lifecycle.index++;
    lifecycle.refs[index] ||= { current: initial };
    return lifecycle.refs[index];
  },
  useState: () => [lifecycle.manualPause, updater => { lifecycle.manualPause = updater(lifecycle.manualPause); }],
  useSyncExternalStore: (subscribe, snapshot) => snapshot(),
  useEffect: (run, deps) => lifecycle.effects.push({ run, deps }),
}));
afterEach(() => { vi.unstubAllGlobals(); lifecycle.refs = []; lifecycle.effects = []; lifecycle.manualPause = false; });
const fixture = () => {
  const handlers = new Map(), photo = { style: { setProperty: vi.fn() } };
  const hero = { addEventListener: vi.fn((event, handler) => handlers.set(event, handler)), removeEventListener: vi.fn(), getBoundingClientRect: () => ({ left: 100, width: 200 }) };
  const root = { querySelector: selector => selector === '.hero' ? hero : photo };
  return { root, hero, photo, handlers };
};
describe('v6 reference motion behavior', () => {
  it('pans the hero photo ±4px for a mouse and resets on leave/cleanup', () => {
    const { root, hero, photo, handlers } = fixture();
    const cleanup = installHeroPan(root, false, false);
    handlers.get('pointermove')({ pointerType: 'mouse', clientX: 100 });
    expect(photo.style.setProperty).toHaveBeenLastCalledWith('--pan', '-4px');
    handlers.get('pointermove')({ pointerType: 'mouse', clientX: 300 });
    expect(photo.style.setProperty).toHaveBeenLastCalledWith('--pan', '4px');
    handlers.get('pointerleave')();
    expect(photo.style.setProperty).toHaveBeenLastCalledWith('--pan', '0px');
    cleanup();
    expect(hero.removeEventListener).toHaveBeenCalledTimes(2);
    expect(photo.style.setProperty).toHaveBeenLastCalledWith('--pan', '0px');
  });
  it.each([[true,false],[false,true]])('suppresses pan when paused=%s/coarse=%s', (paused, coarse) => {
    const { root, hero, photo } = fixture();
    installHeroPan(root, paused, coarse);
    expect(hero.addEventListener).not.toHaveBeenCalled();
    expect(photo.style.setProperty).toHaveBeenLastCalledWith('--pan', '0px');
  });
  it('ignores touch and pen pointer motion', () => {
    const { root, photo, handlers } = fixture();
    installHeroPan(root, false, false); photo.style.setProperty.mockClear();
    handlers.get('pointermove')({ pointerType: 'touch', clientX: 300 });
    handlers.get('pointermove')({ pointerType: 'pen', clientX: 300 });
    expect(photo.style.setProperty).not.toHaveBeenCalled();
  });
  it('scrolls to sectors and focuses the first card without a second scroll', () => {
    const first = { focus: vi.fn() }, sectors = { scrollIntoView: vi.fn(), querySelector: () => first };
    exploreDeskSectors(sectors, false);
    expect(sectors.scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'nearest' });
    expect(first.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    exploreDeskSectors(sectors, true);
    expect(sectors.scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'instant', block: 'nearest' });
  });
  it('pauses while hidden without clearing manual or reduced-motion preferences', () => {
    expect(deskMotionPaused(false, false, true)).toBe(true);
    expect(deskMotionPaused(false, true, false)).toBe(true);
    expect(deskMotionPaused(true, false, false)).toBe(true);
    expect(deskMotionPaused(false, false, false)).toBe(false);
    const doc = { addEventListener: vi.fn(), removeEventListener: vi.fn() }, callback = vi.fn();
    vi.stubGlobal('document', doc);
    const unsubscribe = subscribeDeskVisibility(callback);
    expect(doc.addEventListener).toHaveBeenCalledWith('visibilitychange', callback);
    doc.addEventListener.mock.calls[0][1]();
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', callback);
  });
});


// Drive the hook's actual effects with a deterministic animation clock. This
// exercises cancellation and re-render lifecycles without a browser DOM shim.
describe('counter animation lifecycle', () => {
  const harness = () => {
    const document = { hidden: false }, node = { dataset: { v6Count: '100' }, textContent: '100' };
    const root = { querySelector: () => null, querySelectorAll: () => [node] };
    let effects = [], frame, id = 0;
    const raf = vi.fn(callback => { frame = callback; return ++id; });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('document', document);
    vi.stubGlobal('performance', { now: () => 0 });
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { frame = null; }));
    const useRenderMotion = key => {
      lifecycle.index = 0; lifecycle.effects = [];
      const motion = useDeskLandingMotion(key);
      motion.ref.current = root;
      effects = lifecycle.effects.map((effect, index) => {
        const old = effects[index];
        if (old && effect.deps.every((dep, i) => Object.is(dep, old.deps[i]))) return old;
        old?.cleanup?.();
        return { ...effect, cleanup: effect.run() };
      });
      return motion;
    };
    return { document, node, raf, render: useRenderMotion, tick: time => { const callback = frame; frame = null; callback?.(time); }, cleanup: () => effects.forEach(effect => effect.cleanup?.()) };
  };
  it.each(['manual', 'hidden'])('finalizes an interrupted counter and does not replay it on %s resume', reason => {
    const h = harness(), motion = h.render('100');
    h.tick(500); expect(h.node.textContent).toBe('88');
    if (reason === 'manual') motion.toggle(); else h.document.hidden = true;
    h.render('100'); expect(h.node.textContent).toBe('100');
    const requests = h.raf.mock.calls.length;
    if (reason === 'manual') motion.toggle(); else h.document.hidden = false;
    h.render('100');
    expect(h.raf).toHaveBeenCalledTimes(requests);
    h.tick(0); expect(h.node.textContent).toBe('100');
    h.cleanup();
  });
  it('does not replay completed data but animates changed data once visible', () => {
    const h = harness(); h.render('100'); h.tick(1000);
    h.document.hidden = true; h.render('100');
    h.document.hidden = false; h.render('100');
    expect(h.raf).toHaveBeenCalledTimes(1);
    h.document.hidden = true; h.node.dataset.v6Count = '250'; h.node.textContent = '250'; h.render('250');
    expect(h.raf).toHaveBeenCalledTimes(1);
    h.document.hidden = false; h.render('250');
    expect(h.raf).toHaveBeenCalledTimes(2);
    h.tick(500); expect(h.node.textContent).toBe('219');
    h.tick(1000); expect(h.node.textContent).toBe('250');
    h.cleanup();
  });
});
