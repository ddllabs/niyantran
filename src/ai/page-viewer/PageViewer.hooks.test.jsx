// PageViewer's effects, run in node without a DOM (the LiveTvModal.hooks.test.js approach): React's
// hooks are replaced by a small harness that keeps state in slots, runs effects when their deps
// change, and re-renders while state changes. Child components are not rendered; their props are.
//
// Revision 5, point 4 (F45): the viewer hands the part layout it read from document_files to the PDF
// part pool (viewer-continuous; the single-part controller before it) and to "Open stored copy", and reports the document state up through onDocumentState
// so WorkSurface can disable "Ask about this document".
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = { slots: [], i: 0, pending: [], dirty: false, effects: new Set() };
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
    useId: () => slot(() => ':pv1:'),
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
      h.effects.add(s);
    },
    // The chrome reads the pane's width before paint; here it runs like any effect.
    useLayoutEffect(fn, deps) {
      const s = slot(() => ({ deps: undefined, cleanup: null }));
      if (deps === undefined || changed(s.deps, deps)) h.pending.push({ s, fn, deps });
      h.effects.add(s);
    },
  };
});

const controllers = [];
vi.mock('./pdfPool.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createPdfPool: vi.fn((options) => {
    const pool = { options, destroy: vi.fn(), request: vi.fn(() => ({ cancel() {}, setPriority() {} })) };
    controllers.push(pool);
    return pool;
  }),
}));

const storedCopyCalls = [];
vi.mock('./storedCopy.js', async (importOriginal) => ({
  ...(await importOriginal()),
  openStoredCopy: vi.fn((options) => { storedCopyCalls.push(options); return Promise.resolve({ ok: true }); }),
}));

const docResult = { current: null };
/** Every page the one-page loader was asked for. */
const pageLoads = [];
vi.mock('./viewerData.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadDocument: vi.fn(async () => docResult.current),
  createPageLoader: () => ({ peek: () => undefined, load: (page) => { pageLoads.push(page); return new Promise(() => {}); }, dispose() {} }),
}));

const { default: PageViewer } = await import('./PageViewer.jsx');

function render(props) {
  let out;
  for (let pass = 0; pass < 20; pass += 1) {
    h.dirty = false;
    h.i = 0;
    h.pending = [];
    out = PageViewer(props);
    for (const { s, fn, deps } of h.pending) {
      if (typeof s.cleanup === 'function') s.cleanup();
      s.cleanup = fn() ?? null;
      s.fn = fn;
      s.deps = deps;
    }
    if (!h.dirty) return out;
  }
  throw new Error('the viewer kept re-rendering');
}

/** StrictMode in development: every effect is cleaned up and run again, with refs kept. */
function replayEffects() {
  for (const s of h.effects) {
    if (!s.fn) continue;
    if (typeof s.cleanup === 'function') s.cleanup();
    s.cleanup = s.fn() ?? null;
  }
}

/** Let the document load resolve, re-rendering after each state change. */
async function settle(props) {
  let out = render(props);
  for (let i = 0; i < 10; i += 1) {
    await new Promise(r => setTimeout(r, 0));
    if (h.dirty) out = render(props);
  }
  return out;
}

const LIVE = { id: 'd1', title: 'Bill', file_url: null, storage_path: 'files/a.pdf', extract_hash: 'x1', page_count: 30, indexed_at: '2026-10-01' };
const PARTS = [
  { part_index: 0, page_offset: 0, page_count: 10, byte_size: 1000 },
  { part_index: 1, page_offset: 10, page_count: 20, byte_size: 2000 },
];
const CITATION = {
  id: 1, kind: 'text', chunk_id: 'c1', document_id: 'd1', title: 'Bill', file_name: 'bill.pdf',
  char_from: 10, char_to: 20, text_hash: 'h', source_kind: 'pdf_page', page_number: 12, extract_hash: 'x1',
};
const documentFile = { partFor: vi.fn(), invalidate: vi.fn() };
const base = { client: {}, documentFile, loadPdfjs: async () => ({}), storage: null };

/** The ViewerBody element's `shared` props inside the rendered section. */
function sharedOf(out) {
  const section = [out.props.children].flat().find(child => child?.type === 'section');
  const body = [section.props.children].flat().find(child => child?.props?.shared);
  return body.props.shared;
}

beforeEach(() => {
  h.slots = [];
  h.effects = new Set();
  controllers.length = 0;
  storedCopyCalls.length = 0;
  pageLoads.length = 0;
  docResult.current = { status: 'ok', doc: LIVE, parts: PARTS };
});

describe('PageViewer passes the part layout (F45)', () => {
  it('creates the PDF part pool with the document_files rows it read', async () => {
    await settle({ ...base, citation: CITATION });
    expect(controllers).toHaveLength(1);
    expect(controllers[0].options.documentId).toBe('d1');
    expect(controllers[0].options.parts).toBe(PARTS);
    expect(controllers[0].options.documentFile).toBe(documentFile);
  });

  it('opens the stored copy with the same layout', async () => {
    const out = await settle({ ...base, citation: CITATION });
    sharedOf(out).onStoredCopy();
    expect(storedCopyCalls).toHaveLength(1);
    expect(storedCopyCalls[0]).toMatchObject({ documentId: 'd1', page: 12, parts: PARTS, documentFile });
  });
});

describe('PageViewer onDocumentState', () => {
  it('reports the state once, not on every render', async () => {
    const onDocumentState = vi.fn();
    const props = { ...base, citation: CITATION, onDocumentState };
    await settle(props);
    render(props);
    render(props);
    expect(onDocumentState.mock.calls).toEqual([['ok']]);
  });

  it('reports once under StrictMode, which replays every effect', async () => {
    const onDocumentState = vi.fn();
    await settle({ ...base, citation: CITATION, onDocumentState });
    replayEffects();
    expect(onDocumentState.mock.calls).toEqual([['ok']]);
  });

  it('reports each value of the state table it can know before a page loads', async () => {
    const cases = [
      [{ status: 'gone' }, CITATION, 'gone'],
      [{ status: 'ok', doc: { ...LIVE, indexed_at: null }, parts: [] }, CITATION, 'not_live'],
      [{ status: 'ok', doc: { ...LIVE, storage_path: null }, parts: [] }, CITATION, 'text_only'],
      [{ status: 'ok', doc: LIVE, parts: PARTS }, { ...CITATION, extract_hash: 'old' }, 'stale'],
      [{ status: 'ok', doc: LIVE, parts: PARTS }, { ...CITATION, extract_hash: undefined }, 'unknown_freshness'],
    ];
    for (const [result, citation, expected] of cases) {
      h.slots = [];
      h.effects = new Set();
      docResult.current = result;
      const onDocumentState = vi.fn();
      await settle({ ...base, citation, onDocumentState });
      expect(onDocumentState.mock.calls, expected).toEqual([[expected]]);
    }
  });

  it('reports again only when the state changes', async () => {
    const onDocumentState = vi.fn();
    await settle({ ...base, citation: CITATION, onDocumentState });
    const stale = { ...CITATION, extract_hash: 'old' };
    render({ ...base, citation: stale, onDocumentState });
    render({ ...base, citation: stale, onDocumentState });
    expect(onDocumentState.mock.calls).toEqual([['ok'], ['stale']]);
  });

  it('reports nothing while the document is loading or failed to load', async () => {
    docResult.current = { status: 'error' };
    const onDocumentState = vi.fn();
    await settle({ ...base, citation: CITATION, onDocumentState });
    expect(onDocumentState).not.toHaveBeenCalled();
  });

  it('calls the latest callback it was given', async () => {
    const first = vi.fn();
    const second = vi.fn();
    await settle({ ...base, citation: CITATION, onDocumentState: first });
    render({ ...base, citation: { ...CITATION, extract_hash: 'old' }, onDocumentState: second });
    expect(first.mock.calls).toEqual([['ok']]);
    expect(second.mock.calls).toEqual([['stale']]);
  });

  it('tolerates the prop being absent', async () => {
    await expect(settle({ ...base, citation: CITATION })).resolves.toBeTruthy();
  });
});

// viewer-whole-page spec: the zoom is saved only when the reader chooses it. Every viewer used to
// save its starting zoom on mount, which made the old default look like everyone's choice.
describe('PageViewer saves the zoom only when the reader chooses it', () => {
  const memory = () => {
    const data = new Map();
    return { getItem: k => data.get(k) ?? null, setItem: vi.fn((k, v) => data.set(k, String(v))), data };
  };

  it('writes nothing on mount', async () => {
    const storage = memory();
    await settle({ ...base, storage, citation: CITATION });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('writes the fit the reader picks', async () => {
    const storage = memory();
    const out = await settle({ ...base, storage, citation: CITATION });
    sharedOf(out).setZoomState({ fit: 'page', zoom: null });
    render({ ...base, storage, citation: CITATION });
    expect(JSON.parse(storage.data.get('niyantranCitationZoomV2'))).toEqual({ fit: 'page', zoom: null });
  });
});

// Review of viewer-continuous: the continuous Text view reads its pages in batches, so a page
// reached by scrolling must not also go through the one-page loader (a row, its blocks and both
// neighbours per page, aborting the cited page's read).
describe('PageViewer in the continuous Text view', () => {
  const memory = entries => ({ getItem: k => entries[k] ?? null, setItem: vi.fn() });

  it('reads no page through the one-page loader as the reader scrolls', async () => {
    const storage = memory({ niyantranCitationView: 'text', niyantranTextLayout: 'continuous' });
    const out = await settle({ ...base, storage, citation: CITATION });
    const shared = sharedOf(out);
    expect(shared.textDocument).not.toBeNull();
    shared.textDocument.onPage(15);
    render({ ...base, storage, citation: CITATION });
    expect(pageLoads.filter(page => page !== CITATION.page_number)).toEqual([]);
    expect(pageLoads.filter(page => page === CITATION.page_number)).toHaveLength(1);
  });
});


describe('reopening the same citation', () => {
  it('issues a fresh return without recreating the pool or losing zoom', async () => {
    const props = { ...base, citation: CITATION, revealRequest: {} };
    let out = await settle(props);
    sharedOf(out).setZoomState({ fit: 'width', zoom: 1.5 });
    sharedOf(out).goTo(15);
    out = render(props);
    expect(sharedOf(out).page).toBe(15);
    out = render({ ...props, revealRequest: {} });
    expect(sharedOf(out).page).toBe(12);
    expect(sharedOf(out).zoomState.zoom).toBe(1.5);
    expect(controllers).toHaveLength(1);
    out = render({ ...props, revealRequest: {} });
    expect(sharedOf(out).page).toBe(12);
    expect(controllers).toHaveLength(1);
  });
});


it('repeated citation opens on the cited page still issue distinct scroll requests', async () => {
  const storage = { getItem: key => ({ niyantranCitationView: 'text', niyantranTextLayout: 'continuous' })[key] ?? null };
  const props = { ...base, citation: CITATION, storage, revealRequest: {} };
  await settle(props);
  let out = render({ ...props, revealRequest: {} });
  const first = sharedOf(out).textDocument.scrollRequest;
  out = render({ ...props, revealRequest: {} });
  expect(sharedOf(out).textDocument.scrollRequest).toEqual({ page: 12, seq: first.seq + 1 });
});
