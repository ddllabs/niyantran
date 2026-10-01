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
  | 'key_held' // 409: another ingestion-v2 document holds this record's key (Amendment A, D2/D8)
  | 'stale' // 409: the page was out of date (compare-and-set, D11)
  | 'not_deletable' // 409: legacy, or not an admin upload (D4)
  | 'hub_url' // 422: a desk's provenance hub URL given as the document's source (D6)
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
  key_held: 409,
  stale: 409,
  not_deletable: 409,
  hub_url: 422,
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

/** One record's status, by precedence (Amendment A, admin_desk_records). */
export type RecordStatus = 'processing' | 'failed' | 'full_text' | 'full_text_legacy' | 'record_only';

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
    // Amendment A. A record link (checked against the desk, D8) or a pending replacement (D5).
    document_key?: string | null;
    replaces?: string | null;
    /** Required true when file_url is empty (D6). */
    no_public_source?: boolean;
  }
  | {
    action: 'records';
    desk_tier: string;
    desk_feature: string;
    query?: string | null;
    status?: RecordStatus | null;
    limit?: number;
    offset?: number;
  }
  | { action: 'unlinked'; desk_tier: string; desk_feature: string; query?: string | null; limit?: number; offset?: number }
  | { action: 'link'; document_id: string; document_key: string; expected_key: string | null }
  | { action: 'unlink'; document_id: string; expected_key: string }
  | { action: 'swap'; document_id: string; expected_old: string | null }
  | { action: 'delete'; document_id: string }
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

// ─── Amendment A: records-first management ──────────────────────────────────

/** The latest ingest job of a document, if any. */
export interface JobSummary {
  status: string;
  stage: string;
  error_code: string | null;
}

/** A document holding (or targeting) a record's key. */
export interface RecordDocument {
  document_id: string;
  title: string;
  source_key: string;
  /** storage_path is null: a legacy document, read-only here (D3). */
  legacy: boolean;
  indexed: boolean;
  job: JobSummary | null;
}

/** A desk row that shares the record's key. */
export interface RecordRow {
  row_key: string;
  title: string;
  house: string | null;
  date: string | null;
}

/** One record: one document key, every row that shares it, every document holding it. */
export interface DeskRecord {
  document_key: string;
  status: RecordStatus;
  rows: RecordRow[];
  /** The rows' provenance URL, shown as a hint only (D6). */
  source_hint: string | null;
  documents: RecordDocument[];
}

export interface RecordsResult {
  ok: true;
  records: DeskRecord[];
  /** Keys matching the query and status (not rows). */
  total: number;
  coverage: {
    /** Distinct keys of the desk. */
    keys: number;
    /** Keys with an indexed document (legacy or ingestion-v2). */
    full_text: number;
    /** Ingestion-v2 documents whose key no desk row has. */
    orphaned: number;
  };
}

/** An ingestion-v2 document without a working record link (Objective 4). */
export interface UnlinkedDocument extends RecordDocument {
  /** Its current key when that key matches no desk row (an orphaned link). */
  orphaned_key: string | null;
  /** A replacement waiting to swap (D5). */
  link_target: string | null;
  replaces: string | null;
  created_at: string;
}

export interface UnlinkedResult {
  ok: true;
  documents: UnlinkedDocument[];
  total: number;
}

export interface LinkResult {
  ok: true;
  document_id: string;
  document_key: string | null;
}

export interface SwapResult {
  ok: true;
  document_id: string;
  document_key: string;
  /** The document that held the key before, or null when none did. */
  old_document_id: string | null;
}

export interface DeleteResult {
  ok: true;
  deleted: true;
}
