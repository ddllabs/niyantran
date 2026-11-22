// budget-ocr: the entry point, pure (F391, docs/specs/2026-11-21-budget-ocr-text.md). pg_cron calls it through pg_net (the
// database's private.budget_ocr_tick, which does nothing until the developer switches it on); it claims a few queued
// requests, gives Mistral OCR each official PDF URL as `document_url` (no download, no storage, no copy of the PDF), and
// stores the page text and the spend through the database's own functions. The spend cap is enforced there, in
// public.budget_ocr_claim: this module never decides whether money may be spent, it only reports what was.
//
// Access: POST only, with `x-budget-ocr-secret` equal to BUDGET_OCR_SECRET. The comparison is the ingest worker's
// (digests, constant time). Every refusal is the same 401 with no detail, including when the secret is unset (fail closed).
//
// The work runs after the 202 under `waitUntil`. runOnce never rejects. Every Mistral call has a time limit: a call that
// does not finish is aborted and reported as uncertain (it may have been billed), so its estimate counts as spent.

import { json } from '../_shared/http.ts';
import { redactMessage, secretMatches } from '../ingest-worker/handler.ts';
import { buildOcrRequest, callMistralOcr, checkIndexes } from '../ingest-worker/mistral.ts';
import { IngestError, OCR_MODEL, type OcrCallResult, type OcrRequest } from '../ingest-worker/types.ts';

/** Requests claimed by one invocation, and the lease on each (longer than the OCR time limit and the work budget). */
export const CLAIM_LIMIT = 2;
export const LEASE_SECONDS = 300;
/** One OCR call's limit, response included. The longest PDF is 62 pages; Mistral answers in a few seconds a page at most. */
export const OCR_TIMEOUT_MS = 100_000;

export interface Claimed {
  id: string;
  token: string;
  source_key: string;
  official_url: string;
  expected_pages: number;
}

export interface BudgetOcrDb {
  /** public.budget_ocr_claim: the cap is enforced in the database. `refused` is 'cap' or 'disabled' when it stopped. */
  claim(limit: number, leaseSeconds: number): Promise<{ claimed: Claimed[]; refused: string | null }>;
  finish(id: string, token: string, pages: number, texts: string[]): Promise<string>;
  fail(id: string, token: string, code: string, uncertain: boolean, permanent: boolean): Promise<string>;
}

export interface WorkDeps {
  db: BudgetOcrDb;
  ocr: (request: OcrRequest) => Promise<OcrCallResult>;
  log: (event: string, fields: Record<string, unknown>) => void;
  /** Exact values removed from every reported message (the API key, the function's secret). */
  secrets: string[];
}

export interface HandlerDeps {
  /** BUDGET_OCR_SECRET; empty refuses every request. */
  secret: string;
  waitUntil(work: Promise<unknown>): void;
  /** Builds the work's dependencies; called only for an authorised request. Throws when the function is not configured. */
  work(): WorkDeps;
  log(event: string, fields: Record<string, unknown>): void;
}

function safeLog(log: WorkDeps['log'], event: string, fields: Record<string, unknown> = {}): void {
  try {
    log(event, fields);
  } catch {
    // A broken log sink must not break the work.
  }
}

const messageOf = (e: unknown): string => e instanceof Error ? e.message : String(e);

/** The request for a whole document: exactly the expected pages (so the cost cannot pass the estimate), no image data. */
export function ocrRequestFor(url: string, expectedPages: number): OcrRequest {
  const pages = Array.from({ length: expectedPages }, (_, i) => i);
  return {
    ...buildOcrRequest(OCR_MODEL, url, pages),
    include_image_base64: false,
    include_blocks: false,
  } as OcrRequest;
}

/** A fetch that gives up after `ms`: the call is aborted through its signal, and the caller sees an unavailable error. */
export function withTimeout(inner: typeof fetch, ms: number): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const signal = AbortSignal.timeout(ms);
    return inner(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
  }) as typeof fetch;
}

/** The OCR call as production makes it: Mistral, with the key, under the time limit. */
export function mistralOcr(fetchImpl: typeof fetch, apiKey: string, timeoutMs = OCR_TIMEOUT_MS): WorkDeps['ocr'] {
  return (request) => callMistralOcr({ fetch: withTimeout(fetchImpl, timeoutMs), apiKey }, request);
}

/** How a failed call is reported to the database: was it billed (possibly), and should it be tried again. */
export function classify(e: unknown): { code: string; uncertain: boolean; permanent: boolean } {
  if (e instanceof IngestError) {
    // A rejection (4xx) and a rate limit were refused before any work: not billed. An outage, a timeout or an unreadable
    // answer may have been processed and billed.
    if (e.code === 'mistral_rate_limited') return { code: e.code, uncertain: false, permanent: false };
    if (e.code === 'mistral_rejected' || e.code === 'mistral_key_missing') {
      return { code: e.code, uncertain: false, permanent: true };
    }
    return { code: /^[a-z0-9_]{1,64}$/.test(e.code) ? e.code : 'ocr_failed', uncertain: true, permanent: e.permanent };
  }
  return { code: 'internal', uncertain: true, permanent: false };
}

async function runOne(deps: WorkDeps, c: Claimed): Promise<void> {
  const ids = { request_id: c.id, source_key: c.source_key, expected_pages: c.expected_pages };
  try {
    let result: OcrCallResult;
    try {
      result = await deps.ocr(ocrRequestFor(c.official_url, c.expected_pages));
    } catch (e) {
      const k = classify(e);
      safeLog(deps.log, 'budget_ocr.call_failed', {
        ...ids,
        code: k.code,
        uncertain: k.uncertain,
        permanent: k.permanent,
        message: redactMessage(messageOf(e), deps.secrets),
      });
      await deps.db.fail(c.id, c.token, k.code, k.uncertain, k.permanent);
      return;
    }
    // The pages come back in any order and must be exactly the ones asked for; otherwise the request fails in the database
    // (an empty text list never matches the expected count) with the money counted.
    let texts: string[] = [];
    try {
      checkIndexes(Array.from({ length: c.expected_pages }, (_, i) => i), result.pages.map((p) => p.index));
      texts = [...result.pages].sort((a, b) => a.index - b.index).map((p) => p.markdown);
    } catch (e) {
      safeLog(deps.log, 'budget_ocr.page_mismatch', {
        ...ids,
        returned: result.pages.length,
        message: redactMessage(messageOf(e), deps.secrets),
      });
    }
    const outcome = await deps.db.finish(c.id, c.token, result.pagesProcessed, texts);
    safeLog(deps.log, 'budget_ocr.finished', {
      ...ids,
      outcome,
      pages_processed: result.pagesProcessed,
      latency_ms: result.latencyMs,
    });
  } catch (e) {
    // The database call itself failed: nothing more can be reported. The lease runs out and the claim counts the estimate.
    safeLog(deps.log, 'budget_ocr.report_failed', { ...ids, message: redactMessage(messageOf(e), deps.secrets) });
  }
}

/** Claims up to CLAIM_LIMIT requests and runs them together. Never rejects. */
export async function runOnce(deps: WorkDeps): Promise<void> {
  try {
    let claimed: Claimed[];
    try {
      const got = await deps.db.claim(CLAIM_LIMIT, LEASE_SECONDS);
      claimed = got.claimed;
      if (!claimed.length) {
        safeLog(deps.log, got.refused ? 'budget_ocr.refused' : 'budget_ocr.idle', { reason: got.refused });
        return;
      }
    } catch (e) {
      safeLog(deps.log, 'budget_ocr.claim_failed', { message: redactMessage(messageOf(e), deps.secrets) });
      return;
    }
    await Promise.all(claimed.map((c) => runOne(deps, c)));
  } catch (e) {
    safeLog(deps.log, 'budget_ocr.unexpected', { message: redactMessage(messageOf(e), deps.secrets) });
  }
}

const UNAUTHORIZED = () => json({ error: 'unauthorized' }, 401);

export async function handleBudgetOcr(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, { allow: 'POST' });
  if (!deps.secret) {
    safeLog(deps.log, 'budget_ocr.secret_unset');
    return UNAUTHORIZED();
  }
  if (!(await secretMatches(req.headers.get('x-budget-ocr-secret') ?? '', deps.secret))) {
    safeLog(deps.log, 'budget_ocr.unauthorized');
    return UNAUTHORIZED();
  }
  let work: WorkDeps;
  try {
    work = deps.work();
  } catch (e) {
    safeLog(deps.log, 'budget_ocr.config_error', { message: redactMessage(messageOf(e), [deps.secret]) });
    return json({ error: 'not configured' }, 503);
  }
  deps.waitUntil(runOnce(work));
  return json({ accepted: true }, 202);
}
