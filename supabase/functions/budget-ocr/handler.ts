// budget-ocr: the entry point, pure (F391, docs/specs/2026-11-21-budget-ocr-text.md). pg_cron calls it through pg_net (the
// database's private.budget_ocr_tick, which does nothing until the developer switches it on); it claims a few queued
// requests and reads each with the engine its page count selects (engine.ts, decision 2026-11-22, F409):
// - 1 to 4 pages: GPT-5 mini through OpenRouter (vision.ts, the trial's proven request), the answer split on its
//   `=== PAGE n ===` markers into exactly the expected page texts;
// - 5 pages and more: Mistral OCR, given the official PDF URL as `document_url` (no download, no storage, no copy of the
//   PDF) with the ingest worker's OCR flags unchanged (BUDGET_TABLE_FORMAT 'markdown'; the blocks and image data Mistral
//   returns are dropped, never stored or logged).
// It stores the page text and the spend through the database's own functions. The spend cap is enforced there, in
// public.budget_ocr_claim: this module never decides whether money may be spent, it only reports what was.
//
// Access: POST only, with `x-budget-ocr-secret` equal to BUDGET_OCR_SECRET (at least 32 characters, else 503 before any claim). The comparison is the ingest worker's
// (digests, constant time). Every refusal is the same 401 with no detail, including when the secret is unset (fail closed).
//
// A second mode, the vision-model trial (F409, trial.ts), is selected only by a JSON body with a `trial` field, behind the
// same secret check: it answers the text synchronously and writes nothing. Every other body is the cron mode.
//
// The work runs after the 202 under `waitUntil`. runOnce never rejects. Every model call has a time limit: a call that
// does not finish is aborted and reported as uncertain (it may have been billed), so its estimate counts as spent.
//
// Time: the claimed requests run together (Promise.all), so an invocation lasts as long as its slowest request, not their
// sum. The slowest is a vision request: the PDF fetch (20 s at most) and the OpenRouter call (120 s at most), 140 s plus
// the claim and the report; a Mistral request is at most 100 s. That is under the 300 s lease, under the 400 s wall clock of
// NTER's Supabase Pro plan, and leaves 10 s for the database calls under the 150 s Free-plan limit (engine_test.ts holds it).

import { json } from '../_shared/http.ts';
import { composeDocument } from '../_shared/pageText.ts';
import { redactMessage, secretMatches } from '../ingest-worker/handler.ts';
import { buildOcrRequest, callMistralOcr, checkIndexes } from '../ingest-worker/mistral.ts';
import { IngestError, OCR_MODEL, type OcrCallResult, type OcrRequest } from '../ingest-worker/types.ts';
import { engineFor, VISION_MODEL } from './engine.ts';
import { checkTrialBody, runTrial, trialBodyOf, type TrialDeps } from './trial.ts';
import { callVision, splitVisionPages, type VisionAnswer, type VisionDeps, VisionFailure } from './vision.ts';

/** Requests claimed by one invocation, and the lease on each (longer than every model call's time limit). */
export const CLAIM_LIMIT = 2;
export const LEASE_SECONDS = 300;
/** One OCR call's limit, response included. The longest PDF is 62 pages; Mistral answers in a few seconds a page at most. */
export const OCR_TIMEOUT_MS = 100_000;
/** The shortest BUDGET_OCR_SECRET the function will run with; a shorter one answers 503 before any claim. */
export const MIN_SECRET_LENGTH = 32;

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
  /** Mistral OCR, for requests of more than VISION_MAX_PAGES pages. */
  ocr: (request: OcrRequest) => Promise<OcrCallResult>;
  /** The vision model through OpenRouter (vision.ts), for requests of 1 to VISION_MAX_PAGES pages. */
  vision: VisionDeps;
  log: (event: string, fields: Record<string, unknown>) => void;
  /** Exact values removed from every reported message (the API keys, the function's secret). */
  secrets: string[];
}

export interface HandlerDeps {
  /** BUDGET_OCR_SECRET; empty refuses every request. */
  secret: string;
  waitUntil(work: Promise<unknown>): void;
  /** Builds the work's dependencies; called only for an authorised request. Throws when the function is not configured. */
  work(): WorkDeps;
  /**
   * Builds the vision trial's dependencies (trial.ts: a read-only lookup, fetch, the OpenRouter key); called only for an
   * authorised trial body. Absent or throwing: the trial answers 503. The cron mode never calls it.
   */
  trial?(): TrialDeps;
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

/**
 * Mistral's table format for Budget documents: 'markdown', the ingest worker's exact request (2026-11-22). The HTML trial
 * gave the same loss of year values as markdown (F409), so the documents it mattered for go to the vision model instead.
 * 'html' still works (the composition resolves html placeholders when it is set); the worker's own OCR_FLAGS are unchanged.
 */
export const BUDGET_TABLE_FORMAT: OcrRequest['table_format'] = 'markdown';

/**
 * The request for a whole document: exactly the expected pages (so the cost cannot pass the estimate), with the ingest
 * worker's OCR flags (OCR_FLAGS: blocks and image data included) except the table format, BUDGET_TABLE_FORMAT.
 * Only the composed page texts are kept: the blocks and the image data in the answer are neither stored nor logged.
 */
export function ocrRequestFor(url: string, expectedPages: number): OcrRequest {
  const pages = Array.from({ length: expectedPages }, (_, i) => i);
  return { ...buildOcrRequest(OCR_MODEL, url, pages), table_format: BUDGET_TABLE_FORMAT };
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

/**
 * Which rejected vision answers are final. Truncated at max_tokens: the same document runs out again (raising the limit is a
 * code change). A wrong page split or an empty answer may be one bad sample: tried again, up to max_attempts, each attempt
 * counting its estimate. All three were billed (uncertain).
 */
export const VISION_REJECTED_PERMANENT: Readonly<Record<string, boolean>> = Object.freeze({
  vision_empty: false,
  vision_truncated: true,
  vision_page_split: false,
});

/** Stores the page texts (pages = the expected count) or ends the request for good when the store fails. */
async function finishOrEnd(
  deps: WorkDeps,
  c: Claimed,
  pages: number,
  texts: string[],
  ids: Record<string, unknown>,
): Promise<string | null> {
  try {
    return await deps.db.finish(c.id, c.token, pages, texts);
  } catch (e) {
    // The call was paid for but the result could not be stored. Left alone, the lease would run out and the request would
    // be read (and paid for) again, up to max_attempts. End it for good, with its estimate counted as spent.
    safeLog(deps.log, 'budget_ocr.report_failed', { ...ids, message: redactMessage(messageOf(e), deps.secrets) });
    await deps.db.fail(c.id, c.token, 'report_failed', true, true);
    return null;
  }
}

/** A request of 1 to VISION_MAX_PAGES pages: the vision model, its answer split into exactly the expected pages. */
async function runVision(deps: WorkDeps, c: Claimed, ids: Record<string, unknown>): Promise<void> {
  const started = Date.now();
  let got: VisionAnswer;
  try {
    got = await callVision(deps.vision, c);
  } catch (e) {
    const k = e instanceof VisionFailure ? e : new VisionFailure('internal', true, false);
    safeLog(deps.log, 'budget_ocr.call_failed', {
      ...ids,
      ...k.detail,
      code: k.code,
      uncertain: k.uncertain,
      permanent: k.permanent,
      latency_ms: Date.now() - started,
    });
    await deps.db.fail(c.id, c.token, k.code, k.uncertain, k.permanent);
    return;
  }
  // Every field of the call that may be logged: never the text.
  const call = {
    ...ids,
    prompt_tokens: got.usage.prompt_tokens,
    completion_tokens: got.usage.completion_tokens,
    cost: got.usage.cost,
    finish_reason: got.finish_reason,
    latency_ms: Date.now() - started,
  };
  // Empty first, then truncated (a cut-off answer also splits wrong), then the split itself.
  const texts = got.text.trim() && got.finish_reason !== 'length' ? splitVisionPages(got.text, c.expected_pages) : null;
  if (texts === null) {
    const code = !got.text.trim()
      ? 'vision_empty'
      : got.finish_reason === 'length'
      ? 'vision_truncated'
      : 'vision_page_split';
    safeLog(deps.log, 'budget_ocr.vision_rejected', { ...call, outcome: code });
    await deps.db.fail(c.id, c.token, code, true, VISION_REJECTED_PERMANENT[code]);
    return;
  }
  // The pages processed are the expected pages: the cost the database records is pages x the current price.
  const outcome = await finishOrEnd(deps, c, c.expected_pages, texts.map((t) => t.replaceAll('\u0000', '')), ids);
  if (outcome !== null) {
    safeLog(deps.log, 'budget_ocr.finished', { ...call, outcome, pages_processed: c.expected_pages });
  }
}

async function runOne(deps: WorkDeps, c: Claimed): Promise<void> {
  const engine = engineFor(c.expected_pages);
  const ids = {
    request_id: c.id,
    source_key: c.source_key,
    expected_pages: c.expected_pages,
    engine,
    model: engine === 'vision' ? VISION_MODEL : OCR_MODEL,
  };
  try {
    if (engine === 'vision') {
      await runVision(deps, c, ids);
      return;
    }
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
    let unresolved = 0;
    try {
      checkIndexes(Array.from({ length: c.expected_pages }, (_, i) => i), result.pages.map((p) => p.index));
      // Each page text is the ingest worker's composition of the same answer (F408): tables put back in place of their
      // `[tbl-N.md](tbl-N.md)` placeholders (and `[tbl-N.html](tbl-N.html)` ones when HTML tables were asked for, the table's
      // HTML then stored as it came), image placeholders rewritten, and header and footer lines restored unless they repeat
      // across pages. A NUL cannot be stored in a text or jsonb value: left in, the database refuses the finish and the paid
      // work is lost.
      const composed = composeDocument(result.pages, { htmlTables: BUDGET_TABLE_FORMAT === 'html' });
      unresolved = composed.unresolvedTables.length;
      texts = composed.pages.map((p) => p.text.replaceAll('\u0000', ''));
    } catch (e) {
      safeLog(deps.log, 'budget_ocr.page_mismatch', {
        ...ids,
        returned: result.pages.length,
        message: redactMessage(messageOf(e), deps.secrets),
      });
    }
    if (unresolved) {
      // A placeholder with no table would store a page with its table missing. The call was paid for, and OCR again would
      // give the same answer: end it for good, with its estimate counted as spent.
      safeLog(deps.log, 'budget_ocr.table_unresolved', { ...ids, unresolved });
      await deps.db.fail(c.id, c.token, 'ocr_table_unresolved', true, true);
      return;
    }
    const outcome = await finishOrEnd(deps, c, result.pagesProcessed, texts, ids);
    if (outcome === null) return;
    safeLog(deps.log, 'budget_ocr.finished', {
      ...ids,
      outcome,
      pages_processed: result.pagesProcessed,
      latency_ms: result.latencyMs,
    });
  } catch (e) {
    // The database is unreachable even for the failure report: nothing more can be reported. The lease runs out and the
    // claim counts the estimate.
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
  if (deps.secret.length < MIN_SECRET_LENGTH) {
    // Only an authorised caller sees this, so a wrong header still learns nothing about the configuration.
    safeLog(deps.log, 'budget_ocr.secret_weak');
    return json({ error: 'not configured' }, 503);
  }
  // The trial (F409) is selected only by a JSON body with a `trial` field. Any other body, `{}` from the cron job included,
  // is the cron mode, exactly as before: the body is read only after the secret check.
  const trial = trialBodyOf(await req.text().catch(() => ''));
  if (trial) {
    const checked = checkTrialBody(trial);
    if (checked instanceof Response) {
      safeLog(deps.log, 'budget_ocr.trial_refused');
      return checked;
    }
    let trialDeps: TrialDeps;
    try {
      if (!deps.trial) throw new Error('trial not wired');
      trialDeps = deps.trial();
    } catch (e) {
      safeLog(deps.log, 'budget_ocr.config_error', { message: redactMessage(messageOf(e), [deps.secret]) });
      return json({ error: 'not configured' }, 503);
    }
    return await runTrial(trialDeps, checked.model, checked.sourceKey);
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
