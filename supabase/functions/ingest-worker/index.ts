// ingest-worker: wiring. The pure entry point is handler.ts; this module binds IngestDb and
// IngestStorage to supabase-js with the service client, Mistral and OpenRouter to their keys, and
// serves handleWorker (docs/specs/2026-10-01-rag-v2-ingestion-v2.md, "The worker Edge Function").
//
// Environment (read here only, never logged): INGEST_WORKER_SECRET, MISTRAL_API_KEY,
// OPENROUTER_API_KEY, SUPABASE_URL (and the secret key through _shared/supabase.ts). For the local
// end-to-end run only, INGEST_DOCUMENT_URL_OVERRIDE_<file sha256> (see documentUrlOverride).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { embedTexts } from '../_shared/embed.ts';
import { log } from '../_shared/logging.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { handleWorker, type RunDeps } from './handler.ts';
import { indexStep } from './index-step.ts';
import { callMistralOcr } from './mistral.ts';
import { ocrStep } from './ocr.ts';
import {
  CORPUS_BUCKET,
  type FilePart,
  INGEST,
  type IngestDb,
  type IngestJob,
  type IngestStorage,
  type StoredOcrPage,
} from './types.ts';

type Env = (name: string) => string | undefined;

// ─── Database ────────────────────────────────────────────────────────────────

/**
 * Every list read is one PostgREST range. A range wider than db-max-rows would be cut short
 * silently, and the pager would take the short page as the end, so it is refused outright.
 */
function checkRange(op: string, from: number, to: number): void {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to - from + 1 > INGEST.readPage) {
    throw new Error(`${op}: range ${from}-${to} is not a page of at most ${INGEST.readPage} rows`);
  }
}

function fail(op: string, error: { message: string } | null): void {
  if (error) throw new Error(`${op}: ${error.message}`);
}

const ASC = { ascending: true } as const;

/** IngestDb over PostgREST with the service client (RLS bypassed; the handler checked the secret). */
export function supabaseIngestDb(client: SupabaseClient): IngestDb {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    fail(name, error);
    return data as T;
  }

  async function upsert(table: string, rows: unknown[], onConflict: string): Promise<void> {
    if (!rows.length) return;
    const { error } = await client.from(table).upsert(rows, { onConflict });
    fail(`${table} upsert`, error);
  }

  return {
    async claim(limit, leaseSeconds) {
      return (await rpc<IngestJob[] | null>('ingest_claim', { p_limit: limit, p_lease: `${leaseSeconds} seconds` })) ??
        [];
    },
    async advance(jobId, token, patch) {
      await rpc('ingest_advance', { p_job: jobId, p_token: token, p: patch });
    },
    async activate(jobId, token, patch) {
      await rpc('ingest_activate', { p_job: jobId, p_token: token, p: patch });
    },

    async files(documentId, from, to) {
      checkRange('document_files', from, to);
      const { data, error } = await client
        .from('document_files')
        .select('document_id, part_index, page_offset, page_count, sha256, byte_size, storage_path')
        .eq('document_id', documentId)
        .order('part_index', ASC)
        .range(from, to);
      fail('document_files read', error);
      return (data ?? []) as FilePart[];
    },
    async ocrPageNumbers(documentId, ocrHash, from, to) {
      checkRange('document_ocr_pages', from, to);
      const { data, error } = await client
        .from('document_ocr_pages')
        .select('page_number')
        .eq('document_id', documentId)
        .eq('ocr_hash', ocrHash)
        .order('page_number', ASC)
        .range(from, to);
      fail('document_ocr_pages read', error);
      return (data ?? []).map((r) => r.page_number as number);
    },
    async ocrPages(documentId, ocrHash, from, to) {
      checkRange('document_ocr_pages', from, to);
      const { data, error } = await client
        .from('document_ocr_pages')
        .select('page_number, raw')
        .eq('document_id', documentId)
        .eq('ocr_hash', ocrHash)
        .order('page_number', ASC)
        .range(from, to);
      fail('document_ocr_pages read', error);
      return (data ?? []).map((r) => ({ page_number: r.page_number, raw: r.raw }) as StoredOcrPage);
    },
    async upsertOcrPages(documentId, ocrHash, pages) {
      const rows = pages.map((p) => ({
        document_id: documentId,
        ocr_hash: ocrHash,
        page_number: p.page_number,
        raw: p.raw,
      }));
      await upsert('document_ocr_pages', rows, 'document_id,ocr_hash,page_number');
    },

    async upsertPages(rows) {
      await upsert('document_pages', rows, 'document_id,extract_hash,page_number');
    },
    async upsertBlocks(rows) {
      await upsert('document_page_blocks', rows, 'document_id,extract_hash,page_number,block_index');
    },
    async upsertImages(rows) {
      await upsert('document_page_images', rows, 'document_id,extract_hash,placeholder');
    },
    async blockIds(documentId, extractHash, from, to) {
      checkRange('document_page_blocks', from, to);
      const { data, error } = await client
        .from('document_page_blocks')
        .select('id, page_number, block_index')
        .eq('document_id', documentId)
        .eq('extract_hash', extractHash)
        .order('page_number', ASC)
        .order('block_index', ASC)
        .range(from, to);
      fail('document_page_blocks read', error);
      return (data ?? []) as Array<{ id: string; page_number: number; block_index: number }>;
    },
    async imageIds(documentId, extractHash, from, to) {
      checkRange('document_page_images', from, to);
      const { data, error } = await client
        .from('document_page_images')
        .select('id, placeholder')
        .eq('document_id', documentId)
        .eq('extract_hash', extractHash)
        .order('placeholder', ASC)
        .range(from, to);
      fail('document_page_images read', error);
      return (data ?? []) as Array<{ id: string; placeholder: string }>;
    },

    async storedChunks(documentId, from, to) {
      checkRange('document_chunks', from, to);
      const { data, error } = await client
        .from('document_chunks')
        .select('chunk_hash, embed_hash')
        .eq('document_id', documentId)
        .order('chunk_hash', ASC)
        .range(from, to);
      fail('document_chunks read', error);
      return (data ?? []) as Array<{ chunk_hash: string; embed_hash: string | null }>;
    },
    async chunkCommit(documentId, rows, keep) {
      return await rpc<{ inserted: number; kept: number; deleted: number }>('chunk_commit', {
        p_document_id: documentId,
        p_rows: rows,
        p_keep_hashes: keep,
      });
    },

    async logCall(row) {
      const { error } = await client.from('model_call_logs').insert(row);
      fail('model_call_logs insert', error);
    },
  };
}

// ─── Storage ─────────────────────────────────────────────────────────────────

interface StorageErrorShape {
  message?: string;
  status?: number;
  statusCode?: string;
  code?: string;
}

/**
 * Storage reports an existing object as HTTP 409, or (older servers) HTTP 400 with body
 * statusCode "409" / error "Duplicate"; newer ones also send code "ResourceAlreadyExists".
 */
function alreadyExists(error: StorageErrorShape): boolean {
  return error.status === 409 || error.statusCode === '409' || error.code === 'ResourceAlreadyExists' ||
    /\b(duplicate|already exists)\b/i.test(error.message ?? '');
}

function statusOf(error: StorageErrorShape): number | undefined {
  return error.status ?? (error.statusCode && /^\d+$/.test(error.statusCode) ? Number(error.statusCode) : undefined);
}

/**
 * The corpus bucket through the service client. `exists` uses storage-js's own exists() (a HEAD on
 * the object; present in the pinned @supabase/supabase-js@2, storage-js 2.117.2 as cached here),
 * which reports a missing object as data false with a 400/404 error and throws on anything else.
 * Error messages carry the path and Storage's message, never a signed URL.
 */
export function supabaseIngestStorage(client: SupabaseClient): IngestStorage {
  const bucket = () => client.storage.from(CORPUS_BUCKET);
  return {
    async signedUrl(path, expiresInSeconds) {
      const { data, error } = await bucket().createSignedUrl(path, expiresInSeconds);
      if (error || !data?.signedUrl) {
        throw new Error(`storage sign ${path}: ${error?.message ?? 'no signed URL returned'}`);
      }
      return data.signedUrl;
    },
    async exists(path) {
      const { data, error } = await bucket().exists(path);
      if (data === true) return true;
      if (!error) return false;
      const status = statusOf(error as StorageErrorShape);
      if (status === 400 || status === 404) return false;
      throw new Error(`storage exists ${path}: ${error.message}`);
    },
    async upload(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, { upsert: false, contentType });
      if (!error || alreadyExists(error as StorageErrorShape)) return;
      throw new Error(`storage upload ${path}: ${error.message}`);
    },
  };
}

// ─── The local-only URL override ─────────────────────────────────────────────

/**
 * Host names of the local Supabase stack. Inside `supabase functions serve` the edge runtime sees
 * SUPABASE_URL as http://kong:8000 (the gateway container), not localhost, so kong and
 * host.docker.internal are included; a hosted project is always https://<ref>.supabase.co.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'kong', 'host.docker.internal']);

export function isLocalStackUrl(url: string | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
}

/**
 * INGEST_DOCUMENT_URL_OVERRIDE_<sha256>: a public URL Mistral fetches instead of a signed URL, for
 * the local end-to-end run (Mistral cannot reach a laptop). Honoured only when SUPABASE_URL is a
 * local-stack address; on any other SUPABASE_URL the variable is not even read.
 */
export function documentUrlOverride(supabaseUrl: string | undefined, env: Env, sha256: string): string | null {
  if (!isLocalStackUrl(supabaseUrl)) return null;
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const value = env(`INGEST_DOCUMENT_URL_OVERRIDE_${sha256}`);
  if (!value) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export function buildWorkerDeps(client: SupabaseClient, env: Env): RunDeps {
  const mistralKey = env('MISTRAL_API_KEY') ?? '';
  const openrouterKey = env('OPENROUTER_API_KEY') ?? '';
  const supabaseUrl = env('SUPABASE_URL');
  return {
    db: supabaseIngestDb(client),
    storage: supabaseIngestStorage(client),
    // callMistralOcr refuses an empty key with a permanent mistral_key_missing error.
    ocr: (request) => callMistralOcr({ fetch, apiKey: mistralKey }, request),
    embed: (inputs) => embedTexts({ fetch, apiKey: openrouterKey }, inputs),
    documentUrlOverride: (sha256) => documentUrlOverride(supabaseUrl, env, sha256),
    now: Date.now,
    log: (event, fields) => log(event, fields),
    steps: { ocr: ocrStep, index: indexStep },
    secrets: [mistralKey, openrouterKey, env('INGEST_WORKER_SECRET') ?? ''].filter(Boolean),
  };
}

type EdgeRuntimeGlobal = { waitUntil(promise: Promise<unknown>): void };

/** EdgeRuntime.waitUntil in Supabase's runtime; elsewhere the (never-rejecting) work just runs. */
function waitUntil(work: Promise<unknown>): void {
  const edge = (globalThis as { EdgeRuntime?: EdgeRuntimeGlobal }).EdgeRuntime;
  if (edge?.waitUntil) edge.waitUntil(work);
}

// Guarded like ingest-documents/index.ts, so a test can import this module without serving.
if (import.meta.main) {
  const env: Env = (name) => Deno.env.get(name);
  Deno.serve((req) =>
    handleWorker(req, {
      secret: env('INGEST_WORKER_SECRET') ?? '',
      waitUntil,
      worker: () => buildWorkerDeps(serviceClient(), env),
      log: (event, fields) => log(event, fields),
    })
  );
}
