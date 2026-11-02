/**
 * Title guard (F281): does a document open with the words of its own title?
 *
 * The corpus built a Bill's title and key from the sansad listing record but took its text from the
 * file behind the record's link. Where two records point at one file, or an LS/RS file number is
 * reused, the stored text belongs to a different bill (docs/research/2026-11-01-f281-broken-documents.md,
 * section 3). This pure check catches that: the title's significant words must appear near the start
 * of the text, and the first of them must not sit behind a long run of foreign opening (a stray cover
 * page). It is a guard for ingestion and for repairs, not a classifier: it reports its evidence.
 *
 * No I/O, no dependencies; safe in the browser bundle and in Node scripts.
 */

/** Words that carry no identity in a Bill title, or occur in almost every bill's opening. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'under', 'upon', 'other', 'others', 'certain', 'further', 'regarding',
  'bill', 'bills', 'act', 'acts', 'amendment', 'amendments', 'amend',
  'etc', 'new', 'art', 'article', 'articles', 'section', 'sections', 'clause', 'clauses', 'insertion', 'inserting', 'substitution',
]);

/** A gazette heading legitimately precedes the title of a Bill printed in the Gazette of India. */
const GAZETTE_PREAMBLE = /gazette of india|extraordinary|published by authority|registered no/;

const DEFAULTS = Object.freeze({
  /** Characters of text examined when no chunks are given: about the first two chunks (CHUNK.targetChars is 1000). */
  headChars: 2000,
  /** Chunks examined when `chunks` is given. */
  headChunks: 2,
  /**
   * The first matched word may follow at most this many non-whitespace characters of other text.
   * Layout-extracted text pads lines with hundreds of spaces, so whitespace is not counted. Measured on
   * the 2026-11-01 replica (2,896 Bills): 98% of titles start within 100 such characters; the two known
   * stray covers (7fd68cf2, 40b1cec9) sit at 192 and 195.
   */
  maxLead: 150,
  /** Share of the title's significant words that may be absent: one in four. */
  maxMissingShare: 0.25,
  /** A title word at least this long may differ from a text word by one letter (OCR noise). */
  fuzzyMinLength: 6,
});

/**
 * Lower-case, accent-stripped text with every character mapped back to its offset in `text`.
 * A hyphen at the end of a line (or a soft hyphen) joins the word across the break.
 * Everything else is kept as is; word splitting is the caller's job.
 */
function fold(text) {
  let s = '';
  const at = [];
  const src = String(text ?? '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '­') continue;
    if (ch === '-') {
      const m = /^[ \t]*\r?\n[ \t]*/.exec(src.slice(i + 1));
      if (m && /\p{L}/u.test(src[i - 1] ?? '') && /\p{L}/u.test(src[i + 1 + m[0].length] ?? '')) {
        i += m[0].length;
        continue;
      }
    }
    const base = ch.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    for (const c of base) {
      s += c;
      at.push(i);
    }
  }
  return { s, at };
}

/** Alphanumeric runs of the folded text with the offset (in the source) of each run's first character. */
function tokens(folded) {
  const out = [];
  const re = /[\p{L}\p{N}]+/gu;
  for (let m = re.exec(folded.s); m; m = re.exec(folded.s)) out.push({ word: m[0], at: folded.at[m.index] });
  return out;
}

/**
 * The words of a title that identify it: lower case, in order, without repeats. Dropped: stop words,
 * "bill", "amendment", years and any token holding a digit (file-name style fragments such as 2833LS),
 * and fragments shorter than three letters.
 */
export function significantWords(title) {
  const seen = new Set();
  const out = [];
  for (const { word } of tokens(fold(title))) {
    if (word.length < 3 || /\p{N}/u.test(word) || STOP_WORDS.has(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** The word and its plain singular/plural variants, so "universities" meets "university". */
function forms(word) {
  const out = new Set([word]);
  if (word.length > 4 && word.endsWith('ies')) out.add(`${word.slice(0, -3)}y`);
  if (word.length > 3 && word.endsWith('es')) out.add(word.slice(0, -2));
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) out.add(word.slice(0, -1));
  if (word.length > 3 && word.endsWith('y')) out.add(`${word.slice(0, -1)}ies`);
  if (word.length > 3 && !word.endsWith('s')) out.add(`${word}s`);
  return out;
}

/** Whether the Levenshtein distance between a and b is at most one. */
function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/** Offset in the source of the first token that matches `word`, or -1. */
function firstOccurrence(word, headTokens, fuzzyMinLength) {
  const wanted = forms(word);
  for (const t of headTokens) {
    for (const f of forms(t.word)) if (wanted.has(f)) return t.at;
  }
  if (word.length >= fuzzyMinLength) {
    for (const t of headTokens) {
      if (t.word.length > word.length && t.word.includes(word)) return t.at; // glued by the OCR
      if (withinOneEdit(word, t.word)) return t.at;
    }
  }
  return -1;
}

/**
 * Does `text` open with the words of `title`?
 *
 * The examined part is the first `headChunks` entries of `options.chunks` (chunk contents in order)
 * when that array is given, else the first `headChars` characters of `text`.
 *
 * Returns { ok, checked, reasons, words, matched, missing, firstMatchAt }:
 *  - words: the title's significant words (see significantWords); matched and missing split them.
 *  - ok is false when more than `maxMissingShare` of the words are missing ('missing_words'), or when
 *    the first matched word follows more than `maxLead` non-whitespace characters of other text
 *    ('late_start': a foreign cover or header ahead of the real opening). A Gazette of India heading
 *    ahead of the title is not a foreign cover and does not raise late_start.
 *  - checked is false when the title has no significant word; the guard cannot judge it and ok is true.
 *  - firstMatchAt is that distance in non-whitespace characters, or null when nothing matched.
 */
export function titleMatches(title, text, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const head = Array.isArray(o.chunks) ? o.chunks.slice(0, o.headChunks).join('\n') : String(text ?? '').slice(0, o.headChars);
  const words = significantWords(title);
  if (!words.length) return { ok: true, checked: false, reasons: [], words, matched: [], missing: [], firstMatchAt: null };

  const headTokens = tokens(fold(head));
  const origin = headTokens.length ? headTokens[0].at : 0;
  const matched = [];
  const missing = [];
  let first = Infinity;
  for (const word of words) {
    const at = firstOccurrence(word, headTokens, o.fuzzyMinLength);
    if (at < 0) {
      missing.push(word);
    } else {
      matched.push(word);
      first = Math.min(first, at);
    }
  }

  const reasons = [];
  if (missing.length / words.length > o.maxMissingShare) reasons.push('missing_words');
  // HTML an OCR leaves in front of a title (an image box in a div) is markup, not foreign text.
  const before = matched.length ? head.slice(origin, first).replace(/<[^>]*>/g, '') : '';
  const firstMatchAt = matched.length ? before.replace(/\s+/g, '').length : null;
  if (firstMatchAt !== null && firstMatchAt > o.maxLead && !GAZETTE_PREAMBLE.test(before.toLowerCase())) reasons.push('late_start');
  return { ok: reasons.length === 0, checked: true, reasons, words, matched, missing, firstMatchAt };
}
