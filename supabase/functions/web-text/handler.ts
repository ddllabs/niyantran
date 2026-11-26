// web-text: the entry point, pure (F369, docs/specs/2026-11-23-regulatory-web-text-firecrawl.md). pg_cron calls it through
// pg_net (the database's private.web_text_tick, which does nothing until the developer switches it on and sets a cap); it
// claims a few queued requests and scrapes each official web page with Firecrawl (firecrawl.ts), then stores the markdown
// and the spend through the database's own functions. The spend cap, the price, the money per code and the halt rule are
// all in the database (public.web_text_claim, _finish, _fail): this module never decides whether money may be spent, it
// only reports what happened.
//
// Access: POST only, with `x-web-text-secret` equal to WEB_TEXT_SECRET (at least 32 characters, else 503 before any claim).
// The comparison is the ingest worker's (digests, constant time). Every refusal is the same 401 with no detail, including
// when the secret is unset (fail closed). FIRECRAWL_API_KEY unset is 503 before any claim (a claim would use up an attempt
// for a configuration fault).
//
// The work runs after the 202 under `waitUntil`. runOnce never rejects. Each scrape is aborted after SCRAPE_TIMEOUT_MS
// (Firecrawl's own 60 s plus a margin) and reported as uncertain (it may have been billed). At most the claim limit run at
// once (Firecrawl's concurrent browsers: 2 on the Free plan, 5 on Hobby), so an invocation lasts about one scrape: 75 s plus
// the claim and the reports, under the 300 s lease and the 150 s Free-plan function limit (handler_test.ts holds it).
//
// Each claimed URL is checked against the database's own URL rule again (firecrawl.ts officialUrlOk) before it is sent; one
// that fails it is reported official_url_invalid (free, final). A finish or fail report is tried three times
// (REPORT_RETRY_DELAYS_MS) before it is given up. The x-request-id is the row id and the attempt.
//
// Logs: the row id, the source key, the outcome, the code, the site status, the credits counted and the latency; never the
// text, the URL, a key or a database message.

import { json } from '../_shared/http.ts';
import { secretMatches } from '../ingest-worker/handler.ts';
import { officialUrlOk, scrape, type ScrapeDeps, type ScrapeOutcome } from './firecrawl.ts';

/** Requests claimed by one invocation by default: the Free plan's 2 concurrent browsers. */
export const CLAIM_LIMIT = 2;
/** The most the database lets one claim take (public.web_text_claim: limit 1 to 5), Hobby's 5 browsers. */
export const MAX_CLAIM_LIMIT = 5;
/** The lease on each claimed request, longer than a scrape's time limit. */
export const LEASE_SECONDS = 300;
/** One scrape's limit, response body included: Firecrawl's own 60 s plus a margin. */
export const SCRAPE_TIMEOUT_MS = 75_000;
/** The shortest WEB_TEXT_SECRET the function will run with; a shorter one answers 503 before any claim. */
export const MIN_SECRET_LENGTH = 32;
/** The waits between the three tries of a finish or a fail report: at most 3 s in all, well inside the lease. */
export const REPORT_RETRY_DELAYS_MS = Object.freeze([500, 2_500]);

/** WEB_TEXT_CLAIM_LIMIT, when set: a whole number 1 to MAX_CLAIM_LIMIT; anything else is the default. */
export function claimLimitOf(value: string | undefined): number {
  if (value === undefined || !/^[1-9]$/.test(value.trim())) return CLAIM_LIMIT;
  const n = Number(value.trim());
  return n <= MAX_CLAIM_LIMIT ? n : CLAIM_LIMIT;
}

export interface Claimed {
  id: string;
  token: string;
  source_key: string;
  official_url: string;
  /** This claim's attempt number (1 for the first): with the id it makes the x-request-id, so a retry is a new request. */
  attempt: number;
}

/** What public.web_text_finish stores (the database computes the cost and the text's sha256). */
export interface FinishResult {
  text: string;
  source_status: number;
  final_url_host: string;
  content_type: string;
}

export interface WebTextDb {
  /** public.web_text_claim: the cap is enforced in the database. `refused` is 'cap' or 'disabled' when it stopped. */
  claim(limit: number, leaseSeconds: number): Promise<{ claimed: Claimed[]; refused: string | null }>;
  finish(id: string, token: string, result: FinishResult): Promise<string>;
  fail(id: string, token: string, code: string, uncertain: boolean, permanent: boolean): Promise<string>;
}

export type Log = (event: string, fields: Record<string, unknown>) => void;

export interface WorkDeps {
  db: WebTextDb;
  /** One scrape (firecrawl.ts `scrape` with the key and SCRAPE_TIMEOUT_MS). Never rejects. */
  scrape: (url: string, requestId: string) => Promise<ScrapeOutcome>;
  claimLimit: number;
  log: Log;
  now?: () => number;
  /** The wait between report tries (tests pass an instant one). */
  sleep?: (ms: number) => Promise<void>;
}

export interface HandlerDeps {
  /** WEB_TEXT_SECRET; empty refuses every request. */
  secret: string;
  waitUntil(work: Promise<unknown>): void;
  /** Builds the work's dependencies; called only for an authorised request. Throws when the function is not configured. */
  work(): WorkDeps;
  log: Log;
}

function safeLog(log: Log, event: string, fields: Record<string, unknown> = {}): void {
  try {
    log(event, fields);
  } catch {
    // A broken log sink must not break the work.
  }
}

/** The production scrape: Firecrawl with the key, under SCRAPE_TIMEOUT_MS. */
export function firecrawlScrape(
  fetchImpl: typeof fetch,
  apiKey: string,
  timeoutMs = SCRAPE_TIMEOUT_MS,
): WorkDeps['scrape'] {
  const deps: ScrapeDeps = { fetch: fetchImpl, apiKey, timeoutMs };
  return (url, requestId) => scrape(deps, url, requestId);
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A report to the database, tried up to three times (a token makes a repeat of one that did land answer 'stale'). */
async function reported<T>(deps: WorkDeps, call: () => Promise<T>): Promise<T> {
  const sleep = deps.sleep ?? realSleep;
  for (let i = 0;; i++) {
    try {
      return await call();
    } catch (e) {
      if (i >= REPORT_RETRY_DELAYS_MS.length) throw e;
      await sleep(REPORT_RETRY_DELAYS_MS[i]);
    }
  }
}

async function runOne(deps: WorkDeps, c: Claimed): Promise<void> {
  const now = deps.now ?? Date.now;
  const started = now();
  const ids = { request_id: c.id, source_key: c.source_key };
  const fail = (code: string, uncertain: boolean, permanent: boolean) =>
    reported(deps, () => deps.db.fail(c.id, c.token, code, uncertain, permanent));
  try {
    // The database's own URL rule, checked again before any money is spent: a row that broke it never reaches Firecrawl.
    if (!officialUrlOk(c.official_url)) {
      const outcome = await fail('official_url_invalid', false, true);
      safeLog(deps.log, 'web_text.failed', {
        ...ids,
        outcome,
        code: 'official_url_invalid',
        credits: 0,
        latency_ms: 0,
      });
      return;
    }
    const got = await deps.scrape(c.official_url, `${c.id}-${c.attempt}`);
    const latency_ms = now() - started;
    if (got.kind === 'fail') {
      const outcome = await fail(got.code, got.uncertain, got.permanent);
      safeLog(deps.log, 'web_text.failed', {
        ...ids,
        outcome,
        code: got.code,
        source_status: got.sourceStatus ?? null,
        // Credits as the database counts them: a returned document or an uncertain attempt 1, a refusal 0.
        credits: got.billed || got.uncertain ? 1 : 0,
        latency_ms,
      });
      return;
    }
    let outcome: string;
    try {
      outcome = await reported(deps, () =>
        deps.db.finish(c.id, c.token, {
          text: got.text,
          source_status: got.sourceStatus,
          final_url_host: got.finalHost,
          content_type: got.contentType,
        }));
    } catch {
      // The scrape was paid for but its result could not be stored, three times. Left alone, the lease would run out and
      // the page would be scraped (and paid for) again. End it for good: the database counts report_failed as one credit.
      safeLog(deps.log, 'web_text.report_failed', { ...ids, code: 'report_failed', credits: 1, latency_ms });
      await fail('report_failed', true, true);
      return;
    }
    safeLog(deps.log, 'web_text.finished', {
      ...ids,
      outcome,
      code: null,
      source_status: got.sourceStatus,
      credits: 1,
      latency_ms,
    });
  } catch {
    // The database is unreachable even for the failure report: nothing more can be reported. The lease runs out and the
    // next claim counts the estimate.
    safeLog(deps.log, 'web_text.report_failed', { ...ids, code: 'report_unreachable', latency_ms: now() - started });
  }
}

/** Claims up to the claim limit and scrapes them, never more than the limit at once. Never rejects. */
export async function runOnce(deps: WorkDeps): Promise<void> {
  try {
    const limit = Math.min(Math.max(1, Math.trunc(deps.claimLimit) || CLAIM_LIMIT), MAX_CLAIM_LIMIT);
    let claimed: Claimed[];
    try {
      const got = await deps.db.claim(limit, LEASE_SECONDS);
      claimed = got.claimed;
      if (!claimed.length) {
        safeLog(deps.log, got.refused ? 'web_text.refused' : 'web_text.idle', { refused: got.refused, claimed: 0 });
        return;
      }
      safeLog(deps.log, 'web_text.claimed', { claimed: claimed.length, refused: got.refused });
    } catch {
      safeLog(deps.log, 'web_text.claim_failed', { code: 'claim_failed' });
      return;
    }
    // A pool of `limit` workers: even if the database ever returned more rows, no more than `limit` scrapes run together,
    // and none is left to lapse.
    let next = 0;
    const worker = async () => {
      while (next < claimed.length) await runOne(deps, claimed[next++]);
    };
    await Promise.all(Array.from({ length: Math.min(limit, claimed.length) }, worker));
  } catch {
    safeLog(deps.log, 'web_text.unexpected', { code: 'unexpected' });
  }
}

const UNAUTHORIZED = () => json({ error: 'unauthorized' }, 401);

export async function handleWebText(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, { allow: 'POST' });
  if (!deps.secret) {
    safeLog(deps.log, 'web_text.secret_unset');
    return UNAUTHORIZED();
  }
  if (!(await secretMatches(req.headers.get('x-web-text-secret') ?? '', deps.secret))) {
    safeLog(deps.log, 'web_text.unauthorized');
    return UNAUTHORIZED();
  }
  if (deps.secret.length < MIN_SECRET_LENGTH) {
    // Only an authorised caller sees this, so a wrong header still learns nothing about the configuration.
    safeLog(deps.log, 'web_text.secret_weak');
    return json({ error: 'not configured' }, 503);
  }
  let work: WorkDeps;
  try {
    work = deps.work();
  } catch {
    safeLog(deps.log, 'web_text.config_error', { code: 'not_configured' });
    return json({ error: 'not configured' }, 503);
  }
  deps.waitUntil(runOnce(work));
  return json({ accepted: true }, 202);
}
