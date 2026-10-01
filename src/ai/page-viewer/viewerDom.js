/**
 * The page viewer's DOM wiring, kept as small functions over injected elements so it runs
 * against fakes in node (docs/specs/2026-10-01-rag-v2-citations-pdf.md, amendment revision 4,
 * points 2 and 3, and revision 5 point 3): the full view's Esc, backdrop click, focus trap and
 * focus return; ⌘/Ctrl + wheel zoom over the page; the phone breakpoint; and the theme class a
 * portalled dialog must carry.
 */
import { wheelZoomFactor } from './zoomModel.js';

/**
 * Marks the full view's root (portalled to the body) as part of the citation viewer, so the
 * overlay's click-outside handling can tell a click there from a click on the desk:
 * `node.closest('[data-citation-viewer]')`.
 */
export const VIEWER_ATTRIBUTE = 'data-citation-viewer';

/** The existing phone breakpoint (citation-overlay.css): no Full view at or below it. */
export const NARROW_QUERY = '(max-width: 900px)';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'select:not([disabled])', 'input:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

const activeElement = () => globalThis.document?.activeElement;

/**
 * The full view's keydown handler, for a native listener on the dialog node.
 * - Esc closes the full view and goes no further: the overlay (and the dock) close on Esc too,
 *   so the event is stopped on the dialog itself, before React's or the document's listeners.
 * - Tab and Shift+Tab wrap inside the dialog.
 */
export function fullViewKeyHandler({ container, onClose, getActive = activeElement }) {
  return (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...container.querySelectorAll(FOCUSABLE)];
    if (!items.length) {
      event.preventDefault();
      container.focus?.();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = getActive();
    const outside = !container.contains(active);
    if (event.shiftKey && (outside || active === first || active === container)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (outside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  };
}

/**
 * Backdrop listeners: a completed click on the backdrop itself — pressed, released and clicked
 * there, never inside the dialog panel — calls `onClose`. A press in the panel released on the
 * backdrop (a text-selection drag), the reverse, and a keyboard click close nothing.
 */
function backdropHandlers(backdrop, onClose) {
  let pressed = false;
  return {
    pointerdown: (event) => { pressed = event.target === backdrop; },
    pointerup: (event) => { if (event.target !== backdrop) pressed = false; },
    click: (event) => {
      const completed = pressed && event.target === backdrop;
      pressed = false;
      if (completed) onClose();
    },
  };
}

/**
 * Open the full view's behaviour on its dialog node: focus moves in, keys are handled there, a
 * click on `backdrop` (the root around the panel) closes it, and the returned detach puts focus
 * back on `returnFocus()` (the Expand control).
 */
export function attachFullView({ container, backdrop = null, initialFocus = null, returnFocus = () => null, onClose, getActive }) {
  const onKey = fullViewKeyHandler({ container, onClose, getActive });
  const onBackdrop = backdrop ? Object.entries(backdropHandlers(backdrop, onClose)) : [];
  container.addEventListener('keydown', onKey);
  for (const [type, fn] of onBackdrop) backdrop.addEventListener(type, fn);
  (initialFocus ?? container).focus?.();
  return () => {
    container.removeEventListener('keydown', onKey);
    for (const [type, fn] of onBackdrop) backdrop.removeEventListener(type, fn);
    returnFocus()?.focus?.();
  };
}

/**
 * A wheel listener (to be added with `{passive: false}`) that zooms only on ⌘/Ctrl + wheel or
 * a trackpad pinch over the page, and only then stops the browser's own page zoom. A plain
 * wheel scrolls as usual.
 */
export function createWheelHandler({ isOverPage, onZoom }) {
  return (event) => {
    const factor = wheelZoomFactor(event);
    if (factor === null || !isOverPage(event.target)) return;
    event.preventDefault();
    onZoom(factor);
  };
}

/** The media query list for the phone breakpoint, or null where there is none. */
export function narrowQuery(win = globalThis.window) {
  try {
    return win?.matchMedia?.(NARROW_QUERY) ?? null;
  } catch {
    return null;
  }
}

/** True at phone width. False without matchMedia, so desktop is the default. */
export function isNarrow(win = globalThis.window) {
  return Boolean(narrowQuery(win)?.matches);
}

/** The app's `theme-*` class around `element`, for a dialog portalled outside it. */
export function themeClassOf(element) {
  const host = element?.closest?.('[class*="theme-"]');
  return host ? [...host.classList].filter(name => name.startsWith('theme-')).join(' ') : '';
}

/**
 * Where the page area should scroll to show a cited box: centred vertically; horizontally only when
 * the box lies outside the visible width (a zoomed page). Rects are viewport rects (getBoundingClientRect);
 * `current` is the area's scroll position. scrollIntoView is not used: it also scrolls the
 * overflow-clipped crop, which hid the text's left edge (local run V7b, 2026-10-01).
 */
export function scrollTargetFor(box, area, current) {
  const boxTop = box.top - area.top + current.top;
  const top = Math.max(0, Math.round(boxTop + box.height / 2 - area.height / 2));
  const boxLeft = box.left - area.left + current.left;
  const visible = boxLeft >= current.left && boxLeft + box.width <= current.left + area.width;
  const left = visible ? current.left : Math.max(0, Math.round(boxLeft + box.width / 2 - area.width / 2));
  return { top, left };
}
