/**
 * Dry run of the migration rehearsal (scripts/eval-replica/rehearse.mjs) on a tiny source database,
 * with a trivial migration, plus its refusals.
 *
 *   node scripts/eval-replica/rehearse-selftest.mjs
 *
 * Creates niyantran_rehearsal_src_small (the replica's schema.sql and a few rows), runs rehearse.mjs on
 * it with a migration that prints two phase markers, adds a column, and holds ACCESS EXCLUSIVE on
 * document_chunks for about two seconds, then checks the result JSON: both phases timed, the reader
 * wait close to the lock, row counts equal, the rehearsal database dropped. It then checks that a failing
 * migration is reported and rolled back, and that the refusals hold (the replica as a target, an existing
 * target without --fresh, a source with another session connected). It drops what it created, never
 * touches niyantran_retrieval_replica, NTER or the network. Needs Docker; run outside the Claude Code
 * sandbox. Exit 0 when every check holds.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPLICA_DATABASE } from '../../src/lib/rehearsal.js';
import { CONTAINER, makeRehearsalAdmin } from './rehearsal-db.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SOURCE = 'niyantran_rehearsal_src_small';
const TARGET = 'niyantran_rehearsal_selftest';
const LOCK_SECONDS = 2;

const sourceAdmin = makeRehearsalAdmin({ source: REPLICA_DATABASE, target: SOURCE });
const targetAdmin = makeRehearsalAdmin({ source: SOURCE, target: TARGET });
const work = mkdtempSync(resolve(tmpdir(), 'rehearse-selftest-'));
const results = resolve(work, 'results');
mkdirSync(results);

const MIGRATION = `
do $$ begin raise notice 'phase: copy start'; end $$;
alter table public.document_chunks add column desk_feature text;
update public.document_chunks c set desk_feature = d.desk_feature from public.documents d where d.id = c.document_id;
select pg_sleep(0.6);
do $$ begin raise notice 'phase: copy end'; end $$;
do $$ begin raise notice 'phase: swap start'; end $$;
lock table public.document_chunks in access exclusive mode;
select pg_sleep(${LOCK_SECONDS});
do $$ begin raise notice 'phase: swap end'; end $$;
do $$ begin raise notice 'phase: finished'; end $$;
`;
const FAILING = "do $$ begin raise notice 'phase: doomed start'; end $$;\nalter table public.document_chunks add column nope int;\nselect 1/0;\n";
writeFileSync(resolve(work, 'good.sql'), MIGRATION);
writeFileSync(resolve(work, 'bad.sql'), FAILING);

function rehearse(args) {
  const res = spawnSync('node', [resolve(HERE, 'rehearse.mjs'), '--out', results, '--sample-ms', '500', '--probe-ms', '100', ...args], { encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout}\n${res.stderr}` };
}
const latestJson = () => {
  const files = readdirSync(results).filter((f) => f.endsWith('.json')).sort();
  return JSON.parse(readFileSync(resolve(results, files.at(-1)), 'utf8'));
};
const check = (name, fn) => {
  fn();
  console.log(`ok - ${name}`);
};

function buildSource() {
  sourceAdmin.createEmpty();
  sourceAdmin.script(readFileSync(resolve(HERE, 'schema.sql'), 'utf8'));
  sourceAdmin.script(`
    insert into public.documents (id, title, desk_tier, desk_feature) values
      ('00000000-0000-4000-8000-000000000001', 'doc one', 'tier', 'NCLT'),
      ('00000000-0000-4000-8000-000000000002', 'doc two', 'tier', 'Bills'),
      ('00000000-0000-4000-8000-000000000003', 'doc three', 'tier', 'Bills');
    insert into public.document_chunks (id, document_id, chunk_hash, chunk_index, source_kind, char_from, char_to, content, chunker_version)
      select gen_random_uuid(), ('00000000-0000-4000-8000-00000000000' || (1 + g % 3))::uuid, 'h' || g, g, 'text', 0, 10, 'synthetic chunk ' || g, 1
      from generate_series(1, 60) g;
    analyze public.documents; analyze public.document_chunks;`);
}

try {
  sourceAdmin.dropTarget();
  targetAdmin.dropTarget();
  buildSource();

  // 1. A good run.
  const good = rehearse(['--migration', resolve(work, 'good.sql'), '--source', SOURCE, '--name', TARGET]);
  assert.equal(good.status, 0, good.out);
  const r = latestJson();
  if (process.env.REHEARSE_SELFTEST_VERBOSE) console.log(JSON.stringify(r, null, 1));
  check('migration applied in one transaction and timed', () => {
    assert.equal(r.migrationRun.ok, true);
    assert.ok(r.migrationRun.ms >= (LOCK_SECONDS + 0.6) * 1000 - 100, `migration took ${r.migrationRun.ms} ms`);
  });
  check('both phases timed from the notices', () => {
    const byName = Object.fromEntries(r.phases.phases.map((p) => [p.name, p]));
    assert.ok(byName.copy.durationMs >= 550, JSON.stringify(byName.copy));
    assert.ok(byName.swap.durationMs >= LOCK_SECONDS * 1000 - 100 && byName.swap.durationMs < LOCK_SECONDS * 1000 + 1500, JSON.stringify(byName.swap));
    assert.deepEqual(r.phases.marks.map((m) => m.name), ['finished']);
    assert.deepEqual(r.phases.warnings, []);
  });
  check('the longest reader wait is about the lock time', () => {
    assert.ok(r.readerProbe.maxMs >= LOCK_SECONDS * 1000 - 400 && r.readerProbe.maxMs < LOCK_SECONDS * 1000 + 1500, JSON.stringify(r.readerProbe));
    assert.equal(r.readerProbe.errors, 0);
    assert.ok(r.readerProbe.count >= 4, JSON.stringify(r.readerProbe));
    assert.ok(r.readerProbe.p50Ms < 500, 'the median probe is fast, so the long wait is the lock');
  });
  check('sizes, peak, counts, analyze', () => {
    assert.ok(r.sizes.peak.samples >= 3);
    assert.ok(r.sizes.peak.peakDatabaseBytes >= r.sizes.before.databaseBytes);
    assert.ok(r.sizes.before.relations.some((x) => x.name === 'document_chunks' && x.kind === 'r'));
    assert.deepEqual(r.rowCounts.before, { documents: 3, document_chunks: 60 });
    assert.equal(r.rowCounts.equal, true);
    assert.ok(r.analyze.ms >= 0);
  });
  check('the rehearsal database is dropped, the source kept', () => {
    assert.equal(targetAdmin.targetExists(), false);
    assert.equal(targetAdmin.sourceExists(), true);
  });
  check('the report holds no chunk content', () => {
    const files = readdirSync(results).filter((f) => f.endsWith('.json') || f.endsWith('.md'));
    for (const f of files) assert.ok(!readFileSync(resolve(results, f), 'utf8').includes('synthetic chunk'), f);
  });

  // 2. A failing migration is reported, rolled back, and the target still dropped.
  const bad = rehearse(['--migration', resolve(work, 'bad.sql'), '--source', SOURCE, '--name', TARGET]);
  check('a failing migration exits 1 with its ERROR line and no analyze', () => {
    assert.equal(bad.status, 1, bad.out);
    const f = latestJson();
    assert.equal(f.migrationRun.ok, false);
    assert.match(f.migrationRun.error.join('\n'), /division by zero/);
    assert.equal(f.analyze, undefined);
    assert.equal(f.rowCounts.equal, true, 'the failed transaction rolled back');
    assert.equal(targetAdmin.targetExists(), false);
  });

  // 3. --keep leaves the database; an existing target needs --fresh.
  const kept = rehearse(['--migration', resolve(work, 'good.sql'), '--source', SOURCE, '--name', TARGET, '--keep']);
  assert.equal(kept.status, 0, kept.out);
  check('--keep leaves the rehearsal database', () => assert.equal(targetAdmin.targetExists(), true));
  check('an existing target is refused without --fresh', () => {
    const again = rehearse(['--migration', resolve(work, 'good.sql'), '--source', SOURCE, '--name', TARGET]);
    assert.equal(again.status, 1);
    assert.match(again.out, /already exists/);
    assert.equal(targetAdmin.targetExists(), true);
  });
  check('--fresh replaces it', () => {
    const fresh = rehearse(['--migration', resolve(work, 'good.sql'), '--source', SOURCE, '--name', TARGET, '--fresh']);
    assert.equal(fresh.status, 0, fresh.out);
    assert.equal(targetAdmin.targetExists(), false);
  });

  // 4. Refusals.
  check('the replica cannot be a target', () => {
    const refused = rehearse(['--migration', resolve(work, 'good.sql'), '--source', SOURCE, '--name', REPLICA_DATABASE]);
    assert.equal(refused.status, 1);
    assert.match(refused.out, /refusing database/);
  });
  const holder = spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', SOURCE, '-q', '-At', '-c', 'select pg_sleep(30)'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 50 && sourceAdmin.sourceConnections().count === 0; i++) spawnSync('sleep', ['0.1']);
    const busy = rehearse(['--migration', resolve(work, 'good.sql'), '--source', SOURCE, '--name', TARGET]);
    check('a source with another session connected is refused', () => {
      assert.equal(busy.status, 1);
      assert.match(busy.out, /connected to niyantran_rehearsal_src_small/);
      assert.equal(targetAdmin.targetExists(), false);
    });
  } finally {
    holder.kill();
  }
  console.log('rehearse self-test passed');
} finally {
  try {
    targetAdmin.dropTarget();
    sourceAdmin.dropTarget();
  } catch (e) {
    console.error(`cleanup failed: ${e.message}; drop ${TARGET} and ${SOURCE} by hand`);
  }
}
