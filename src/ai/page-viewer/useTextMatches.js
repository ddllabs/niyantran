/**
 * Search matches on the Text view's rendered page text (docs/specs/2026-10-02-viewer-continuous.md,
 * section 6), with the same Highlight API names as the PDF view: every match `pv-match`, the
 * current one `pv-match-current`. Rebuilt when the page's text, the query or the current match
 * changes; the page holding the current match is scrolled to it once per move.
 */
import { useEffect, useRef } from 'react';
import { markMatches } from './highlights.js';
import { textItems } from './textModel.js';

/**
 * @param {{containerRef: {current: Element | null}, text: string | null, page: number,
 *   query: string | null, index: number, seq: number, all: object, focus: object,
 *   onCount?: (page: number, query: string, count: number | null) => void,
 *   onReveal?: (seq: number, page: number, range: Range | null) => void}} options
 *   `index` and `seq` are the current match's index on this page and its move's number (-1 and 0
 *   when the current match is elsewhere).
 */
export function useTextMatches({ containerRef, text, page, query, index, seq, all, focus, onCount, onReveal }) {
  const revealedRef = useRef(0);
  useEffect(() => {
    const container = containerRef.current;
    if (text === null || !query || !container) return undefined;
    const marked = markMatches({ container, items: textItems(container), query, page, current: index, all, focus });
    onCount?.(page, query, marked ? marked.count : null);
    if (seq && seq !== revealedRef.current) {
      revealedRef.current = seq;
      onReveal?.(seq, page, marked?.current ?? null);
    }
    return () => {
      all.clear(page);
      focus.clear(page);
    };
  }, [containerRef, text, page, query, index, seq, all, focus, onCount, onReveal]);
}
