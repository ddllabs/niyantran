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
//   deno run -A scripts/load-proof/driver.ts [--concurrency N]   drain the queue and print the totals

import { buildWorkerDeps } from '../../supabase/functions/ingest-worker/index.ts';
import { type RunDeps, runOnce } from '../../supabase/functions/ingest-worker/handler.ts';
import type {
  IngestDb,
  IngestStorage,
  OcrCallResult,
  OcrRequest,
} from '../../supabase/functions/ingest-worker/types.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { assertLocalSupabaseUrl, openRest, psql, type Rest, sleep } from './lib.ts';
import { type FakeEmbedder, makeFakeEmbedder } from './fake-embed.ts';

export interface CommitSample {
  /** ms since the harness started. */
  at: number;
  ms: number;
  rows: number;
  inserted: number;
  kind: 'text' | 'page';
}

export interface Events {
  counts: Record<string, number>;
  /** step_failed and advance_failed messages, as the worker reported them. */
  failures: Array<{ event: string; error_code: unknown; message: unknown; job_id: unknown }>;
  commits: CommitSample[];
}

export interface Harness {
  rest: Rest;
  svc: SupabaseClient;
  embedder: FakeEmbedder;
  events: Events;
  /** RunDeps for one worker: shared embedder and counters, its own idle flag. */
  workerDeps(overrides?: Partial<RunDeps>): { deps: RunDeps; idle(): boolean };
  close(): void;
}

export interface HarnessOptions {
  embedder?: FakeEmbedder;
  ocr?: (request: OcrRequest) => Promise<OcrCallResult>;
  storage?: IngestStorage;
  /** Wrap the database for an experiment (a kill, a fault). Applied after the timing wrapper. */
  wrapDb?: (db: IngestDb) => IngestDb;
}

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const rest = openRest();
  assertLocalSupabaseUrl(rest.url);
  const svc = await rest.client('service_role');
  const started = performance.now();
  const embedder = opts.embedder ?? makeFakeEmbedder();
  const events: Events = { counts: {}, failures: [], commits: [] };

  // The worker's environment: the URL, no keys. buildWorkerDeps reads MISTRAL_API_KEY, OPENROUTER_API_KEY
  // and INGEST_WORKER_SECRET from it and gets nothing.
  const base = buildWorkerDeps(svc, (name) => (name === 'SUPABASE_URL' ? rest.url : undefined));

  const timed = (db: IngestDb): IngestDb => ({
    ...db,
    async textCommit(jobId, token, rows) {
      const t = performance.now();
      const r = await db.textCommit!(jobId, token, rows);
      events.commits.push({
        at: t - started,
        ms: performance.now() - t,
        rows: rows.length,
        inserted: r.inserted,
        kind: 'text',
      });
      return r;
    },
    async chunkCommit(documentId, rows, keep) {
      const t = performance.now();
      const r = await db.chunkCommit(documentId, rows, keep);
      events.commits.push({
        at: t - started,
        ms: performance.now() - t,
        rows: rows.length,
        inserted: r.inserted,
        kind: 'page',
      });
      return r;
    },
  });

  return {
    rest,
    svc,
    embedder,
    events,
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
          if (event === 'worker.step_failed' || event === 'worker.advance_failed' || event === 'worker.unexpected') {
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
  /** Checked between runs; a string stops the drain with that reason. */
  shouldStop?: () => Promise<string | null>;
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
  const pending = o.pending ?? defaultPending;
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
      const stop = await o.shouldStop?.();
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
  await Promise.all(Array.from({ length: o.concurrency ?? 1 }, worker));
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
