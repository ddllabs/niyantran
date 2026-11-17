// Dependency and data types for the factcheck function. Every external effect (OpenRouter, the SQL
// functions, the claim tables, the clock, the model-call log) arrives through FactcheckDeps, as in
// transcribe-audio, so tests use fakes.

import type { Verify } from '../_shared/auth.ts';
import type { ModelCallRow } from './modelCall.ts';

export interface RpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

export type ClaimKind = 'claim' | 'opinion' | 'prediction' | 'question';
export type ClaimStatus = 'pending' | 'checked' | 'needs_context' | 'not_checkable' | 'error';
export type Verdict = 'supported' | 'contradicted' | 'partly_true' | 'no_evidence' | 'opinion';

export interface Source {
  url: string;
  title: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  video_id: string;
  channel_id: string;
  video_kind: 'live' | 'recorded';
}

export interface ClaimRow {
  id: string;
  session_id: string;
  user_id: string;
  quote: string;
  claim_en: string;
  claimant: string | null;
  reported_by: string | null;
  kind: ClaimKind;
  status: ClaimStatus;
  verdict: Verdict | null;
  reason: string | null;
  sources: Source[];
  checked_at: string | null;
  spoken_at: string;
  /** The earlier claim this row re-checks, if any. */
  supersedes?: string | null;
  /** True for a claim extracted from stored pieces of a shareable session. */
  shared?: boolean;
}

export interface ClaimInsert {
  session_id: string;
  user_id: string;
  video_id: string;
  video_kind: 'live' | 'recorded';
  position_s: number | null;
  spoken_at: string;
  /** Set (true) only for claims extracted from stored pieces of a shareable session. */
  shared?: boolean;
  quote: string;
  claim_en: string;
  claimant: string | null;
  reported_by: string | null;
  kind: ClaimKind;
  status: ClaimStatus;
}

export interface HeldPatch {
  claim_en: string;
  claimant: string | null;
  reported_by: string | null;
  kind: ClaimKind;
  status: ClaimStatus;
}

export interface CheckResult {
  status: 'checked' | 'error';
  verdict: Verdict | null;
  reason: string | null;
  sources: Source[];
  checked_at: string;
}

/** The claim table, every call scoped to a user and a session. */
export interface ClaimStore {
  session(userId: string, sessionId: string): Promise<SessionRow | null>;
  /** The session's claims, newest first. */
  claims(userId: string, sessionId: string, limit: number): Promise<ClaimRow[]>;
  insertClaims(rows: ClaimInsert[]): Promise<ClaimRow[]>;
  /** Updates a claim only while it is still needs_context. Null when it no longer is. */
  /** `shared` must match the row's: a shared claim is only touched from stored pieces, a private one only from text. */
  updateHeld(
    userId: string,
    sessionId: string,
    claimId: string,
    patch: HeldPatch,
    shared: boolean,
  ): Promise<ClaimRow | null>;
  claim(userId: string, sessionId: string, claimId: string): Promise<ClaimRow | null>;
  /** One claim of this user by id alone (the re-check row, whose session the caller does not name). */
  claimById(userId: string, claimId: string): Promise<ClaimRow | null>;
  /**
   * Claims the right to check a claim: succeeds only while it is pending and not already being
   * checked (checked_at null, or older than staleBefore). True when this caller now holds it.
   */
  lockForCheck(userId: string, sessionId: string, claimId: string, at: string, staleBefore: string): Promise<boolean>;
  /** Gives the claim back (a pending claim with checked_at cleared) after a failed model call. */
  releaseCheck(userId: string, sessionId: string, claimId: string): Promise<void>;
  /** Saves the result, only while the claim is still pending. Null when it no longer is. */
  finishCheck(userId: string, sessionId: string, claimId: string, result: CheckResult): Promise<ClaimRow | null>;
}

export interface FactcheckDeps {
  verify?: Verify;
  /** The caller's profile is active (get_my_profile with the caller's own client). */
  active(token: string, userId: string): Promise<boolean>;
  /** is_platform_admin() asked with the CALLER's client. Never read from a request. */
  isAdmin(token: string): Promise<boolean>;
  /** A SQL function on the service client: factcheck_start, factcheck_touch or factcheck_settle. */
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  store: ClaimStore;
  apiKey: string;
  /** The app's public origin, for confirming a recorded video (LIVETV_API_BASE). Empty: nothing is shareable. */
  livetvApiBase?: string;
  fetch(input: string, init: RequestInit): Promise<Response>;
  /** Inserts the row with the service client. May throw or hang; see recordModelCall(). */
  logModelCall(row: ModelCallRow): Promise<void>;
  now?: () => number;
  telemetryTimeoutMs?: number;
  origins?: string[];
  /** Keeps the log insert alive after the response (index.ts wires EdgeRuntime.waitUntil). */
  waitUntil?: (p: Promise<unknown>) => void;
}

/** What every action receives once the common gate has passed. */
export interface Ctx {
  req: Request;
  deps: FactcheckDeps;
  userId: string;
  token: string;
  now(): number;
}
