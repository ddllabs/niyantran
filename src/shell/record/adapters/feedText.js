/**
 * Plain-text helpers shared by the record adapters that read feed text (F127). Feed and register
 * text is untrusted data: it is kept as a string, never markup, a link or an instruction.
 */

/** A string or number as trimmed text; anything else is ''. */
export const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

/**
 * Control characters (other than whitespace, which is collapsed to a space), the bidirectional marks
 * and overrides, and the zero-width characters that hide or reorder what a reader sees. The joiner and
 * non-joiner (U+200C, U+200D) stay: Indic scripts need them.
 */
const isInvisible = (code) => code <= 8 || (code >= 14 && code <= 31) || (code >= 127 && code <= 159)
  || code === 0x200b || code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e)
  || code === 0x2060 || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff;
const withoutInvisible = (s) => Array.from(s).filter((ch) => !isInvisible(ch.codePointAt(0))).join('');
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };

/**
 * One line of plain text: the few entities feeds leave behind decoded once (never `&lt;` or `&gt;`,
 * so nothing can turn back into markup), invisible characters removed, whitespace collapsed.
 * `stripMarkup` also removes tags, written out or escaped, for feeds whose summaries carry them.
 */
export function plainText(value, { stripMarkup = false } = {}) {
  let s = withoutInvisible(text(value));
  if (stripMarkup) s = s.replace(/&lt;[^&]{0,200}?&gt;/gi, ' ').replace(/<[^>]*>/g, ' ');
  return s
    .replace(/&(?:amp|quot|apos|#39|#x27|nbsp);/gi, (m) => ENTITIES[m.toLowerCase()])
    .replace(/\s+/g, ' ')
    .trim();
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'cum', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
/** Abbreviations that registers write in capitals; title-casing an all-capitals name keeps them. */
const ACRONYMS = new Set(['AIDS', 'AYUSH', 'BSF', 'CBI', 'CRPF', 'DNA', 'GST', 'HIV', 'IIT', 'IIM', 'ITBP', 'NCT', 'NEET', 'RBI', 'SEBI', 'SIM', 'UGC', 'UPSC']);
/** A roman numeral with an optional letter suffix ("VIIB", "XIV-B"), as Chapters, Parts and Schedules are numbered. */
const ROMAN = /^(?=[IVXLC])(?:X[CL]|L?X{0,3})(?:I[XV]|V?I{0,3})[A-D]?$/;

/**
 * A register name for display. A name the source writes in mixed case ("The ASHA Workers Bill",
 * "Chapter VIIB") is printed exactly as written. Only a name written entirely in capitals
 * ("MICRO, SMALL AND MEDIUM ENTERPRISES") is title-cased, keeping small words lower case and known
 * abbreviations and roman numerals in capitals.
 */
export function titleCaseCaps(value) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /[a-z]/.test(s)) return s;
  return s.replace(/[A-Za-z0-9][A-Za-z0-9'’]*/g, (w, i) => {
    // A token with a digit ("371A", "2026") is a number or a numbered item: kept as written.
    if (/\d/.test(w) || ACRONYMS.has(w) || (w.length > 1 && ROMAN.test(w))) return w;
    const lower = w.toLowerCase();
    return i > 0 && SMALL_WORDS.has(lower) ? lower : lower[0].toUpperCase() + lower.slice(1);
  });
}
