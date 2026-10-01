// PageViewer's effects, run in node without a DOM (the LiveTvModal.hooks.test.js approach): React's
// hooks are replaced by a small harness that keeps state in slots, runs effects when their deps
// change, and re-renders while state changes. Child components are not rendered; their props are.
//
// Revision 5, point 4 (F45): the viewer hands the part layout it read from document_files to the PDF
// controller and to "Open stored copy", and reports the document state up through onDocumentState
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
    useEffect(fn, deps) {
      const s = slot(() => ({ deps: undefined, cleanup: null }));
      if (deps === undefined || changed(s.deps, deps)) h.pending.push({ s, fn, deps });
      h.effects.add(s);
    },
  };
});

const controllers = [];
vi.mock('./pdfController.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createPdfController: vi.fn((options) => {
    const controller = { options, destroy: vi.fn() };
    controllers.push(controller);
    return controller;
  }),
}));

const storedCopyCalls = [];
vi.mock('./storedCopy.js', async (importOriginal) => ({
  ...(await importOriginal()),
  openStoredCopy: vi.fn((options) => { storedCopyCalls.push(options); return Promise.resolve({ ok: true }); }),
}));

const docResult = { current: null };
vi.mock('./viewerData.js', async (importOriginal) => ({
  ...(await importOriginal()),
  loadDocument: vi.fn(async () => docResult.current),
  createPageLoader: () => ({ peek: () => undefined, load: () => new Promise(() => {}), dispose() {} }),
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
  docResult.current = { status: 'ok', doc: LIVE, parts: PARTS };
});

describe('PageViewer passes the part layout (F45)', () => {
  it('creates the PDF controller with the document_files rows it read', async () => {
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
