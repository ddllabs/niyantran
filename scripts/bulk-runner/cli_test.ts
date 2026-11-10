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

/** The collection and records files, with the pack reader's receipt for the records (F309). */
async function files(collection: unknown, records: string): Promise<Record<string, string>> {
  return {
    'c.json': JSON.stringify(collection),
    'r.jsonl': records,
    'r.jsonl.receipt.json': JSON.stringify({ output_sha256: await sha256Hex(records), lines_written: 1 }),
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
    listDir: () => Promise.resolve([]),
    makeDir: () => Promise.resolve(),
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

Deno.test('receipts must go outside the repository', async () => {
  const none = { repoRoot: REPO_ROOT, commonDir: () => Promise.resolve(null) };
  await assertRejects(() => checkReceiptsDir(REPO_ROOT, none), Error, 'outside the repository');
  await assertRejects(
    () => checkReceiptsDir(`${REPO_ROOT}/eval/ingestion/results`, none),
    Error,
    'outside the repository',
  );
  await assertRejects(
    () => checkReceiptsDir(`${REPO_ROOT}/scripts/../receipts`, none),
    Error,
    'outside the repository',
  );
  assertEquals(await checkReceiptsDir('/var/receipts', none), '/var/receipts');
});

Deno.test('receipts: from a worktree, the main checkout, the worktree and any directory with a .git are all refused (F310)', async () => {
  const t = await Deno.realPath(await Deno.makeTempDir());
  try {
    // The main checkout has no .git entry of its own here, so only the git common directory can reveal it.
    const main1 = `${t}/main`;
    const wt = `${t}/wt`;
    const anc = `${t}/anc`;
    await Deno.mkdir(`${anc}/.git`, { recursive: true });
    await Deno.mkdir(`${t}/out`, { recursive: true });
    await Deno.mkdir(main1, { recursive: true });
    await Deno.mkdir(wt, { recursive: true });
    const worktree = { repoRoot: wt, commonDir: () => Promise.resolve(`${main1}/.git`) };
    await assertRejects(() => checkReceiptsDir(`${main1}/receipts`, worktree), Error, 'outside the repository');
    await assertRejects(() => checkReceiptsDir(`${wt}/receipts`, worktree), Error, 'outside the repository');
    await assertRejects(() => checkReceiptsDir(`${anc}/sub/receipts`, worktree), Error, '.git');
    assertEquals(await checkReceiptsDir(`${t}/out/receipts`, worktree), `${t}/out/receipts`);
  } finally {
    await Deno.remove(t, { recursive: true });
  }
});

Deno.test('receipts: the guard is pack.ts’s refuseInCheckout, not a copy of it', async () => {
  const src = await Deno.readTextFile(new URL('./cli.ts', import.meta.url));
  assert(!/function\s+refuseInCheckout/.test(src), 'cli.ts defines its own refuseInCheckout');
  assert(/refuseInCheckout[^;]*from\s+'\.\/pack\.ts'/.test(src), 'cli.ts does not import it from pack.ts');
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
  const { d, lines, db } = deps(await files(COLLECTION, records));
  assertEquals(await main(['plan', '--collection', 'c.json', '--records', 'r.jsonl'], d), 0);
  assertStringIncludes(lines[0], 'records 2, held 0, batches 1');
  assertStringIncludes(lines[1], '2 documents');
  assertEquals(db.calls.length, 0);
});

const plan1 = ['plan', '--collection', 'c.json', '--records', 'r.jsonl'];

Deno.test('receipt: plan and run read the reader’s receipt and refuse a records file edited after selection (F309)', async () => {
  const records = JSON.stringify(await question(1));
  const f = await files(COLLECTION, records);
  for (const argv of [plan1, runArgs]) {
    const edited = deps({ ...f, 'r.jsonl': records + '\n' + JSON.stringify(await question(2)) });
    const e = await assertRejects(() => main(argv, edited.d), Error, 'receipt_mismatch');
    assertStringIncludes(e.message, 'r.jsonl');
    assertEquals(edited.db.calls.length, 0);
    assertEquals(edited.written.size, 0);
  }
  const ok = deps(f);
  assertEquals(await main(plan1, ok.d), 0);
});

Deno.test('receipt: a missing or unreadable receipt is refused, with its own code', async () => {
  const records = JSON.stringify(await question(1));
  const f = await files(COLLECTION, records);
  const { 'r.jsonl.receipt.json': _, ...noReceipt } = f;
  await assertRejects(() => main(plan1, deps(noReceipt).d), Error, 'receipt_missing');
  for (const bad of ['not json', '[]', '{}', JSON.stringify({ output_sha256: 'xyz' })]) {
    await assertRejects(
      () => main(plan1, deps({ ...f, 'r.jsonl.receipt.json': bad }).d),
      Error,
      'receipt_unreadable',
    );
  }
});

Deno.test('receipt: another file’s receipt does not do', async () => {
  const records = JSON.stringify(await question(1));
  const f = await files(COLLECTION, records);
  const other = JSON.stringify({ output_sha256: await sha256Hex(JSON.stringify(await question(2))) });
  await assertRejects(() => main(plan1, deps({ ...f, 'r.jsonl.receipt.json': other }).d), Error, 'receipt_mismatch');
});

Deno.test('receipt: a screened file is bound to the screen’s receipt beside it, not to a reader receipt', async () => {
  const records = JSON.stringify(await question(1));
  const f = await files(COLLECTION, records);
  const screened: Record<string, string> = {
    'c.json': f['c.json'],
    'out/screened.jsonl': records,
    'out/screen.receipt.json': JSON.stringify({ outputs: { screened: { sha256: await sha256Hex(records) } } }),
  };
  const argv = ['plan', '--collection', 'c.json', '--records', 'out/screened.jsonl'];
  assertEquals(await main(argv, deps(screened).d), 0);
  const edited = { ...screened, 'out/screened.jsonl': records + '\n' + JSON.stringify(await question(2)) };
  await assertRejects(() => main(argv, deps(edited).d), Error, 'receipt_mismatch');
  const { 'out/screen.receipt.json': _, ...none } = screened;
  await assertRejects(() => main(argv, deps(none).d), Error, 'receipt_missing');
  // A reader receipt beside a screened file does not stand in for the screen's.
  const reader = { ...none, 'out/screened.jsonl.receipt.json': f['r.jsonl.receipt.json'] };
  await assertRejects(() => main(argv, deps(reader).d), Error, 'receipt_missing');
  // The screen's receipt for another screened file is refused.
  const wrong = { ...screened, 'out/screen.receipt.json': JSON.stringify({ outputs: { screened: { sha256: H } } }) };
  await assertRejects(() => main(argv, deps(wrong).d), Error, 'receipt_mismatch');
});

const splitArgs = (out = '/var/parts', n = '2') => ['split', '--records', 'r.jsonl', '--lines', n, '--out', out];

/** Five records with a blank line among them, and the files a reader would have left beside them. */
async function fiveRecords() {
  const recs = await Promise.all([1, 2, 3, 4, 5].map(async (n) => JSON.stringify(await question(n))));
  const text = recs.slice(0, 2).join('\n') + '\n\n' + recs.slice(2).join('\n') + '\n';
  return { recs, f: await files(COLLECTION, text), text };
}

Deno.test('parseArgs: split takes --records, --lines (a positive integer) and --out', () => {
  assertEquals(parseArgs(splitArgs()), { cmd: 'split', records: 'r.jsonl', lines: 2, out: '/var/parts' });
  assertThrows(() => parseArgs(['split', '--records', 'r', '--lines', '2']), Error, '--out is required');
  assertThrows(() => parseArgs(splitArgs('/o', '0')), Error, '--lines');
  assertThrows(() => parseArgs(splitArgs('/o', '1.5')), Error, '--lines');
  assertThrows(() => parseArgs([...splitArgs(), '--collection', 'c']), Error, 'unknown');
});

Deno.test('split: parts of at most n records, bytes and order kept, each with a receipt that lets it into plan (F309)', async () => {
  const { recs, f } = await fiveRecords();
  const { d, written } = deps(f);
  assertEquals(await main(splitArgs(), d), 0);
  assertEquals([...written.keys()].sort(), [
    '/var/parts/part-000.jsonl',
    '/var/parts/part-000.jsonl.receipt.json',
    '/var/parts/part-001.jsonl',
    '/var/parts/part-001.jsonl.receipt.json',
    '/var/parts/part-002.jsonl',
    '/var/parts/part-002.jsonl.receipt.json',
  ]);
  const parts = ['000', '001', '002'].map((k) => written.get(`/var/parts/part-${k}.jsonl`)!);
  assertEquals(parts.join(''), recs.map((r) => r + '\n').join(''));
  assertEquals(parts.map((p) => p.split('\n').length - 1), [2, 2, 1]);
  const inputSha = await sha256Hex(f['r.jsonl']);
  const r1 = JSON.parse(written.get('/var/parts/part-001.jsonl.receipt.json')!);
  assertEquals(r1, {
    output_sha256: await sha256Hex(parts[1]),
    lines_written: 2,
    source: { records: 'r.jsonl', sha256: inputSha, from_line: 4, to_line: 5 },
  });
  // Every part is accepted by plan through its own receipt.
  for (const k of ['000', '001', '002']) {
    const p = deps({
      'c.json': f['c.json'],
      [`part-${k}.jsonl`]: written.get(`/var/parts/part-${k}.jsonl`)!,
      [`part-${k}.jsonl.receipt.json`]: written.get(`/var/parts/part-${k}.jsonl.receipt.json`)!,
    });
    assertEquals(await main(['plan', '--collection', 'c.json', '--records', `part-${k}.jsonl`], p.d), 0);
  }
  // An edited part is refused.
  const bad = deps({
    'c.json': f['c.json'],
    'part-000.jsonl': parts[0] + parts[1],
    'part-000.jsonl.receipt.json': written.get('/var/parts/part-000.jsonl.receipt.json')!,
  });
  await assertRejects(
    () => main(['plan', '--collection', 'c.json', '--records', 'part-000.jsonl'], bad.d),
    Error,
    'receipt_mismatch',
  );
});

Deno.test('split: the same input and n give byte-identical parts and receipts', async () => {
  const { f } = await fiveRecords();
  const a = deps(f);
  const b = deps(f);
  await main(splitArgs(), a.d);
  await main(splitArgs(), b.d);
  assertEquals([...a.written], [...b.written]);
});

Deno.test('split: an input whose receipt is missing, unreadable or does not match is refused, and nothing is written', async () => {
  const { f } = await fiveRecords();
  const { 'r.jsonl.receipt.json': _, ...none } = f;
  for (
    const [files_, code] of [
      [none, 'receipt_missing'],
      [{ ...f, 'r.jsonl.receipt.json': 'nope' }, 'receipt_unreadable'],
      [{ ...f, 'r.jsonl': f['r.jsonl'] + '\n' }, 'receipt_mismatch'],
    ] as const
  ) {
    const x = deps(files_);
    await assertRejects(() => main(splitArgs(), x.d), Error, code);
    assertEquals(x.written.size, 0);
  }
});

Deno.test('split: refuses an --out inside a checkout, or one that already holds part files', async () => {
  const { f } = await fiveRecords();
  const inside = deps(f, { commonDir: () => Promise.resolve(null) });
  await assertRejects(() => main(splitArgs(`${REPO_ROOT}/parts`), inside.d), Error, 'outside the repository');
  assertEquals(inside.written.size, 0);
  for (const existing of ['part-000.jsonl', 'part-007.jsonl.receipt.json']) {
    const x = deps(f, { listDir: () => Promise.resolve([existing]) });
    await assertRejects(() => main(splitArgs(), x.d), Error, 'already holds');
    assertEquals(x.written.size, 0);
  }
});

Deno.test('split: a screened file is split under the screen’s receipt', async () => {
  const { text, f } = await fiveRecords();
  const g = {
    'c.json': f['c.json'],
    'out/screened.jsonl': text,
    'out/screen.receipt.json': JSON.stringify({ outputs: { screened: { sha256: await sha256Hex(text) } } }),
  };
  const x = deps(g);
  assertEquals(await main(['split', '--records', 'out/screened.jsonl', '--lines', '3', '--out', '/var/parts'], x.d), 0);
  assertEquals(x.written.size, 4);
  await assertRejects(
    () =>
      main(
        ['split', '--records', 'out/screened.jsonl', '--lines', '3', '--out', '/var/parts'],
        deps({ ...g, 'out/screened.jsonl': text + text }).d,
      ),
    Error,
    'receipt_mismatch',
  );
});

Deno.test('run: refuses a runner with uncommitted changes before any database call', async () => {
  const records = JSON.stringify(await question(1));
  const { d, db } = deps(await files(COLLECTION, records), {
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
  const { d, db } = deps(await files(COLLECTION, records));
  await assertRejects(
    () => main(['run', '--collection', 'c.json', '--records', 'r.jsonl', '--receipts', REPO_ROOT], d),
    Error,
    'outside the repository',
  );
  assertEquals(db.calls.length, 0);
});

Deno.test('run: one batch end to end on a fake database, receipts in the given directory, with the commit', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r)).join('\n');
  const { d, lines, written, db } = deps(await files(COLLECTION, records));
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
    probe: () => Promise.resolve({ content: 't', rows: [{ document_id: doc, similarity: 1, content: 't' }] }),
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
  const { d, db } = deps(await files(COLLECTION, records));
  await assertRejects(() => main([...runArgs, '--accept-service', 'nter-admin'], d), Error, 'acceptance block');
  assertEquals(db.calls.length, 0);
});

Deno.test('run: a batch that passes automated acceptance is accepted, with its report written', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r)).join('\n');
  const { d, lines, written } = deps(await files(AUTO, records), {
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
  const { d, lines, written } = deps(await files(AUTO, records), {
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
