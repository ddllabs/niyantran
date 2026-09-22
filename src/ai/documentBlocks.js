// The reader's view of a document (RAG spec §H): how it is segmented, and how
// much of it is laid out at once. Pure, so both are testable without a DOM.
//
// The segmentation. The chunker cut this document into heading, table and
// paragraph blocks; the reader shows the same document, so it has to see the
// same blocks or a citation's highlight lands in the wrong one. blocks() is
// therefore imported from the chunker rather than mirrored the way
// textNormalise is — there is one implementation and it cannot drift.
//
// Two things the reader needs and the chunker does not:
//
//   gaps    blocks() walks past blank-line runs, because no chunk ever contains
//           one. The reader renders the whole document, so every character
//           between two blocks comes back as a 'gap' block. Concatenating every
//           block's slice therefore reproduces ocr_text exactly, and that is
//           what lets the reader slice a character-exact highlight out of one
//           block instead of out of the whole string.
//
//   tables  the chunker calls a line a table only when it starts with '|', so a
//           stored HTML table — 1,845 chunks carry one, and it starts with '<' —
//           lands in a 'para' block. The reader relabels those blocks 'table' so
//           RichText renders them. Relabelling moves no boundary, so the
//           segmentation itself is still the chunker's.

import { blocks } from '../../supabase/functions/_shared/chunking.ts';

/**
 * @typedef {'heading' | 'table' | 'para' | 'gap'} BlockKind
 * @typedef {{ kind: BlockKind, from: number, to: number }} DocumentBlock
 */

/** Stored table markup, as the corpus writes it: `<table border=1 ...>`, and the row tags around it. */
export const HTML_TABLE = /<\s*(?:table|thead|tbody|tfoot|tr|td|th|caption)\b/i;

/**
 * Every character of `ocrText`, in order, as blocks that do not overlap.
 *
 * @param {string} ocrText
 * @returns {DocumentBlock[]}
 */
export function documentBlocks(ocrText) {
  const text = String(ocrText ?? '');
  /** @type {DocumentBlock[]} */
  const out = [];
  let pos = 0;
  for (const block of blocks(text)) {
    if (block.from > pos) out.push({ kind: 'gap', from: pos, to: block.from });
    const html = block.kind === 'para' && HTML_TABLE.test(text.slice(block.from, block.to));
    out.push({ kind: html ? 'table' : block.kind, from: block.from, to: block.to });
    pos = block.to;
  }
  if (pos < text.length) out.push({ kind: 'gap', from: pos, to: text.length });
  return out;
}

/**
 * How much of the document is rendered around the citation. Documents average
 * 18,590 characters, so most of them render whole and no control appears; 30
 * exceed 200k and one is 5.39 MB, and laying those out in full locks the panel.
 * "Show more" doubles the budget, so the rest of a long document is a few
 * presses away.
 */
export const WINDOW_CHARS = 40000;

/**
 * The character range to render: the cited span, plus half the budget on each
 * side. The span itself is never cut, so the range is at most the budget plus
 * the span — and the chunker caps a span at maxChars, 6,000.
 */
export function readerWindow(length, span, budget) {
  const half = Math.floor(budget / 2);
  return {
    from: Math.max(0, span.from - half),
    to: Math.min(length, Math.max(span.from, span.to) + half),
  };
}

/**
 * The blocks that fall in `view`, clipped to it. A table is either rendered
 * whole or not rendered as a table at all — half of a table's markup does not
 * parse — so one that reaches past the window is kept whole while it fits the
 * budget, and beyond that is clipped and reads as text like any other block.
 *
 * @param {DocumentBlock[]} all
 * @param {{ from: number, to: number }} view
 * @param {number} budget
 * @returns {DocumentBlock[]}
 */
export function visibleBlocks(all, view, budget) {
  const out = [];
  for (const block of all) {
    if (block.to <= view.from || block.from >= view.to) continue;
    if (block.kind === 'table' && block.to - block.from <= budget) {
      out.push({ ...block });
      continue;
    }
    const from = Math.max(block.from, view.from);
    const to = Math.min(block.to, view.to);
    out.push({ kind: block.kind === 'table' ? 'para' : block.kind, from, to });
  }
  return out;
}
