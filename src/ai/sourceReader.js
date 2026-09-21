// The reader's staleness check (RAG spec §H). A citation carries a character
// span and the hash of the passage as it was when cited. Before highlighting,
// recompute the hash over the stored document:
//   equal          → 'exact'   highlight [char_from, char_to)
//   moved          → 'moved'   the cited text still exists elsewhere; highlight there
//   gone           → 'changed' show the top of the document with a notice
// A citation therefore never silently shows the wrong passage.

import { normalise, sha256Hex } from '../lib/textNormalise.js';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find `citedText` in `text` exactly, or with any whitespace run treated as equal. */
export function findPassage(text, citedText) {
  const needle = String(citedText ?? '');
  if (!needle.trim()) return null;
  const exact = text.indexOf(needle);
  if (exact >= 0) return { from: exact, to: exact + needle.length };
  const pattern = normalise(needle).split(' ').map(escapeRegExp).join('\\s+');
  const m = new RegExp(pattern).exec(text);
  return m ? { from: m.index, to: m.index + m[0].length } : null;
}

/**
 * @param {string} ocrText   the document as stored now
 * @param {{ char_from: number, char_to: number, text_hash: string }} citation
 * @param {string} [citedText]   the chunk content as it was when cited, when still known
 * @returns {Promise<{ from: number, to: number, status: 'exact' | 'moved' | 'changed' }>}
 */
export async function resolveSpan(ocrText, citation, citedText) {
  const text = String(ocrText ?? '');
  const from = Number(citation.char_from) || 0;
  const to = Number(citation.char_to) || 0;
  const slice = text.slice(from, to);
  if (slice && (await sha256Hex(normalise(slice))) === citation.text_hash) return { from, to, status: 'exact' };
  const found = citedText ? findPassage(text, citedText) : null;
  if (found && (await sha256Hex(normalise(text.slice(found.from, found.to)))) === citation.text_hash) {
    return { ...found, status: 'moved' };
  }
  return { from: 0, to: 0, status: 'changed' };
}

export const NOTICE = {
  exact: '',
  moved: 'This passage moved since it was cited; it is highlighted at its current position.',
  changed: 'This passage has changed since it was cited. The document is shown from the top.',
};
