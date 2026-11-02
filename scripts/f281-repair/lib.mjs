// Helpers of scripts/f281-repair/repair.mjs that decide something, kept apart from the commands so they
// can be tested without a network: the manifest, the OCR spend cap, the write gate, the read-back
// comparison, and the one read-only database reader. Nothing here writes to a database.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OCR_FLAGS, OCR_MODEL } from '../../supabase/functions/ingest-worker/types.ts';

export { OCR_MODEL };
/**
 * The OCR request flags this tool sends: the worker's own (ingest-worker/types.ts OCR_FLAGS), less the page
 * images and blocks, which composeDocument does not read and which would bloat the response. Stored in every
 * cached part, and build refuses a part made with other flags.
 */
export const OCR_REQUEST_FLAGS = Object.freeze({ ...OCR_FLAGS, include_blocks: false, include_image_base64: false });

export const ACTIONS = Object.freeze(['decode', 'reextract', 'strip_cover', 'ocr', 'rekey', 'retitle_unlink']);
/** Actions whose new text comes from the official PDF (so the manifest names it, and may pin its SHA-256). */
export const PDF_ACTIONS = Object.freeze(['decode', 'reextract', 'ocr']);
export const OCR_KINDS = Object.freeze(['any', 'cci-order', 'bilingual-gazette']);
/** What a dry run may say about a document that is safe to write. */
export const WRITABLE_DRY_STATUSES = Object.freeze(['dry_run', 'unchanged']);

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The first `n` characters, one line, for console output (never a full text). */
export function clip(text, n = 80) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

export const COMMANDS = Object.freeze(['prepare', 'pin', 'ocr', 'build', 'rollback-build', 'dry-run', 'write', 'readback']);

/** Where the work directory goes unless --work-dir says otherwise: outside the worktree, so a cleanup of the worktree cannot take the snapshots. */
export const defaultWorkDir = () => join(homedir(), '.niyantran', 'f281-repair');

export function parseArgs(argv) {
  const out = {
    command: null, manifest: 'scripts/f281-repair/manifest.json', workDir: defaultWorkDir(), env: '.env.local', only: [],
    go: false, maxUsd: 5, pagesPerCall: 40, batch: 20, maxEmbedUsd: 1, authorizedBy: null, rewrite: [], rollback: false, confirm: null, rowsOnly: false, pdfsOnly: false, apply: false, redo: false, help: false,
  };
  const rest = [...argv];
  if (rest.length && !rest[0].startsWith('-')) out.command = rest.shift();
  const value = (flag, i) => {
    if (i + 1 >= rest.length || rest[i + 1].startsWith('--')) throw new Error(`${flag} needs a value`);
    return rest[i + 1];
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--manifest') out.manifest = value(a, i++);
    else if (a === '--work-dir' || a === '--work') out.workDir = value(a, i++);
    else if (a === '--env') out.env = value(a, i++);
    else if (a === '--only') out.only.push(value(a, i++));
    else if (a === '--max-usd') out.maxUsd = Number(value(a, i++));
    else if (a === '--pages-per-call') out.pagesPerCall = Number(value(a, i++));
    else if (a === '--batch') out.batch = Number(value(a, i++));
    else if (a === '--max-embed-usd') out.maxEmbedUsd = Number(value(a, i++));
    else if (a === '--authorized-by') out.authorizedBy = value(a, i++);
    else if (a === '--rewrite') out.rewrite.push(value(a, i++));
    else if (a === '--rollback') out.rollback = true;
    else if (a === '--confirm') out.confirm = value(a, i++);
    else if (a === '--go') out.go = true;
    else if (a === '--rows-only') out.rowsOnly = true;
    else if (a === '--pdfs-only') out.pdfsOnly = true;
    else if (a === '--apply') out.apply = true;
    else if (a === '--redo') out.redo = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (out.command !== null && !COMMANDS.includes(out.command)) throw new Error(`unknown command ${out.command}; one of ${COMMANDS.join(', ')}`);
  if (!Number.isFinite(out.maxUsd) || out.maxUsd <= 0) throw new Error('--max-usd must be a positive number');
  if (!Number.isInteger(out.pagesPerCall) || out.pagesPerCall < 1 || out.pagesPerCall > 1000) throw new Error('--pages-per-call must be an integer from 1 to 1000');
  if (!Number.isInteger(out.batch) || out.batch < 1 || out.batch > 100) throw new Error('--batch must be an integer from 1 to 100');
  if (!Number.isFinite(out.maxEmbedUsd) || out.maxEmbedUsd <= 0) throw new Error('--max-embed-usd must be a positive number');
  if (out.rowsOnly && out.pdfsOnly) throw new Error('--rows-only and --pdfs-only exclude each other');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------

const HEX64 = /^[a-f0-9]{64}$/;
const PREFIX = /^[0-9a-f]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^bill:\d{4}:[A-Za-z0-9]+$/;

/** Every problem found, as strings; empty when the manifest is usable. */
export function manifestProblems(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.documents) || !manifest.documents.length) return ['manifest has no documents array'];
  const seen = new Set();
  const keys = new Map();
  for (const [i, d] of manifest.documents.entries()) {
    const at = `documents[${i}]${d?.prefix ? ` (${d.prefix})` : ''}`;
    if (!PREFIX.test(d?.prefix ?? '')) problems.push(`${at}: prefix must be 8 lower-case hex characters`);
    if (seen.has(d?.prefix)) problems.push(`${at}: duplicate prefix`);
    seen.add(d?.prefix);
    if (d?.id !== null && !(typeof d?.id === 'string' && UUID.test(d.id) && d.id.startsWith(d.prefix))) problems.push(`${at}: id must be null or the full uuid starting with the prefix`);
    if (!ACTIONS.includes(d?.action)) problems.push(`${at}: action must be one of ${ACTIONS.join(', ')}`);
    const pdf = PDF_ACTIONS.includes(d?.action);
    // A PDF action reads the official file: it needs the URL, and a SHA-256 (null while unpinned, see the pin step).
    // The others read the stored text; a URL or hash is provenance and optional, but must be well formed.
    if (pdf || d?.source_url !== undefined) {
      if (typeof d?.source_url !== 'string' || !/^https:\/\//.test(d.source_url)) problems.push(`${at}: source_url must be an https URL`);
    }
    if (pdf ? d?.source_sha256 !== null && !HEX64.test(d?.source_sha256 ?? '') : d?.source_sha256 !== undefined && d.source_sha256 !== null && !HEX64.test(d.source_sha256)) {
      problems.push(`${at}: source_sha256 must be 64 hex characters${pdf ? ' or null (unpinned)' : ''}`);
    }
    if (d?.action === 'strip_cover' && !(typeof d.cover_marker === 'string' && d.cover_marker.length >= 8)) problems.push(`${at}: strip_cover needs a cover_marker of at least 8 characters`);
    if (d?.action === 'ocr') {
      if (!Number.isInteger(d.pages) || d.pages < 1) problems.push(`${at}: ocr needs the page count in pages`);
      if (!OCR_KINDS.includes(d.ocr_kind)) problems.push(`${at}: ocr_kind must be one of ${OCR_KINDS.join(', ')}`);
    }
    for (const f of ['guard_title', 'allow_missing_desk', 'old_text_garbage']) if (d?.[f] !== undefined && typeof d[f] !== 'boolean') problems.push(`${at}: ${f} must be true or false`);
    if (d?.reason !== undefined && (typeof d.reason !== 'string' || d.reason.trim().length < 10)) problems.push(`${at}: reason must say why (at least 10 characters)`);
    if (d?.action === 'rekey') {
      if (!KEY.test(d.new_document_key ?? '')) problems.push(`${at}: new_document_key must look like bill:2005:96`);
      else if (keys.has(d.new_document_key)) problems.push(`${at}: the same new_document_key as ${keys.get(d.new_document_key)}`);
      else keys.set(d.new_document_key, d.prefix);
      if (typeof d.new_title !== 'string' || !d.new_title.trim()) problems.push(`${at}: rekey needs a new_title`);
      for (const f of ['new_house', 'new_status']) if (d[f] !== undefined && (typeof d[f] !== 'string' || !d[f].trim())) problems.push(`${at}: ${f} must be a non-empty string`);
    }
    if (d?.action === 'retitle_unlink') {
      if (typeof d.new_title !== 'string' || !d.new_title.trim()) problems.push(`${at}: retitle_unlink needs a new_title`);
      // The bill number the text prints, for the identity check (a retitle_unlink has no key to take it from).
      if (d.new_bill_number !== undefined || d.new_bill_year !== undefined) {
        if (!/^(\d{1,4}|[IVXLC]{1,8})$/i.test(String(d.new_bill_number ?? ''))) problems.push(`${at}: new_bill_number must be a number or a Roman numeral`);
        if (!Number.isInteger(d.new_bill_year) || d.new_bill_year < 1900) problems.push(`${at}: new_bill_year must be a four-digit year`);
      }
    }
  }
  // after: a document that must be written after another (a key the other one holds until it moves).
  const known = new Set(manifest.documents.map((d) => d?.prefix));
  for (const d of manifest.documents) {
    if (d?.after === undefined) continue;
    if (!Array.isArray(d.after)) {
      problems.push(`${d.prefix}: after must be a list of prefixes`);
      continue;
    }
    for (const dep of d.after) {
      if (dep === d.prefix) problems.push(`${d.prefix}: after names itself`);
      else if (!known.has(dep)) problems.push(`${d.prefix}: after names ${dep}, which is not in the manifest`);
    }
  }
  const order = orderForWrite(manifest.documents);
  if (!problems.length) {
    const placed = new Set();
    for (const d of order) {
      if ((d.after ?? []).some((dep) => !placed.has(dep))) problems.push(`${d.prefix}: after forms a cycle`);
      placed.add(d.prefix);
    }
  }
  if (manifest.excluded !== undefined) {
    if (!Array.isArray(manifest.excluded)) problems.push('excluded must be a list of { ids, reason }');
    else {
      for (const [i, e] of manifest.excluded.entries()) {
        const bad = !Array.isArray(e?.ids) || !e.ids.length || e.ids.some((id) => !PREFIX.test(id));
        if (bad) problems.push(`excluded[${i}]: ids must be a list of 8-hex prefixes`);
        if (typeof e?.reason !== 'string' || e.reason.trim().length < 10) problems.push(`excluded[${i}]: reason must say why`);
        for (const id of Array.isArray(e?.ids) ? e.ids : []) if (known.has(id)) problems.push(`excluded[${i}]: ${id} is also in documents`);
      }
    }
  }
  return problems;
}

/**
 * The documents in the order they may be written: a document after the ones it names (that are selected),
 * otherwise the manifest order. A name outside the selection is not pulled in; dependencyProblems judges it.
 */
export function orderForWrite(docs) {
  const selected = new Set(docs.map((d) => d.prefix));
  const placed = new Set();
  const out = [];
  const rest = [...docs];
  while (rest.length) {
    const i = rest.findIndex((d) => (d.after ?? []).every((dep) => !selected.has(dep) || placed.has(dep)));
    const [d] = rest.splice(i < 0 ? 0 : i, 1); // a cycle is reported by manifestProblems; do not loop on it here
    placed.add(d.prefix);
    out.push(d);
  }
  return out;
}

/** The problems with writing `doc` now: each document it names in `after` must already be written. */
export function dependencyProblems(doc, written) {
  return (doc.after ?? []).filter((dep) => !written.has(dep)).map((dep) => `${doc.prefix}: ${dep} must be written first (it is named in "after")`);
}

/** Reads and validates the manifest; the SHA-256 of its exact bytes is what --confirm must name. */
export async function loadManifest(file) {
  const bytes = await readFile(file);
  const manifest = JSON.parse(bytes.toString('utf8'));
  const problems = manifestProblems(manifest);
  if (problems.length) throw new Error(`manifest ${file} is not usable:\n  ${problems.join('\n  ')}`);
  return { manifest, sha256: sha256(bytes) };
}

/** Whether the document reads an official PDF: the PDF actions only. A hash on any other action is provenance, and is not downloaded. */
export const usesPdf = (d) => PDF_ACTIONS.includes(d.action);

/** The documents that read a PDF whose hash the manifest does not have yet. */
export const unpinned = (docs) => docs.filter((d) => usesPdf(d) && !d.source_sha256);

/**
 * A copy of the raw manifest with `pins` ([{ prefix, sha }]) written in. Only a null hash is filled in:
 * a pinned one is never replaced, so a changed file is a mismatch to look at, not something to overwrite.
 */
export function withPins(raw, pins) {
  const out = structuredClone(raw);
  for (const { prefix, sha } of pins) {
    const d = out.documents.find((x) => x.prefix === prefix);
    if (!d) throw new Error(`${prefix} is not in the manifest`);
    if (!HEX64.test(sha ?? '')) throw new Error(`${prefix}: the hash to pin must be 64 hex characters`);
    if (d.source_sha256) throw new Error(`${prefix} is already pinned`);
    d.source_sha256 = sha;
  }
  return out;
}

/** The manifest's documents, or those whose prefix is in `only`; an unknown prefix is an error. */
export function selectDocuments(manifest, only = []) {
  if (!only.length) return manifest.documents;
  const known = new Set(manifest.documents.map((d) => d.prefix));
  const unknown = only.filter((p) => !known.has(p));
  if (unknown.length) throw new Error(`--only names no manifest document: ${unknown.join(', ')}`);
  return manifest.documents.filter((d) => only.includes(d.prefix));
}

// ---------------------------------------------------------------------------------------------
// Environment and the read-only reader
// ---------------------------------------------------------------------------------------------

/** KEY=value lines of a dotenv file into `env`, not overriding what is set. Returns whether a file was read. */
export async function loadDotEnv(file, env = process.env) {
  if (!existsSync(file)) return false;
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || env[m[1]]) continue;
    env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return true;
}

export function credentials(env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SECRET_KEY must be set (environment or the --env file)');
  if (!key.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be an sb_secret_... key');
  return { url: url.replace(/\/$/, ''), key };
}

/** The bounds of a uuid column for ids that start with an 8-hex prefix (PostgREST has no LIKE on uuid). */
export function idRange(prefix) {
  return { gte: `${prefix}-0000-0000-0000-000000000000`, lte: `${prefix}-ffff-ffff-ffff-ffffffffffff` };
}

export const DOCUMENT_COLUMNS = 'id,title,file_name,file_url,desk_tier,desk_feature,content_sha256,indexed_at,chunker_version,metadata,source_key,ocr_text,storage_path,extract_hash';

/**
 * The only way this tool reads NTER: GET requests to PostgREST. There is no method argument. Returns
 * { rows, total } where total is the exact count from Content-Range when `count` is asked for.
 */
export function makeReader({ url, key, fetchImpl = fetch }) {
  return async function get(pathAndQuery, { count = false } = {}) {
    const headers = { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' };
    if (count) Object.assign(headers, { prefer: 'count=exact', range: '0-0', 'range-unit': 'items' });
    const res = await fetchImpl(`${url}/rest/v1/${pathAndQuery}`, { method: 'GET', headers });
    const body = await res.text();
    if (!res.ok) throw new Error(`GET ${pathAndQuery.split('?')[0]} -> HTTP ${res.status}: ${body.slice(0, 200)}`);
    let rows;
    try {
      rows = JSON.parse(body);
    } catch {
      throw new Error(`GET ${pathAndQuery.split('?')[0]} returned a body that is not JSON`);
    }
    const range = res.headers.get('content-range');
    const total = range && /\/(\d+)$/.test(range) ? Number(/\/(\d+)$/.exec(range)[1]) : null;
    return { rows, total };
  };
}

/** The query for one manifest document: by full id when the manifest has it, else by prefix range. */
export function documentQuery(doc, columns = DOCUMENT_COLUMNS) {
  const p = new URLSearchParams({ select: columns });
  if (doc.id) {
    p.set('id', `eq.${doc.id}`);
    return `documents?${p}`;
  }
  const { gte, lte } = idRange(doc.prefix);
  return `documents?${p}&id=gte.${gte}&id=lte.${lte}`;
}

/** The desk records that name a bill key: PostgREST GET, read-only. */
export function deskQuery(key) {
  const p = new URLSearchParams({ select: 'tier,feature,row_key,document_key,row', document_key: `eq.${key}` });
  return `desk_rows?${p}`;
}

const BILL_DESK_FEATURE = 'Bill Passage Probability Index';

/**
 * The distinct bill names desk rows give for a key (row.bill_name, spaces collapsed). The Bill desk's own rows
 * are preferred when there are any; otherwise every row is used.
 */
export function deskNames(rows) {
  const names = (list) => [...new Set(list.map((r) => String(r?.row?.bill_name ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const own = names(rows.filter((r) => r?.feature === BILL_DESK_FEATURE));
  return own.length ? own : names(rows);
}

// ---------------------------------------------------------------------------------------------
// OCR plan and spend cap
// ---------------------------------------------------------------------------------------------

/**
 * One row per OCR document: pages, pages already cached, pages still to buy, and the cost of those at
 * `usdPerPage`. `cached` is { prefix: Set of 0-based indexes }.
 */
export function ocrPlan(docs, cached, usdPerPage) {
  const rows = docs.map((d) => {
    const have = cached[d.prefix] ?? new Set();
    const todo = [];
    for (let i = 0; i < d.pages; i++) if (!have.has(i)) todo.push(i);
    return { prefix: d.prefix, pages: d.pages, cached: d.pages - todo.length, todo, usd: todo.length * usdPerPage };
  });
  return { rows, todoPages: rows.reduce((n, r) => n + r.todo.length, 0), usd: rows.reduce((n, r) => n + r.usd, 0) };
}

/** Throws if buying `pages` more would take the total above the cap. */
export function checkSpend({ spentUsd, pages, usdPerPage, maxUsd }) {
  const next = spentUsd + pages * usdPerPage;
  if (next > maxUsd + 1e-9) throw new Error(`OCR spend would reach USD ${next.toFixed(4)}, above --max-usd ${maxUsd} (already spent ${spentUsd.toFixed(4)})`);
}

/** Runs of at most `size` consecutive indexes from an ascending list. */
export function pageRuns(indexes, size) {
  const runs = [];
  for (const i of indexes) {
    const last = runs[runs.length - 1];
    if (last && last.length < size && i === last[last.length - 1] + 1) last.push(i);
    else runs.push([i]);
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------
// Write gate and read-back
// ---------------------------------------------------------------------------------------------

/**
 * Everything that must hold before `write` posts anything. Returns the problems; the command refuses if there
 * is one.
 *  - --confirm is the SHA-256 of build/review.json (`reviewSha`): the review holds every payload hash and every
 *    new text's hash, so confirming it confirms the content, not the manifest file.
 *  - every payload and every text must be the reviewed one, every document must have been dry-run clean with
 *    that payload, and carry its full id from the manifest;
 *  - a document already written with a different payload is refused unless --rewrite names it;
 *  - an authorization line (--authorized-by) is required;
 *  - a document goes after the ones it names in "after".
 */
export function writeGateProblems({ confirm, reviewSha, manifestSha, authorizedBy, docs, review, currentIds, payloadShas, textShas = {}, dryRuns, written = new Set(), writtenPayloadShas = {}, rewrite = new Set() }) {
  const problems = [];
  if (typeof authorizedBy !== 'string' || !authorizedBy.trim()) problems.push('--authorized-by "<who authorized this write, when, and what>" is required');
  else if (authorizedBy.trim().length < 8) problems.push('--authorized-by must say who authorized the write: a line of text, not a word');
  if (!confirm) return [...problems, '--confirm <SHA-256 of build/review.json> is required'];
  if (!HEX64.test(confirm)) problems.push('--confirm must be the 64-hex SHA-256 of build/review.json');
  else if (confirm !== reviewSha) problems.push(`--confirm does not match the reviewed build (the SHA-256 of build/review.json is ${reviewSha})`);
  if (!review) return [...problems, 'no reviewed build: run build first'];
  if (review.manifest_sha256 !== manifestSha) problems.push('the reviewed build was made from a different manifest: run build again');
  for (const d of docs) {
    const at = d.prefix;
    if (!d.id) problems.push(`${at}: the manifest has no full document id`);
    else if (currentIds[at] !== d.id) problems.push(`${at}: the manifest id is not the row prepare read (${currentIds[at] ?? 'none'})`);
    const r = review.documents?.[at];
    if (!r) problems.push(`${at}: not in the reviewed build`);
    else {
      if (r.ok !== true) problems.push(`${at}: the reviewed build did not pass its checks`);
      if (payloadShas[at] !== r.payload_sha256) problems.push(`${at}: the payload file is not the reviewed one`);
      if (!r.text_sha256) problems.push(`${at}: the reviewed build holds no text_sha256 for it`);
      else if (textShas[at] !== r.text_sha256) problems.push(`${at}: the text in the payload is not the reviewed one`);
    }
    const dry = dryRuns[at];
    if (!dry) problems.push(`${at}: no dry run recorded`);
    else {
      if (dry.payload_sha256 !== payloadShas[at]) problems.push(`${at}: the dry run was for a different payload`);
      if (!WRITABLE_DRY_STATUSES.includes(dry.status)) problems.push(`${at}: the dry run said ${dry.status}${dry.reason ? ` (${dry.reason})` : ''}${dry.error ? `: ${dry.error}` : ''}`);
    }
    if (writtenPayloadShas[at] && writtenPayloadShas[at] !== payloadShas[at] && !rewrite.has(at)) {
      problems.push(`${at}: already written with a different payload; name it with --rewrite ${at} to write the new one over it`);
    }
  }
  // Order: a document goes after the ones it names; those must be written already or come first in this run.
  const done = new Set(written);
  for (const d of orderForWrite(docs)) {
    problems.push(...dependencyProblems(d, done));
    done.add(d.prefix);
  }
  return problems;
}

/** The documents to write now: up to `size` of the ones not written yet, dependencies first. */
export function nextBatch(docs, written, size) {
  const pending = orderForWrite(docs).filter((d) => !written.has(d.prefix));
  const batch = pending.slice(0, size);
  return { batch, remaining: pending.length - batch.length };
}

// ---------------------------------------------------------------------------------------------
// Drift, writer exclusivity, locks
// ---------------------------------------------------------------------------------------------

/** JSON with object keys sorted at every level: the same value always gives the same text. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export const metadataHash = (metadata) => sha256(stableJson(metadata ?? {}));

/** The columns a re-read compares with the prepare snapshot. */
export const DRIFT_COLUMNS = 'id,title,content_sha256,chunker_version,indexed_at,metadata';

/** Why a document must not be written: it is not the row prepare read. */
export function driftProblems(snapshot, live) {
  if (!live) return ['row not found on re-read'];
  const problems = [];
  if (live.id !== snapshot.id) problems.push(`id is ${live.id}, prepare read ${snapshot.id}`);
  for (const f of ['content_sha256', 'title', 'chunker_version']) if (live[f] !== snapshot[f]) problems.push(`${f} changed since prepare (${JSON.stringify(snapshot[f])} -> ${JSON.stringify(live[f])})`);
  const t = (v) => (v ? Date.parse(v) : null);
  if (t(live.indexed_at) !== t(snapshot.indexed_at)) problems.push(`indexed_at changed since prepare (${snapshot.indexed_at ?? 'null'} -> ${live.indexed_at ?? 'null'})`);
  if (metadataHash(live.metadata) !== metadataHash(snapshot.metadata)) problems.push('metadata changed since prepare (hash differs)');
  return problems;
}

/** The active ingestion jobs (queued or running): the only other writers of documents and chunks. PostgREST GET. */
export function ingestJobsQuery() {
  return `ingest_jobs?${new URLSearchParams({ select: 'id,document_id,status,stage,lease_until', status: 'in.(queued,running)' })}`;
}

/**
 * Writer exclusivity (docs/operations/corpus-jobs.md: "project-wide writer exclusivity"): a running job whose lease
 * has not expired is a live claim (ingest_claim in 20261001140000_ingestion_v2.sql); a queued job will be claimed by
 * the worker the moment it is due. Either is a reason not to start.
 */
export function liveClaimProblems(jobs, nowMs = Date.now()) {
  const problems = [];
  const live = jobs.filter((j) => j.status === 'running' && Date.parse(j.lease_until) > nowMs);
  if (live.length) problems.push(`${live.length} ingestion job(s) hold a live claim (status running, lease not expired): another writer is active`);
  const queued = jobs.filter((j) => j.status === 'queued');
  if (queued.length) problems.push(`${queued.length} queued ingestion job(s) would be claimed by the worker: wait for them or settle them first`);
  return problems;
}

/**
 * What to do with a write lock found on disk (corpus-jobs.md: never remove an active, unknown or foreign-host
 * lock; a verified dead same-host lock may be reclaimed). 'free' | 'reclaim' | 'blocked'.
 */
export function lockDecision(lock, me, isAlive) {
  if (lock === null || lock === undefined) return 'free';
  if (typeof lock !== 'object' || !lock.host || !Number.isInteger(lock.pid) || !lock.token) return 'blocked';
  if (lock.host !== me.host) return 'blocked';
  return isAlive(lock.pid) ? 'blocked' : 'reclaim';
}

// ---------------------------------------------------------------------------------------------
// Embedding cost
// ---------------------------------------------------------------------------------------------

/**
 * What the embedding of a batch would cost. For each document: the chunker's own token estimate over all the
 * chunks of the new text, scaled by the share the dry run says is new (inserted / chunks): chunks that keep their
 * hash are not embedded again. `items`: [{ prefix, rows: [{ tokenEstimate }], chunks, inserted }].
 */
export function embedEstimate(items, usdPerToken) {
  const documents = items.map((it) => {
    const all = it.rows.reduce((n, r) => n + r.tokenEstimate, 0);
    const tokens = it.chunks ? Math.round((all * Math.min(it.inserted, it.chunks)) / it.chunks) : 0;
    return { prefix: it.prefix, tokens, usd: tokens * usdPerToken };
  });
  const tokens = documents.reduce((n, d) => n + d.tokens, 0);
  return { documents, tokens, usd: tokens * usdPerToken };
}

export function embedCapProblems(est, maxUsd) {
  return est.usd > maxUsd + 1e-12 ? [`the expected embedding cost USD ${est.usd.toFixed(4)} is above --max-embed-usd ${maxUsd}`] : [];
}

// ---------------------------------------------------------------------------------------------
// OCR cache
// ---------------------------------------------------------------------------------------------

/** Every response that was paid for counts against the cap, whether or not it validated. */
export function spentOnParts(parts) {
  return Math.round(parts.reduce((n, p) => n + (p.cost_usd ?? 0), 0) * 1e6) / 1e6;
}

/**
 * Whether the cached OCR parts of a document may be built from: each validated, was made from the pinned PDF
 * (`source_sha256`), with the model and request flags this tool uses, and together they cover pages 0 to pages - 1.
 */
export function ocrCacheProblems(parts, { sha, pages }) {
  if (!sha) return ['the PDF is not pinned, so the cached OCR cannot be tied to it'];
  if (!parts.length) return ['no cached OCR'];
  const problems = [];
  const covered = new Set();
  for (const [i, p] of parts.entries()) {
    const at = `cached part ${i + 1}`;
    if (p.valid !== true) problems.push(`${at} did not validate`);
    if (p.source_sha256 !== sha) problems.push(`${at}: source_sha256 is ${p.source_sha256 ? String(p.source_sha256).slice(0, 12) : 'missing'}, the pinned PDF is ${sha.slice(0, 12)}`);
    if (p.model_requested !== OCR_MODEL) problems.push(`${at}: model ${p.model_requested ?? 'missing'}, expected ${OCR_MODEL}`);
    if (!p.flags || stableJson(p.flags) !== stableJson(OCR_REQUEST_FLAGS)) problems.push(`${at}: request flags are not this tool's`);
    for (const pg of p.valid === true ? p.pages ?? [] : []) covered.add(pg.index);
  }
  if (covered.size !== pages || [...covered].some((i) => !(i >= 0 && i < pages))) problems.push(`the cached pages cover ${covered.size} of ${pages} pages`);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Snapshot sums, batch log, retry, authorization
// ---------------------------------------------------------------------------------------------

/** sha256sum-style text for the pre-write snapshots: "<hash>  <file>" per line, sorted. */
export function formatSums(map) {
  return Object.keys(map).sort().map((name) => `${map[name]}  ${name}\n`).join('');
}

export function parseSums(text) {
  const out = {};
  for (const line of text.split('\n').filter(Boolean)) {
    const m = /^([a-f0-9]{64}) {2}(\S+)$/.exec(line);
    if (!m) throw new Error(`not a sums line: ${line.slice(0, 40)}`);
    out[m[2]] = m[1];
  }
  return out;
}

/** The snapshots (`<prefix>.json`) that are not what prepare recorded: changed, missing, or never recorded. */
export function snapshotProblems(sums, actual, prefixes) {
  const problems = [];
  for (const prefix of prefixes) {
    const name = `${prefix}.json`;
    if (!sums[name]) problems.push(`${prefix}: no recorded hash for the snapshot (not in SHA256SUMS)`);
    else if (actual[name] === undefined) problems.push(`${prefix}: the snapshot file is missing`);
    else if (actual[name] !== sums[name]) problems.push(`${prefix}: the snapshot changed since prepare`);
  }
  return problems;
}

/** Reads a row, and again after `delayMs` while its indexed_at is still null (the write sets it last). */
export async function retryRead(fetchRow, { attempts = 3, delayMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let row = null;
  for (let i = 0; i < attempts; i++) {
    row = await fetchRow();
    if (!row || row.indexed_at) return row;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return row;
}

/** An `unchanged` write only refreshes metadata: indexed_at does not move, so there is no write time to expect after. */
export const readbackWrittenAfter = (record) => (record?.status === 'indexed' ? record.started_at ?? null : null);

/** One entry per batch written, with whether its readback was clean. */
export const addBatch = (log, record) => ({ ...(log ?? {}), batches: [...(log?.batches ?? []), record] });
export const nextBatchNumber = (log) => (log?.batches?.length ?? 0) + 1;

/** review.md with an Authorization section: created on the first write, one more line for each later batch. */
export function withAuthorization(md, { authorizedBy, at, reviewSha, batch }) {
  const line = `- ${at}: ${authorizedBy} (build/review.json ${reviewSha.slice(0, 12)}${batch ? `, batch ${batch}` : ''})\n`;
  return md.includes('## Authorization') ? `${md.trimEnd()}\n${line}` : `${md.trimEnd()}\n\n## Authorization\n\n${line}`;
}

/**
 * Compares what the build intended with what NTER holds after a write. `expected`: { title,
 * document_key, content_sha256, n_chars, chunk_count, chunker_version }. `actual` is the row read
 * back plus chunk_count. Returns the problems.
 */
export function readbackProblems(expected, actual, { writtenAfter = null } = {}) {
  const problems = [];
  if (!actual) return ['row not found'];
  const same = (name, a, b) => {
    if (a !== b) problems.push(`${name}: expected ${JSON.stringify(a)}, found ${JSON.stringify(b)}`);
  };
  same('title', expected.title, actual.title);
  same('document_key', expected.document_key ?? null, actual.document_key ?? null);
  same('content_sha256', expected.content_sha256, actual.content_sha256);
  same('n_chars', String(expected.n_chars), String(actual.n_chars));
  same('chunk_count', expected.chunk_count, actual.chunk_count);
  same('chunker_version', expected.chunker_version, actual.chunker_version);
  if (expected.file_url_ambiguous === true && !['true', true].includes(actual.file_url_ambiguous)) problems.push(`file_url_ambiguous: expected true, found ${JSON.stringify(actual.file_url_ambiguous ?? null)}`);
  if (!actual.indexed_at) problems.push('indexed_at is null: the document is not searchable');
  else if (writtenAfter && Date.parse(actual.indexed_at) < Date.parse(writtenAfter)) problems.push(`indexed_at ${actual.indexed_at} is before the write began (${writtenAfter})`);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// review.md
// ---------------------------------------------------------------------------------------------

const ACTION_RISK = { ocr: 20, reextract: 15, decode: 10, strip_cover: 8, rekey: 5, retitle_unlink: 5 };

/**
 * How much a person should look at this document, for sorting (higher first): a failed check, then each
 * attention note, a re-key whose title disagrees with the title printed in the text, a re-key into a key the
 * desk does not hold or holds under two names, then the action (OCR is the least predictable).
 */
export function riskOf(entry) {
  let r = 0;
  const failed = entry.failed ?? [];
  if (entry.ok === false || failed.length) r += 1000 + 10 * failed.length;
  r += 100 * (entry.notes?.attention?.length ?? 0);
  if (entry.title_choice && entry.title_choice.agreesWithPrinted === false) r += 60;
  const desk = entry.notes?.desk;
  if (desk?.read && (!desk.names?.length || desk.names.length > 1)) r += 80;
  if (entry.checks?.identity?.level === 'look') r += 60;
  if (entry.title_choice?.replacesManifest) r += 30;
  return r + (ACTION_RISK[entry.action] ?? 0);
}

const num = (n) => Number(n ?? 0).toLocaleString('en-US');
const tick = (v) => (v === null || v === undefined || v === '' ? 'none' : `\`${v}\``);

function titleGuardLine(g) {
  if (!g) return 'not run';
  if (g.skipped) return `skipped (${g.skipped})`;
  const base = g.ok ? (g.softened ? `ok, but ${g.softened} (see LOOK)` : 'ok') : `FAILED (${(g.reasons ?? []).join(', ')})`;
  const detail = g.words ? ` matched ${g.matched?.length ?? 0}/${g.words.length}${g.missing?.length ? `; missing: ${g.missing.join(', ')}` : ''}` : '';
  return `${base} —${detail}`;
}

function ocrLines(c) {
  const out = [];
  if (c.charsPerPage !== null && c.charsPerPage !== undefined) out.push(`- OCR: ${c.pages} pages, ${num(c.charsPerPage)} characters a page${c.lowDensity ? ' (THIN: under 600)' : ''}`);
  if (c.paragraphs) {
    const p = c.paragraphs;
    const yn = (v) => (v ? 'yes' : 'no');
    out.push(`- Numbered paragraphs: ${p.count}, first ${p.first ?? 'none'}, last ${p.last ?? 'none'}, starts at 1: ${yn(p.startsAtOne)}, no large gap: ${yn(p.contiguous)}${p.largeGaps?.length ? ` (gaps ${p.largeGaps.map((g) => g.join('-')).join(', ')})` : ''}`);
  }
  if (c.scripts) out.push(`- Scripts: Devanagari ${(c.scripts.devanagariShare * 100).toFixed(1)}%, Latin words not English-like ${(c.scripts.latinNoiseShare * 100).toFixed(1)}%`);
  return out;
}

/**
 * The single page a person reads to check the batch: one block per document, riskiest first, with the action,
 * old and new title and key, old and new character counts, the title guard result on the new text, and the OCR
 * checks. `entries` are the per-document review entries of repair.mjs build.
 */
export function renderReview({ manifestSha, entries, excluded = [], authorization = null }) {
  const ranked = [...entries].sort((a, b) => riskOf(b) - riskOf(a) || String(a.prefix).localeCompare(String(b.prefix)));
  const failed = ranked.filter((e) => e.ok === false).length;
  const look = ranked.filter((e) => e.ok !== false && (e.notes?.attention?.length || riskOf(e) >= 60)).length;
  const byAction = {};
  for (const e of ranked) byAction[e.action] = (byAction[e.action] ?? 0) + 1;
  const out = [
    '# F281 repair: review',
    '',
    `Manifest SHA-256 \`${manifestSha}\`. ${ranked.length} documents (${Object.entries(byAction).map(([a, n]) => `${n} ${a}`).join(', ')}); ${failed} failed their checks, ${look} more need a look. Riskiest first. The checks are aids: read the new text of every OCR document by eye.`,
    '',
  ];
  ranked.forEach((e, i) => {
    const tag = e.ok === false ? 'FAILED' : e.notes?.attention?.length ? 'LOOK' : riskOf(e) >= 60 ? 'LOOK' : 'ok';
    out.push(`## ${i + 1}. \`${e.prefix}\` ${e.action} — ${tag}`, '');
    const choice = e.title_choice;
    const replaced = choice?.replacesManifest ? `; the desk title replaces the manifest title ${tick(choice.candidates?.manifest)}` : '';
    out.push(`- Title: ${tick(e.old?.title)} → ${tick(e.new?.title)}${choice ? ` (title source: ${choice.source}${replaced}${choice.agreesWithPrinted === false ? '; differs from the title printed in the text' : ''})` : ''}`);
    out.push(`- Key: ${tick(e.old?.document_key)} → ${tick(e.new?.document_key)}`);
    out.push(`- Characters: ${num(e.old?.chars)} chars → ${num(e.new?.chars)} chars`);
    out.push(`- Title guard on the new text: ${titleGuardLine(e.checks?.title_guard)}`);
    const bi = e.checks?.bill_identity;
    if (bi) out.push(`- Bill No. and article check: ${bi.ok ? 'ok' : 'FAILED'}${bi.problems?.length ? ` — ${bi.problems.join('; ')}` : ''}${bi.notes?.length ? ` (${bi.notes.join('; ')})` : ''}`);
    const id = e.checks?.identity;
    if (id) out.push(`- Identity against the stored text: ${String(id.level ?? '').toUpperCase()} — ${id.reason ?? ''}${id.firstPageTitle ? `; first page reads: ${id.firstPageTitle}` : ''}`);
    if (e.checks?.ocr) out.push(...ocrLines(e.checks.ocr));
    if (e.notes?.empty_pages?.length) out.push(`- Empty OCR pages: ${e.notes.empty_pages.join(', ')}`);
    if (e.notes?.fonts?.length) {
      const shifted = e.notes.fonts.filter((f) => f.verdict === 'shifted');
      out.push(`- Fonts: ${e.notes.fonts.length - shifted.length} plain, ${shifted.length} shifted${shifted.length ? ` (${shifted.map((f) => `${f.font} ${f.reason}`).join(', ')})` : ''}`);
    }
    const desk = e.notes?.desk;
    if (desk?.read) out.push(`- Desk record for the new key: ${desk.names?.length ? desk.names.map(tick).join(', ') : 'NONE FOUND'}${desk.names?.length > 1 ? ' (two names: not chosen between)' : ''}`);
    for (const a of e.notes?.attention ?? []) out.push(`- LOOK: ${a}`);
    for (const f of e.failed ?? []) out.push(`- FAILED check ${f}: ${e.checks?.[f]?.message ?? e.error ?? ''}`);
    if (e.error && !(e.failed ?? []).length) out.push(`- Error: ${e.error}`);
    out.push('');
  });
  if (excluded.length) {
    out.push('## Not in this batch', '');
    for (const x of excluded) out.push(`- ${x.ids.length > 12 ? `${x.ids.length} documents (${x.ids.slice(0, 4).join(', ')}, ...)` : x.ids.join(', ')}: ${x.reason}`);
    out.push('');
  }
  const md = `${out.join('\n')}\n`;
  return authorization ? withAuthorization(md, authorization) : md;
}
