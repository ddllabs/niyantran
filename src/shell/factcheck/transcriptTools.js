// B2: pure helpers for searching, copying and downloading the transcript text the panel already holds.
// Nothing here makes a request. The browser hooks (clipboard, download) take their environment as an
// argument so they can be tested and so a missing API is a plain failure, never a crash.

const nfc = (s) => String(s ?? '').normalize('NFC');
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern for a typed phrase (case-blind, Unicode-aware, spaces match any run of spaces), or null when blank. */
function patternFor(query, flags) {
  const phrase = nfc(query).trim();
  if (!phrase) return null;
  const source = phrase.split(/\s+/).map(escapeRegex).join('\\s+');
  return new RegExp(source, flags);
}

/** The lines whose text holds the phrase; every line (the same array) when the phrase is blank. */
export function matchLines(lines, query) {
  const re = patternFor(query, 'iu');
  if (!re) return lines;
  return lines.filter((l) => re.test(nfc(l.text)));
}

/** A line split into { text, hit } parts so the matching text can be marked. Parts join back to the NFC text. */
export function highlightParts(text, query) {
  const full = nfc(text);
  const re = patternFor(query, 'giu');
  if (!re) return [{ text: full, hit: false }];
  const parts = [];
  let at = 0;
  for (const m of full.matchAll(re)) {
    if (m[0] === '') continue;
    if (m.index > at) parts.push({ text: full.slice(at, m.index), hit: false });
    parts.push({ text: m[0], hit: true });
    at = m.index + m[0].length;
  }
  if (at < full.length || parts.length === 0) parts.push({ text: full.slice(at), hit: false });
  return parts;
}

/**
 * One clean line from untrusted text: control characters, new lines, and line and paragraph separators become
 * spaces; format characters (bidi overrides and isolates, zero-width characters, a BOM) are removed, so the text
 * cannot start a new line or reverse what follows it. ZWJ and ZWNJ stay only between two letters or marks,
 * where Devanagari conjuncts and Persian need them (without the ZWJ in "क्‍ष" the half form is lost).
 */
export function cleanLine(value) {
  return nfc(value)
    .replace(/((?<=[\p{L}\p{M}])[\u200C\u200D](?=[\p{L}\p{M}]))|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (m, kept) => {
      if (kept) return kept; // a ZWJ or ZWNJ between two letters or marks
      return /\p{Cf}/u.test(m) ? '' : ' ';
    })
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * YYYY-MM-DD: a bare date as it is, a timestamp or Date as its LOCAL day (the day on screen), or the day in
 * `timeZone` when one is given (tests; "Asia/Kolkata"). '' for anything else.
 */
export function dateStamp(date, timeZone = undefined) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = date instanceof Date ? date : typeof date === 'string' ? new Date(date) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * The text of a transcript: the title and date (when known), a blank line, then each line in order with its
 * time mark in square brackets. `lines` are { time?, text }. `header: false` gives the lines alone. Every piece
 * is cleaned, so a line holding a new line cannot pass for a time-marked line of its own.
 */
export function buildTranscriptText({ title = '', date = '', lines, header = true, timeZone = undefined }) {
  const body = lines.map((l) => {
    const text = cleanLine(l.text);
    const time = cleanLine(l.time);
    return time ? `[${time}] ${text}` : text;
  });
  const head = header ? [cleanLine(title), dateStamp(date, timeZone)].filter(Boolean) : [];
  return `${[...head, ...(head.length ? [''] : []), ...body].join('\n')}\n`;
}

/** <prefix>-<title>-<date>.txt with anything unsafe for a file name turned into a hyphen. */
export function transcriptFileName({ title = '', date = '', prefix = 'transcript', timeZone = undefined } = {}) {
  const slug = Array.from(nfc(title).replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')).slice(0, 60).join('').replace(/-+$/g, '');
  const stamp = dateStamp(date, timeZone);
  const name = [prefix, slug, stamp].filter(Boolean).join('-');
  return `${name}.txt`;
}

/** Writes text to the clipboard; true when the browser accepted it, false for any refusal or missing API. */
export async function copyToClipboard(text, clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined) {
  try {
    if (!clipboard || typeof clipboard.writeText !== 'function') return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Saves text as a UTF-8 .txt file made in the browser; true when the link was clicked, false otherwise. */
export function downloadTextFile(name, text, env = {
  document: typeof document !== 'undefined' ? document : undefined,
  URL: typeof URL !== 'undefined' ? URL : undefined,
  Blob: typeof Blob !== 'undefined' ? Blob : undefined,
}) {
  let href = null;
  try {
    const { document: doc, URL: url, Blob: BlobCtor } = env;
    if (!doc || !url || !BlobCtor) return false;
    href = url.createObjectURL(new BlobCtor([text], { type: 'text/plain;charset=utf-8' }));
    const a = doc.createElement('a');
    a.href = href;
    a.download = name;
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove?.();
    return true;
  } catch {
    return false;
  } finally {
    if (href) setTimeout(() => { try { env.URL.revokeObjectURL(href); } catch { /* nothing to free */ } }, 1000);
  }
}
