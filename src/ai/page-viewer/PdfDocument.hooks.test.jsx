// PdfDocument's effects, run in node without a DOM, with the hooks harness of
// PageViewer.hooks.test.jsx: React's hooks keep state in slots and effects run when their deps
// change. Children are not rendered.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = { slots: [], i: 0, pending: [], dirty: false };
const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal();
  const slot = (init) => {
    const i = h.i++;
    if (!(i in h.slots)) h.slots[i] = init();
    return h.slots[i];
  };
  const effect = (fn, deps) => {
    const s = slot(() => ({ deps: undefined, cleanup: null }));
    if (deps === undefined || changed(s.deps, deps)) h.pending.push({ s, fn, deps });
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
    useEffect: effect,
    useLayoutEffect: effect,
  };
});

// The pane as the full view first sees it, before its size is read.
const pane = { current: { width: 0, height: 0 } };
vi.mock('./chromeHooks.js', () => ({ usePaneSize: () => pane.current }));

const { default: PdfDocument } = await import('./PdfDocument.jsx');

function render(props) {
  for (let pass = 0; pass < 20; pass += 1) {
    h.dirty = false;
    h.i = 0;
    h.pending = [];
    PdfDocument(props);
    for (const { s, fn, deps } of h.pending) {
      if (typeof s.cleanup === 'function') s.cleanup();
      s.cleanup = fn() ?? null;
      s.deps = deps;
    }
    if (!h.dirty) return;
  }
  throw new Error('the view kept re-rendering');
}

const pages = 12;
const props = (extra = {}) => ({
  pool: { request: vi.fn(() => ({ cancel() {}, setPriority() {} })) },
  total: pages, title: 'Bill', aspects: Array(pages).fill(1.414), naturalPts: Array(pages).fill(595),
  zoomState: { fit: 'width', zoom: null }, cited: 4, citedColumn: null, citedPt: 595, citedBox: { y0: 0.3, y1: 0.4 },
  overlays: new Map(), marks: null, onMark: vi.fn(), scrollRequest: null, openAt: 4, insetBottom: 72,
  onPage: vi.fn(), onZoom: vi.fn(), onWheelZoom: vi.fn(), onMeasured: vi.fn(), onFailure: vi.fn(),
  ...extra,
});

beforeEach(() => {
  h.slots = [];
  pane.current = { width: 0, height: 0 };
});

describe('PdfDocument before it has opened', () => {
  it('reports no page while its pane is unmeasured, so the reader\'s page cannot move before it opens', () => {
    const onPage = vi.fn();
    render(props({ onPage }));
    // The page shapes arrive (stored sizes, then a drawn page) before the pane is measured.
    render(props({ onPage, aspects: Array(pages).fill(1.3) }));
    render(props({ onPage, aspects: Array(pages).fill(0.7) }));
    expect(onPage).not.toHaveBeenCalled();
  });
});
