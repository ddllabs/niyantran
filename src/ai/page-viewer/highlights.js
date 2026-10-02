/**
 * Marks on the PDF's text layer (docs/specs/2026-10-02-viewer-continuous.md, sections 3 and 4),
 * with the CSS Custom Highlight API: ranges over the text pdf.js rendered, painted by name from
 * viewer.css (`::highlight(...)`). Nothing is added to the text layer, and one range runs across
 * lines and spans. Small functions over injected elements, tested with fakes.
 */
import { layerWords, locatePassage, passageWords } from './passageMatch.js';

/**
 * The text layer's items in render order: each text span's text, whether a line ends after it (pdf.js
 * puts a <br> there), and its text node. The marked-content wrappers pdf.js nests spans in are not
 * items.
 */
export function layerItems(container) {
  return [...container.querySelectorAll('span')]
    .filter(span => !span.classList.contains('markedContent'))
    .map(span => ({ str: span.textContent ?? '', hasEOL: span.nextSibling?.nodeName === 'BR', node: span.firstChild }));
}

/**
 * A registry of ranges per page under one highlight name; `supported` is false where the browser
 * has no Highlight API, and then nothing is registered.
 */
export function createHighlighter(name, env = globalThis) {
  const supported = Boolean(env.CSS?.highlights) && typeof env.Highlight === 'function';
  const pages = new Map();
  const sync = () => {
    if (!supported) return;
    const ranges = [...pages.values()].flat();
    if (ranges.length) env.CSS.highlights.set(name, new env.Highlight(...ranges));
    else env.CSS.highlights.delete(name);
  };
  return {
    supported,
    set(page, ranges) { pages.set(page, ranges); sync(); },
    clear(page) { if (pages.delete(page)) sync(); },
    dispose() { pages.clear(); if (supported) env.CSS.highlights.delete(name); },
  };
}

/**
 * Finds `passageText` (the stored page text of the citation's piece on this page) in the page's
 * drawn text layer and marks it as one range. 'exact' when marked; 'missing' when the layer has no
 * text or the passage is not there; 'unsupported' without the Highlight API.
 */
export function markPage({ container, passageText, page, doc = globalThis.document, highlighter }) {
  if (!highlighter.supported) return 'unsupported';
  const items = layerItems(container);
  const words = layerWords(items);
  const found = words.length ? locatePassage(passageWords(passageText), words) : null;
  if (!found) return 'missing';
  const first = words[found.start];
  const last = words[found.end];
  const startNode = items[first.item]?.node;
  const endNode = items[last.endItem]?.node;
  if (!startNode || !endNode) return 'missing';
  const range = doc.createRange();
  range.setStart(startNode, first.from);
  range.setEnd(endNode, last.to);
  highlighter.set(page, [range]);
  return 'exact';
}

/**
 * Whether `page` needs the layout boxes in place of the exact mark: there is no stored text to mark
 * it with, or the drawn page reported no match or no Highlight API for the current text. `results`
 * holds each page's last report with the text it was made for, so one for an earlier passage does
 * not count; nothing shows while the page is still being marked.
 */
export function needsFallback({ marks, results, page }) {
  const text = marks?.get(page);
  if (!text) return true;
  const last = results.get(page);
  return last?.text === text && last.result !== 'exact';
}
