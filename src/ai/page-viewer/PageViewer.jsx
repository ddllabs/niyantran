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
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { defaultDocumentFileClient } from '../../lib/documentFile.js';
import { loadPdfjs } from '../../lib/pdfjs.js';
import { supabase } from '../../lib/supabaseClient.js';
import { safeSourceUrl } from '../SourceReader.jsx';
import { useCompact, useTipWarmth } from './chromeHooks.js';
import { chromePlan, sectionParts } from './chromeModel.js';
import { DocumentRow, FullHeader, MoreMenu, ViewSwitch } from './DocumentChrome.jsx';
import PageControls from './PageControls.jsx';
import { viewerState } from './pageModel.js';
import PdfPage from './PdfPage.jsx';
import { createPdfController, pdfFailureNotice } from './pdfController.js';
import { openStoredCopy } from './storedCopy.js';
import TextPage from './TextPage.jsx';
import { createPageLoader, loadDocument } from './viewerData.js';
import { VIEWER_ATTRIBUTE, attachFullView, narrowQuery, isNarrow, themeClassOf } from './viewerDom.js';
import {
  NOTICES, chooseView, pageTotal, pagingKey, pdfAvailable, readViewChoice, resolvePageSpan, storedCopyLabel,
  writeViewChoice,
} from './viewerModel.js';
import { nextZoomStep, readZoomState, writeZoomState, zoomBy, zoomReadout } from './zoomModel.js';

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
/** Stands in for a loaded page row when only the document-level state is wanted. */
const ANY_ROW = Object.freeze({});
const NO_BLOCKS = Object.freeze([]);
const SPAN_STATES = new Set(['ok', 'unknown_freshness']);

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
    state, pdfError, copyNotice, retryPdf, showPages, page, total, cited, goTo, controller, title, citation,
    boxesAllowed, pageRow, blocks, blocksReady, onPdfFailure, pageStatus, textSpan, onRetryPage, fileUrl, fileName, section, narrow,
  } = shared;
  const [layout, setLayout] = useState(null);
  const effective = zoomState.zoom ?? layout?.zoom ?? null;
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
    />
  ) : null;
  const content = showPages && view === 'pdf' && controller ? (
    <PdfPage
      controller={controller}
      page={page}
      total={total}
      title={title}
      zoomState={zoomState}
      blocks={blocks}
      blocksReady={blocksReady}
      citation={citation}
      cited={cited}
      boxesAllowed={boxesAllowed}
      pageRow={pageRow}
      onFailure={onPdfFailure}
      onLayout={setLayout}
      onWheelZoom={onWheelZoom}
    />
  ) : showPages && view === 'text' ? <TextPage status={pageStatus} pageRow={pageRow} span={textSpan} onRetry={onRetryPage} /> : null;

  return (
    <>
      <DocumentNotice status={docState.status} onRetry={onRetryDoc} />
      {doc && !full ? (
        <DocumentRow
          section={section}
          viewSwitch={plan.viewSwitch ? <ViewSwitch view={view} onView={onView} /> : null}
          fileUrl={fileUrl}
          more={<MoreMenu zoom={plan.moreZoom ? zoom : null} storedLabel={storedLabel} onStoredCopy={onStoredCopy} fileName={fileName} />}
          onKeyDown={onKeys}
        />
      ) : null}
      {doc ? <StateNotices state={state} pdfError={pdfError} copyNotice={copyNotice} onRetryPdf={retryPdf} /> : null}
      {full ? (
        showPages ? <div className="pv-stage">{content}{pages}</div> : null
      ) : (
        <>
          {pages}
          {content}
        </>
      )}
    </>
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
  const [span, setSpan] = useState(null);
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
  const [controller, setController] = useState(null);
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
  const parts = docState.status === 'ok' ? docState.parts : [];
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

  // The current page's text row and block boxes; paging away aborts the stale fetch.
  useEffect(() => {
    const loader = loaderRef.current;
    if (!loader || !showPages) return undefined;
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
  }, [doc, showPages, page, pageNonce]);

  // The cited span on the cited page's text.
  useEffect(() => {
    if (page !== cited || !spanAllowed || !pageRow) {
      setSpan(null);
      return undefined;
    }
    let alive = true;
    resolvePageSpan(citation, pageRow).then((result) => { if (alive) setSpan({ page, ...result }); });
    return () => { alive = false; };
  }, [citation, cited, page, pageRow, spanAllowed]);

  // The document state goes up once per change (the host's Ask button). The last reported value is
  // kept in a ref, so StrictMode's effect replay does not report twice; it starts at null, so a
  // loading or failed document (state null) is never reported.
  useEffect(() => { onStateRef.current = onDocumentState; });
  useEffect(() => {
    if (state === reportedRef.current) return;
    reportedRef.current = state;
    onStateRef.current?.(state);
  }, [state]);

  // The PDF controller lives while the PDF view is available; Retry replaces it. It gets the part
  // layout, so the file client signs once per part however fast the reader pages (F45).
  const layout = available ? parts : null;
  useEffect(() => {
    if (!layout) return undefined;
    const created = createPdfController({ documentId, documentFile, parts: layout, loadPdfjs: load, fetch: fetchImpl });
    setController(created);
    return () => {
      created.destroy();
      setController(previous => (previous === created ? null : previous));
    };
  }, [layout, documentId, documentFile, load, fetchImpl, pdfNonce]);

  // The chosen fit or zoom is remembered in this browser.
  useEffect(() => {
    if (zoomChosen.current) writeZoomState(zoomState, storage);
  }, [zoomState, storage]);

  const goTo = useCallback(next => setPage(Math.min(Math.max(1, next), total)), [total]);

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
  const textSpan = span && span.page === page ? span : null;
  const pdfShown = showPages && view === 'pdf';

  const storedLabel = live && parts.length ? storedCopyLabel(parts, page) : null;
  const shared = {
    docState, onRetryDoc: () => setDocNonce(n => n + 1), doc, available, view, onView, zoomState, setZoomState,
    storedLabel, onStoredCopy, onKeys,
    state, pdfError, copyNotice, retryPdf, showPages, page, total, cited, goTo, controller, title, citation,
    boxesAllowed, pageRow, blocks: onThisPage ? pageState.blocks : NO_BLOCKS, blocksReady: onThisPage && pageState.status !== 'loading',
    onPdfFailure, pageStatus: onThisPage ? pageState.status : 'loading', textSpan, onRetryPage: () => setPageNonce(n => n + 1),
    fileUrl, fileName: citation.file_name ?? '', section: sectionParts(citation.section, title), narrow,
  };
  const fullPlan = chromePlan({ available, view, compact: false, narrow, full: true });

  return (
    <>
      <section ref={sectionRef} className={`ai-reader pv${pdfShown && !fullOpen ? ' pv-fill' : ''}`} aria-label="Cited source">
        {fullOpen
          ? <p className="ai-reader-notice" role="status">This document is open in full view.</p>
          : <ViewerBody shared={shared} compact={compact} onExpand={openFull} expandRef={expandRef} />}
      </section>
      {fullOpen ? (
        <FullView titleId={titleId} themeClass={themeClass} onClose={closeFull} initialFocusRef={closeFullRef} returnFocusRef={expandRef}>
          <section ref={fullSectionRef} className={`ai-reader pv pv-in-full${pdfShown ? ' pv-fill' : ''}`} aria-label="Cited source, full view">
            <FullHeader
              title={title}
              titleId={titleId}
              section={shared.section}
              viewSwitch={fullPlan.viewSwitch ? <ViewSwitch view={view} onView={onView} /> : null}
              fileUrl={fileUrl}
              more={<MoreMenu storedLabel={storedLabel} onStoredCopy={onStoredCopy} fileName={shared.fileName} />}
              onExit={closeFull}
              exitRef={closeFullRef}
              onKeyDown={onKeys}
            />
            <ViewerBody shared={shared} full />
          </section>
        </FullView>
      ) : null}
    </>
  );
}
