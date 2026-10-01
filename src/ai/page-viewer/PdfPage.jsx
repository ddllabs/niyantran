/**
 * The PDF view of one page (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "PDF view", and
 * amendment revision 4, point 2): the page on a canvas at the scale its fit or zoom asks for,
 * pdf.js's selectable text layer on top, and the citation's block boxes on the cited page.
 *
 * Fit text crops the blank margins visually: the whole page is rendered and shifted inside a
 * clip (`cropStyles`), so the text layer and the boxes keep page coordinates and stay aligned.
 * A page wider than the pane scrolls horizontally inside `.pv-pdf`, never the document.
 *
 * The document, part and render lifecycle lives in the injected controller (pdfController.js);
 * this component measures, schedules and draws. Failures go to `onFailure` as the raw error for
 * classification; nothing here renders or logs error text, which can carry the signed URL.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';
import { pageBoxes } from './pageModel.js';
import { createWheelHandler, scrollTargetFor } from './viewerDom.js';
import { NOTICES, overlayFor } from './viewerModel.js';
import { layoutPage } from './zoomModel.js';

/** Quiet time before a page, size or zoom change renders, so held-down paging and pinches render once. */
const RENDER_DEBOUNCE_MS = 120;
const RESIZE_DEBOUNCE_MS = 150;

const px = value => `${Math.round(value * 100) / 100}px`;

/** The clip's size and the whole page's size and shift inside it, as CSS. */
export function cropStyles(layout) {
  return {
    crop: { width: px(layout.cropCss.width), height: px(layout.cropCss.height) },
    page: {
      width: px(layout.pageCss.width),
      height: px(layout.pageCss.height),
      left: px(layout.offset.left),
      top: px(layout.offset.top),
    },
  };
}

/** The boxes, each a `pointer-events: none` overlay, or the hint when the location is unknown. */
export function PdfOverlay({ overlay, firstBoxRef = null }) {
  if (overlay.hint) return <p className="pv-hint" role="status">{NOTICES.hint}</p>;
  if (!overlay.boxes.length) return null;
  return (
    <div className="pv-boxes" aria-hidden="true">
      {overlay.boxes.map((style, i) => (
        <div key={i} ref={i === 0 ? firstBoxRef : null} className="pv-box" style={style} />
      ))}
    </div>
  );
}

/** The pane's content size, debounced, from a ResizeObserver. */
function usePaneSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const read = rect => ({ width: Math.floor(rect?.width ?? element.clientWidth), height: Math.floor(rect?.height ?? element.clientHeight) });
    setSize(read(null));
    if (typeof ResizeObserver === 'undefined') return undefined;
    let timer = null;
    const observer = new ResizeObserver((entries) => {
      const next = read(entries[0]?.contentRect);
      clearTimeout(timer);
      timer = setTimeout(() => setSize(prev => (prev.width === next.width && prev.height === next.height ? prev : next)), RESIZE_DEBOUNCE_MS);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [ref]);
  return size;
}

/**
 * @param {{
 *   controller: ReturnType<typeof import('./pdfController.js').createPdfController>,
 *   page: number, total: number, title: string,
 *   zoomState: {fit: string, zoom: number | null},
 *   blocks: object[], blocksReady: boolean,
 *   citation: object, cited: number, boxesAllowed: boolean, pageRow: object | null,
 *   onFailure: (error: unknown) => void,
 *   onLayout?: (layout: object | null) => void,
 *   onWheelZoom?: (factor: number) => void,
 * }} props
 */
export default function PdfPage({
  controller, page, total, title, zoomState, blocks, blocksReady, citation, cited, boxesAllowed, pageRow,
  onFailure, onLayout, onWheelZoom,
}) {
  const wrapRef = useRef(null);
  const cropRef = useRef(null);
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const firstBoxRef = useRef(null);
  const renderedOnce = useRef(false);
  const failureRef = useRef(onFailure);
  const wheelRef = useRef(onWheelZoom);
  const [rendered, setRendered] = useState(null);
  const [base, setBase] = useState(null);
  const pane = usePaneSize(wrapRef);

  useEffect(() => { failureRef.current = onFailure; }, [onFailure]);
  useEffect(() => { wheelRef.current = onWheelZoom; }, [onWheelZoom]);

  const boxes = useMemo(() => (boxesAllowed && page === cited ? pageBoxes(citation, page) : []), [boxesAllowed, page, cited, citation]);
  const fit = zoomState.fit;
  const zoom = zoomState.zoom;
  // The pane height matters only to Fit page; other modes do not re-render when it changes.
  const paneHeight = zoom === null && fit === 'page' ? pane.height : 0;

  // The layout the controls show: the current state against the last rendered page size, so the
  // readout follows −, + and pinches at once rather than after the render.
  const target = useMemo(
    () => layoutPage({ state: { fit, zoom }, page: base, pane: { width: pane.width, height: paneHeight }, blocks, boxes }),
    [fit, zoom, base, pane.width, paneHeight, blocks, boxes],
  );
  useEffect(() => { onLayout?.(target); }, [onLayout, target]);

  useEffect(() => {
    if (!controller || !pane.width || !blocksReady || !canvasRef.current) return undefined;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const state = { fit, zoom };
    const size = { width: pane.width, height: paneHeight };
    let chosen = null;
    controller.schedule(
      {
        page,
        canvas: canvasRef.current,
        textLayer: textRef.current,
        scaleFor: (natural) => {
          chosen = layoutPage({ state, page: natural, pane: size, blocks, boxes });
          return chosen?.scale ?? pane.width / natural.width;
        },
        dpr,
      },
      {
        delay: renderedOnce.current ? RENDER_DEBOUNCE_MS : 0,
        onDone: (result) => {
          renderedOnce.current = true;
          setBase(prev => (prev && prev.width === result.viewport.width && prev.height === result.viewport.height ? prev : result.viewport));
          setRendered({ page, layout: chosen, ...result });
        },
        onError: error => failureRef.current?.(error),
      },
    );
    return () => controller.cancel();
  }, [controller, page, pane.width, paneHeight, fit, zoom, blocks, boxes, blocksReady]);

  // ⌘/Ctrl + wheel and pinch zoom over the page only; a non-passive listener, so it can stop the
  // browser's own zoom then and only then.
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return undefined;
    const onWheel = createWheelHandler({
      isOverPage: node => Boolean(cropRef.current && node && cropRef.current.contains(node)),
      onZoom: factor => wheelRef.current?.(factor),
    });
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel, { passive: false });
  }, []);

  const current = rendered && rendered.page === page && rendered.layout ? rendered : null;
  const overlay = overlayFor({ citation, page, cited, boxesAllowed, pageRow, viewport: current?.viewport ?? null });

  // When a page arrives: start at its top-left, then bring the first cited box into view. A zoom
  // on the same page keeps the reader's scroll position.
  const shownPage = current?.page ?? null;
  useEffect(() => {
    if (shownPage === null) return;
    const area = wrapRef.current;
    area?.scrollTo?.({ top: 0, left: 0 });
    const box = overlay.boxes.length ? firstBoxRef.current : null;
    if (area && box?.getBoundingClientRect) {
      area.scrollTo?.(scrollTargetFor(box.getBoundingClientRect(), area.getBoundingClientRect(), { top: 0, left: 0 }));
    }
  }, [shownPage, overlay.boxes.length]);

  const styles = current ? cropStyles(current.layout) : null;
  return (
    <>
      {overlay.hint ? <PdfOverlay overlay={overlay} /> : null}
      <div className="pv-pdf" ref={wrapRef}>
        <div className="pv-crop" ref={cropRef} style={styles?.crop}>
          <div className="pv-page" style={styles?.page}>
            <canvas ref={canvasRef} className="pv-canvas" role="img" aria-label={`Page ${page} of ${total}, ${title}`} />
            {overlay.boxes.length ? <PdfOverlay overlay={overlay} firstBoxRef={firstBoxRef} /> : null}
            <div ref={textRef} className="textLayer" />
          </div>
          {current ? null : <p className="pv-page-loading">Loading page…</p>}
        </div>
      </div>
    </>
  );
}
