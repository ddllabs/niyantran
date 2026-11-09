import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import { dollarQuote, PsqlDb, type PsqlExec, type PsqlRun } from './psql_db.ts';

const BATCH = '0b6c2a52-6d7e-4b0e-9a55-3f2f8f0c1d11';

/** A stand-in for psql: records each script and answers from `reply`. */
function stub(reply: (sql: string) => Partial<PsqlRun>) {
  const scripts: string[] = [];
  const exec: PsqlExec = (sql) => {
    scripts.push(sql);
    return Promise.resolve({ code: 0, stdout: '', stderr: '', timedOut: false, ...reply(sql) });
  };
  return { exec, scripts };
}

const asIngest = (more: (sql: string) => Partial<PsqlRun> = () => ({ stdout: '{}' })) =>
  stub((sql) => (sql.includes('current_user') ? { stdout: 'corpus_ingest\n' } : more(sql)));

const SESSION = { lock_timeout_ms: 5_000, statement_timeout_ms: 60_000 };

Deno.test('dollarQuote: the tag never occurs in the text, even when the text holds tags of the same shape', () => {
  const text = 'a $q$ b $q0$ c $$ d';
  for (let i = 0; i < 200; i++) {
    const q = dollarQuote(text);
    const tag = q.slice(0, q.indexOf('$', 1) + 1);
    assert(q.startsWith(tag) && q.endsWith(tag));
    assertEquals(q.slice(tag.length, -tag.length), text);
    assert(!text.includes(tag), `tag ${tag} occurs in the text`);
  }
});

Deno.test('dollarQuote: a text that contains the first tag chosen gets another one', () => {
  const tags = ['$qaaaa$', '$qbbbb$'];
  const text = 'x $qaaaa$ y';
  const q = dollarQuote(text, () => tags.shift()!);
  assert(q.startsWith('$qbbbb$'));
});

Deno.test('session refuses any login but corpus_ingest', async () => {
  const s = stub(() => ({ stdout: 'postgres\n' }));
  const db = new PsqlDb(s.exec);
  await assertRejects(() => db.session(SESSION), Error, 'corpus_ingest');
});

Deno.test('no call runs before session has checked the login', async () => {
  const s = asIngest();
  const db = new PsqlDb(s.exec);
  await assertRejects(() => db.status(BATCH), Error, 'session');
  assertEquals(s.scripts.length, 0);
});

Deno.test('every call sets both timeouts and stops on the first error', async () => {
  const s = asIngest(() => ({ stdout: '{"batch_id":"x"}' }));
  const db = new PsqlDb(s.exec);
  await db.session(SESSION);
  await db.status(BATCH);
  await db.seal(BATCH);
  for (const sql of s.scripts.slice(1)) {
    assertStringIncludes(sql, '\\set ON_ERROR_STOP on');
    assertStringIncludes(sql, "set lock_timeout = '5000ms'");
    assertStringIncludes(sql, "set statement_timeout = '60000ms'");
  }
});

Deno.test('a payload is sent as one literal, whatever quotes and backslashes it holds', async () => {
  const s = asIngest(() => ({ stdout: '{"results":[],"batch":{"state":"open"}}' }));
  const db = new PsqlDb(s.exec);
  await db.session(SESSION);
  const payload = `it's "quoted" \\ back\\slash $$ $q$ ; drop table x; --`;
  await db.register(BATCH, [{ payload, payload_sha256: 'h', expected: [], pages: [], sections: [] }], true, false);
  const sql = s.scripts.at(-1)!;
  const json = JSON.stringify([{ payload, payload_sha256: 'h', expected: [], pages: [], sections: [] }]);
  assertStringIncludes(sql, json);
  assertStringIncludes(sql, `public.ingest_register_batch('${BATCH}'::uuid,`);
  assertStringIncludes(sql, 'true, false)');
});

Deno.test('a batch id that is not a uuid is refused before psql runs', async () => {
  const s = asIngest();
  const db = new PsqlDb(s.exec);
  await db.session(SESSION);
  const before = s.scripts.length;
  await assertRejects(() => db.status("x'); drop table documents; --"), Error, 'uuid');
  await assertRejects(() => db.requeue(BATCH, ['not-a-uuid']), Error, 'uuid');
  assertEquals(s.scripts.length, before);
});

Deno.test('a non-zero exit throws with psql’s message', async () => {
  const s = asIngest(() => ({ code: 3, stderr: 'ERROR:  canceling statement due to statement timeout' }));
  const db = new PsqlDb(s.exec);
  await db.session(SESSION);
  await assertRejects(() => db.status(BATCH), Error, 'statement timeout');
});

Deno.test('a client-side timeout throws, as a lost answer', async () => {
  const s = asIngest(() => ({ code: -1, timedOut: true }));
  const db = new PsqlDb(s.exec);
  await db.session(SESSION);
  await assertRejects(() => db.register(BATCH, [], false, false), Error, 'no answer');
});

Deno.test('an empty answer where one is due throws', async () => {
  const s = asIngest(() => ({ stdout: '\n' }));
  const db = new PsqlDb(s.exec);
  await db.session(SESSION);
  await assertRejects(() => db.status(BATCH), Error, 'empty');
});

Deno.test('answers are parsed as JSON; text holders come back as a list', async () => {
  const s = asIngest((sql) =>
    sql.includes('ingest_text_holders')
      ? { stdout: '[{"content_sha256":"c","source_key":"k","document_id":"d"}]\n' }
      : { stdout: '{"batch_id":"b","state":"open","existing":false}\n' }
  );
  const db = new PsqlDb(s.exec);
  await db.session(SESSION);
  assertEquals(await db.textHolders(['c']), [{ content_sha256: 'c', source_key: 'k', document_id: 'd' }]);
  assertEquals(
    await db.open({
      collection: 'c',
      manifest_sha256: 'm',
      items_planned: 1,
      chunks_planned: 1,
      est_tokens: 1,
      est_cost_usd: 0,
      runner_commit: 'r',
    }),
    { batch_id: 'b', state: 'open', existing: false },
  );
});

Deno.test('the client-side limit is longer than the statement timeout', async () => {
  let seen = 0;
  const exec: PsqlExec = (sql, ms) => {
    seen = ms;
    return Promise.resolve({
      code: 0,
      stdout: sql.includes('current_user') ? 'corpus_ingest' : '{}',
      stderr: '',
      timedOut: false,
    });
  };
  const db = new PsqlDb(exec);
  await db.session(SESSION);
  await db.status(BATCH);
  assert(seen > SESSION.statement_timeout_ms, `client limit ${seen} ms`);
});
