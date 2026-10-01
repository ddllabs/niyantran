/**
 * Corpus upload for the admin panel's Documents tab (R8,
 * docs/specs/2026-10-01-rag-v2-admin-upload.md; plan B3). Everything the tab needs short of
 * rendering:
 *
 * - `planUpload` reads a PDF, counts its pages and detects encryption with pdfjs-dist (the parser
 *   R7 uses), and either keeps the file whole or splits it with pdf-lib into parts that fit
 *   Mistral's limits (≤ 50,000,000 bytes and ≤ 1,000 pages each). Splits are deterministic, so a
 *   re-split after a closed tab gives the same part hashes and `prepare` finds the stored parts.
 * - `createAdminIngestApi` is the client for the `admin-ingest` Edge Function
 *   (supabase/functions/admin-ingest/contract.ts is the canonical contract; the typedefs below
 *   mirror it).
 * - `uploadPlan` runs prepare → upload to staging → verify → register for one planned file.
 *
 * Both PDF libraries are loaded lazily with `import()`, so they cost nothing until an admin picks
 * a file. pdfjs comes from the shared loader in `./pdfjs.js` (the legacy build; in a browser its
 * worker is a Vite `?url` asset, in Node it runs in-process). Tests can inject `inspectPdf` and
 * `loadPdfLib` through `planUploadWith`.
 */
import deskCatalog from '../../supabase/functions/_shared/deskCatalog.json';
import { loadPdfjs } from './pdfjs.js';
import { accessToken as sessionAccessToken, functionsUrl, supabase } from './supabaseClient.js';

// ─── Limits (the plan's fixed interface) ─────────────────────────────────────

/** v1 browser ceiling per file (spec decision 8). */
export const MAX_FILE_BYTES = 300_000_000;
/** Mistral's per-file limit and the corpus bucket's file_size_limit. */
export const PART_MAX_BYTES = 50_000_000;
/** Mistral's per-file page limit. */
export const PART_MAX_PAGES = 1000;
/** Mistral OCR price; the estimate shown is OCR only (embedding adds well under 1 %). */
export const USD_PER_1000_PAGES = 4;
/** admin-ingest refuses a registration beyond this (about $20 of OCR). */
export const MAX_REGISTER_PAGES = 5000;

/** Target size of the first range tried when splitting: 90 % of a part, to leave room. */
const FIRST_RANGE_BYTES = 45_000_000;
/** `%PDF-` must start within this many bytes. */
const HEADER_WINDOW = 1024;
const UPLOAD_KEY_PREFIX = 'upload:';
const PDF_TYPE = 'application/pdf';

// ─── Types (mirroring supabase/functions/admin-ingest/contract.ts) ───────────

/**
 * @typedef {object} PlanPart
 * @property {number} part_index   0-based, in page order
 * @property {number} page_offset  0-based index of the part's first page in the whole file
 * @property {number} page_count
 * @property {string} sha256       64 lowercase hex, of `bytes`
 * @property {number} byte_size    `bytes.byteLength`
 * @property {Uint8Array} bytes    the part's PDF (the original bytes when the file is not split)
 */

/**
 * @typedef {object} Plan
 * @property {string} file_name
 * @property {string} file_sha256   of the whole file as picked
 * @property {number} page_count    of the whole file (pdfjs)
 * @property {boolean} encrypted    the file has an /Encrypt dictionary (openable without a password)
 * @property {number} estimated_usd OCR only
 * @property {PlanPart[]} parts     contiguous, summing to page_count
 */

/**
 * A document that already holds this file (same file_sha256), activated first.
 * @typedef {object} ExistingDocument
 * @property {string} document_id
 * @property {string} source_key   `upload:<sha>` for an earlier upload from this tab
 * @property {string} title
 * @property {boolean} indexed     live in search
 * @property {string|null} job_status  of its latest ingest job
 */

/**
 * @typedef {{sha256: string, stored: true} | {sha256: string, stored: false, staging_path: string, token: string}} PreparedPart
 */

/**
 * @typedef {object} JobRow
 * @property {string} job_id
 * @property {string} document_id
 * @property {string} title
 * @property {string} source_key
 * @property {string|null} desk_tier
 * @property {string|null} desk_feature
 * @property {string} status
 * @property {string} stage
 * @property {number} ocr_pages
 * @property {number} pages_total
 * @property {number} attempts
 * @property {string|null} next_attempt_at
 * @property {string|null} error_code
 * @property {string|null} last_error
 * @property {number} ocr_cost_usd
 * @property {number} embed_tokens
 * @property {number} embed_cost_usd
 * @property {string|null} requested_by_email
 * @property {string} created_at
 * @property {string|null} finished_at
 */

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Every failure this module raises. `code` is one of:
 * - planning: `not_pdf`, `too_large`, `too_many_pages`, `encrypted_split`, `page_too_large`
 *   (the plan's list), plus `unreadable` (pdfjs or pdf-lib cannot open the file, e.g. it needs a
 *   password) and `split_failed` (a built part did not count as planned; a bug guard);
 * - the server's codes, passed through from `{ ok: false, code, error }` (contract.ts ErrorCode),
 *   with `status` and, when the server names one, `document_id`. Amendment A's codes
 *   (`key_held`, `stale`, `not_deletable`, `hub_url`) get a message of their own when the server
 *   sends none (SERVER_MESSAGES);
 * - client-side transport: `unauthorized` (no session), `unavailable` (network),
 *   `bad_response` (not JSON, or an answer that does not fit the request), `upload_failed`
 *   (Storage refused a part).
 * `message` is written for the admin.
 */
export class UploadError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.name = 'UploadError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** Messages for server refusals that arrive without one (Amendment A's codes, contract.ts). */
const SERVER_MESSAGES = Object.freeze({
  key_held: 'Another document already holds this record. Replace it instead, or unlink it first.',
  stale: 'This record changed since the page loaded. Reload it and try again.',
  not_deletable: 'This document cannot be deleted here: only documents uploaded from this page can be.',
  hub_url: 'That source URL is the desk’s listing page, not this document. Paste the document’s own URL, or tick “No public source”.',
});

// ─── Small pieces ────────────────────────────────────────────────────────────

/** A Uint8Array view over the same memory (no copy). */
function toBytes(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  throw new TypeError('Expected an ArrayBuffer or a typed array');
}

/** SHA-256 of exactly the bytes given (a view hashes only its own range), as lowercase hex. */
export async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', toBytes(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Estimated OCR cost in US dollars. */
export function estimateCostUsd(pages) {
  return (pages * USD_PER_1000_PAGES) / 1000;
}

/**
 * Every (tier, feature) pair in `supabase/functions/_shared/deskCatalog.json`, once each, sorted
 * by tier then feature (code-unit order). A feature on two tiers ("Cabinet Decisions") is two
 * pairs. admin-ingest stores the spelling the corpus already uses for the pair.
 * @returns {{tier: string, feature: string}[]}
 */
export function deskPairs() {
  const pairs = new Map();
  for (const { tier, feature } of deskCatalog.entries) {
    if (tier && feature) pairs.set(`${tier}\u0000${feature}`, { tier, feature });
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...pairs.values()].sort((a, b) => cmp(a.tier, b.tier) || cmp(a.feature, b.feature));
}

/**
 * A URL reduced for comparison: scheme and host lowercased (by URL parsing, which also drops a
 * default port), no query or fragment, no trailing slash. The path keeps its case. Null when the
 * value is blank or not an absolute URL.
 */
function comparableUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Whether `url` is one of a desk's provenance hub URLs rather than a document's own address
 * (Amendment A, D6: the record's `source_url` is a hint, never the value). Both sides are compared
 * without query, fragment or trailing slash, with scheme and host case-folded; a different path is
 * not the hub. Blank or unparsable values match nothing. admin-ingest refuses a hub URL (`hub_url`)
 * whatever this says; this is the form's early warning.
 * @param {string|null|undefined} url
 * @param {Iterable<string|null|undefined>|null|undefined} hints
 * @returns {boolean}
 */
export function isHubUrl(url, hints) {
  const target = comparableUrl(url);
  if (!target || !hints) return false;
  for (const hint of hints) {
    if (comparableUrl(hint) === target) return true;
  }
  return false;
}

function hasPdfHeader(bytes) {
  const head = bytes.subarray(0, HEADER_WINDOW);
  for (let i = 0; i + 5 <= head.length; i += 1) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}

const megabytes = (n) => `${(n / 1_000_000).toFixed(1)} MB`;

// ─── pdfjs ───────────────────────────────────────────────────────────────────
// `loadPdfjs` is the shared, memoised loader in ./pdfjs.js.

/**
 * Page count and encryption, from pdfjs.
 *
 * Encryption: pdfjs builds a cipher (`xref.encrypt`) exactly when the trailer carries an /Encrypt
 * dictionary, and reports its filter as `info.EncryptFilterName` (e.g. "Standard"), else null. A
 * file that opens with the empty user password (owner-password only) is `encrypted: true` with a
 * page count; one that needs a password to open cannot be counted and is refused as `unreadable`.
 *
 * pdfjs takes ownership of (detaches) the buffer it is given, so it gets a copy.
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {Promise<{pages: number, encrypted: boolean}>}
 */
export async function inspectPdf(bytes) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: toBytes(bytes).slice(),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  try {
    let doc;
    try {
      doc = await task.promise;
    } catch (error) {
      if (error?.name === 'PasswordException') {
        throw new UploadError('unreadable', 'This PDF needs a password to open. Save a copy without the password and try again.');
      }
      throw new UploadError('unreadable', `This PDF could not be read (${error?.message || error}).`);
    }
    const { info } = await doc.getMetadata();
    return { pages: doc.numPages, encrypted: Boolean(info?.EncryptFilterName) };
  } finally {
    await task.destroy();
  }
}

// ─── Planning and splitting ──────────────────────────────────────────────────

const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: MAX_FILE_BYTES,
  partMaxBytes: PART_MAX_BYTES,
  partMaxPages: PART_MAX_PAGES,
  maxRegisterPages: MAX_REGISTER_PAGES,
  firstRangeBytes: FIRST_RANGE_BYTES,
});

function splitEveryOf(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new RangeError('splitEvery must be a whole number of pages, 1 or more');
  return n;
}

/**
 * Builds the parts with pdf-lib: a work-list of page ranges processed in order; a part over the
 * byte limit is replaced in place by its two halves; a single page over the limit refuses the
 * file. Each part is then counted with pdfjs.
 */
async function splitPdf(bytes, pages, every, limits, { inspect, loadPdfLib }) {
  const { PDFDocument, PDFName } = await loadPdfLib();
  let source;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new UploadError('unreadable', `This PDF could not be split (${error?.message || error}).`);
  }
  if (source.getPageCount() !== pages) {
    throw new UploadError('split_failed', `pdf-lib counts ${source.getPageCount()} pages where pdfjs counts ${pages}; the file cannot be split safely.`);
  }
  // OCR does not need annotations, and a link's /Dest points at another page object: copying it
  // would drag that page (and through its /Parent, the whole page tree) into the part.
  for (const page of source.getPages()) page.node.delete(PDFName.of('Annots'));

  const perPage = bytes.byteLength / pages;
  const length = Math.max(1, Math.min(limits.partMaxPages, every ?? Infinity, Math.floor(limits.firstRangeBytes / perPage)));
  const work = [];
  for (let first = 0; first < pages; first += length) work.push([first, Math.min(first + length, pages) - 1]);

  const built = [];
  while (work.length) {
    const [first, last] = work.shift();
    const part = await PDFDocument.create({ updateMetadata: false });
    const indices = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    for (const page of await part.copyPages(source, indices)) part.addPage(page);
    const out = await part.save();
    if (out.byteLength > limits.partMaxBytes) {
      if (last === first) {
        throw new UploadError(
          'page_too_large',
          `Page ${first + 1} alone is ${megabytes(out.byteLength)}, over the ${megabytes(limits.partMaxBytes)} part limit. Compress the PDF and try again.`,
        );
      }
      const middle = Math.floor((first + last) / 2);
      work.unshift([first, middle], [middle + 1, last]);
      continue;
    }
    built.push({ first, last, out });
  }

  const parts = [];
  let total = 0;
  for (const [part_index, { first, last, out }] of built.entries()) {
    const expected = last - first + 1;
    const { pages: counted } = await inspect(out);
    if (counted !== expected) {
      throw new UploadError('split_failed', `Part ${part_index + 1} has ${counted} pages where ${expected} were planned.`);
    }
    total += counted;
    parts.push({ part_index, page_offset: first, page_count: counted, sha256: await sha256Bytes(out), byte_size: out.byteLength, bytes: out });
  }
  if (total !== pages) throw new UploadError('split_failed', `The parts hold ${total} pages where the file has ${pages}.`);
  return parts;
}

/**
 * `planUpload` with other limits or parsers. For tests (so a 50 MB part or a 300 MB file need not
 * be allocated); the tab uses `planUpload`.
 * @param {Partial<{maxFileBytes: number, partMaxBytes: number, partMaxPages: number, maxRegisterPages: number, firstRangeBytes: number}>} [overrides]
 * @param {{inspectPdf?: typeof inspectPdf, loadPdfLib?: () => Promise<typeof import('pdf-lib')>}} [deps]
 * @returns {(file: {name: string, bytes: ArrayBuffer|Uint8Array}, options?: {splitEvery?: number|null}) => Promise<Plan>}
 */
export function planUploadWith(overrides = {}, deps = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const inspect = deps.inspectPdf ?? inspectPdf;
  const loadPdfLib = deps.loadPdfLib ?? (() => import('pdf-lib'));

  return async function plan({ name, bytes: input }, { splitEvery } = {}) {
    const every = splitEveryOf(splitEvery);
    const bytes = toBytes(input);
    if (bytes.byteLength > limits.maxFileBytes) {
      throw new UploadError('too_large', `${name} is ${megabytes(bytes.byteLength)}; the limit is ${megabytes(limits.maxFileBytes)}.`);
    }
    if (!hasPdfHeader(bytes)) throw new UploadError('not_pdf', `${name} is not a PDF.`);

    const file_sha256 = await sha256Bytes(bytes);
    const { pages, encrypted } = await inspect(bytes);
    if (pages < 1) throw new UploadError('unreadable', `${name} has no pages.`);
    if (pages > limits.maxRegisterPages) {
      throw new UploadError('too_many_pages', `${name} has ${pages} pages; one upload can hold at most ${limits.maxRegisterPages}.`);
    }
    const plan = { file_name: name, file_sha256, page_count: pages, encrypted, estimated_usd: estimateCostUsd(pages) };

    const fitsWhole = bytes.byteLength <= limits.partMaxBytes && pages <= limits.partMaxPages;
    if (fitsWhole && every === null) {
      return { ...plan, parts: [{ part_index: 0, page_offset: 0, page_count: pages, sha256: file_sha256, byte_size: bytes.byteLength, bytes }] };
    }
    if (encrypted) {
      throw new UploadError(
        'encrypted_split',
        `${name} is encrypted and would have to be split, which cannot be done safely. Save an unencrypted copy${fitsWhole ? ', or upload it without "split every"' : ''}.`,
      );
    }
    return { ...plan, parts: await splitPdf(bytes, pages, every, limits, { inspect, loadPdfLib }) };
  };
}

/**
 * Reads, inspects and (if needed) splits one PDF.
 * - Refuses: `too_large` (> MAX_FILE_BYTES), `not_pdf` (no `%PDF-` in the first 1,024 bytes),
 *   `unreadable`, `too_many_pages` (> MAX_REGISTER_PAGES).
 * - Within the part limits and no `splitEvery`: one part holding the original bytes, encrypted or
 *   not.
 * - Otherwise splits with pdf-lib (`encrypted_split` if the file is encrypted): first range length
 *   = min(1,000, splitEvery, floor(45 MB / average page size)), at least 1; oversized parts are
 *   halved; `page_too_large` if one page alone is over the limit. Each part's pages are counted
 *   with pdfjs and must match (`split_failed`).
 * The input bytes are not modified.
 * @param {{name: string, bytes: ArrayBuffer|Uint8Array}} file
 * @param {{splitEvery?: number|null}} [options]
 * @returns {Promise<Plan>}
 */
export function planUpload(file, options) {
  return planUploadWith()(file, options);
}

// ─── admin-ingest client ─────────────────────────────────────────────────────

/**
 * The admin-ingest client. Every method POSTs `{ action, ...request }` as JSON with a bearer token
 * fetched fresh for that call (sessions refresh during long uploads), and resolves to the
 * `{ ok: true, ... }` body or throws `UploadError(code, error)` (see UploadError for the codes).
 *
 * Methods: `prepare(req)`, `verify(req)`, `register(req)`, `jobs({limit?, before?}?)`, and
 * `retry(jobId)`, `cancel(jobId)`, `discard(documentId)`, which also accept `{job_id}` /
 * `{document_id}`. Request and response shapes are contract.ts's.
 *
 * Amendment A (records-first management) adds, each sending only its contract fields:
 * - `records({desk_tier, desk_feature, query?, status?, limit?, offset?})` → RecordsResult;
 * - `unlinked({desk_tier, desk_feature, query?, limit?, offset?})` → UnlinkedResult;
 *   (blank or null optional filters are left out);
 * - `link({document_id, document_key, expected_key})` and `unlink({document_id, expected_key})`
 *   → LinkResult; `swap({document_id, expected_old})` → SwapResult. The expectation is the
 *   compare-and-set value (D11): a missing one is sent as null ("I expect none"), never dropped;
 * - `remove({document_id})`, the `delete` action → DeleteResult.
 * Their refusals: `key_held`, `stale`, `not_deletable`, `hub_url` (plus the usual codes).
 *
 * @param {{fetch?: typeof fetch, url?: string, accessToken?: () => Promise<string|null>}} [deps]
 *   defaults: the global fetch, `functionsUrl('admin-ingest')`, and the Supabase session token.
 */
export function createAdminIngestApi({
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  url = functionsUrl('admin-ingest'),
  accessToken: getToken = sessionAccessToken,
} = {}) {
  async function call(action, request = {}) {
    const token = await getToken();
    if (!token) throw new UploadError('unauthorized', 'Your session has ended. Sign in again.');
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...request, action }),
      });
    } catch (error) {
      throw new UploadError('unavailable', `The upload service could not be reached (${error?.message || error}).`);
    }
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new UploadError('bad_response', `The upload service answered ${res.status} without JSON.`, { status: res.status });
    }
    if (body.ok !== true || !res.ok) {
      const extra = { status: res.status };
      if (body.document_id) extra.document_id = body.document_id;
      const code = body.code || 'bad_response';
      const message = body.error || SERVER_MESSAGES[code] || `The upload service failed (${res.status}).`;
      throw new UploadError(code, message, extra);
    }
    return body;
  }
  const id = (key, value) => (value && typeof value === 'object' ? value : { [key]: value });
  /** `fields` without undefined, null or blank-string values; strings trimmed. */
  const optional = (fields) => Object.fromEntries(Object.entries(fields)
    .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
    .filter(([, value]) => value !== undefined && value !== null && value !== ''));

  return {
    prepare: (request) => call('prepare', request),
    verify: (request) => call('verify', request),
    register: (request) => call('register', request),
    jobs: (request = {}) => call('jobs', request),
    retry: (jobId) => call('retry', id('job_id', jobId)),
    cancel: (jobId) => call('cancel', id('job_id', jobId)),
    discard: (documentId) => call('discard', id('document_id', documentId)),
    records: ({ desk_tier, desk_feature, query, status, limit, offset } = {}) => (
      call('records', { desk_tier, desk_feature, ...optional({ query, status, limit, offset }) })
    ),
    unlinked: ({ desk_tier, desk_feature, query, limit, offset } = {}) => (
      call('unlinked', { desk_tier, desk_feature, ...optional({ query, limit, offset }) })
    ),
    link: ({ document_id, document_key, expected_key = null } = {}) => (
      call('link', { document_id, document_key, expected_key })
    ),
    unlink: ({ document_id, expected_key = null } = {}) => call('unlink', { document_id, expected_key }),
    swap: ({ document_id, expected_old = null } = {}) => call('swap', { document_id, expected_old }),
    remove: ({ document_id } = {}) => call('delete', { document_id }),
  };
}

// ─── Orchestration ───────────────────────────────────────────────────────────

const textOrNull = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * Uploads one planned file: `prepare` → for each part not already stored, upload to its staging
 * path and `verify` → `register`. Parts go one at a time, in order.
 *
 * - If `prepare` reports a document under an `upload:` key for this file, nothing is uploaded and
 *   the result is `{ existing: document }`. A 409 `already_uploaded` from `register` (a race)
 *   gives `{ existing: { document_id } }`.
 * - Documents holding the same file under another key (an R7 corpus key) do not stop the upload:
 *   `onDuplicates(documents)` is awaited with them before any byte is sent, and the success result
 *   carries them as `duplicates` (an empty array when there are none) for the tab's warning.
 * - `onProgress({ part_index, state })`: after prepare, each part reports `stored` (already at its
 *   content address) or `queued`; each queued part then reports `uploading`, `verifying`, `stored`.
 * - Errors throw UploadError; nothing is registered unless every part verified.
 *
 * Record links (Amendment A). `meta.document_key` attaches the upload to a record: `prepare` is
 * also sent the desk and the key, and when it names a live document already holding that key
 * (`key_holder`), `onKeyHolder(holder)` is awaited before any byte is sent (throw from it to stop)
 * and the result carries `key_holder`. `document_key`, `replaces` (the document a replacement will
 * swap out, D5) and `no_public_source` (only when exactly `true`, D6) are passed to `register`;
 * blank ones are left out, so a standalone upload registers exactly as before.
 *
 * @param {Plan} plan
 * @param {{title?: string, desk_tier: string, desk_feature: string, file_url?: string|null, note?: string|null, file_name?: string, document_key?: string|null, replaces?: string|null, no_public_source?: boolean}} meta
 *   `title` defaults to the file name; blank `file_url` and `note` are sent as null.
 * @param {{api?: ReturnType<typeof createAdminIngestApi>, storage?: {uploadToSignedUrl: Function}, onProgress?: (event: {part_index: number, state: 'queued'|'uploading'|'verifying'|'stored'}) => void, onDuplicates?: (documents: ExistingDocument[]) => unknown, onKeyHolder?: (holder: object) => unknown}} [deps]
 *   `storage` defaults to `supabase.storage.from('corpus')`, `api` to `createAdminIngestApi()`.
 * @returns {Promise<{document_id: string, job_id: string, duplicates: ExistingDocument[], key_holder?: object} | {existing: ExistingDocument | {document_id: string}, key_holder?: object}>}
 */
export async function uploadPlan(plan, meta = {}, {
  api = createAdminIngestApi(),
  storage = supabase.storage.from('corpus'),
  onProgress,
  onDuplicates,
  onKeyHolder,
} = {}) {
  const report = (part_index, state) => onProgress?.({ part_index, state });
  const documentKey = textOrNull(meta.document_key);
  const replaces = textOrNull(meta.replaces);

  const prepared = await api.prepare({
    file_sha256: plan.file_sha256,
    page_count: plan.page_count,
    parts: plan.parts.map(({ sha256, byte_size, page_count }) => ({ sha256, byte_size, page_count })),
    ...(documentKey ? { desk_tier: meta.desk_tier, desk_feature: meta.desk_feature, document_key: documentKey } : {}),
  });
  const keyHolder = prepared?.key_holder ?? null;
  const holderField = keyHolder ? { key_holder: keyHolder } : {};

  const documents = Array.isArray(prepared?.documents) ? prepared.documents : [];
  const existing = documents.find((doc) => String(doc?.source_key ?? '').startsWith(UPLOAD_KEY_PREFIX));
  if (existing) return { existing, ...holderField };

  const answers = prepared?.parts;
  const fits = Array.isArray(answers) && answers.length === plan.parts.length && answers.every((answer, i) => (
    answer?.sha256 === plan.parts[i].sha256 && (answer.stored === true || (answer.staging_path && answer.token))
  ));
  if (!fits) throw new UploadError('bad_response', 'The upload service answered with a part list that does not match this file.');

  if (keyHolder) await onKeyHolder?.(keyHolder);
  if (documents.length) await onDuplicates?.(documents);

  answers.forEach((answer, i) => report(plan.parts[i].part_index, answer.stored ? 'stored' : 'queued'));
  for (const [i, answer] of answers.entries()) {
    if (answer.stored) continue;
    const part = plan.parts[i];
    report(part.part_index, 'uploading');
    const { error } = await storage.uploadToSignedUrl(
      answer.staging_path,
      answer.token,
      new Blob([part.bytes], { type: PDF_TYPE }),
      { contentType: PDF_TYPE },
    );
    if (error) {
      throw new UploadError('upload_failed', `Part ${part.part_index + 1} of ${plan.parts.length} did not upload: ${error.message || error}`);
    }
    report(part.part_index, 'verifying');
    await api.verify({ staging_path: answer.staging_path, sha256: part.sha256, byte_size: part.byte_size });
    report(part.part_index, 'stored');
  }

  try {
    const registered = await api.register({
      file_sha256: plan.file_sha256,
      page_count: plan.page_count,
      parts: plan.parts.map(({ part_index, page_offset, page_count, sha256, byte_size }) => ({ part_index, page_offset, page_count, sha256, byte_size })),
      title: textOrNull(meta.title) ?? plan.file_name,
      desk_tier: meta.desk_tier,
      desk_feature: meta.desk_feature,
      file_url: textOrNull(meta.file_url),
      note: textOrNull(meta.note),
      file_name: textOrNull(meta.file_name) ?? plan.file_name,
      ...(documentKey ? { document_key: documentKey } : {}),
      ...(replaces ? { replaces } : {}),
      ...(meta.no_public_source === true ? { no_public_source: true } : {}),
    });
    return { document_id: registered.document_id, job_id: registered.job_id, duplicates: documents, ...holderField };
  } catch (error) {
    if (error instanceof UploadError && error.code === 'already_uploaded') return { existing: { document_id: error.document_id } };
    throw error;
  }
}
