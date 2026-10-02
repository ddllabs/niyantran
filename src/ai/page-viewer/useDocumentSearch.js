/**
 * The viewer's search state (docs/specs/2026-10-02-viewer-continuous.md, section 4): open or
 * closed, the typed query, the database's pages for the settled query, the current match, and
 * each drawn page's own count. The searching itself is searchModel's runner over viewerData's
 * `searchPages`; this hook only holds the state the chrome and the pages read.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_RESULT_PAGES, createSearchRunner, foldQuery, matchLabel, matchList, recognisedOnly, startMatch, stepMatch,
} from './searchModel.js';
import { searchPages } from './viewerData.js';

const IDLE = Object.freeze({ query: '', status: 'idle', pages: [] });

/**
 * @param {{client: object, documentId: string, extractHash: string | null, page: number}} options
 *   `page` is the reader's page: the database keeps the 200 pages reached first from it, and a new
 *   result starts at the first match on or after it.
 */
export function useDocumentSearch({ client, documentId, extractHash, page }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [result, setResult] = useState(IDLE);
  const [current, setCurrent] = useState(-1);
  // Each move to a match takes a new number, so the page holding it scrolls to it once.
  const [seq, setSeq] = useState(0);
  const [focusSeq, setFocusSeq] = useState(0);
  const [layerCounts, setLayerCounts] = useState(() => new Map());
  const inputRef = useRef(null);
  const toggleRef = useRef(null);
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);

  const runner = useMemo(() => createSearchRunner({
    search: ({ query, signal }) => searchPages(client, { documentId, extractHash, query, fromPage: pageRef.current, signal }),
    onResult: (next) => {
      setResult(next);
      setCurrent(startMatch(matchList(next.pages), pageRef.current));
      setSeq(n => n + 1);
    },
  }), [client, documentId, extractHash]);
  useEffect(() => () => runner.cancel(), [runner]);
  // Another document or extraction: the last result's pages and counts belong to the old text.
  useEffect(() => {
    setResult(IDLE);
    setCurrent(-1);
    setLayerCounts(new Map());
  }, [runner]);

  // The field takes focus when search opens, and again on ⌘/Ctrl+F while it is open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, focusSeq]);

  const list = useMemo(() => matchList(result.pages), [result.pages]);
  const match = list[current] ?? null;

  const onQuery = useCallback((value) => {
    setText(value);
    runner.run(value);
  }, [runner]);
  const step = useCallback((direction) => {
    setCurrent(c => stepMatch(list.length, c, direction));
    setSeq(n => n + 1);
  }, [list.length]);
  const pick = useCallback((target) => {
    const at = list.findIndex(m => m.page === target);
    if (at === -1) return;
    setCurrent(at);
    setSeq(n => n + 1);
  }, [list]);
  const openSearch = useCallback(() => {
    setOpen(true);
    setFocusSeq(n => n + 1);
  }, []);
  const close = useCallback(() => {
    runner.cancel();
    setOpen(false);
    setText('');
    setResult(IDLE);
    setCurrent(-1);
    setLayerCounts(new Map());
    toggleRef.current?.focus();
  }, [runner]);
  const onLayerCount = useCallback((counted, query, count) => {
    setLayerCounts((prev) => {
      const last = prev.get(counted);
      return last?.query === query && last.count === count ? prev : new Map(prev).set(counted, { query, count });
    });
  }, []);

  const shown = open && result.query ? result : null;
  // One object per move, so the views can skip re-rendering when nothing about the search changed.
  const targetPage = match?.page ?? null;
  const targetIndex = match?.index ?? -1;
  const target = useMemo(
    () => (shown ? { query: shown.query, page: targetPage, index: targetIndex, seq } : null),
    [shown, targetPage, targetIndex, seq],
  );
  // Typed but not yet answered: the counter waits, and the last answer's marks stay until then.
  const folded = foldQuery(text);
  const pending = open && folded !== '' && folded !== result.query;

  return {
    open,
    text,
    result,
    match,
    seq,
    label: matchLabel({ status: pending ? 'loading' : open ? result.status : 'idle', total: list.length, current, capped: result.pages.length >= MAX_RESULT_PAGES }),
    total: list.length,
    target,
    recognisedOnly: Boolean(shown) && recognisedOnly({ match, query: result.query, layer: match ? layerCounts.get(match.page) : undefined }),
    inputRef,
    toggleRef,
    onQuery,
    step,
    pick,
    openSearch,
    close,
    onLayerCount,
  };
}
