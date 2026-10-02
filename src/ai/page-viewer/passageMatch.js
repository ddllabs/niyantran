/**
 * Finding a cited passage's exact words in a PDF page's text layer
 * (docs/specs/2026-10-02-viewer-continuous.md, section 3). Pure functions.
 *
 * The passage comes from the stored page text, which is OCR Markdown (`# headings`, `**bold**`,
 * tables of `|` cells that pull margin notes into the body); the text layer is the PDF's own text,
 * in its own order, with line numbers in the margins. So both are reduced to words, and the passage
 * is located by anchors and accepted on ordered coverage rather than matched as a string.
 */

const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const TAG = /<[^>]+>/g;
const INVISIBLE = /[​-‍﻿]/g;
const HYPHEN_AT_LINE_END = /(\p{L})-[ \t]*\r?\n\s*(\p{L})/gu;
/** A word: letters, digits and combining marks (Devanagari vowel signs and viramas). */
const WORD = /[\p{L}\p{N}\p{M}]+/gu;

const fold = word => word.normalize('NFC').toLowerCase();

/**
 * The stored text's words, lower-cased, without Markdown syntax, images, link targets, tags or
 * punctuation; a word hyphenated across a line end is joined.
 * @returns {{word: string}[]}
 */
export function passageWords(text) {
  if (typeof text !== 'string' || !text) return [];
  const clean = text
    .replace(INVISIBLE, '')
    .replace(IMAGE, ' ')
    .replace(LINK, '$1')
    .replace(TAG, ' ')
    .replace(HYPHEN_AT_LINE_END, '$1$2');
  return [...clean.matchAll(WORD)].map(m => ({ word: fold(m[0]) }));
}

/**
 * The text layer's words, each with where it lies: from `from` in item `item` to `to` in item
 * `endItem` (the same item unless the word was hyphenated across a line end). Items are pdf.js
 * text content items, `{str, hasEOL}`, in the order the text layer renders them as spans.
 * @returns {{word: string, item: number, from: number, endItem: number, to: number}[]}
 */
export function layerWords(items) {
  const list = Array.isArray(items) ? items : [];
  const starts = [];
  let joined = '';
  for (const it of list) {
    starts.push(joined.length);
    joined += String(it?.str ?? '').replace(INVISIBLE, ' ') + (it?.hasEOL ? '\n' : '');
  }
  const locate = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return { item: lo, at: offset - starts[lo] };
  };
  const raw = [...joined.matchAll(WORD)].map(m => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    let { text, end } = raw[i];
    const { start } = raw[i];
    const next = raw[i + 1];
    if (next && joined[end] === '-' && /^-[ \t]*\r?\n\s*$/.test(joined.slice(end, next.start))) {
      text += next.text;
      end = next.end;
      i += 1;
    }
    const a = locate(start);
    const b = locate(end - 1);
    out.push({ word: fold(text), item: a.item, from: a.at, endItem: b.item, to: b.at + 1 });
  }
  return out;
}

const ANCHOR = 5;
const SHORT_ANCHOR = 3;
const MIN_COVERAGE = 0.8;
/** A share of the passage that may be missing at either end before an anchor is found. */
const ANCHOR_SLACK = 0.2;

const sameAt = (layer, at, words) => words.every((w, i) => layer[at + i] === w);

function occurrences(layer, words) {
  const found = [];
  for (let i = 0; i + words.length <= layer.length; i += 1) if (sameAt(layer, i, words)) found.push(i);
  return found;
}

/** The longest common subsequence of `a` and a window of `b`, in one rolling row. */
function commonLength(a, b, from, to) {
  const row = new Array(to - from + 2).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    let diagonal = 0;
    for (let j = from; j <= to; j += 1) {
      const k = j - from + 1;
      const above = row[k];
      row[k] = a[i] === b[j] ? diagonal + 1 : Math.max(row[k], row[k - 1]);
      diagonal = above;
    }
  }
  return row[to - from + 1];
}

/**
 * Where the passage lies in the layer: `{start, end, coverage}` as layer word indices (inclusive),
 * or null. The passage is located by an anchor near its start and one near its end (5 words, or 3
 * for a short passage; any within the first and last fifth of the passage), and the best window
 * between a start and an end anchor wins.
 * The window between them is accepted when it holds at least 80% of the passage's words in order,
 * and is not much longer than the passage.
 *
 * @param {{word: string}[]} passage
 * @param {{word: string}[]} layer
 */
export function locatePassage(passage, layer) {
  const p = (Array.isArray(passage) ? passage : []).map(w => w.word);
  const l = (Array.isArray(layer) ? layer : []).map(w => w.word);
  if (!p.length || !l.length) return null;

  if (p.length < 2 * SHORT_ANCHOR) {
    const at = occurrences(l, p)[0];
    return at === undefined ? null : { start: at, end: at + p.length - 1, coverage: 1 };
  }

  const k = p.length >= 2 * ANCHOR ? ANCHOR : SHORT_ANCHOR;
  const slack = Math.floor(p.length * ANCHOR_SLACK);
  // Every anchor within the slack, not just the first found: a passage can begin or end with a
  // margin note that OCR folded into the body, whose words the PDF keeps in its side column.
  const starts = new Set();
  const ends = new Set();
  for (let s = 0; s <= slack; s += 1) for (const i of occurrences(l, p.slice(s, s + k))) starts.add(i);
  for (let e = p.length; e >= p.length - slack; e -= 1) for (const i of occurrences(l, p.slice(e - k, e))) ends.add(i + k - 1);
  const longest = Math.ceil(1.5 * p.length) + 20;

  let best = null;
  for (const start of starts) {
    for (const end of ends) {
      if (end < start || end - start + 1 > longest) continue;
      const coverage = commonLength(p, l, start, end) / p.length;
      const better = !best || coverage > best.coverage || (coverage === best.coverage && end - start < best.end - best.start);
      if (better) best = { start, end, coverage };
    }
  }
  return best && best.coverage >= MIN_COVERAGE ? best : null;
}
