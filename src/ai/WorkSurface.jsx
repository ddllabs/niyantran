/**
 * Work mode is the viewer (streaming spec §G, owner's decision 2026-09-21).
 * The button no longer changes the prompt — the evidence-first discipline is
 * always on — it opens this layer over the thread, which holds whatever
 * source the reader asked to see: the document reader for a text citation,
 * the record for a row. The panel stays the single right-side surface.
 */
import RowSource from './RowSource.jsx';
import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import { isReadableCitation, sanitizeCitation } from './CitationBubble.jsx';
import './research.css';
import SourceReader from './SourceReader.jsx';

/*
 * The page-wise viewer for `pdf_page` citations (docs/specs/2026-10-01-rag-v2-citations-pdf.md).
 * A lazy chunk: it and pdf.js load only when such a citation is opened, so neither reaches the
 * main bundle (`npm run check:bundle`).
 */
const PageViewer = lazy(() => import('./page-viewer/PageViewer.jsx'));

const isPage = value => Number.isSafeInteger(value) && value >= 1;

/**
 * The single sanitising point (spec, "The flow" step 1): the open source and every entry of the
 * source list pass `sanitizeCitation` here, after the readability check, so the bubble, chip and
 * list paths all reach a viewer with malformed boxes, images and sections already removed.
 * `reader` picks the viewer: 'page' for a `pdf_page` citation with a page number, 'text' for
 * any other text citation (today's SourceReader), 'row' for a desk record.
 */
export function resolveViewer(viewer, sources) {
  const raw = viewer?.source || null;
  const invalid = Boolean(raw && !isReadableCitation(raw));
  const source = raw && !invalid ? sanitizeCitation(raw) : null;
  const list = (Array.isArray(sources) ? sources : []).filter(isReadableCitation).map(sanitizeCitation);
  let reader = null;
  if (source?.kind === 'row') reader = 'row';
  else if (source?.kind === 'text') reader = source.source_kind === 'pdf_page' && isPage(source.page_number) ? 'page' : 'text';
  return { source, invalid, sources: list, reader };
}

/**
 * "Ask about this document" (retrieval-scope decision 1): attaches the cited
 * document as a chip, so the next questions search only it. Off unless the
 * thread is known to be free (`locked === false`) and there is a handler:
 * attach() refuses while a turn runs, and a live button would do nothing.
 */
export function AskAboutDocument({ citation, locked, onAsk }) {
  const off = locked !== false || typeof onAsk !== 'function';
  return (
    <button
      type="button"
      className="ai-work-ask"
      disabled={off}
      title={off ? 'Available when the current answer has finished' : 'Attach this document so the next questions search only it'}
      onClick={() => { if (!off) onAsk(citation); }}
    >
      Ask about this document
    </button>
  );
}

export default function WorkSurface({ viewer, sources = [], onOpen, onClose, client, onAskAboutDocument, locked }) {
  const back = useRef(null);
  const visible = Boolean(viewer);
  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement;
    back.current?.focus();
    return () => { if (previous?.isConnected) previous.focus?.(); };
  }, [visible]);
  const sourceKey = viewer?.source ? `${viewer.source.kind}:${viewer.source.id}` : 'list';
  useEffect(() => { if (visible) back.current?.focus(); }, [visible, sourceKey]);
  // Memoised so the viewers see one citation object per opened source, not a copy per render.
  const resolved = useMemo(() => resolveViewer(viewer, sources), [viewer, sources]);
  if (!viewer) return null;
  const { source, invalid, sources: validSources, reader } = resolved;

  return (
    <div className="ai-work-surface" role="region" aria-label="Evidence" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } }}>
      <div className="ai-work-bar">
        <button type="button" ref={back} className="ai-work-back" onClick={onClose} aria-label="Back to the answer">
          ← Back
        </button>
        <span className="ai-work-title">
          {source ? (source.kind === 'row' ? source.title || source.row_key : source.title) : 'Sources'}
        </span>
        {source?.kind === 'text' ? <AskAboutDocument citation={source} locked={locked} onAsk={onAskAboutDocument} /> : null}
      </div>

      <div className="ai-work-body">
        {reader === 'page' ? (
          <Suspense fallback={<p className="ai-reader-notice pv-lazy">Loading the page viewer…</p>}>
            <PageViewer key={`${source.document_id}:${source.chunk_id}`} citation={source} onClose={onClose} client={client} />
          </Suspense>
        ) : null}
        {reader === 'text' ? <SourceReader key={`${source.document_id}:${source.chunk_id}`} citation={source} onClose={onClose} client={client} /> : null}
        {reader === 'row' ? <RowSource citation={source} onClose={onClose} /> : null}
        {invalid ? <p role="status">This source is unavailable. Return to the answer to choose another.</p> : null}
        {!source && !invalid ? (validSources.length ? (
          <ul className="ai-work-sources" aria-label="Sources">
            {validSources.map((s, index) => <li key={`${s.kind}:${s.id}:${index}`}>
              <button type="button" onClick={() => onOpen?.(s)}>
                <span>{s.title}</span><small>{s.kind === 'row' ? `Desk record · ${s.feature}` : s.file_name || s.desk_feature || 'Document'}</small>
              </button>
            </li>)}
          </ul>
        ) : <p className="rail-empty">This answer cites no sources yet.</p>) : null}
      </div>
    </div>
  );
}
