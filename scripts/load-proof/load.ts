// The write-load generator of the F287 proof (E2 and E3). Synthetic documents are registered through the
// real batch functions (ingest_batch_open, add_items, seal, ingest_register_batch, as corpus_ingest) and
// indexed by the real worker (driver.ts) at a set concurrency, until the target partition holds the
// target number of chunks. It records, to one JSON file:
//
//   slices      per commit (one chunk_commit or ingest_text_commit call): latency and rows, bucketed by the
//               partition's size when the commit began
//   throughput  chunks per second and commit latency percentiles per partition-size bucket
//   samples     every few seconds and at each batch: pg_current_wal_lsn, WAL bytes per chunk since the last
//               sample, host free disk, and the size of every partition (heap, TOAST, indexes with each
//               index) and of ingest_text_inputs and every other table ingestion writes
//   failures    every failed job, statement timeout and deadlock (each also stops the run)
//
//   deno run -A scripts/load-proof/load.ts --dry-run                       2,000 chunks on Bills
//   deno run -A scripts/load-proof/load.ts --feature bills --target-chunks 445000 --concurrency 2 \
//        --claim-batch 2 --max-running 2 --out eval/ingestion/results/bills-c2.json
//
// Options: --feature bills|nclt|regulatory|pq|other (default bills), --target-chunks N (the partition's
// total, counting chunks already there), --concurrency N workers (default 2), --claim-batch N and
// --max-running N (ingest_settings; defaults 1 and 2, today's), --docs-per-batch N (default 400),
// --bucket N chunks per throughput bucket (default target/10), --sample-seconds N (default 15),
// --seed N, --tag NAME, --out PATH, --min-free-gib N (raise the 6 GiB floor, never lower it),
// --inject-embed-failure-at N (fail the Nth embedding call, to prove the stop rule).
//
// STOP RULE. The run stops, writes its file with the reason, and exits 2 when: the host has under 6 GiB
// free; a job fails; the database logs a statement timeout or a deadlock; a chunk lands outside the
// expected partition; or the worker reports a failure. It checks before each run of the worker and at
// each sample. Settings are put back (claim_batch 1, max_running 2) on the way out.

import { CACHE_DIR, dbLogTrouble, hostFreeGiB, psql, psqlJson, rng } from './lib.ts';
import { MIN_FREE_GIB, stopFor } from './stop-rule.ts';
import { drain, makeHarness } from './driver.ts';
import { loadPool, makeFakeEmbedder } from './fake-embed.ts';
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
const concurrency = num('--concurrency', 2);
const claimBatch = num('--claim-batch', 1);
const maxRunning = Math.max(num('--max-running', 2), claimBatch);
const docsPerBatch = num('--docs-per-batch', 400);
const bucketSize = num('--bucket', Math.max(500, Math.round(target / 10)));
const sampleSeconds = num('--sample-seconds', 15);
const seed = num('--seed', 1);
const tag = (arg('--tag') ?? `ld${Date.now().toString(36)}`).replace(/[^a-z0-9]/gi, '').toLowerCase();
const out = arg('--out') ?? `${CACHE_DIR}/results/${tag}-${feature}-${target}.json`;
const sampleEvery = sampleSeconds * 1000;
const minFree = num('--min-free-gib', MIN_FREE_GIB);
const injectAt = num('--inject-embed-failure-at', 0);

// ─── what is recorded ────────────────────────────────────────────────────────

interface Sample {
  t_s: number;
  chunks_in_partition: number;
  chunks_added: number;
  wal_lsn: string;
  wal_bytes_since_start: number;
  wal_bytes_per_chunk_since_last: number | null;
  host_free_gib: number;
  documents: number;
  relations: Array<
    {
      name: string;
      kind: string;
      heap: number;
      toast: number;
      indexes: number;
      index_sizes: Record<string, number>;
      total: number;
    }
  >;
}

const SIZES_SQL = `
  select c.relname as name, c.relkind as kind, pg_relation_size(c.oid) as heap,
         coalesce(pg_relation_size(c.reltoastrelid), 0) +
           coalesce((select sum(pg_relation_size(i.indexrelid)) from pg_index i where i.indrelid = c.reltoastrelid), 0) as toast,
         coalesce((select sum(pg_relation_size(i.indexrelid)) from pg_index i where i.indrelid = c.oid), 0) as indexes,
         coalesce((select jsonb_object_agg(ic.relname, pg_relation_size(i.indexrelid)) from pg_index i join pg_class ic on ic.oid = i.indexrelid where i.indrelid = c.oid), '{}'::jsonb) as index_sizes,
         pg_total_relation_size(c.oid) as total
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (c.relname like 'document_chunks\\_%' escape '\\' or pg_total_relation_size(c.oid) > 262144)
   order by total desc`;

async function main() {
  const startedIso = new Date().toISOString();
  const t0 = performance.now();
  const tSec = () => (performance.now() - t0) / 1000;
  const f = FEATURES[feature];
  const partition = PARTITION[feature];
  const poolSlug = feature === 'other' ? 'default' : feature;
  const [pool, textPool, counts] = await Promise.all([
    loadPool(poolSlug),
    loadTextPool(poolSlug),
    loadChunkCounts(poolSlug),
  ]);
  const embedder = makeFakeEmbedder({
    pool,
    track: false,
    fail: injectAt ? (_i, call) => (call === injectAt ? new Error('injected provider failure') : null) : undefined,
  });
  const h = await makeHarness({ embedder });
  const next = rng(seed);

  const free0 = await hostFreeGiB();
  const early = stopFor({ freeGiB: free0, minFreeGiB: minFree });
  if (early) throw new Error(`${early} before the run starts`);
  const partitionCount = async () => Number(await psql(`select count(*) from public.${partition}`));
  const baseChunks = await partitionCount();
  const lsn0 = await psql('select pg_current_wal_lsn()');
  // Failures are judged on this run's jobs only, by the database's own clock.
  const dbStart = await psql(`select to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

  await psql(`update public.ingest_settings set claim_batch = ${claimBatch}, max_running = ${maxRunning}`);
  await ensurePolicy(h.svc, 'national-pq');
  const runner = await h.rest.client('corpus_ingest');

  const samples: Sample[] = [];
  let stopReason: string | null = null;
  let addedChunks = 0, addedDocs = 0, lastLsn = lsn0, lastAdded = 0;
  /** Chunks inserted so far, from the commits the driver timed. */
  let insertedLive = 0, seenCommits = 0;
  const sampling = { busy: false };

  const result = () => ({
    run: {
      tag,
      feature,
      partition,
      target_chunks: target,
      base_chunks: baseChunks,
      concurrency,
      claim_batch: claimBatch,
      max_running: maxRunning,
      docs_per_batch: docsPerBatch,
      seed,
      dry_run: dryRun,
      started: startedIso,
      wall_seconds: tSec(),
      fake_vectors: pool ? `pool of ${pool.count} real vectors plus noise` : 'seeded random unit vectors',
      text: textPool ? 'real chunk text of the desk, shuffled' : 'seeded pseudo-text',
      chunk_counts: counts ? 'desk distribution' : 'default long-tailed distribution',
    },
    stop_reason: stopReason,
    totals: {
      docs_added: addedDocs,
      chunks_added: addedChunks,
      commits: h.events.commits.length,
      embed_calls: embedder.calls,
    },
    throughput: buckets(),
    commit_latency_ms: percentiles(h.events.commits.map((c) => c.ms)),
    samples,
    failures: h.events.failures,
    worker_events: h.events.counts,
  });
  const save = async () => {
    await Deno.mkdir(out.slice(0, out.lastIndexOf('/')) || '.', { recursive: true });
    await Deno.writeTextFile(
      `${out}.tmp`,
      JSON.stringify(
        {
          ...result(),
          slices: h.events.commits.map((c) => ({
            t_s: +(c.at / 1000).toFixed(3),
            ms: +c.ms.toFixed(2),
            rows: c.rows,
            inserted: c.inserted,
          })),
        },
        null,
        1,
      ),
    );
    await Deno.rename(`${out}.tmp`, out);
  };

  function percentiles(xs: number[]) {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b),
      q = (p: number) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
    return {
      n: s.length,
      p50: q(0.5),
      p95: q(0.95),
      p99: q(0.99),
      max: +s[s.length - 1].toFixed(2),
      mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
    };
  }

  /** Chunks per second and commit latency by the partition's size when each commit began. */
  function buckets() {
    const by = new Map<number, { rows: number; first: number; last: number; ms: number[] }>();
    let size = baseChunks;
    for (const c of h.events.commits) {
      const k = Math.floor(size / bucketSize);
      const b = by.get(k) ?? { rows: 0, first: Infinity, last: 0, ms: [] };
      b.rows += c.inserted;
      b.first = Math.min(b.first, c.at);
      b.last = Math.max(b.last, c.at + c.ms);
      b.ms.push(c.ms);
      by.set(k, b);
      size += c.inserted;
    }
    return [...by].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({
      partition_size_from: k * bucketSize,
      partition_size_to: (k + 1) * bucketSize,
      chunks: b.rows,
      seconds: +((b.last - b.first) / 1000).toFixed(2),
      chunks_per_second: b.last > b.first ? +(b.rows / ((b.last - b.first) / 1000)).toFixed(1) : null,
      commit_ms: percentiles(b.ms),
    }));
  }

  async function sample() {
    if (sampling.busy) return;
    sampling.busy = true;
    try {
      const [lsn, diff, free, docs, relations] = await Promise.all([
        psql('select pg_current_wal_lsn()'),
        psql(`select pg_wal_lsn_diff(pg_current_wal_lsn(), '${lsn0}')::bigint`),
        hostFreeGiB(),
        psql('select count(*) from public.documents'),
        psqlJson<Sample['relations']>(SIZES_SQL),
      ]);
      const sinceLast = Number(await psql(`select pg_wal_lsn_diff('${lsn}', '${lastLsn}')::bigint`));
      const chunksNow = await partitionCount();
      for (; seenCommits < h.events.commits.length; seenCommits++) {
        insertedLive += h.events.commits[seenCommits].inserted;
      }
      const sinceChunks = insertedLive - lastAdded;
      samples.push({
        t_s: +tSec().toFixed(1),
        chunks_in_partition: chunksNow,
        chunks_added: insertedLive,
        wal_lsn: lsn,
        wal_bytes_since_start: Number(diff),
        wal_bytes_per_chunk_since_last: sinceChunks > 0 ? Math.round(sinceLast / sinceChunks) : null,
        host_free_gib: +free.toFixed(2),
        documents: Number(docs),
        relations,
      });
      lastLsn = lsn;
      lastAdded = insertedLive;
      stopReason ??= stopFor({ freeGiB: free, minFreeGiB: minFree, trouble: await dbLogTrouble(startedIso) });
    } finally {
      sampling.busy = false;
    }
  }

  const timer = setInterval(() =>
    void sample().catch((e) => {
      stopReason ??= `STOP: sampling failed: ${(e as Error).message}`;
    }), sampleEvery);
  const shouldStop = async () => {
    if (stopReason) return stopReason;
    const w = h.events.failures[0];
    const failedJobs = Number(
      await psql(`select count(*) from public.ingest_jobs where status = 'failed' and created_at >= '${dbStart}'`),
    );
    const failedWhy = failedJobs
      ? await psql(
        `select coalesce(min(error_code), '') || ': ' || coalesce(min(left(last_error, 160)), '') from public.ingest_jobs where status = 'failed' and created_at >= '${dbStart}'`,
      )
      : undefined;
    return (stopReason = stopFor({ failedJobs, failedWhy, workerFailure: w ? JSON.stringify(w) : undefined }));
  };

  console.log(
    `load ${tag}: ${feature} to ${target} chunks (${baseChunks} there), concurrency ${concurrency}, claim_batch ${claimBatch}, max_running ${maxRunning}; host free ${
      free0.toFixed(1)
    } GiB`,
  );
  await sample();
  let n = 0;
  try {
    while (!stopReason && baseChunks + addedChunks < target) {
      const docs = [];
      let planned = 0;
      while (docs.length < docsPerBatch && baseChunks + addedChunks + planned < target) {
        const want = Math.min(pickChunkCount(next, counts), target - baseChunks - addedChunks - planned);
        const d = await synthDoc({ tag, n: ++n, chunks: Math.max(1, want), seed, textPool });
        docs.push(d);
        planned += d.chunks;
      }
      await seedDeskRows(docs);
      const reg = await registerBatch(runner, docs, { collection: 'national-pq' });
      const refused = reg.results.filter((r) => r.outcome !== 'admitted');
      if (refused.length) {
        stopReason = `STOP: ${refused.length} documents were not admitted: ${JSON.stringify(refused[0])}`;
        break;
      }
      if (feature !== 'pq') await relabel(docs.map((d) => d.sourceKey), f);
      const docIds = reg.results.map((r) => r.document_id!);
      const r = await drain(h, {
        concurrency,
        shouldStop,
        pending: async () =>
          Number(
            await psql(`select count(*) from public.ingest_jobs where document_id = any(array[${
              docIds.map((i) => `'${i}'`).join(',')
            }]::uuid[]) and status in ('queued','running')`),
          ),
      });
      addedDocs += docs.length;
      const idList = `array[${docIds.map((i) => `'${i}'`).join(',')}]::uuid[]`;
      addedChunks += Number(
        await psql(`select count(*) from public.document_chunks where document_id = any(${idList})`),
      );
      const wrong = Number(
        await psql(
          `select count(*) from public.document_chunks c where c.document_id = any(${idList}) and c.tableoid::regclass::text <> '${partition}'`,
        ),
      );
      stopReason ??= stopFor({ wrongPartition: wrong, partition });
      await sample();
      await save();
      console.log(
        `  ${tSec().toFixed(0)}s  +${docs.length} docs, partition ${baseChunks + addedChunks}/${target} chunks, drain ${
          (r.ms / 1000).toFixed(1)
        }s${r.stopped ? ` (${r.stopped})` : ''}`,
      );
      if (r.stopped && r.stopped !== 'drain timeout') stopReason ??= r.stopped;
    }
  } finally {
    clearInterval(timer);
    await sample().catch(() => {});
    await save();
    await psql('update public.ingest_settings set claim_batch = 1, max_running = 2');
    h.close();
  }
  console.log(
    stopReason
      ? `\n${stopReason}\nresults (partial): ${out}`
      : `\ndone: ${addedChunks} chunks in ${tSec().toFixed(1)} s; results: ${out}`,
  );
  Deno.exit(stopReason ? 2 : 0);
}

try {
  await main();
} catch (e) {
  console.error((e as Error).message);
  Deno.exit(2);
}
