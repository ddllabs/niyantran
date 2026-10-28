/** Read-only administrative export. Receipts detect edits; they are not signed approval evidence. */
import { open, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;


const MAX_RESPONSE_BYTES = 8_000_000;
const smallText = max => value => typeof value === 'string' && value.length <= max;
const nullable = check => value => value === null || check(value);
const integer = max => value => Number.isSafeInteger(value) && value >= 0 && value <= max;
const boolean = value => typeof value === 'boolean';
const choice = values => value => values.includes(value);
const uuid = value => typeof value === 'string' && UUID.test(value);
function metadataObject(value, fields, required = Object.keys(fields)) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && required.every(key => Object.hasOwn(value, key))
    && Object.entries(value).every(([key, field]) => Object.hasOwn(fields, key) && fields[key](field));
}
const jobFields = {
  job_id: uuid, status: choice(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  stage: smallText(64), error_code: nullable(smallText(100)),
};
const documentFields = {
  document_id: uuid, source_key: smallText(2048), title: smallText(500), source_url: nullable(smallText(4096)),
  text_sha256: value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), indexed: boolean,
  chunks_scanned: integer(1001), vectors_scanned: integer(1001), inspection_limited: boolean,
  index_state: choice(['registered', 'inspection_limited', 'incomplete', 'indexed']), cohort: nullable(smallText(300)),
  association_kind: choice(['law', 'ordinary', 'bill', 'unresolved_legacy_key', 'unassociated']),
  publication_state: choice(['not_managed', 'hidden', 'pending', 'held', 'published']),
  job: nullable(value => metadataObject(value, jobFields)), identity_ok: boolean,
  role: smallText(300), version: smallText(300), published: boolean,
};
const linkFields = ['identity_ok', 'role', 'version', 'published'];
const normalDocumentFields = Object.keys(documentFields).filter(key => !linkFields.includes(key));
const limitedDocumentFields = {
  document_id: uuid, index_state: value => value === 'inspection_limited', inspection_limited: value => value === true,
  identity_ok: boolean, role: smallText(300), version: smallText(300), published: boolean,
};
function documentMetadata(value, linked = false) {
  // Only nested record links may use the RPC's request-budget placeholder. A
  // documents page always returns the complete normal diagnostic shape, even
  // when its chunk probe is limited. Partial hybrids are never complete evidence.
  if (linked && metadataObject(value, limitedDocumentFields)) return true;
  return metadataObject(value, documentFields, linked ? Object.keys(documentFields) : normalDocumentFields)
    && (linked || linkFields.every(key => !Object.hasOwn(value, key)))
    && value.vectors_scanned <= value.chunks_scanned
    && value.inspection_limited === (value.chunks_scanned > 1000);
}
const recordFields = {
  row_key: smallText(1024), document_key: nullable(smallText(1024)), title: smallText(500),
  association_adapter: choice(['law', 'bill', 'ordinary']),
  state: choice(['inspection_limited', 'held', 'unmapped', 'privileged_ready', 'partial', 'not_ready']),
  links_limited: boolean, ready_documents: integer(24),
  documents: value => Array.isArray(value) && value.length <= 24 && value.every(doc => documentMetadata(doc, true)),
};
/** Bound bytes while streaming; do not allocate or parse an unbounded response body. */
async function readinessJson(response, controller) {
  if (!response.body) throw Error('missing readiness body');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        try { await reader.cancel('readiness response exceeds8MB'); } finally { controller.abort(); }
        throw Error('readiness response exceeds8MB');
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function exportReadiness(options) {
  const { report, release, kind, tier, feature, token, publishableKey, resumeFrom,
    ids = [], cohort = null, limit = 50, maxPages = 1, fetch: request = globalThis.fetch } = options;
  if (!['records', 'documents'].includes(kind) || !tier || !feature || !release || !report) {
    throw Error('kind, tier, feature, release and new report are required');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('limit must be1..100');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20) throw Error('max-pages must be1..20');
  const validId = v => typeof v === 'string' && v.length > 0 && v.length <= 1024 && (kind === 'records' || UUID.test(v));
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(x => !validId(x)) || (kind === 'records' && cohort)
    || (cohort !== null && (typeof cohort !== 'string' || !cohort || cohort.length > 300))) throw Error('invalid exact filters');
  const target = new URL(options.target);
  if (target.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(target.hostname) || target.username
    || target.password || target.search || target.hash || target.pathname !== '/') throw Error('explicit Supabase HTTPS target required');
  let role;
  try { role = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString()).role; } catch { /* refused below */ }
  if (role !== 'authenticated' || !publishableKey || /^(sb_secret_|eyJ)/.test(publishableKey)) {
    throw Error('authenticated admin access token and publishable key required');
  }
  const filters = { kind, tier, feature, ids: [...new Set(ids)], cohort, limit };
  const scope = { target: target.origin, release, filters, contract_version: 1 };
  const scopeSha = digest(scope);
  function cursorValue(value) {
    if (typeof value !== 'string' || value.length > 4096) return null;
    try {
      const c = JSON.parse(value);
      return c.kind === kind && c.tier === tier && c.feature === feature && c.cohort === cohort
        && JSON.stringify(c.ids) === JSON.stringify(filters.ids) && validId(c.after) ? c : null;
    } catch { return null; }
  }
  function validatePage(page, inputCursor, seenCursors, entities) {
    if (page.ok !== true || page.contract_version !== 1 || page.visibility !== 'admin' || !Array.isArray(page.items)
      || page.items.length > limit || typeof page.observed_at !== 'string' || !Number.isFinite(Date.parse(page.observed_at))
      || typeof page.has_more !== 'boolean' || (!page.has_more && page.next_cursor !== null)) throw Error('unconfirmed readiness page');
    const next = page.has_more ? cursorValue(page.next_cursor) : null;
    if (page.has_more && (!next || !page.items.length || page.next_cursor === inputCursor || seenCursors.has(page.next_cursor))) {
      throw Error('unconfirmed readiness cursor');
    }
    let last;
    for (const item of page.items) {
      const identity = item?.[kind === 'records' ? 'row_key' : 'document_id'];
      if (!validId(identity) || entities.has(identity) || (filters.ids.length && !filters.ids.includes(identity))
        || (kind === 'records' ? !metadataObject(item, recordFields) : !documentMetadata(item))) {
        throw Error('unconfirmed readiness identity');
      }
      entities.add(identity); last = identity;
    }
    if (next && next.after !== last) throw Error('unconfirmed readiness cursor position');
    if (next) seenCursors.add(page.next_cursor);
  }
  let cursor = null;
  let resumeHash = null;
  if (resumeFrom) {
    if ((await stat(resumeFrom)).size > 8_000_000) throw Error('resume report too large');
    const bytes = await readFile(resumeFrom);
    if (bytes.length > 8_000_000) throw Error('resume report too large');
    try {
      const rows = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
      const first = rows[0], last = rows.at(-1);
      if (first?.type !== 'manifest' || first.scope_sha256 !== scopeSha
        || digest({ target: first.target, release: first.release, filters: first.filters, contract_version: first.contract_version }) !== scopeSha) {
        throw Error('scope mismatch');
      }
      let previous = null;
      for (const row of rows) {
        const { row_sha256, ...content } = row;
        if (content.previous_sha256 !== previous || row_sha256 !== digest(content)) throw Error('receipt hash mismatch');
        previous = row_sha256;
      }
      let expected = first.starting_cursor;
      if (!(expected === null || cursorValue(expected))) throw Error('initial cursor mismatch');
      const seen = new Set(expected ? [expected] : []), entities = new Set();
      let pages = 0;
      for (const page of rows.slice(1, -1)) {
        if ((pages > 0 && expected === null) || page.type !== 'page' || page.page !== ++pages || page.input_cursor !== expected) throw Error('page continuity mismatch');
        validatePage(page, expected, seen, entities); expected = page.next_cursor;
      }
      if (last?.type !== 'checkpoint' || !['page_limit', 'unknown'].includes(last.status)
        || last.pages !== pages || last.next_cursor !== expected || !cursorValue(expected)) throw Error('checkpoint mismatch');
      cursor = expected; resumeHash = previous;
    } catch { throw Error('resume filters, release, receipt integrity or checkpoint mismatch'); }
  }
  const out = await open(report, 'wx', 0o600);
  let pages = 0, previousHash = null;
  async function append(row) {
    const content = { ...row, previous_sha256: previousHash };
    previousHash = digest(content);
    await out.write(JSON.stringify({ ...content, row_sha256: previousHash }) + '\n');
    await out.sync();
  }
  try {
    await append({ type: 'manifest', ...scope, scope_sha256: scopeSha, complete_alias_inventory: false,
      resume_from: resumeFrom || null, resume_receipt_sha256: resumeHash, receipt_scope: 'bounded_segment',
      preceding_segments_verified: false, starting_cursor: cursor, started_at: new Date().toISOString() });
    const seen = new Set(cursor ? [cursor] : []), entities = new Set();
    while (pages < maxPages) {
      const inputCursor = cursor;
      try {
        const controller = new AbortController();
        const response = await request(target.origin + '/functions/v1/admin-ingest', {
          method: 'POST', redirect: 'error',
          headers: { authorization: 'Bearer ' + token, apikey: publishableKey, 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'readiness-' + kind, desk_tier: tier, desk_feature: feature,
            ids: filters.ids, cohort, limit, ...(cursor ? { cursor } : {}) }), signal: AbortSignal.any([AbortSignal.timeout(15_000), controller.signal]),
        });
        const page = await readinessJson(response, controller);
        if (!response.ok) throw Error('unconfirmed readiness status');
        validatePage(page, inputCursor, seen, entities);
        await append({ type: 'page', page: ++pages, input_cursor: inputCursor, ok: true, contract_version: page.contract_version,
          visibility: page.visibility, observed_at: page.observed_at, items: page.items, has_more: page.has_more, next_cursor: page.next_cursor });
        cursor = page.next_cursor;
        if (!page.has_more) break;
      } catch {
        await append({ type: 'checkpoint', status: 'unknown', next_cursor: inputCursor, pages, finished_at: new Date().toISOString() });
        throw Error('unconfirmed readiness response; stopped without retry, readiness is unknown');
      }
    }
    const result = { type: 'checkpoint', status: cursor ? 'page_limit' : 'complete', next_cursor: cursor,
      pages, finished_at: new Date().toISOString() };
    await append(result); return result;
  } finally { await out.close(); }
}
async function main() {
  const args = process.argv.slice(2);
  const o = { ids: [], token: process.env.NTER_INGEST_ACCESS_TOKEN, publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY };
  const names = { '--report': 'report', '--target': 'target', '--release': 'release', '--kind': 'kind', '--tier': 'tier',
    '--feature': 'feature', '--cohort': 'cohort', '--resume-from': 'resumeFrom', '--limit': 'limit', '--max-pages': 'maxPages' };
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1]) throw Error('expected --option value');
    if (args[i] === '--id') o.ids.push(args[i + 1]);
    else if (names[args[i]]) o[names[args[i]]] = ['--limit', '--max-pages'].includes(args[i]) ? Number(args[i + 1]) : args[i + 1];
    else throw Error('unknown option');
  }
  console.log(JSON.stringify(await exportReadiness(o)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
