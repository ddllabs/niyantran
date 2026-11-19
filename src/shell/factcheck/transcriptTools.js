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

/** YYYY-MM-DD from an ISO date or timestamp string, or the local day of a Date; '' for anything else. */
export function dateStamp(date) {
  if (typeof date === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(date);
    return m ? m[1] : '';
  }
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }
  return '';
}

/**
 * The text of a transcript: the title and date (when known), a blank line, then each line in order with its
 * time mark in square brackets. `lines` are { time?, text }. `header: false` gives the lines alone.
 */
export function buildTranscriptText({ title = '', date = '', lines, header = true }) {
  const body = lines.map((l) => (l.time ? `[${l.time}] ${l.text}` : l.text));
  const head = header ? [String(title || '').trim(), dateStamp(date)].filter(Boolean) : [];
  return `${[...head, ...(head.length ? [''] : []), ...body].join('\n')}\n`;
}

/** <prefix>-<title>-<date>.txt with anything unsafe for a file name turned into a hyphen. */
export function transcriptFileName({ title = '', date = '', prefix = 'transcript' } = {}) {
  const slug = nfc(title).replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  const stamp = dateStamp(date);
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
