/**
 * The viewer chrome's decisions, as pure functions (docs/specs/2026-10-02-viewer-toolbar.md). The
 * chrome components only render what these return, so each rule is testable in node.
 */

/** Below this measured width (px) the page toolbar is compact: zoom moves into the More menu. */
export const COMPACT_BELOW = 420;

const WHOLE = /^\d+$/;

/**
 * The page a typed value names, or null when it is not a whole page within 1..total. Null means
 * "do not move": the page box then shows the current page again.
 */
export function parsePageInput(text, total) {
  if (typeof text !== 'string' || !Number.isSafeInteger(total) || total < 1) return null;
  const value = text.trim();
  if (!WHOLE.test(value)) return null;
  const page = Number(value);
  return page >= 1 && page <= total ? page : null;
}

/** The cited chip: a status on the cited page, otherwise the way back to it. */
export function citedChip({ page, cited }) {
  if (page === cited) return { kind: 'status', label: `Cited p. ${cited}` };
  return { kind: 'return', label: `Back to p. ${cited}`, target: cited };
}

/** 'compact' below COMPACT_BELOW; 'full' otherwise, including before the first measurement. */
export function toolbarLayout(width) {
  return Number.isFinite(width) && width > 0 && width < COMPACT_BELOW ? 'compact' : 'full';
}

const FITS = Object.freeze([['text', 'Fit text'], ['width', 'Fit width'], ['page', 'Fit page']]);

/** The fit menu's items, the current fit checked; none under a manual zoom. */
export function fitItems({ fit, manual }) {
  return FITS.map(([value, label]) => ({ value, label, checked: !manual && value === fit }));
}

/**
 * Copies `text`; resolves true when the clipboard took it and false otherwise. Never throws: a
 * missing clipboard, a refused permission and an insecure context all just answer false.
 */
export async function copyText(text, clipboard = globalThis.navigator?.clipboard) {
  try {
    if (typeof clipboard?.writeText !== 'function') return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which chrome a viewer shows. Zoom belongs to the PDF view only: in the page toolbar, or in the
 * More menu when the side pane is compact; the full view's pill always has room for it. Full view
 * opens from the side pane only, and never on phones.
 */
export function chromePlan({ available, view, compact, narrow, full }) {
  const pdf = Boolean(available) && view === 'pdf';
  return {
    viewSwitch: Boolean(available),
    toolbarZoom: pdf && (full || !compact),
    moreZoom: pdf && !full && Boolean(compact),
    expand: !full && !narrow,
  };
}

const oneLine = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * The citation's section as the chrome shows it, on one line (extracted headings carry line breaks
 * and runs of spaces). A heading that only repeats the document title (often the case for a bill)
 * is dropped, so the specific part, the note, is what stays visible; a lone heading is shown as the
 * note. `label` is the whole line, for the tooltip.
 */
export function sectionParts(section, title) {
  let head = oneLine(section?.heading);
  let note = oneLine(section?.note);
  if (head && head.toLowerCase() === oneLine(title).toLowerCase()) head = '';
  if (head && !note) [head, note] = ['', head];
  return { head, note, label: head ? `${head} › ${note}` : note };
}
