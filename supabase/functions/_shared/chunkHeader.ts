// The contextual chunk header (bulk ingestion spec §4.3; plan 2026-11-04-hybrid-and-contextual-retrieval T4,
// decision D1). A pure function from a document's stored fields to one or two short lines that are put
// in front of each chunk's EMBEDDING INPUT, so a chunk that says "the appeal is dismissed" also carries
// which case, company and date it belongs to. The stored chunk text is never changed.
//
//   - Stored metadata only: no model call, no network, no clock. The same input gives the same output.
//   - Line 1: the feature's short label and the title. Line 2: the facts the document's metadata holds
//     (case number, order date and so on), in a fixed priority order. Empty, missing or malformed fields
//     are left out; the text "undefined" or "null" never appears.
//   - A fact the title already states (the question number in "Question No. 2564: ...") is not repeated.
//   - The whole header is at most CHUNK_HEADER_MAX_CHARS characters (about 75 tokens at four characters
//     each, usually well under 60). The label and the title are always kept; a fact that does not fit in the
//     space left is skipped and a later, shorter one may still be used.
//
// The field names below are the stored shapes, read from the rehearsal replica on 2026-11-04. A document's
// source fields are in `metadata.citation`; the documents that have no citation (1,624 of the bills, 82
// questions, every regulatory, industry and budget document) keep a few of them at the top of `metadata`,
// so each field is read from the citation first and the top level second.
//
// embed_hash = SHA-256(normalise(embedding input)) names the text that was embedded, so a changed header
// changes the hash and a version bump alone does not (the vector would be the same). HEADER_VERSION is
// kept honest by the golden outputs in chunkHeader_test.ts: a change to this builder's output changes a
// golden and bumps the version in the same commit.

export const HEADER_VERSION = 1;

/** Upper bound on a whole header, newline included. */
export const CHUNK_HEADER_MAX_CHARS = 300;

/** The fields of a `documents` row that a header is built from. Everything is optional: rows vary. */
export interface HeaderDocument {
  title?: string | null;
  desk_tier?: string | null;
  desk_feature?: string | null;
  metadata?: unknown;
}

const TITLE_MAX = 120;
const LABEL_MAX = 40;
const CONTROL = /\p{Cc}/gu;

/** A string or finite number as clean single-spaced text; anything else (null, objects, arrays) is empty. */
function text(v: unknown): string {
  const s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  return s.toWellFormed().replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

/** At most `max` UTF-16 units including the ellipsis, never ending inside a surrogate pair. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trimEnd() + '…';
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;
const DMY_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

/** ISO yyyy-mm-dd for an ISO date or a day-month-year text; any other text (or a date that does not exist) is kept, bounded. */
function date(v: unknown): string {
  const s = text(v);
  const iso = ISO_DATE.exec(s);
  const dmy = iso ? null : DMY_DATE.exec(s);
  if (!iso && !dmy) return clip(s, 30);
  const [y, mo, d] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(dmy![3]), Number(dmy![2]), Number(dmy![1])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  const real = t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  return real
    ? `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : clip(s, 30);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `value` appears in `title` as a whole word or number, ignoring case. */
function inTitle(title: string, value: string): boolean {
  return value !== '' && new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, 'iu').test(title);
}

/** A fact for line 2. `probe`: when the title already contains it, the fact is dropped as a repeat. */
interface Fact {
  text: string;
  probe?: string;
}

/** Reads a field from the citation first and the top level of the metadata second. */
type Read = (...keys: string[]) => string;

const KNOWN_HOSTS: Readonly<Record<string, string>> = {
  'trai.gov.in': 'TRAI',
  'cci.gov.in': 'CCI',
  'rbi.org.in': 'RBI',
  'sebi.gov.in': 'SEBI',
};

/** Short labels, keyed by the feature name with punctuation folded away ("RBI/SEBI" and "RBI SEBI" agree). */
const LABELS: Readonly<Record<string, string>> = {
  'nclt nclat insolvency': 'NCLT / NCLAT (Insolvency)',
  'parliamentary question database': 'Parliamentary Question',
  'bill passage probability index': 'Parliamentary Bill',
  'regulatory body watch rbi sebi trai cci': 'Regulatory',
  'industry updates ministry data': 'Industry Update',
  'budget utilisation schemes': 'Budget',
};

const featureKey = (feature: string) => feature.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function ncltFacts(read: Read): Fact[] {
  const section = read('section');
  const remarks = read('remarks');
  return [
    { text: clip(read('case_number'), 80) },
    { text: clip(read('forum'), 20) },
    { text: date(read('order_date')) },
    { text: read('bench') ? clip(`Bench ${read('bench')}`, 40) : '' },
    { text: section ? clip(/^(section|sec\b|s\.)/i.test(section) ? section : `Section ${section}`, 30) : '' },
    // `order_type` is empty in every stored document; `remarks` holds the outcome ("Dismissed", "Admission -
    // Final Order"). "Others" says nothing, so it is left out.
    { text: clip(read('order_type') || (/^others?$/i.test(remarks) ? '' : remarks), 60) },
  ];
}

function questionFacts(read: Read): Fact[] {
  const house = read('house');
  const number = read('question_no');
  const type = read('question_type');
  const ministry = read('ministry');
  const answered = date(read('answered_on'));
  const session = read('session');
  return [
    { text: clip(house, 20), probe: house },
    { text: number ? clip(`Question No. ${number}`, 30) : '', probe: number },
    { text: clip(type, 20), probe: type },
    { text: ministry ? clip(`Ministry: ${ministry}`, 70) : '' },
    { text: answered ? `answered ${answered}` : '' },
    { text: session ? clip(`session ${session}`, 20) : '' },
  ];
}

function billFacts(read: Read): Fact[] {
  const number = read('bill_number');
  const house = read('house');
  const year = read('bill_year');
  const ministry = read('ministry');
  const introduced = date(read('introduced_on'));
  return [
    { text: number ? clip(`Bill No. ${number}`, 30) : '' },
    { text: clip(house, 20), probe: house },
    { text: clip(year, 8), probe: year },
    { text: ministry ? clip(`Ministry: ${ministry}`, 70) : '' },
    { text: clip(read('status'), 30) },
    { text: clip(read('version', 'document_role').replace(/_/g, ' '), 40) },
    { text: introduced ? `introduced ${introduced}` : '' },
  ];
}

/** Regulatory, industry, budget and any feature without its own shape: the source and the document type. */
function sourceFacts(read: Read, label: string): Fact[] {
  const host = read('source_host').toLowerCase();
  const regulator = KNOWN_HOSTS[host];
  const docType = read('doc_type').replace(/_/g, ' ');
  return [
    { text: host ? clip(regulator ? `Source: ${regulator} (${host})` : `Source: ${host}`, 70) : '' },
    // "regulatory" under the label "Regulatory" is a repeat.
    { text: label.toLowerCase().includes(docType.toLowerCase()) ? '' : clip(docType, 30) },
  ];
}

const FACTS: Readonly<Record<string, (read: Read) => Fact[]>> = {
  'nclt nclat insolvency': ncltFacts,
  'parliamentary question database': questionFacts,
  'bill passage probability index': billFacts,
};

/**
 * The header for one document, or '' when it has nothing usable. Pure and deterministic; never throws on
 * odd metadata. Prefix a chunk's embedding input with `chunkHeaderPrefix(header)`.
 */
export function buildChunkHeader(doc: HeaderDocument): string {
  const metadata = record(doc?.metadata);
  const citation = record(metadata.citation);
  const read: Read = (...keys) => {
    for (const k of keys) {
      const v = text(citation[k]) || text(metadata[k]);
      if (v) return v;
    }
    return '';
  };

  const feature = text(doc?.desk_feature);
  const key = featureKey(feature);
  const label = LABELS[key] ?? clip(feature || text(doc?.desk_tier), LABEL_MAX);
  const rawTitle = text(doc?.title) || read('subject', 'bill_name');
  // File stems ("TRAI_recommendation__Spectrum_2017") read as words once the underscores are spaces.
  const title = clip(text(rawTitle.replace(/_/g, ' ')), TITLE_MAX);
  const line1 = [label, title].filter(Boolean).join(' | ');

  const facts = (FACTS[key] ?? ((r: Read) => sourceFacts(r, label)))(read);
  let line2 = '';
  for (const fact of facts) {
    if (!fact.text) continue;
    if (fact.probe && inTitle(title, fact.probe)) continue;
    const next = line2 ? `${line2} | ${fact.text}` : fact.text;
    const total = line1 ? line1.length + 1 + next.length : next.length;
    if (total <= CHUNK_HEADER_MAX_CHARS) line2 = next;
  }
  return [line1, line2].filter(Boolean).join('\n');
}

/** What goes in front of an embedding input: the header and a blank line, or nothing without a header. */
export function chunkHeaderPrefix(header: string | null | undefined): string {
  return header ? `${header}\n\n` : '';
}
