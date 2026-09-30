// Question-set logic for the retrieval evaluation (docs/specs/2026-09-30-rag-v2-eval.md,
// "How the set is built" and "Expected outcome §1"). Pure functions; the runner
// scripts/build-eval-set.mjs does the reading, generating and writing.
// Node-only: md5Hex uses node:crypto, and this module is imported only by Node scripts and Vitest.
import { createHash } from 'node:crypto';

/** Questions per `documents.desk_feature` (exact values), 195 in all. */
export const DEFAULT_TARGETS = Object.freeze({
  'Bill Passage Probability Index': 80,
  'Regulatory Body Watch (RBI SEBI TRAI CCI)': 60,
  'Parliamentary Question Database': 40,
  'Industry Updates (Ministry Data)': 12,
  'Budget Utilisation & Schemes': 3,
});

const MIN_CANDIDATE_CHARS = 300;
const TABLE_SHARE = 0.6;
/** A remainder with fewer letters and digits than this is "nothing substantial". */
const MIN_SUBSTANTIVE_CHARS = 100;
/** A block is a signature block when at least this share of its non-empty lines look like signature lines. */
const SIGNATURE_SHARE = 0.8;

export function md5Hex(text) {
  return createHash('md5').update(String(text), 'utf8').digest('hex');
}

/**
 * A copy of `isTableRow` in supabase/functions/_shared/chunking.ts: a Markdown table row
 * starts and ends with '|' and has at least one non-empty cell. Bare OCR pipes ('|', '| |')
 * are text. Keep the two in step.
 */
export function isTableRow(line) {
  const t = line.trim();
  if (t.length < 3 || !t.startsWith('|') || !t.endsWith('|')) return false;
  return t.slice(1, -1).split('|').some((cell) => cell.trim() !== '');
}

// The enacting formula of an Act ("BE it enacted by Parliament ... as follows:—"). When
// "as follows" does not appear within 300 characters, the formula is taken to end with its line.
const ENACTING_FORMULA = /^\s*BE it enacted by Parliament\b(?:[^]{0,300}?as follows|[^\n]*)[\s:;.,\-—–]*/i;

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
// Signature-block lines, each at most 80 characters: an office ("Secretary-General",
// "MINISTER OF ..."), a bracketed name ("(Name)", "(UTPAL KUMAR SINGH)"), a place line
// ("NEW DELHI;"), a date, or a name in capitals of at most five words.
const SIGNATURE_LINES = [
  /\b(?:secretary|minister|president|chairman|chairperson|speaker|governor|director|registrar|by order)\b/i,
  /^\([^()]{1,60}\)[.,]?$/,
  /^new delhi\b/i,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH},?\\s+\\d{4}\\b`, 'i'),
  new RegExp(`\\b${MONTH}\\s+\\d{1,2},?\\s+\\d{4}\\b`, 'i'),
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/,
  /^[A-Z][A-Z.]*(?:\s+[A-Z][A-Z.]*){0,4}[.,]?$/,
];

function isSignatureLine(line) {
  return line.length <= 80 && SIGNATURE_LINES.some((re) => re.test(line));
}

function nonEmptyLines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * True when the text is only an enacting formula or a signature block: after removing a
 * leading enacting formula, what is left has fewer than 100 letters and digits, or at
 * least 80% of its non-empty lines are signature lines (see SIGNATURE_LINES).
 */
function isFormulaOrSignature(content) {
  const rest = content.replace(ENACTING_FORMULA, '');
  if ((rest.match(/[\p{L}\p{N}]/gu) ?? []).length < MIN_SUBSTANTIVE_CHARS) return true;
  const lines = nonEmptyLines(rest);
  return lines.filter(isSignatureLine).length >= SIGNATURE_SHARE * lines.length;
}

/**
 * Whether a chunk may become a gold passage: at least 300 characters (after trimming), under
 * 60% table rows, and not only an enacting formula or a signature block.
 */
export function isCandidateChunk(content) {
  const text = String(content ?? '');
  if (text.trim().length < MIN_CANDIDATE_CHARS) return false;
  const lines = nonEmptyLines(text);
  if (lines.filter(isTableRow).length >= TABLE_SHARE * lines.length) return false;
  return !isFormulaOrSignature(text);
}

function byMd5(key) {
  return (a, b) => {
    const ha = md5Hex(key(a));
    const hb = md5Hex(key(b));
    if (ha !== hb) return ha < hb ? -1 : 1;
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  };
}

/**
 * Plan the sample. `featureDocs` is `{ [desk_feature]: [{ document_id, chunks: [{ id, content }] }] }`.
 * Per feature: documents ordered by md5(document_id); each document's candidate chunks ordered
 * by md5(chunk id); then one candidate per document per pass, round-robin, until the target is
 * met. Returns `{ [desk_feature]: { picks, reserve } }` for every feature in `targets`; `reserve`
 * continues the same round-robin order, so a rejected pick is replaced by `reserve`'s next entry.
 */
export function planSample(featureDocs, targets = DEFAULT_TARGETS) {
  const plan = {};
  for (const [feature, target] of Object.entries(targets)) {
    const queues = [...(featureDocs[feature] ?? [])]
      .sort(byMd5((d) => String(d.document_id)))
      .map((d) =>
        d.chunks
          .filter((c) => isCandidateChunk(c.content))
          .sort(byMd5((c) => String(c.id)))
          .map((c) => ({ desk_feature: feature, document_id: d.document_id, chunk_id: c.id })),
      );
    const order = [];
    const passes = Math.max(0, ...queues.map((q) => q.length));
    for (let pass = 0; pass < passes; pass += 1) {
      for (const q of queues) if (pass < q.length) order.push(q[pass]);
    }
    plan[feature] = { picks: order.slice(0, target), reserve: order.slice(target) };
  }
  return plan;
}

/**
 * NFKC, lowercase, every character that is not a letter, mark or number becomes a space.
 * Zero-width joiners and spaces are removed first: in Devanagari they sit inside a word.
 */
export function normaliseTokens(text) {
  return String(text ?? '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function ngrams(tokens, n) {
  const out = new Set();
  for (let i = 0; i + n <= tokens.length; i += 1) out.add(tokens.slice(i, i + n).join(' '));
  return out;
}

/**
 * True when the question shares any n-token sequence with the passage, after normalisation.
 * A sequence that also occurs in `exempt` (the document title) does not count: naming the
 * Act or Bill is what a researcher does, not copying the passage.
 */
export function leaks(question, passage, n = 5, exempt = '') {
  const passageGrams = ngrams(normaliseTokens(passage), n);
  const exemptGrams = ngrams(normaliseTokens(exempt), n);
  for (const gram of ngrams(normaliseTokens(question), n)) if (passageGrams.has(gram) && !exemptGrams.has(gram)) return true;
  return false;
}

/**
 * Freeze the distractors for `focused-multi`: the feature's other documents ordered by
 * md5(`${gold}:${id}`), first `count`; [] when the feature has fewer than count + 1 documents.
 */
export function pickDistractors(goldDocumentId, featureDocumentIds, count = 4) {
  const others = [...new Set(featureDocumentIds)].filter((id) => id !== goldDocumentId);
  if (others.length < count) return [];
  return others.sort(byMd5((id) => `${goldDocumentId}:${id}`)).slice(0, count);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const isUuid = (v) => typeof v === 'string' && UUID.test(v);
const isNonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const isStringOrNull = (v) => v === null || typeof v === 'string';

/**
 * Validate one line of questions.v1.jsonl (a JSON string or a parsed object) against the
 * spec's schema. Returns `{ ok: true }` or `{ ok: false, errors }` naming each bad field.
 */
export function validateQuestionLine(line) {
  let q = line;
  if (typeof line === 'string') {
    try {
      q = JSON.parse(line);
    } catch (e) {
      return { ok: false, errors: [`line is not valid JSON: ${e.message}`] };
    }
  }
  if (!q || typeof q !== 'object' || Array.isArray(q)) return { ok: false, errors: ['line is not a JSON object'] };

  const errors = [];
  const owner = q.source === 'owner';
  const bad = (field, rule) => errors.push(`${field}: ${rule}`);

  if (typeof q.id !== 'string' || !/^q-\d{4}$/.test(q.id)) bad('id', 'must match q-NNNN');
  if (!isNonEmpty(q.question)) bad('question', 'must be a non-empty string');
  if (!isNonEmpty(q.desk_feature)) bad('desk_feature', 'must be a non-empty string');

  const gold = q.gold_document_ids;
  if (!Array.isArray(gold) || gold.length === 0 || !gold.every(isUuid)) {
    bad('gold_document_ids', 'must be a non-empty array of UUIDs');
  } else if (!owner && gold.length !== 1) {
    bad('gold_document_ids', 'a generated question has exactly one gold document');
  }

  if (q.gold_chunk_id === null) {
    if (!owner) bad('gold_chunk_id', 'may be null only for an owner question');
  } else if (!isUuid(q.gold_chunk_id)) bad('gold_chunk_id', 'must be a UUID or null');

  if (!isStringOrNull(q.gold_chunk_hash)) bad('gold_chunk_hash', 'must be a string or null');
  if (!isStringOrNull(q.gold_content_sha256)) bad('gold_content_sha256', 'must be a string or null');

  const { gold_char_from: from, gold_char_to: to } = q;
  if (from === null && to === null) {
    if (!owner) bad('gold_char_from/gold_char_to', 'may be null only for an owner question');
  } else if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to) {
    bad('gold_char_from/gold_char_to', 'must be integers with 0 <= from < to, or both null');
  }

  if (!isStringOrNull(q.document_key)) bad('document_key', 'must be a string or null');

  const d = q.distractor_ids;
  if (!Array.isArray(d) || !d.every(isUuid)) bad('distractor_ids', 'must be an array of UUIDs');
  else {
    if (d.length !== 0 && d.length !== 4) bad('distractor_ids', 'must hold four documents, or none');
    if (new Set(d).size !== d.length) bad('distractor_ids', 'must not repeat a document');
    if (Array.isArray(gold) && d.some((id) => gold.includes(id))) bad('distractor_ids', 'must not include a gold document');
  }

  if (typeof q.ambiguous !== 'boolean') bad('ambiguous', 'must be a boolean');
  if (q.source !== 'generated' && q.source !== 'owner') bad('source', "must be 'generated' or 'owner'");

  if (q.generator_model === null) {
    if (!owner) bad('generator_model', 'may be null only for an owner question');
  } else if (!isNonEmpty(q.generator_model)) bad('generator_model', 'must be a non-empty string');

  if (typeof q.created_at !== 'string' || !ISO_8601.test(q.created_at) || Number.isNaN(Date.parse(q.created_at))) {
    bad('created_at', 'must be an ISO-8601 timestamp');
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
