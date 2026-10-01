/**
 * The PDF view of one page (docs/specs/2026-10-01-rag-v2-citations-pdf.md, "PDF view"): the
 * page on a canvas at the container's width × zoom, pdf.js's selectable text layer on top, and
 * the citation's block boxes on the cited page. The document, part and render lifecycle lives in
 * the injected controller (pdfController.js); this component measures, schedules and draws.
 *
 * Failures go to `onFailure` as the raw error for classification; nothing here renders or logs
 * error text, which can carry the signed URL.
 */
import { useEffect, useRef, useState } from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';
import { NOTICES, overlayFor } from './viewerModel.js';

/** Quiet time before a page or size change renders, so held-down paging renders once. */
const RENDER_DEBOUNCE_MS = 120;
const RESIZE_DEBOUNCE_MS = 150;

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

/** The container's content width, debounced, from a ResizeObserver. */
function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    setWidth(Math.floor(element.clientWidth));
    if (typeof ResizeObserver === 'undefined') return undefined;
    let timer = null;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect?.width ?? element.clientWidth);
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(next), RESIZE_DEBOUNCE_MS);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [ref]);
  return width;
}

/**
 * @param {{
 *   controller: ReturnType<typeof import('./pdfController.js').createPdfController>,
 *   page: number, total: number, title: string, zoom: number,
 *   citation: object, cited: number, boxesAllowed: boolean, pageRow: object | null,
 *   onFailure: (error: unknown) => void,
 * }} props
 */
export default function PdfPage({ controller, page, total, title, zoom, citation, cited, boxesAllowed, pageRow, onFailure }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const firstBoxRef = useRef(null);
  const renderedOnce = useRef(false);
  const failureRef = useRef(onFailure);
  const [rendered, setRendered] = useState(null);
  const width = useWidth(wrapRef);

  useEffect(() => { failureRef.current = onFailure; }, [onFailure]);

  useEffect(() => {
    if (!controller || !width || !canvasRef.current) return undefined;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    controller.schedule(
      { page, canvas: canvasRef.current, textLayer: textRef.current, width, zoom, dpr },
      {
        delay: renderedOnce.current ? RENDER_DEBOUNCE_MS : 0,
        onDone: (result) => {
          renderedOnce.current = true;
          setRendered({ page, zoom, width, ...result });
        },
        onError: error => failureRef.current?.(error),
      },
    );
    return () => controller.cancel();
  }, [controller, page, width, zoom]);

  const current = rendered && rendered.page === page ? rendered : null;
  const overlay = overlayFor({ citation, page, cited, boxesAllowed, pageRow, viewport: current?.viewport ?? null });

  useEffect(() => {
    if (overlay.boxes.length) firstBoxRef.current?.scrollIntoView?.({ block: 'center' });
  }, [overlay.boxes.length, current]);

  const size = current ? { width: `${current.cssWidth}px`, height: `${current.cssHeight}px` } : undefined;
  return (
    <div className="pv-pdf" ref={wrapRef}>
      {overlay.hint ? <PdfOverlay overlay={overlay} /> : null}
      <div className="pv-page" style={size}>
        <canvas ref={canvasRef} className="pv-canvas" role="img" aria-label={`Page ${page} of ${total}, ${title}`} />
        {overlay.boxes.length ? <PdfOverlay overlay={overlay} firstBoxRef={firstBoxRef} /> : null}
        <div ref={textRef} className="textLayer" />
        {current ? null : <p className="pv-page-loading">Loading page…</p>}
      </div>
    </div>
  );
}
