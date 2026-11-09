import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1';
import { nationalQuestion } from '../../supabase/functions/_shared/suppliedText_fixture.ts';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import type { AcceptDb } from './acceptance.ts';
import {
  acceptFrom,
  automated,
  checkCollection,
  checkReceiptsDir,
  type CliDeps,
  main,
  parseArgs,
  parseRecords,
  REPO_ROOT,
  serviceEnv,
} from './cli.ts';
import { FakeDb } from './fake_db.ts';

// deno-lint-ignore no-explicit-any
type Rec = Record<string, any>;
const QUESTIONS = 'Parliamentary Question Database';
const H = 'a'.repeat(64);

const COLLECTION = {
  collection: 'national-v1.1-test',
  prepare: { maxChunks: 800 },
  limits: {
    usdPerMTokens: 0.02,
    budgetUsd: 100,
    chunkCeiling: 1_000_000,
    diskUsedBytes: 0,
    diskStopBytes: 10 ** 12,
    partitioned: [],
    chunksNow: { [QUESTIONS]: 0 },
  },
};

/** A question record with its own key and text, and every hash that binds the text. */
async function question(n: number): Promise<Rec> {
  const r: Rec = await nationalQuestion();
  const text = `Question ${n}. The Minister replied on the progress of scheme ${n} in the year under review.`;
  const sha = await sha256Hex(text);
  const source_key = (r.source_key as string).slice(0, -6) + n.toString(16).padStart(6, '0');
  return {
    ...r,
    source_key,
    text,
    text_sha256: sha,
    pages: [{ page_number: 1, char_from: 0, char_to: [...text].length, text }],
    review: { ...r.review, source_key, text_sha256: sha },
  };
}

function deps(files: Record<string, string>, over: Partial<CliDeps> = {}) {
  const lines: string[] = [];
  const written = new Map<string, string>();
  const db = new FakeDb();
  let now = 1_000;
  const d: CliDeps = {
    readText: (p) => (p in files ? Promise.resolve(files[p]) : Promise.reject(new Error(`no file ${p}`))),
    writeText: (p, b) => {
      if (written.has(p)) return Promise.reject(new Error(`exists: ${p}`));
      written.set(p, b);
      return Promise.resolve();
    },
    git: () => Promise.resolve({ commit: 'abcdef1', dirty: false }),
    db: () => db,
    acceptDb: () => {
      throw new Error('no acceptance connection in this test');
    },
    log: (l) => lines.push(l),
    now: () => now,
    sleep: (ms) => {
      now += ms;
      db.tick(Infinity);
      return Promise.resolve();
    },
    ...over,
  };
  return { d, lines, written, db };
}

Deno.test('parseArgs: each command takes only its own options, and each required one', () => {
  assertEquals(parseArgs(['plan', '--collection', 'c.json', '--records', 'r.jsonl']), {
    cmd: 'plan',
    collection: 'c.json',
    records: 'r.jsonl',
  });
  assertThrows(() => parseArgs(['plan', '--collection', 'c.json']), Error, '--records is required');
  assertThrows(() => parseArgs(['plan', '--collection', 'c', '--records', 'r', '--receipts', 'x']), Error, 'unknown');
  assertThrows(() => parseArgs(['run', '--collection', 'c', '--records', 'r']), Error, '--receipts is required');
  assertThrows(() => parseArgs(['status']), Error, '--batch is required');
  assertThrows(() => parseArgs(['load']), Error, 'usage');
  assertThrows(() => parseArgs(['plan', '--collection']), Error, 'bad argument');
  assertThrows(() => parseArgs(['plan', '--collection', 'a', '--collection', 'b']), Error, 'twice');
});

Deno.test('parseArgs: --accepted takes manifest hashes only', () => {
  const c = parseArgs([
    'run',
    '--collection',
    'c',
    '--records',
    'r',
    '--receipts',
    '/x',
    '--accepted',
    `${H}, ${'b'.repeat(64)}`,
  ]);
  assertEquals(c.cmd === 'run' && c.accepted, [H, 'b'.repeat(64)]);
  assertThrows(
    () => parseArgs(['run', '--collection', 'c', '--records', 'r', '--receipts', '/x', '--accepted', 'all']),
    Error,
    'not a manifest sha256',
  );
});

Deno.test('acceptance for now: only a listed manifest is accepted', async () => {
  const accept = acceptFrom([H]);
  assertEquals(await accept({ manifest_sha256: H }), true);
  assertEquals(await accept({ manifest_sha256: 'b'.repeat(64) }), false);
  assertEquals(await acceptFrom([])({ manifest_sha256: H }), false);
});

Deno.test('receipts must go outside the repository', () => {
  assertThrows(() => checkReceiptsDir(REPO_ROOT), Error, 'outside the repository');
  assertThrows(() => checkReceiptsDir(`${REPO_ROOT}/eval/ingestion/results`), Error, 'outside the repository');
  assertThrows(() => checkReceiptsDir(`${REPO_ROOT}/scripts/../receipts`), Error, 'outside the repository');
  assertEquals(checkReceiptsDir('/var/receipts', REPO_ROOT), '/var/receipts');
  assertEquals(checkReceiptsDir(`${REPO_ROOT}-receipts`, REPO_ROOT), `${REPO_ROOT}-receipts`);
});

Deno.test('collection file: every limit the plan needs is required, with no default guessed', () => {
  checkCollection(COLLECTION);
  assertThrows(() => checkCollection({ ...COLLECTION, collection: '' }), Error, 'collection is required');
  assertThrows(() => checkCollection({ ...COLLECTION, prepare: {} }), Error, 'maxChunks');
  for (const k of ['usdPerMTokens', 'budgetUsd', 'chunkCeiling', 'diskUsedBytes', 'diskStopBytes']) {
    const limits: Rec = { ...COLLECTION.limits };
    delete limits[k];
    assertThrows(() => checkCollection({ ...COLLECTION, limits }), Error, `limits.${k}`);
  }
  const { chunksNow: _, ...noCounts } = COLLECTION.limits;
  assertThrows(() => checkCollection({ ...COLLECTION, limits: noCounts }), Error, 'chunksNow');
  assertThrows(
    () => checkCollection({ ...COLLECTION, allowedRefusals: ['no_desk_row'] }),
    Error,
    'maxAllowedRefusalShare',
  );
});

Deno.test('records file: JSON lines, blank lines skipped, a bad line named', () => {
  assertEquals(parseRecords('{"a":1}\n\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
  assertThrows(() => parseRecords('{"a":1}\nnot json\n'), Error, 'line 2');
  assertThrows(() => parseRecords('\n\n'), Error, 'no records');
});

Deno.test('plan: prints the batch and touches no database', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r)).join('\n');
  const { d, lines, db } = deps({ 'c.json': JSON.stringify(COLLECTION), 'r.jsonl': records });
  assertEquals(await main(['plan', '--collection', 'c.json', '--records', 'r.jsonl'], d), 0);
  assertStringIncludes(lines[0], 'records 2, held 0, batches 1');
  assertStringIncludes(lines[1], '2 documents');
  assertEquals(db.calls.length, 0);
});

Deno.test('run: refuses a runner with uncommitted changes before any database call', async () => {
  const records = JSON.stringify(await question(1));
  const { d, db } = deps({ 'c.json': JSON.stringify(COLLECTION), 'r.jsonl': records }, {
    git: () => Promise.resolve({ commit: 'abcdef1', dirty: true }),
  });
  await assertRejects(
    () => main(['run', '--collection', 'c.json', '--records', 'r.jsonl', '--receipts', '/var/receipts'], d),
    Error,
    'uncommitted',
  );
  assertEquals(db.calls.length, 0);
});

Deno.test('run: refuses receipts inside the repository before any database call', async () => {
  const records = JSON.stringify(await question(1));
  const { d, db } = deps({ 'c.json': JSON.stringify(COLLECTION), 'r.jsonl': records });
  await assertRejects(
    () => main(['run', '--collection', 'c.json', '--records', 'r.jsonl', '--receipts', REPO_ROOT], d),
    Error,
    'outside the repository',
  );
  assertEquals(db.calls.length, 0);
});

Deno.test('run: one batch end to end on a fake database, receipts in the given directory, with the commit', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r)).join('\n');
  const { d, lines, written, db } = deps({ 'c.json': JSON.stringify(COLLECTION), 'r.jsonl': records });
  const code = await main(['run', '--collection', 'c.json', '--records', 'r.jsonl', '--receipts', '/var/receipts'], d);
  assertEquals(code, 0, lines.join('\n'));
  assert(db.calls.some((c) => c.method === 'register'), 'nothing was registered');
  assert(written.size > 0, 'no receipt');
  for (const [path, body] of written) {
    assert(path.startsWith('/var/receipts/'), path);
    assertStringIncludes(body, '"runner_commit": "abcdef1"');
  }
  assert(lines.some((l) => l.includes('completed')), lines.join('\n'));
});

/** An acceptance database whose one sampled document passes every check, or fails the stored-document check. */
function acceptStub(pass: boolean): AcceptDb {
  const doc = '00000000-0000-4000-8000-000000000001';
  return {
    sample: () => Promise.resolve([{ source_key: 'k', document_id: doc, content_sha256: H, chunks: 1 }]),
    stored: () =>
      Promise.resolve(
        pass
          ? [{
            id: doc,
            content_sha256: H,
            indexed: true,
            chunks: 1,
            vectors: 1,
            desk_tier: 'national',
            desk_feature: QUESTIONS,
          }]
          : [],
      ),
    linkKeys: () => Promise.resolve({ [doc]: [] }),
    resolve: () => Promise.resolve([]),
    probe: () => Promise.resolve([{ document_id: doc, similarity: 1 }]),
  };
}
const AUTO = { ...COLLECTION, acceptance: { sample: 50, requireLinks: false } };
const runArgs = ['run', '--collection', 'c.json', '--records', 'r.jsonl', '--receipts', '/var/receipts'];

Deno.test('parseArgs: automated and manual acceptance are exclusive, and the service name is plain', () => {
  const c = parseArgs([...runArgs, '--accept-service', 'nter-admin']);
  assertEquals(c.cmd === 'run' && c.acceptService, 'nter-admin');
  assertThrows(() => parseArgs([...runArgs, '--accept-service', 'a', '--accepted', H]), Error, 'not both');
  assertThrows(() => parseArgs([...runArgs, '--accept-service', 'host=x user=y']), Error, 'bad --accept-service');
});

Deno.test('serviceEnv: the acceptance connection keeps none of the corpus_ingest PG variables', () => {
  const env = serviceEnv('nter-admin', {
    PATH: '/bin',
    PGUSER: 'corpus_ingest',
    PGHOST: 'h',
    PGPASSWORD: 'p',
    PGDATABASE: 'd',
    PGSSLMODE: 'require',
    PGPASSFILE: '/x/pgpass',
  });
  assertEquals(env, { PATH: '/bin', PGPASSFILE: '/x/pgpass', PGSERVICE: 'nter-admin' });
});

Deno.test('collection file: an acceptance block must say its sample and whether links are required', () => {
  checkCollection(AUTO);
  assertThrows(
    () => checkCollection({ ...COLLECTION, acceptance: { sample: 0, requireLinks: true } }),
    Error,
    'sample',
  );
  assertThrows(() => checkCollection({ ...COLLECTION, acceptance: { sample: 50 } }), Error, 'requireLinks');
});

Deno.test('run: automated acceptance needs the collection’s acceptance block, checked before any database call', async () => {
  const records = JSON.stringify(await question(1));
  const { d, db } = deps({ 'c.json': JSON.stringify(COLLECTION), 'r.jsonl': records });
  await assertRejects(() => main([...runArgs, '--accept-service', 'nter-admin'], d), Error, 'acceptance block');
  assertEquals(db.calls.length, 0);
});

Deno.test('run: a batch that passes automated acceptance is accepted, with its report written', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r)).join('\n');
  const { d, lines, written } = deps({ 'c.json': JSON.stringify(AUTO), 'r.jsonl': records }, {
    acceptDb: () => acceptStub(true),
  });
  assertEquals(await main([...runArgs, '--accept-service', 'nter-admin'], d), 0, lines.join('\n'));
  const report = [...written].find(([p]) => p.includes('/acceptance-'));
  assert(report, 'no acceptance report');
  assertStringIncludes(report[1], '"ok": true');
  assert(lines.some((l) => l.includes('acceptance') && l.includes('passed')), lines.join('\n'));
});

Deno.test('run: a batch that fails automated acceptance makes the run fail, with the failure in its report', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r)).join('\n');
  const { d, lines, written } = deps({ 'c.json': JSON.stringify(AUTO), 'r.jsonl': records }, {
    acceptDb: () => acceptStub(false),
  });
  assertEquals(await main([...runArgs, '--accept-service', 'nter-admin'], d), 1, lines.join('\n'));
  const report = [...written].find(([p]) => p.includes('/acceptance-'));
  assert(report, 'no acceptance report');
  assertStringIncludes(report[1], '"missing_document"');
  assert(lines.some((l) => l.includes('not accepted')), lines.join('\n'));
});

Deno.test('automated acceptance: a batch with no id is never accepted, and no report is claimed for it', async () => {
  const written: string[] = [];
  const accept = automated(acceptStub(true), { sample: 50, requireLinks: false }, '/var/receipts', {
    writeText: (p) => (written.push(p), Promise.resolve()),
    log: () => {},
  });
  assertEquals(await accept({ batch_id: null, manifest_sha256: H }), false);
  assertEquals(written, []);
});
