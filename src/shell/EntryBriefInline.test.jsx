import { beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [], index: 0, effect: null, deps: null, cleanup: null }));
vi.mock('react', async (original) => ({
  ...await original(),
  useState: (init) => {
    const i = hooks.index++;
    if (!(i in hooks.values)) hooks.values[i] = typeof init === 'function' ? init() : init;
    return [hooks.values[i], (v) => { hooks.values[i] = typeof v === 'function' ? v(hooks.values[i]) : v; }];
  },
  useEffect: (fn, deps) => {
    if (!hooks.deps || deps.some((v, i) => v !== hooks.deps[i])) {
      hooks.cleanup?.(); hooks.effect = fn; hooks.deps = deps;
    }
  },
}));
vi.mock('../lib/deskBrief.js', () => ({ entryFingerprintFnv: (row) => JSON.stringify(row), peekDeskBrief: vi.fn() }));
import { peekDeskBrief } from '../lib/deskBrief.js';
import { useEntryBrief } from './EntryBriefInline.jsx';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const feed = { feature: 'Bills', tier: 'national' };
function RenderBrief(selected, loading = false) { hooks.index = 0; return useEntryBrief({ feed, selected, loading }); }
function effects() { if (hooks.effect) { const fn = hooks.effect; hooks.effect = null; hooks.cleanup = fn(); } }
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { hooks.cleanup?.(); Object.assign(hooks, { values: [], index: 0, effect: null, deps: null, cleanup: null }); peekDeskBrief.mockReset(); });
it('never exposes the previous record brief even before the new effect runs, or after a failed lookup', async () => {
  const a = deferred(), b = deferred(); peekDeskBrief.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  RenderBrief({ id: 'a' }); effects(); a.resolve({ headline: 'A private summary' }); await settle();
  expect(RenderBrief({ id: 'a' }).brief?.headline).toBe('A private summary');
  expect(RenderBrief({ id: 'b' }).brief).toBeNull(); effects(); b.reject(new Error('offline')); await settle();
  expect(RenderBrief({ id: 'b' })).toMatchObject({ brief: null, busy: false });
});
it('ignores a late old-record result and clears content synchronously when selection is cleared', async () => {
  const a = deferred(), b = deferred(); peekDeskBrief.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  RenderBrief({ id: 'a' }); effects(); RenderBrief({ id: 'b' }); effects(); b.resolve({ headline: 'B summary' }); await settle();
  a.resolve({ headline: 'Late A' }); await settle(); expect(RenderBrief({ id: 'b' }).brief?.headline).toBe('B summary');
  expect(RenderBrief(null).brief).toBeNull(); expect(RenderBrief({ id: 'b' }, true).brief).toBeNull();
});
