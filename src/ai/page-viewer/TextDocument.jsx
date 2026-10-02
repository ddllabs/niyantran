/**
 * The continuous Text view (docs/specs/2026-10-02-viewer-continuous.md, section 6): every page's
 * stored text in order under its heading, in one scrolling region. Pages are read in batches as
 * they near the view (an IntersectionObserver on this region, a screen ahead); a page not yet read
 * holds its place. The cited passage is marked on each page it touches, and search matches are
 * marked as in the PDF view. The toolbar's page follows the scroll, and paging scrolls.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createHighlighter } from './highlights.js';
import { TextBody } from './TextPage.jsx';
import { anchoredTop, needsManualAnchoring, pageAt, textAnchor } from './textModel.js';
import { useTextMatches } from './useTextMatches.js';
import { NOTICES } from './viewerModel.js';

/** How far ahead of the view pages are read: one screen above and below. */
const READ_AHEAD = '100% 0px';

/**
 * Scrolls `area` alone (never the page around it) so `rect` sits at the centre of the area above
 * `insetBottom` (the full view's pill).
 */
function centreIn(area, rect, insetBottom) {
  const box = area.getBoundingClientRect();
  area.scrollTop += rect.top + rect.height / 2 - (box.top + (area.clientHeight - insetBottom) / 2);
}

/** One page: its heading, then its text, its wait, or its failure. */
const TextSection = memo(function TextSection({
  page, entry, piece, changed, register, onRetry, markRef, query, index, seq, all, focus, onCount, onReveal,
}) {
  const bodyRef = useRef(null);
  const row = entry?.status === 'ok' ? entry.row : null;
  const text = row ? row.text ?? '' : null;
  useTextMatches({ containerRef: bodyRef, text, page, query, index, seq, all, focus, onCount, onReveal });
  const setSection = useCallback(node => register(page, node), [register, page]);
  let body;
  if (row) body = <TextBody text={text} mark={piece} markRef={markRef} bodyRef={bodyRef} />;
  else if (entry?.status === 'ok') body = <p className="ai-reader-notice" role="status">{NOTICES.noPageText}</p>;
  else if (entry?.status === 'error') {
    body = (
      <p className="ai-reader-notice warn" role="alert">
        {NOTICES.pageFailed}{' '}
        <button type="button" className="pv-retry" onClick={() => onRetry(page)}>Retry</button>
      </p>
    );
  } else body = <div className="pv-textpage-wait" aria-hidden="true" />;
  return (
    <section ref={setSection} className="pv-textpage" data-page={page} aria-labelledby={`pv-textpage-${page}`}>
      <h3 className="pv-textpage-head" id={`pv-textpage-${page}`}>Page {page}</h3>
      {changed ? <p className="ai-reader-notice warn" role="status">{NOTICES.spanChanged}</p> : null}
      {body}
    </section>
  );
});

/**
 * @param {{
 *   total: number, title: string,
 *   texts: Map<number, {status: 'ok' | 'error', row: object | null}>, the pages read so far
 *   onNeed: (pages: number[]) => void, onRetry: (page: number) => void,
 *   openAt: number, cited: number,
 *   pieces: Map<number, {from: number, to: number}> | null, the cited passage on each page
 *   spanChanged?: boolean,
 *   scrollRequest: {page: number, seq: number} | null,
 *   onPage: (page: number) => void,
 *   search: {query: string, page: number | null, index: number, seq: number} | null,
 *   onSearchCount: (page: number, query: string, count: number | null) => void,
 *   insetBottom?: number,  the full view's pill, which the centring keeps clear of
 * }} props
 */
function TextDocument({
  total, title, texts, onNeed, onRetry, openAt, cited, pieces, spanChanged = false, scrollRequest, onPage, search, onSearchCount,
  insetBottom = 0,
}) {
  const areaRef = useRef(null);
  const sectionsRef = useRef(new Map());
  const markRef = useRef(null);
  const openedRef = useRef(false);
  const centredRef = useRef(false);
  // The last search move revealed; one made before this view opened counts as revealed, so the
  // view opens on the reader's page (as the PDF view does).
  const revealedRef = useRef(search?.seq ?? 0);
  const currentRef = useRef(openAt);
  const mountRequestRef = useRef(scrollRequest);
  const callbacks = useRef({ onNeed, onPage });
  useEffect(() => { callbacks.current = { onNeed, onPage }; });
  const all = useMemo(() => createHighlighter('pv-match'), []);
  const focus = useMemo(() => createHighlighter('pv-match-current'), []);
  useEffect(() => () => {
    all.dispose();
    focus.dispose();
  }, [all, focus]);

  // Where the browser has no scroll anchoring (Safari), the view keeps the reader's place itself:
  // the page at the top of the view and the offset into it, recorded after every scroll and put
  // back before paint when text arrives above the reader.
  const manualAnchor = useMemo(() => needsManualAnchoring(), []);
  const anchorRef = useRef(null);
  const topOf = useCallback(page => sectionsRef.current.get(page)?.offsetTop ?? Infinity, []);
  const remember = useCallback(() => {
    const area = areaRef.current;
    if (manualAnchor && area) anchorRef.current = textAnchor({ total, topOf, scrollTop: area.scrollTop });
  }, [manualAnchor, total, topOf]);
  const rememberRef = useRef(remember);
  useEffect(() => { rememberRef.current = remember; }, [remember]);
  useLayoutEffect(() => {
    const area = areaRef.current;
    const anchor = anchorRef.current;
    if (!manualAnchor || !area || !anchor || !openedRef.current) return;
    const top = anchoredTop({ topOf, anchor });
    if (Number.isFinite(top) && Math.abs(area.scrollTop - top) >= 1) area.scrollTop = top;
  }, [texts, pieces, manualAnchor, topOf]);

  const register = useCallback((page, node) => {
    if (node) sectionsRef.current.set(page, node);
    else sectionsRef.current.delete(page);
  }, []);

  // Pages are read as they near the view.
  useEffect(() => {
    const area = areaRef.current;
    if (!area || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const near = entries.filter(e => e.isIntersecting).map(e => Number(e.target.dataset.page));
      if (near.length) callbacks.current.onNeed(near);
    }, { root: area, rootMargin: READ_AHEAD });
    for (const node of sectionsRef.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [total]);

  // Open on the reader's page; the cited passage is centred once its page has been read.
  useLayoutEffect(() => {
    const area = areaRef.current;
    const section = sectionsRef.current.get(openAt);
    if (!area || !section) return;
    area.scrollTop = section.offsetTop;
    openedRef.current = true;
    remember();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on opening
  const citedRead = texts.get(cited)?.status === 'ok';
  useEffect(() => {
    if (centredRef.current || openAt !== cited || !citedRead || !pieces?.has(cited)) return;
    centredRef.current = true;
    const area = areaRef.current;
    if (area && markRef.current) centreIn(area, markRef.current.getBoundingClientRect(), insetBottom);
    remember();
  }, [citedRead, pieces, openAt, cited, insetBottom, remember]);

  // The current page: the page under the centre of the view (above the pill), as in the PDF view,
  // read once per frame.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      if (!openedRef.current) return;
      const current = pageAt({ total, topOf, y: area.scrollTop + (area.clientHeight - insetBottom) / 2 });
      if (current !== currentRef.current) {
        currentRef.current = current;
        callbacks.current.onPage?.(current);
      }
    };
    const onScroll = () => {
      rememberRef.current();
      if (!frame) frame = requestAnimationFrame(read);
    };
    area.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      area.removeEventListener('scroll', onScroll);
    };
  }, [total, insetBottom, topOf]);

  // Paging from the toolbar: the page's heading at the top; the cited page, its passage centred.
  // A request made before this view opened is the one it opened on, so it is not replayed.
  useEffect(() => {
    const area = areaRef.current;
    if (!area || !scrollRequest || scrollRequest === mountRequestRef.current) return;
    const section = sectionsRef.current.get(scrollRequest.page);
    if (!section) return;
    currentRef.current = scrollRequest.page;
    if (scrollRequest.page === cited && markRef.current) centreIn(area, markRef.current.getBoundingClientRect(), insetBottom);
    else area.scrollTop = section.offsetTop;
    remember();
  }, [scrollRequest]); // eslint-disable-line react-hooks/exhaustive-deps -- once per request

  // A move to a search match: a read page centres it; a page not yet read is scrolled to, which
  // reads it, and centres the match once read. Pages' effects run before this one.
  const onReveal = useCallback((seq, page, range) => {
    const area = areaRef.current;
    // Once per move: a page read or drawn again must not scroll back to it.
    if (!area || seq === revealedRef.current) return;
    revealedRef.current = seq;
    if (range) centreIn(area, range.getBoundingClientRect(), insetBottom);
    else {
      const section = sectionsRef.current.get(page);
      if (section) area.scrollTop = section.offsetTop;
    }
    remember();
  }, [insetBottom, remember]);
  useEffect(() => {
    const area = areaRef.current;
    if (!area || !search?.page || !search.seq || revealedRef.current === search.seq) return;
    const section = sectionsRef.current.get(search.page);
    if (section) area.scrollTop = section.offsetTop;
    remember();
  }, [search?.seq]); // eslint-disable-line react-hooks/exhaustive-deps -- once per move

  const pages = [];
  for (let page = 1; page <= total; page += 1) {
    const here = search && search.page === page;
    pages.push(
      <TextSection
        key={page}
        page={page}
        entry={texts.get(page)}
        piece={pieces?.get(page) ?? null}
        changed={spanChanged && page === cited}
        register={register}
        onRetry={onRetry}
        markRef={page === cited ? markRef : null}
        query={search?.query ?? null}
        index={here ? search.index : -1}
        seq={here ? search.seq : 0}
        all={all}
        focus={focus}
        onCount={onSearchCount}
        onReveal={onReveal}
      />,
    );
  }
  return (
    <div className="pv-textdoc" ref={areaRef} tabIndex={0} role="region" aria-label={`Text of ${title}`}>
      {pages}
    </div>
  );
}

/**
 * `openAt` is read once, on opening, so a new reader's page (every scroll past a page) does not
 * re-render the thousand pages of a long document.
 */
const sameExceptOpening = (prev, next) => Object.keys({ ...prev, ...next }).every(key => key === 'openAt' || Object.is(prev[key], next[key]));
export default memo(TextDocument, sameExceptOpening);
