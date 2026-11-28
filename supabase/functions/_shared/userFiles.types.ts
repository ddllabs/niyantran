/**
 * Feature F341: Private File Manager & AI Indexing — Edge Function TypeScript Contract.
 *
 * Defines database row types, RPC parameter & result interfaces, storage constants,
 * and ingestion worker step contracts for private user file operations in Deno.
 *
 * Specifications & Cross-References:
 * - Central Product Reference: docs/specs/private-file-manager-functionality.md
 * - Technical Spec: docs/specs/2026-11-14-private-file-manager.md
 * - Implementation Plan: docs/plans/2026-11-14-private-file-manager.md
 * - Architecture Decision: docs/decisions/0006-private-file-manager-ingestion-rag-integration.md
 * - Frontend Twin: src/types/fileManager.ts
 */

// ─── Constants & Limits ──────────────────────────────────────────────────────

/** Dedicated private Supabase Storage bucket for owner-isolated user files. */
export const USER_FILES_BUCKET = 'user-files' as const;

/** Maximum allowed upload size per file (50 MB in bytes). */
export const MAX_USER_FILE_BYTES = 52_428_800;

/** Default lease time in seconds acquired when an ingestion worker claims a job. */
export const USER_FILE_JOB_LEASE_SECONDS = 300;

/** Maximum retries for interactive user file jobs before permanent failure. */
export const MAX_USER_FILE_JOB_ATTEMPTS = 3;

/** Storage quota limits in bytes per subscription plan. */
export const USER_STORAGE_QUOTAS = Object.freeze({
  free: 524_288_000,        // 500 MB (Approved product baseline)
  plus: 2_147_483_648,      // 2 GB (Proposed INR tier)
  pro: 5_368_709_120,       // 5 GB (Approved product baseline)
  max: 53_687_091_200,      // 50 GB (Proposed configurable enterprise)
} as const);

// ─── Enums & Value Unions ────────────────────────────────────────────────────

export type UserFileUploadStatus =
  | 'pending_upload'
  | 'uploading'
  | 'uploaded'
  | 'upload_failed';

export type UserFileIndexStatus =
  | 'not_indexed'
  | 'unsupported'
  | 'indexing_queued'
  | 'indexing_extracting'
  | 'indexing_chunking'
  | 'indexed'
  | 'indexing_failed';

export type UserFileJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type UserFileJobStep =
  | 'ocr'
  | 'compose'
  | 'chunk'
  | 'embed'
  | 'commit';

export type UserFilePlanTier = 'free' | 'plus' | 'pro' | 'max';

// ─── Database Row Interfaces ─────────────────────────────────────────────────

/**
 * Mirror of public.user_folders table.
 * Enforces composite foreign key (parent_id, user_id) to prevent cross-tenant nesting.
 */
export interface UserFolderRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  depth: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Mirror of public.user_files table.
 * Stores binary file metadata, upload status, and independent AI indexing state.
 */
export interface UserFileRow {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  upload_status: UserFileUploadStatus;
  index_status: UserFileIndexStatus;
  index_error: string | null;
  page_count: number | null;
  extract_hash: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Mirror of public.user_file_chunks table.
 * Stores 1536-dimensional vector embeddings and chunk metadata for dual-source RAG.
 */
export interface UserFileChunkRow {
  id: string;
  user_id: string;
  file_id: string;
  chunk_hash: string;
  chunk_index: number;
  page_number: number | null;
  char_from: number;
  char_to: number;
  content: string;
  token_count: number;
  text_hash: string;
  extract_hash: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  block_ids: string[];
  image_ids: string[];
  created_at: string;
}

/**
 * Mirror of public.user_file_jobs table.
 * Queue records polled by ingest-worker with per-user fair-share concurrency.
 */
export interface UserFileJobRow {
  id: string;
  file_id: string;
  user_id: string;
  status: UserFileJobStatus;
  step: UserFileJobStep;
  attempt_count: number;
  max_attempts: number;
  claim_token: string | null;
  lease_until: string | null;
  error_code: string | null;
  error_message: string | null;
  credits_hold: number;
  credits_settled: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

// ─── RPC Request & Response Interfaces ───────────────────────────────────────

/**
 * Arguments for public.user_file_prepare_upload RPC.
 * Verifies quota under an advisory transaction lock and reserves storage space.
 */
export interface UserFilePrepareUploadParams {
  p_name: string;
  p_folder_id: string | null;
  p_mime_type: string;
  p_size_bytes: number;
  p_sha256: string;
}

export interface UserFilePrepareUploadResult {
  file_id: string;
  storage_path: string;
  signed_upload_url: string;
  expires_in: number;
}

/**
 * Arguments for public.user_file_complete_upload RPC.
 * Confirms binary transfer and sets upload_status to 'uploaded'.
 */
export interface UserFileCompleteUploadParams {
  p_file_id: string;
  p_client_sha256: string;
}

export interface UserFileCompleteUploadResult {
  success: boolean;
  file: UserFileRow;
  is_indexable: boolean;
}

/**
 * Arguments for public.user_file_claim RPC.
 * Polled by ingest-worker to acquire a fair-share user indexing job lease.
 */
export interface UserFileClaimParams {
  p_worker_id: string;
  p_lease_seconds?: number;
  p_limit?: number;
}

export interface UserFileClaimedJob extends UserFileJobRow {
  storage_path: string;
  file_name: string;
  file_sha256: string;
  file_size_bytes: number;
  page_count?: number | null;
}

export type UserFileClaimResult = UserFileClaimedJob[];

/**
 * Arguments for public.user_file_advance RPC.
 * Checkpoints progress or completes an active ingestion job.
 */
export interface UserFileAdvancePatch {
  step?: UserFileJobStep;
  status?: UserFileJobStatus;
  page_count?: number;
  extract_hash?: string;
  error_code?: string | null;
  error_message?: string | null;
  credits_settled?: number;
}

export interface UserFileAdvanceParams {
  p_job_id: string;
  p_claim_token: string;
  p_step: UserFileJobStep;
  p_patch: UserFileAdvancePatch;
}

export interface UserFileAdvanceResult {
  success: boolean;
}

/**
 * Arguments for public.user_file_settle_credits RPC.
 * Debits user wallet and writes credit ledger entry for OCR & embedding costs.
 */
export interface UserFileSettleCreditsParams {
  p_job_id: string;
  p_final_status: 'completed' | 'failed';
  p_ocr_pages?: number;
  p_embed_tokens?: number;
  p_actual_cost_usd?: number;
  p_actual_cost_paise?: number;
}

export interface UserFileSettleCreditsResult {
  success: boolean;
  credits_settled: number;
  credits_refunded: number;
  ledger_entry_id: string | null;
}

/**
 * Arguments for public.match_user_files RPC.
 * Performs owner-isolated cosine similarity vector search over user_file_chunks.
 */
export interface MatchUserFilesParams {
  query_embedding: number[];
  similarity_threshold?: number;
  match_count?: number;
  filter_file_ids?: string[];
}

export interface MatchUserFilesRow {
  id: string;
  file_id: string;
  file_name: string;
  content: string;
  similarity: number;
  chunk_index: number;
  page_number: number | null;
  char_from: number;
  char_to: number;
  text_hash: string;
  extract_hash: string;
  metadata: Record<string, unknown>;
  block_ids: string[];
  image_ids: string[];
  source_origin: 'private';
}

// ─── Ingestion Step Types (user-file-step.ts) ────────────────────────────────

export interface UserFileStepInput {
  job: UserFileClaimedJob;
  budgetMs: number;
  signal?: AbortSignal;
}

export interface UserFileStepOutcome {
  status: 'completed' | 'failed' | 'checkpointed';
  patch: UserFileAdvancePatch;
  pagesProcessed?: number;
  chunksCommitted?: number;
  costUsd?: number;
  error?: string;
}

/**
 * Payload row format when committing generated vector chunks into user_file_chunks.
 */
export interface UserFileChunkCommitRow {
  chunk_hash: string;
  chunk_index: number;
  page_number: number | null;
  char_from: number;
  char_to: number;
  content: string;
  token_count: number;
  text_hash: string;
  extract_hash: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  block_ids: string[];
  image_ids: string[];
}

/**
 * Checkpointed Mistral OCR page data for an in-flight user file job.
 */
export interface UserFileOcrPageCheckpoint {
  page_number: number;
  text: string;
  header: string | null;
  footer: string | null;
  width_px: number | null;
  height_px: number | null;
}

/**
 * Database client contract required by user-file-step.ts.
 */
export interface UserFileIngestDb {
  claim(workerId: string, limit: number, leaseSeconds: number): Promise<UserFileClaimedJob[]>;
  advance(jobId: string, claimToken: string, patch: UserFileAdvancePatch): Promise<void>;
  commitChunks(
    userId: string,
    fileId: string,
    chunks: UserFileChunkCommitRow[],
  ): Promise<{ inserted: number; deleted: number }>;
  settleCredits(params: UserFileSettleCreditsParams): Promise<UserFileSettleCreditsResult>;
  recordCallLog(log: Record<string, unknown>): Promise<void>;
  getOcrPages?(fileId: string): Promise<UserFileOcrPageCheckpoint[]>;
  saveOcrPages?(fileId: string, pages: UserFileOcrPageCheckpoint[]): Promise<void>;
  updateFileIndexStatus?(fileId: string, status: UserFileIndexStatus, error?: string | null): Promise<void>;
}

export interface UserFileStepDeps {
  db: UserFileIngestDb;
  storage: {
    signedUrl(path: string, expiresInSeconds: number): Promise<string>;
  };
  ocr?: (request: any) => Promise<any>;
  embed?: (texts: string[]) => Promise<any>;
  embedDeps?: any;
  now?: () => number;
  budgetMs?: number;
  reserveMs?: number;
  workerId?: string;
  claimToken?: string;
  getOcrPages?: (fileId: string) => Promise<UserFileOcrPageCheckpoint[]>;
  saveOcrPages?: (fileId: string, pages: UserFileOcrPageCheckpoint[]) => Promise<void>;
  fetch?: typeof fetch;
  mistralApiKey?: string;
  openRouterApiKey?: string;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}
