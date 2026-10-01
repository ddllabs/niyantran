/**
 * The page viewer's DOM wiring, kept as small functions over injected elements so it runs
 * against fakes in node (docs/specs/2026-10-01-rag-v2-citations-pdf.md, amendment revision 4,
 * points 2 and 3): the full view's Esc, focus trap and focus return; ⌘/Ctrl + wheel zoom over
 * the page; the phone breakpoint; and the theme class a portalled dialog must carry.
 */
import { wheelZoomFactor } from './zoomModel.js';

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
 * Open the full view's behaviour on its dialog node: focus moves in, keys are handled there,
 * and the returned detach puts focus back on `returnFocus()` (the Expand control).
 */
export function attachFullView({ container, initialFocus = null, returnFocus = () => null, onClose, getActive }) {
  const onKey = fullViewKeyHandler({ container, onClose, getActive });
  container.addEventListener('keydown', onKey);
  (initialFocus ?? container).focus?.();
  return () => {
    container.removeEventListener('keydown', onKey);
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
