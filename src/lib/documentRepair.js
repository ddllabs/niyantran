/**
 * Repairs for broken corpus documents (open-work F281).
 * Investigation: docs/research/2026-11-01-f281-broken-documents.md. Tool: scripts/f281-repair/.
 *
 * Pure functions only: no I/O, no network, no clock. The tool reads PDFs, calls OCR and posts to
 * ingest-documents; everything it decides about text and payloads is decided here, where it is tested.
 *
 *  - decodeShiftedText: two Bills whose PDF text layer is the glyph-ID numbering of an embedded font
 *    (glyph ID = ASCII - 29, no ToUnicode map). assertNoControlCodes is the guard that fails on the
 *    stored text and passes on the decoded one.
 *  - stripLeadingForeignCover: a Bill whose stored text opens with another bill's cover page.
 *  - ocrPagesToText / ocrChecks: scanned documents re-read with Mistral OCR, and the aids for the eye check.
 *  - buildRepairPayload: the ingest-documents payload for one repaired document (text repairs, re-key,
 *    retitle_unlink: a new title and the document leaves the desk, and retitle: a new title for a document
 *    that has no key).
 *  - extractPrintedTitle, chooseTitle: the title a re-keyed or unlinked document gets.
 */

// The worker's own page composition (tables inlined, running headers dropped, pages joined by a blank
// line), so OCR text is stored the way the page pipeline composes it. Same import pattern as
// src/ai/documentBlocks.js, which reads chunking.ts.
import { composeDocument, PAGE_SEPARATOR } from '../../supabase/functions/_shared/pageText.ts';

export const REPAIR_TICKET = 'F281';

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

/** SHA-256 of the UTF-8 text, lower-case hex: what ingest-documents compares text_sha256 with. */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Unicode code points: what n_chars counts (the archive's Python length), not UTF-16 units. */
export function codePointLength(text) {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Shifted text (fb64d5ac, 1f1ce52a)
// ---------------------------------------------------------------------------------------------

/**
 * Glyph codes that fall outside the +29 range in the Times New Roman subsets of the two PDFs. pdf.js
 * reports glyph ID = code point for a font with no ToUnicode map. Each was fixed by the glyph's advance
 * width in the PDF and checked against a rendering of the page (the report's section 4 had only
 * guessed them from context): 500 = en dash, 1000 = em dash, 444 = double quotes, 333 = single quotes.
 * Measured on these two files only; a code not listed here is reported, never guessed.
 */
export const GLYPH_TABLE = Object.freeze({
  '±': '–',
  '²': '—',
  '³': '“',
  '´': '”',
  'µ': '‘',
  'μ': '‘',
  '¶': '’',
  'ʊ': '—',
});

/** Everything below U+0020 except tab, line feed and carriage return; and DEL. */
const isControl = (code) => (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;

export function countControlCodes(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (isControl(text.charCodeAt(i))) n++;
  return n;
}

/**
 * The guard for shifted text. A glyph-ID extraction of Latin text is full of control codes (the space
 * is 0x03), clean text has none. Throws, naming the count and the first offsets, never the text.
 */
export function assertNoControlCodes(text) {
  const s = String(text);
  const first = [];
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (!isControl(code)) continue;
    n++;
    if (first.length < 5) first.push(`${i} (U+${code.toString(16).padStart(4, '0')})`);
  }
  if (n) throw new Error(`text holds ${n} control code(s) (glyph codes, not characters); first at offset ${first.join(', ')}`);
}

function classifyFonts(pages, hints) {
  const stats = new Map();
  for (const page of pages) {
    for (const it of page) {
      const s = stats.get(it.fontName) ?? { font: it.fontName, chars: 0, controls: 0 };
      s.chars += it.str.length;
      for (const ch of it.str) if (ch.codePointAt(0) < 0x20) s.controls++;
      stats.set(it.fontName, s);
    }
  }
  const fonts = [...stats.values()].map((s) => {
    const share = s.chars ? s.controls / s.chars : 0;
    const strong = (s.controls >= 2 && share >= 0.03) || (s.controls >= 1 && share >= 0.5);
    return {
      font: s.font,
      name: hints[s.font]?.name ?? null,
      composite: typeof hints[s.font]?.composite === 'boolean' ? hints[s.font].composite : null,
      chars: s.chars,
      controls: s.controls,
      verdict: strong ? 'shifted' : 'plain',
      reason: strong ? 'control_codes' : null,
    };
  });
  // The producer wrote every Type 0 font of the file the same way. A small one may hold no space or digit,
  // so no control code, yet be shifted too (the "F" of "105-F"): follow its siblings.
  if (fonts.some((f) => f.verdict === 'shifted')) {
    for (const f of fonts) {
      if (f.verdict === 'plain' && f.composite === true) Object.assign(f, { verdict: 'shifted', reason: 'composite_sibling' });
    }
  }
  return fonts;
}

function decodeRun(str, unmapped) {
  let out = '';
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c === 1 || c === 2) continue; // .null and nonmarkingreturn: no mark on the page
    else if (c >= 3 && c <= 0x61) out += String.fromCharCode(c + 29); // 0x03 is the space, 0x0b and 0x0c the brackets, 0x20 the equals sign
    else if (GLYPH_TABLE[ch]) out += GLYPH_TABLE[ch];
    else {
      unmapped[ch] = (unmapped[ch] ?? 0) + 1;
      out += '\ufffd';
    }
  }
  return out;
}

function pageToText(page, fontVerdict, unmapped, { yTolerance, maxGap, spaceFactor }) {
  const lines = [];
  let cur = null;
  for (const it of page) {
    const text = fontVerdict.get(it.fontName) === 'shifted' ? decodeRun(it.str, unmapped) : it.str;
    // A new line where y changes, or where a run starts far to the right of where the last one ended on
    // the same baseline (a margin note beside the body text).
    const gap = cur && Number.isFinite(it.x) && Number.isFinite(cur.endX) ? it.x - cur.endX : 0;
    if (!cur || gap > maxGap || Math.abs(it.y - cur.y) > yTolerance) {
      cur = { y: it.y, parts: [], endX: it.endX };
      lines.push(cur);
    } else {
      // Word spaces are gaps, not glyphs, in most of these files (Word positions words with TJ numbers).
      if (Number.isFinite(it.size) && gap > spaceFactor * it.size) cur.parts.push(' ');
      if (Number.isFinite(it.endX)) cur.endX = it.endX;
    }
    cur.parts.push(text);
  }
  const rows = lines
    .map((l) => ({ y: l.y, text: l.parts.join('').replace(/[ \t]{2,}/g, ' ').trim() }))
    .filter((l) => l.text);
  // A gap well above the page's usual line pitch (its lower quartile) is a paragraph break.
  const pitches = rows.slice(1).map((r, i) => rows[i].y - r.y).filter((p) => p > 0).sort((a, b) => a - b);
  const base = pitches.length ? pitches[Math.floor((pitches.length - 1) * 0.25)] : Infinity;
  return rows.map((r, i) => (i > 0 && rows[i - 1].y - r.y > base * 1.6 ? `\n${r.text}` : r.text)).join('\n');
}

/**
 * Text of a PDF whose fonts have no ToUnicode map, rebuilt from its per-font text runs.
 *
 * `pages` is one array of runs per page: { str, fontName, y, x?, endX?, size? } in content order, `str` holding
 * each glyph's raw code (scripts/f281-repair/pdfRuns.mjs reads them from the operator list, because
 * getTextContent turns glyph IDs 9 to 13, the characters & ' ( ) *, into spaces). `options.fonts` may
 * carry { [fontName]: { name?, composite? } } from the font objects. Returns { text, fonts, unmapped }:
 *  - a font is shifted when control codes make up its text (see classifyFonts), or when it is a Type 0
 *    sibling of one that is. Its codes are decoded by +29, the table above, or reported in `unmapped`.
 *  - a new line starts where y changes, or where a run begins more than `maxGap` to the right of the end
 *    of the previous one; a smaller gap, above `spaceFactor` times the font size, is a word space; a larger
 *    vertical gap makes a blank line; pages are separated by one.
 * The caller must run assertNoControlCodes on the result and refuse a non-empty `unmapped`.
 */
export function decodeShiftedText(pages, { fonts: hints = {}, yTolerance = 2, maxGap = 50, spaceFactor = 0.15 } = {}) {
  const fonts = classifyFonts(pages, hints);
  const verdict = new Map(fonts.map((f) => [f.font, f.verdict]));
  const unmapped = {};
  const texts = pages.map((page) => pageToText(page, verdict, unmapped, { yTolerance, maxGap, spaceFactor })).filter(Boolean);
  return { text: texts.join('\n\n'), fonts, unmapped };
}

// ---------------------------------------------------------------------------------------------
// Foreign cover (7fd68cf2)
// ---------------------------------------------------------------------------------------------

/**
 * Removes everything before `marker`, which must occur exactly once. Refuses when it is missing, repeated,
 * at the very start, or so far in that the cut would be more than `maxRemoved` characters: a wrong marker
 * must not eat a document. Returns { text, removed } (the marker stays in `text`).
 */
export function stripLeadingForeignCover(text, marker, { maxRemoved = 500 } = {}) {
  if (typeof marker !== 'string' || !marker) throw new Error('stripLeadingForeignCover: a non-empty marker is required');
  const at = [];
  for (let i = text.indexOf(marker); i >= 0; i = text.indexOf(marker, i + 1)) at.push(i);
  if (!at.length) throw new Error('stripLeadingForeignCover: marker not found');
  if (at.length > 1) throw new Error(`stripLeadingForeignCover: marker appears ${at.length} times; it must be unique`);
  if (at[0] === 0) throw new Error('stripLeadingForeignCover: marker is at the start; nothing to strip');
  if (at[0] > maxRemoved) throw new Error(`stripLeadingForeignCover: the cut would remove ${at[0]} characters, above maxRemoved (${maxRemoved})`);
  return { text: text.slice(at[0]), removed: text.slice(0, at[0]) };
}

// ---------------------------------------------------------------------------------------------
// OCR text
// ---------------------------------------------------------------------------------------------

const IMAGE_PLACEHOLDER = /!\[img:\d+-\d+\]\(img:\d+-\d+\)/g;

/**
 * Mistral OCR pages (the response's `pages`) to the text a document stores, plus what to look at.
 *
 * Composition is the worker's own (composeDocument, supabase/functions/_shared/pageText.ts, as used by
 * ingest-worker/index-step.ts:77): tables inlined, running headers and footers dropped, other header and
 * footer lines put back, pages joined by a blank line. One difference: the page pipeline keeps image
 * placeholders because it stores the images; these legacy documents have no image store, so the
 * placeholders are removed unless `keepImages`. Refuses a response that is not every page from index 0.
 * Returns { text, pages, emptyPages (1-based), unresolvedTables, imagesRemoved }.
 */
export function ocrPagesToDocument(pages, { keepImages = false, expectedPages = null } = {}) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('OCR response has no pages');
  const indexes = pages.map((p) => p?.index);
  if (indexes.some((i) => !Number.isInteger(i) || i < 0) || pages.some((p) => typeof p.markdown !== 'string')) {
    throw new Error('OCR response has a page without an integer index or markdown');
  }
  const sorted = [...indexes].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1]) throw new Error(`OCR response has a duplicate page index ${sorted[i]}`);
  if (sorted.some((v, i) => v !== i)) throw new Error(`OCR pages are not contiguous from 0: got ${sorted.join(',')}`);
  if (expectedPages !== null && pages.length !== expectedPages) throw new Error(`OCR response has ${pages.length} pages, expected ${expectedPages} pages`);

  const composed = composeDocument(pages);
  let imagesRemoved = 0;
  const texts = composed.pages.map((p) => {
    if (keepImages || !IMAGE_PLACEHOLDER.test(p.text)) return p.text;
    IMAGE_PLACEHOLDER.lastIndex = 0;
    const stripped = p.text.replace(IMAGE_PLACEHOLDER, () => (imagesRemoved++, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return stripped;
  });
  IMAGE_PLACEHOLDER.lastIndex = 0;
  return {
    text: texts.join(PAGE_SEPARATOR),
    pages: composed.pages,
    emptyPages: texts.flatMap((t, i) => (t === '' ? [composed.pages[i].page_number] : [])),
    unresolvedTables: composed.unresolvedTables,
    imagesRemoved,
  };
}

/** ocrPagesToDocument's text. Refuses an unresolved table placeholder unless `allowUnresolvedTables`. */
export function ocrPagesToText(pages, options = {}) {
  const d = ocrPagesToDocument(pages, options);
  if (d.unresolvedTables.length && !options.allowUnresolvedTables) {
    throw new Error(`OCR text has ${d.unresolvedTables.length} unresolved table placeholder(s), first ${d.unresolvedTables[0].id} on page ${d.unresolvedTables[0].page_number}`);
  }
  return d.text;
}

const NUMBERED_PARAGRAPH = /^[#>*_\s]*(\d{1,3}(?:\.\d{1,3}){0,4})\.?\*{0,2}\s+(?=[\p{Lu}("'“‘[])/u;

function paragraphChecks(text, maxGap) {
  const numbers = [];
  for (const line of text.split('\n')) {
    const m = NUMBERED_PARAGRAPH.exec(line);
    if (m) numbers.push(m[1]);
  }
  const tops = numbers.map((n) => Number(n.split('.')[0]));
  const distinct = [...new Set(tops)].sort((a, b) => a - b);
  const largeGaps = [];
  for (let i = 1; i < distinct.length; i++) if (distinct[i] - distinct[i - 1] > maxGap) largeGaps.push([distinct[i - 1], distinct[i]]);
  return {
    count: numbers.length,
    numbers,
    first: numbers[0] ?? null,
    last: numbers[numbers.length - 1] ?? null,
    startsAtOne: tops[0] === 1,
    largeGaps,
    contiguous: numbers.length > 0 && largeGaps.length === 0,
  };
}

function scriptChecks(text) {
  const devanagari = (text.match(/\p{Script=Devanagari}/gu) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  // Latin that is not English: no vowel, five consonants in a row, or a capital inside a word. An
  // all-capitals word is an acronym, not noise.
  const looksNoisy = (w) => w !== w.toUpperCase() && (!/[aeiouy]/i.test(w) || /[bcdfghjklmnpqrstvwxz]{5,}/i.test(w) || /[a-z][A-Z]/.test(w));
  const noisy = words.filter(looksNoisy).length;
  return {
    devanagariLetters: devanagari,
    latinLetters: latin,
    devanagariShare: devanagari + latin ? devanagari / (devanagari + latin) : 0,
    latinWords: words.length,
    latinNoiseShare: words.length ? noisy / words.length : 0,
  };
}

/**
 * Aids for the eye check of OCR text (report section 8, step 5); they do not accept or reject.
 *  - every kind: characters, characters per page when `pages` is given, and lowDensity when that is
 *    under 600 (the report's measure of a partial scan).
 *  - 'cci-order': the numbered paragraphs (first, last, whether the first is 1, and whether the leading
 *    numbers run without a jump above `maxGap`).
 *  - 'bilingual-gazette': the share of Devanagari among Devanagari and Latin letters, and the share of
 *    Latin words that do not look like English (a Hindi column read as Latin gibberish scores high).
 */
export function ocrChecks(text, kind = 'any', { pages = null, maxGap = 2, lowDensityPerPage = 600 } = {}) {
  const chars = codePointLength(text);
  const out = {
    kind,
    chars,
    pages: pages ?? null,
    charsPerPage: pages ? Math.round(chars / pages) : null,
    lowDensity: pages ? chars / pages < lowDensityPerPage : null,
  };
  if (kind === 'cci-order') out.paragraphs = paragraphChecks(text, maxGap);
  if (kind === 'bilingual-gazette') out.scripts = scriptChecks(text);
  return out;
}

// ---------------------------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------------------------

/**
 * Throws unless ingest-documents would take a text/metadata replacement for this document and the repair
 * is meant to touch it: a legacy document (no storage_path, no extract_hash), not supplied-text, not
 * section-context, with a plain 40-character corpus source_key rather than an upload, and no link-map
 * ambiguity marker (which would make the server drop the key fields).
 */
export function assertRepairable(existing) {
  const key = existing?.source_key;
  if (typeof key !== 'string' || !key.trim()) throw new Error('document has no source_key');
  if (key.startsWith('upload:')) throw new Error(`source_key ${key.slice(0, 14)}... is an upload (ingestion-v2), not a legacy document`);
  if (existing.storage_path) throw new Error('document has a storage_path: ingestion-v2 owns it');
  if (existing.extract_hash) throw new Error('document has an extract_hash: it is page-aware');
  const metadata = existing.metadata ?? {};
  if (metadata.origin === 'supplied-text') throw new Error('document is supplied-text');
  if (existing.chunker_version === 4 || metadata.text_chunking_mode === 'section_context_v1') throw new Error('document is section-context: it needs the explicit section_context_v1 mode');
  if (metadata.file_url_ambiguous === true) throw new Error('document is marked file_url_ambiguous; the server would clear its key fields');
}

const DOCUMENT_KEY = /^bill:(\d{4}):([A-Za-z0-9]+)$/;

/**
 * The fields the link mapper owns as one unit (ingest-documents handler.ts mergeDocumentMetadata, and
 * docs/specs/2026-09-21-corpus-reconciliation.md). A changed document_key replaces the unit; an explicit
 * file_url_ambiguous = true clears it and writes nothing in its place.
 */
export const LINK_FIELDS = Object.freeze(['document_key', 'bill_number', 'bill_year', 'house', 'status', 'file_url_source']);

/**
 * The ingest-documents document for one repaired document, in the shape scripts/ingest-national-desk.mjs
 * posts: { source_key, title, file_name, file_url, desk_tier, desk_feature, ocr_text, metadata }.
 *
 * `existing` is the documents row as read from NTER. `repair` is { text, action, rekey?, retitle?, provenance? }:
 *  - source_key and the file, desk and metadata fields are carried over unchanged.
 *  - n_chars and text_sha256 are set for the new text: the server checks an incoming claim against the
 *    text, so the old values would be refused.
 *  - action 'rekey' (text unchanged) needs rekey = { document_key, title, house?, status? }. The server
 *    replaces the whole key unit when the key changes, so bill_number and bill_year follow the key here.
 *  - action 'retitle_unlink' (text unchanged) needs retitle = { title }: the document keeps its text, takes
 *    the new title and leaves the desk. The key fields are dropped from the payload and file_url_ambiguous
 *    is set, which makes the server delete them from the stored metadata.
 *  - action 'retitle' (text unchanged) needs retitle = { title }: a document with a file name for a title and no
 *    document_key gets the title and nothing else. No key is added and no link field is touched.
 *  - text_repair records what was done; `provenance` (source URL and hash, OCR model) is merged into it. A repair
 *    that changes the text may also set `metadataUpdates` (for example ocr_lang): the new values replace the old,
 *    and the old ones, with the old n_chars and text_sha256, are kept under text_repair.previous.
 */
export async function buildRepairPayload(existing, repair) {
  assertRepairable(existing);
  const { text, action, rekey = null, retitle = null, provenance = {}, metadataUpdates = null } = repair ?? {};
  if (typeof text !== 'string' || !text.trim()) throw new Error('repair needs a non-empty text');
  if (typeof action !== 'string' || !action) throw new Error('repair needs an action');
  if (action === 'rekey' && !rekey) throw new Error('a rekey repair needs a rekey object');
  if (action !== 'rekey' && rekey) throw new Error(`a rekey object is only for the rekey action, not ${action}`);
  if ((action === 'retitle_unlink' || action === 'retitle') && !retitle) throw new Error(`a ${action} repair needs a retitle object`);
  if (action !== 'retitle_unlink' && action !== 'retitle' && retitle) throw new Error(`a retitle object is only for retitle and retitle_unlink, not ${action}`);

  const metadata = structuredClone(existing.metadata ?? {});
  let title = existing.title;
  const record = { ticket: REPAIR_TICKET, action, ...provenance };
  const assertNoLinks = () => {
    if (Array.isArray(metadata.links) && metadata.links.length) throw new Error('metadata.links names the old key; this tool does not rewrite links');
  };

  if (rekey) {
    const m = DOCUMENT_KEY.exec(String(rekey.document_key ?? ''));
    if (!m) throw new Error(`rekey.document_key must look like bill:2005:96, got ${JSON.stringify(rekey.document_key)}`);
    if (typeof rekey.title !== 'string' || !rekey.title.trim()) throw new Error('rekey needs a title');
    if (rekey.document_key === metadata.document_key) throw new Error(`document already has the key ${rekey.document_key}`);
    assertNoLinks();
    record.previous_document_key = metadata.document_key ?? null;
    record.previous_title = existing.title;
    title = rekey.title;
    metadata.document_key = rekey.document_key;
    metadata.bill_year = m[1];
    metadata.bill_number = m[2];
    if (rekey.house) metadata.house = rekey.house;
    if (rekey.status) metadata.status = rekey.status;
  }

  if (retitle && action === 'retitle') {
    if (typeof retitle.title !== 'string' || !retitle.title.trim()) throw new Error('retitle needs a title');
    // Re-keying a key-less document is the Bills adapter's job, and a keyed one takes its title from the desk.
    if (metadata.document_key) throw new Error(`document has the document_key ${metadata.document_key}; a retitle is for a document with none`);
    if (collapse(retitle.title) === collapse(existing.title)) throw new Error(`document already has the title ${JSON.stringify(existing.title)}`);
    assertNoLinks();
    record.previous_title = existing.title;
    title = collapse(retitle.title);
  } else if (retitle) {
    if (typeof retitle.title !== 'string' || !retitle.title.trim()) throw new Error('retitle needs a title');
    if (!metadata.document_key) throw new Error('document has no document_key to remove');
    assertNoLinks();
    record.previous_document_key = metadata.document_key;
    record.previous_title = existing.title;
    title = retitle.title;
    for (const field of LINK_FIELDS) delete metadata[field];
    metadata.file_url_ambiguous = true;
  }

  if (action !== 'rekey' && action !== 'retitle_unlink' && action !== 'retitle') {
    // The text changes: what described the old text and its source is kept under text_repair.previous.
    const previous = {};
    for (const field of ['n_chars', 'text_sha256']) if (field in metadata) previous[field] = metadata[field];
    for (const [field, value] of Object.entries(metadataUpdates ?? {})) {
      if (field in metadata) previous[field] = metadata[field];
      metadata[field] = value;
    }
    record.previous = previous;
  }

  metadata.n_chars = codePointLength(text);
  metadata.text_sha256 = await sha256Hex(text);
  metadata.text_repair = record;
  return {
    source_key: existing.source_key,
    title,
    file_name: existing.file_name ?? null,
    file_url: existing.file_url ?? null,
    desk_tier: existing.desk_tier ?? null,
    desk_feature: existing.desk_feature ?? null,
    ocr_text: text,
    metadata,
  };
}

// ---------------------------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------------------------

const COMPOUND_NUMBER = /^(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)-(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|one|two|three|four|five|six|seven|eight|nine)$/i;
const SMALL_WORDS = new Set(['of', 'and', 'the', 'in', 'for', 'to', 'on', 'a', 'an', 'by', 'with', 'at', 'or', 'from', 'under', 'into']);
const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * An all-capitals title in the listing's form: "THE CHIT FUNDS (AMENDMENT) ACT, 2001" becomes "The Chit Funds
 * (Amendment) Act, 2001". Small words stay lower case except first or after a bracket; a word with a digit is
 * kept. A title that is not mostly capitals is returned as it is, spaces collapsed.
 */
export function titleCase(title) {
  const t = collapse(title);
  const letters = t.match(/\p{L}/gu) ?? [];
  if (!letters.length || letters.filter((c) => c !== c.toLowerCase()).length / letters.length < 0.6) return t;
  // A compound number keeps its second word in lower case, as the listing writes it: Seventy-third, Ninety-ninth.
  const cap = (w) => (COMPOUND_NUMBER.test(w)
    ? w.split('-').map((p, i) => (i ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('-')
    : w.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-'));
  return t.split(' ').map((word, i) => {
    const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(word);
    if (!m[2] || /\p{N}/u.test(m[2])) return word;
    const lower = m[2].toLowerCase();
    const first = i === 0 || m[1].includes('(');
    return `${m[1]}${SMALL_WORDS.has(lower) && !first ? lower : cap(lower)}${m[3]}`;
  }).join(' ');
}

const TITLE_END = /\b(?:BILL|ACT),?\s*\d{4}/i;

/**
 * The title printed in the first lines of a Bill, Act or synopsis text: a line that starts with "THE" and holds
 * "BILL, <year>" or "ACT, <year>" (the title ends there: what follows, "(ACT 10 OF 2001)", an asterisk or the
 * author, is not part of it), or two lines that together do (a wrapped title). Lines above it (a Bill No., a
 * foreign cover that only mentions another Act, "AS INTRODUCED") are skipped because they do not start with
 * THE. Returned in listing case. Null when no line qualifies in the first `headChars`.
 */
export function extractPrintedTitle(text, { headChars = 1500 } = {}) {
  const lines = String(text ?? '').slice(0, headChars).split('\n')
    .map((l) => collapse(l.replace(/\$[^$]*\$/g, ' ').replace(/^[\s#>*_|]+/, '').replace(/[\s*_|]+$/, '')))
    .filter(Boolean);
  const cut = (t) => {
    const m = TITLE_END.exec(t);
    return m ? titleCase(t.slice(0, m.index + m[0].length)) : null;
  };
  for (let i = 0; i < lines.length; i++) {
    if (!/^THE\s/i.test(lines[i])) continue;
    const here = cut(lines[i]);
    if (here) return here;
    const next = lines[i + 1];
    if (next && !/^THE\s/i.test(next) && lines[i].length + next.length < 200) {
      const joined = cut(`${lines[i]} ${next}`);
      if (joined) return joined;
    }
  }
  return null;
}

const norm = (t) => collapse(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');

/** Whether two titles are the same title: case, punctuation, spacing and a leading "The" aside; one may add a subtitle. */
export function titlesAgree(a, b) {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y && (x === y || x.startsWith(y) || y.startsWith(x)));
}

const squash = (t) => ` ${String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * Whether `title` is printed in the first `headChars` characters of `text`: the same words in the same order,
 * whatever the case, spacing, line breaks and punctuation, and as whole words. A title that is not there was
 * composed, not read: a retitle refuses it.
 */
export function titleInOpening(title, text, { headChars = 3000 } = {}) {
  const wanted = squash(title);
  if (wanted.trim() === '') return false;
  return squash(String(text ?? '').slice(0, headChars)).includes(wanted);
}

/**
 * The title a re-keyed or unlinked document gets. In order: the desk record's name when the desk holds exactly
 * one distinct name for the key (the title the record shows; `desk` is the list of names read from desk_rows),
 * else the manifest's title (the listing title of the bill the text really is), else the title printed in the
 * text. Returns { title, source, candidates, agreesWithPrinted, deskAmbiguous } or null when there is none.
 * Two different desk names are not chosen between: they are reported and the next source is used.
 */
export function chooseTitle({ desk = [], manifest = null, printed = null } = {}) {
  const names = [...new Set((desk ?? []).map(collapse).filter(Boolean))];
  const candidates = { desk: names, manifest: manifest ? collapse(manifest) : null, printed: printed ? collapse(printed) : null };
  let pick = null;
  if (names.length === 1) pick = { title: names[0], source: 'desk_rows' };
  else if (candidates.manifest) pick = { title: candidates.manifest, source: 'manifest' };
  else if (candidates.printed) pick = { title: candidates.printed, source: 'printed in the text' };
  if (!pick) return null;
  return {
    ...pick,
    candidates,
    agreesWithPrinted: candidates.printed ? titlesAgree(pick.title, candidates.printed) : null,
    deskAmbiguous: names.length > 1,
    replacesManifest: pick.source === 'desk_rows' && Boolean(candidates.manifest) && candidates.manifest !== pick.title,
  };
}

// ---------------------------------------------------------------------------------------------
// Same-family bills: a title and a key are not enough to tell the Constitution (Amendment) Bills apart
// ---------------------------------------------------------------------------------------------

const BILL_NO = /\bB\w{2,3}\s+No\.?\s*([0-9]{1,4}|[IVXLC]{1,8})(?:\s*-\s*[A-Z])?\s+o[fF]\s+(\d{4})/i;

/**
 * "Bill No. 47 of 2001" (or "Bill No. LXXII of 2000" for the Rajya Sabha) printed in the opening of a Bill,
 * read through OCR slips ("Bitt No. XXIV oF 2000") and the "-F" of a passed bill. { number, year } or null.
 */
export function printedBillNo(text, { headChars = 1500 } = {}) {
  const m = BILL_NO.exec(String(text ?? '').slice(0, headChars));
  return m ? { number: m[1].toUpperCase(), year: Number(m[2]) } : null;
}

const ROMAN_VALUE = { I: 1, V: 5, X: 10, L: 50, C: 100 };

/** A bill number as a number: "47" is 47, "LXXII" is 72 (a Rajya Sabha number, which sansad files by its Arabic form too). */
function billNumberValue(n) {
  const t = String(n).toUpperCase();
  if (/^\d+$/.test(t)) return Number(t);
  if (!/^[IVXLC]+$/.test(t)) return null;
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN_VALUE[t[i]];
    total += v < (ROMAN_VALUE[t[i + 1]] ?? 0) ? -v : v;
  }
  return total;
}

const sameBillNumber = (a, b) => String(a).toUpperCase() === String(b).toUpperCase() || (billNumberValue(a) !== null && billNumberValue(a) === billNumberValue(b));

/** The article and section numbers a title names: "(Insertion of new article 16A)" gives [{ kind: 'article', id: '16A' }]. */
export function titleRefs(title) {
  const refs = [];
  for (const m of String(title ?? '').matchAll(/\b(articles?|art\.?|sections?|sec\.?)\s*(?:no\.?\s*)?(\d+)\s?([A-Z]{1,2})?(?![A-Za-z0-9])/gi)) {
    const kind = /^art/i.test(m[1]) ? 'article' : 'section';
    refs.push({ kind, id: `${m[2]}${(m[3] ?? '').toUpperCase()}` });
  }
  return refs;
}

function textHasRef(head, { kind, id }) {
  const [, digits, letter = ''] = /^(\d+)([A-Z]*)$/.exec(id);
  const body = `${digits}${letter ? `\\s*${letter}` : ''}`;
  // With a letter ("16A", "21A") the token alone is specific enough: the clause itself is headed "21A.", with no
  // keyword before it. A bare number ("section 8") must follow its keyword, or it is any numbered paragraph.
  const re = letter
    ? new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`)
    : new RegExp(`\\b(?:${kind === 'article' ? 'articles?|art\\.?' : 'sections?|sec\\.?'})\\s*(?:no\\.?\\s*)?\\(?${body}(?![A-Za-z0-9])`, 'i');
  return re.test(head);
}

/**
 * Whether a text is the bill a title and key say it is, beyond the title's words (a Constitution (Amendment) Bill
 * has the same words as every other). Returns { problems, notes }; a problem is a failure.
 *  - The Bill No. printed in the opening must be the key's number (`key` is "bill:2001:47"; `billNo` { number, year }
 *    stands in for a key when the document has none). A different printed year is a problem unless the opening
 *    prints the key's year in a title (an OCR slip such as "of 2006" for 2000) and then it is a note.
 *  - Every article or section the title names must occur in the opening (`headChars`).
 *  - A text that prints no Bill No. is noted, not failed: the references still apply.
 */
export function identityProblems({ title, text, key = null, billNo = null, headChars = 3000 }) {
  const problems = [];
  const notes = [];
  const head = String(text ?? '').slice(0, headChars);
  const m = key ? DOCUMENT_KEY.exec(key) : null;
  const expected = m ? { year: Number(m[1]), number: m[2].toUpperCase() } : billNo ? { year: Number(billNo.year), number: String(billNo.number).toUpperCase() } : null;
  const printed = printedBillNo(text);
  if (expected && printed) {
    if (!sameBillNumber(printed.number, expected.number)) problems.push(`the text prints Bill No. ${printed.number} of ${printed.year}, but the bill is No. ${expected.number} of ${expected.year}`);
    else if (printed.year !== expected.year) {
      if (new RegExp(`BILL,?\\s*${expected.year}\\b`, 'i').test(head)) notes.push(`Bill No. is printed "of ${printed.year}" but the title prints ${expected.year}: an OCR slip?`);
      else problems.push(`the text prints Bill No. ${printed.number} of ${printed.year}, but the bill is No. ${expected.number} of ${expected.year}`);
    }
  } else if (expected) notes.push('the opening prints no Bill No.');
  for (const ref of titleRefs(title)) {
    if (!textHasRef(head, ref)) problems.push(`the title names ${ref.kind} ${ref.id}, which the opening of the text does not`);
  }
  return { problems, notes };
}

// ---------------------------------------------------------------------------------------------
// Regulatory identity: is the new text the same document as the old one?
// ---------------------------------------------------------------------------------------------

const words = (t) => String(t ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
function shingles(ws, n) {
  const out = new Set();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(' '));
  return out;
}

/**
 * How much of the old text is in the new one: the share of the old text's distinct n-word sequences (n = 4,
 * case and punctuation aside) that the new text also holds. Measured old in new, not the reverse: the stored
 * text of these documents is a tail of the document or debris from it, and the new text is the whole.
 */
export function oldTextContainment(oldText, newText, n = 4) {
  const old = shingles(words(oldText), n);
  if (!old.size) return { shingles: 0, contained: 0, share: null };
  const next = shingles(words(newText), n);
  let contained = 0;
  for (const x of old) if (next.has(x)) contained++;
  return { shingles: old.size, contained, share: contained / old.size };
}

/**
 * Thresholds chosen from the 44 Regulatory documents of the batch (stored text against a local OCR of the official
 * PDF, 2026-11-01): 38 of 44 had 0.54 or more, the low ones were the tails of table-heavy or garbled stored text
 * (0.09 to 0.39), and a text of another document scores about 0. A new OCR may shift this: look again at the
 * distribution of the first real run.
 */
export const IDENTITY_THRESHOLDS = Object.freeze({ minShingles: 100, fail: 0.05, look: 0.5 });

/**
 * { level: 'ok' | 'look' | 'fail', reason }. A garbage old text (the manifest says so) or one too short to
 * measure cannot vouch for the new one: a person looks at what the new text opens with. Otherwise a share under
 * `fail` is a failure, under `look` a look.
 */
export function identityVerdict({ share, shingles: count, garbage }) {
  const t = IDENTITY_THRESHOLDS;
  if (garbage) return { level: 'look', reason: 'the stored text is garbage, so its overlap with the new text cannot be measured' };
  if (share === null || count < t.minShingles) return { level: 'look', reason: `the stored text is too short to measure (${count} four-word sequences, under ${t.minShingles})` };
  const pct = `${(share * 100).toFixed(0)}% of the stored text's four-word sequences are in the new text`;
  if (share < t.fail) return { level: 'fail', reason: `${pct}: the new text may be another document` };
  if (share < t.look) return { level: 'look', reason: `${pct}: low, check that it is the same document` };
  return { level: 'ok', reason: pct };
}

// ---------------------------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------------------------

/**
 * The payload that puts a document back as its pre-write snapshot had it: the snapshot's title, text and
 * metadata, with n_chars and text_sha256 recomputed for the text (the server checks them). An unlinked document
 * (action retitle_unlink) is re-linked: file_url_ambiguous is set to false, which makes the server take the key
 * fields from the payload (document_key, bill_number, bill_year, house, status, file_url_source) instead of
 * clearing them. text_repair is marked as a rollback; the server cannot delete a metadata field, so what the
 * repair added stays beside it.
 */
export async function buildRollbackPayload(snapshot, { action }) {
  assertRepairable(snapshot);
  const text = snapshot.ocr_text;
  if (typeof text !== 'string' || !text.trim()) throw new Error('the snapshot has no text to restore');
  const metadata = structuredClone(snapshot.metadata ?? {});
  metadata.n_chars = codePointLength(text);
  metadata.text_sha256 = await sha256Hex(text);
  if (action === 'retitle_unlink' && typeof metadata.file_url_ambiguous !== 'boolean') metadata.file_url_ambiguous = false;
  metadata.text_repair = { ticket: REPAIR_TICKET, action: 'rollback', rolled_back_action: action };
  return {
    source_key: snapshot.source_key,
    title: snapshot.title,
    file_name: snapshot.file_name ?? null,
    file_url: snapshot.file_url ?? null,
    desk_tier: snapshot.desk_tier ?? null,
    desk_feature: snapshot.desk_feature ?? null,
    ocr_text: text,
    metadata,
  };
}
