// useDocumentSearch's state, run in node with the hooks harness of PdfDocument.hooks.test.jsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = { slots: [], i: 0, pending: [], dirty: false };
const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal();
  const slot = (init) => {
    const i = h.i++;
    if (!(i in h.slots)) h.slots[i] = init();
    return h.slots[i];
  };
  return {
    ...real,
    useState(init) {
      const s = slot(() => ({ value: typeof init === 'function' ? init() : init }));
      s.set ??= (next) => {
        const value = typeof next === 'function' ? next(s.value) : next;
        if (!Object.is(value, s.value)) { s.value = value; h.dirty = true; }
      };
      return [s.value, s.set];
    },
    useRef: (value = null) => slot(() => ({ current: value })),
    useCallback(fn, deps) {
      const s = slot(() => ({}));
      if (changed(s.deps, deps)) { s.fn = fn; s.deps = deps; }
      return s.fn;
    },
    useMemo(make, deps) {
      const s = slot(() => ({}));
      if (changed(s.deps, deps)) { s.value = make(); s.deps = deps; }
      return s.value;
    },
    useEffect(fn, deps) {
      const s = slot(() => ({ deps: undefined, cleanup: null }));
      if (deps === undefined || changed(s.deps, deps)) h.pending.push({ s, fn, deps });
    },
  };
});

vi.mock('./viewerData.js', () => ({
  searchPages: vi.fn(async () => ({ status: 'ok', pages: [{ page: 3, hits: 2, snippets: [] }] })),
}));

// Imported under another name: the harness runs it as a plain function, re-rendering in a loop.
const { useDocumentSearch: documentSearch } = await import('./useDocumentSearch.js');

function render(options) {
  let out;
  for (let pass = 0; pass < 20; pass += 1) {
    h.dirty = false;
    h.i = 0;
    h.pending = [];
    out = documentSearch(options);
    for (const { s, fn, deps } of h.pending) {
      if (typeof s.cleanup === 'function') s.cleanup();
      s.cleanup = fn() ?? null;
      s.deps = deps;
    }
    if (!h.dirty) return out;
  }
  throw new Error('kept re-rendering');
}

beforeEach(() => { h.slots = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useDocumentSearch', () => {
  it('clears the result when the document\'s extraction changes while search is open', async () => {
    const base = { client: {}, documentId: 'd1', extractHash: 'x1', page: 1 };
    let out = render(base);
    out.openSearch();
    out = render(base);
    out.onQuery('act');
    await vi.advanceTimersByTimeAsync(300);
    out = render(base);
    expect(out.label).toBe('1 of 2');
    out = render({ ...base, extractHash: 'x2' });
    expect(out.total).toBe(0);
    expect(out.target).toBeNull();
  });
});
