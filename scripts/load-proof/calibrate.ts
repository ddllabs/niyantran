// Relay calibration (review finding on concurrency design). The harness reaches PostgREST through a relay
// (a docker exec per connection, lib.ts). This sends a roughly 3 MB request that does no database work at
// 1, 2, 4 and 8 connections and reports the median round trip of each level. A flat line means the relay
// and the single Deno process are not what a level's commit latency is measuring; a rising line means
// part of that level's latency is the relay, and the level's numbers must not be read as database time.
//
// The no-op is ingest_text_commit for a job that does not exist: PostgREST receives and parses all of the
// body, hands it to PostgreSQL as a parameter, and the function raises 'stale claim' before it looks at a
// row. Nothing is written.
//
//   scripts/load-proof/lp.sh calibrate.ts [--levels 1,2,4,8] [--requests 24] [--rows 170] [--out PATH]

import { elapsedMs, psqlJson } from './lib.ts';
import { openRest } from './lib.ts';
import { EMBED_DIMS } from '../../supabase/functions/_shared/embed.ts';
import { rng } from './lib.ts';

const arg = (flag: string, fallback: string) => {
  const i = Deno.args.indexOf(flag);
  return i >= 0 ? Deno.args[i + 1] : fallback;
};
const levels = arg('--levels', '1,2,4,8').split(',').map(Number);
const perLevel = Number(arg('--requests', '24'));
const nRows = Number(arg('--rows', '170'));
const out = arg('--out', '');

const next = rng(5);
const row = (i: number) => ({
  chunk_hash: `${i}`.padStart(64, '0'),
  chunk_index: i,
  content: 'x'.repeat(1000),
  embedding: Array.from({ length: EMBED_DIMS }, () => Number((next() - 0.5).toPrecision(8))),
});
const rows = Array.from({ length: nRows }, (_, i) => row(i));
const bytes = new TextEncoder().encode(JSON.stringify(rows)).length;

const rest = openRest();
const c = await rest.client('service_role');
const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

const results = [];
for (const level of levels) {
  const times: number[] = [];
  const t0 = elapsedMs();
  let n = 0;
  const worker = async () => {
    while (n < perLevel) {
      n += 1;
      const t = performance.now();
      const { error } = await c.rpc('ingest_text_commit', {
        p_job: crypto.randomUUID(),
        p_token: crypto.randomUUID(),
        p_rows: rows,
      });
      if (!error || !/stale claim/.test(error.message)) {
        throw new Error(`unexpected reply: ${error?.message ?? 'success'}`);
      }
      times.push(performance.now() - t);
    }
  };
  await Promise.all(Array.from({ length: level }, worker));
  const wall = (elapsedMs() - t0) / 1000;
  results.push({
    connections: level,
    requests: times.length,
    p50_ms: +percentile(times, 0.5).toFixed(1),
    p95_ms: +percentile(times, 0.95).toFixed(1),
    megabytes_per_second: +(times.length * bytes / 1e6 / wall).toFixed(1),
  });
}
const base = results[0].p50_ms;
const verdict = results.map((r) => ({ ...r, relay_clear: r.p50_ms <= 1.25 * base }));
const pool = await psqlJson<Array<{ n: number }>>(
  `select count(*)::int n from pg_stat_activity where datname = current_database()`,
);
const report = { request_megabytes: +(bytes / 1e6).toFixed(2), levels: verdict, db_sessions_seen: pool[0]?.n };
console.log(JSON.stringify(report, null, 1));
if (out) await Deno.writeTextFile(out, JSON.stringify(report, null, 1));
rest.close();
Deno.exit(0);
