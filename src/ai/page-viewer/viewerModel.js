/**
 * The page viewer's decisions, as pure functions (docs/specs/2026-10-01-rag-v2-citations-pdf.md,
 * "The flow" steps 4-7 and "Open stored copy"). The components in this folder only render what
 * these return, so every rule here is testable in node without a DOM.
 */
import { resolveSpan } from '../sourceReader.js';
import { aspectOk, boxStyle, localSpan, pageBoxes, partForPage } from './pageModel.js';

/** The fixed notices of the spec's state table, plus the viewer's own failure texts. */
export const NOTICES = Object.freeze({
  gone: 'This document is no longer available. Try opening the source again.',
  loadFailed: 'This document could not be loaded. Try again.',
  notLive: 'This document is still being processed. Its pages will be available when processing finishes.',
  stale: 'The document was updated since this was cited.',
  noPageText: "This page's text is not available.",
  pageFailed: "This page's text could not be loaded. Try again.",
  hint: 'Cited on this page; passage location not available',
  spanChanged: 'The cited passage could not be located on this page.',
});

/** localStorage key for the reader's last PDF | Text choice (spec decision 2). */
export const VIEW_KEY = 'niyantranCitationView';
const VIEWS = new Set(['pdf', 'text']);

const defaultStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** The remembered view, or null. Never throws: storage can be blocked or absent. */
export function readViewChoice(storage = defaultStorage()) {
  try {
    const value = storage?.getItem(VIEW_KEY);
    return VIEWS.has(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remember the view. A storage failure only means it is not remembered. */
export function writeViewChoice(view, storage = defaultStorage()) {
  if (!VIEWS.has(view)) return;
  try {
    storage?.setItem(VIEW_KEY, view);
  } catch {
    // Private mode, quota or a blocked origin: the choice lasts for this viewer only.
  }
}

const nonblank = value => typeof value === 'string' && value.trim() !== '';
const PDF_STATES = new Set(['ok', 'stale', 'unknown_freshness', 'no_page_text']);

/** The PDF view exists: a live document with storage and stored parts, in a state that keeps it. */
export function pdfAvailable({ doc, parts, state }) {
  return Boolean(doc && doc.indexed_at != null && nonblank(doc.storage_path)
    && Array.isArray(parts) && parts.length > 0 && PDF_STATES.has(state));
}

/**
 * Which view shows: Text whenever the PDF is unavailable or has failed; otherwise the
 * reader's choice in this viewer, else the remembered one, else PDF.
 */
export function chooseView({ available, stored, choice, failed }) {
  if (!available || failed) return 'text';
  if (VIEWS.has(choice)) return choice;
  return stored === 'text' ? 'text' : 'pdf';
}

const isPage = value => Number.isSafeInteger(value) && value >= 1;

/** N in "Page X of N": the document's page_count, else the end of its last part, else the cited page. */
export function pageTotal(doc, parts, cited) {
  if (isPage(doc?.page_count)) return doc.page_count;
  const ends = (Array.isArray(parts) ? parts : []).map(p => p.page_offset + p.page_count).filter(isPage);
  return ends.length ? Math.max(...ends) : cited;
}

const BLOCKED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * The page a key press moves to, or null to leave the key alone. The viewer binds this only on
 * its own controls; this also refuses inputs, editable text, a live text selection, modified keys,
 * and keys inside an open menu (whose arrows move between its items), so selecting, typing or
 * choosing never pages.
 *
 * @param {{key: string, targetTag?: string, editable?: boolean, hasSelection?: boolean,
 *   inMenu?: boolean, altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean}} event
 * @param {{page: number, cited: number, total: number}} at
 */
export function pagingKey(event, { page, cited, total }) {
  if (!event || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (BLOCKED_TAGS.has(String(event.targetTag || '').toUpperCase()) || event.editable || event.hasSelection || event.inMenu) return null;
  let next = null;
  if (event.key === 'ArrowLeft' || event.key === '[') next = page - 1;
  else if (event.key === 'ArrowRight' || event.key === ']') next = page + 1;
  else if (event.key === 'Home') next = cited;
  if (next === null || next === page || next < 1 || next > total) return null;
  return next;
}

/**
 * What the PDF view draws over the page: box styles on the cited page when boxes may be trusted
 * (`boxesAllowed`) and the stored page aspect matches the rendered one, else the hint. Off the
 * cited page, before the page has rendered, or when boxes are not allowed, nothing.
 */
export function overlayFor({ citation, page, cited, boxesAllowed, pageRow, viewport }) {
  if (!boxesAllowed || page !== cited || !viewport) return { boxes: [], hint: false };
  const boxes = pageBoxes(citation, page);
  if (!boxes.length || !aspectOk(pageRow, viewport)) return { boxes: [], hint: true };
  return { boxes: boxes.map(boxStyle), hint: false };
}

/**
 * The cited span on the page's own text: `exact` with page-local offsets, or `changed`.
 * The span is never clamped, and `moved` is not used for pages (spec, "Text view").
 */
export async function resolvePageSpan(citation, pageRow) {
  const span = localSpan(citation, pageRow);
  if (!span) return { status: 'changed' };
  const found = await resolveSpan(pageRow.text, { ...citation, char_from: span.from, char_to: span.to });
  return found.status === 'exact' && found.to > found.from ? { status: 'exact', from: found.from, to: found.to } : { status: 'changed' };
}

/** "Open stored copy", naming the part only when the document is split. */
export function storedCopyLabel(parts, page) {
  const list = Array.isArray(parts) ? parts : [];
  const part = list.length > 1 ? partForPage(list, page) : null;
  return part ? `Open stored copy (part ${part.part_index + 1} of ${list.length})` : 'Open stored copy';
}
