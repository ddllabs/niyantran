/**
 * The Text view of one page (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "Text view"): the
 * page's `document_pages.text`, laid out with the reader's own blocks and RichText, with the
 * cited span marked when `span` is exact. The span is resolved by the viewer
 * (`resolvePageSpan`), so this component only renders.
 */
import { useEffect, useMemo, useRef } from 'react';
import { documentBlocks } from '../documentBlocks.js';
import RichText from '../RichText.jsx';
import { NOTICES } from './viewerModel.js';

/**
 * @param {{
 *   status: 'loading' | 'ok' | 'error',
 *   pageRow: {text: string} | null,
 *   span?: {status: 'exact', from: number, to: number} | {status: 'changed'} | null,
 *   onRetry?: () => void,
 * }} props
 */
export default function TextPage({ status, pageRow, span = null, onRetry }) {
  const markRef = useRef(null);
  const text = pageRow?.text ?? '';
  const blocks = useMemo(() => documentBlocks(text), [text]);
  const hit = span?.status === 'exact' && span.to > span.from ? span : null;

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

  const scrollTo = hit ? blocks.findIndex(b => b.to > hit.from && b.from < hit.to) : -1;
  return (
    <>
      {span?.status === 'changed' ? <p className="ai-reader-notice warn" role="status">{NOTICES.spanChanged}</p> : null}
      <div className="ai-reader-body pv-text" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {blocks.map((block, i) => (
          <RichText
            key={`${block.from}:${block.to}`}
            text={text}
            kind={block.kind}
            from={block.from}
            to={block.to}
            mark={hit && block.to > hit.from && block.from < hit.to ? hit : null}
            markRef={i === scrollTo ? markRef : null}
          />
        ))}
      </div>
    </>
  );
}
