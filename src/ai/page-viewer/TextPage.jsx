/**
 * The Text view of one page (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "Text view"): the
 * page's `document_pages.text`, laid out with the reader's own blocks and RichText, with the
 * cited span marked when `span` is exact. The span is resolved by the viewer
 * (`resolvePageSpan`), so this component only renders.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { documentBlocks } from '../documentBlocks.js';
import RichText from '../RichText.jsx';
import { createHighlighter } from './highlights.js';
import { useTextMatches } from './useTextMatches.js';
import { NOTICES } from './viewerModel.js';

/**
 * A page's text, laid out with the reader's blocks and RichText, with `mark` (page-local offsets)
 * marked and `markRef` on its first block.
 */
export function TextBody({ text, mark = null, markRef = null, bodyRef = null }) {
  const blocks = useMemo(() => documentBlocks(text), [text]);
  const first = mark ? blocks.findIndex(b => b.to > mark.from && b.from < mark.to) : -1;
  return (
    <div ref={bodyRef} className="ai-reader-body pv-text" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {blocks.map((block, i) => (
        <RichText
          key={`${block.from}:${block.to}`}
          text={text}
          kind={block.kind}
          from={block.from}
          to={block.to}
          mark={mark && block.to > mark.from && block.from < mark.to ? mark : null}
          markRef={i === first ? markRef : null}
        />
      ))}
    </div>
  );
}

/**
 * @param {{
 *   status: 'loading' | 'ok' | 'error',
 *   pageRow: {text: string} | null,
 *   span?: {status: 'exact', from: number, to: number} | {status: 'changed'} | null,
 *   onRetry?: () => void,
 *   page?: number,
 *   search?: {query: string, page: number | null, index: number, seq: number} | null,
 *   onSearchCount?: (page: number, query: string, count: number | null) => void,
 * }} props
 *   `search` is the viewer's search target: its matches on this page are marked, the current one
 *   scrolled into view.
 */
export default function TextPage({ status, pageRow, span = null, onRetry, page = 0, search = null, onSearchCount }) {
  const markRef = useRef(null);
  const bodyRef = useRef(null);
  const text = pageRow?.text ?? '';
  const hit = span?.status === 'exact' && span.to > span.from ? span : null;
  const all = useMemo(() => createHighlighter('pv-match'), []);
  const focus = useMemo(() => createHighlighter('pv-match-current'), []);
  useEffect(() => () => {
    all.dispose();
    focus.dispose();
  }, [all, focus]);
  const onReveal = useCallback((seq, at, range) => {
    range?.startContainer?.parentElement?.scrollIntoView?.({ block: 'center' });
  }, []);
  const here = search && search.page === page;
  useTextMatches({
    containerRef: bodyRef, text: status === 'ok' && pageRow ? text : null, page, query: search?.query ?? null,
    index: here ? search.index : -1, seq: here ? search.seq : 0, all, focus, onCount: onSearchCount, onReveal,
  });

  useEffect(() => {
    if (hit) markRef.current?.scrollIntoView?.({ block: 'center' });
  }, [hit?.from, hit?.to, text]); // eslint-disable-line react-hooks/exhaustive-deps -- scroll once per span and page

  if (status === 'loading') return <p className="ai-reader-notice">Loading…</p>;
  if (status === 'error') {
    return (
      <p className="ai-reader-notice warn" role="alert">
        {NOTICES.pageFailed}{' '}
        {onRetry ? <button type="button" className="pv-retry" onClick={onRetry}>Retry</button> : null}
      </p>
    );
  }
  if (!pageRow) return <p className="ai-reader-notice" role="status">{NOTICES.noPageText}</p>;

  return (
    <>
      {span?.status === 'changed' ? <p className="ai-reader-notice warn" role="status">{NOTICES.spanChanged}</p> : null}
      <TextBody text={text} mark={hit} markRef={markRef} bodyRef={bodyRef} />
    </>
  );
}
