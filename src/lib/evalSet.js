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

/**
 * Questions per feature for questions.v2, selected by `--set-version v2`: the four features above
 * 10,000 chunks. 60 each, so that at least 50 survive grading and the ambiguity mark
 * (docs/plans/2026-11-01-retrieval-eval-baseline.md). Features absent here (Industry, Budget) are
 * carried over from v1 by `carryOver`.
 */
export const V2_TARGETS = Object.freeze({
  'NCLT / NCLAT (Insolvency)': 60,
  'Bill Passage Probability Index': 60,
  'Parliamentary Question Database': 60,
  'Regulatory Body Watch (RBI SEBI TRAI CCI)': 60,
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

/** The most requests a second the builder may make against NTER. */
export const MAX_RATE = 5;

/** True for a request rate in requests a second: a number above 0 and at most MAX_RATE. */
export const isValidRate = (rate) => typeof rate === 'number' && rate > 0 && rate <= MAX_RATE;

/**
 * Milliseconds to wait before the next page request so that requests start 1000 / rate apart,
 * given how long the last one took (never negative).
 */
export const pageDelayMs = (rate, elapsedMs) => Math.max(0, 1000 / rate - elapsedMs);

/**
 * After one page of a keyset-paged read (rows ordered by id, `pageSize` requested): the id to
 * continue after and whether the read is finished. A short or empty page is the last; a full
 * one is not, even if it happens to end the table, because the next read then comes back empty.
 */
export function keysetNext(rows, pageSize) {
  return { cursor: rows.length ? rows[rows.length - 1].id : null, done: rows.length < pageSize };
}

const questionId = (n) => `q-${String(n).padStart(4, '0')}`;

/** The lines with ids q-NNNN assigned in order from `start`; every other field is left alone. */
export function renumberLines(lines, start = 1) {
  return lines.map((line, i) => ({ ...line, id: questionId(start + i) }));
}

/**
 * Decide which lines of an earlier set carry into a new one. `currentHashes` maps each stored
 * chunk id to its current `chunk_hash`. A line is kept when its gold chunk still exists with the
 * hash it was written against, and keeps its old id in `carried_from` (the caller numbers it into
 * the new sequence with `renumberLines`). A line of a feature in `targets` is superseded (the new
 * set regenerates that feature); any other line whose gold chunk is missing, changed or absent is
 * drifted, with the reason. Returns `{ kept, drifted, superseded }`; the input is not changed.
 */
export function carryOver(oldLines, currentHashes, { targets = V2_TARGETS } = {}) {
  const kept = [];
  const drifted = [];
  let superseded = 0;
  for (const line of oldLines) {
    if (Object.hasOwn(targets, line.desk_feature)) {
      superseded += 1;
      continue;
    }
    const id = line.gold_chunk_id;
    if (id === null || id === undefined) {
      drifted.push({ id: line.id, gold_chunk_id: null, reason: 'no gold chunk to compare' });
    } else if (!currentHashes.has(id)) {
      drifted.push({ id: line.id, gold_chunk_id: id, reason: 'chunk not found' });
    } else if (currentHashes.get(id) !== line.gold_chunk_hash) {
      drifted.push({ id: line.id, gold_chunk_id: id, reason: 'chunk hash changed' });
    } else {
      kept.push({ ...line, carried_from: line.id });
    }
  }
  return { kept, drifted, superseded };
}

/**
 * Parse and validate a file of developer-written questions (JSON Lines, blank lines ignored).
 * Returns `{ lines, errors }`; each error names its file line, and the file is unusable when
 * `errors` is not empty. Every line must have `source: 'developer'`; ids and question texts (compared
 * after collapsing whitespace and case) must not repeat.
 */
export function parseDeveloperLines(text) {
  const lines = [];
  const errors = [];
  const idLine = new Map();
  const questionLine = new Map();
  const squash = (question) => question.replace(/\s+/g, ' ').trim().toLowerCase();
  String(text).split('\n').forEach((raw, i) => {
    if (raw.trim() === '') return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      errors.push(`line ${i + 1}: line is not valid JSON: ${e.message}`);
      return;
    }
    const v = validateQuestionLine(parsed);
    const problems = v.ok ? [] : [...v.errors];
    if (parsed?.source !== 'developer' && v.ok) problems.push("source: must be 'developer'");
    if (problems.length) {
      errors.push(`line ${i + 1}: ${problems.join('; ')}`);
      return;
    }
    const repeats = [];
    if (idLine.has(parsed.id)) repeats.push(`id ${parsed.id} repeats line ${idLine.get(parsed.id)}`);
    if (questionLine.has(squash(parsed.question))) repeats.push(`question repeats line ${questionLine.get(squash(parsed.question))}`);
    if (repeats.length) {
      errors.push(`line ${i + 1}: ${repeats.join('; ')}`);
      return;
    }
    idLine.set(parsed.id, i + 1);
    questionLine.set(squash(parsed.question), i + 1);
    lines.push(parsed);
  });
  if (lines.length === 0 && errors.length === 0) errors.push('no questions in the file');
  return { lines, errors };
}

/** Developer lines with their file id copied into `developer_ref`, before `renumberLines` replaces it. */
export function tagDeveloperRefs(lines) {
  return lines.map((line) => ({ ...line, developer_ref: line.id }));
}

/**
 * Check developer lines against the corpus as the builder read it. `documents` is
 * `Map<document id, { desk_feature }>` of indexed documents; `chunks` is
 * `Map<chunk id, { chunk_hash, document_id }>`. Every gold document must be indexed and in the
 * line's own desk_feature; a non-null gold chunk must exist, belong to a gold document and, when
 * the line gives a hash, match it; every distractor must be indexed and not a gold document.
 * Returns the problems as strings, [] when all is well.
 */
export function checkDeveloperLines(lines, { documents, chunks }) {
  const problems = [];
  for (const line of lines) {
    const say = (message) => problems.push(`${line.id}: ${message}`);
    for (const id of line.gold_document_ids) {
      const doc = documents.get(id);
      if (!doc) say(`gold document ${id} is not indexed`);
      else if (doc.desk_feature !== line.desk_feature) say(`gold document ${id} is in "${doc.desk_feature}", not "${line.desk_feature}"`);
    }
    if (line.gold_chunk_id != null) {
      const chunk = chunks.get(line.gold_chunk_id);
      if (!chunk) say(`gold chunk ${line.gold_chunk_id} not found`);
      else {
        if (line.gold_chunk_hash != null && chunk.chunk_hash !== line.gold_chunk_hash) say(`gold chunk hash changed (line ${line.gold_chunk_hash}, now ${chunk.chunk_hash})`);
        if (!line.gold_document_ids.includes(chunk.document_id)) say(`gold chunk ${line.gold_chunk_id} belongs to ${chunk.document_id}, not a gold document`);
      }
    }
    for (const id of line.distractor_ids) {
      if (line.gold_document_ids.includes(id)) say(`distractor ${id} is a gold document`);
      else if (!documents.has(id)) say(`distractor ${id} is not indexed`);
    }
  }
  return problems;
}

/** Fewest non-ambiguous generated questions a v2 feature may end with. */
export const MIN_NON_AMBIGUOUS = 50;

const countsTowardTarget = (a, countAmbiguous) => countAmbiguous || !a.ambiguous;

/**
 * Whether sampling a feature must go on. `accepted` is `[{ index, ambiguous }]`, the candidates
 * accepted so far. v1 counts every acceptance toward `target`; v2 (`countAmbiguous: false`) counts
 * only the non-ambiguous ones, so the target is met with usable questions.
 */
export function needsMore(accepted, target, { countAmbiguous = true } = {}) {
  return accepted.filter((a) => countsTowardTarget(a, countAmbiguous)).length < target;
}

/**
 * The acceptances a feature keeps: in queue order (`index`), up to and including the `target`-th
 * counted one. With `countAmbiguous: false` the ambiguous ones met on the way are kept (they stay
 * in the set, marked ambiguous) and any after the cutoff are not.
 */
export function takeAccepted(accepted, target, { countAmbiguous = true } = {}) {
  const kept = [];
  let counted = 0;
  for (const a of [...accepted].sort((x, y) => x.index - y.index)) {
    if (counted >= target) break;
    kept.push(a);
    if (countsTowardTarget(a, countAmbiguous)) counted += 1;
  }
  return kept;
}

/** Generated, non-ambiguous questions per feature in `features`. */
export function nonAmbiguousCounts(lines, features) {
  const counts = Object.fromEntries(features.map((f) => [f, 0]));
  for (const l of lines) if (l.source === 'generated' && !l.ambiguous && Object.hasOwn(counts, l.desk_feature)) counts[l.desk_feature] += 1;
  return counts;
}

/** The features of `counts` with fewer than `min` non-ambiguous questions. */
export function nonAmbiguousShortfalls(counts, min = MIN_NON_AMBIGUOUS) {
  return Object.entries(counts).filter(([, count]) => count < min).map(([feature, count]) => ({ feature, count }));
}

/**
 * Every row of a select, keyset-paged on id and at most `rate` requests a second. `build()` returns
 * a select that includes `id` and is not yet ordered or limited; each page is
 * `.order('id').limit(pageSize)` and, after the first, `.gt('id', last id)`. A short or empty page
 * ends the read. `sleep(ms)` and `now()` are injected so tests need no clock.
 */
export async function readAllKeyset(build, { what, rate, pageSize = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
  const out = [];
  let cursor = null;
  for (;;) {
    const started = now();
    let query = build().order('id').limit(pageSize);
    if (cursor !== null) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw new Error(`${what} (after ${cursor}): ${error.message}`);
    out.push(...data);
    const next = keysetNext(data, pageSize);
    if (next.done) return out;
    cursor = next.cursor;
    await sleep(pageDelayMs(rate, now() - started));
  }
}

const BUILD_FLAGS = {
  '--set-version': 'setVersion', '--out': 'out', '--max-usd': 'maxUsd', '--carry-over': 'carryOver', '--developer': 'developer', '--rate': 'rate',
};

/**
 * Parse and check the builder's command line. Returns `{ args, warnings }` or throws. Unknown
 * arguments, and options missing their value, are errors: a misspelt flag must not be dropped.
 * `args.out` stays null when not given; the caller fills in the set's default path.
 */
export function parseBuildArgs(argv) {
  const args = { setVersion: 'v1', out: null, maxUsd: 2, dryRun: false, carryOver: null, developer: null, rate: 2 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') {
      args.dryRun = true;
    } else if (Object.hasOwn(BUILD_FLAGS, a)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${a} needs a value`);
      args[BUILD_FLAGS[a]] = a === '--max-usd' || a === '--rate' ? Number(value) : value;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!(args.maxUsd > 0)) throw new Error('--max-usd must be a positive number');
  if (!isValidRate(args.rate)) throw new Error(`--rate must be above 0 and at most ${MAX_RATE} requests per second`);
  if (args.setVersion !== 'v1' && args.setVersion !== 'v2') throw new Error('--set-version must be one of v1, v2');
  if ((args.carryOver !== null || args.developer !== null) && args.setVersion !== 'v2') {
    throw new Error('--carry-over and --developer apply to --set-version v2 only');
  }
  const warnings = [];
  if (args.setVersion === 'v2' && args.carryOver === null) {
    warnings.push("--set-version v2 without --carry-over: v1's Industry and Budget questions will not be carried into the set");
  }
  return { args, warnings };
}

/**
 * Validate one line of a question set (a JSON string or a parsed object) against the
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
  // An owner or developer question is written by a person: several gold documents, and no gold chunk, are allowed.
  const owner = q.source === 'owner' || q.source === 'developer';
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
    if (!owner) bad('gold_chunk_id', 'may be null only for an owner or developer question');
  } else if (!isUuid(q.gold_chunk_id)) bad('gold_chunk_id', 'must be a UUID or null');

  if (!isStringOrNull(q.gold_chunk_hash)) bad('gold_chunk_hash', 'must be a string or null');
  if (!isStringOrNull(q.gold_content_sha256)) bad('gold_content_sha256', 'must be a string or null');

  const { gold_char_from: from, gold_char_to: to } = q;
  if (from === null && to === null) {
    if (!owner) bad('gold_char_from/gold_char_to', 'may be null only for an owner or developer question');
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
  if (q.source !== 'generated' && q.source !== 'owner' && q.source !== 'developer') bad('source', "must be 'generated', 'owner' or 'developer'");
  // carried_from: set on a line carried over from an earlier set, the id it had there.
  // developer_ref: set on a developer line, the id it had in the developer's file.
  for (const field of ['carried_from', 'developer_ref']) {
    if (q[field] !== undefined && !(typeof q[field] === 'string' && /^q-\d{4}$/.test(q[field]))) bad(field, 'must match q-NNNN when present');
  }

  if (q.generator_model === null) {
    if (!owner) bad('generator_model', 'may be null only for an owner or developer question');
  } else if (!isNonEmpty(q.generator_model)) bad('generator_model', 'must be a non-empty string');

  if (typeof q.created_at !== 'string' || !ISO_8601.test(q.created_at) || Number.isNaN(Date.parse(q.created_at))) {
    bad('created_at', 'must be an ISO-8601 timestamp');
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}
