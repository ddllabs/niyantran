/**
 * The viewer chrome's two hooks (docs/specs/2026-10-02-viewer-toolbar.md, "Speed and hardening").
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { toolbarLayout } from './chromeModel.js';
import { createTipWarmth } from './menuDom.js';

const RESIZE_DEBOUNCE_MS = 100;

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
