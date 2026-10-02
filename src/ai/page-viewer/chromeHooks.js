/**
 * The viewer's hooks: the chrome's compact flag and tooltip warm-up
 * (docs/specs/2026-10-02-viewer-toolbar.md, "Speed and hardening"), and the pane size the pages
 * are laid out in.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { toolbarLayout } from './chromeModel.js';
import { createTipWarmth } from './menuDom.js';

const RESIZE_DEBOUNCE_MS = 100;
const PANE_DEBOUNCE_MS = 150;

/** Padding on both sides of an axis, in px; 0 where computed styles are unavailable. */
function paddingOf(element, a, b) {
  const style = globalThis.getComputedStyle?.(element);
  return style ? (Number.parseFloat(style[a]) || 0) + (Number.parseFloat(style[b]) || 0) : 0;
}

/**
 * The element's content size, debounced, from a ResizeObserver. The first read leaves out padding
 * as ResizeObserver's contentRect does: the full view keeps the pages clear of its floating pill
 * with bottom padding, and Fit page must fit a page above it.
 */
export function usePaneSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const read = rect => ({
      width: Math.floor(rect?.width ?? element.clientWidth - paddingOf(element, 'paddingLeft', 'paddingRight')),
      height: Math.floor(rect?.height ?? element.clientHeight - paddingOf(element, 'paddingTop', 'paddingBottom')),
    });
    setSize(read(null));
    if (typeof ResizeObserver === 'undefined') return undefined;
    let timer = null;
    const observer = new ResizeObserver((entries) => {
      const next = read(entries[0]?.contentRect);
      clearTimeout(timer);
      timer = setTimeout(() => setSize(prev => (prev.width === next.width && prev.height === next.height ? prev : next)), PANE_DEBOUNCE_MS);
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
 * Whether the element is narrower than the compact threshold. The side pane's width, not the
 * window's, decides it, because the dock does not follow the window. Read before the first paint,
 * so a narrow pane never shows the full toolbar for a frame; then on resize, debounced. Only the
 * flag is kept, so a height change re-renders nothing.
 */
export function useCompact(ref) {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = width => setCompact(toolbarLayout(width) === 'compact');
    update(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    let timer = null;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? element.clientWidth;
      clearTimeout(timer);
      timer = setTimeout(() => update(width), RESIZE_DEBOUNCE_MS);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [ref]);
  return compact;
}

/** Tooltips after the first show at once while the pointer stays in this part of the viewer. */
export function useTipWarmth(ref, active) {
  useEffect(() => {
    const node = ref.current;
    if (!active || !node) return undefined;
    const warmth = createTipWarmth(node);
    return () => warmth.dispose();
  }, [ref, active]);
}
