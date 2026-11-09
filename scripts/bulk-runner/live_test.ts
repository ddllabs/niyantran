import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import { PsqlLiveReader, psqlLiveReader } from './live.ts';
import type { PsqlExec, PsqlRun } from './psql_db.ts';

/** A stand-in for psql: records each script and answers from `reply` (default: read-only on, empty list). */
function fakePsql(reply: (sql: string) => Partial<PsqlRun> = () => ({})) {
  const scripts: string[] = [];
  const exec: PsqlExec = (sql) => {
    scripts.push(sql);
    return Promise.resolve({ code: 0, stdout: 'on\n[]\n', stderr: '', timedOut: false, ...reply(sql) });
  };
  return { exec, scripts };
}

/** The JSON array literals a script carries, in order (each is a dollar-quoted text cast to jsonb). */
function literals(sql: string): unknown[] {
  const out: unknown[] = [];
  for (const m of sql.matchAll(/(\$[A-Za-z_][A-Za-z0-9_]*\$)([\s\S]*?)\1::jsonb/g)) out.push(JSON.parse(m[2]));
  return out;
}

const keys = (n: number, p = 'k') => Array.from({ length: n }, (_, i) => `${p}${i}`);

Deno.test('documents: every statement runs in a read-only transaction that is rolled back', async () => {
  const f = fakePsql();
  await new PsqlLiveReader(f.exec).documents({ sourceKeys: ['a'], fileUrls: ['https://x/y.pdf'] });
  assertEquals(f.scripts.length, 1);
  const lines = f.scripts[0].split('\n').map((l) => l.trim());
  assertEquals(lines[0], '\\set ON_ERROR_STOP on');
  assertEquals(lines[1], 'begin transaction read only;');
  assertEquals(lines.filter((l) => l === 'rollback;').length, 1);
  assertEquals(lines.filter((l) => l.startsWith('begin')).length, 1);
  assert(!/\bcommit\b/i.test(f.scripts[0]));
  assertStringIncludes(f.scripts[0], "set local statement_timeout = '60000ms';");
  assert(f.scripts[0].indexOf('rollback;') > f.scripts[0].indexOf('public.documents'));
});

Deno.test('documents: reads the named columns from public.documents and returns the rows', async () => {
  const row = {
    id: 'i1',
    source_key: 'a',
    file_url: 'u',
    file_name: 'n',
    desk_feature: 'f',
    document_key: 'bill:2020:1',
  };
  const f = fakePsql(() => ({ stdout: `on\n${JSON.stringify([row])}\n` }));
  const got = await new PsqlLiveReader(f.exec).documents({ sourceKeys: ['a'], fileUrls: [] });
  assertEquals(got, [row]);
  const sql = f.scripts[0];
  for (const c of ['id', 'source_key', 'file_url', 'file_name', 'desk_feature', "metadata->>'document_key'"]) {
    assertStringIncludes(sql, c);
  }
  assertStringIncludes(sql, 'public.documents');
});

Deno.test('deskRows: reads the named columns from public.desk_rows', async () => {
  const row = { tier: 't', feature: 'f', row_key: 'r', document_key: 'bill:2020:1', row: { a: 1 } };
  const f = fakePsql(() => ({ stdout: `on\n${JSON.stringify([row])}\n` }));
  const got = await new PsqlLiveReader(f.exec).deskRows({ tier: 't', feature: 'f', documentKeys: ['bill:2020:1'] });
  assertEquals(got, [row]);
  const sql = f.scripts[0];
  for (const c of ['tier', 'feature', 'row_key', 'document_key', 'row']) assertStringIncludes(sql, c);
  assertStringIncludes(sql, 'public.desk_rows');
  assertStringIncludes(sql, 'begin transaction read only;');
});

Deno.test('documents: no keys and no urls asks nothing', async () => {
  const f = fakePsql();
  assertEquals(await new PsqlLiveReader(f.exec).documents({ sourceKeys: [], fileUrls: [] }), []);
  assertEquals(await new PsqlLiveReader(f.exec).deskRows({ tier: 't', feature: 'f', documentKeys: [] }), []);
  assertEquals(f.scripts.length, 0);
});

Deno.test('documents: keys go in batches of at most 500, and every key is asked exactly once', async () => {
  const f = fakePsql();
  await new PsqlLiveReader(f.exec).documents({ sourceKeys: keys(1203), fileUrls: keys(7, 'u') });
  assertEquals(f.scripts.length, 3);
  const asked: string[] = [];
  for (const s of f.scripts) {
    for (const l of literals(s)) {
      assert((l as string[]).length <= 500, `${(l as string[]).length} keys in one statement`);
      asked.push(...(l as string[]));
    }
  }
  assertEquals(asked.filter((k) => k.startsWith('k')).sort(), keys(1203).sort());
  assertEquals(asked.filter((k) => k.startsWith('u')).sort(), keys(7, 'u').sort());
});

Deno.test('deskRows: document keys go in batches of at most 500', async () => {
  const f = fakePsql();
  await new PsqlLiveReader(f.exec).deskRows({ tier: 't', feature: 'f', documentKeys: keys(1001) });
  assertEquals(f.scripts.length, 3);
  for (const s of f.scripts) for (const l of literals(s)) assert((l as string[]).length <= 500);
});

Deno.test('documents: rows from several batches are joined, a document seen twice once', async () => {
  const doc = (id: string) => ({
    id,
    source_key: id,
    file_url: null,
    file_name: null,
    desk_feature: null,
    document_key: null,
  });
  let n = 0;
  const f = fakePsql(() => ({
    stdout: `on\n${JSON.stringify(n++ === 0 ? [doc('a'), doc('b')] : [doc('b'), doc('c')])}\n`,
  }));
  const got = await new PsqlLiveReader(f.exec).documents({ sourceKeys: keys(501), fileUrls: [] });
  assertEquals(got.map((d) => d.id), ['a', 'b', 'c']);
});

Deno.test('keys are sent as data: a key that holds quotes, dollar tags and SQL stays inside its literal', async () => {
  const hostile = [`a'b`, `x$$; drop table public.documents; --`, '$q$ ; select 1; $q$', 'back\\slash', 'é\n"'];
  const f = fakePsql();
  await new PsqlLiveReader(f.exec).documents({ sourceKeys: hostile, fileUrls: [] });
  assertEquals(literals(f.scripts[0])[0], hostile);
  // Outside the literals nothing of the keys remains.
  const outside = f.scripts[0].replace(/(\$[A-Za-z_][A-Za-z0-9_]*\$)([\s\S]*?)\1/g, '');
  assert(!outside.includes('drop table'), outside);
});

Deno.test('a key with a NUL character or of the wrong type is refused before psql runs', async () => {
  const f = fakePsql();
  const r = new PsqlLiveReader(f.exec);
  await assertRejects(() => r.documents({ sourceKeys: ['a\0b'], fileUrls: [] }), Error, 'key');
  await assertRejects(() => r.documents({ sourceKeys: [''], fileUrls: [] }), Error, 'key');
  await assertRejects(() => r.documents({ sourceKeys: [5 as unknown as string], fileUrls: [] }), Error, 'key');
  await assertRejects(() => r.deskRows({ tier: 't', feature: 'f', documentKeys: ['a\0'] }), Error, 'key');
  assertEquals(f.scripts.length, 0);
});

Deno.test('a session that does not report a read-only transaction is refused', async () => {
  const f = fakePsql(() => ({ stdout: 'off\n[]\n' }));
  await assertRejects(
    () => new PsqlLiveReader(f.exec).documents({ sourceKeys: ['a'], fileUrls: [] }),
    Error,
    'read-only',
  );
  const g = fakePsql(() => ({ stdout: '[]\n' }));
  await assertRejects(
    () => new PsqlLiveReader(g.exec).documents({ sourceKeys: ['a'], fileUrls: [] }),
    Error,
    'read-only',
  );
});

Deno.test('the script itself asks the session whether the transaction is read-only', async () => {
  const f = fakePsql();
  await new PsqlLiveReader(f.exec).documents({ sourceKeys: ['a'], fileUrls: [] });
  assertStringIncludes(f.scripts[0], "current_setting('transaction_read_only')");
});

Deno.test('psql failure, timeout and an unreadable answer are errors, not empty results', async () => {
  const r = (reply: Partial<PsqlRun>) => new PsqlLiveReader(fakePsql(() => reply).exec);
  const q = { sourceKeys: ['a'], fileUrls: [] };
  await assertRejects(() => r({ code: 3, stderr: 'boom' }).documents(q), Error, 'psql exited 3');
  await assertRejects(() => r({ timedOut: true }).documents(q), Error, 'no answer');
  await assertRejects(() => r({ stdout: 'on\n' }).documents(q), Error, 'empty');
  await assertRejects(() => r({ stdout: 'on\nnot json\n' }).documents(q), Error, 'not JSON');
  await assertRejects(() => r({ stdout: 'on\n{"a":1}\n' }).documents(q), Error, 'array');
});

Deno.test('a bad statement timeout is refused', () => {
  const f = fakePsql();
  for (const bad of [0, -1, 1.5, NaN]) assert(!tryNew(() => new PsqlLiveReader(f.exec, bad)));
});
const tryNew = (f: () => unknown) => {
  try {
    f();
    return true;
  } catch {
    return false;
  }
};

Deno.test('psqlLiveReader: the service is named, defaults to nter-accept, and no PG variable but the files survives', () => {
  const seen: Array<{ command: string[]; preamble: string; env?: Record<string, string> }> = [];
  const make = (command?: string[], preamble?: string, env?: Record<string, string>): PsqlExec => {
    seen.push({ command: command ?? [], preamble: preamble ?? '', env });
    return () => Promise.resolve({ code: 0, stdout: 'on\n[]\n', stderr: '', timedOut: false });
  };
  const base = {
    PATH: '/bin',
    PGHOST: 'h',
    PGUSER: 'corpus_ingest',
    PGPASSWORD: 'p',
    PGSERVICEFILE: '/f/svc',
    PGPASSFILE: '/f/pass',
    PGSERVICE: 'other',
  };
  psqlLiveReader(undefined, 'psql', make, base);
  psqlLiveReader('mine', '/opt/psql', make, base);
  assertEquals(seen[0].env, { PATH: '/bin', PGSERVICEFILE: '/f/svc', PGPASSFILE: '/f/pass', PGSERVICE: 'nter-accept' });
  assertEquals(seen[1].env?.PGSERVICE, 'mine');
  assertEquals(seen[1].command, ['/opt/psql']);
  assertEquals(seen[0].preamble, '');
});

Deno.test('psqlLiveReader refuses a service name that is not a plain name', () => {
  for (const bad of ['', 'a b', 'a;b', '../x', 'x'.repeat(65)]) {
    assert(!tryNew(() => psqlLiveReader(bad, 'psql', () => () => Promise.reject(new Error('no')), {})), bad);
  }
});
