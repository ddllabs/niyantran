// The admin-ingest contract (docs/specs/2026-10-01-rag-v2-admin-upload.md; plan B0). One POST endpoint,
// `{ action, ... }`, called by the admin panel's Documents tab (src/lib/corpusUpload.js mirrors these
// shapes in JSDoc). Shapes and constants only; no I/O.

// ─── Limits ──────────────────────────────────────────────────────────────────

export const LIMITS = Object.freeze({
  /** Mistral's per-file limit, decimal (the corpus bucket's file_size_limit). */
  partMaxBytes: 50_000_000,
  partMaxPages: 1000,
  /** Server-side cost guard: pages per registration (about $20 of OCR). */
  registerMaxPages: 5000,
  /** Request bodies are refused beyond this while reading. */
  bodyMaxBytes: 64 * 1024,
  titleMaxChars: 300,
  noteMaxChars: 2000,
  jobsMaxLimit: 50,
} as const);

export const STAGING_PATH = /^staging\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;
export const SHA256 = /^[0-9a-f]{64}$/;
export const UPLOAD_KEY_PREFIX = 'upload:';

// ─── Errors ──────────────────────────────────────────────────────────────────

export type ErrorCode =
  | 'bad_request' // 400
  | 'unauthorized' // 401
  | 'forbidden' // 403
  | 'already_uploaded' // 409
  | 'not_discardable' // 409
  | 'too_large' // 413
  | 'hash_mismatch' // 422
  | 'refused' // 422
  | 'unavailable'; // 503

export const STATUS_OF: Readonly<Record<ErrorCode, number>> = Object.freeze({
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  already_uploaded: 409,
  not_discardable: 409,
  too_large: 413,
  hash_mismatch: 422,
  refused: 422,
  unavailable: 503,
});

export interface Failure {
  ok: false;
  code: ErrorCode;
  error: string;
  /** Set with already_uploaded when the existing document is known. */
  document_id?: string;
}

// ─── Requests ────────────────────────────────────────────────────────────────

export interface DeclaredPart {
  sha256: string;
  byte_size: number;
  page_count: number;
}

export interface RegisterPart extends DeclaredPart {
  part_index: number;
  page_offset: number;
}

export type Request =
  | { action: 'prepare'; file_sha256: string; page_count: number; parts: DeclaredPart[] }
  | { action: 'verify'; staging_path: string; sha256: string; byte_size: number }
  | {
    action: 'register';
    file_sha256: string;
    page_count: number;
    parts: RegisterPart[];
    title: string;
    desk_tier: string;
    desk_feature: string;
    file_url?: string | null;
    note?: string | null;
    file_name: string;
  }
  | { action: 'jobs'; limit?: number; before?: string | null }
  | { action: 'retry'; job_id: string }
  | { action: 'cancel'; job_id: string }
  | { action: 'discard'; document_id: string };

// ─── Responses ───────────────────────────────────────────────────────────────

/** A document that already holds this file (same file_sha256), activated first. */
export interface ExistingDocument {
  document_id: string;
  source_key: string;
  title: string;
  /** indexed_at is set: the document is live in search. */
  indexed: boolean;
  /** Status of its latest ingest job, if any. */
  job_status: string | null;
}

export type PreparedPart =
  | { sha256: string; stored: true }
  | { sha256: string; stored: false; staging_path: string; token: string };

export interface PrepareResult {
  ok: true;
  documents: ExistingDocument[];
  parts: PreparedPart[];
}

export interface VerifyResult {
  ok: true;
  stored: true;
  /** files/<sha256>.pdf */
  path: string;
}

export interface RegisterResult {
  ok: true;
  document_id: string;
  job_id: string;
}

export interface JobRow {
  job_id: string;
  document_id: string;
  title: string;
  source_key: string;
  desk_tier: string | null;
  desk_feature: string | null;
  /** The document is live in search (indexed_at set); such a document can't be discarded. */
  indexed: boolean;
  status: string;
  stage: string;
  ocr_pages: number;
  pages_total: number;
  attempts: number;
  next_attempt_at: string | null;
  error_code: string | null;
  last_error: string | null;
  ocr_cost_usd: number;
  embed_tokens: number;
  embed_cost_usd: number;
  requested_by_email: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface JobsResult {
  ok: true;
  jobs: JobRow[];
  /** Pass as `before` for the next page; null when there is none. */
  next_before: string | null;
}

export interface JobActionResult {
  ok: true;
  status: string;
  stage: string;
}

export interface DiscardResult {
  ok: true;
  discarded: true;
}
