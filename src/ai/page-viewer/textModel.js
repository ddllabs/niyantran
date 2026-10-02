/**
 * The Text view's two layouts (docs/specs/2026-10-02-viewer-continuous.md, section 6): Continuous,
 * the default, reads the stored page text in batches as they near the view; One page shows a page
 * at a time, as before. The choice is kept in this browser only when the reader makes it. Pure
 * functions, tested in node.
 */

/** Pages read at once by the continuous Text view. */
export const TEXT_BATCH = 10;
export const TEXT_LAYOUT_KEY = 'niyantranTextLayout';
const LAYOUTS = new Set(['continuous', 'page']);

/** The batch holding a page (0 for pages 1 to TEXT_BATCH). */
export const pageBatch = page => Math.floor((page - 1) / TEXT_BATCH);

/** A batch's first and last page, the last cut at the document's end. */
export function batchPages(batch, total) {
  const from = batch * TEXT_BATCH + 1;
  return [from, Math.min(total, from + TEXT_BATCH - 1)];
}

/** The batches to read for the pages near the view, each once, leaving out those `known` (read or being read). */
export function pagesToRead(pages, { known, total }) {
  const out = [];
  for (const page of pages) {
    if (page < 1 || page > total) continue;
    const batch = pageBatch(page);
    if (!known.has(batch) && !out.includes(batch)) out.push(batch);
  }
  return out;
}

const defaultStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

/** The chosen Text layout: 'continuous' unless the reader chose 'page'. Never throws. */
export function readTextLayout(storage = defaultStorage()) {
  try {
    const value = storage?.getItem(TEXT_LAYOUT_KEY);
    return LAYOUTS.has(value) ? value : 'continuous';
  } catch {
    return 'continuous';
  }
}

/** Keep the reader's choice. A storage failure only means it lasts for this viewer. */
export function writeTextLayout(layout, storage = defaultStorage()) {
  if (!LAYOUTS.has(layout)) return;
  try {
    storage?.setItem(TEXT_LAYOUT_KEY, layout);
  } catch {
    // Private mode, quota or a blocked origin.
  }
}

/**
 * The rendered text's text nodes in document order, as the items search reads (`{str, hasEOL,
 * node}`). Blocks are separated by the stored line breaks, which are text nodes themselves.
 */
export function textItems(container) {
  const items = [];
  const walk = (node) => {
    for (const child of node?.childNodes ?? []) {
      if (child.nodeType === 3) items.push({ str: child.data ?? '', hasEOL: false, node: child });
      else if (child.nodeType === 1) walk(child);
    }
  };
  walk(container);
  return items;
}
