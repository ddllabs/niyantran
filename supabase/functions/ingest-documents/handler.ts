// ingest-documents: Niyantran's OCR documents → documents + document_chunks.
// Service role only: the bearer must equal the project's secret key. Per
// document: upsert, chunk, embed only the hash misses, chunk_commit, log the
// embedding call. A failing document never aborts the batch. RAG spec §A.

import { corsHeaders, preflight } from '../_shared/cors.ts';
import { errorResponse, HttpError, json } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';
import { sha256Hex } from '../_shared/textNormalise.ts';
import { CHUNK, chunkDocument, type ChunkRow } from '../_shared/chunking.ts';
import { EMBED_MODEL, EmbeddingError, type EmbedResult } from '../_shared/embed.ts';

export const MAX_DOCUMENTS_PER_REQUEST = 50;

export interface IngestDocument {
  source_key: string;
  title: string;
  file_name?: string | null;
  file_url?: string | null;
  desk_tier?: string | null;
  desk_feature?: string | null;
  ocr_text: string;
  metadata?: Record<string, unknown> | null;
}

export interface DocumentRow {
  source_key: string;
  title: string;
  file_name: string | null;
  file_url: string | null;
  desk_tier: string | null;
  desk_feature: string | null;
  content_sha256: string;
  ocr_text: string;
  metadata: Record<string, unknown>;
}

export interface CommitRow {
  chunk_hash: string;
  chunk_index: number;
  source_kind: 'document' | 'pdf_page';
  page_number: number | null;
  char_from: number;
  char_to: number;
  content: string;
  token_count: number;
  chunker_version: number;
  metadata: Record<string, unknown>;
  embedding?: number[];
}

export interface CallLogRow {
  caller: 'ingest-documents';
  purpose: 'embedding';
  model_requested: string;
  model_served: string | null;
  status: 'success' | 'error';
  error_message: string | null;
  latency_ms: number;
  prompt_tokens: number;
  total_tokens: number;
  cost_usd: number;
  raw_usage: Record<string, unknown>;
}

export interface DocumentResult {
  source_key: string;
  status: 'indexed' | 'unchanged' | 'dry_run' | 'error';
  chunks: number;
  inserted: number;
  kept: number;
  deleted: number;
  embedded_tokens: number;
  cost_usd: number;
  error?: string;
}

export interface IngestDeps {
  secretKey: string;
  embed: (inputs: string[]) => Promise<EmbedResult>;
  db: {
    findDocument(sourceKey: string): Promise<{ id: string; content_sha256: string; chunker_version: number | null } | null>;
    /** Insert or update on source_key; clears chunker_version and indexed_at until markIndexed. */
    upsertDocument(row: DocumentRow): Promise<{ id: string }>;
    /** Refresh the descriptive fields of a document whose text and chunks are unchanged. */
    updateDocumentMeta(documentId: string, fields: Omit<DocumentRow, 'ocr_text' | 'content_sha256'>): Promise<void>;
    existingHashes(documentId: string): Promise<Set<string>>;
    chunkCommit(documentId: string, rows: CommitRow[], keep: string[]): Promise<{ inserted: number; kept: number; deleted: number }>;
    markIndexed(documentId: string, chunkerVersion: number): Promise<void>;
    logCall(row: CallLogRow): Promise<void>;
  };
  origins?: string[];
  now?: () => number;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authorised(req: Request, secretKey: string): boolean {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]?.trim();
  return Boolean(bearer && secretKey && timingSafeEqual(bearer, secretKey));
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

export function validateDocument(raw: unknown): IngestDocument {
  const d = (raw ?? {}) as Record<string, unknown>;
  const source_key = str(d.source_key);
  const title = str(d.title);
  if (!source_key) throw new Error('source_key is required');
  if (!title) throw new Error('title is required');
  if (typeof d.ocr_text !== 'string') throw new Error('ocr_text must be a string');
  const metadata = d.metadata && typeof d.metadata === 'object' && !Array.isArray(d.metadata) ? (d.metadata as Record<string, unknown>) : {};
  return {
    source_key,
    title,
    file_name: str(d.file_name),
    file_url: str(d.file_url),
    desk_tier: str(d.desk_tier),
    desk_feature: str(d.desk_feature),
    ocr_text: d.ocr_text,
    metadata,
  };
}

function toCommitRow(r: ChunkRow, embedding?: number[]): CommitRow {
  return {
    chunk_hash: r.chunkHash,
    chunk_index: r.chunkIndex,
    source_kind: r.sourceKind,
    page_number: r.pageNumber ?? null,
    char_from: r.charFrom,
    char_to: r.charTo,
    content: r.content,
    token_count: r.tokenEstimate,
    chunker_version: CHUNK.version,
    metadata: {},
    embedding,
  };
}

/** Drop a repeated chunk (same hash twice in one document) so the unique key holds. */
function dedupe(rows: ChunkRow[]): ChunkRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.chunkHash) ? false : (seen.add(r.chunkHash), true)));
}

export async function ingestOne(deps: IngestDeps, doc: IngestDocument, dryRun: boolean): Promise<DocumentResult> {
  const now = deps.now ?? (() => Date.now());
  const base: DocumentResult = { source_key: doc.source_key, status: 'indexed', chunks: 0, inserted: 0, kept: 0, deleted: 0, embedded_tokens: 0, cost_usd: 0 };
  const sha = await sha256Hex(doc.ocr_text);
  const existing = await deps.db.findDocument(doc.source_key);

  if (existing && existing.content_sha256 === sha && existing.chunker_version === CHUNK.version) {
    const hashes = await deps.db.existingHashes(existing.id);
    if (!dryRun) {
      // Same text, same chunks: only the descriptive fields can have changed (a title,
      // a URL, a document key learned later). Refresh them; touch nothing else.
      await deps.db.updateDocumentMeta(existing.id, {
        source_key: doc.source_key,
        title: doc.title,
        file_name: doc.file_name ?? null,
        file_url: doc.file_url ?? null,
        desk_tier: doc.desk_tier ?? null,
        desk_feature: doc.desk_feature ?? null,
        metadata: doc.metadata ?? {},
      });
    }
    return { ...base, status: 'unchanged', chunks: hashes.size, kept: hashes.size };
  }

  const rows = dedupe(await chunkDocument(doc.ocr_text));
  base.chunks = rows.length;

  if (dryRun) {
    const hashes = existing ? await deps.db.existingHashes(existing.id) : new Set<string>();
    const kept = rows.filter((r) => hashes.has(r.chunkHash)).length;
    return { ...base, status: 'dry_run', kept, inserted: rows.length - kept, deleted: hashes.size - kept };
  }

  const { id } = await deps.db.upsertDocument({
    source_key: doc.source_key,
    title: doc.title,
    file_name: doc.file_name ?? null,
    file_url: doc.file_url ?? null,
    desk_tier: doc.desk_tier ?? null,
    desk_feature: doc.desk_feature ?? null,
    content_sha256: sha,
    ocr_text: doc.ocr_text,
    metadata: doc.metadata ?? {},
  });
  const hashes = await deps.db.existingHashes(id);
  const misses = rows.filter((r) => !hashes.has(r.chunkHash));

  const vectors = new Map<string, number[]>();
  if (misses.length) {
    const started = now();
    try {
      const r = await deps.embed(misses.map((m) => m.content));
      misses.forEach((m, i) => vectors.set(m.chunkHash, r.vectors[i]));
      base.embedded_tokens = r.promptTokens;
      base.cost_usd = r.costUsd;
      await deps.db.logCall({
        caller: 'ingest-documents',
        purpose: 'embedding',
        model_requested: EMBED_MODEL,
        model_served: r.model,
        status: 'success',
        error_message: null,
        latency_ms: now() - started,
        prompt_tokens: r.promptTokens,
        total_tokens: r.promptTokens,
        cost_usd: r.costUsd,
        raw_usage: { requests: r.requests, inputs: misses.length },
      });
    } catch (err) {
      const spent = err instanceof EmbeddingError ? { tokens: err.promptTokens, cost: err.costUsd } : { tokens: 0, cost: 0 };
      await deps.db.logCall({
        caller: 'ingest-documents',
        purpose: 'embedding',
        model_requested: EMBED_MODEL,
        model_served: null,
        status: 'error',
        error_message: (err as Error).message,
        latency_ms: now() - started,
        prompt_tokens: spent.tokens,
        total_tokens: spent.tokens,
        cost_usd: spent.cost,
        raw_usage: { inputs: misses.length, status: err instanceof EmbeddingError ? err.status ?? null : null },
      });
      throw err;
    }
  }

  const commit = rows.map((r) => toCommitRow(r, vectors.get(r.chunkHash)));
  const result = await deps.db.chunkCommit(id, commit, rows.map((r) => r.chunkHash));
  await deps.db.markIndexed(id, CHUNK.version);
  return { ...base, ...result };
}

export async function handleIngest(req: Request, deps: IngestDeps): Promise<Response> {
  const pre = preflight(req, deps.origins);
  if (pre) return pre;
  const cors = corsHeaders(req, deps.origins);
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    if (!authorised(req, deps.secretKey)) throw new HttpError(401, 'service key required');
    const body = (await req.json().catch(() => null)) as { documents?: unknown; dry_run?: unknown } | null;
    if (!body || !Array.isArray(body.documents)) throw new HttpError(400, 'body must be { documents: [...] }');
    if (body.documents.length > MAX_DOCUMENTS_PER_REQUEST) {
      throw new HttpError(413, `at most ${MAX_DOCUMENTS_PER_REQUEST} documents per request`);
    }
    const dryRun = body.dry_run === true;

    const results: DocumentResult[] = [];
    for (const raw of body.documents) {
      let doc: IngestDocument | null = null;
      try {
        doc = validateDocument(raw);
        results.push(await ingestOne(deps, doc, dryRun));
      } catch (err) {
        const source_key = doc?.source_key ?? String((raw as { source_key?: unknown })?.source_key ?? '?');
        results.push({ source_key, status: 'error', chunks: 0, inserted: 0, kept: 0, deleted: 0, embedded_tokens: 0, cost_usd: 0, error: (err as Error).message });
        log('ingest.document_failed', { source_key, message: (err as Error).message });
      }
    }
    const totals = {
      documents: results.length,
      indexed: results.filter((r) => r.status === 'indexed').length,
      unchanged: results.filter((r) => r.status === 'unchanged').length,
      errors: results.filter((r) => r.status === 'error').length,
      embedded_tokens: results.reduce((n, r) => n + r.embedded_tokens, 0),
      cost_usd: results.reduce((n, r) => n + r.cost_usd, 0),
    };
    log('ingest.batch', { dry_run: dryRun, ...totals });
    return json({ results, totals }, 200, cors);
  } catch (err) {
    log('ingest.failed', { status: err instanceof HttpError ? err.status : 500, message: (err as Error).message });
    return errorResponse(err, cors);
  }
}
