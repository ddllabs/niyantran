/**
 * The page-wise citation viewer (docs/specs/2026-10-01-rag-v2-citations-pdf.md, revision 3).
 * A lazy chunk: WorkSurface loads it with React.lazy for `pdf_page` citations only, so this
 * module, pdf.js and its CSS stay out of the main bundle.
 *
 * It opens on the cited page with a PDF | Text switch over one shared current page. The
 * citation arrives already through `sanitizeCitation` (WorkSurface is the single sanitising
 * point). Every notice is a fixed sentence; no error text and no signed URL is ever rendered
 * or logged.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultDocumentFileClient } from '../../lib/documentFile.js';
import { loadPdfjs } from '../../lib/pdfjs.js';
import { supabase } from '../../lib/supabaseClient.js';
import { safeSourceUrl } from '../SourceReader.jsx';
import PageBar from './PageBar.jsx';
import { viewerState } from './pageModel.js';
import PdfPage from './PdfPage.jsx';
import { createPdfController, pdfFailureNotice } from './pdfController.js';
import { openStoredCopy } from './storedCopy.js';
import TextPage from './TextPage.jsx';
import { createPageLoader, loadDocument } from './viewerData.js';
import {
  NOTICES, ZOOM_STEPS, chooseView, pageTotal, pagingKey, pdfAvailable, readViewChoice, resolvePageSpan,
  storedCopyLabel, writeViewChoice,
} from './viewerModel.js';

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

/** The PDF | Text switch, zoom, and "Open stored copy" (`storedLabel` null hides it). */
export function ViewerControls({ available, view, onView, zoom, onZoom, storedLabel, onStoredCopy, onKeyDown }) {
  return (
    <div className="pv-controls" onKeyDown={onKeyDown}>
      {available ? (
        <div className="pv-switch" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'pdf'} onClick={() => onView('pdf')}>PDF</button>
          <button type="button" aria-pressed={view === 'text'} onClick={() => onView('text')}>Text</button>
        </div>
      ) : null}
      {available && view === 'pdf' ? (
        <div className="pv-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" disabled={zoom <= 0} onClick={() => onZoom(zoom - 1)}>−</button>
          <button type="button" aria-label="Zoom in" disabled={zoom >= ZOOM_STEPS.length - 1} onClick={() => onZoom(zoom + 1)}>+</button>
        </div>
      ) : null}
      {storedLabel ? <button type="button" className="pv-stored" onClick={onStoredCopy}>{storedLabel}</button> : null}
    </div>
  );
}

/**
 * @param {{
 *   citation: import('../../types/citation.js').TextCitation,
 *   onClose?: () => void,
 *   client?: typeof supabase,
 *   documentFile?: ReturnType<typeof defaultDocumentFileClient>,
 *   loadPdfjs?: typeof loadPdfjs,
 *   fetch?: typeof fetch,
 *   storage?: Storage,
 * }} props
 */
export default function PageViewer({
  citation, onClose, client = supabase, documentFile = sharedDocumentFile(), loadPdfjs: load = loadPdfjs,
  fetch: fetchImpl = defaultFetch, storage,
}) {
  const documentId = citation.document_id;
  const cited = citation.page_number;
  const [docState, setDocState] = useState({ status: 'loading' });
  const [docNonce, setDocNonce] = useState(0);
  const [page, setPage] = useState(cited);
  const [pageState, setPageState] = useState({ page: null, status: 'loading', row: null });
  const [pageNonce, setPageNonce] = useState(0);
  const [span, setSpan] = useState(null);
  const [stored] = useState(() => readViewChoice(storage));
  const [choice, setChoice] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pdfError, setPdfError] = useState('');
  const [pdfNonce, setPdfNonce] = useState(0);
  const [controller, setController] = useState(null);
  const [copyNotice, setCopyNotice] = useState('');
  const loaderRef = useRef(null);

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
  const pageRow = pageState.page === page ? pageState.row : null;

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

  // The current page's text row; paging away aborts the stale fetch.
  useEffect(() => {
    const loader = loaderRef.current;
    if (!loader || !showPages) return undefined;
    let alive = true;
    const cached = loader.peek(page);
    setPageState(cached !== undefined ? { page, status: 'ok', row: cached } : { page, status: 'loading', row: null });
    loader.load(page).then((result) => {
      if (alive && result.status !== 'aborted') setPageState({ page, status: result.status, row: result.row ?? null });
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

  // The PDF controller lives while the PDF view is available; Retry replaces it.
  useEffect(() => {
    if (!available) return undefined;
    const created = createPdfController({ documentId, documentFile, loadPdfjs: load, fetch: fetchImpl });
    setController(created);
    return () => {
      created.destroy();
      setController(previous => (previous === created ? null : previous));
    };
  }, [available, documentId, documentFile, load, fetchImpl, pdfNonce]);

  const goTo = useCallback(next => setPage(Math.min(Math.max(1, next), total)), [total]);

  const onKeys = (event) => {
    const target = event.target;
    const selection = typeof window !== 'undefined' ? window.getSelection?.() : null;
    const next = pagingKey({
      key: event.key,
      targetTag: target?.tagName,
      editable: Boolean(target?.isContentEditable),
      hasSelection: Boolean(selection && !selection.isCollapsed),
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
    openStoredCopy({ documentFile, documentId, page }).then((result) => {
      if (!result.ok) setCopyNotice(result.notice);
    });
  };

  const title = doc?.title ?? citation.title;
  const fileUrl = safeSourceUrl(doc?.file_url) || safeSourceUrl(citation.file_url);
  const textSpan = span && span.page === page ? span : null;

  return (
    <section className="ai-reader pv" aria-label="Cited source">
      <header className="ai-reader-head">
        <div>
          <strong>{title}</strong>
          <span className="ai-reader-file">
            {citation.file_name ?? ''}
            {fileUrl ? (
              <>
                {' '}
                <a href={fileUrl} target="_blank" rel="noreferrer">Open file ↗</a>
              </>
            ) : null}
          </span>
        </div>
        {onClose ? <button type="button" onClick={onClose} aria-label="Close reader">×</button> : null}
      </header>

      <DocumentNotice status={docState.status} onRetry={() => setDocNonce(n => n + 1)} />
      {doc ? (
        <ViewerControls
          available={available}
          view={view}
          onView={onView}
          zoom={zoom}
          onZoom={setZoom}
          storedLabel={live && parts.length ? storedCopyLabel(parts, page) : null}
          onStoredCopy={onStoredCopy}
          onKeyDown={onKeys}
        />
      ) : null}
      {doc ? <StateNotices state={state} pdfError={pdfError} copyNotice={copyNotice} onRetryPdf={retryPdf} /> : null}
      {showPages ? <PageBar page={page} total={total} cited={cited} section={citation.section} onPage={goTo} onKeyDown={onKeys} /> : null}

      {showPages && view === 'pdf' && controller ? (
        <PdfPage
          controller={controller}
          page={page}
          total={total}
          title={title}
          zoom={ZOOM_STEPS[zoom]}
          citation={citation}
          cited={cited}
          boxesAllowed={boxesAllowed}
          pageRow={pageRow}
          onFailure={onPdfFailure}
        />
      ) : null}
      {showPages && view === 'text' ? (
        <TextPage
          status={pageState.page === page ? pageState.status : 'loading'}
          pageRow={pageRow}
          span={textSpan}
          onRetry={() => setPageNonce(n => n + 1)}
        />
      ) : null}
    </section>
  );
}
