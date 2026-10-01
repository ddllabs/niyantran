// admin-ingest: wiring. The pure entry point is handler.ts; this module binds AdminIngestDb and
// AdminIngestStorage to supabase-js with the service client (created only after the handler's
// admin check has passed), and serves handleAdminIngest.
//
// Environment (read here only, never logged): SUPABASE_URL, the secret key through
// _shared/supabase.ts, INGEST_WORKER_SECRET, ALLOWED_ORIGINS (through _shared/cors.ts).
//
// Requester emails come from public.user_profiles.email (user_id → email), one read of at most a
// page of ids, rather than the Auth admin API, which can only list users page by page.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log } from '../_shared/logging.ts';
import { secretKey, serviceClient, userClient } from '../_shared/supabase.ts';
import { SHA256, STAGING_PATH } from './contract.ts';
import {
  type AdminIngestDb,
  type AdminIngestStorage,
  type DbError,
  type DbResult,
  handleAdminIngest,
  type RawJobRow,
} from './handler.ts';

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Env = (name: string) => string | undefined;

export const CORPUS_BUCKET = 'corpus';
/** PostgREST's max_rows: a wider range would be cut short without saying so. */
export const READ_PAGE = 1000;
/** Documents sharing one file_sha256: a handful at most; one page is plenty. */
const SAME_FILE_PAGE = 100;
export const WORKER_START_TIMEOUT_MS = 3_000;

const CONTENT_ADDRESS = /^files\/[0-9a-f]{64}\.pdf$/;

// ─── Database ────────────────────────────────────────────────────────────────

function checkPage(op: string, rows: number): void {
  if (!Number.isInteger(rows) || rows < 1 || rows > READ_PAGE) {
    throw new Error(`${op}: a read is at most ${READ_PAGE} rows (asked for ${rows})`);
  }
}

function fail(op: string, error: { message?: string } | null): void {
  if (error) throw new Error(`${op}: ${error.message ?? 'failed'}`);
}

function dbError(error: { message?: unknown; code?: unknown }): DbError {
  return { message: String(error.message ?? ''), code: typeof error.code === 'string' ? error.code : undefined };
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);

/** The embedded row, whether PostgREST sent an object (many-to-one) or a one-element array. */
function one(v: unknown): Record<string, unknown> | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x && typeof x === 'object' ? x as Record<string, unknown> : null;
}

const JOB_COLUMNS = 'id, document_id, status, stage, ocr_pages, pages_total, attempts, next_attempt_at, ' +
  'error_code, last_error, ocr_cost_usd, embed_tokens, embed_cost_usd, requested_by, created_at, finished_at, ' +
  'documents(title, source_key, desk_tier, desk_feature, indexed_at)';

/** AdminIngestDb over PostgREST with the service client (the handler has checked the caller). */
export function supabaseAdminDb(client: () => SupabaseClient): AdminIngestDb {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<DbResult<T>> {
    const { data, error } = await client().rpc(name, args);
    return error ? { data: null, error: dbError(error) } : { data: data as T, error: null };
  }
  const statusStage = (r: DbResult<Record<string, unknown>>): DbResult<{ status: string; stage: string }> =>
    r.error ? r : { data: { status: String(r.data?.status ?? ''), stage: String(r.data?.stage ?? '') }, error: null };

  return {
    async documentsBySha(fileSha256) {
      const { data, error } = await client()
        .from('documents')
        .select('id, source_key, title, indexed_at, ingest_jobs(status, created_at)')
        .eq('file_sha256', fileSha256)
        .order('created_at', { ascending: false, referencedTable: 'ingest_jobs' })
        .limit(1, { referencedTable: 'ingest_jobs' })
        .order('id', { ascending: true })
        .range(0, SAME_FILE_PAGE - 1);
      fail('documents read', error);
      return (data ?? []).map((d: Record<string, unknown>) => ({
        document_id: String(d.id),
        source_key: String(d.source_key ?? ''),
        title: String(d.title ?? ''),
        indexed: d.indexed_at !== null && d.indexed_at !== undefined,
        job_status: strOrNull(one(d.ingest_jobs)?.status),
      }));
    },
    async documentIdBySourceKey(sourceKey) {
      const { data, error } = await client().from('documents').select('id').eq('source_key', sourceKey).maybeSingle();
      fail('documents read', error);
      return data?.id ? String(data.id) : null;
    },
    async documentModules() {
      const { data, error } = await client().rpc('document_modules');
      fail('document_modules', error);
      const out: Array<{ desk_tier: string; desk_feature: string }> = [];
      for (const r of Array.isArray(data) ? data : []) {
        if (typeof r?.desk_tier === 'string' && typeof r?.desk_feature === 'string') {
          out.push({ desk_tier: r.desk_tier, desk_feature: r.desk_feature });
        }
      }
      return out;
    },
    async register(p) {
      const r = await rpc<Record<string, unknown>>('ingest_register', { p });
      if (r.error) return r;
      return {
        data: { document_id: String(r.data?.document_id ?? ''), job_id: String(r.data?.job_id ?? '') },
        error: null,
      };
    },
    async jobs(limit, before) {
      checkPage('ingest_jobs read', limit);
      let q = client().from('ingest_jobs').select(JOB_COLUMNS);
      if (before) q = q.lt('created_at', before);
      const { data, error } = await q
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(0, limit - 1);
      fail('ingest_jobs read', error);
      // The select string is built from a constant, so supabase-js cannot type the rows.
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((r): RawJobRow => {
        const d = one(r.documents) ?? {};
        return {
          job_id: String(r.id),
          document_id: String(r.document_id),
          title: String(d.title ?? ''),
          source_key: String(d.source_key ?? ''),
          desk_tier: strOrNull(d.desk_tier),
          desk_feature: strOrNull(d.desk_feature),
          indexed: d.indexed_at !== null && d.indexed_at !== undefined,
          status: String(r.status ?? ''),
          stage: String(r.stage ?? ''),
          ocr_pages: num(r.ocr_pages),
          pages_total: num(r.pages_total),
          attempts: num(r.attempts),
          next_attempt_at: strOrNull(r.next_attempt_at),
          error_code: strOrNull(r.error_code),
          last_error: strOrNull(r.last_error),
          ocr_cost_usd: num(r.ocr_cost_usd),
          embed_tokens: num(r.embed_tokens),
          embed_cost_usd: num(r.embed_cost_usd),
          requested_by: strOrNull(r.requested_by),
          created_at: String(r.created_at ?? ''),
          finished_at: strOrNull(r.finished_at),
        };
      });
    },
    async emails(userIds) {
      checkPage('user_profiles read', userIds.length);
      const { data, error } = await client()
        .from('user_profiles')
        .select('user_id, email')
        .in('user_id', userIds)
        .range(0, userIds.length - 1);
      fail('user_profiles read', error);
      const out: Record<string, string> = {};
      for (const r of data ?? []) if (typeof r.email === 'string' && r.email) out[String(r.user_id)] = r.email;
      return out;
    },
    retry: async (jobId) => statusStage(await rpc('ingest_retry', { p_job: jobId })),
    cancel: async (jobId) => statusStage(await rpc('ingest_cancel', { p_job: jobId })),
    discard: (documentId) => rpc('ingest_discard', { p_document: documentId }),
  };
}

// ─── Storage ─────────────────────────────────────────────────────────────────

interface StorageErrorShape {
  message?: string;
  status?: number;
  statusCode?: string;
  code?: string;
}

/** As ingest-worker/index.ts: 409, or statusCode "409" / "Duplicate" / "already exists" on older servers. */
function alreadyExists(error: StorageErrorShape): boolean {
  return error.status === 409 || error.statusCode === '409' || error.code === 'ResourceAlreadyExists' ||
    /\b(duplicate|already exists)\b/i.test(error.message ?? '');
}

function statusOf(error: StorageErrorShape): number | undefined {
  return error.status ?? (error.statusCode && /^\d+$/.test(error.statusCode) ? Number(error.statusCode) : undefined);
}

function staging(op: string, path: string): void {
  if (!STAGING_PATH.test(path)) throw new Error(`${op}: refused, not a staging/<uuid>.pdf path`);
}

/**
 * The corpus bucket through the service client. Writes are confined here as well as in the
 * handler: uploads are signed and objects deleted only under staging/, and a move goes only from
 * staging/ to files/<sha256>.pdf. Errors carry the path and Storage's message, never a signed URL
 * or token.
 */
export function supabaseAdminStorage(
  client: () => SupabaseClient,
  fetchObject: (path: string) => Promise<Response>,
): AdminIngestStorage {
  const bucket = () => client().storage.from(CORPUS_BUCKET);
  return {
    async exists(path) {
      const { data, error } = await bucket().exists(path);
      if (data === true) return true;
      if (!error) return false;
      const status = statusOf(error as StorageErrorShape);
      if (status === 400 || status === 404) return false;
      throw new Error(`storage exists ${path}: ${error.message}`);
    },
    async signUpload(path) {
      staging('storage sign upload', path);
      // No options: upsert stays off, so the token can only create a new object.
      const { data, error } = await bucket().createSignedUploadUrl(path);
      if (error || !data?.token) throw new Error(`storage sign upload ${path}: ${error?.message ?? 'no token'}`);
      return { token: data.token };
    },
    async open(path) {
      staging('storage open', path);
      const { data, error } = await bucket().info(path);
      if (error) {
        const status = statusOf(error as StorageErrorShape);
        if (status === 400 || status === 404) return null;
        throw new Error(`storage info ${path}: ${error.message}`);
      }
      return {
        size: typeof data?.size === 'number' ? data.size : null,
        async stream() {
          const res = await fetchObject(path);
          if (!res.ok || !res.body) {
            await res.body?.cancel();
            throw new Error(`storage read ${path}: HTTP ${res.status}`);
          }
          return res.body;
        },
      };
    },
    async move(from, to) {
      staging('storage move', from);
      if (!CONTENT_ADDRESS.test(to) || !SHA256.test(to.slice(6, 70))) {
        throw new Error('storage move: refused, the destination must be files/<sha256>.pdf');
      }
      const { error } = await bucket().move(from, to);
      if (!error) return 'moved';
      if (alreadyExists(error as StorageErrorShape)) return 'exists';
      throw new Error(`storage move ${from}: ${error.message}`);
    },
    async removeStaged(path) {
      staging('storage remove', path);
      const { error } = await bucket().remove([path]);
      if (error) throw new Error(`storage remove ${path}: ${error.message}`);
    },
  };
}

/**
 * GET of one staged object as a stream, with the secret key sent the way supabase-js's storage
 * client sends it. supabase-js's download() would buffer the whole object into a Blob; this lets
 * verify hash it chunk by chunk.
 */
export function objectFetcher(opts: { fetch: Fetch; url: string; key: string }): (path: string) => Promise<Response> {
  return async (path) => {
    staging('storage read', path);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return await opts.fetch(`${opts.url.replace(/\/+$/, '')}/storage/v1/object/${CORPUS_BUCKET}/${encoded}`, {
      method: 'GET',
      headers: { apikey: opts.key, authorization: `Bearer ${opts.key}` },
    });
  };
}

// ─── The worker, the admin check ─────────────────────────────────────────────

/** One POST to ingest-worker (it answers 202 and works in the background). */
export function workerStarter(
  opts: { fetch: Fetch; url: string; secret: string; timeoutMs: number },
): () => Promise<void> {
  return async () => {
    if (!opts.secret) throw new Error('INGEST_WORKER_SECRET is not set');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await opts.fetch(`${opts.url.replace(/\/+$/, '')}/functions/v1/ingest-worker`, {
        method: 'POST',
        headers: { 'x-ingest-secret': opts.secret, 'content-type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`ingest-worker answered HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** is_platform_admin() asked as the caller, so the answer is about this bearer. */
export function platformAdmin(clientFor: (token: string) => SupabaseClient): (token: string) => Promise<boolean> {
  return async (token) => {
    const { data, error } = await clientFor(token).rpc('is_platform_admin');
    if (error) throw new Error(`is_platform_admin: ${error.message}`);
    return data === true;
  };
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export interface Runtime {
  serviceClient: () => SupabaseClient;
  userClient: (token: string) => SupabaseClient;
  fetch: Fetch;
  env: Env;
  secretKey: () => string;
}

export function createAdminIngestHandler(overrides: Partial<Runtime> = {}): (req: Request) => Promise<Response> {
  const r: Runtime = {
    serviceClient,
    userClient,
    fetch: (input, init) => fetch(input, init),
    env: (name) => Deno.env.get(name),
    secretKey,
    ...overrides,
  };
  const required = (name: string) => {
    const v = r.env(name);
    if (!v) throw new Error(`${name} is not set`);
    return v;
  };
  return (req) =>
    handleAdminIngest(req, {
      isAdmin: platformAdmin(r.userClient),
      db: supabaseAdminDb(r.serviceClient),
      storage: supabaseAdminStorage(
        r.serviceClient,
        (path) => objectFetcher({ fetch: r.fetch, url: required('SUPABASE_URL'), key: r.secretKey() })(path),
      ),
      startWorker: () =>
        workerStarter({
          fetch: r.fetch,
          url: required('SUPABASE_URL'),
          secret: r.env('INGEST_WORKER_SECRET') ?? '',
          timeoutMs: WORKER_START_TIMEOUT_MS,
        })(),
      log: (event, fields) => log(event, fields),
    });
}

if (import.meta.main) Deno.serve(createAdminIngestHandler());
