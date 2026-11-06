// Bulk runner, T3 (F285): the database as the runner sees it, one method per function of design section 7.1
// (docs/research/2026-11-02-batch-registration-design.md). Tests use FakeDb (fake_db.ts); the load-copy proof (T4)
// supplies an implementation over PostgREST. A method throws on any error it cannot turn into the function's own
// answer: a lost reply, a timeout, a rolled-back call. The runner decides what that means.

export interface ManifestItem {
  source_key: string;
  payload_sha256: string;
  content_sha256: string;
  chunks: number;
  est_tokens: number;
}

export interface OpenArgs {
  collection: string;
  manifest_sha256: string;
  items_planned: number;
  chunks_planned: number;
  est_tokens: number;
  est_cost_usd: number;
  runner_commit: string;
}

/** `refused` is the function's own named reason: no_collection_policy, policy_inactive, manifest_exists. */
export type OpenResult = { batch_id: string; state: string; existing: boolean } | { refused: string };

export interface RegisterDocument {
  payload: string;
  payload_sha256: string;
  expected: unknown[];
  pages: unknown[];
  sections: unknown[];
}

export interface RegisterResult {
  source_key: string | null;
  outcome: 'admitted' | 'existing' | 'refused' | 'would_admit';
  reason?: string;
  detail?: unknown;
  document_id?: string;
  job_id?: string;
}

export interface RegisterResponse {
  results: RegisterResult[];
  batch: { state: string; stop_reason?: string | null };
}

export interface ItemStatus {
  source_key: string;
  outcome: 'planned' | 'admitted' | 'existing' | 'refused';
  reason?: string | null;
  job_id?: string | null;
  job_status?: string | null;
  error_code?: string | null;
  requeues?: number | null;
  indexed?: boolean;
}

export interface BatchStatus {
  batch_id: string;
  state: string;
  stop_reason: string | null;
  counts: {
    items: number;
    planned: number;
    admitted: number;
    existing: number;
    refused: number;
    by_reason: Record<string, number>;
    existing_not_indexed: number;
  };
  jobs: {
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    uncertain: number;
    spend_usd: number;
    tokens: number;
    logged_spend_usd: number;
  };
  indexed: number;
  /** Present when source keys were asked for. */
  items?: ItemStatus[];
}

export interface RequeueResponse {
  results: Array<{ job_id: string; outcome: 'requeued' | 'refused'; reason?: string }>;
  state: string;
  stop_reason: string | null;
}

export interface TextHolder {
  content_sha256: string;
  source_key: string;
  document_id: string;
}

export interface Db {
  /** lock_timeout and statement_timeout for the session (design 5.3). */
  session(settings: { lock_timeout_ms: number; statement_timeout_ms: number }): Promise<void>;
  textHolders(hashes: string[]): Promise<TextHolder[]>;
  open(args: OpenArgs): Promise<OpenResult>;
  addItems(batch: string, items: ManifestItem[]): Promise<void>;
  seal(batch: string): Promise<{ state?: string; refused?: string }>;
  register(
    batch: string,
    documents: RegisterDocument[],
    dryRun: boolean,
    allOrNothing: boolean,
  ): Promise<RegisterResponse>;
  status(batch: string, sourceKeys?: string[]): Promise<BatchStatus>;
  stop(batch: string, reason: string): Promise<void>;
  requeue(batch: string, jobIds: string[]): Promise<RequeueResponse>;
}
