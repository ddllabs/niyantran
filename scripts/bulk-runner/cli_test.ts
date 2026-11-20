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
  MAX_RECORDS_BYTES,
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
async function question(n: number, tail = ''): Promise<Rec> {
  const r: Rec = await nationalQuestion();
  const text = `Question ${n}. The Minister replied on the progress of scheme ${n} in the year under review.${tail}`;
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

const countLines = (text: string) => text.split('\n').filter((l) => l.trim()).length;

/** The pack reader's receipt for a records text: the fields the runner reads, with the real hash and count. */
async function readerReceipt(records: string, over: Rec = {}): Promise<string> {
  return JSON.stringify({
    pack: 'national-v1.1',
    entry: 'questions.jsonl',
    manifest_sha256: H,
    output_sha256: await sha256Hex(records),
    lines_written: countLines(records),
    ...over,
  });
}

/** The collection and records files, with the pack reader's receipt for the records (F309). */
async function files(collection: unknown, records: string): Promise<Record<string, string>> {
  return {
    'c.json': JSON.stringify(collection),
    'r.jsonl': records,
    'r.jsonl.receipt.json': await readerReceipt(records),
  };
}

/** The screen's receipt for a screened text: outputs.screened carries the hash and the line count. */
async function screenReceipt(text: string, over: Rec = {}): Promise<string> {
  return JSON.stringify({ outputs: { screened: { sha256: await sha256Hex(text), lines: countLines(text), ...over } } });
}

type Files = Record<string, string | Uint8Array>;
const enc = (v: string | Uint8Array) => typeof v === 'string' ? new TextEncoder().encode(v) : v;
const notFound = (p: string) => Promise.reject(new Deno.errors.NotFound(`no file ${p}`));

/** The bytes cut into chunks of `size` (the last may be shorter); a size of 0 gives one chunk. */
async function* chunksOf(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  const step = size > 0 ? size : Math.max(bytes.length, 1);
  for (let i = 0; i < bytes.length; i += step) yield bytes.slice(i, i + step);
}

function deps(files: Files, over: Partial<CliDeps> = {}, chunk = 0) {
  const lines: string[] = [];
  const written = new Map<string, string>();
  const db = new FakeDb();
  let now = 1_000;
  const d: CliDeps = {
    readText: (p) => p in files ? Promise.resolve(new TextDecoder().decode(enc(files[p]))) : notFound(p),
    readBytes: (p) => (p in files ? Promise.resolve(enc(files[p])) : notFound(p)),
    fileSize: (p) => (p in files ? Promise.resolve(enc(files[p]).length) : notFound(p)),
    readChunks: (p) => {
      if (!(p in files)) throw new Deno.errors.NotFound(`no file ${p}`);
      return chunksOf(enc(files[p]), chunk);
    },
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
  checkCollection({ ...COLLECTION, prepare: { maxChunks: 700, dropInvalidCitationDates: true } });
  checkCollection({ ...COLLECTION, prepare: { maxChunks: 700, dropInvalidCitationDates: false } });
  for (const bad of ['yes', 1, null, {}]) {
    assertThrows(
      () => checkCollection({ ...COLLECTION, prepare: { maxChunks: 700, dropInvalidCitationDates: bad } }),
      Error,
      'dropInvalidCitationDates',
    );
  }
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
  const other = await readerReceipt(JSON.stringify(await question(2)));
  await assertRejects(() => main(plan1, deps({ ...f, 'r.jsonl.receipt.json': other }).d), Error, 'receipt_mismatch');
});

Deno.test('receipt: a screened file is bound to the screen’s receipt beside it, not to a reader receipt', async () => {
  const records = JSON.stringify(await question(1));
  const f = await files(COLLECTION, records);
  const screened: Record<string, string> = {
    'c.json': f['c.json'],
    'out/screened.jsonl': records,
    'out/screen.receipt.json': await screenReceipt(records),
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
  const wrong = { ...screened, 'out/screen.receipt.json': await screenReceipt(records, { sha256: H }) };
  await assertRejects(() => main(argv, deps(wrong).d), Error, 'receipt_mismatch');
});

const splitArgs = (out = '/var/parts', n = '2') => ['split', '--records', 'r.jsonl', '--lines', n, '--out', out];

/** Five records with a blank line among them, and the files a reader would have left beside them. */
async function fiveRecords() {
  const recs = await Promise.all([1, 2, 3, 4, 5].map(async (n) => JSON.stringify(await question(n))));
  const text = recs.slice(0, 2).join('\n') + '\n\n' + recs.slice(2).join('\n') + '\n';
  return { recs, f: await files(COLLECTION, text), text };
}

Deno.test('receipt (F321): the count must be a positive integer equal to the records parsed', async () => {
  const records = JSON.stringify(await question(1)) + '\n' + JSON.stringify(await question(2));
  const f = await files(COLLECTION, records);
  const withCount = async (over: Rec) => ({ ...f, 'r.jsonl.receipt.json': await readerReceipt(records, over) });
  // Right hash, wrong count: refused by plan and by split.
  for (const n of [1, 3]) {
    await assertRejects(
      async () => main(plan1, deps(await withCount({ lines_written: n })).d),
      Error,
      'receipt_mismatch',
    );
    await assertRejects(
      async () => main(splitArgs(), deps(await withCount({ lines_written: n })).d),
      Error,
      'receipt_mismatch',
    );
  }
  // No count, or one that is not a positive integer: unreadable.
  for (const n of [undefined, 0, -2, 1.5, '2', null]) {
    await assertRejects(
      async () => main(plan1, deps(await withCount({ lines_written: n })).d),
      Error,
      'receipt_unreadable',
    );
  }
  assertEquals(await main(plan1, deps(f).d), 0);
  // The screen's receipt carries its count as outputs.screened.lines.
  const screened = (receipt: string) => ({
    'c.json': f['c.json'],
    'out/screened.jsonl': records,
    'out/screen.receipt.json': receipt,
  });
  const argv = ['plan', '--collection', 'c.json', '--records', 'out/screened.jsonl'];
  assertEquals(await main(argv, deps(screened(await screenReceipt(records))).d), 0);
  await assertRejects(
    async () => main(argv, deps(screened(await screenReceipt(records, { lines: 1 }))).d),
    Error,
    'receipt_mismatch',
  );
  for (const n of [undefined, -1, 2.5, '2']) {
    await assertRejects(
      async () => main(argv, deps(screened(await screenReceipt(records, { lines: n }))).d),
      Error,
      'receipt_unreadable',
    );
  }
  // A screen that passed nothing writes an empty file and lines 0: that is an empty input, not a broken receipt.
  const empty = { ...screened(await screenReceipt('', { lines: 0 })), 'out/screened.jsonl': '' };
  const e = await assertRejects(() => main(argv, deps(empty).d), Error, 'holds no records');
  assertEquals(e.message.includes('receipt_'), false);
  // lines 0 beside a file that holds records is still a mismatch.
  await assertRejects(
    async () => main(argv, deps(screened(await screenReceipt(records, { lines: 0 }))).d),
    Error,
    'receipt_mismatch',
  );
});

Deno.test('receipt (F321): a reader receipt must name its pack, entry and manifest; a split part’s must carry its source', async () => {
  const records = JSON.stringify(await question(1));
  const f = await files(COLLECTION, records);
  const bare = JSON.stringify({ output_sha256: await sha256Hex(records), lines_written: 1 });
  const bad: Rec[] = [
    { pack: undefined },
    { entry: undefined },
    { manifest_sha256: undefined },
    { pack: '' },
    { entry: 7 },
    { manifest_sha256: 'abc' },
    { manifest_sha256: 'A'.repeat(64) },
  ];
  for (const over of bad) {
    await assertRejects(
      async () => main(plan1, deps({ ...f, 'r.jsonl.receipt.json': await readerReceipt(records, over) }).d),
      Error,
      'receipt_unreadable',
    );
  }
  await assertRejects(
    () => main(plan1, deps({ ...f, 'r.jsonl.receipt.json': bare }).d),
    Error,
    'receipt_unreadable',
  );
  // A source that is not well formed does not make a receipt a split part's.
  const source = { records: 'r.jsonl', sha256: H, from_line: 1, to_line: 1 };
  const badSources = [
    'x',
    null,
    { ...source, records: '' },
    { ...source, sha256: 'nope' },
    { ...source, from_line: 0 },
    { ...source, to_line: 1.5 },
    { ...source, from_line: 3, to_line: 2 },
  ];
  for (const src of badSources) {
    const r = JSON.stringify({ output_sha256: await sha256Hex(records), lines_written: 1, source: src });
    await assertRejects(
      () => main(plan1, deps({ ...f, 'r.jsonl.receipt.json': r }).d),
      Error,
      'receipt_unreadable',
    );
  }
  // A source makes a receipt a split part's only beside a file named as `split` names its parts.
  const part = JSON.stringify({ output_sha256: await sha256Hex(records), lines_written: 1, source });
  await assertRejects(
    () => main(plan1, deps({ ...f, 'r.jsonl.receipt.json': part }).d),
    Error,
    'receipt_unreadable',
  );
  const asPart = (receipt: string) =>
    deps({ 'c.json': f['c.json'], 'part-000.jsonl': records, 'part-000.jsonl.receipt.json': receipt }).d;
  const planPart = ['plan', '--collection', 'c.json', '--records', 'part-000.jsonl'];
  assertEquals(await main(planPart, asPart(part)), 0);
  // A part cannot hold more records than the lines its source covers.
  const two = records + '\n' + JSON.stringify(await question(2));
  const over = JSON.stringify({ output_sha256: await sha256Hex(two), lines_written: 2, source });
  await assertRejects(
    () => main(planPart, deps({ 'c.json': f['c.json'], 'part-000.jsonl': two, 'part-000.jsonl.receipt.json': over }).d),
    Error,
    'receipt_unreadable',
  );
});

Deno.test('receipt (F321): the hash is over the file’s bytes; invalid UTF-8 and a byte-order mark are refused', async () => {
  const head = new TextEncoder().encode('{"a":"');
  const tail = new TextEncoder().encode('"}');
  const bytes = new Uint8Array([...head, 0xff, ...tail]);
  const rawSha = async (b: Uint8Array) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', b.slice()))].map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  const receipt = (sha256: string) => readerReceipt('x', { output_sha256: sha256, lines_written: 1 });
  const argvs = [plan1, splitArgs()];
  for (const argv of argvs) {
    // An honest receipt (hash of the bytes) for a file that is not UTF-8.
    const honest = deps({
      'c.json': JSON.stringify(COLLECTION),
      'r.jsonl': bytes,
      'r.jsonl.receipt.json': await receipt(await rawSha(bytes)),
    });
    await assertRejects(() => main(argv, honest.d), Error, 'UTF-8');
    assertEquals(honest.written.size, 0);
    // A receipt made over the decoded text (invalid bytes as U+FFFD) does not vouch for the bytes.
    const decoded = await sha256Hex(new TextDecoder().decode(bytes));
    const old = deps({
      'c.json': JSON.stringify(COLLECTION),
      'r.jsonl': bytes,
      'r.jsonl.receipt.json': await receipt(decoded),
    });
    await assertRejects(() => main(argv, old.d), Error, 'receipt_mismatch');
    // A leading byte-order mark, even with an honest receipt.
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(JSON.stringify(await question(1)))]);
    const withBom = deps({
      'c.json': JSON.stringify(COLLECTION),
      'r.jsonl': bom,
      'r.jsonl.receipt.json': await receipt(await rawSha(bom)),
    });
    await assertRejects(() => main(argv, withBom.d), Error, 'byte-order mark');
    assertEquals(withBom.written.size, 0);
  }
});

Deno.test('receipt (F321): missing only when the receipt is not found; any other read error is unreadable, with its name', async () => {
  const records = JSON.stringify(await question(1));
  const f = await files(COLLECTION, records);
  const failing = (error: Error) =>
    deps(f, {
      readText: (p) => p === 'r.jsonl.receipt.json' ? Promise.reject(error) : Promise.resolve(f[p]),
    });
  for (const argv of [plan1, splitArgs()]) {
    await assertRejects(() => main(argv, failing(new Deno.errors.NotFound('gone')).d), Error, 'receipt_missing');
    const e = await assertRejects(
      () => main(argv, failing(new Deno.errors.PermissionDenied('no')).d),
      Error,
      'receipt_unreadable',
    );
    assertStringIncludes(e.message, 'PermissionDenied');
    assert(!e.message.includes('receipt_missing'));
    await assertRejects(() => main(argv, failing(new Error('boom')).d), Error, 'receipt_unreadable');
  }
});

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
    'out/screen.receipt.json': await screenReceipt(text),
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

// F308: split reads the records file in chunks. The text below has multi-byte characters (2 and 3 bytes), and each
// variant is a shape the line reader must get right whatever the chunk size.
const STREAM_LINES = ['{"k":"é₹-1"}', '{"k":"plain-2"}', '{"k":"₹₹₹-3"}', '{"k":"é-4"}', '{"k":"end-5"}'];
const STREAM_SHAPES: Record<string, string> = {
  'LF with a trailing newline': STREAM_LINES.join('\n') + '\n',
  'no trailing newline': STREAM_LINES.join('\n'),
  'CRLF lines': STREAM_LINES.join('\r\n') + '\r\n',
  'blank lines among the records': '\n' + STREAM_LINES.slice(0, 2).join('\n') + '\n\n  \n' +
    STREAM_LINES.slice(2).join('\n') + '\n\n',
};

/** A records file as raw bytes with a reader receipt for them; `count` is the receipt's record count. */
async function rawFiles(bytes: Uint8Array, count: number, over: Rec = {}): Promise<Files> {
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()))]
    .map((x) => x.toString(16).padStart(2, '0')).join('');
  return {
    'r.jsonl': bytes,
    'r.jsonl.receipt.json': JSON.stringify({
      pack: 'national-v1.1',
      entry: 'questions.jsonl',
      manifest_sha256: H,
      output_sha256: sha,
      lines_written: count,
      ...over,
    }),
  };
}

Deno.test('split (F308): never reads the whole file, and parts are the same bytes whatever the chunk size', async () => {
  for (const [shape, text] of Object.entries(STREAM_SHAPES)) {
    const bytes = new TextEncoder().encode(text);
    const f = await rawFiles(bytes, STREAM_LINES.length);
    const whole = deps(f);
    assertEquals(await main(splitArgs(), whole.d), 0, shape);
    // Parts hold each record byte for byte, "\r" kept, and a "\n" ended on each.
    const body = [...whole.written].filter(([k]) => k.endsWith('.jsonl')).map(([, v]) => v).join('');
    assertEquals(body, text.split('\n').filter((l) => l.trim()).map((l) => l + '\n').join(''), shape);
    // Every chunk size, so every boundary falls inside a character, inside a line and on a newline.
    for (let size = 1; size <= bytes.length; size++) {
      const x = deps(f, {
        readBytes: () => Promise.reject(new Error('the whole file was read')),
        readText: (p) =>
          p === 'r.jsonl' ? Promise.reject(new Error('the whole file was read as text')) : deps(f).d.readText(p),
      }, size);
      assertEquals(await main(splitArgs(), x.d), 0, `${shape}, chunk ${size}`);
      assertEquals([...x.written], [...whole.written], `${shape}, chunk ${size}`);
    }
  }
});

Deno.test('split (F308): a chunk boundary inside a multi-byte character, a line, or on a newline, named', async () => {
  const text = '{"k":"é"}\n{"k":"₹"}\n';
  const bytes = new TextEncoder().encode(text);
  const f = await rawFiles(bytes, 2);
  const at = (needle: number[]) => {
    for (let i = 0; i + needle.length <= bytes.length; i++) if (needle.every((b, j) => bytes[i + j] === b)) return i;
    throw new Error('not found');
  };
  const euro = at([0xe2, 0x82, 0xb9]); // the three bytes of the rupee sign
  const cuts = [euro + 1, euro + 2, at([0xc3, 0xa9]) + 1, 5, 10, /* just after the first newline */ bytes.length - 1];
  assertEquals(bytes[10], 0x0a);
  const whole = deps(f);
  await main(splitArgs(), whole.d);
  for (const cut of cuts) {
    const x = deps(f, {
      readChunks: () =>
        (async function* () {
          yield bytes.slice(0, cut);
          yield bytes.slice(cut);
        })(),
    });
    assertEquals(await main(splitArgs(), x.d), 0, `cut at ${cut}`);
    assertEquals([...x.written], [...whole.written], `cut at ${cut}`);
  }
});

Deno.test('split (F308): invalid UTF-8 in a later chunk, or a cut-off character at the end, is refused and nothing is written', async () => {
  const good = new TextEncoder().encode('{"k":"a"}\n{"k":"b"}\n');
  const cases: Record<string, Uint8Array> = {
    'a stray byte in the second chunk': new Uint8Array([...good.slice(0, 12), 0xff, ...good.slice(12)]),
    'a continuation byte with no lead': new Uint8Array([...good, 0x80]),
    'a character cut off at the end': new Uint8Array([...good, 0xe2, 0x82]),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    for (const size of [1, 4, 0]) {
      const x = deps(await rawFiles(bytes, 2), {}, size);
      await assertRejects(() => main(splitArgs(), x.d), Error, 'not valid UTF-8', `${name}, chunk ${size}`);
      assertEquals(x.written.size, 0, name);
    }
  }
});

Deno.test('split (F308): a byte-order mark is refused whichever chunk it arrives in, and nothing is written', async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"k":"a"}\n')]);
  for (const size of [1, 2, 3, 0]) {
    const x = deps(await rawFiles(bytes, 1), {}, size);
    await assertRejects(() => main(splitArgs(), x.d), Error, 'byte-order mark', `chunk ${size}`);
    assertEquals(x.written.size, 0);
  }
});

Deno.test('split (F308): a wrong hash or count is refused after reading in chunks, and nothing is written', async () => {
  const bytes = new TextEncoder().encode(STREAM_SHAPES['LF with a trailing newline']);
  const wrong = await rawFiles(bytes, STREAM_LINES.length, { output_sha256: H });
  for (const [f, code] of [[wrong, 'receipt_mismatch'], [await rawFiles(bytes, 4), 'receipt_mismatch']] as const) {
    const x = deps(f, {}, 3);
    await assertRejects(() => main(splitArgs(), x.d), Error, code);
    assertEquals(x.written.size, 0);
  }
  // A line that is not JSON, and a file with no records, are refused with the messages plan gives.
  for (const [text, msg] of [['{"k":1}\nnope\n', 'records line 2 is not JSON'], ['\n  \n', 'holds no records']]) {
    const x = deps(await rawFiles(new TextEncoder().encode(text), 1), {}, 2);
    await assertRejects(() => main(splitArgs(), x.d), Error, msg);
    assertEquals(x.written.size, 0);
  }
  // A missing records file is reported before a missing receipt, as it was.
  await assertRejects(() => main(splitArgs(), deps({}).d), Deno.errors.NotFound);
});

Deno.test('split (F308): a file that changes between the check and the cut is stopped', async () => {
  const a = new TextEncoder().encode('{"k":"a"}\n{"k":"b"}\n{"k":"c"}\n');
  const b = new TextEncoder().encode('{"k":"a"}\n{"k":"b"}\n{"k":"X"}\n');
  const f = await rawFiles(a, 3);
  let reads = 0;
  const x = deps(f, { readChunks: () => chunksOf(reads++ === 0 ? a : b, 5) });
  const e = await assertRejects(() => main(splitArgs('/var/parts', '2'), x.d), Error, 'receipt_mismatch');
  // The parts already cut carry no receipt, so plan and run refuse them: receipts are written only after the re-check.
  assertStringIncludes(e.message, 'no receipt');
  assertEquals([...x.written.keys()].filter((k) => k.endsWith('.receipt.json')), []);
});

Deno.test('split (F308): a write that fails stops the split, whatever the error’s type', async () => {
  const f = await rawFiles(new TextEncoder().encode('{"k":1}\n{"k":2}\n{"k":3}\n{"k":4}\n{"k":5}\n{"k":6}\n'), 6);
  for (const err of [new TypeError('bad path'), new Error('disk full')]) {
    let writes = 0;
    const x = deps(f, { writeText: () => (++writes === 2 ? Promise.reject(err) : Promise.resolve()) }, 7);
    const e = await assertRejects(() => main(splitArgs('/var/parts', '2'), x.d));
    assertEquals(e, err);
    assertEquals(x.lines, []);
  }
});

Deno.test('split (F308): a byte-order mark is named even when invalid UTF-8 follows it in the same chunk', async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xff, ...new TextEncoder().encode('{"k":1}\n')]);
  for (const chunk of [0, 1, 2, 3, 4]) {
    const x = deps(await rawFiles(bytes, 1), {}, chunk);
    await assertRejects(() => main(splitArgs(), x.d), Error, 'byte-order mark');
    assertEquals(x.written.size, 0);
  }
});

Deno.test('split (F308): a part that plan and run would refuse as too large is refused before anything is written', async () => {
  const text = '{"k":"aaaaaaaaaa"}\n{"k":"bbbbbbbbbb"}\n{"k":"cc"}\n';
  const f = await rawFiles(new TextEncoder().encode(text), 3);
  // Two 19-byte lines make a 38-byte part; one line a part fits.
  const big = deps(f, { maxPartBytes: 30 }, 5);
  const e = await assertRejects(() => main(splitArgs('/var/parts', '2'), big.d), Error, 'smaller --lines');
  assertStringIncludes(e.message, 'part-000.jsonl');
  assertEquals(big.written.size, 0);
  const ok = deps(f, { maxPartBytes: 30 }, 5);
  assertEquals(await main(splitArgs('/var/parts', '1'), ok.d), 0);
  assertEquals(ok.written.size, 6);
});

Deno.test('plan and run (F308): a records file over the byte limit is refused before it is read, naming size, limit and split', async () => {
  const records = JSON.stringify(await question(1));
  const f = await files(COLLECTION, records);
  const size = MAX_RECORDS_BYTES + 1;
  for (
    const argv of [plan1, ['run', '--collection', 'c.json', '--records', 'r.jsonl', '--receipts', '/var/receipts']]
  ) {
    const x = deps(f, {
      fileSize: (p) => p === 'r.jsonl' ? Promise.resolve(size) : Promise.reject(new Error(`size of ${p}`)),
      readBytes: () => Promise.reject(new Error('the file was read')),
    });
    const e = await assertRejects(() => main(argv, x.d), Error);
    assertStringIncludes(e.message, String(size));
    assertStringIncludes(e.message, String(MAX_RECORDS_BYTES));
    assertStringIncludes(e.message, 'split');
    assertEquals(x.db.calls.length, 0);
  }
  // At the limit the file is read as before.
  const ok = deps(f, { fileSize: () => Promise.resolve(MAX_RECORDS_BYTES) });
  assertEquals(await main(plan1, ok.d), 0);
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
function acceptStub(pass: boolean, indexMiss = false): AcceptDb {
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
    probe: () =>
      Promise.resolve({
        content: 't',
        rows: indexMiss
          ? [{ document_id: 'other', similarity: 1, content: 'x' }]
          : [{ document_id: doc, similarity: 1, content: 't' }],
      }),
    exactProbe: () => Promise.resolve({ content: 't', rows: [{ document_id: doc, similarity: 1, content: 't' }] }),
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

Deno.test('run: an index miss is passed but printed, without the source key', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r)).join('\n');
  const { d, lines } = deps(await files(AUTO, records), { acceptDb: () => acceptStub(true, true) });
  assertEquals(await main([...runArgs, '--accept-service', 'nter-admin'], d), 0, lines.join('\n'));
  assert(
    lines.some((l) => l.includes('passed, 1 index miss (exact search ranks the document first)')),
    lines.join('\n'),
  );
  assert(!lines.some((l) => l.includes('"k"') || /\bk\b/.test(l.split('acceptance')[1] ?? '')));
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

Deno.test('automated acceptance: a batch with no id is never accepted, and no acceptance line is logged for it', async () => {
  const written: string[] = [];
  const accept = automated(acceptStub(true), { sample: 50, requireLinks: false }, {
    log: (l) => written.push(l),
  });
  assertEquals((await accept({ batch_id: null, manifest_sha256: H })).ok, false);
  assertEquals(written, [], 'nothing was logged');
});

Deno.test('run: the run receipt carries citation_dates_dropped and control_codes_removed from prepare', async () => {
  const dated = async (n: number, date: string, tail = '') => {
    const r = await question(n, tail);
    return JSON.stringify({ ...r, citation: { ...r.citation, date } });
  };
  const records = [await dated(1, '2020-13-45', '\u0001'), await dated(2, '2021-02-30'), await dated(3, '2020-01-01')]
    .join('\n');
  const coll = { ...COLLECTION, prepare: { maxChunks: 800, dropInvalidCitationDates: true } };
  const { d, lines, written } = deps(await files(coll, records));
  assertEquals(
    await main(['run', '--collection', 'c.json', '--records', 'r.jsonl', '--receipts', '/var/receipts'], d),
    0,
    lines.join('\n'),
  );
  const bodies = [...written.values()].map((b) => JSON.parse(b)).filter((b) => b.run_id !== undefined);
  assert(bodies.length > 0, 'no receipt');
  for (const b of bodies) {
    assertEquals(b.citation_dates_dropped, 2);
    assertEquals(b.control_codes_removed, 1);
  }
});

// ---- the screen and the runner must use the same prepare block (F339 review) ----

const REG_COLLECTION = {
  ...COLLECTION,
  collection: 'national-regulatory',
  prepare: { maxChunks: 700, dropInvalidCitationDates: true, requireTextIdentity: true },
};
const SCREENED_ARGV = ['plan', '--collection', 'c.json', '--records', 'out/screened.jsonl'];
/** A screened file for a collection, with the screen's receipt carrying `prepare` when given. */
async function screenedFiles(collection: unknown, prepare?: unknown): Promise<Record<string, string>> {
  const records = JSON.stringify(await question(1));
  const receipt = JSON.parse(await screenReceipt(records));
  if (prepare !== undefined) receipt.prepare = prepare;
  return {
    'c.json': JSON.stringify(collection),
    'out/screened.jsonl': records,
    'out/screen.receipt.json': JSON.stringify(receipt),
  };
}

Deno.test('prepare block: a screened file whose recorded block differs from the collection file is refused, naming both', async () => {
  const f = await screenedFiles(REG_COLLECTION, {
    maxChunks: 800,
    dropInvalidCitationDates: true,
    requireTextIdentity: true,
  });
  const err = await assertRejects(() => main(SCREENED_ARGV, deps(f).d), Error, 'prepare_mismatch');
  assertStringIncludes(err.message, '"maxChunks":800');
  assertStringIncludes(err.message, '"maxChunks":700');
});

Deno.test('prepare block: the same block is accepted, in any key order and whatever patches or corrigenda the file carries', async () => {
  const f = await screenedFiles(REG_COLLECTION, {
    requireTextIdentity: true,
    dropInvalidCitationDates: true,
    maxChunks: 700,
  });
  assertEquals(await main(SCREENED_ARGV, deps(f).d), 0);
  const withPatches = await screenedFiles({ ...REG_COLLECTION, prepare: { ...REG_COLLECTION.prepare, patches: {} } }, {
    maxChunks: 700,
    dropInvalidCitationDates: true,
    requireTextIdentity: true,
  });
  assertEquals(await main(SCREENED_ARGV, deps(withPatches).d), 0);
});

Deno.test('prepare block: no recorded block is refused for a collection whose screen uses prepare, and accepted for one that does not', async () => {
  const old = await screenedFiles(REG_COLLECTION);
  await assertRejects(() => main(SCREENED_ARGV, deps(old).d), Error, 'prepare_mismatch');
  const bills = await screenedFiles(COLLECTION);
  assertEquals(await main(SCREENED_ARGV, deps(bills).d), 0);
});

Deno.test('prepare block: split carries the recorded block into each part, and a part with a different block is refused', async () => {
  const block = { maxChunks: 800 };
  const records = [1, 2, 3].map((n) => JSON.stringify({ n })).join('\n') + '\n';
  const text = (await Promise.all([1, 2, 3].map(async (n) => JSON.stringify(await question(n))))).join('\n') + '\n';
  const receipt = JSON.parse(await screenReceipt(text));
  receipt.prepare = block;
  const g = {
    'c.json': JSON.stringify(REG_COLLECTION),
    'out/screened.jsonl': text,
    'out/screen.receipt.json': JSON.stringify(receipt),
  };
  const x = deps(g);
  assertEquals(await main(['split', '--records', 'out/screened.jsonl', '--lines', '2', '--out', '/var/parts'], x.d), 0);
  const partReceipt = JSON.parse(x.written.get('/var/parts/part-000.jsonl.receipt.json')!);
  assertEquals(partReceipt.prepare, block);
  void records;
  const part = {
    'c.json': g['c.json'],
    'part-000.jsonl': x.written.get('/var/parts/part-000.jsonl')!,
    'part-000.jsonl.receipt.json': x.written.get('/var/parts/part-000.jsonl.receipt.json')!,
  };
  await assertRejects(
    () => main(['plan', '--collection', 'c.json', '--records', 'part-000.jsonl'], deps(part).d),
    Error,
    'prepare_mismatch',
  );
  // A part of a file with no recorded block carries none.
  const plain = deps({ ...g, 'out/screen.receipt.json': await screenReceipt(text) });
  await main(['split', '--records', 'out/screened.jsonl', '--lines', '2', '--out', '/var/parts'], plain.d);
  assertEquals('prepare' in JSON.parse(plain.written.get('/var/parts/part-000.jsonl.receipt.json')!), false);
});

// F285: the partition list a run is judged against is the database's, not the collection file's.
const OVER = { ...COLLECTION, limits: { ...COLLECTION.limits, chunksNow: { [QUESTIONS]: 100_000 } } };
const RUN = ['run', '--collection', 'c.json', '--records', 'r.jsonl', '--receipts', '/var/receipts'];

Deno.test('run: a feature with no partition in the database is refused past 100,000 chunks, naming the remedy', async () => {
  const records = JSON.stringify(await question(1));
  // The file claims a partition the database does not have: the database wins.
  const claimed = { ...OVER, limits: { ...OVER.limits, partitioned: [QUESTIONS] } };
  const { d, lines, db } = deps(await files(claimed, records));
  db.partitions = ['Some Other Feature'];
  assertEquals(await main(RUN, d), 1);
  const refusal = lines.find((l) => l.startsWith('plan refused'))!;
  assertStringIncludes(refusal, 'unpartitioned_feature_over_100k');
  assertStringIncludes(refusal, 'create_document_chunks_partition');
  assertEquals(db.calls.filter((c) => c.method === 'register').length, 0);
  assertEquals(db.calls.filter((c) => c.method === 'open').length, 0);
});

Deno.test('run: a feature with a partition of its own in the database is never refused by the 100,000 rule', async () => {
  const records = JSON.stringify(await question(1));
  const { d, lines, db } = deps(await files(OVER, records));
  db.partitions = [QUESTIONS];
  assertEquals(await main(RUN, d), 0, lines.join('\n'));
});

Deno.test('plan: stays offline and judges by the collection file', async () => {
  const records = JSON.stringify(await question(1));
  const { d, db } = deps(await files(OVER, records));
  assertEquals(await main(plan1, d), 1);
  assertEquals(db.calls.length, 0);
});

// F356: acceptance that cannot be made says why, and can be made again for a batch that is already indexed.
Deno.test('F356 run: an acceptance connection that fails puts its message in the output and in the acceptance file', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r)).join('\n');
  const broken: AcceptDb = {
    ...acceptStub(true),
    sample: () => Promise.reject(new Error('server closed the connection unexpectedly')),
  };
  const { d, lines, written } = deps(await files(AUTO, records), { acceptDb: () => broken });
  assertEquals(await main([...runArgs, '--accept-service', 'nter-admin'], d), 1, lines.join('\n'));
  assert(lines.some((l) => l.includes('server closed the connection unexpectedly')), lines.join('\n'));
  const file = [...written].find(([p]) => p.includes('/accept-error-'));
  assert(file, 'no reason file');
  assert(![...written.keys()].some((p) => p.includes('/acceptance-')), 'a reason-only file is not named as a report');
  assertStringIncludes(file[1], 'server closed the connection unexpectedly');
  assert([...written.keys()].some((p) => p.includes('/receipt-')), 'the receipt is there too');
});

Deno.test('F356 run: running again on a batch that is indexed but not accepted accepts it without loading again', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r)).join('\n');
  let up = false;
  const flaky: AcceptDb = {
    ...acceptStub(true),
    sample: (...a) => up ? acceptStub(true).sample(...a) : Promise.reject(new Error('laptop slept')),
  };
  const { d, lines, written, db } = deps(await files(AUTO, records), { acceptDb: () => flaky });
  assertEquals(await main([...runArgs, '--accept-service', 'nter-admin'], d), 1, lines.join('\n'));
  const registers = db.calls.filter((c) => c.method === 'register').length;
  assert(registers > 0);
  up = true;
  lines.length = 0;
  assertEquals(await main([...runArgs, '--accept-service', 'nter-admin'], d), 0, lines.join('\n'));
  assertEquals(db.calls.filter((c) => c.method === 'register').length, registers, 'nothing was loaded again');
  assert(lines.some((l) => l.includes('acceptance') && l.includes('passed')), lines.join('\n'));
  // the first run's reason file and the second run's report: one file per attempt, none overwritten
  assertEquals([...written.keys()].filter((p) => p.includes('/accept-error-')).length, 1);
  assertEquals([...written.keys()].filter((p) => p.includes('/acceptance-')).length, 1);
});

Deno.test('F356 run: two acceptance reports of one batch get different names, so a second acceptance can be written', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r)).join('\n');
  const { d, lines, written } = deps(await files(AUTO, records), { acceptDb: () => acceptStub(false) });
  assertEquals(await main([...runArgs, '--accept-service', 'nter-admin'], d), 1, lines.join('\n'));
  assertEquals(await main([...runArgs, '--accept-service', 'nter-admin'], d), 1, lines.join('\n'));
  assertEquals([...written.keys()].filter((p) => p.includes('/acceptance-')).length, 2);
});

Deno.test('F356 run: with two batches, a first that fails acceptance stops the run and the output names the reason', async () => {
  const pack = (await Promise.all(Array.from({ length: 10_001 }, (_, i) => question(i + 1))))
    .map((r) => JSON.stringify(r)).join('\n');
  const broken: AcceptDb = { ...acceptStub(true), sample: () => Promise.reject(new Error('socket reset by sleep')) };
  const { d, lines } = deps(await files(AUTO, pack), { acceptDb: () => broken });
  await main([...runArgs, '--accept-service', 'nter-admin'], d);
  assert(lines.some((l) => l.includes('awaiting_acceptance')), lines.join('\n'));
  assert(lines.some((l) => l.includes('socket reset by sleep')), lines.join('\n'));
});

// F394: register and leave, accept later.
const REG_ONLY = [...runArgs, '--register-only'];

Deno.test('F394 parseArgs: --register-only is a switch of run only, and never with an acceptance option', () => {
  const c = parseArgs(REG_ONLY);
  assertEquals(c.cmd === 'run' && c.registerOnly, true);
  assertEquals(
    parseArgs(runArgs).cmd === 'run' && (parseArgs(runArgs) as { registerOnly: boolean }).registerOnly,
    false,
  );
  assertThrows(
    () => parseArgs([...REG_ONLY, '--accept-service', 'nter-admin']),
    Error,
    '--register-only does not take',
  );
  assertThrows(() => parseArgs([...REG_ONLY, '--accepted', H]), Error, '--register-only does not take');
  assertThrows(() => parseArgs([...REG_ONLY, '--register-only']), Error, 'twice');
  assertThrows(() => parseArgs(['plan', '--collection', 'c', '--records', 'r', '--register-only']), Error, 'unknown');
  assertThrows(() => parseArgs(['status', '--batch', 'b', '--all']), Error, 'unknown');
});

Deno.test('F394 parseArgs: accept takes a service and exactly one of --batch and --all', () => {
  const base = ['accept', '--collection', 'c.json', '--receipts', '/var/receipts', '--accept-service', 'nter-admin'];
  assertEquals(parseArgs([...base, '--all']), {
    cmd: 'accept',
    collection: 'c.json',
    receipts: '/var/receipts',
    acceptService: 'nter-admin',
    psql: 'psql',
    batch: null,
    all: true,
  });
  const one = parseArgs([...base, '--batch', '2537b346-0000-4000-8000-000000000000']);
  assertEquals(one.cmd === 'accept' && one.batch, '2537b346-0000-4000-8000-000000000000');
  assertThrows(() => parseArgs(base), Error, '--batch <uuid> or --all');
  assertThrows(() => parseArgs([...base, '--all', '--batch', 'x']), Error, '--batch <uuid> or --all');
  assertThrows(() => parseArgs(base.slice(0, 5).concat(['--all'])), Error, '--accept-service is required');
  assertThrows(() => parseArgs([...base, '--all', '--records', 'r']), Error, 'unknown option');
  assertThrows(() => parseArgs([...base.slice(0, 6), 'host=x', '--all']), Error, 'bad --accept-service');
  assertThrows(() => parseArgs([...base, '--batch', 'a;b']), Error, 'bad --batch');
});

const RECEIPTS = '/var/receipts';
const ACCEPT_ALL = [
  'accept',
  '--collection',
  'c.json',
  '--receipts',
  RECEIPTS,
  '--accept-service',
  'nter-admin',
  '--all',
];
const MUTATING = ['open', 'addItems', 'seal', 'register', 'requeue', 'stop'];

/** A rig whose receipts directory can be listed and read back: what `accept` finds is what a run wrote. */
async function receiptsRig(records: string[], over: Partial<CliDeps> = {}) {
  const x = deps(await files(AUTO, records.join('\n')), over);
  const original = x.d.readText;
  x.d.readText = (p) => x.written.has(p) ? Promise.resolve(x.written.get(p)!) : original(p);
  x.d.listDir = () =>
    Promise.resolve(
      [...x.written.keys()].filter((k) => k.startsWith(`${RECEIPTS}/`)).map((k) => k.slice(RECEIPTS.length + 1)),
    );
  const batchCalls = () => x.db.calls.filter((c) => MUTATING.includes(c.method)).length;
  const reports = () => [...x.written].filter(([p]) => p.includes('/acceptance-')).map(([, b]) => JSON.parse(b));
  return { ...x, batchCalls, reports };
}

Deno.test('F394 run --register-only: no watch, confirm or acceptance; the receipt says register_only; exit 0', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r));
  const { d, lines, written, db } = await receiptsRig(records, {
    acceptDb: () => {
      throw new Error('acceptance connection opened');
    },
  });
  // The worker is idle while the client is here: nothing may wait for it.
  d.sleep = () => Promise.reject(new Error('the client waited'));
  assertEquals(await main(REG_ONLY, d), 0, lines.join('\n'));
  assertEquals(db.calls.filter((c) => c.method === 'status').length, 1, 'one status read, for the receipt');
  const receipt = [...written].find(([p]) => p.includes('/receipt-'));
  assert(receipt, 'no receipt');
  const body = JSON.parse(receipt[1]);
  assertEquals(body.register_only, true);
  assertEquals(body.state, 'registered');
  assertEquals(body.counts.indexed, 0);
  assert(![...written.keys()].some((p) => p.includes('/acceptance-') || p.includes('/accept-error-')));
  assert(lines.some((l) => l.includes('registered 1 batches; not watched or accepted')), lines.join('\n'));
});

Deno.test('F394 accept: a batch that is not indexed is refused and never sampled, then accepted once it is', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r));
  const x = await receiptsRig(records, {
    acceptDb: () => {
      throw new Error('acceptance connection opened');
    },
  });
  x.d.sleep = () => Promise.reject(new Error('the client waited'));
  assertEquals(await main(REG_ONLY, x.d), 0, x.lines.join('\n'));
  const before = x.batchCalls();
  const planned = x.db.calls.filter((c) => c.method === 'textHolders' || c.method === 'partitionedFeatures').length;
  x.lines.length = 0;
  assertEquals(await main(ACCEPT_ALL, x.d), 1, x.lines.join('\n'));
  assert(x.lines.some((l) => l.includes('not accepted, not sampled: state registered')), x.lines.join('\n'));
  assert(x.lines.some((l) => l.includes('unfinished jobs')), x.lines.join('\n'));
  assertEquals(x.reports().length, 0);
  // The worker finishes; the next accept moves on (the status read advances the fake) and samples.
  x.db.tick();
  x.d.acceptDb = () => acceptStub(true);
  x.lines.length = 0;
  assertEquals(await main(ACCEPT_ALL, x.d), 0, x.lines.join('\n'));
  assertEquals(x.reports().length, 1);
  assertEquals(x.reports()[0].ok, true);
  assertEquals(x.batchCalls(), before, 'accept made no open, add, seal, register, requeue or stop call');
  const planning = (m: string) => m === 'textHolders' || m === 'partitionedFeatures';
  assertEquals(x.db.calls.filter((c) => planning(c.method)).length, planned, 'accept did not go through the planner');
});

Deno.test('F394 accept: a batch with failed jobs is refused with the counts even if it reads as indexed', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r));
  const x = await receiptsRig(records, {
    acceptDb: () => {
      throw new Error('acceptance connection opened');
    },
  });
  assertEquals(await main(RUN, x.d), 0, x.lines.join('\n'));
  const status = x.db.status.bind(x.db);
  x.db.status = async (...a: Parameters<typeof status>) => {
    const s = await status(...a);
    return { ...s, jobs: { ...s.jobs, failed: 2, uncertain: 1 } };
  };
  x.lines.length = 0;
  assertEquals(await main(ACCEPT_ALL, x.d), 1, x.lines.join('\n'));
  assert(x.lines.some((l) => l.includes('2 failed jobs, 1 uncertain jobs')), x.lines.join('\n'));
});

Deno.test('F394 accept: a failing sample exits non-zero with its report, and a later pass is still accepted', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r));
  const x = await receiptsRig(records, { acceptDb: () => acceptStub(false) });
  assertEquals(await main(RUN, x.d), 0, x.lines.join('\n'));
  const before = x.batchCalls();
  x.lines.length = 0;
  assertEquals(await main(ACCEPT_ALL, x.d), 1, x.lines.join('\n'));
  assertEquals(x.reports().map((r) => r.ok), [false]);
  assert(x.lines.some((l) => l.includes('not accepted')), x.lines.join('\n'));
  // A failing report is not a pass: --all tries the batch again.
  x.d.acceptDb = () => acceptStub(true);
  assertEquals(await main(ACCEPT_ALL, x.d), 0, x.lines.join('\n'));
  assertEquals(x.reports().map((r) => r.ok), [false, true]);
  assertEquals(x.batchCalls(), before);
});

Deno.test('F394 accept --all: a batch that already has a passing report is skipped, with no status read or sample', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r));
  const x = await receiptsRig(records, { acceptDb: () => acceptStub(true) });
  assertEquals(await main([...runArgs, '--accept-service', 'nter-admin'], x.d), 0, x.lines.join('\n'));
  assertEquals(x.reports().map((r) => r.ok), [true]);
  x.d.acceptDb = () => {
    throw new Error('acceptance connection opened');
  };
  const reads = x.db.calls.filter((c) => c.method === 'status').length;
  x.lines.length = 0;
  assertEquals(await main(ACCEPT_ALL, x.d), 0, x.lines.join('\n'));
  assert(x.lines.some((l) => l.includes('already accepted; skipped')), x.lines.join('\n'));
  assertEquals(x.db.calls.filter((c) => c.method === 'status').length, reads);
  assertEquals(x.reports().length, 1, 'no second report');
});

Deno.test('F394 accept --batch: one batch by id, found in the receipts; no receipt for the collection is an error for --all', async () => {
  const records = [await question(1), await question(2)].map((r) => JSON.stringify(r));
  const x = await receiptsRig(records, { acceptDb: () => acceptStub(true) });
  await assertRejects(() => main(ACCEPT_ALL, x.d), Error, 'no receipt for national-v1.1-test');
  assertEquals(await main(RUN, x.d), 0, x.lines.join('\n'));
  const id = [...x.db.batches.keys()][0];
  const one = [
    'accept',
    '--collection',
    'c.json',
    '--receipts',
    RECEIPTS,
    '--accept-service',
    'nter-admin',
    '--batch',
    id,
  ];
  assertEquals(await main(one, x.d), 0, x.lines.join('\n'));
  assertEquals(x.reports().map((r) => r.batch_id), [id]);
  // The report is named from the receipt's manifest, like a run's.
  const manifest = JSON.parse([...x.written].find(([p]) => p.includes('/receipt-'))![1]).manifest_sha256 as string;
  assert([...x.written.keys()].some((p) => p.includes('/acceptance-') && p.endsWith(`-${manifest.slice(0, 16)}.json`)));
});

Deno.test('F394 accept: needs the collection’s acceptance block before any database call', async () => {
  const plain = deps(await files(COLLECTION, JSON.stringify(await question(1))));
  await assertRejects(() => main(ACCEPT_ALL, plain.d), Error, 'acceptance block');
  assertEquals(plain.db.calls.length, 0);
});

const oneAccept = (id: string) => [
  'accept',
  '--collection',
  'c.json',
  '--receipts',
  RECEIPTS,
  '--accept-service',
  'nter-admin',
  '--batch',
  id,
];
const twoRecords = async () => [await question(1), await question(2)].map((r) => JSON.stringify(r));

Deno.test('F394 accept --batch: refused, with no status read or sample, when no receipt names the batch for this collection', async () => {
  const x = await receiptsRig(await twoRecords(), {
    acceptDb: () => {
      throw new Error('acceptance connection opened');
    },
  });
  // No receipt at all.
  await assertRejects(() => main(oneAccept('batch-1'), x.d), Error, 'no receipt');
  assertEquals(await main(RUN, x.d), 0, x.lines.join('\n'));
  // A receipt that names the batch, but for another collection.
  x.written.set(
    `${RECEIPTS}/receipt-other.json`,
    JSON.stringify({ collection: 'some-other-collection', batch_id: 'batch-77', manifest_sha256: H }),
  );
  const reads = x.db.calls.filter((c) => c.method === 'status').length;
  await assertRejects(() => main(oneAccept('batch-77'), x.d), Error, 'no receipt');
  assertEquals(x.db.calls.filter((c) => c.method === 'status').length, reads, 'no status read');
  assertEquals(x.reports().length, 0);
});

Deno.test('F394 accept: an unreadable receipt or report is named and fails the run, while the other batches are still accepted', async () => {
  const x = await receiptsRig(await twoRecords(), { acceptDb: () => acceptStub(true) });
  assertEquals(await main(RUN, x.d), 0, x.lines.join('\n'));
  const good = JSON.parse([...x.written].find(([p]) => p.includes('/receipt-'))![1]);
  x.written.set(`${RECEIPTS}/receipt-truncated.json`, '{"collection": "national-v1.1-te');
  x.lines.length = 0;
  assertEquals(await main(ACCEPT_ALL, x.d), 1, x.lines.join('\n'));
  assert(x.lines.some((l) => l.includes('receipt-truncated.json')), x.lines.join('\n'));
  assertEquals(x.reports().map((r) => r.batch_id), [good.batch_id], 'the readable batch was still accepted');
  // The same for a report that cannot be read.
  x.written.delete(`${RECEIPTS}/receipt-truncated.json`);
  x.written.set(`${RECEIPTS}/acceptance-truncated.json`, '{"ok": tr');
  x.lines.length = 0;
  assertEquals(await main(ACCEPT_ALL, x.d), 1, x.lines.join('\n'));
  assert(x.lines.some((l) => l.includes('acceptance-truncated.json')), x.lines.join('\n'));
});

Deno.test('F394 accept --all: a report counts as a pass only with ok, no failures and a sample', async () => {
  const records = await twoRecords();
  const cases: Array<[string, (id: string) => Rec, boolean]> = [
    ['no sample', (id) => ({ batch_id: id, ok: true, failures: [], sampled: 0 }), false],
    ['failures listed', (id) => ({ batch_id: id, ok: true, failures: [{ check: 'x' }], sampled: 5 }), false],
    ['failures missing', (id) => ({ batch_id: id, ok: true, sampled: 5 }), false],
    ['not ok', (id) => ({ batch_id: id, ok: false, failures: [], sampled: 5 }), false],
    ['a real pass', (id) => ({ batch_id: id, ok: true, failures: [], sampled: 5 }), true],
  ];
  for (const [name, body, skips] of cases) {
    const x = await receiptsRig(records, { acceptDb: () => acceptStub(true) });
    assertEquals(await main(RUN, x.d), 0, x.lines.join('\n'));
    x.written.set(`${RECEIPTS}/acceptance-fake.json`, JSON.stringify(body([...x.db.batches.keys()][0])));
    x.lines.length = 0;
    assertEquals(await main(ACCEPT_ALL, x.d), 0, `${name}: ${x.lines.join('\n')}`);
    assertEquals(x.lines.some((l) => l.includes('already accepted')), skips, name);
    assertEquals(x.reports().length, skips ? 1 : 2, name); // the planted file, plus a new report unless it was skipped
  }
});

Deno.test('F394 accept: an acceptance database that throws leaves the batch not accepted and the exit non-zero', async () => {
  const broken: AcceptDb = { ...acceptStub(true), sample: () => Promise.reject(new Error('connection reset')) };
  const x = await receiptsRig(await twoRecords(), { acceptDb: () => broken });
  assertEquals(await main(RUN, x.d), 0, x.lines.join('\n'));
  x.lines.length = 0;
  assertEquals(await main(ACCEPT_ALL, x.d), 1, x.lines.join('\n'));
  assert(x.lines.some((l) => l.includes('not accepted') && l.includes('connection reset')), x.lines.join('\n'));
  assertEquals(x.reports().length, 0);
});

Deno.test('F394 accept --all: another collection’s receipt in the same directory is ignored', async () => {
  const x = await receiptsRig(await twoRecords(), { acceptDb: () => acceptStub(true) });
  assertEquals(await main(RUN, x.d), 0, x.lines.join('\n'));
  x.written.set(
    `${RECEIPTS}/receipt-other.json`,
    JSON.stringify({ collection: 'some-other-collection', batch_id: 'batch-77', manifest_sha256: H }),
  );
  x.lines.length = 0;
  assertEquals(await main(ACCEPT_ALL, x.d), 0, x.lines.join('\n'));
  assert(!x.db.calls.some((c) => c.method === 'status' && c.args[0] === 'batch-77'));
  assertEquals(x.reports().length, 1);
});

Deno.test('F394 run --register-only: a registration-time stop exits 1, like the same run without the option', async () => {
  const records = await twoRecords();
  const key = JSON.parse(records[0]).source_key as string;
  const go = async (argv: string[]) => {
    const x = await receiptsRig(records);
    x.db.refuseReal.set(key, 'house_conflict');
    const code = await main(argv, x.d);
    const rc = JSON.parse([...x.written].find(([p]) => p.includes('/receipt-'))![1]);
    return { code, rc, lines: x.lines };
  };
  const plain = await go(RUN);
  const only = await go(REG_ONLY);
  assertEquals(plain.code, 1, plain.lines.join('\n'));
  assertEquals(only.code, 1, only.lines.join('\n'));
  assertEquals(only.rc.stop, plain.rc.stop);
  assertEquals(only.rc.stop.reason, 'registration_disagreement');
  for (const rc of [plain.rc, only.rc]) {
    delete rc.run_id;
    delete rc.register_only;
  }
  assertEquals(only.rc, plain.rc);
});
