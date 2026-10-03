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
    const out = PdfDocument(props);
    for (const { s, fn, deps } of h.pending) {
      if (typeof s.cleanup === 'function') s.cleanup();
      s.cleanup = fn() ?? null;
      s.deps = deps;
    }
    if (!h.dirty) return out;
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

describe('PdfDocument revealing a search match', () => {
  /** The rendered page slots' props, and the scroll area the view holds by ref. */
  function mount(extra) {
    pane.current = { width: 400, height: 600 };
    let out;
    const run = (p) => {
      for (let pass = 0; pass < 20; pass += 1) {
        h.dirty = false;
        h.i = 0;
        h.pending = [];
        out = PdfDocument(p);
        for (const { s, fn, deps } of h.pending) {
          if (typeof s.cleanup === 'function') s.cleanup();
          s.cleanup = fn() ?? null;
          s.deps = deps;
        }
        if (!h.dirty) return out;
      }
      throw new Error('the view kept re-rendering');
    };
    out = run(props(extra));
    const area = { scrollTop: 0, scrollLeft: 0, clientHeight: 600, clientWidth: 400, getBoundingClientRect: () => ({ top: 0, left: 0 }) };
    out.props.ref.current = area;
    const slot = page => out.props.children.props.children.find(el => el.props.page === page).props;
    return { area, slot, rerender: next => { out = run(props(next)); } };
  }
  const range = top => ({ getBoundingClientRect: () => ({ top, height: 10, left: 10, right: 20, width: 10 }) });

  it('a move is revealed once; a page drawn again later, or a view opened on an earlier move, does not scroll back to it', () => {
    const search = { query: 'act', page: 4, index: 0, seq: 5 };
    const { area, slot, rerender } = mount({ search });
    slot(4).onReveal(5, 4, range(900));
    expect(area.scrollTop).toBe(0); // the move made before this view opened

    const next = { query: 'act', page: 4, index: 1, seq: 6 };
    rerender({ search: next });
    slot(4).onReveal(6, 4, range(900));
    const revealed = area.scrollTop;
    expect(revealed).not.toBe(0);

    area.scrollTop = 50_000; // the reader scrolls away; the page leaves the window and returns
    slot(4).onReveal(6, 4, range(900));
    expect(area.scrollTop).toBe(50_000);
  });

  it('reveals the exact citation once, then does not replay it after redraw', () => {
    const { area, slot } = mount({});
    slot(4).onCitationReady(4, range(900));
    expect(area.scrollTop).toBe(641); // range centre 905 minus usable view centre 264
    area.scrollTop = 4000;
    slot(4).onCitationReady(4, range(900));
    expect(area.scrollTop).toBe(4000);
  });

  it('a missing exact mark consumes the fallback rather than replaying on a later draw', () => {
    const { area, slot } = mount({});
    slot(4).onCitationReady(4, null);
    area.scrollTop = 4000;
    slot(4).onCitationReady(4, range(900));
    expect(area.scrollTop).toBe(4000);
  });

  it('a newer page request cancels an undrawn citation return', () => {
    const { area, slot, rerender } = mount({});
    const ready = slot(4).onCitationReady;
    rerender({ scrollRequest: { page: 6, seq: 1 } });
    const top = area.scrollTop;
    ready(4, range(900));
    expect(area.scrollTop).toBe(top);
  });

  it('uses an existing exact range for each repeated return and cancels it on search', () => {
    const { area, slot, rerender } = mount({});
    slot(4).highlighter.set(4, [range(900)]);
    rerender({ scrollRequest: { page: 4, seq: 1 } });
    const top = area.scrollTop;
    // Existing range's centre is used, rather than ending at the stored box's centre.
    expect(top).toBeGreaterThan(2000);
    rerender({ scrollRequest: { page: 4, seq: 2 } });
    expect(area.scrollTop).toBe(top);
    rerender({ search: { query: 'act', page: 4, index: 0, seq: 1 } });
    area.scrollTop = 100;
    slot(4).onCitationReady(4, range(900));
    expect(area.scrollTop).toBe(100);
  });

});


describe('PDF page order', () => {
  it('keeps document order while drawing the nearest page first', () => {
    pane.current = { width: 400, height: 600 };
    const out = render(props());
    const slots = out.props.children.props.children;
    const pages = slots.map(slot => slot.props.page);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
    expect(slots.find(slot => slot.props.priority === 0).props.page).toBe(4);
  });
});
