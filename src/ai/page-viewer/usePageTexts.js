/**
 * The continuous Text view's page text, read in batches of TEXT_BATCH pages as they near the view
 * (docs/specs/2026-10-02-viewer-continuous.md, section 6). Each batch is read once; a failed batch
 * is forgotten, so asking again retries it. Every read is aborted when the view goes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { batchPages, pagesToRead } from './textModel.js';
import { loadPageTexts } from './viewerData.js';

const EMPTY = new Map();

/**
 * @returns {{texts: Map<number, {status: 'ok' | 'error', row: object | null}>, need: (pages: number[]) => void}}
 *   `texts` holds the pages read so far: `ok` with the page's row (null for a page without text),
 *   or `error`.
 */
export function usePageTexts({ client, documentId, extractHash, total, enabled }) {
  const [texts, setTexts] = useState(EMPTY);
  const knownRef = useRef(new Set());
  const abortRef = useRef(new AbortController());

  // A new document or extraction starts empty; leaving aborts every read.
  useEffect(() => {
    const abort = new AbortController();
    abortRef.current = abort;
    knownRef.current = new Set();
    setTexts(EMPTY);
    return () => abort.abort();
  }, [client, documentId, extractHash]);

  const need = useCallback((pages) => {
    if (!enabled) return;
    const abort = abortRef.current;
    for (const batch of pagesToRead(pages, { known: knownRef.current, total })) {
      knownRef.current.add(batch);
      const [from, to] = batchPages(batch, total);
      loadPageTexts(client, { documentId, extractHash, from, to, signal: abort.signal }).then((result) => {
        if (abort.signal.aborted || result.status === 'aborted') return;
        if (result.status !== 'ok') knownRef.current.delete(batch);
        setTexts((prev) => {
          const next = new Map(prev);
          const rows = new Map((result.rows ?? []).map(row => [row.page_number, row]));
          for (let page = from; page <= to; page += 1) {
            next.set(page, result.status === 'ok' ? { status: 'ok', row: rows.get(page) ?? null } : { status: 'error', row: null });
          }
          return next;
        });
      });
    }
  }, [client, documentId, extractHash, total, enabled]);

  return { texts, need };
}
