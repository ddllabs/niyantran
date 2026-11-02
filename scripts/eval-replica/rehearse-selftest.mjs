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
 * target without --fresh, a source with another session connected). It also covers --prelude (applied before the
 * migration, recorded, refused when unsafe or failing), --setting (visible to the migration, recorded, refused when
 * malformed) and the transaction wrapper (a plain file wrapped, a file with its own begin/commit run as it is and
 * rolled back whole when it fails, --no-wrap). It drops what it created, never
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

const PRELUDE = 'alter table public.document_chunks add column embed_hash text;\n';
const NOTICE = (text) => `do $$ begin raise notice '${text}'; end $$;`;
// Needs the prelude's column, and prints the settings it sees as phase marks.
const READS_PRELUDE = `${NOTICE('phase: prelude column')}
update public.document_chunks set embed_hash = md5(content);
do $$ begin raise notice 'phase: workers %', current_setting('max_parallel_maintenance_workers'); end $$;
do $$ begin raise notice 'phase: probe %', current_setting('rehearsal.probe'); end $$;
`;
const OWN_TXN = `begin;
set local lock_timeout = '30s';
${NOTICE('phase: own txn start')}
alter table public.document_chunks add column z int;
${NOTICE('phase: own txn end')}
commit;
`;
const OWN_TXN_FAILING = 'begin;\nalter table public.document_chunks add column z int;\nselect 1/0;\ncommit;\n';
for (const [file, text] of Object.entries({
  'pre.sql': PRELUDE,
  'reads-prelude.sql': READS_PRELUDE,
  'own-txn.sql': OWN_TXN,
  'own-txn-failing.sql': OWN_TXN_FAILING,
  'half.sql': 'begin;\nselect 1;\n',
  'prelude-connect.sql': '\\connect niyantran_retrieval_replica\nalter table public.document_chunks add column nope int;\n',
  'prelude-dropdb.sql': 'drop database niyantran_retrieval_replica;\n',
  'prelude-failing.sql': 'alter table public.document_chunks add column pre_a int;\nselect 1/0;\n',
  'prelude-selfmanaged.sql': 'begin;\nalter table public.document_chunks add column embed_hash text;\ncommit;\n',
})) writeFileSync(resolve(work, file), text);
const F = (name) => resolve(work, name);

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
    assert.ok(r.readerProbe.count >= 2, // the migration's first ALTER TABLE already holds the lock, so few probes precede it
       JSON.stringify(r.readerProbe));
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
    sourceAdmin.terminateTarget(); // killing the docker client leaves the backend running its pg_sleep
    for (let i = 0; i < 50 && sourceAdmin.sourceConnections().count > 0; i++) spawnSync('sleep', ['0.1']);
  }
  // 5. --prelude, --setting and the transaction wrapper.
  const WITH = ['--source', SOURCE, '--name', TARGET];
  const ran = rehearse(['--migration', F('reads-prelude.sql'), '--prelude', F('pre.sql'), '--setting', 'max_parallel_maintenance_workers=0', '--setting', 'rehearsal.probe=hello', ...WITH]);
  assert.equal(ran.status, 0, ran.out);
  const p = latestJson();
  check('the prelude ran first, in its own transaction, and is recorded with its hash', () => {
    assert.equal(p.migrationRun.ok, true, 'the migration used the column only the prelude adds');
    assert.equal(p.prelude.file, 'pre.sql');
    assert.match(p.prelude.sha256, /^[0-9a-f]{64}$/);
    assert.equal(p.prelude.bytes, PRELUDE.length);
    assert.ok(p.prelude.ms > 0);
  });
  check('the settings reached the migration session and are recorded', () => {
    assert.deepEqual(p.phases.marks.map((m) => m.name), ['prelude column', 'workers 0', 'probe hello']);
    assert.deepEqual(p.migrationRun.settings, [{ name: 'max_parallel_maintenance_workers', value: '0' }, { name: 'rehearsal.probe', value: 'hello' }]);
  });
  check('a plain file is wrapped in a single transaction', () => assert.equal(p.migrationRun.transaction.mode, 'single-transaction'));
  check('without the prelude the same migration fails on the missing column', () => {
    const no = rehearse(['--migration', F('reads-prelude.sql'), '--setting', 'rehearsal.probe=hello', ...WITH]);
    assert.equal(no.status, 1);
    assert.match(latestJson().migrationRun.error.join('\n'), /embed_hash/);
  });
  check('a file with its own begin/commit runs as it is, not nested', () => {
    const own = rehearse(['--migration', F('own-txn.sql'), ...WITH]);
    assert.equal(own.status, 0, own.out);
    const o = latestJson();
    assert.equal(o.migrationRun.transaction.mode, 'self-managed');
    assert.deepEqual(o.phases.phases.map((x) => x.name), ['own txn']);
    assert.ok(!/no transaction in progress|already a transaction/.test(own.out));
  });
  check('a failing self-managed file rolls back whole', () => {
    const failing = rehearse(['--migration', F('own-txn-failing.sql'), ...WITH, '--keep']);
    assert.equal(failing.status, 1);
    assert.equal(latestJson().migrationRun.transaction.mode, 'self-managed');
    assert.equal(targetAdmin.sql("select count(*) from information_schema.columns where table_name = 'document_chunks' and column_name = 'z'"), '0');
    targetAdmin.dropTarget();
  });
  check('--no-wrap runs a plain file as it is', () => {
    const nw = rehearse(['--migration', F('reads-prelude.sql'), '--prelude', F('pre.sql'), '--setting', 'max_parallel_maintenance_workers=0', '--setting', 'rehearsal.probe=x', '--no-wrap', ...WITH]);
    assert.equal(nw.status, 0, nw.out);
    assert.equal(latestJson().migrationRun.transaction.mode, 'unwrapped');
  });
  check('a file with begin; but no commit; is refused before the copy', () => {
    const half = rehearse(['--migration', F('half.sql'), ...WITH]);
    assert.equal(half.status, 1);
    assert.match(half.out, /begin; but no commit;/);
    assert.ok(!/copying/.test(half.out));
  });
  check('a self-managed prelude is run as it is', () => {
    const sm = rehearse(['--migration', F('reads-prelude.sql'), '--prelude', F('prelude-selfmanaged.sql'), '--setting', 'max_parallel_maintenance_workers=0', '--setting', 'rehearsal.probe=x', ...WITH]);
    assert.equal(sm.status, 0, sm.out);
  });
  check('an unsafe prelude is refused before anything is copied', () => {
    for (const [file, pattern] of [['prelude-connect.sql', /meta-command/], ['prelude-dropdb.sql', /database DDL/]]) {
      const bad = rehearse(['--migration', F('good.sql'), '--prelude', F(file), ...WITH]);
      assert.equal(bad.status, 1, bad.out);
      assert.match(bad.out, pattern);
      assert.ok(!/copying/.test(bad.out), 'refused before the copy');
    }
    assert.equal(targetAdmin.targetExists(), false);
  });
  check('a failing prelude stops the run, drops the copy, and the migration never starts', () => {
    const bad = rehearse(['--migration', F('good.sql'), '--prelude', F('prelude-failing.sql'), ...WITH]);
    assert.equal(bad.status, 1);
    assert.match(bad.out, /the prelude failed.*division by zero/);
    assert.ok(!/migration: good\.sql/.test(bad.out));
    assert.equal(targetAdmin.targetExists(), false);
  });
  check('malformed settings are refused, and an unknown setting fails the migration', () => {
    const bad = rehearse(['--migration', F('good.sql'), '--setting', 'novalue', ...WITH]);
    assert.equal(bad.status, 1);
    assert.match(bad.out, /--setting needs name=value/);
    const unknown = rehearse(['--migration', F('good.sql'), '--setting', 'no_such_parameter=1', ...WITH]);
    assert.equal(unknown.status, 1);
    assert.match(latestJson().migrationRun.error.join('\n'), /unrecognized configuration parameter/);
  });
  console.log('rehearse self-test passed');
} finally {
  try {
    targetAdmin.dropTarget();
    sourceAdmin.dropTarget();
  } catch (e) {
    console.error(`cleanup failed: ${e.message}; drop ${TARGET} and ${SOURCE} by hand`);
  }
}
