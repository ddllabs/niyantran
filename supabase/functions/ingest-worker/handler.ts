// ingest-worker's entry point, pure: the secret check, the 202, and one step of one claimed job
// (docs/specs/2026-10-01-rag-v2-ingestion-v2.md, "The worker Edge Function"). All I/O is injected;
// index.ts wires Supabase, Mistral and OpenRouter.
//
// Access: POST only, with `x-ingest-secret` equal to INGEST_WORKER_SECRET. The comparison hashes
// both values and compares the digests in constant time, so neither the content nor the length
// of the configured secret leaks through timing. Every refusal is the same 401 with no detail,
// including when the configured secret is empty or unset (fail closed: a missing secret must not
// make the endpoint open, and a distinct status would tell a caller the worker is unconfigured).
// The unset secret is logged server-side as `worker.secret_unset` for the operator.
//
// The work runs after the 202 under `waitUntil` (EdgeRuntime.waitUntil in production). runOnce
// never rejects: every failure is logged, and a failure that belongs to the job is reported to
// ingest_advance. An advance that is itself rejected (the fence refused a stale claim token) is
// logged and left alone; the lease expires and the job is claimed again.

import { json } from '../_shared/http.ts';
import { redactText } from './mistral.ts';
import {
  type AdvancePatch,
  INGEST,
  IngestError,
  type IngestJob,
  type Step,
  type StepOutcome,
  type WorkerDeps,
} from './types.ts';

/** Longest error message reported to ingest_advance or a log line (after redaction). */
export const MAX_REPORTED_MESSAGE = 500;

export interface RunDeps extends WorkerDeps {
  /** The stage steps; production passes ocrStep and indexStep, tests pass fakes. */
  steps: { ocr: Step; index: Step };
  /** Exact values removed from every reported message (API keys, the worker secret). */
  secrets?: string[];
}

export interface HandlerDeps {
  /** INGEST_WORKER_SECRET; empty refuses every request. */
  secret: string;
  /** Keeps the invocation alive for the work after the response is sent. */
  waitUntil(work: Promise<unknown>): void;
  /** Builds the worker's dependencies; called only for an authorised request. */
  worker(): RunDeps;
  log(event: string, fields: Record<string, unknown>): void;
}

// ─── Redaction ───────────────────────────────────────────────────────────────

const KEY_LIKE: Array<[RegExp, string]> = [
  [/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]'],
  // A JWT (a Supabase key or a signed-URL token outside a query string).
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, '[redacted]'],
  // Supabase API keys and OpenAI/OpenRouter-style keys.
  [/\bsb_(?:secret|publishable)_[\w-]+/gi, '[redacted]'],
  [/\bsk-[\w-]{8,}/gi, '[redacted]'],
  // key=value / key: value pairs whose name says what they are.
  [
    /\b((?:api[_-]?key|apikey|access[_-]?token|token|secret|password|signature|sig)\s*[=:]\s*)[^\s&"',;]+/gi,
    '$1[redacted]',
  ],
  // Long hex (hex-encoded secrets; also sha256 values, an accepted loss) and long opaque tokens.
  [/\b[0-9a-f]{32,}\b/gi, '[redacted]'],
  // No '/' in the class, so a URL path is not mistaken for one token.
  [/[A-Za-z0-9_-]{40,}/g, '[redacted]'],
];

/**
 * A message fit to store or log: the exact secrets and every URL query string removed (redactText),
 * then anything key-like, then truncated. Redaction runs before truncation so a secret cut in half
 * cannot survive as an unmatched prefix.
 */
export function redactMessage(text: string, secrets: string[] = []): string {
  let out = redactText(text, secrets);
  for (const [pattern, replacement] of KEY_LIKE) out = out.replace(pattern, replacement);
  return out.length > MAX_REPORTED_MESSAGE ? out.slice(0, MAX_REPORTED_MESSAGE - 1) + '…' : out;
}

// ─── The secret check ────────────────────────────────────────────────────────

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Constant-time over fixed-size digests, so the lengths of the inputs do not matter. */
export async function secretMatches(given: string, expected: string): Promise<boolean> {
  if (!given || !expected) return false;
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function safeLog(
  log: (event: string, fields: Record<string, unknown>) => void,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    log(event, fields);
  } catch {
    // A broken log sink must not break the worker.
  }
}

// ─── One step of one job ─────────────────────────────────────────────────────

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function failurePatch(e: unknown): AdvancePatch {
  const error = e instanceof IngestError
    ? { code: e.code, message: messageOf(e), permanent: e.permanent }
    : { code: 'internal', message: messageOf(e), permanent: false };
  return { progressed: false, error };
}

function stepFor(deps: RunDeps, job: IngestJob): Step | null {
  if (job.stage === 'ocr') return deps.steps.ocr;
  if (job.stage === 'index') return deps.steps.index;
  return null;
}

async function runClaimed(deps: RunDeps, job: IngestJob, deadline: number): Promise<void> {
  const secrets = deps.secrets ?? [];
  const ids = { job_id: job.id, document_id: job.document_id };
  const step = stepFor(deps, job);

  let outcome: StepOutcome;
  if (!step) {
    outcome = {
      patch: {
        progressed: false,
        error: { code: 'unexpected_stage', message: `stage "${job.stage}" has no step`, permanent: true },
      },
    };
  } else {
    try {
      outcome = await step(deps, job, deadline);
    } catch (e) {
      outcome = { patch: failurePatch(e) };
    }
  }

  if (outcome.activated) {
    safeLog(deps.log, 'worker.activated', ids);
    return;
  }

  const patch: AdvancePatch = outcome.patch.error
    ? {
      ...outcome.patch,
      error: { ...outcome.patch.error, message: redactMessage(outcome.patch.error.message, secrets) },
    }
    : outcome.patch;
  if (patch.error) {
    safeLog(deps.log, 'worker.step_failed', {
      ...ids,
      stage: job.stage,
      error_code: patch.error.code,
      permanent: patch.error.permanent,
      message: patch.error.message,
    });
  }

  try {
    await deps.db.advance(job.id, job.claim_token, patch);
  } catch (e) {
    // Most likely the fence: another worker holds the job now. Retrying could double-apply the patch.
    safeLog(deps.log, 'worker.advance_failed', { ...ids, message: redactMessage(messageOf(e), secrets) });
    return;
  }
  safeLog(deps.log, 'worker.advanced', {
    ...ids,
    from_stage: job.stage,
    to_stage: patch.stage ?? job.stage,
    progressed: patch.progressed,
    error_code: patch.error?.code ?? null,
  });
}

/** Claims at most one job and runs one step of it. Never rejects. */
export async function runOnce(deps: RunDeps): Promise<void> {
  const secrets = deps.secrets ?? [];
  try {
    const deadline = deps.now() + INGEST.budgetMs;
    let jobs: IngestJob[];
    try {
      jobs = await deps.db.claim(1, INGEST.leaseSeconds);
    } catch (e) {
      safeLog(deps.log, 'worker.claim_failed', { message: redactMessage(messageOf(e), secrets) });
      return;
    }
    if (!jobs.length) {
      safeLog(deps.log, 'worker.idle');
      return;
    }
    const job = jobs[0];
    if (jobs.length > 1) safeLog(deps.log, 'worker.claim_extra', { claimed: jobs.length });
    safeLog(deps.log, 'worker.claimed', {
      job_id: job.id,
      document_id: job.document_id,
      stage: job.stage,
      attempts: job.attempts,
    });
    await runClaimed(deps, job, deadline);
  } catch (e) {
    safeLog(deps.log, 'worker.unexpected', { message: redactMessage(messageOf(e), secrets) });
  }
}

// ─── The request ─────────────────────────────────────────────────────────────

const UNAUTHORIZED = () => json({ error: 'unauthorized' }, 401);

export async function handleWorker(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, { allow: 'POST' });
  if (!deps.secret) {
    safeLog(deps.log, 'worker.secret_unset');
    return UNAUTHORIZED();
  }
  if (!(await secretMatches(req.headers.get('x-ingest-secret') ?? '', deps.secret))) {
    safeLog(deps.log, 'worker.unauthorized');
    return UNAUTHORIZED();
  }
  let worker: RunDeps;
  try {
    worker = deps.worker();
  } catch (e) {
    safeLog(deps.log, 'worker.config_error', { message: redactMessage(messageOf(e), [deps.secret]) });
    return json({ error: 'worker not configured' }, 503);
  }
  deps.waitUntil(runOnce(worker));
  return json({ accepted: true }, 202);
}
