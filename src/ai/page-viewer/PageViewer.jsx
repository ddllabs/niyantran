/**
 * The page-wise citation viewer (docs/specs/2026-10-01-rag-v2-citations-pdf.md, revision 3 and
 * the revision 4 amendment). A lazy chunk: WorkSurface loads it with React.lazy for `pdf_page`
 * citations only, so this module, pdf.js and its CSS stay out of the main bundle.
 *
 * It opens on the cited page with a PDF | Text switch over one shared current page, a fit and
 * zoom choice (Fit text by default), and a Full view that shows the same viewer in a modal
 * dialog. The page, the view and the zoom live here, so the inline viewer and the full view
 * share them both ways. The citation arrives already through `sanitizeCitation` (WorkSurface is
 * the single sanitising point). Every notice is a fixed sentence; no error text and no signed
 * URL is ever rendered or logged.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { defaultDocumentFileClient } from '../../lib/documentFile.js';
import { loadPdfjs } from '../../lib/pdfjs.js';
import { supabase } from '../../lib/supabaseClient.js';
import { safeSourceUrl } from '../SourceReader.jsx';
import { useCompact, useTipWarmth } from './chromeHooks.js';
import { chromePlan, sectionParts } from './chromeModel.js';
import { DocumentRow, FullHeader, MoreMenu, ViewSwitch } from './DocumentChrome.jsx';
import PageControls from './PageControls.jsx';
import PageRail from './PageRail.jsx';
import SearchBar from './SearchBar.jsx';
import { naturalWidths, pageAspects } from './layoutModel.js';
import { needsFallback } from './highlights.js';
import { citedPieces } from './passageMatch.js';
import { pageBoxes, viewerState } from './pageModel.js';
import PdfDocument, { PILL_SPACE_PX, PdfOverlay } from './PdfDocument.jsx';
import { pdfFailureNotice } from './pdfController.js';
import { createPdfPool } from './pdfPool.js';
import { openStoredCopy } from './storedCopy.js';
import TextDocument from './TextDocument.jsx';
import { readTextLayout, writeTextLayout } from './textModel.js';
import TextPage from './TextPage.jsx';
import { createThumbnailCache, thumbnailKey } from './thumbnailCache.js';
import { useDocumentSearch } from './useDocumentSearch.js';
import { usePageTexts } from './usePageTexts.js';
import { createPageLoader, loadDocument, loadPageSizes } from './viewerData.js';
import { VIEWER_ATTRIBUTE, attachFullView, narrowQuery, isNarrow, themeClassOf } from './viewerDom.js';
import {
  NOTICES, chooseView, overlayFor, pageTotal, pagingKey, pdfAvailable, readViewChoice, resolveCitedPieces, storedCopyLabel,
  writeViewChoice,
} from './viewerModel.js';
import { nextZoomStep, readZoomState, textColumn, writeZoomState, zoomBy, zoomReadout } from './zoomModel.js';

import '../research.css';
import '../reader.css';
import './viewer.css';

/** One file client for the app, so part signatures are cached across viewers. */
let sharedClient = null;
function sharedDocumentFile() {
  if (!sharedClient) sharedClient = defaultDocumentFileClient();
  return sharedClient;
}
const defaultFetch = (...args) => globalThis.fetch(...args);
/** One thumbnail cache for the app, so a reopened document shows its thumbnails at once. */
let sharedThumbs = null;
function sharedThumbnailCache() {
  if (!sharedThumbs) sharedThumbs = createThumbnailCache();
  return sharedThumbs;
}
/** Stands in for a loaded page row when only the document-level state is wanted. */
const ANY_ROW = Object.freeze({});
const NO_BLOCKS = Object.freeze([]);
const NO_PARTS = Object.freeze([]);
/** The cited passage's pieces before they are known, or where no span is shown. */
const NO_PIECES = Object.freeze({ status: 'none', pieces: null });
const SPAN_STATES = new Set(['ok', 'unknown_freshness']);
/** A4 portrait: the shape of a page whose stored size is missing, until it is drawn. */
const A4_ASPECT = 842 / 595;
/** A drawn page's shape replaces its slot's only when they differ by more than this share. */
const ASPECT_TOLERANCE = 0.01;

/** The document-level loading, failure and deletion notices. */
export function DocumentNotice({ status, onRetry }) {
  if (status === 'loading') return <p className="ai-reader-notice">Loading…</p>;
  if (status === 'gone') return <p className="ai-reader-notice warn" role="alert">{NOTICES.gone}</p>;
  if (status === 'error') {
    return (
      <p className="ai-reader-notice warn" role="alert">
        {NOTICES.loadFailed}{' '}
        {onRetry ? <button type="button" className="pv-retry" onClick={onRetry}>Retry</button> : null}
      </p>
    );
  }
  return null;
}

/** The state table's banners, plus the PDF and stored-copy failure notices. */
export function StateNotices({ state, pdfError = '', copyNotice = '', onRetryPdf }) {
  const items = [];
  if (state === 'not_live') items.push(<p key="live" className="ai-reader-notice" role="status">{NOTICES.notLive}</p>);
  if (state === 'stale') items.push(<p key="stale" className="ai-reader-notice warn" role="status">{NOTICES.stale}</p>);
  if (pdfError) {
    items.push(
      <p key="pdf" className="ai-reader-notice warn" role="alert">
        {pdfError}{' '}
        {onRetryPdf ? <button type="button" className="pv-retry" onClick={onRetryPdf}>Retry</button> : null}
      </p>,
    );
  }
  if (copyNotice) items.push(<p key="copy" className="ai-reader-notice warn" role="alert">{copyNotice}</p>);
  return items.length ? <>{items}</> : null;
}

/**
 * The full view's markup: a modal dialog labelled by the document title, in the app's theme. The
 * root is the backdrop (the 24 px margin) and is marked as part of the citation viewer.
 */
export function FullViewDialog({ titleId, themeClass = '', rootRef = null, dialogRef = null, children }) {
  return (
    <div className={`pv-full-root${themeClass ? ` ${themeClass}` : ''}`} {...{ [VIEWER_ATTRIBUTE]: 'full-view' }} ref={rootRef}>
      <div className="pv-full" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={dialogRef}>
        {children}
      </div>
    </div>
  );
}

/**
 * The full view, portalled to the body over the whole screen. Focus moves to its close control,
 * Tab stays inside, and Esc or a click on the backdrop closes it without reaching the overlay
 * (attachFullView); on close, focus returns to the Expand control.
 */
function FullView({ titleId, themeClass, onClose, initialFocusRef, returnFocusRef, children }) {
  const rootRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return undefined;
    return attachFullView({
      container: node,
      backdrop: rootRef.current,
      initialFocus: initialFocusRef.current,
      returnFocus: () => returnFocusRef.current,
      onClose: () => closeRef.current?.(),
    });
  }, [initialFocusRef, returnFocusRef]);
  return createPortal(<FullViewDialog titleId={titleId} themeClass={themeClass} rootRef={rootRef} dialogRef={dialogRef}>{children}</FullViewDialog>, document.body);
}

/** True at phone width, following the breakpoint; desktop when matchMedia is unavailable. */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => isNarrow());
  useEffect(() => {
    const query = narrowQuery();
    if (!query) return undefined;
    const update = () => setNarrow(Boolean(query.matches));
    try {
      query.addEventListener('change', update);
    } catch {
      return undefined;
    }
    return () => {
      try {
        query.removeEventListener('change', update);
      } catch {
        // The query list is gone with the window.
      }
    };
  }, []);
  return narrow;
}

/**
 * One copy of the viewer's body (docs/specs/2026-10-02-viewer-toolbar.md). It is drawn inline or
 * in the full view, never both at once, so one PDF controller renders one canvas. The effective
 * zoom (for the readout and the − / + steps) belongs to this pane's own size.
 *
 * Inline, under WorkSurface's bar: the document row, then the page toolbar, then the page. In the
 * full view, whose header PageViewer draws: the page with the page pill floating at its foot.
 */
function ViewerBody({ shared, full = false, compact = false, onExpand = null, expandRef = null }) {
  const {
    docState, onRetryDoc, doc, available, view, onView, zoomState, setZoomState, storedLabel, onStoredCopy, onKeys,
    state, pdfError, copyNotice, retryPdf, showPages, page, total, cited, goTo, title,
    pageRow, onPdfFailure, pageStatus, textSpan, onRetryPage, fileUrl, fileName, section, narrow, pdfDocument, search, rail,
    textDocument, textLayout,
  } = shared;
  // The rail: a drawer over the pages in the side pane, a column in the full view; PDF view only.
  const railShown = Boolean(rail && pdfDocument && showPages && view === 'pdf');
  const railOpen = full ? rail?.columnOpen : rail?.drawerOpen;
  const [liveZoom, setLiveZoom] = useState(null);
  const effective = zoomState.zoom ?? liveZoom;
  const effectiveRef = useRef(effective);
  useEffect(() => { effectiveRef.current = effective; }, [effective]);

  const onWheelZoom = useCallback(
    factor => setZoomState(prev => ({ fit: prev.fit, zoom: zoomBy(prev.zoom ?? effectiveRef.current ?? 1, factor) })),
    [setZoomState],
  );
  const plan = chromePlan({ available, view, compact, narrow, full });
  const zoom = plan.toolbarZoom || plan.moreZoom ? {
    fit: zoomState.fit,
    manual: zoomState.zoom !== null,
    readout: zoomReadout(effective),
    canZoomOut: effective !== null && nextZoomStep(effective, -1) !== null,
    canZoomIn: effective !== null && nextZoomStep(effective, 1) !== null,
    onZoomStep: (direction) => {
      const next = nextZoomStep(effective, direction);
      if (next !== null) setZoomState(prev => ({ fit: prev.fit, zoom: next }));
    },
    onFit: fit => setZoomState({ fit, zoom: null }),
  } : null;

  const pages = showPages ? (
    <PageControls
      variant={full ? 'pill' : 'toolbar'}
      page={page}
      total={total}
      cited={cited}
      onPage={goTo}
      zoom={plan.toolbarZoom ? zoom : null}
      onExpand={plan.expand ? onExpand : null}
      expandRef={expandRef}
      onKeyDown={onKeys}
      onSearch={full || !search.available ? null : search.openSearch}
      searchOpen={search.open}
      searchRef={search.toggleRef}
      onRail={railShown ? (full ? rail.toggleColumn : rail.toggleDrawer) : null}
      railOpen={Boolean(railOpen)}
      railRef={rail?.toggleRef}
    />
  ) : null;
  // The side pane's third row; the full view draws its own under its header.
  const searchRow = !full && search.available && search.open ? <DocumentSearch search={search} view={view} onView={onView} /> : null;
  let content = null;
  if (showPages && view === 'pdf') {
    content = pdfDocument ? (
      <PdfDocument
        {...pdfDocument}
        title={title}
        total={total}
        zoomState={zoomState}
        insetBottom={full ? PILL_SPACE_PX : 0}
        onZoom={setLiveZoom}
        onWheelZoom={onWheelZoom}
        onFailure={onPdfFailure}
        search={search.target}
        onSearchCount={search.onLayerCount}
      />
    ) : <p className="ai-reader-notice">Loading…</p>;
    if (railShown && !full) {
      content = (
        <div className="pv-body">
          <PageRail variant="drawer" open={rail.drawerOpen} onClose={rail.closeDrawer} {...rail.props} />
          {content}
        </div>
      );
    }
  } else if (showPages && view === 'text' && textDocument) {
    content = (
      <TextDocument
        {...textDocument}
        title={title}
        total={total}
        search={search.target}
        onSearchCount={search.onLayerCount}
        insetBottom={full ? PILL_SPACE_PX : 0}
      />
    );
  } else if (showPages && view === 'text') {
    content = (
      <TextPage
        status={pageStatus}
        pageRow={pageRow}
        span={textSpan}
        onRetry={onRetryPage}
        page={page}
        search={search.target}
        onSearchCount={search.onLayerCount}
      />
    );
  }

  return (
    <>
      <DocumentNotice status={docState.status} onRetry={onRetryDoc} />
      {doc && !full ? (
        <DocumentRow
          section={section}
          viewSwitch={plan.viewSwitch ? <ViewSwitch view={view} onView={onView} /> : null}
          fileUrl={fileUrl}
          more={<MoreMenu zoom={plan.moreZoom ? zoom : null} textLayout={textLayout} storedLabel={storedLabel} onStoredCopy={onStoredCopy} fileName={fileName} />}
          onKeyDown={onKeys}
        />
      ) : null}
      {doc ? <StateNotices state={state} pdfError={pdfError} copyNotice={copyNotice} onRetryPdf={retryPdf} /> : null}
      {full ? (
        showPages ? (
          <div className="pv-split">
            {railShown ? <PageRail variant="column" open={rail.columnOpen} onClose={rail.toggleColumn} {...rail.props} /> : null}
            <div className="pv-stage">{content}{pages}</div>
          </div>
        ) : null
      ) : (
        <>
          {pages}
          {searchRow}
          {content}
        </>
      )}
    </>
  );
}

/** The search row, wired to the viewer's search state; its note switches to the Text view. */
function DocumentSearch({ search, view, onView }) {
  return (
    <SearchBar
      query={search.text}
      label={search.label}
      total={search.total}
      onQuery={search.onQuery}
      onStep={search.step}
      onClose={search.close}
      onTextView={search.recognisedOnly && view === 'pdf' ? () => onView('text') : null}
      inputRef={search.inputRef}
    />
  );
}

/**
 * @param {{
 *   citation: import('../../types/citation.js').TextCitation,
 *   client?: typeof supabase,
 *   documentFile?: ReturnType<typeof defaultDocumentFileClient>,
 *   loadPdfjs?: typeof loadPdfjs,
 *   fetch?: typeof fetch,
 *   storage?: Storage,
 *   onDocumentState?: (state: 'ok' | 'gone' | 'not_live' | 'stale' | 'text_only' | 'unknown_freshness'
 *     | 'no_page_text') => void,
 * }} props
 *   `onDocumentState` is told the document's row of the state table once per change, so the host
 *   can disable "Ask about this document" for a deleted or not-live document (revision 5,
 *   point 4). Nothing is reported while the document is loading or failed to load.
 */
export default function PageViewer({
  citation, client = supabase, documentFile = sharedDocumentFile(), loadPdfjs: load = loadPdfjs,
  fetch: fetchImpl = defaultFetch, storage, onDocumentState,
}) {
  const documentId = citation.document_id;
  const cited = citation.page_number;
  const [docState, setDocState] = useState({ status: 'loading' });
  const [docNonce, setDocNonce] = useState(0);
  const [page, setPage] = useState(cited);
  const [pageState, setPageState] = useState({ page: null, status: 'loading', row: null, blocks: NO_BLOCKS });
  const [pageNonce, setPageNonce] = useState(0);
  const [stored] = useState(() => readViewChoice(storage));
  const [choice, setChoice] = useState(null);
  const [zoomState, setZoom] = useState(() => readZoomState(storage));
  // Saved only once the reader chooses a fit or zoom (viewer-whole-page spec): saving on mount made
  // the starting zoom look like everyone's choice.
  const zoomChosen = useRef(false);
  const setZoomState = useCallback((update) => {
    zoomChosen.current = true;
    setZoom(update);
  }, []);
  const [pdfError, setPdfError] = useState('');
  const [pdfNonce, setPdfNonce] = useState(0);
  const [pool, setPool] = useState(null);
  const [sizes, setSizes] = useState({ status: 'loading', rows: [] });
  const [citedState, setCitedState] = useState({ status: 'loading', row: null, blocks: NO_BLOCKS });
  const [citedNonce, setCitedNonce] = useState(0);
  const [nextRow, setNextRow] = useState(null);
  const [railTab, setRailTab] = useState('pages');
  const [textLayoutValue, setTextLayout] = useState(() => readTextLayout(storage));
  const [textPieces, setTextPieces] = useState(NO_PIECES);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [columnOpen, setColumnOpen] = useState(true);
  const railToggleRef = useRef(null);
  const [markResults, setMarkResults] = useState(() => new Map());
  const [citedBase, setCitedBase] = useState(null);
  const [measured, setMeasured] = useState(() => new Map());
  const [scrollRequest, setScrollRequest] = useState(null);
  const [copyNotice, setCopyNotice] = useState('');
  const [full, setFull] = useState(false);
  const [themeClass, setThemeClass] = useState('');
  const narrow = useNarrow();
  const loaderRef = useRef(null);
  const sectionRef = useRef(null);
  const expandRef = useRef(null);
  const closeFullRef = useRef(null);
  const fullSectionRef = useRef(null);
  const onStateRef = useRef(onDocumentState);
  const reportedRef = useRef(null);
  const titleId = useId();

  const doc = docState.status === 'ok' ? docState.doc : null;
  const parts = docState.status === 'ok' ? docState.parts : NO_PARTS;
  const total = pageTotal(doc, parts, cited);
  const state = docState.status === 'gone' ? 'gone' : doc ? viewerState({ doc, citation, pageRow: ANY_ROW }) : null;
  const available = pdfAvailable({ doc, parts, state });
  const view = chooseView({ available, stored, choice, failed: Boolean(pdfError) });
  const live = Boolean(doc && doc.indexed_at != null);
  const showPages = Boolean(doc) && state !== 'not_live';
  const boxesAllowed = state === 'ok';
  const spanAllowed = SPAN_STATES.has(state);
  const onThisPage = pageState.page === page;
  const pageRow = onThisPage ? pageState.row : null;
  const fullOpen = full && !narrow;
  const compact = useCompact(sectionRef);
  useTipWarmth(sectionRef, true);
  useTipWarmth(fullSectionRef, fullOpen);
  const docSearch = useDocumentSearch({ client, documentId, extractHash: doc?.extract_hash ?? null, page });
  const search = { ...docSearch, available: showPages && Boolean(doc?.extract_hash) };
  // The continuous Text view reads the page text in batches as it scrolls.
  const textContinuous = showPages && view === 'text' && textLayoutValue === 'continuous';
  const pageTexts = usePageTexts({ client, documentId, extractHash: doc?.extract_hash ?? null, total, enabled: textContinuous });

  // The document and its parts.
  useEffect(() => {
    const abort = new AbortController();
    setDocState({ status: 'loading' });
    loadDocument(client, documentId, abort.signal).then((result) => {
      if (!abort.signal.aborted) setDocState(result);
    });
    return () => abort.abort();
  }, [client, documentId, docNonce]);

  // One page loader per loaded document extraction.
  useEffect(() => {
    if (!doc) return undefined;
    const loader = createPageLoader({ client, documentId, extractHash: doc.extract_hash, total });
    loaderRef.current = loader;
    return () => {
      loader.dispose();
      if (loaderRef.current === loader) loaderRef.current = null;
    };
  }, [client, documentId, doc, total]);

  // Every page's stored size, read once, so the continuous view lays out every page first.
  useEffect(() => {
    if (!doc || !showPages) return undefined;
    const abort = new AbortController();
    setSizes({ status: 'loading', rows: [] });
    loadPageSizes(client, documentId, doc.extract_hash, abort.signal, { total }).then((result) => {
      if (!abort.signal.aborted) setSizes({ status: result.status, rows: result.status === 'ok' ? result.rows : [] });
    });
    return () => abort.abort();
  }, [client, documentId, doc, showPages, total]);

  // The cited page's row and blocks, read once: its text column (Fit text), its boxes (the
  // overlay) and its text (the exact mark). A read that paging in the Text view aborted is retried.
  useEffect(() => {
    const loader = loaderRef.current;
    if (!loader || !showPages) return undefined;
    let alive = true;
    loader.load(cited).then((result) => {
      if (!alive) return;
      if (result.status === 'aborted') setCitedNonce(n => n + 1);
      else setCitedState({ status: result.status, row: result.row ?? null, blocks: result.blocks ?? NO_BLOCKS });
    });
    return () => { alive = false; };
  }, [doc, showPages, cited, citedNonce]);

  // A citation that runs past its page: the next page's row too, for its piece of the exact mark.
  const spills = citedState.row && Number.isSafeInteger(citation.char_to) && citation.char_to > citedState.row.char_to && cited < total;
  useEffect(() => {
    const loader = loaderRef.current;
    if (!loader || !spills) return undefined;
    let alive = true;
    loader.load(cited + 1).then((result) => { if (alive && result.status === 'ok') setNextRow(result.row ?? null); });
    return () => { alive = false; };
  }, [spills, cited]);

  // The Text view's current page: its text row; paging away aborts the stale fetch.
  useEffect(() => {
    const loader = loaderRef.current;
    if (!loader || !showPages || view !== 'text') return undefined;
    let alive = true;
    const cached = loader.peek(page);
    setPageState(cached !== undefined
      ? { page, status: 'ok', row: cached.row, blocks: cached.blocks }
      : { page, status: 'loading', row: null, blocks: NO_BLOCKS });
    loader.load(page).then((result) => {
      if (alive && result.status !== 'aborted') {
        setPageState({ page, status: result.status, row: result.row ?? null, blocks: result.blocks ?? NO_BLOCKS });
      }
    });
    return () => { alive = false; };
  }, [doc, showPages, view, page, pageNonce]);

  // The cited passage on each page it touches, for the Text view in both layouts: checked against
  // the citation's hash, across a page break when it runs onto the next page (read above).
  const citedTextRow = citedState.row;
  useEffect(() => {
    if (!spanAllowed || !citedTextRow) {
      setTextPieces(NO_PIECES);
      return undefined;
    }
    const runsOn = Number.isSafeInteger(citation.char_to) && citation.char_to > citedTextRow.char_to && cited < total;
    if (runsOn && !nextRow) return undefined;
    let alive = true;
    resolveCitedPieces(citation, runsOn ? [citedTextRow, nextRow] : [citedTextRow]).then((result) => {
      if (!alive) return;
      setTextPieces(result.status === 'exact'
        ? { status: 'exact', pieces: new Map(result.pieces.map(p => [p.page, { from: p.from, to: p.to }])) }
        : { status: 'changed', pieces: null });
    });
    return () => { alive = false; };
  }, [spanAllowed, citedTextRow, nextRow, citation, cited, total]);

  // The document state goes up once per change (the host's Ask button). The last reported value is
  // kept in a ref, so StrictMode's effect replay does not report twice; it starts at null, so a
  // loading or failed document (state null) is never reported.
  useEffect(() => { onStateRef.current = onDocumentState; });
  useEffect(() => {
    if (state === reportedRef.current) return;
    reportedRef.current = state;
    onStateRef.current?.(state);
  }, [state]);

  // The part pool lives while the PDF view is available; Retry replaces it. It gets the part
  // layout, so the file client signs once per part however fast the reader scrolls (F45).
  const layout = available ? parts : null;
  useEffect(() => {
    if (!layout) return undefined;
    const created = createPdfPool({ documentId, documentFile, parts: layout, loadPdfjs: load, fetch: fetchImpl });
    setPool(created);
    return () => {
      created.destroy();
      setPool(previous => (previous === created ? null : previous));
    };
  }, [layout, documentId, documentFile, load, fetchImpl, pdfNonce]);

  // The chosen fit or zoom is remembered in this browser.
  useEffect(() => {
    if (zoomChosen.current) writeZoomState(zoomState, storage);
  }, [zoomState, storage]);

  // The toolbar's paging: the page, and in the PDF view a scroll to it.
  const goTo = useCallback((next) => {
    const target = Math.min(Math.max(1, next), total);
    setPage(target);
    setScrollRequest(prev => ({ page: target, seq: (prev?.seq ?? 0) + 1 }));
  }, [total]);
  // A drawn page: the cited page's natural size (Fit text, the overlay), and any page's true shape
  // where its stored size was missing or wrong.
  const onMeasured = useCallback((drawn, result) => {
    if (drawn === cited) setCitedBase(prev => (prev && prev.width === result.viewport.width && prev.height === result.viewport.height ? prev : result.viewport));
    const aspect = result.viewport.height / result.viewport.width;
    setMeasured((prev) => {
      const known = prev.get(drawn);
      if (known !== undefined && Math.abs(known - aspect) <= ASPECT_TOLERANCE * known) return prev;
      return new Map(prev).set(drawn, aspect);
    });
  }, [cited]);

  // In the Text view a move to a match turns to its page; the PDF view scrolls to the match itself.
  const matchPage = search.match?.page ?? null;
  useEffect(() => {
    if (view !== 'pdf' && !textContinuous && matchPage !== null) setPage(matchPage);
  }, [search.seq]); // eslint-disable-line react-hooks/exhaustive-deps -- once per move

  // ⌘/Ctrl+F while focus is inside the viewer opens search, or returns to its field; elsewhere the
  // browser's own find is left alone.
  const onFindKey = (event) => {
    if (!search.available || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return;
    event.preventDefault();
    search.openSearch();
  };

  const onKeys = (event) => {
    const target = event.target;
    const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
    const next = pagingKey({
      key: event.key,
      targetTag: target?.tagName,
      editable: Boolean(target?.isContentEditable),
      hasSelection: Boolean(selection && !selection.isCollapsed),
      inMenu: Boolean(target?.closest?.('[role="menu"]')),
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    }, { page, cited, total });
    if (next === null) return;
    event.preventDefault();
    goTo(next);
  };

  const onView = (next) => {
    setChoice(next);
    writeViewChoice(next, storage);
    if (next === 'pdf' && pdfError) retryPdf();
  };
  function retryPdf() {
    setPdfError('');
    setPdfNonce(n => n + 1);
  }
  const onPdfFailure = useCallback(error => setPdfError(pdfFailureNotice(error)), []);
  const onStoredCopy = () => {
    setCopyNotice('');
    openStoredCopy({ documentFile, documentId, page, parts }).then((result) => {
      if (!result.ok) setCopyNotice(result.notice);
    });
  };
  const openFull = () => {
    setThemeClass(themeClassOf(sectionRef.current));
    setFull(true);
  };
  const closeFull = useCallback(() => setFull(false), []);

  const title = doc?.title ?? citation.title;
  const fileUrl = safeSourceUrl(doc?.file_url) || safeSourceUrl(citation.file_url);
  const textPiece = textPieces.pieces?.get(page) ?? null;
  const textSpan = textPiece ? { status: 'exact', ...textPiece } : textPieces.status === 'changed' && page === cited ? { status: 'changed' } : null;
  const pdfShown = showPages && view === 'pdf';
  // The PDF view and the continuous Text view scroll in their own region, which fills the pane.
  const fills = pdfShown || textContinuous;

  // The continuous view's inputs, once the page sizes and the cited page are known.
  const citedRow = citedState.row;
  const citedBoxes = useMemo(() => (boxesAllowed ? pageBoxes(citation, cited) : []), [boxesAllowed, citation, cited]);
  const aspects = useMemo(() => {
    const fallback = citedRow?.width_px > 0 && citedRow?.height_px > 0 ? citedRow.height_px / citedRow.width_px : A4_ASPECT;
    const list = pageAspects(sizes.rows, total, fallback);
    for (const [drawn, aspect] of measured) if (drawn <= list.length) list[drawn - 1] = aspect;
    return list;
  }, [sizes.rows, total, citedRow, measured]);
  const citedPt = citedBase?.width ?? null;
  const naturalPts = useMemo(() => naturalWidths(sizes.rows, total, { cited, citedPt }), [sizes.rows, total, cited, citedPt]);
  const citedColumn = useMemo(
    () => (zoomState.fit === 'text' ? textColumn(citedState.blocks, citedBoxes) : null),
    [zoomState.fit, citedState.blocks, citedBoxes],
  );
  const citedBox = citedBoxes.length
    ? { y0: Math.min(...citedBoxes.map(b => b.y0)), y1: Math.max(...citedBoxes.map(b => b.y1)) }
    : null;
  // The exact mark: each page's piece of the cited passage, from the stored page text, when the
  // stored text is the cited extraction's (as for the Text view's span).
  const marks = useMemo(() => {
    if (!spanAllowed || !citedRow) return null;
    const rows = nextRow ? [citedRow, nextRow] : [citedRow];
    return new Map(citedPieces(citation, rows).map(piece => [piece.page, rows.find(r => r.page_number === piece.page).text.slice(piece.from, piece.to)]));
  }, [spanAllowed, citedRow, nextRow, citation]);
  // Each page's last mark, with the text it was made for, so a result for an earlier passage is not
  // taken for the current one.
  const onMark = useCallback((marked, text, result) => {
    setMarkResults((prev) => {
      const last = prev.get(marked);
      return last?.text === text && last.result === result ? prev : new Map(prev).set(marked, { text, result });
    });
  }, []);
  // The layout boxes only where the exact mark cannot be made on the cited page.
  const citedFallback = needsFallback({ marks, results: markResults, page: cited });
  const overlays = useMemo(() => new Map(citedFallback
    ? [[cited, <PdfOverlay key="cited" overlay={overlayFor({ citation, page: cited, cited, boxesAllowed, pageRow: citedRow, viewport: citedBase })} />]]
    : []), [citedFallback, citation, cited, boxesAllowed, citedRow, citedBase]);
  const pdfReady = Boolean(pool) && sizes.status !== 'loading' && citedState.status !== 'loading';
  const pdfDocument = pdfReady ? {
    pool, aspects, naturalPts, cited, citedColumn, citedPt: citedPt ?? naturalPts[cited - 1], citedBox, overlays, marks, onMark,
    scrollRequest, onPage: setPage, onMeasured, openAt: page,
  } : null;

  // The rail's inputs: thumbnails from the pool, the search's counts and Results.
  const thumbs = useMemo(
    () => (pool ? { pool, cache: sharedThumbnailCache(), keyOf: at => thumbnailKey(documentId, parts, at) } : null),
    [pool, documentId, parts],
  );
  const found = search.open && search.result.query && search.result.status === 'ok' ? search.result : null;
  const counts = useMemo(() => new Map((found?.pages ?? []).map(p => [p.page, p.hits])), [found]);
  const rail = {
    drawerOpen,
    columnOpen,
    toggleRef: railToggleRef,
    toggleDrawer: () => setDrawerOpen(open => !open),
    closeDrawer: () => {
      setDrawerOpen(false);
      railToggleRef.current?.focus();
    },
    toggleColumn: () => setColumnOpen(open => !open),
    props: {
      tab: railTab,
      onTab: setRailTab,
      aspects,
      total,
      current: page,
      cited,
      counts,
      onPick: goTo,
      thumbs,
      results: found ? { query: found.query, pages: found.pages, onPick: search.pick, current: search.match?.page ?? null } : null,
    },
  };

  const { need: needText } = pageTexts;
  const retryText = useCallback(at => needText([at]), [needText]);
  const onTextLayout = (value) => {
    setTextLayout(value);
    writeTextLayout(value, storage);
  };
  const textLayout = showPages && view === 'text' ? { value: textLayoutValue, onLayout: onTextLayout } : null;
  const textDocument = textContinuous ? {
    texts: pageTexts.texts,
    onNeed: pageTexts.need,
    onRetry: retryText,
    openAt: page,
    cited,
    pieces: textPieces.pieces,
    spanChanged: textPieces.status === 'changed',
    scrollRequest,
    onPage: setPage,
  } : null;

  const storedLabel = live && parts.length ? storedCopyLabel(parts, page) : null;
  const shared = {
    docState, onRetryDoc: () => setDocNonce(n => n + 1), doc, available, view, onView, zoomState, setZoomState,
    storedLabel, onStoredCopy, onKeys,
    state, pdfError, copyNotice, retryPdf, showPages, page, total, cited, goTo, title,
    pageRow, onPdfFailure, pageStatus: onThisPage ? pageState.status : 'loading', textSpan, onRetryPage: () => setPageNonce(n => n + 1),
    fileUrl, fileName: citation.file_name ?? '', section: sectionParts(citation.section, title), narrow, pdfDocument, search, rail,
    textDocument, textLayout,
  };
  const fullPlan = chromePlan({ available, view, compact: false, narrow, full: true });

  return (
    <>
      <section ref={sectionRef} className={`ai-reader pv${fills && !fullOpen ? ' pv-fill' : ''}`} aria-label="Cited source" onKeyDown={onFindKey}>
        {fullOpen
          ? <p className="ai-reader-notice" role="status">This document is open in full view.</p>
          : <ViewerBody shared={shared} compact={compact} onExpand={openFull} expandRef={expandRef} />}
      </section>
      {fullOpen ? (
        <FullView titleId={titleId} themeClass={themeClass} onClose={closeFull} initialFocusRef={closeFullRef} returnFocusRef={expandRef}>
          <section ref={fullSectionRef} className={`ai-reader pv pv-in-full${fills ? ' pv-fill' : ''}`} aria-label="Cited source, full view" onKeyDown={onFindKey}>
            <FullHeader
              title={title}
              titleId={titleId}
              section={shared.section}
              viewSwitch={fullPlan.viewSwitch ? <ViewSwitch view={view} onView={onView} /> : null}
              fileUrl={fileUrl}
              more={<MoreMenu textLayout={textLayout} storedLabel={storedLabel} onStoredCopy={onStoredCopy} fileName={shared.fileName} />}
              onExit={closeFull}
              exitRef={closeFullRef}
              onKeyDown={onKeys}
              onSearch={search.available ? search.openSearch : null}
              searchOpen={search.open}
              searchRef={search.toggleRef}
            />
            {search.available && search.open ? <DocumentSearch search={search} view={view} onView={onView} /> : null}
            <ViewerBody shared={shared} full />
          </section>
        </FullView>
      ) : null}
    </>
  );
}
