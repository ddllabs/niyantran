/**
 * Rehearse a schema migration on a copy of the local retrieval replica (docs/plans/2026-11-01-chunk-partitions.md,
 * task B2), recording what it would cost on a database of that size.
 *
 *   node scripts/eval-replica/rehearse.mjs --migration supabase/migrations/<file>.sql \
 *     [--name niyantran_rehearsal_<suffix>] [--source niyantran_retrieval_replica] [--keep] [--fresh] \
 *     [--out eval/retrieval/results] [--sample-ms 3000] [--probe-ms 250]
 *
 * Steps, in the niyantran-corpus-test-db container (Docker; run outside the Claude Code sandbox):
 *  1. Refuses when the target database exists (unless --fresh, which drops it first), when any other
 *     session is connected to the source (`create database ... template` needs the source idle:
 *     stop the eval or any psql on it), or when the container's disk has less than twice the source
 *     size free.
 *  2. Copies the source into the target with `create database <target> template <source> strategy
 *     file_copy`, timed.
 *  3. Records the database and relation sizes (heap plus indexes of documents, document_chunks and
 *     anything named like them, indexes listed one by one) and the row counts of documents and
 *     document_chunks.
 *  4. Applies the migration with `psql -v ON_ERROR_STOP=1 --single-transaction`, as Supabase does,
 *     timing it. While it runs:
 *       - a persistent session samples pg_database_size, the WAL directory and the container's free
 *         disk every --sample-ms (default 3 s), for the peak;
 *       - a second persistent session runs `select id from public.document_chunks limit 1` every
 *         --probe-ms (default 250 ms) and records each wait, so the longest wait is how long the swap
 *         blocked readers (an ACCESS EXCLUSIVE lock makes the select wait until the migration commits).
 *     Per-phase timings come from RAISE NOTICE markers in the migration, stamped as psql prints them:
 *         raise notice 'phase: copy start';     raise notice 'phase: copy end';   -- a timed phase
 *         raise notice 'phase: swap';                                              -- a point in time
 *     (`done` also ends a phase; a leading `psql:<file>:<line>:` is ignored.) A migration without
 *     markers still gets its total time, size peak and reader waits.
 *  5. If the migration succeeded, runs `analyze` on documents and document_chunks (the repository's rule
 *     after a bulk load), timed, then re-measures sizes and row counts. Row counts that differ are
 *     reported and make the exit code 1.
 *  6. Writes <out>/<utc stamp>-rehearsal-<target>.json and a short .md beside it (the path is printed):
 *     names, sizes, timings, counts and ERROR lines only, never chunk content. Then drops the target
 *     database unless --keep. With --keep, run the eval against it:
 *       npx vite-node --config vitest.config.js scripts/eval-retrieval.mjs -- --set <set> \
 *         --target replica --database <target> --compare <baseline.json>
 *
 * Safety: only a database named niyantran_rehearsal_<lower-case letters, digits, underscores> is ever
 * created or dropped, enforced in code (rehearsal-db.mjs binds the names and src/lib/rehearsal.js checks
 * them). The source, normally niyantran_retrieval_replica, is only a template: it is never connected to
 * or written, and anything but the replica or a rehearsal database is refused as a source. The target
 * is not dropped when the process is killed outright; if that happens, drop it by hand:
 *   docker exec niyantran-corpus-test-db psql -U postgres -c 'drop database niyantran_rehearsal_<suffix>'
 * Ctrl-C after the copy ends the sessions on the target (the migration rolls back) and drops it as usual.
 *
 * Exit codes: 0 = the migration applied and the row counts match; 1 = a refusal, an error, a failed
 * migration or a row-count difference (the result files are written whenever the copy succeeded).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import {
  checkDiskSpace, formatBytes, parsePhaseNotice, parseRehearseArgs, renderRehearsalReport, sanitiseErrors,
  summarisePeak, summarisePhases, summariseProbe,
} from '../../src/lib/rehearsal.js';
import { CONTAINER, freeBytes, makeRehearsalAdmin } from './rehearsal-db.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const log = (line) => console.log(line);

function scriptArgs() {
  const argv = process.argv.slice(2);
  const dash = argv.indexOf('--');
  return dash === -1 ? argv : argv.slice(dash + 1);
}

/** Sleep that ends early when the signal aborts. */
function sleep(ms, signal) {
  return new Promise((done) => {
    if (signal.aborted) return done();
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      done();
    }, { once: true });
    return undefined;
  });
}

const RELATIONS_SQL = `
  select c.relname as name, c.relkind as kind, pg_total_relation_size(c.oid)::bigint as "totalBytes",
         pg_relation_size(c.oid)::bigint as "tableBytes", pg_indexes_size(c.oid)::bigint as "indexBytes"
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname ~ '^(documents|document_chunks)'
  union all
  select i.relname, i.relkind, pg_total_relation_size(i.oid)::bigint, pg_relation_size(i.oid)::bigint, 0::bigint
  from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class t on t.oid = x.indrelid join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname ~ '^(documents|document_chunks)'
  order by 1`;

/** Database size, relation sizes and row counts of the target, taken while nothing else is running. */
function measure(admin) {
  const databaseBytes = Number(admin.sql('select pg_database_size(current_database())'));
  const relations = admin.json(RELATIONS_SQL).map((r) => ({ ...r, totalBytes: Number(r.totalBytes), tableBytes: Number(r.tableBytes), indexBytes: Number(r.indexBytes) }));
  const counts = admin.json('select (select count(*) from public.documents) as documents, (select count(*) from public.document_chunks) as document_chunks')[0];
  return { sizes: { databaseBytes, relations }, counts: { documents: Number(counts.documents), document_chunks: Number(counts.document_chunks) } };
}

/** Run the migration while sampling size and probing readers. Resolves with everything observed. */
async function runMigration({ admin, sql, sampleMs, probeMs, dataDirectory }) {
  const stop = new AbortController();
  const probeSession = admin.openSession();
  const sampleSession = admin.openSession();
  const probes = [];
  const samples = [];
  const markers = [];
  let stderr = '';
  let stderrTail = '';
  // Connect both sessions first, so the first probe does not time docker's and psql's start-up.
  await Promise.all([probeSession.query('select 1;'), sampleSession.query('select 1;')]);
  const t0 = performance.now();
  const since = () => performance.now() - t0;

  const takeSample = async () => {
    const atMs = since();
    const [size, free] = await Promise.all([
      sampleSession.query('select pg_database_size(current_database()), coalesce((select sum(size) from pg_ls_waldir()), 0);'),
      freeBytes(dataDirectory).catch(() => null),
    ]);
    const [databaseBytes, walBytes] = (size.lines[0] ?? '').split('|').map(Number);
    if (Number.isFinite(databaseBytes)) samples.push({ atMs, databaseBytes, walBytes: Number.isFinite(walBytes) ? walBytes : null, freeBytes: free });
  };
  const sampler = (async () => {
    while (!stop.signal.aborted) {
      await takeSample().catch(() => {});
      await sleep(sampleMs, stop.signal);
    }
  })();
  const prober = (async () => {
    while (!stop.signal.aborted) {
      const atMs = since();
      try {
        const r = await probeSession.query('select id from public.document_chunks limit 1;');
        probes.push({ atMs, waitMs: r.ms, error: r.error });
      } catch {
        probes.push({ atMs, waitMs: since() - atMs, error: true });
        return;
      }
      await sleep(probeMs - (since() - atMs), stop.signal);
    }
  })();

  // One sample is taken before the migration's first statement is sent; the probe has been running since t0.
  await takeSample().catch(() => {});

  const child = admin.spawnMigration();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    const now = since();
    stderr += chunk;
    stderrTail += chunk;
    let at;
    while ((at = stderrTail.indexOf('\n')) !== -1) {
      const marker = parsePhaseNotice(stderrTail.slice(0, at), now);
      if (marker) markers.push(marker);
      stderrTail = stderrTail.slice(at + 1);
    }
  });
  child.stdin.on('error', () => {}); // psql may exit before reading everything (a failed migration)
  child.stdin.end(sql);
  const exitCode = await new Promise((done) => {
    child.on('error', (e) => {
      stderr += `ERROR:  could not run docker: ${e.message}\n`;
      done(-1);
    });
    child.on('close', done);
  });
  const ms = since();
  const marker = parsePhaseNotice(stderrTail, ms);
  if (marker) markers.push(marker);

  await takeSample().catch(() => {});
  stop.abort();
  await Promise.all([sampler, prober]);
  await Promise.all([probeSession.close(), sampleSession.close()]);
  return { ok: exitCode === 0, exitCode, ms, markers, probes, samples, errors: exitCode === 0 ? [] : sanitiseErrors(stderr) };
}

async function main() {
  const args = parseRehearseArgs(scriptArgs());
  const migrationPath = resolve(process.cwd(), args.migration);
  if (!existsSync(migrationPath)) throw new Error(`migration file not found: ${migrationPath}`);
  const sql = readFileSync(migrationPath, 'utf8');
  if (!sql.trim()) throw new Error(`migration file is empty: ${migrationPath}`);
  const migration = { file: basename(migrationPath), bytes: Buffer.byteLength(sql), sha256: createHash('sha256').update(sql).digest('hex') };

  const admin = makeRehearsalAdmin({ source: args.source, target: args.name });
  if (!admin.sourceExists()) throw new Error(`source database ${args.source} does not exist`);
  if (admin.targetExists()) {
    if (!args.fresh) throw new Error(`${args.name} already exists. Pass --fresh to drop and rebuild it, or choose another --name.`);
    log(`dropping the existing ${args.name} (--fresh)`);
    admin.dropTarget();
  }
  const { count, applications } = admin.sourceConnections();
  if (count > 0) {
    throw new Error(`${count} session(s) are connected to ${args.source} (${applications}). A template database must have no other connections: stop the eval or any psql on it, then run again.`);
  }
  const sourceBytes = admin.sourceBytes();
  const dataDirectory = admin.dataDirectory();
  const free = await freeBytes(dataDirectory);
  const disk = checkDiskSpace({ sourceBytes, freeBytes: free });
  if (!disk.ok) throw new Error(disk.message);
  log(`${args.source}: ${formatBytes(sourceBytes)}; ${disk.message}`);

  const result = {
    kind: 'rehearsal',
    ranAt: new Date().toISOString(),
    migration,
    source: { database: args.source, sizeBytes: sourceBytes },
    target: { database: args.name, kept: args.keep },
    disk: { freeBytes: free, requiredBytes: disk.requiredBytes },
  };
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    log('interrupted: ending the migration (it rolls back) and dropping the rehearsal database');
    admin.terminateTarget();
  };
  process.on('SIGINT', onSigint);

  log(`copying ${args.source} into ${args.name} ...`);
  const copyStarted = performance.now();
  admin.createFromTemplate();
  result.copy = { ms: performance.now() - copyStarted };
  log(`copy took ${Math.round(result.copy.ms / 1000)} s`);

  let failed = false;
  try {
    const before = measure(admin);
    log(`migration: ${migration.file} (${migration.bytes} bytes), one transaction ...`);
    const run = await runMigration({ admin, sql, sampleMs: args.sampleMs, probeMs: args.probeMs, dataDirectory });
    result.migrationRun = { ok: run.ok, exitCode: run.exitCode, ms: run.ms, error: run.errors };
    result.phases = summarisePhases(run.markers, run.ms);
    result.readerProbe = summariseProbe(run.probes);
    if (run.ok) {
      log('analyze documents, document_chunks ...');
      const started = performance.now();
      admin.sql('analyze public.documents; analyze public.document_chunks');
      result.analyze = { ms: performance.now() - started };
    }
    const after = measure(admin);
    result.sizes = { before: before.sizes, after: after.sizes, peak: summarisePeak(run.samples) };
    result.rowCounts = {
      before: before.counts,
      after: after.counts,
      equal: before.counts.documents === after.counts.documents && before.counts.document_chunks === after.counts.document_chunks,
    };
    failed = !run.ok || !result.rowCounts.equal || interrupted;

    const outDir = resolve(ROOT, args.out);
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = resolve(outDir, `${stamp}-rehearsal-${args.name.replace(/^niyantran_rehearsal_/, '')}.json`);
    writeFileSync(jsonPath, JSON.stringify(result, null, 1));
    writeFileSync(jsonPath.replace(/\.json$/, '.md'), renderRehearsalReport(result));
    log(`wrote ${jsonPath} and its .md`);
    if (!run.ok) log(`MIGRATION FAILED (exit ${run.exitCode}): ${run.errors.join(' | ') || 'no ERROR line on stderr'}`);
    if (!result.rowCounts.equal) log('ROW COUNTS DIFFER between before and after');
  } finally {
    process.off('SIGINT', onSigint);
    if (args.keep) log(`kept ${args.name}; drop it with: docker exec ${CONTAINER} psql -U postgres -c 'drop database ${args.name}'`);
    else {
      admin.dropTarget();
      log(`dropped ${args.name}`);
    }
  }
  return failed ? 1 : 0;
}

main().then((code) => {
  process.exitCode = code;
}).catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
