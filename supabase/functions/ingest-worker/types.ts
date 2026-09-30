// Shared interfaces of the ingest worker (docs/specs/2026-10-01-rag-v2-ingestion-v2.md).
// Fixed before the steps are built (plan I0) so the OCR step, the index step and the
// entry point can be written in parallel. Constants and shapes only; no I/O.

import type { MistralBlock, MistralBoxFields, MistralDimensions, MistralTable } from '../_shared/pageText.ts';
import type { EmbedResult } from '../_shared/embed.ts';

// ─── Constants ───────────────────────────────────────────────────────────────

/** The OCR 4.1 id, listed by GET /v1/models on 2026-10-01 (aliases: mistral-ocr-4, mistral-ocr-latest). */
export const OCR_MODEL = 'mistral-ocr-4-1';

/** The approved request flags. Every key here goes into ocr_hash; pages per call does not. */
export const OCR_FLAGS = Object.freeze({
  table_format: 'markdown',
  extract_header: true,
  extract_footer: true,
  include_blocks: true,
  include_image_base64: true,
} as const);
export type OcrFlags = typeof OCR_FLAGS;

export const INGEST = Object.freeze({
  /** Work budget per invocation, under the 150 s response timeout and the Free-plan wall clock. */
  budgetMs: 100_000,
  /** Lease taken by ingest_claim. */
  leaseSeconds: 300,
  /** Pages per OCR call to start; halved per job after a large response. */
  pagesPerCall: 25,
  /** A response body above this halves pages_per_call for the job. */
  largeResponseBytes: 20_000_000,
  /** Signed URL lifetime for Mistral's fetch of a part. */
  signedUrlSeconds: 600,
  /** Image caps (TenderBase): larger images, or those beyond the count on one page, are skipped and noted. */
  maxImageBytes: 5_000_000,
  maxImagesPerPage: 100,
  /** PostgREST db-max-rows: every read is paged in ranges of this size. */
  readPage: 1000,
  /** Chunks embedded and committed per chunk_commit call. */
  commitSlice: 100,
} as const);

/** Storage bucket and content-addressed keys (spec decision 2). */
export const CORPUS_BUCKET = 'corpus';
export const filePath = (sha256: string) => `files/${sha256}.pdf`;
export const imagePath = (sha256: string, ext: 'jpeg' | 'png' | 'webp') => `img/${sha256}.${ext}`;

// ─── Rows ────────────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobStage = 'ocr' | 'index' | 'done';

/** An ingest_jobs row, as ingest_claim returns it. */
export interface IngestJob {
  id: string;
  document_id: string;
  status: JobStatus;
  stage: JobStage;
  /** Copied from documents.file_sha256 at registration; input to ocr_hash. */
  file_sha256: string;
  /** Null until the worker's first step sets them; once set they never change. */
  ocr_hash: string | null;
  extract_hash: string | null;
  model_id: string | null;
  pages_total: number;
  /** Current OCR range size; starts at INGEST.pagesPerCall. */
  pages_per_call: number;
  claim_token: string;
  lease_until: string | null;
  attempts: number;
  next_attempt_at: string | null;
  error_code: string | null;
  last_error: string | null;
  ocr_pages: number;
  ocr_cost_usd: number;
  embed_tokens: number;
  embed_cost_usd: number;
  requested_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** A document_files row: one stored PDF object (a whole PDF, or one part of a split one). */
export interface FilePart {
  document_id: string;
  part_index: number;
  /** Global pages before this part; its part-local index i is global page page_offset + i + 1. */
  page_offset: number;
  page_count: number;
  sha256: string;
  byte_size: number;
  /** files/<sha256>.pdf in the corpus bucket. */
  storage_path: string;
}

/** An image as kept in document_ocr_pages.raw: no base64, the bytes live at img/<sha256>.<ext>. */
export interface RawOcrImage extends MistralBoxFields {
  id: string;
  /** Null when the image was skipped. */
  sha256: string | null;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | null;
  byte_size: number | null;
  skipped?: 'too_large' | 'over_page_cap' | 'no_data' | 'unsupported_type';
}

/**
 * document_ocr_pages.raw: Mistral's page without image base64. `index` is the GLOBAL 0-based page
 * (page_number − 1), rewritten from Mistral's part-local index before storing, so the stored pages
 * feed composeDocument unchanged.
 */
export interface RawOcrPage {
  index: number;
  markdown: string;
  header: string | null;
  footer: string | null;
  dimensions: MistralDimensions | null;
  blocks: MistralBlock[];
  tables: MistralTable[];
  images: RawOcrImage[];
}

/** A row of document_ocr_pages. */
export interface StoredOcrPage {
  page_number: number;
  raw: RawOcrPage;
}

// ─── The OCR call ────────────────────────────────────────────────────────────

export interface OcrRequest {
  model: string;
  document: { type: 'document_url'; document_url: string };
  /** Part-local, 0-based. */
  pages: number[];
  table_format: OcrFlags['table_format'];
  extract_header: boolean;
  extract_footer: boolean;
  include_blocks: boolean;
  include_image_base64: boolean;
}

/** A page as Mistral returns it, images still carrying base64. */
export interface MistralOcrPage {
  index: number;
  markdown: string;
  header?: string | null;
  footer?: string | null;
  dimensions?: MistralDimensions | null;
  blocks?: MistralBlock[];
  tables?: MistralTable[];
  images?: Array<MistralBoxFields & { id: string; image_base64?: string | null }>;
}

export interface OcrCallResult {
  pages: MistralOcrPage[];
  /** The model name echoed by Mistral (it may be an alias of the requested id). */
  model: string;
  pagesProcessed: number;
  docSizeBytes: number | null;
  /** Length of the response body, for the adaptive range. */
  bytes: number;
  latencyMs: number;
}

// ─── Step results ────────────────────────────────────────────────────────────

/** The p jsonb of ingest_advance. Counters are increments; stage only moves forward. */
export interface AdvancePatch {
  stage?: JobStage;
  /** True when the step made progress; resets attempts to 0. */
  progressed: boolean;
  ocr_pages?: number;
  ocr_cost_usd?: number;
  embed_tokens?: number;
  embed_cost_usd?: number;
  pages_per_call?: number;
  /** Set once, by the first step; SQL refuses a different value later. */
  ocr_hash?: string;
  extract_hash?: string;
  model_id?: string;
  /** A reported failure. `permanent` gives `failed`; otherwise backoff. Message is redacted in SQL too. */
  error?: { code: string; message: string; permanent: boolean };
}

/** The p jsonb of ingest_activate. */
export interface ActivatePatch {
  extract_hash: string;
  ocr_text: string;
  content_sha256: string;
  page_count: number;
  embed_tokens: number;
  embed_cost_usd: number;
}

/**
 * What a step returns. `activated` means the step already called ingest_activate (the job is
 * succeeded), so the caller must not call ingest_advance.
 */
export interface StepOutcome {
  patch: AdvancePatch;
  activated?: boolean;
}

/** A failure a step raises on purpose. Anything else thrown is reported as code 'internal', not permanent. */
export class IngestError extends Error {
  code: string;
  permanent: boolean;
  status?: number;
  constructor(code: string, message: string, permanent = false, status?: number) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
    this.permanent = permanent;
    this.status = status;
  }
}

// ─── Written rows ────────────────────────────────────────────────────────────

export interface PageRow {
  document_id: string;
  extract_hash: string;
  page_number: number;
  text: string;
  char_from: number;
  char_to: number;
  header: string | null;
  footer: string | null;
  header_in_text: boolean;
  footer_in_text: boolean;
  width_px: number | null;
  height_px: number | null;
  dpi: number | null;
}

export interface BlockRow {
  document_id: string;
  extract_hash: string;
  page_number: number;
  block_index: number;
  type: string;
  x0: number | null;
  y0: number | null;
  x1: number | null;
  y1: number | null;
  char_from: number | null;
  char_to: number | null;
  content: string | null;
}

export interface ImageRow {
  document_id: string;
  extract_hash: string;
  page_number: number;
  placeholder: string;
  sha256: string;
  mime: string;
  storage_path: string;
  byte_size: number | null;
  x0: number | null;
  y0: number | null;
  x1: number | null;
  y1: number | null;
}

/** A chunk_commit row for a page chunk; `embedding` only when the chunk is new or its embed_hash changed. */
export interface PageCommitRow {
  chunk_hash: string;
  chunk_index: number;
  source_kind: 'pdf_page';
  page_number: number;
  char_from: number;
  char_to: number;
  content: string;
  token_count: number;
  chunker_version: number;
  metadata: Record<string, unknown>;
  block_ids: string[];
  image_ids: string[];
  embed_hash: string;
  embedding?: number[];
}

/** A model_call_logs row, written before the call's results are. */
export interface IngestCallLog {
  caller: 'ingest-worker';
  purpose: 'ocr' | 'embedding';
  model_requested: string;
  model_served: string | null;
  provider: 'mistral' | 'openrouter';
  status: 'success' | 'error';
  error_message: string | null;
  latency_ms: number;
  prompt_tokens: number | null;
  total_tokens: number | null;
  /** 0, never null. */
  cost_usd: number;
  /** Always carries job_id and document_id. */
  raw_usage: { job_id: string; document_id: string } & Record<string, unknown>;
}

// ─── Dependencies ────────────────────────────────────────────────────────────

/**
 * Database access. Every list read takes an inclusive PostgREST range (`from`, `to`), at most
 * INGEST.readPage rows, ordered by the key named; callers page with readAll (paging.ts).
 */
export interface IngestDb {
  claim(limit: number, leaseSeconds: number): Promise<IngestJob[]>;
  /** Rejects (throws) when the token no longer matches. */
  advance(jobId: string, token: string, patch: AdvancePatch): Promise<void>;
  activate(jobId: string, token: string, patch: ActivatePatch): Promise<void>;

  /** Ordered by part_index. */
  files(documentId: string, from: number, to: number): Promise<FilePart[]>;
  /** Stored page numbers for this ocr_hash, ascending. */
  ocrPageNumbers(documentId: string, ocrHash: string, from: number, to: number): Promise<number[]>;
  /** Stored pages for this ocr_hash, by page_number. */
  ocrPages(documentId: string, ocrHash: string, from: number, to: number): Promise<StoredOcrPage[]>;
  /** Upsert on (document_id, ocr_hash, page_number). */
  upsertOcrPages(documentId: string, ocrHash: string, pages: StoredOcrPage[]): Promise<void>;

  /** Upserts on each table's unique key. */
  upsertPages(rows: PageRow[]): Promise<void>;
  upsertBlocks(rows: BlockRow[]): Promise<void>;
  upsertImages(rows: ImageRow[]): Promise<void>;
  /** By (page_number, block_index). */
  blockIds(documentId: string, extractHash: string, from: number, to: number): Promise<Array<{ id: string; page_number: number; block_index: number }>>;
  /** By placeholder. */
  imageIds(documentId: string, extractHash: string, from: number, to: number): Promise<Array<{ id: string; placeholder: string }>>;

  /** The document's stored chunks, by chunk_hash. */
  storedChunks(documentId: string, from: number, to: number): Promise<Array<{ chunk_hash: string; embed_hash: string | null }>>;
  chunkCommit(documentId: string, rows: PageCommitRow[], keep: string[]): Promise<{ inserted: number; kept: number; deleted: number }>;

  logCall(row: IngestCallLog): Promise<void>;
}

/** The corpus bucket, through the service role. */
export interface IngestStorage {
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
  exists(path: string): Promise<boolean>;
  /** Uploads without overwriting; an object that already exists counts as success. */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface WorkerDeps {
  db: IngestDb;
  storage: IngestStorage;
  /** One Mistral OCR call (mistral.ts); throws IngestError classified as rate-limited, transient or permanent. */
  ocr(request: OcrRequest): Promise<OcrCallResult>;
  /** OpenRouter embeddings (_shared/embed.ts); throws EmbeddingError carrying the spend so far. */
  embed(inputs: string[]): Promise<EmbedResult>;
  /** Public URL for a file hash, honoured only when SUPABASE_URL is localhost (entry point decides). */
  documentUrlOverride(sha256: string): string | null;
  now(): number;
  log(event: string, fields: Record<string, unknown>): void;
}

/** A step runs until done or until now() passes the deadline (epoch ms). */
export type Step = (deps: WorkerDeps, job: IngestJob, deadline: number) => Promise<StepOutcome>;
