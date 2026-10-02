/**
 * The continuous PDF view (docs/specs/2026-10-02-viewer-continuous.md, section 1): every page laid
 * out at its true size from the stored page sizes, and only the pages in or near the view drawn,
 * through the part pool, nearest the centre first. It opens on the citation, keeps the point under
 * the pointer (or the centre) still through a zoom, and reports the page under the centre of the
 * view.
 *
 * Scrolling is read by one passive listener, once per animation frame; slots are placed by
 * arithmetic (layoutModel.js), not observed. A page that leaves the render window unmounts, which
 * cancels its render and frees its canvas. Failures go to `onFailure` as the raw error, for
 * classification; nothing here renders or logs error text, which can carry a signed URL.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';
import { usePaneSize } from './chromeHooks.js';
import { anchorAt, currentPage, pageWidth, renderWindow, scrollForAnchor, scrollTopFor, slotLayout } from './layoutModel.js';
import { createWheelHandler } from './viewerDom.js';
import { NOTICES } from './viewerModel.js';
import { CSS_PX_PER_PT } from './zoomModel.js';

/** Quiet time after a zoom before pages are drawn again at the new size, so a pinch draws once. */
const REDRAW_DEBOUNCE_MS = 120;
/** The full view's pill and its margins: viewer.css reserves the same as --pv-pill-space. */
export const PILL_SPACE_PX = 72;

/** The boxes, each a `pointer-events: none` overlay, or the hint when the location is unknown. */
export function PdfOverlay({ overlay }) {
  if (overlay.hint) return <p className="pv-hint" role="status">{NOTICES.hint}</p>;
  if (!overlay.boxes.length) return null;
  return (
    <div className="pv-boxes" aria-hidden="true">
      {overlay.boxes.map((style, i) => <div key={i} className="pv-box" style={style} />)}
    </div>
  );
}

/**
 * One page: its canvas and text layer, drawn by the pool at `width` CSS px. The first draw is
 * immediate; a later size change waits for a quiet moment, while the old drawing stretches to fit.
 */
const PdfSlot = memo(function PdfSlot({ pool, page, total, title, top, left, width, height, priority, dpr, overlay, onRendered, onFailure }) {
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const handleRef = useRef(null);
  const drawnRef = useRef(false);
  const callbacks = useRef({ onRendered, onFailure });
  const [ready, setReady] = useState(false);
  useEffect(() => { callbacks.current = { onRendered, onFailure }; });

  useEffect(() => {
    const draw = () => {
      handleRef.current = pool.request({
        page,
        canvas: canvasRef.current,
        textLayer: textRef.current,
        scaleFor: base => width / base.width,
        dpr,
        priority,
        onDone: (result) => {
          drawnRef.current = true;
          const canvas = canvasRef.current;
          if (canvas) Object.assign(canvas.style, { width: '100%', height: '100%' });
          setReady(true);
          callbacks.current.onRendered?.(page, result);
        },
        onError: error => callbacks.current.onFailure?.(error),
      });
    };
    const timer = drawnRef.current ? setTimeout(draw, REDRAW_DEBOUNCE_MS) : null;
    if (!timer) draw();
    return () => {
      clearTimeout(timer);
      handleRef.current?.cancel();
      handleRef.current = null;
    };
    // The priority is updated in place below; a new one must not redraw the page.
  }, [pool, page, width, dpr]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { handleRef.current?.setPriority(priority); }, [priority]);

  return (
    <div className="pv-slot" style={{ top, left, width, height }} data-page={page}>
      <canvas ref={canvasRef} className="pv-canvas" role="img" aria-label={`Page ${page} of ${total}, ${title}`} />
      {overlay}
      <div ref={textRef} className="textLayer" />
      {ready ? null : <p className="pv-page-loading" aria-hidden="true">{page}</p>}
    </div>
  );
});

/**
 * @param {{
 *   pool: ReturnType<typeof import('./pdfPool.js').createPdfPool>,
 *   total: number, title: string, aspects: number[], naturalPts: number[],
 *   zoomState: {fit: string, zoom: number | null},
 *   cited: number, citedColumn: {x0: number, x1: number} | null, citedPt: number,
 *   citedBox: {y0: number, y1: number} | null,  where the citation sits on its page
 *   openAt: number,  the page to open on: the citation when it is the cited page (the first open),
 *     else that page's top (switching back from the Text view keeps the reader's page)
 *   citedOverlay: import('react').ReactNode,     drawn over the cited page
 *   scrollRequest: {page: number, seq: number} | null,
 *   insetBottom?: number,   the full view's pill (PILL_SPACE_PX), which viewer.css reserves as padding
 *   onPage: (page: number) => void, onZoom: (zoom: number) => void,
 *   onWheelZoom: (factor: number) => void, onMeasured: (page: number, base: object) => void,
 *   onFailure: (error: unknown) => void,
 * }} props
 */
export default function PdfDocument({
  pool, total, title, aspects, naturalPts, zoomState, cited, citedColumn, citedPt, citedBox, citedOverlay, scrollRequest, openAt = cited,
  insetBottom = 0, onPage, onZoom, onWheelZoom, onMeasured, onFailure,
}) {
  const areaRef = useRef(null);
  const docRef = useRef(null);
  const pane = usePaneSize(areaRef);
  const [view, setView] = useState({ top: 0, left: 0, height: 0 });
  const viewRef = useRef(view);
  const anchorRef = useRef(null);
  const prevRef = useRef(null);
  const openedRef = useRef(false);
  const callbacks = useRef({ onWheelZoom });
  useEffect(() => { callbacks.current = { onWheelZoom }; });

  const widths = useMemo(
    () => aspects.map((aspect, i) => pageWidth(zoomState, pane, { aspect, naturalPt: naturalPts[i] }, { column: citedColumn, citedPt })),
    [aspects, naturalPts, zoomState, pane, citedColumn, citedPt],
  );
  const layout = useMemo(() => slotLayout({ aspects, widthOf: i => widths[i] }), [aspects, widths]);
  const contentWidth = useMemo(() => widths.reduce((max, w) => Math.max(max, w), pane.width), [widths, pane.width]);
  const layoutRef = useRef({ layout, contentWidth });
  layoutRef.current = { layout, contentWidth };

  /** Reads the area's scroll position into the view state, at once (after a programmatic scroll). */
  function syncView(area) {
    const next = { top: area.scrollTop, left: area.scrollLeft, height: area.clientHeight };
    viewRef.current = next;
    setView(prev => (prev.top === next.top && prev.left === next.left && prev.height === next.height ? prev : next));
  }

  // One passive scroll listener, read once per frame.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      syncView(area);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    area.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      area.removeEventListener('scroll', onScroll);
    };
  }, []);

  // ⌘/Ctrl + wheel and pinch zoom over the pages only, about the point under the pointer.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return undefined;
    const onWheel = createWheelHandler({
      isOverPage: node => Boolean(docRef.current && node && docRef.current.contains(node)),
      onZoom: (factor, event) => {
        const rect = area.getBoundingClientRect();
        const offset = { y: event.clientY - rect.top, x: event.clientX - rect.left };
        anchorRef.current = anchorFor(layoutRef.current, viewRef.current, offset);
        callbacks.current.onWheelZoom?.(factor);
      },
    });
    area.addEventListener('wheel', onWheel, { passive: false });
    return () => area.removeEventListener('wheel', onWheel, { passive: false });
  }, []);

  // Open on the citation; after a zoom or resize, keep the anchored point (the pointer's, or the
  // centre of the view) where it was.
  useLayoutEffect(() => {
    const area = areaRef.current;
    const prev = prevRef.current;
    prevRef.current = { layout, contentWidth };
    if (!area || !layout.count || !pane.width) return;
    if (!openedRef.current) {
      openedRef.current = true;
      area.scrollTop = scrollTopFor(layout, { page: openAt, box: openAt === cited ? citedBox : null, viewport: area.clientHeight, insetBottom });
      if (openAt === cited && citedColumn && zoomState.zoom === null && zoomState.fit === 'text') {
        const i = cited - 1;
        area.scrollLeft = Math.max(0, (contentWidth - widths[i]) / 2 + citedColumn.x0 * widths[i]);
      }
    } else if (prev && prev.layout !== layout) {
      const offset = { y: viewRef.current.height / 2, x: area.clientWidth / 2 };
      const anchor = anchorRef.current ?? anchorFor(prev, viewRef.current, offset);
      anchorRef.current = null;
      area.scrollTop = scrollForAnchor(layout, anchor.at, anchor.offset.y);
      area.scrollLeft = Math.max(0, anchor.xFraction * contentWidth - anchor.offset.x);
    } else {
      return;
    }
    syncView(area);
  }, [layout, contentWidth, pane.width]); // eslint-disable-line react-hooks/exhaustive-deps

  // A page asked for from the toolbar: its top at the top of the view; the cited page (Back to
  // p. N, Home), with the citation centred, as on opening.
  useEffect(() => {
    const area = areaRef.current;
    if (!area || !scrollRequest || !layout.count) return;
    const box = scrollRequest.page === cited ? citedBox : null;
    area.scrollTop = scrollTopFor(layout, { page: scrollRequest.page, box, viewport: area.clientHeight, insetBottom });
    syncView(area);
  }, [scrollRequest]); // eslint-disable-line react-hooks/exhaustive-deps -- once per request

  // Until it has opened on the citation, the view is where it is about to be scrolled to, so the
  // first pages drawn are the cited ones, not the document's first.
  const viewport = view.height || pane.height;
  const top = openedRef.current ? view.top : scrollTopFor(layout, { page: openAt, box: openAt === cited ? citedBox : null, viewport, insetBottom });
  const current = currentPage(layout, top, viewport);
  useEffect(() => { onPage?.(current); }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = layout.count ? widths[current - 1] / (naturalPts[current - 1] * CSS_PX_PER_PT) : null;
  useEffect(() => { if (zoom) onZoom?.(zoom); }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing is drawn before the pane is measured: every page would have no size, and all would be in view.
  const pages = pane.width > 0 ? renderWindow(layout, top, viewport) : [];
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return (
    <div className="pv-pdf" ref={areaRef}>
      <div className="pv-doc" ref={docRef} style={{ width: contentWidth, height: layout.total }}>
        {pages.map((page, rank) => {
          const i = page - 1;
          return (
            <PdfSlot
              key={page}
              pool={pool}
              page={page}
              total={total}
              title={title}
              top={layout.tops[i]}
              left={(contentWidth - layout.widths[i]) / 2}
              width={layout.widths[i]}
              height={layout.heights[i]}
              priority={rank}
              dpr={dpr}
              overlay={page === cited ? citedOverlay : null}
              onRendered={onMeasured}
              onFailure={onFailure}
            />
          );
        })}
      </div>
    </div>
  );
}

/** The page and fraction at an offset of the view, and the horizontal share of the content there. */
function anchorFor({ layout, contentWidth }, view, offset) {
  return {
    at: anchorAt(layout, view.top, offset.y),
    xFraction: contentWidth ? (view.left + offset.x) / contentWidth : 0,
    offset,
  };
}
