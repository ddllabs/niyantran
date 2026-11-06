// The worker driver of the F287 harness: the real buildWorkerDeps and supabaseIngestDb, the real
// runOnce, through real PostgREST as service_role. Only the outside providers are replaced, at RunDeps:
//
//   embed            always: the fake embedder (no network, cost 0)
//   ocr and storage  only when the page path is exercised (fake-ocr.ts)
//
// Everything else in the worker is the shipped code. The environment the worker sees holds the local
// Supabase URL and nothing else, so no key to OpenRouter or Mistral exists to be used, and guardedFetch
// refuses any non-local host in any case.
//
//   scripts/load-proof/lp.sh driver.ts [--concurrency N]   drain the queue and print the totals

import { buildWorkerDeps } from '../../supabase/functions/ingest-worker/index.ts';
import { type RunDeps, runOnce } from '../../supabase/functions/ingest-worker/handler.ts';
import type {
  IngestDb,
  IngestStorage,
  OcrCallResult,
  OcrRequest,
} from '../../supabase/functions/ingest-worker/types.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  assertLocalSupabaseUrl,
  type CallScope,
  callScope,
  elapsedMs,
  openRest,
  psql,
  type Rest,
  sleep,
} from './lib.ts';
import { type FakeEmbedder, makeFakeEmbedder } from './fake-embed.ts';

/** One timed database call of the worker. `server_ms` is PostgREST's transaction time (Server-Timing), when it sent one. */
export interface OpSample {
  op: 'claim' | 'textCommit' | 'chunkCommit' | 'textActivate' | 'activate';
  /** ms on the harness clock (lib.ts elapsedMs), when the call began. */
  at: number;
  ms: number;
  ok: boolean;
  server_ms?: number;
  error?: string;
}

export interface CommitSample extends OpSample {
  rows: number;
  inserted: number;
  kind: 'text' | 'page';
}

export interface Events {
  counts: Record<string, number>;
  /** Failures the worker reported (step_failed, advance_failed, unexpected, claim_failed, settings_failed). */
  failures: Array<{ event: string; error_code: unknown; message: unknown; job_id: unknown }>;
  commits: CommitSample[];
  /** claim, textActivate and activate calls (commits are in `commits`). */
  ops: OpSample[];
}

export interface Harness {
  rest: Rest;
  svc: SupabaseClient;
  embedder: FakeEmbedder;
  events: Events;
  /** RunDeps for one worker: shared embedder and counters, its own idle flag. */
  workerDeps(overrides?: Partial<RunDeps>): { deps: RunDeps; idle(): boolean };
  /** The most commits (and database calls of any kind) in flight at once since the last call; resets the counters. */
  takeInflightMax(): { commits: number; calls: number };
  close(): void;
}

export interface HarnessOptions {
  embedder?: FakeEmbedder;
  ocr?: (request: OcrRequest) => Promise<OcrCallResult>;
  storage?: IngestStorage;
  /** Wrap the database for an experiment (a kill, a fault). Applied after the timing wrapper. */
  wrapDb?: (db: IngestDb) => IngestDb;
}

const FAILURE_EVENTS = new Set([
  'worker.step_failed',
  'worker.advance_failed',
  'worker.unexpected',
  'worker.claim_failed',
  'worker.settings_failed',
]);

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const rest = openRest();
  assertLocalSupabaseUrl(rest.url);
  const svc = await rest.client('service_role');
  const embedder = opts.embedder ?? makeFakeEmbedder();
  const events: Events = { counts: {}, failures: [], commits: [], ops: [] };
  const inflight = { commits: 0, calls: 0, maxCommits: 0, maxCalls: 0 };

  // The worker's environment: the URL, no keys. buildWorkerDeps reads MISTRAL_API_KEY, OPENROUTER_API_KEY
  // and INGEST_WORKER_SECRET from it and gets nothing.
  const base = buildWorkerDeps(svc, (name) => (name === 'SUPABASE_URL' ? rest.url : undefined));

  /** Times one call, whether it succeeds or throws, and keeps the server's own transaction time. */
  async function measured<T>(
    op: OpSample['op'],
    commit: boolean,
    f: () => Promise<T>,
    after: (r: T) => Record<string, number>,
    rows = 0,
  ): Promise<T> {
    const scope: CallScope = {};
    const at = elapsedMs();
    inflight.calls += 1;
    inflight.maxCalls = Math.max(inflight.maxCalls, inflight.calls);
    if (commit) {
      inflight.commits += 1;
      inflight.maxCommits = Math.max(inflight.maxCommits, inflight.commits);
    }
    let r: T | undefined;
    let error: string | undefined;
    try {
      r = await callScope.run(scope, f);
      return r;
    } catch (e) {
      error = String((e as Error).message ?? e).slice(0, 300);
      throw e;
    } finally {
      inflight.calls -= 1;
      if (commit) inflight.commits -= 1;
      const sample: OpSample = {
        op,
        at,
        ms: elapsedMs() - at,
        ok: error === undefined,
        ...(scope.serverTiming?.transaction !== undefined ? { server_ms: scope.serverTiming.transaction } : {}),
        ...(error ? { error } : {}),
      };
      if (commit) {
        events.commits.push({
          ...sample,
          rows,
          inserted: r ? (after(r).inserted ?? 0) : 0,
          kind: op === 'textCommit' ? 'text' : 'page',
        });
      } else events.ops.push(sample);
    }
  }

  const inserted = (r: unknown) => ({ inserted: (r as { inserted?: number })?.inserted ?? 0 });
  const none = () => ({});

  const timed = (db: IngestDb): IngestDb => ({
    ...db,
    claim: (limit, lease) => measured('claim', false, () => db.claim(limit, lease), none),
    textCommit: (jobId, token, rows) =>
      measured('textCommit', true, () => db.textCommit!(jobId, token, rows), inserted, rows.length),
    chunkCommit: (documentId, rows, keep) =>
      measured('chunkCommit', true, () => db.chunkCommit(documentId, rows, keep), inserted, rows.length),
    textActivate: (jobId, token, tokens, cost) =>
      measured('textActivate', false, () => db.textActivate!(jobId, token, tokens, cost), none),
    activate: (jobId, token, patch) => measured('activate', false, () => db.activate(jobId, token, patch), none),
  });

  return {
    rest,
    svc,
    embedder,
    events,
    takeInflightMax() {
      const r = { commits: inflight.maxCommits, calls: inflight.maxCalls };
      inflight.maxCommits = inflight.commits;
      inflight.maxCalls = inflight.calls;
      return r;
    },
    workerDeps(overrides = {}) {
      let idle = false;
      const db = opts.wrapDb ? opts.wrapDb(timed(base.db)) : timed(base.db);
      const deps: RunDeps = {
        ...base,
        db,
        embed: (inputs) => embedder.embed(inputs),
        ...(opts.ocr ? { ocr: opts.ocr } : {}),
        ...(opts.storage ? { storage: opts.storage } : {}),
        log: (event, fields) => {
          events.counts[event] = (events.counts[event] ?? 0) + 1;
          if (event === 'worker.idle') idle = true;
          if (FAILURE_EVENTS.has(event)) {
            events.failures.push({
              event,
              error_code: fields.error_code,
              message: fields.message,
              job_id: fields.job_id,
            });
          }
        },
        ...overrides,
      };
      // runOnce is called once per loop; the flag is re-armed by the caller through idle().
      return {
        deps,
        idle: () => {
          const v = idle;
          idle = false;
          return v;
        },
      };
    },
    close: () => rest.close(),
  };
}

export interface DrainOptions {
  concurrency?: number;
  /** Jobs still to do; 0 ends the drain. Default: queued or running jobs in the whole database. */
  pending?: () => Promise<number>;
  /** Checked between runs, synchronously (it must not cost a round trip); a string stops the drain with that reason. */
  shouldStop?: () => string | null;
  timeoutMs?: number;
  overrides?: Partial<RunDeps>;
}

export interface DrainResult {
  runs: number;
  idleRuns: number;
  ms: number;
  stopped: string | null;
}

export const defaultPending = async () =>
  Number(await psql(`select count(*) from public.ingest_jobs where status in ('queued','running')`));

/**
 * `concurrency` workers, each calling the real runOnce in a loop. A worker that finds nothing to claim
 * looks at what is pending: none ends the drain, some (a claim cap, a backoff) waits and tries again.
 */
export async function drain(h: Harness, o: DrainOptions = {}): Promise<DrainResult> {
  const workers = o.concurrency ?? 1;
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`concurrency must be a whole number of at least 1, not ${workers}`);
  }
  const rawPending = o.pending ?? defaultPending;
  // Idle workers share one look at the queue every 400 ms rather than each running a docker exec.
  let lastLook = { at: -Infinity, n: 1 };
  const pending = async () => {
    if (performance.now() - lastLook.at < 400 && lastLook.n > 0) return lastLook.n;
    lastLook = { at: performance.now(), n: await rawPending() };
    return lastLook.n;
  };
  const t0 = performance.now();
  const out: DrainResult = { runs: 0, idleRuns: 0, ms: 0, stopped: null };
  const deadline = o.timeoutMs ? t0 + o.timeoutMs : Infinity;
  let done = false;
  const worker = async () => {
    const { deps, idle } = h.workerDeps(o.overrides);
    while (!done) {
      if (performance.now() > deadline) {
        out.stopped = 'drain timeout';
        done = true;
        break;
      }
      const stop = o.shouldStop?.();
      if (stop) {
        out.stopped = stop;
        done = true;
        break;
      }
      await runOnce(deps);
      out.runs += 1;
      if (idle()) {
        out.idleRuns += 1;
        if (await pending() === 0) {
          done = true;
          break;
        }
        await sleep(150);
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  out.ms = performance.now() - t0;
  return out;
}

if (import.meta.main) {
  const i = Deno.args.indexOf('--concurrency');
  const h = await makeHarness();
  try {
    const r = await drain(h, { concurrency: i >= 0 ? Number(Deno.args[i + 1]) : 1 });
    console.log(
      JSON.stringify(
        { ...r, embedCalls: h.embedder.calls, events: h.events.counts, failures: h.events.failures },
        null,
        2,
      ),
    );
  } finally {
    h.close();
  }
  Deno.exit(0);
}
