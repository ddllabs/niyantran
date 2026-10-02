/**
 * The page rail (docs/specs/2026-10-02-viewer-continuous.md, section 5): Pages and Results tabs.
 * In the side pane a 132 px drawer over the pages; in the full view a 160 px column. Pages is a
 * virtualised list of thumbnails, laid out from the stored page sizes and drawn by the part pool
 * behind every page; the list follows the current page. Results is the search's list.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePaneSize } from './chromeHooks.js';
import { renderWindow, slotLayout } from './layoutModel.js';
import SearchResults from './SearchResults.jsx';
import { THUMB_WIDTH, requestThumbnail } from './thumbnailCache.js';

/** The room under each thumbnail for its page number, and the space between thumbnails. */
const LABEL_PX = 18;
const THUMB_GAP = 8;
/** Thumbnails mounted at once: the visible ones and a screen either side. */
const MAX_MOUNTED = 40;

/** The thumbnails stacked THUMB_WIDTH wide from the page shapes, each followed by its number. */
export function railLayout(aspects) {
  return slotLayout({ aspects, widthOf: () => THUMB_WIDTH, gap: LABEL_PX + THUMB_GAP });
}

/** A thumbnail's accessible name: the page, and whether it is cited or holds matches. */
export function thumbLabel({ page, cited = false, hits = 0 }) {
  const parts = [`Page ${page}`];
  if (cited) parts.push('cited');
  if (hits) parts.push(`${hits} ${hits === 1 ? 'match' : 'matches'}`);
  return parts.join(', ');
}

/** One thumbnail: a button to its page; only the current page's is in the tab order. */
export function Thumb({ page, top, height, url, current = false, cited = false, hits = 0, onPick }) {
  return (
    <button
      type="button"
      className="pv-thumb"
      style={{ top, width: THUMB_WIDTH }}
      data-page={page}
      aria-label={thumbLabel({ page, cited, hits })}
      aria-current={current ? 'page' : undefined}
      tabIndex={current ? 0 : -1}
      onClick={() => onPick(page)}
    >
      <span className="pv-thumb-image" style={{ height }}>
        {url ? <img src={url} alt="" width={THUMB_WIDTH} height={Math.round(height)} decoding="async" /> : null}
        {hits ? <span className="pv-thumb-hits" aria-hidden="true">{hits}</span> : null}
      </span>
      <span className="pv-thumb-label" aria-hidden="true">
        {cited ? <span className="pv-thumb-cited" aria-hidden="true" /> : null}
        {page}
      </span>
    </button>
  );
}

/** A thumbnail that asks for its image while it is mounted and the rail is open. */
const ThumbSlot = memo(function ThumbSlot({ page, rank, thumbs, active, ...rest }) {
  const [url, setUrl] = useState(null);
  const handleRef = useRef(null);
  useEffect(() => {
    if (!thumbs || !active) return undefined;
    let alive = true;
    const handle = requestThumbnail({
      pool: thumbs.pool, cache: thumbs.cache, key: thumbs.keyOf(page), page, priority: rank,
      onReady: (ready) => { if (alive) setUrl(ready); },
    });
    handleRef.current = handle;
    return () => {
      alive = false;
      handle.cancel();
      handleRef.current = null;
    };
    // The rank is updated in place below; a new one must not redraw the thumbnail.
  }, [thumbs, page, active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { handleRef.current?.setPriority(rank); }, [rank]);
  return <Thumb page={page} url={url} {...rest} />;
});

/** The virtualised thumbnails. Up and Down go to the previous and next page, focus following. */
function ThumbList({ aspects, current, cited, counts, onPick, thumbs, active }) {
  const listRef = useRef(null);
  const pane = usePaneSize(listRef);
  const [top, setTop] = useState(0);
  const keyedRef = useRef(false);
  const layout = useMemo(() => railLayout(aspects), [aspects]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setTop(list.scrollTop); });
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      list.removeEventListener('scroll', onScroll);
    };
  }, []);

  // The list follows the current page, without animation; a key that moved it takes focus along.
  useLayoutEffect(() => {
    const list = listRef.current;
    const i = current - 1;
    if (!list || !active || i < 0 || i >= layout.count) return;
    const from = layout.tops[i];
    const to = from + layout.heights[i] + LABEL_PX;
    if (from < list.scrollTop || to > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, from - (list.clientHeight - (to - from)) / 2);
      setTop(list.scrollTop);
    }
    if (keyedRef.current) {
      keyedRef.current = false;
      list.querySelector(`[data-page="${current}"]`)?.focus({ preventScroll: true });
    }
  }, [current, active, layout, pane.height]);

  const onKeyDown = (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step || current + step < 1 || current + step > layout.count) return;
    event.preventDefault();
    keyedRef.current = true;
    onPick(current + step);
  };

  const pages = active && pane.height ? renderWindow(layout, top, pane.height, { overscan: pane.height, max: MAX_MOUNTED }) : [];
  return (
    <div className="pv-thumbs" ref={listRef} role="group" aria-label="Page thumbnails" onKeyDown={onKeyDown}>
      <div className="pv-thumbs-track" style={{ height: layout.total }}>
        {pages.map((page, rank) => (
          <ThumbSlot
            key={page}
            page={page}
            rank={rank}
            top={layout.tops[page - 1]}
            height={layout.heights[page - 1]}
            current={page === current}
            cited={page === cited}
            hits={counts?.get(page) ?? 0}
            onPick={onPick}
            thumbs={thumbs}
            active={active}
          />
        ))}
      </div>
    </div>
  );
}

/** Pages | Results, as tabs; Left and Right move between them. */
export function RailTabs({ id, tab, onTab, resultCount = null }) {
  const tabs = [['pages', 'Pages'], ['results', 'Results']];
  const onKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tab === 'pages' ? 'results' : 'pages';
    onTab(next);
    event.currentTarget.querySelector(`#${CSS.escape(`${id}-${next}`)}`)?.focus();
  };
  return (
    <div className="pv-rail-tabs" role="tablist" aria-label="Rail" onKeyDown={onKeyDown}>
      {tabs.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          id={`${id}-${value}`}
          aria-selected={tab === value}
          aria-controls={`${id}-panel`}
          tabIndex={tab === value ? 0 : -1}
          onClick={() => onTab(value)}
        >
          {label}
          {value === 'results' && resultCount !== null ? <> <span className="pv-rail-count">{resultCount}</span></> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * @param {{variant: 'drawer' | 'column', open: boolean, tab: 'pages' | 'results',
 *   onTab: (tab: string) => void, aspects: number[], total: number, current: number, cited: number,
 *   counts: Map<number, number>, onPick: (page: number) => void,
 *   thumbs: {pool: object, cache: object, keyOf: (page: number) => string} | null,
 *   results: {query: string, pages: object[], onPick: (page: number) => void, current: number | null} | null,
 *   onClose: () => void}} props
 *   A closed drawer stays in place for its motion but is inert; a closed column is not drawn.
 *   Escape in the drawer closes it and goes no further (a native listener, before the full view's).
 */
export default function PageRail({ variant, open, tab, onTab, aspects, current, cited, counts, onPick, thumbs, results, onClose }) {
  const id = `pv-rail-${variant}`;
  const rootRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || variant !== 'drawer') return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      closeRef.current?.();
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, [variant]);
  if (variant === 'column' && !open) return null;
  return (
    <aside ref={rootRef} className={`pv-rail pv-rail-${variant}`} data-open={open ? '' : undefined} inert={!open} aria-label="Thumbnails and results">
      <RailTabs id={id} tab={tab} onTab={onTab} resultCount={results ? results.pages.length : null} />
      <div className="pv-rail-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        {tab === 'pages' ? (
          <ThumbList aspects={aspects} current={current} cited={cited} counts={counts} onPick={onPick} thumbs={thumbs} active={open} />
        ) : results ? (
          <div className="pv-rail-results">
            <SearchResults query={results.query} pages={results.pages} onPick={results.onPick} current={results.current} />
          </div>
        ) : (
          <p className="pv-results-empty">Search the document to list its matches here.</p>
        )}
      </div>
    </aside>
  );
}
