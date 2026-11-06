// The write-load generator of the F287 proof (E2 and E3). Synthetic documents are registered through the
// real batch functions (ingest_batch_open, add_items, seal, ingest_register_batch, as corpus_ingest) and
// indexed by the real worker (driver.ts) at a set concurrency, until the target partition holds the
// target number of chunks.
//
//   scripts/load-proof/lp.sh load.ts --dry-run                      2,000 chunks on Bills, pools optional
//   scripts/load-proof/lp.sh load.ts --feature bills --target-chunks 445000 --confirm-load \
//        --concurrency 2,4,8 --level-chunks 20000 --claim-batch 2 --out eval/ingestion/results/bills.json
//
// Before a measured run, run calibrate.ts: the relay and the single Deno process carry about 34 MB/s in total (2026-11-06,
// 3.2 MB no-ops: p50 178 ms at 1 and 2 connections, 371 ms at 4, 873 ms at 8), so client-side commit latency at 4 and 8
// workers is not database time; commit_server_ms (PostgREST's own transaction time) is.
//
// Options
//   --feature bills|nclt|regulatory|pq|other   the partition to grow (default bills)
//   --target-chunks N       the partition's total, counting chunks already there; above 2,000 needs --confirm-load
//   --concurrency A[,B,C]   workers. A list alternates inside ONE growth run: the level changes every
//                           --level-chunks inserted chunks (default 20000), so levels are compared at the
//                           same partition sizes. At most 8, or raise PGRST_DB_POOL (postgrest.sh, LOAD_PROOF_POOL)
//   --claim-batch N         jobs a worker claims at once (ingest_settings.claim_batch; default 1)
//   --max-running N         floor for ingest_settings.max_running (default 2). The run sets it to at least
//                           claim_batch x the highest level, so every worker can hold a full claim
//   --docs-per-batch N      documents per registered batch (default 300)
//   --bucket N              chunks per partition-size bucket in the report (default target/10, at least 500)
//   --sample-seconds N      sampling and save interval (default 15)
//   --seed N, --tag NAME, --out PATH
//   --min-free-gib N        raise the 6 GiB disk floor (never lower)
//   --inject-embed-failure-at N   fail the Nth embedding call, to prove the stop rule
//   --idle-between-batches S      sleep S seconds between batches (proves connections survive an idle gap)
//   --inject-exception-in-batch N throw inside batch N (proves an exception is recorded and the batch saved)
//   --dry-run               2,000 chunks; the vector, text, chunk-count and sigma pools may be missing
//
// A real run (not --dry-run) REFUSES to start unless all four pools of the desk exist under
// ~/niyantran-eval-cache/load-proof/ (pool.ts, then nn.ts). Which were used, and their sizes, are in the results.
//
// STOP RULE (stop-rule.ts). The run stops, saves its file with the reason, and exits 2 when: the host has under
// 6 GiB free; a job fails; the worker reports any failure (a failed step, advance, claim or settings read);
// the database logs a statement timeout or a deadlock; a chunk lands outside its partition; a request hangs
// past the fetch timeout; or the run throws. Worker failures are checked synchronously before every worker
// run; database checks run in sample(), on the timer and after every batch. Settings are put back (claim_batch
// 1, max_running 2) on the way out.

import {
  CACHE_DIR,
  dbLogTrouble,
  dirOf,
  elapsedMs,
  FETCH_TIMEOUT_MS,
  hostFreeGiB,
  postgrestPool,
  psql,
  psqlJson,
  rng,
} from './lib.ts';
import { MIN_FREE_GIB, stopFor } from './stop-rule.ts';
import { drain, makeHarness } from './driver.ts';
import { DEFAULT_SIGMA, loadPool, makeFakeEmbedder, poolPath } from './fake-embed.ts';
import {
  ensurePolicy,
  type FeatureKey,
  FEATURES,
  loadChunkCounts,
  loadTextPool,
  pickChunkCount,
  registerBatch,
  relabel,
  seedDeskRows,
  synthDoc,
} from './synth.ts';

const PARTITION: Record<FeatureKey, string> = {
  bills: 'document_chunks_bills',
  nclt: 'document_chunks_nclt',
  regulatory: 'document_chunks_regulatory',
  pq: 'document_chunks_default',
  other: 'document_chunks_default',
};

function arg(flag: string, fallback?: string): string | undefined {
  const i = Deno.args.indexOf(flag);
  return i >= 0 ? Deno.args[i + 1] : fallback;
}
const num = (flag: string, fallback: number) => {
  const v = Number(arg(flag, String(fallback)));
  if (!Number.isFinite(v) || v < 0) throw new Error(`${flag} must be a non-negative number`);
  return v;
};

const dryRun = Deno.args.includes('--dry-run');
const feature = (arg('--feature', 'bills') ?? 'bills') as FeatureKey;
if (!(feature in FEATURES)) throw new Error(`--feature must be one of ${Object.keys(FEATURES).join(', ')}`);
const target = num('--target-chunks', dryRun ? 2000 : 0);
if (!target) throw new Error('--target-chunks is required (or --dry-run for 2,000)');
if (!dryRun && target > 2000 && !Deno.args.includes('--confirm-load')) {
  throw new Error(
    `refusing a load of ${target} chunks without --confirm-load (the supervisor runs measured loads; a dry run is --dry-run)`,
  );
}
const levels = (arg('--concurrency', '2') ?? '2').split(',').map(Number);
if (!levels.length || levels.some((n) => !Number.isInteger(n) || n < 1)) {
  throw new Error('--concurrency must be whole numbers of at least 1, such as 2 or 2,4,8');
}
const maxLevel = Math.max(...levels);
const levelChunks = num('--level-chunks', 20000);
const claimBatch = num('--claim-batch', 1);
if (!Number.isInteger(claimBatch) || claimBatch < 1) {
  throw new Error('--claim-batch must be a whole number of at least 1');
}
// Every worker must be able to hold a full claim, or the workers queue behind max_running and the run is
// fewer writers than its label says (review finding B3).
const maxRunning = Math.max(num('--max-running', 2), claimBatch * maxLevel);
const docsPerBatch = Math.max(1, num('--docs-per-batch', 300));
const bucketSize = Math.max(1, num('--bucket', Math.max(500, Math.round(target / 10))));
const sampleSeconds = Math.max(1, num('--sample-seconds', 15));
const seed = num('--seed', 1);
const tag = (arg('--tag') ?? `ld${Date.now().toString(36)}`).replace(/[^a-z0-9]/gi, '').toLowerCase();
const out = arg('--out') ?? `${CACHE_DIR}/results/${tag}-${feature}-${target}.json`;
const minFree = num('--min-free-gib', MIN_FREE_GIB);
const injectAt = num('--inject-embed-failure-at', 0);
const idleGap = num('--idle-between-batches', 0);
const injectException = num('--inject-exception-in-batch', 0);

// ─── what is recorded ────────────────────────────────────────────────────────

const SETTINGS = [
  'shared_buffers',
  'wal_compression',
  'full_page_writes',
  'checkpoint_timeout',
  'max_wal_size',
  'min_wal_size',
  'checkpoint_completion_target',
  'maintenance_work_mem',
  'work_mem',
  'effective_cache_size',
  'synchronous_commit',
  'wal_level',
  'max_connections',
  'max_parallel_maintenance_workers',
  'statement_timeout',
];

/** One statement, one snapshot: the LSN, the WAL and checkpoint counters, the failed jobs of this run and every table's sizes. */
const sampleSql = (dbStart: string, lsnStart: string, lsnLast: string) => `
  select json_build_object(
    'lsn', pg_current_wal_lsn()::text,
    'since_start', pg_wal_lsn_diff(pg_current_wal_lsn(), '${lsnStart}')::bigint,
    'since_last', pg_wal_lsn_diff(pg_current_wal_lsn(), '${lsnLast}')::bigint,
    'wal', (select row_to_json(w) from (select wal_records, wal_fpi, wal_bytes, wal_buffers_full from pg_stat_wal) w),
    'checkpoints', (select row_to_json(c) from (select num_timed, num_requested, write_time, sync_time, buffers_written from pg_stat_checkpointer) c),
    'failed_jobs', (select json_build_object('n', count(*), 'code', min(error_code), 'message', min(left(last_error, 160)))
                      from public.ingest_jobs where status = 'failed' and created_at >= '${dbStart}'),
    'relations', (select coalesce(json_agg(r), '[]'::json) from (
      select c.relname as name, c.relkind as kind, pg_relation_size(c.oid) as heap,
             coalesce(pg_relation_size(c.reltoastrelid), 0) +
               coalesce((select sum(pg_relation_size(i.indexrelid)) from pg_index i where i.indrelid = c.reltoastrelid), 0) as toast,
             coalesce((select sum(pg_relation_size(i.indexrelid)) from pg_index i where i.indrelid = c.oid), 0) as indexes,
             coalesce((select jsonb_object_agg(ic.relname, pg_relation_size(i.indexrelid)) from pg_index i join pg_class ic on ic.oid = i.indexrelid where i.indrelid = c.oid), '{}'::jsonb) as index_sizes,
             pg_total_relation_size(c.oid) as total
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (c.relname like 'document_chunks\\_%' escape '\\' or pg_total_relation_size(c.oid) > 262144)
       order by total desc) r)
  )`;

interface Sample {
  t_s: number;
  chunks_inserted: number;
  chunks_in_partition: number;
  wal_lsn: string;
  wal_bytes_since_start: number;
  wal_bytes_per_chunk_since_last: number | null;
  pg_stat_wal: Record<string, number>;
  checkpoints: Record<string, number>;
  host_free_gib: number;
  loop_lag_ms: { p99: number; max: number };
  relations: unknown[];
}

interface BatchRecord {
  n: number;
  level: number;
  docs: number;
  chunks_planned: number;
  chunks_inserted: number;
  size_start: number;
  size_end: number;
  t_start_s: number;
  synth_s?: number;
  register_s?: number;
  relabel_s?: number;
  drain_s?: number;
  drain_t0_ms?: number;
  drain_t1_ms?: number;
  lsn_drain_start?: string;
  lsn_drain_end?: string;
  wal_bytes_drain?: number;
  wal_bytes_per_chunk_drain?: number | null;
  chunks_per_second_drain?: number | null;
  max_inflight_commits?: number;
  max_inflight_calls?: number;
  done: boolean;
}

const percentiles = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
  return {
    n: s.length,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: +s[s.length - 1].toFixed(2),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
  };
};

async function describePools(slug: string) {
  const files = {
    vectors: poolPath(slug),
    text: `${CACHE_DIR}/text-${slug}.json`,
    counts: `${CACHE_DIR}/counts-${slug}.json`,
    sigma: `${CACHE_DIR}/sigma-${slug}.json`,
  };
  const exists = async (p: string) => await Deno.stat(p).then(() => true, () => false);
  const missing = [];
  for (const [k, p] of Object.entries(files)) if (!(await exists(p))) missing.push(`${k} (${p})`);
  return { slug, files, missing };
}

async function main() {
  const startedIso = new Date().toISOString();
  const f = FEATURES[feature];
  const partition = PARTITION[feature];
  const poolSlug = feature === 'other' ? 'pq' : feature;

  // B1: no silent fallback. A measured run needs the real pools.
  const poolInfo = await describePools(poolSlug);
  if (poolInfo.missing.length && !dryRun) {
    throw new Error(
      `refusing to run without the pools of ${poolSlug}: missing ${poolInfo.missing.join(', ')}. ` +
        `Build them with pool.ts and nn.ts (or use --dry-run).`,
    );
  }
  const [pool, textPool, counts] = await Promise.all([
    loadPool(poolSlug),
    loadTextPool(poolSlug),
    loadChunkCounts(poolSlug),
  ]);
  const sigmaRecord = await Deno.readTextFile(poolInfo.files.sigma).then((t) => JSON.parse(t), () => null);
  const sigma: number = sigmaRecord?.sigma ?? DEFAULT_SIGMA;

  // B3/B5: the workers must fit in PostgREST's pool.
  const pgrestPool = await postgrestPool();
  if (maxLevel > 8 && maxLevel + 2 > pgrestPool) {
    throw new Error(
      `${maxLevel} workers need PGRST_DB_POOL above ${
        maxLevel + 1
      }; it is ${pgrestPool}. Restart postgrest.sh with LOAD_PROOF_POOL.`,
    );
  }

  const embedder = makeFakeEmbedder({
    pool,
    noise: sigma,
    track: false,
    fail: injectAt ? (_i, call) => (call === injectAt ? new Error('injected provider failure') : null) : undefined,
  });
  const h = await makeHarness({ embedder });
  const next = rng(seed);
  const tSec = () => elapsedMs() / 1000;

  const free0 = await hostFreeGiB();
  const early = stopFor({ freeGiB: free0, minFreeGiB: minFree });
  if (early) throw new Error(`${early} before the run starts`);
  const baseChunks = Number(await psql(`select count(*) from public.${partition}`));
  const lsn0 = await psql('select pg_current_wal_lsn()');
  // Failures are judged on this run's jobs only, by the database's own clock.
  const dbStart = await psql(`select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  const settings = await psqlJson<Array<{ name: string; setting: string; unit: string | null }>>(
    `select name, setting, unit from pg_settings where name in (${
      SETTINGS.map((s) => `'${s}'`).join(',')
    }) order by name`,
  );
  const versions = await psql('select version()');

  await psql(`update public.ingest_settings set claim_batch = ${claimBatch}, max_running = ${maxRunning}`);
  await ensurePolicy(h.svc, 'national-pq');
  const runner = await h.rest.client('corpus_ingest');

  // ── state ──
  const samples: Sample[] = [];
  const batches: BatchRecord[] = [];
  let stopReason: string | null = null;
  const stop = (reason: string) => {
    stopReason ??= reason;
  };
  let insertedLive = 0, seenCommits = 0, lastInserted = 0, lastLsn = lsn0;
  const lagAll: number[] = [];
  let lagWindow: number[] = [];
  let currentLevel = levels[0];
  const sampling = { busy: false };

  /** Folds the commits the driver has timed into insertedLive (the live count; no count(*) on the timer). */
  const foldCommits = () => {
    for (; seenCommits < h.events.commits.length; seenCommits++) insertedLive += h.events.commits[seenCommits].inserted;
  };

  // Event-loop lag: a 100 ms ticker that records how late it fires. Material lag means the single process
  // (fake vectors, JSON, hashing) is itself a bottleneck and the level's numbers are not the database's.
  let tick = performance.now();
  const lagTimer = setInterval(() => {
    const now = performance.now();
    const lag = Math.max(0, now - tick - 100);
    tick = now;
    lagWindow.push(lag);
    lagAll.push(lag);
  }, 100);

  function groupResults() {
    // B7: rates come from drain windows only. A batch counts in the bucket where it started.
    const finished = batches.filter((b) => b.done && b.drain_s && b.drain_s > 0);
    const finalSize = baseChunks + insertedLive;
    const by = new Map<string, BatchRecord[]>();
    for (const b of finished) {
      const k = `${b.level}:${Math.floor(b.size_start / bucketSize)}`;
      by.set(k, [...(by.get(k) ?? []), b]);
    }
    const rows = [...by].map(([k, bs]) => {
      const [level, bucket] = k.split(':').map(Number);
      const chunks = bs.reduce((s, b) => s + b.chunks_inserted, 0);
      const secs = bs.reduce((s, b) => s + b.drain_s!, 0);
      const wal = bs.reduce((s, b) => s + (b.wal_bytes_drain ?? 0), 0);
      const inWindow = h.events.commits.filter((c) => bs.some((b) => c.at >= b.drain_t0_ms! && c.at <= b.drain_t1_ms!));
      return {
        concurrency: level,
        partition_size_from: bucket * bucketSize,
        partition_size_to: (bucket + 1) * bucketSize,
        batches: bs.length,
        chunks,
        drain_seconds: +secs.toFixed(2),
        chunks_per_second: secs > 0 ? +(chunks / secs).toFixed(1) : null,
        wal_bytes_per_chunk: chunks > 0 ? Math.round(wal / chunks) : null,
        max_inflight_commits: Math.max(...bs.map((b) => b.max_inflight_commits ?? 0)),
        commit_ms: percentiles(inWindow.filter((c) => c.ok).map((c) => c.ms)),
        commit_server_ms: percentiles(
          inWindow.filter((c) => c.ok && c.server_ms !== undefined).map((c) => c.server_ms!),
        ),
        failed_commits: inWindow.filter((c) => !c.ok).length,
        complete: (bucket + 1) * bucketSize <= finalSize,
      };
    }).sort((a, b) => a.partition_size_from - b.partition_size_from || a.concurrency - b.concurrency);
    return { complete: rows.filter((r) => r.complete), partial: rows.filter((r) => !r.complete) };
  }

  const opSummary = () => {
    const by = (op: string) => h.events.ops.filter((o) => o.op === op);
    const sum = (xs: typeof h.events.ops) => ({
      ...percentiles(xs.filter((o) => o.ok).map((o) => o.ms)),
      failed: xs.filter((o) => !o.ok).length,
    });
    return { claim: sum(by('claim')), textActivate: sum(by('textActivate')), activate: sum(by('activate')) };
  };

  /**
   * The acceptance check on synthetic text: the partition's bytes per chunk before the run (the real chunks
   * already there) against the growth per chunk added. Heap per chunk tracks chunk text and metadata; TOAST
   * tracks text and vector; if added is far from base, the synthetic documents are not the real ones' size.
   */
  const sizePerChunk = () => {
    const first = samples[0], last = samples[samples.length - 1];
    const rel = (sm: Sample | undefined) =>
      (sm?.relations as Array<{ name: string; heap: number; toast: number; indexes: number }> | undefined)?.find((r) =>
        r.name === partition
      );
    const a = rel(first), b = rel(last);
    if (!a || !b || last.chunks_inserted <= 0) return null;
    const added = last.chunks_inserted;
    const per = (x: number, n: number) => Math.round(x / n);
    const base = baseChunks > 0
      ? {
        chunks: baseChunks,
        heap: per(a.heap, baseChunks),
        toast: per(a.toast, baseChunks),
        indexes: per(a.indexes, baseChunks),
      }
      : null;
    const growth = {
      chunks: added,
      heap: per(b.heap - a.heap, added),
      toast: per(b.toast - a.toast, added),
      indexes: per(b.indexes - a.indexes, added),
    };
    return {
      base,
      added: growth,
      added_over_base: base
        ? {
          heap: +(growth.heap / base.heap).toFixed(2),
          toast: +(growth.toast / base.toast).toFixed(2),
          indexes: +(growth.indexes / base.indexes).toFixed(2),
        }
        : null,
    };
  };

  const result = () => {
    const g = groupResults();
    const commitsOk = h.events.commits.filter((c) => c.ok);
    return {
      run: {
        tag,
        feature,
        partition,
        target_chunks: target,
        base_chunks: baseChunks,
        concurrency_levels: levels,
        level_chunks: levelChunks,
        claim_batch: claimBatch,
        max_running: maxRunning,
        postgrest_pool: pgrestPool,
        docs_per_batch: docsPerBatch,
        bucket_chunks: bucketSize,
        seed,
        dry_run: dryRun,
        started: startedIso,
        wall_seconds: tSec(),
        fetch_timeout_ms: FETCH_TIMEOUT_MS,
        postgres: versions,
        settings,
      },
      pools: {
        required: !dryRun,
        missing: poolInfo.missing,
        vectors: pool ? { file: poolInfo.files.vectors, count: pool.count } : null,
        text: textPool ? { file: poolInfo.files.text, count: textPool.length } : null,
        chunk_counts: counts ? { file: poolInfo.files.counts, count: counts.length } : null,
        sigma: { used: sigma, from: sigmaRecord ? poolInfo.files.sigma : 'DEFAULT_SIGMA' },
        fallbacks: [
          ...(pool ? [] : ['seeded random unit vectors']),
          ...(textPool ? [] : ['seeded pseudo-text']),
          ...(counts ? [] : ['default long-tailed chunk counts']),
        ],
      },
      vector_fidelity: sigmaRecord
        ? {
          sigma: sigmaRecord.sigma,
          real: sigmaRecord.real,
          synthetic: sigmaRecord.synthetic,
          method: sigmaRecord.method,
        }
        : null,
      size_per_chunk: sizePerChunk(),
      stop_reason: stopReason,
      totals: {
        docs: batches.reduce((s, b) => s + b.docs, 0),
        chunks_inserted: insertedLive,
        commits: commitsOk.length,
        failed_commits: h.events.commits.length - commitsOk.length,
        embed_calls: embedder.calls,
        max_inflight_commits: Math.max(0, ...batches.map((b) => b.max_inflight_commits ?? 0)),
      },
      throughput: g.complete,
      partial_buckets: g.partial,
      commit_ms: percentiles(commitsOk.map((c) => c.ms)),
      commit_server_ms: percentiles(commitsOk.filter((c) => c.server_ms !== undefined).map((c) => c.server_ms!)),
      other_calls_ms: opSummary(),
      loop_lag_ms: { all: percentiles(lagAll) },
      batches,
      samples,
      failures: h.events.failures,
      worker_events: h.events.counts,
    };
  };

  let saving = false;
  const save = async () => {
    if (saving) return;
    saving = true;
    try {
      await Deno.mkdir(dirOf(out), { recursive: true });
      await Deno.writeTextFile(
        `${out}.tmp`,
        JSON.stringify(
          {
            ...result(),
            slices: h.events.commits.map((c) => ({
              t_s: +(c.at / 1000).toFixed(3),
              ms: +c.ms.toFixed(2),
              ...(c.server_ms !== undefined ? { server_ms: c.server_ms } : {}),
              rows: c.rows,
              inserted: c.inserted,
              ok: c.ok,
            })),
          },
          null,
          1,
        ),
      );
      await Deno.rename(`${out}.tmp`, out);
    } finally {
      saving = false;
    }
  };

  async function sample() {
    if (sampling.busy) return;
    sampling.busy = true;
    try {
      foldCommits(); // before the LSN: every chunk counted was inserted by the time the LSN is read
      const inserted = insertedLive;
      const snap = JSON.parse(await psql(sampleSql(dbStart, lsn0, lastLsn)));
      const free = await hostFreeGiB();
      const diff = Number(snap.since_start), sinceLast = Number(snap.since_last);
      const win = lagWindow;
      lagWindow = [];
      const lag = percentiles(win);
      samples.push({
        t_s: +tSec().toFixed(1),
        chunks_inserted: inserted,
        chunks_in_partition: baseChunks + inserted,
        wal_lsn: snap.lsn,
        wal_bytes_since_start: diff,
        wal_bytes_per_chunk_since_last: inserted > lastInserted
          ? Math.round(sinceLast / (inserted - lastInserted))
          : null,
        pg_stat_wal: snap.wal,
        checkpoints: snap.checkpoints,
        host_free_gib: +free.toFixed(2),
        loop_lag_ms: { p99: lag?.p99 ?? 0, max: lag?.max ?? 0 },
        relations: snap.relations,
      });
      lastLsn = snap.lsn;
      lastInserted = inserted;
      // B4 and S2: the database-side stop checks live here, not on the workers' path.
      let trouble: string[] | undefined;
      try {
        trouble = await dbLogTrouble(startedIso);
      } catch (e) {
        stop(`STOP: ${(e as Error).message}`); // a log that cannot be read is not "nothing found"
      }
      stopReason ??= stopFor({
        freeGiB: free,
        minFreeGiB: minFree,
        trouble,
        failedJobs: snap.failed_jobs.n,
        failedWhy: snap.failed_jobs.n ? `${snap.failed_jobs.code}: ${snap.failed_jobs.message}` : undefined,
      });
    } finally {
      sampling.busy = false;
    }
  }

  // The worker's own failure report is checked synchronously, before every run of the worker (B4).
  const shouldStop = (): string | null => {
    if (!stopReason && h.events.failures.length) {
      stopReason = stopFor({ workerFailure: JSON.stringify(h.events.failures[0]) });
    }
    return stopReason;
  };

  const timer = setInterval(() => {
    void (async () => {
      await sample();
      await save();
    })().catch((e) => stop(`STOP: sampling failed: ${(e as Error).message}`));
  }, sampleSeconds * 1000);

  console.log(
    `load ${tag}: ${feature} to ${target} chunks (${baseChunks} there), concurrency ${levels.join(',')}` +
      `${
        levels.length > 1 ? ` (every ${levelChunks} chunks)` : ''
      }, claim_batch ${claimBatch}, max_running ${maxRunning}, ` +
      `sigma ${sigma}${pool ? '' : ' (no pool)'}; host free ${free0.toFixed(1)} GiB`,
  );
  await sample();
  let n = 0;
  try {
    while (!stopReason && baseChunks + insertedLive < target) {
      // Level for this batch, and a batch that does not run past the level's end.
      const levelIdx = levels.length > 1 ? Math.floor(insertedLive / levelChunks) % levels.length : 0;
      currentLevel = levels[levelIdx];
      const boundary = levels.length > 1 ? (Math.floor(insertedLive / levelChunks) + 1) * levelChunks : Infinity;
      const room = Math.min(target - baseChunks - insertedLive, boundary - insertedLive);

      if (idleGap && batches.length) {
        console.log(`  idle ${idleGap}s before the next batch`);
        await new Promise((r) => setTimeout(r, idleGap * 1000));
      }
      const rec: BatchRecord = {
        n: batches.length + 1,
        level: currentLevel,
        docs: 0,
        chunks_planned: 0,
        chunks_inserted: 0,
        size_start: baseChunks + insertedLive,
        size_end: baseChunks + insertedLive,
        t_start_s: +tSec().toFixed(2),
        done: false,
      };
      batches.push(rec); // in the file from the first moment, so an exception still saves it (S1)

      const tSynth = performance.now();
      const docs = [];
      while (docs.length < docsPerBatch && rec.chunks_planned < room) {
        const want = Math.min(pickChunkCount(next, counts), room - rec.chunks_planned);
        const d = await synthDoc({ tag, n: ++n, chunks: Math.max(1, want), seed, textPool });
        docs.push(d);
        rec.chunks_planned += d.chunks;
      }
      rec.docs = docs.length;
      rec.synth_s = +((performance.now() - tSynth) / 1000).toFixed(2);

      const tReg = performance.now();
      await seedDeskRows(docs);
      const reg = await registerBatch(runner, docs, { collection: 'national-pq' });
      rec.register_s = +((performance.now() - tReg) / 1000).toFixed(2);
      const refused = reg.results.filter((r) => r.outcome !== 'admitted');
      if (refused.length) {
        stop(`STOP: ${refused.length} documents were not admitted: ${JSON.stringify(refused[0])}`);
        break;
      }
      const tRel = performance.now();
      if (feature !== 'pq') await relabel(docs.map((d) => d.sourceKey), f);
      rec.relabel_s = +((performance.now() - tRel) / 1000).toFixed(2);

      if (injectException === rec.n) throw new Error(`injected exception in batch ${rec.n}`);
      const docIds = reg.results.map((r) => r.document_id!);
      const idList = `array[${docIds.map((i) => `'${i}'`).join(',')}]::uuid[]`;
      // The drain window: from the LSN read before it to the LSN read after it, nothing else inside.
      rec.lsn_drain_start = await psql('select pg_current_wal_lsn()');
      foldCommits();
      const insertedBefore = insertedLive;
      h.takeInflightMax();
      rec.drain_t0_ms = elapsedMs();
      const r = await drain(h, {
        concurrency: currentLevel,
        shouldStop,
        pending: async () =>
          Number(
            await psql(
              `select count(*) from public.ingest_jobs where document_id = any(${idList}) and status in ('queued','running')`,
            ),
          ),
      });
      rec.drain_t1_ms = elapsedMs();
      foldCommits();
      const inflight = h.takeInflightMax();
      rec.lsn_drain_end = await psql('select pg_current_wal_lsn()');
      rec.wal_bytes_drain = Number(
        await psql(`select pg_wal_lsn_diff('${rec.lsn_drain_end}', '${rec.lsn_drain_start}')::bigint`),
      );
      rec.drain_s = +((rec.drain_t1_ms - rec.drain_t0_ms) / 1000).toFixed(2);
      rec.chunks_inserted = insertedLive - insertedBefore;
      rec.size_end = baseChunks + insertedLive;
      rec.max_inflight_commits = inflight.commits;
      rec.max_inflight_calls = inflight.calls;
      rec.chunks_per_second_drain = rec.drain_s > 0 ? +(rec.chunks_inserted / rec.drain_s).toFixed(1) : null;
      rec.wal_bytes_per_chunk_drain = rec.chunks_inserted > 0
        ? Math.round(rec.wal_bytes_drain / rec.chunks_inserted)
        : null;
      rec.done = true;

      const wrong = Number(
        await psql(
          `select count(*) from public.document_chunks c where c.document_id = any(${idList}) and c.tableoid::regclass::text <> '${partition}'`,
        ),
      );
      stopReason ??= stopFor({ wrongPartition: wrong, partition });
      await sample();
      shouldStop(); // S2: after every drain
      await save();

      const elapsed = tSec(), inserted = insertedLive;
      const projected = inserted > 0 ? (elapsed * (target - baseChunks)) / inserted : null;
      console.log(
        `  ${
          elapsed.toFixed(0)
        }s  batch ${rec.n} (c${currentLevel}): +${docs.length} docs, ${rec.chunks_inserted} chunks, ` +
          `synth ${rec.synth_s}s register ${rec.register_s}s drain ${rec.drain_s}s (${rec.chunks_per_second_drain} chunks/s); ` +
          `partition ${baseChunks + inserted}/${target}` +
          (projected ? `; projected total ${(projected / 3600).toFixed(2)} h` : '') +
          (r.stopped ? ` (${r.stopped})` : ''),
      );
      if (r.stopped && r.stopped !== 'drain timeout') stop(r.stopped);
      if (r.stopped === 'drain timeout') stop('STOP: the drain timed out');
    }
  } catch (e) {
    stop(`STOP: exception: ${(e as Error).message}`); // S1: recorded, and the batch in progress is saved below
  } finally {
    clearInterval(timer);
    clearInterval(lagTimer);
    foldCommits();
    await sample().catch((e) => stop(`STOP: final sample failed: ${(e as Error).message}`));
    await save().catch((e) => console.error(`could not save ${out}: ${(e as Error).message}`));
    await psql('update public.ingest_settings set claim_batch = 1, max_running = 2').catch(() => {});
    h.close();
  }
  console.log(
    stopReason
      ? `\n${stopReason}\nresults (partial): ${out}`
      : `\ndone: ${insertedLive} chunks in ${tSec().toFixed(1)} s; results: ${out}`,
  );
  Deno.exit(stopReason ? 2 : 0);
}

try {
  await main();
} catch (e) {
  console.error((e as Error).message);
  Deno.exit(2);
}
