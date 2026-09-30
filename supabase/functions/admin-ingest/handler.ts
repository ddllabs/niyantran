// admin-ingest: the platform admin's upload backend (docs/specs/2026-10-01-rag-v2-admin-upload.md,
// "admin-ingest"; the contract is ./contract.ts). One POST endpoint, `{ action, ... }`.
//
// Every request: CORS (also on 401/403), requireUser, then is_platform_admin() asked with the
// caller's own token; nothing else is read or written before both pass. The body is read only
// after that, capped at 64 KB while it streams in, and every object sent onwards is built from a
// field whitelist. The work itself goes through AdminIngestDb / AdminIngestStorage, which index.ts
// binds to the service client.
//
// Storage rule: the browser only ever gets signed upload URLs for fresh `staging/<uuid>.pdf`
// paths. `verify` hashes the staged object as a stream and only then moves it to its content
// address, `files/<sha256>.pdf`. The only delete this module performs is of a staged object
// (removeStaged, guarded here and again in index.ts); nothing under `files/` is ever deleted or
// overwritten.

import { createHash } from 'node:crypto';
import { requireUser, type Verify } from '../_shared/auth.ts';
import { corsHeaders, preflight } from '../_shared/cors.ts';
import { DESK_CATALOG } from '../_shared/deskCatalog.ts';
import { HttpError } from '../_shared/http.ts';
import { log as sharedLog } from '../_shared/logging.ts';
import {
  type DeclaredPart,
  type ErrorCode,
  type ExistingDocument,
  type JobRow,
  LIMITS,
  type PreparedPart,
  type RegisterPart,
  SHA256,
  STAGING_PATH,
  STATUS_OF,
  UPLOAD_KEY_PREFIX,
} from './contract.ts';

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface DbError {
  message: string;
  code?: string;
}

/** supabase-js's own result shape: a refusal is a value, not a throw. */
export type DbResult<T> = { data: T; error: null } | { data: null; error: DbError };

/** A jobs row as read, before the requester's email is attached. */
export type RawJobRow = Omit<JobRow, 'requested_by_email'> & { requested_by: string | null };

/** The `p` argument of ingest_register (supabase/migrations/20261001140000_ingestion_v2.sql). */
export interface RegisterPayload {
  source_key: string;
  title: string;
  file_name: string;
  file_url: string | null;
  desk_tier: string;
  desk_feature: string;
  file_sha256: string;
  page_count: number;
  requested_by: string;
  metadata: {
    origin: 'admin-upload';
    uploaded_by: string;
    original_file_name: string;
    note: string | null;
    parts: number;
  };
  files: Array<RegisterPart & { storage_path: string }>;
}

export interface Hasher {
  update(chunk: Uint8Array): void;
  digest(): string;
}

export interface StagedObject {
  /** The size in the object's metadata (storage.objects.metadata.size), when reported. */
  size: number | null;
  /** Opens the object's bytes as a stream; called only once the size matches. */
  stream(): Promise<ReadableStream<Uint8Array>>;
}

export interface AdminIngestDb {
  /** Documents whose file_sha256 is this, with the status of each one's latest job. */
  documentsBySha(fileSha256: string): Promise<ExistingDocument[]>;
  documentIdBySourceKey(sourceKey: string): Promise<string | null>;
  /** The corpus's (desk_tier, desk_feature) pairs, spelled as stored: document_modules(). */
  documentModules(): Promise<Array<{ desk_tier: string; desk_feature: string }>>;
  register(p: RegisterPayload): Promise<DbResult<{ document_id: string; job_id: string }>>;
  /** At most `limit` jobs created before `before` (all when null), newest first. */
  jobs(limit: number, before: string | null): Promise<RawJobRow[]>;
  /** user id → email, for these ids. */
  emails(userIds: string[]): Promise<Record<string, string>>;
  retry(jobId: string): Promise<DbResult<{ status: string; stage: string }>>;
  cancel(jobId: string): Promise<DbResult<{ status: string; stage: string }>>;
  discard(documentId: string): Promise<DbResult<unknown>>;
}

export interface AdminIngestStorage {
  exists(path: string): Promise<boolean>;
  /** A signed upload URL's token for a new object (never upsert). */
  signUpload(path: string): Promise<{ token: string }>;
  /** null when there is no object at the path. */
  open(path: string): Promise<StagedObject | null>;
  /** 'exists' when the destination is already taken; the destination is never overwritten. */
  move(from: string, to: string): Promise<'moved' | 'exists'>;
  /** Deletes an object under staging/ only. */
  removeStaged(path: string): Promise<void>;
}

export interface AdminIngestDeps {
  verify?: Verify;
  /** is_platform_admin() asked with the caller's token. */
  isAdmin(token: string): Promise<boolean>;
  db: AdminIngestDb;
  storage: AdminIngestStorage;
  /** One POST to ingest-worker; a failure only logs. */
  startWorker(): Promise<void>;
  randomUUID?: () => string;
  newHash?: () => Hasher;
  now?: () => number;
  log?: (event: string, fields: Record<string, unknown>) => void;
  origins?: string[];
}

// ─── Refusals ────────────────────────────────────────────────────────────────

class Refusal extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly documentId?: string) {
    super(message);
  }
}

const bad = (message: string) => new Refusal('bad_request', message);

function failure(err: Refusal, headers: Record<string, string>): Response {
  const body: Record<string, unknown> = { ok: false, code: err.code, error: err.message };
  if (err.documentId) body.document_id = err.documentId;
  return reply(body, STATUS_OF[err.code], headers);
}

function reply(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

// ─── Validation ──────────────────────────────────────────────────────────────

type Body = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** An ISO timestamp as PostgREST returns created_at; nothing that could carry a filter. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/;
// Control characters are exactly what this rejects.
// deno-lint-ignore no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/;
const FILE_NAME_MAX = 500;
const URL_MAX = 2048;
const DESK_MAX = 300;

function int(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw bad(`${name} must be an integer from ${min} to ${max}`);
  }
  return v;
}

function sha(v: unknown, name: string): string {
  if (typeof v !== 'string' || !SHA256.test(v)) throw bad(`${name} must be 64 lowercase hex characters`);
  return v;
}

function uuid(v: unknown, name: string): string {
  if (typeof v !== 'string' || !UUID.test(v)) throw bad(`${name} must be a uuid`);
  return v;
}

function text(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string') throw bad(`${name} is required`);
  const s = v.trim();
  if (!s || [...s].length > max) throw bad(`${name} must be 1 to ${max} characters`);
  return s;
}

function object(v: unknown, name: string): Body {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(`${name} must be an object`);
  return v as Body;
}

function partList(v: unknown): unknown[] {
  if (!Array.isArray(v) || v.length === 0) throw bad('parts must be a non-empty array');
  return v;
}

/** Page count and part pages: every part 1..partMaxPages, summing to the whole, at most registerMaxPages. */
function checkPageSum(pageCount: number, parts: Array<{ page_count: number }>): void {
  const sum = parts.reduce((n, p) => n + p.page_count, 0);
  if (sum !== pageCount) throw bad(`parts cover ${sum} pages, page_count is ${pageCount}`);
}

function declaredPart(raw: unknown, i: number): DeclaredPart {
  const p = object(raw, `parts[${i}]`);
  return {
    sha256: sha(p.sha256, `parts[${i}].sha256`),
    byte_size: int(p.byte_size, `parts[${i}].byte_size`, 1, LIMITS.partMaxBytes),
    page_count: int(p.page_count, `parts[${i}].page_count`, 1, LIMITS.partMaxPages),
  };
}

function registerParts(raw: unknown[]): RegisterPart[] {
  let offset = 0;
  return raw.map((r, i) => {
    const p = object(r, `parts[${i}]`);
    const part: RegisterPart = {
      part_index: int(p.part_index, `parts[${i}].part_index`, 0, LIMITS.registerMaxPages),
      page_offset: int(p.page_offset, `parts[${i}].page_offset`, 0, LIMITS.registerMaxPages),
      ...declaredPart(p, i),
    };
    if (part.part_index !== i) {
      throw bad(`parts must be numbered 0..n-1 in order (expected ${i}, got ${part.part_index})`);
    }
    if (part.page_offset !== offset) throw bad(`part ${i} must start at page_offset ${offset}`);
    offset += part.page_count;
    return part;
  });
}

function optionalUrl(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > URL_MAX || CONTROL.test(v)) throw bad('file_url must be an http(s) URL');
  let url: URL;
  try {
    url = new URL(v.trim());
  } catch {
    throw bad('file_url must be an http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw bad('file_url must be an http(s) URL');
  return v.trim();
}

function optionalNote(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw bad('note must be a string');
  const s = v.trim();
  if ([...s].length > LIMITS.noteMaxChars) throw bad(`note must be at most ${LIMITS.noteMaxChars} characters`);
  return s || null;
}

/**
 * Desk module names compared loosely: lowercase, punctuation (including `/`) as spaces, whitespace
 * collapsed. A copy of research-chat/handler.ts `moduleName` (not exported there), so the pair
 * accepted here is the pair research-chat's featureScopeOf would match: the catalogue's
 * "(RBI/SEBI/TRAI/CCI)" and the corpus's "(RBI / SEBI / TRAI / CCI)" are one module.
 */
export function moduleName(s: string): string {
  return s.toLowerCase().replace(/[\p{P}/]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// ─── The body ────────────────────────────────────────────────────────────────

async function readBody(req: Request): Promise<Body> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > LIMITS.bodyMaxBytes) {
    throw new Refusal('too_large', `request body over ${LIMITS.bodyMaxBytes} bytes`);
  }
  if (!req.body) throw bad('body must be JSON');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITS.bodyMaxBytes) {
      await reader.cancel().catch(() => {});
      throw new Refusal('too_large', `request body over ${LIMITS.bodyMaxBytes} bytes`);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
  } catch {
    throw bad('body must be JSON');
  }
  return object(parsed, 'body');
}

// ─── Actions ─────────────────────────────────────────────────────────────────

interface Ctx {
  deps: AdminIngestDeps;
  userId: string;
  log: (event: string, fields: Record<string, unknown>) => void;
}

const contentAddress = (sha256: string) => `files/${sha256}.pdf`;

async function prepare(ctx: Ctx, body: Body): Promise<unknown> {
  const fileSha = sha(body.file_sha256, 'file_sha256');
  const pageCount = int(body.page_count, 'page_count', 1, LIMITS.registerMaxPages);
  const parts = partList(body.parts).map(declaredPart);
  checkPageSum(pageCount, parts);

  const { db, storage } = ctx.deps;
  const found = await db.documentsBySha(fileSha);
  // Live (indexed) documents first; otherwise the order the read gave.
  const documents: ExistingDocument[] = [...found.filter((d) => d.indexed), ...found.filter((d) => !d.indexed)].map((
    d,
  ) => ({
    document_id: d.document_id,
    source_key: d.source_key,
    title: d.title,
    indexed: d.indexed,
    job_status: d.job_status,
  }));

  const newId = ctx.deps.randomUUID ?? (() => crypto.randomUUID());
  const prepared: PreparedPart[] = [];
  for (const part of parts) {
    if (await storage.exists(contentAddress(part.sha256))) {
      prepared.push({ sha256: part.sha256, stored: true });
      continue;
    }
    const stagingPath = `staging/${newId()}.pdf`;
    if (!STAGING_PATH.test(stagingPath)) throw new Error('generated staging path is malformed');
    const { token } = await storage.signUpload(stagingPath);
    prepared.push({ sha256: part.sha256, stored: false, staging_path: stagingPath, token });
  }
  ctx.log('admin_ingest.prepare', {
    action: 'prepare',
    user_id: ctx.userId,
    file_sha256: fileSha,
    parts: parts.length,
    stored: prepared.filter((p) => p.stored).length,
    documents: documents.map((d) => d.document_id),
  });
  return { ok: true, documents, parts: prepared };
}

/** Deletes a staged object, and refuses outright to delete anything else. */
async function removeStaged(ctx: Ctx, path: string): Promise<void> {
  if (!STAGING_PATH.test(path)) throw new Error('refusing to delete outside staging/');
  try {
    await ctx.deps.storage.removeStaged(path);
  } catch (e) {
    // The sweeper removes stale staging objects; the answer does not depend on this delete.
    ctx.log('admin_ingest.staging_delete_failed', { user_id: ctx.userId, staging_path: path, message: messageOf(e) });
  }
}

async function verify(ctx: Ctx, body: Body): Promise<unknown> {
  const path = body.staging_path;
  if (typeof path !== 'string' || !STAGING_PATH.test(path)) throw bad('staging_path must be staging/<uuid>.pdf');
  const want = sha(body.sha256, 'sha256');
  const size = int(body.byte_size, 'byte_size', 1, LIMITS.partMaxBytes);
  const { storage } = ctx.deps;
  const now = ctx.deps.now ?? (() => performance.now());

  const staged = await storage.open(path);
  if (!staged) throw bad('no staged object at staging_path; upload it first');

  const started = now();
  let bytes = 0;
  let hex: string | null = null;
  let outcome: string;
  if (staged.size !== size) {
    outcome = 'size_mismatch';
  } else {
    // Constant memory: each chunk goes into the hash and is dropped. Reading stops as soon as
    // the stream runs past the declared size.
    const hash = ctx.deps.newHash?.() ?? nodeHash();
    const reader = (await staged.stream()).getReader();
    let over = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > size) {
        over = true;
        await reader.cancel().catch(() => {});
        break;
      }
      hash.update(value);
    }
    if (over || bytes !== size) outcome = 'size_mismatch';
    else {
      hex = hash.digest();
      outcome = hex === want ? 'match' : 'hash_mismatch';
    }
  }
  const hashMs = now() - started;

  const fields = { action: 'verify', user_id: ctx.userId, staging_path: path, sha256: want, bytes, hash_ms: hashMs };
  if (outcome !== 'match') {
    await removeStaged(ctx, path);
    ctx.log('admin_ingest.verify', { ...fields, outcome, metadata_size: staged.size, declared_size: size });
    throw new Refusal(
      'hash_mismatch',
      outcome === 'size_mismatch'
        ? 'the staged object is not the declared size; it was deleted'
        : 'the staged object does not match the declared sha256; it was deleted',
    );
  }

  const destination = contentAddress(want);
  let result: 'moved' | 'exists';
  if (await storage.exists(destination)) result = 'exists';
  else result = await storage.move(path, destination);
  // Already stored (a re-upload, or a concurrent verify won): keep the stored object, drop the copy.
  if (result === 'exists') await removeStaged(ctx, path);
  ctx.log('admin_ingest.verify', { ...fields, outcome: result });
  return { ok: true, stored: true, path: destination };
}

function nodeHash(): Hasher {
  const h = createHash('sha256');
  return {
    update: (chunk) => void h.update(chunk),
    digest: () => h.digest('hex'),
  };
}

function resolveDesk(tierIn: unknown, featureIn: unknown, modules: Array<{ desk_tier: string; desk_feature: string }>) {
  const tier = moduleName(text(tierIn, 'desk_tier', DESK_MAX));
  const feature = moduleName(text(featureIn, 'desk_feature', DESK_MAX));
  const same = (t: string, f: string) => moduleName(t) === tier && moduleName(f) === feature;
  const entry = DESK_CATALOG.find((e) => same(e.tier, e.feature));
  if (!entry) throw bad('desk_tier and desk_feature are not a module in the desk catalog');
  // The spelling the corpus already uses for this module, so a feature scope finds every document.
  const corpus = modules.find((m) =>
    typeof m?.desk_tier === 'string' && typeof m.desk_feature === 'string' && same(m.desk_tier, m.desk_feature)
  );
  return corpus
    ? { tier: corpus.desk_tier, feature: corpus.desk_feature }
    : { tier: entry.tier, feature: entry.feature };
}

const ALREADY = /already extracted|already has an active or succeeded job/;

async function register(ctx: Ctx, body: Body): Promise<unknown> {
  const fileSha = sha(body.file_sha256, 'file_sha256');
  const pageCount = int(body.page_count, 'page_count', 1, LIMITS.registerMaxPages);
  const parts = registerParts(partList(body.parts));
  checkPageSum(pageCount, parts);
  const title = text(body.title, 'title', LIMITS.titleMaxChars);
  const note = optionalNote(body.note);
  const fileUrl = optionalUrl(body.file_url);
  const fileName = text(body.file_name, 'file_name', FILE_NAME_MAX);
  if (CONTROL.test(fileName)) throw bad('file_name must not contain control characters');
  // Checked against the catalog before any read, so an unknown pair touches nothing.
  resolveDesk(body.desk_tier, body.desk_feature, []);

  const { db, storage } = ctx.deps;
  const desk = resolveDesk(body.desk_tier, body.desk_feature, await db.documentModules());
  for (const part of parts) {
    if (!(await storage.exists(contentAddress(part.sha256)))) {
      throw new Refusal(
        'refused',
        `part ${part.part_index} is not stored at ${contentAddress(part.sha256)}; upload and verify it first`,
      );
    }
  }

  const sourceKey = `${UPLOAD_KEY_PREFIX}${fileSha}`;
  const payload: RegisterPayload = {
    source_key: sourceKey,
    title,
    file_name: fileName,
    file_url: fileUrl,
    desk_tier: desk.tier,
    desk_feature: desk.feature,
    file_sha256: fileSha,
    page_count: pageCount,
    requested_by: ctx.userId,
    metadata: {
      origin: 'admin-upload',
      uploaded_by: ctx.userId,
      original_file_name: fileName,
      note,
      parts: parts.length,
    },
    files: parts.map((p) => ({
      part_index: p.part_index,
      page_offset: p.page_offset,
      page_count: p.page_count,
      sha256: p.sha256,
      byte_size: p.byte_size,
      storage_path: contentAddress(p.sha256),
    })),
  };
  const { data, error } = await db.register(payload);
  const fields = { action: 'register', user_id: ctx.userId, file_sha256: fileSha, parts: parts.length };
  if (error) {
    const message = String(error.message ?? '');
    if (error.code === '23505' || ALREADY.test(message)) {
      const existing = await db.documentIdBySourceKey(sourceKey).catch(() => null);
      ctx.log('admin_ingest.register', { ...fields, outcome: 'already_uploaded', document_id: existing });
      throw new Refusal('already_uploaded', 'this file is already uploaded', existing ?? undefined);
    }
    if (message.startsWith('ingest_register:')) {
      ctx.log('admin_ingest.register', { ...fields, outcome: 'refused', message });
      throw new Refusal('refused', message);
    }
    ctx.log('admin_ingest.register', { ...fields, outcome: 'error', code: error.code ?? null, message });
    throw new Refusal('unavailable', 'the ingest pipeline is unavailable; try again');
  }
  const documentId = String(data?.document_id ?? '');
  const jobId = String(data?.job_id ?? '');
  ctx.log('admin_ingest.register', { ...fields, outcome: 'registered', document_id: documentId, job_id: jobId });

  try {
    await ctx.deps.startWorker();
  } catch (e) {
    // The schedule picks the job up anyway.
    ctx.log('admin_ingest.worker_start_failed', { user_id: ctx.userId, job_id: jobId, message: messageOf(e) });
  }
  return { ok: true, document_id: documentId, job_id: jobId };
}

async function jobs(ctx: Ctx, body: Body): Promise<unknown> {
  const limit = body.limit === undefined || body.limit === null ? 20 : int(body.limit, 'limit', 1, LIMITS.jobsMaxLimit);
  let before: string | null = null;
  if (body.before !== undefined && body.before !== null) {
    if (typeof body.before !== 'string' || !ISO_TIME.test(body.before) || !Number.isFinite(Date.parse(body.before))) {
      throw bad('before must be an ISO timestamp');
    }
    before = body.before;
  }
  const { db } = ctx.deps;
  // One row more than asked says whether there is a next page.
  const rows = await db.jobs(limit + 1, before);
  const page = rows.slice(0, limit);
  const ids = [...new Set(page.map((r) => r.requested_by).filter((id): id is string => typeof id === 'string'))];
  const emails = ids.length ? await db.emails(ids) : {};
  const out: JobRow[] = page.map((r) => ({
    job_id: r.job_id,
    document_id: r.document_id,
    title: r.title,
    source_key: r.source_key,
    desk_tier: r.desk_tier,
    desk_feature: r.desk_feature,
    status: r.status,
    stage: r.stage,
    ocr_pages: r.ocr_pages,
    pages_total: r.pages_total,
    attempts: r.attempts,
    next_attempt_at: r.next_attempt_at,
    error_code: r.error_code,
    last_error: r.last_error,
    ocr_cost_usd: r.ocr_cost_usd,
    embed_tokens: r.embed_tokens,
    embed_cost_usd: r.embed_cost_usd,
    requested_by_email: r.requested_by ? emails[r.requested_by] ?? null : null,
    created_at: r.created_at,
    finished_at: r.finished_at,
  }));
  const nextBefore = rows.length > limit && page.length ? page[page.length - 1].created_at : null;
  ctx.log('admin_ingest.jobs', { action: 'jobs', user_id: ctx.userId, limit, before, returned: out.length });
  return { ok: true, jobs: out, next_before: nextBefore };
}

async function jobAction(ctx: Ctx, action: 'retry' | 'cancel', body: Body): Promise<unknown> {
  const jobId = uuid(body.job_id, 'job_id');
  const { data, error } = await ctx.deps.db[action](jobId);
  const fields = { action, user_id: ctx.userId, job_id: jobId };
  if (error) {
    const message = String(error.message ?? '');
    ctx.log(`admin_ingest.${action}`, { ...fields, outcome: 'refused', message });
    if (message.startsWith(`ingest_${action}:`)) {
      throw message.includes('does not exist') ? bad('no such job') : new Refusal('refused', message);
    }
    throw new Refusal('unavailable', 'the ingest pipeline is unavailable; try again');
  }
  ctx.log(`admin_ingest.${action}`, { ...fields, outcome: 'ok', status: data?.status });
  return { ok: true, status: String(data?.status ?? ''), stage: String(data?.stage ?? '') };
}

async function discard(ctx: Ctx, body: Body): Promise<unknown> {
  const documentId = uuid(body.document_id, 'document_id');
  const { error } = await ctx.deps.db.discard(documentId);
  const fields = { action: 'discard', user_id: ctx.userId, document_id: documentId };
  if (error) {
    const message = String(error.message ?? '');
    ctx.log('admin_ingest.discard', { ...fields, outcome: 'refused', message });
    if (message.startsWith('ingest_discard:')) {
      throw message.includes('document not found') ? bad('no such document') : new Refusal('not_discardable', message);
    }
    throw new Refusal('unavailable', 'the ingest pipeline is unavailable; try again');
  }
  ctx.log('admin_ingest.discard', { ...fields, outcome: 'discarded' });
  return { ok: true, discarded: true };
}

// ─── The request ─────────────────────────────────────────────────────────────

function messageOf(e: unknown): string {
  return String((e as Error)?.message ?? e).slice(0, 300);
}

export async function handleAdminIngest(req: Request, deps: AdminIngestDeps): Promise<Response> {
  const pre = preflight(req, deps.origins);
  if (pre) return pre;
  const cors = corsHeaders(req, deps.origins);
  const log = deps.log ?? ((event: string, fields: Record<string, unknown>) => sharedLog(event, fields));
  try {
    let caller: { userId: string; token: string };
    try {
      caller = await requireUser(req, deps.verify);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) throw new Refusal('unauthorized', e.message);
      throw e;
    }
    if (!(await deps.isAdmin(caller.token))) {
      log('admin_ingest.forbidden', { user_id: caller.userId });
      throw new Refusal('forbidden', 'platform admins only');
    }
    if (req.method !== 'POST') throw bad('POST only');
    const body = await readBody(req);
    const ctx: Ctx = { deps, userId: caller.userId, log };
    let result: unknown;
    switch (body.action) {
      case 'prepare':
        result = await prepare(ctx, body);
        break;
      case 'verify':
        result = await verify(ctx, body);
        break;
      case 'register':
        result = await register(ctx, body);
        break;
      case 'jobs':
        result = await jobs(ctx, body);
        break;
      case 'retry':
      case 'cancel':
        result = await jobAction(ctx, body.action, body);
        break;
      case 'discard':
        result = await discard(ctx, body);
        break;
      default:
        throw bad('unknown action');
    }
    return reply(result, 200, cors);
  } catch (e) {
    if (e instanceof Refusal) return failure(e, cors);
    log('admin_ingest.error', { message: messageOf(e) });
    return failure(new Refusal('unavailable', 'the ingest service is unavailable; try again'), cors);
  }
}
