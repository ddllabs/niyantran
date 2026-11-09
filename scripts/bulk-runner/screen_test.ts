import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { join } from 'jsr:@std/path@1';
import { createHash } from 'node:crypto';
import {
  checkScreenBlock,
  main,
  parseArgs,
  readInput,
  rulesSha256,
  type RunOptions,
  runScreen,
  type ScreenDeps,
  validateScreen,
} from './screen.ts';
import { SCREENS } from './screens/index.ts';
import { LIMITS } from './fixtures.ts';
import { type Check, type Finding, type LiveReader, REVIEW_CHECKS, type Screen } from './screen_types.ts';
import type { Rec } from './prepare.ts';

const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const HEX_A = 'a'.repeat(64);
const SECRET = 'SECRET-RECORD-TEXT-9f3b';

const rec = (key: string, text = `text of ${key} ${SECRET}`, extra: Rec = {}): Rec => ({
  schema: 'nter.citation_pack/1.1',
  source_key: key,
  title: `Title ${key}`,
  text,
  content_sha256: sha(text),
  ...extra,
});

const opts = (over: Partial<RunOptions> = {}): RunOptions => ({
  packageId: 'National/v9/documents/x.jsonl.gz#' + HEX_A,
  fileSha256: 'b'.repeat(64),
  decisionId: 'decision-1',
  rulesSha256: 'c'.repeat(64),
  noLive: false,
  noPages: false,
  ...over,
});

const passing = (name: string, covers: Check['covers'], extra: Partial<Check> = {}): Check => ({
  name,
  covers,
  one: () => Promise.resolve([]),
  ...extra,
});
/** A valid screen: one check per review check unless `checks` is given. */
const screenOf = (checks?: Check[]): Screen => ({
  collection: 'test',
  mappingVersion: 'test-screen-v1',
  rulesFiles: ['rules/a.ts'],
  checks: checks ?? REVIEW_CHECKS.map((c) => passing(`c_${c}`, [c])),
});
const noLive: LiveReader = {
  documents: () => Promise.reject(new Error('unexpected live read')),
  deskRows: () => Promise.reject(new Error('unexpected live read')),
};
const ctx = (settings: Rec = {}) => ({ live: noLive, settings });
const finding = (reason: string, detail?: string): Finding => ({ check: 'ignored', covers: [], reason, detail });

// ---- the screen definition ----

Deno.test('validateScreen: a screen that leaves any one of the five review checks uncovered is refused', () => {
  for (const missing of REVIEW_CHECKS) {
    const checks = REVIEW_CHECKS.filter((c) => c !== missing).map((c) => passing(`c_${c}`, [c]));
    assertThrows(() => validateScreen(screenOf(checks)), Error, missing);
  }
  validateScreen(screenOf());
});

Deno.test('validateScreen: a check implements exactly one of one and all', () => {
  const both = passing('b', ['identity'], { all: () => Promise.resolve(new Map()) });
  const neither: Check = { name: 'n', covers: ['identity'] };
  for (const bad of [both, neither]) {
    assertThrows(() => validateScreen(screenOf([...screenOf().checks.slice(1), bad])), Error, 'exactly one');
  }
});

Deno.test('validateScreen: names are unique, covers are real review checks, needs is known', () => {
  const base = screenOf().checks;
  assertThrows(() => validateScreen(screenOf([...base, passing('c_identity', ['identity'])])), Error, 'twice');
  assertThrows(() => validateScreen(screenOf([...base, passing('x', ['nonsense' as never])])), Error, 'cover');
  assertThrows(() => validateScreen(screenOf([...base, passing('x', [])])), Error, 'cover');
  assertThrows(() => validateScreen(screenOf([...base, passing('screen', ['identity'])])), Error, 'name');
  assertThrows(
    () => validateScreen(screenOf([...base, passing('x', ['identity'], { needs: 'tea' as never })])),
    Error,
    'needs',
  );
});

// ---- running the checks ----

Deno.test('runScreen: a record every check passed is returned with its fields unchanged plus text_sha256 and the review', async () => {
  const r = rec('k1', 'héllo नमस्ते', { extra: { nested: [1, 2] } });
  const out = await runScreen(screenOf(), [r], ctx(), opts());
  assertEquals(out.holds, []);
  assertEquals(out.screened.length, 1);
  const { text_sha256, review, ...rest } = out.screened[0];
  assertEquals(rest, r);
  assertEquals(text_sha256, sha('héllo नमस्ते'));
  assertEquals(review, {
    status: 'eligible',
    text_sha256: sha('héllo नमस्ते'),
    source_key: 'k1',
    rules_sha256: 'c'.repeat(64),
    package_id: 'National/v9/documents/x.jsonl.gz#' + HEX_A,
    mapping_version: 'test-screen-v1',
    decision_id: 'decision-1',
    file_sha256: 'b'.repeat(64),
    checks: { identity: true, completeness: true, sensitivity: true, dedupe: true, rights: true },
  });
});

Deno.test('runScreen: one finding holds the record, with all its findings and no review', async () => {
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights'
      ? { ...c, one: (r: Rec) => Promise.resolve(r.source_key === 'bad' ? [finding('r1', 'd1'), finding('r2')] : []) }
      : c
  );
  const out = await runScreen(screenOf(checks), [rec('ok'), rec('bad')], ctx(), opts());
  assertEquals(out.screened.map((r) => r.source_key), ['ok']);
  assertEquals(out.holds.length, 1);
  assertEquals(out.holds[0].source_key, 'bad');
  assertEquals(out.holds[0].reasons, ['r1', 'r2']);
  assertEquals(out.holds[0].findings, [
    { check: 'c_rights', covers: ['rights'], reason: 'r1', detail: 'd1' },
    { check: 'c_rights', covers: ['rights'], reason: 'r2' },
  ]);
});

Deno.test('runScreen: every check runs on every record, even after an earlier one found something', async () => {
  const calls: string[] = [];
  const checks = REVIEW_CHECKS.map((c) =>
    passing(`c_${c}`, [c], {
      one: (r: Rec) => {
        calls.push(`${c_(r)}:${c}`);
        return Promise.resolve(c === 'identity' ? [finding('first')] : []);
      },
    })
  );
  const c_ = (r: Rec) => String(r.source_key);
  const out = await runScreen(screenOf(checks), [rec('a'), rec('b')], ctx(), opts());
  assertEquals(out.holds.length, 2);
  assertEquals(calls.length, 10);
});

Deno.test('runScreen: a check that throws is a check_error finding, never a pass, and does not stop the others', async () => {
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_dedupe'
      ? { ...c, one: (r: Rec) => r.source_key === 'boom' ? Promise.reject(new TypeError('x')) : Promise.resolve([]) }
      : c
  );
  const out = await runScreen(screenOf(checks), [rec('boom'), rec('fine')], ctx(), opts());
  assertEquals(out.screened.map((r) => r.source_key), ['fine']);
  assertEquals(out.holds[0].reasons, ['check_error']);
  assertEquals(out.holds[0].findings[0].check, 'c_dedupe');
  assertEquals(out.holds[0].findings[0].covers, ['dedupe']);
});

Deno.test('runScreen: a check that returns something other than a list of findings is a check_error', async () => {
  for (const bad of [undefined, null, 'ok', {}, [{}], [{ reason: 5 }]]) {
    const checks = screenOf().checks.map((c) =>
      c.name === 'c_rights' ? { ...c, one: () => Promise.resolve(bad as never) } : c
    );
    const out = await runScreen(screenOf(checks), [rec('a')], ctx(), opts());
    assertEquals(out.screened, [], JSON.stringify(bad));
    assertEquals(out.holds[0].reasons, ['check_error']);
  }
});

Deno.test('runScreen: a whole-set check gives findings by source_key; a key it leaves out passed', async () => {
  const dup = passing('dups', ['dedupe'], {
    one: undefined,
    all: (records: Rec[]) => {
      assertEquals(records.length, 3);
      return Promise.resolve(new Map([['b', [finding('duplicate_text', 'same as a')]]]));
    },
  });
  const others = REVIEW_CHECKS.filter((c) => c !== 'dedupe').map((c) => passing(`c_${c}`, [c]));
  const out = await runScreen(screenOf([...others, dup]), [rec('a'), rec('b'), rec('c')], ctx(), opts());
  assertEquals(out.screened.map((r) => r.source_key), ['a', 'c']);
  assertEquals(out.holds[0].findings[0], {
    check: 'dups',
    covers: ['dedupe'],
    reason: 'duplicate_text',
    detail: 'same as a',
  });
});

Deno.test('runScreen: a whole-set check that throws holds every record; one that names a key not in the set aborts', async () => {
  const mk = (all: Check['all']) =>
    screenOf([...REVIEW_CHECKS.filter((c) => c !== 'dedupe').map((c) => passing(`c_${c}`, [c])), {
      name: 'dups',
      covers: ['dedupe'],
      all,
    }]);
  const out = await runScreen(mk(() => Promise.reject(new Error('x'))), [rec('a'), rec('b')], ctx(), opts());
  assertEquals(out.screened, []);
  assertEquals(out.holds.map((h) => h.reasons), [['check_error'], ['check_error']]);
  await assertRejects(
    () => runScreen(mk(() => Promise.resolve(new Map([['zzz', [finding('x')]]]))), [rec('a')], ctx(), opts()),
    Error,
    'not in the set',
  );
});

Deno.test('runScreen: --no-live does not run live checks and holds every record screen_incomplete', async () => {
  let ran = 0;
  const checks = [
    ...REVIEW_CHECKS.filter((c) => c !== 'dedupe').map((c) => passing(`c_${c}`, [c])),
    passing('already_live', ['dedupe'], { needs: 'live', one: () => (ran++, Promise.resolve([])) }),
  ];
  const off = await runScreen(screenOf(checks), [rec('a'), rec('b')], ctx(), opts({ noLive: true }));
  assertEquals(ran, 0);
  assertEquals(off.screened, []);
  assertEquals(off.holds.map((h) => h.reasons), [['screen_incomplete'], ['screen_incomplete']]);
  const on = await runScreen(screenOf(checks), [rec('a'), rec('b')], ctx(), opts());
  assertEquals(ran, 2);
  assertEquals(on.screened.length, 2);
});

Deno.test('runScreen: --no-pages does not run page checks and holds every record screen_incomplete', async () => {
  let ran = 0;
  const checks = [
    ...REVIEW_CHECKS.filter((c) => c !== 'completeness').map((c) => passing(`c_${c}`, [c])),
    passing('pages', ['completeness'], { needs: 'pages', one: () => (ran++, Promise.resolve([])) }),
  ];
  const off = await runScreen(screenOf(checks), [rec('a')], ctx(), opts({ noPages: true }));
  assertEquals(ran, 0);
  assertEquals(off.holds[0].reasons, ['screen_incomplete']);
});

Deno.test('runScreen: --no-live holds every record even when the screen has no live check', async () => {
  const out = await runScreen(screenOf(), [rec('a')], ctx(), opts({ noLive: true }));
  assertEquals(out.screened, []);
  assertEquals(out.holds[0].reasons, ['screen_incomplete']);
});

Deno.test('runScreen: text_sha256 is computed from text; a content_sha256 that disagrees holds the record', async () => {
  const bad = { ...rec('bad'), content_sha256: sha('something else') };
  const noContentHash = rec('plain');
  delete noContentHash.content_sha256;
  const out = await runScreen(screenOf(), [bad, noContentHash], ctx(), opts());
  assertEquals(out.holds.map((h) => [h.source_key, h.reasons]), [['bad', ['content_sha256_mismatch']]]);
  assertEquals(out.screened[0].text_sha256, sha(String(noContentHash.text)));
});

Deno.test('runScreen: a record that brings its own review or a wrong text_sha256 is held, not overwritten', async () => {
  const out = await runScreen(
    screenOf(),
    [rec('r', undefined, { review: { status: 'eligible' } }), rec('t', undefined, { text_sha256: HEX_A }), rec('ok')],
    ctx(),
    opts(),
  );
  assertEquals(out.holds.map((h) => h.reasons), [['record_has_review'], ['text_sha256_mismatch']]);
  assertEquals(out.screened.map((r) => r.source_key), ['ok']);
});

Deno.test('runScreen: no text, a lone surrogate, a missing or repeated source_key and a non-object are held', async () => {
  const out = await runScreen(
    screenOf(),
    [
      rec('empty', ''),
      { ...rec('nt'), text: 5 },
      rec('lone', 'a\ud800b'),
      { ...rec('x'), source_key: '' },
      rec('dup'),
      rec('dup'),
      null as unknown as Rec,
      rec('ok'),
    ],
    ctx(),
    opts(),
  );
  assertEquals(out.holds.map((h) => h.reasons), [
    ['no_text'],
    ['no_text'],
    ['text_not_well_formed'],
    ['no_source_key'],
    ['duplicate_source_key'],
    ['duplicate_source_key'],
    ['not_an_object'],
  ]);
  assertEquals(out.screened.map((r) => r.source_key), ['ok']);
});

Deno.test('runScreen: holds never contain record text, even when a check throws an error that quotes it', async () => {
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights' ? { ...c, one: (r: Rec) => Promise.reject(new Error(`cannot read ${String(r.text)}`)) } : c
  );
  const out = await runScreen(screenOf(checks), [rec('a')], ctx(), opts());
  assert(!JSON.stringify(out.holds).includes(SECRET));
});

Deno.test('runScreen: the check gets the collection settings and the live reader it was given', async () => {
  let seen: unknown;
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights'
      ? { ...c, one: (_: Rec, x: { live: LiveReader; settings: Rec }) => (seen = x, Promise.resolve([])) }
      : c
  );
  const live: LiveReader = { ...noLive };
  await runScreen(screenOf(checks), [rec('a')], { live, settings: { licences: ['x'] } }, opts());
  assertEquals((seen as { settings: Rec }).settings, { licences: ['x'] });
  assert((seen as { live: LiveReader }).live === live);
});

Deno.test('runScreen: an invalid screen or bad options are refused before any check runs', async () => {
  await assertRejects(() => runScreen(screenOf([]), [rec('a')], ctx(), opts()), Error, 'invalid screen');
  await assertRejects(() => runScreen(screenOf(), [rec('a')], ctx(), opts({ rulesSha256: 'nope' })), Error, 'sha256');
  await assertRejects(() => runScreen(screenOf(), [rec('a')], ctx(), opts({ decisionId: '' })), Error, 'decisionId');
});

// ---- project ----

const withProject = (project: Screen['project'], checks?: Check[]): Screen => ({ ...screenOf(checks), project });

Deno.test('project: adds fields to passing records; the review binds the projected record', async () => {
  const out = await runScreen(
    withProject((r) => ({ ...r, document_key: `bill:${String(r.source_key)}`, document_role: 'as_introduced' })),
    [rec('k1', 'some text', { citation: { a: [1, { b: 2 }] } })],
    ctx(),
    opts(),
  );
  assertEquals(out.holds, []);
  const got = out.screened[0];
  assertEquals([got.document_key, got.document_role], ['bill:k1', 'as_introduced']);
  assertEquals((got.review as Rec).source_key, 'k1');
  assertEquals((got.review as Rec).text_sha256, sha('some text'));
  assertEquals(got.text_sha256, sha('some text'));
});

Deno.test('project: never called for a held record, and absent project adds nothing', async () => {
  const seen: string[] = [];
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights' ? { ...c, one: (r: Rec) => Promise.resolve(r.source_key === 'bad' ? [finding('x')] : []) } : c
  );
  const out = await runScreen(
    withProject((r) => (seen.push(String(r.source_key)), { ...r, extra: 1 }), checks),
    [rec('ok'), rec('bad')],
    ctx(),
    opts(),
  );
  assertEquals(seen, ['ok']);
  assertEquals(out.holds.map((h) => h.source_key), ['bad']);
  const plain = await runScreen(screenOf(), [rec('ok')], ctx(), opts());
  assertEquals(Object.keys(plain.screened[0]).sort(), [...Object.keys(rec('ok')), 'review', 'text_sha256'].sort());
});

Deno.test('project: a projection that changes or removes a field, or throws, holds the record project_failed', async () => {
  const cases: Array<[string, Screen['project']]> = [
    ['changed top-level', (r) => ({ ...r, title: 'other' })],
    ['changed nested', (r) => ({ ...r, citation: { a: [1, { b: 3 }] } })],
    ['changed text', (r) => ({ ...r, text: String(r.text) + ' ' })],
    ['changed source_key', (r) => ({ ...r, source_key: 'other' })],
    ['removed', (r) => {
      const { title: _t, ...rest } = r;
      return rest;
    }],
    ['edits its argument', (r) => {
      r.title = 'edited';
      return { ...r, x: 1 };
    }],
    ['throws', () => {
      throw new Error(`boom ${SECRET}`);
    }],
    ['not an object', () => 5 as unknown as Rec],
    ['sets review', (r) => ({ ...r, review: { status: 'eligible' } })],
    ['sets text_sha256', (r) => ({ ...r, text_sha256: HEX_A })],
  ];
  for (const [name, project] of cases) {
    const out = await runScreen(
      withProject(project),
      [rec('a', 'text', { citation: { a: [1, { b: 2 }] } })],
      ctx(),
      opts(),
    );
    assertEquals(out.screened, [], name);
    assertEquals(out.holds[0].reasons, ['project_failed'], name);
    assertEquals(out.holds[0].findings[0].check, 'project', name);
    assertEquals(out.holds[0].findings[0].covers, ['identity'], name);
    assert(!JSON.stringify(out.holds).includes(SECRET), name);
  }
});

Deno.test('project: must be a function when given', async () => {
  await assertRejects(() => runScreen(withProject(5 as never), [rec('a')], ctx(), opts()), Error, 'project');
});

// ---- rules hash, arguments, collection block ----

Deno.test("rulesSha256: the sha256 of the files' bytes in order; order and content change it; a missing file is an error", async () => {
  const files: Record<string, string> = { 'a.ts': 'AAA', 'b.ts': 'BBB' };
  const read = (p: string) => {
    const name = p.split('/').pop()!;
    return name in files ? Promise.resolve(new TextEncoder().encode(files[name])) : Promise.reject(new Error('nope'));
  };
  assertEquals(await rulesSha256(['a.ts', 'b.ts'], '/r', read), sha('AAABBB'));
  assert(await rulesSha256(['b.ts', 'a.ts'], '/r', read) !== sha('AAABBB'));
  files['a.ts'] = 'AAX';
  assert(await rulesSha256(['a.ts', 'b.ts'], '/r', read) !== sha('AAABBB'));
  await assertRejects(() => rulesSha256(['a.ts', 'gone.ts'], '/r', read), Error, 'gone.ts');
  for (const bad of ['/etc/passwd', '../x.ts', 'a/../../x.ts', '']) {
    await assertRejects(() => rulesSha256([bad], '/r', read), Error, 'inside the repository');
  }
});

Deno.test('parseArgs: required options, switches, and no repeats or unknowns', () => {
  const base = ['--screen', 's', '--collection', 'c.json', '--records', 'r.jsonl', '--out', '/o'];
  assertEquals(parseArgs(base), {
    screen: 's',
    collection: 'c.json',
    records: 'r.jsonl',
    out: '/o',
    patches: null,
    noLive: false,
    noPages: false,
  });
  const all = parseArgs([...base, '--patches', 'p.jsonl', '--no-live', '--no-pages']);
  assertEquals([all.patches, all.noLive, all.noPages], ['p.jsonl', true, true]);
  for (const missing of ['--screen', '--collection', '--records', '--out']) {
    const i = base.indexOf(missing);
    assertThrows(() => parseArgs(base.filter((_, j) => j !== i && j !== i + 1)), Error, missing);
  }
  assertThrows(() => parseArgs([...base, '--no-live', '--no-live']), Error, 'twice');
  assertThrows(() => parseArgs([...base, '--out', '/p']), Error, 'twice');
  assertThrows(() => parseArgs([...base, '--bogus', 'x']), Error, 'unknown');
  assertThrows(() => parseArgs([...base, '--patches']), Error, 'needs a value');
});

Deno.test('checkScreenBlock: decisionId and settings are required, nothing else is allowed', () => {
  assertEquals(checkScreenBlock({ decisionId: 'd', settings: { a: 1 } }), { decisionId: 'd', settings: { a: 1 } });
  for (
    const bad of [
      undefined,
      null,
      [],
      {},
      { decisionId: 'd' },
      { settings: {} },
      { decisionId: '', settings: {} },
      { decisionId: 'd', settings: [] },
      { decisionId: 'd'.repeat(1001), settings: {} },
      { decisionId: 'd', settings: {}, x: 1 },
    ]
  ) {
    assertThrows(() => checkScreenBlock(bad), Error, 'screen');
  }
});

Deno.test('the registry holds the Bills screen under national-bills, with the page check, built without the network', async () => {
  assertEquals(Object.keys(SCREENS), ['national-bills']);
  const real = globalThis.fetch;
  let touched = 0;
  globalThis.fetch = (() => (touched++, Promise.reject(new Error('network touched')))) as typeof fetch;
  try {
    const screen = await SCREENS['national-bills']();
    validateScreen(screen);
    assertEquals(screen.collection, 'national-bills');
    const pages = screen.checks.filter((c) => c.name === 'text_per_page');
    assertEquals(pages.length, 1);
    assertEquals(pages[0].needs, 'pages');
    assertEquals(typeof screen.project, 'function');
    assertEquals(touched, 0, 'building the screen must not fetch anything');
  } finally {
    globalThis.fetch = real;
  }
});

// ---- the command, on real files in a scratch area ----

interface Area {
  root: string;
  repo: string;
  work: string;
  out: string;
}
async function withArea(fn: (a: Area) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: 'screen-test-' });
  try {
    const a: Area = { root, repo: join(root, 'repo'), work: join(root, 'work'), out: join(root, 'out') };
    for (const d of [a.repo, a.work]) await Deno.mkdir(d);
    await Deno.mkdir(join(a.repo, 'rules'));
    await Deno.writeTextFile(join(a.repo, 'rules/a.ts'), 'rule file');
    await collectionFile(a);
    await fn(a);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}
const areaTest = (name: string, fn: (a: Area) => Promise<void>) => Deno.test(name, () => withArea(fn));

/** A records file as the reader writes it, with its receipt. */
async function reader(a: Area, name: string, lines: string[], over: Rec = {}) {
  const path = join(a.work, name);
  const body = lines.map((l) => l + '\n').join('');
  await Deno.writeTextFile(path, body);
  const receipt = {
    pack: 'National/v9',
    entry: `documents/${name}.gz`,
    manifest_sha256: sha(`manifest-${name}`),
    lines_written: lines.length,
    output_sha256: sha(body),
    ...over,
  };
  await Deno.writeTextFile(`${path}.receipt.json`, JSON.stringify(receipt));
  return { path, receipt };
}
async function collectionFile(a: Area, over: Rec = {}) {
  const path = join(a.work, 'collection.json');
  await Deno.writeTextFile(
    path,
    JSON.stringify({
      collection: 'test',
      prepare: { maxChunks: 10 },
      limits: { ...LIMITS, chunksNow: {} },
      screen: { decisionId: 'decision-7', settings: { licences: ['x'] } },
      ...over,
    }),
  );
  return path;
}
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);
const listing = async (d: string) => (await exists(d)) ? [...Deno.readDirSync(d)].map((e) => e.name).sort() : [];

function depsFor(a: Area, screen: Screen = screenOf(), over: Partial<ScreenDeps> = {}) {
  const logs: string[] = [];
  const services: string[] = [];
  let t = Date.parse('2026-11-10T10:00:00Z');
  const deps: ScreenDeps = {
    screens: { test: () => Promise.resolve(screen) },
    live: (svc) => (services.push(svc), noLive),
    git: () => Promise.resolve({ commit: 'c0ffee'.repeat(6) + 'c0ff', dirty: false }),
    repoRoot: a.repo,
    log: (l) => logs.push(l),
    now: () => (t += 1000),
    ...over,
  };
  return { deps, logs, services };
}
const argv = (a: Area, records: string, ...more: string[]) => [
  '--screen',
  'test',
  '--collection',
  join(a.work, 'collection.json'),
  '--records',
  records,
  '--out',
  a.out,
  ...more,
];
const readJsonl = async (p: string) =>
  (await Deno.readTextFile(p)).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec);

areaTest(
  "main: writes screened.jsonl, holds.jsonl and the receipt; the review carries the reader receipt's identity",
  async (a) => {
    const r1 = rec('k1');
    const r2 = rec('k2');
    const f = await reader(a, 'bills.jsonl', [JSON.stringify(r1), JSON.stringify(r2)]);
    const checks = screenOf().checks.map((c) =>
      c.name === 'c_rights'
        ? { ...c, one: (r: Rec) => Promise.resolve(r.source_key === 'k2' ? [finding('licence_not_admitted')] : []) }
        : c
    );
    const { deps, logs } = depsFor(a, screenOf(checks));
    assertEquals(await main(argv(a, f.path), deps), 0);
    assertEquals(await listing(a.out), ['holds.jsonl', 'screen.receipt.json', 'screened.jsonl']);
    const screened = await readJsonl(join(a.out, 'screened.jsonl'));
    assertEquals(screened.length, 1);
    const review = screened[0].review as Rec;
    assertEquals(review.package_id, `National/v9/documents/bills.jsonl.gz#${sha('manifest-bills.jsonl')}`);
    assertEquals(review.file_sha256, f.receipt.output_sha256);
    assertEquals(review.decision_id, 'decision-7');
    assertEquals(review.rules_sha256, sha('rule file'));
    assertEquals(review.mapping_version, 'test-screen-v1');
    assertEquals(screened[0].text_sha256, sha(String(r1.text)));
    const holds = await readJsonl(join(a.out, 'holds.jsonl'));
    assertEquals(holds, [{
      source_key: 'k2',
      set: 'records',
      reasons: ['licence_not_admitted'],
      findings: [{ check: 'c_rights', covers: ['rights'], reason: 'licence_not_admitted' }],
    }]);
    const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
    assertEquals(receipt.collection, 'test');
    assertEquals(receipt.rules_sha256, sha('rule file'));
    assertEquals(receipt.records.receipt_sha256, sha(await Deno.readFile(`${f.path}.receipt.json`)));
    assertEquals(receipt.records.output_sha256, f.receipt.output_sha256);
    assertEquals(receipt.records.records_in, 2);
    assertEquals(receipt.records.records_out, 1);
    assertEquals(receipt.records.held_by_reason, { licence_not_admitted: 1 });
    assertEquals(receipt.patches, null);
    assertEquals(receipt.complete, true);
    assertEquals(receipt.screen_commit, 'c0ffee'.repeat(6) + 'c0ff');
    assertEquals(receipt.screen_dirty, false);
    assert(Date.parse(receipt.started_at) < Date.parse(receipt.finished_at));
    assertEquals(receipt.outputs.screened.sha256, sha(await Deno.readFile(join(a.out, 'screened.jsonl'))));
    assertEquals(receipt.outputs.holds.sha256, sha(await Deno.readFile(join(a.out, 'holds.jsonl'))));
    const everything = logs.join('\n') + JSON.stringify(receipt) +
      (await Deno.readTextFile(join(a.out, 'holds.jsonl')));
    assert(!everything.includes(SECRET), 'record text leaked into logs, holds or the receipt');
  },
);

areaTest(
  'main: the live reader is made for the nter-accept service and the collection settings reach the checks',
  async (a) => {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
    let settings: unknown;
    const checks = screenOf().checks.map((c) =>
      c.name === 'c_rights'
        ? { ...c, one: (_: Rec, x: { settings: Rec }) => (settings = x.settings, Promise.resolve([])) }
        : c
    );
    const { deps, services } = depsFor(a, screenOf(checks));
    await main(argv(a, f.path), deps);
    assertEquals(services, ['nter-accept']);
    assertEquals(settings, { licences: ['x'] });
  },
);

areaTest('main: a check that carries stats has them recorded in the receipt, counts and keys only', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  const stats = { fetched: 2, cached: 1, scans: ['k1'], url: 'https://example.test/secret.pdf', text: SECRET };
  const checks = [...screenOf().checks, passing('with_stats', ['rights'], { stats } as Partial<Check>)];
  const { deps } = depsFor(a, screenOf(checks));
  assertEquals(await main(argv(a, f.path), deps), 0);
  const raw = await Deno.readTextFile(join(a.out, 'screen.receipt.json'));
  assertEquals(JSON.parse(raw).checks_stats, { with_stats: { fetched: 2, cached: 1, scans: ['k1'] } });
  assert(!raw.includes(SECRET) && !raw.includes('example.test'), 'stats leaked more than counts and keys');
});

areaTest('main: a receipt has an empty checks_stats when no check carries stats', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  assertEquals(await main(argv(a, f.path), depsFor(a).deps), 0);
  const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
  assertEquals(receipt.checks_stats, {});
});

areaTest('main: patches are screened with their own receipt into screened-patches.jsonl', async (a) => {
  const f = await reader(a, 'bills.jsonl', [JSON.stringify(rec('k1'))]);
  const p = await reader(a, 'fixed.jsonl', [JSON.stringify(rec('k1', 'patched text'))]);
  const { deps } = depsFor(a);
  assertEquals(await main(argv(a, f.path, '--patches', p.path), deps), 0);
  assertEquals(await listing(a.out), [
    'holds.jsonl',
    'screen.receipt.json',
    'screened-patches.jsonl',
    'screened.jsonl',
  ]);
  const [patch] = await readJsonl(join(a.out, 'screened-patches.jsonl'));
  assertEquals(patch.text, 'patched text');
  const review = patch.review as Rec;
  assertEquals(review.package_id, `National/v9/documents/fixed.jsonl.gz#${sha('manifest-fixed.jsonl')}`);
  assertEquals(review.file_sha256, p.receipt.output_sha256);
  const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
  assertEquals(receipt.patches.output_sha256, p.receipt.output_sha256);
  assertEquals(receipt.outputs.screened_patches.lines, 1);
});

areaTest('main: a records file without its receipt is refused and nothing is written', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  await Deno.remove(`${f.path}.receipt.json`);
  await assertRejects(() => main(argv(a, f.path), depsFor(a).deps), Error, 'receipt');
  assertEquals(await listing(a.out), []);
});

areaTest("main: a records file that is not the receipt's output (hash) is refused", async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  await Deno.writeTextFile(f.path, JSON.stringify(rec('k1', 'edited')) + '\n');
  await assertRejects(() => main(argv(a, f.path), depsFor(a).deps), Error, 'sha256');
  assertEquals(await listing(a.out), []);
});

areaTest("main: a patches file that is not the receipt's output is refused, nothing written", async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  const p = await reader(a, 'p.jsonl', [JSON.stringify(rec('k1', 'patched'))]);
  await Deno.writeTextFile(p.path, JSON.stringify(rec('k1', 'tampered')) + '\n');
  await assertRejects(() => main(argv(a, f.path, '--patches', p.path), depsFor(a).deps), Error, 'patches');
  assertEquals(await listing(a.out), []);
});

areaTest('main: a receipt whose line count differs from the file is refused', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1')), JSON.stringify(rec('k2'))], { lines_written: 3 });
  await assertRejects(() => main(argv(a, f.path), depsFor(a).deps), Error, 'receipt says 3');
  assertEquals(await listing(a.out), []);
});

areaTest('main: a receipt that names no pack, entry or manifest is refused', async (a) => {
  for (const missing of ['pack', 'entry', 'manifest_sha256', 'output_sha256']) {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))], { [missing]: undefined });
    await assertRejects(() => readInput(f.path, 'records'), Error, 'receipt');
    await Deno.remove(f.path);
    await Deno.remove(`${f.path}.receipt.json`);
  }
});

areaTest('main: an empty run (the receipt says no lines) is refused', async (a) => {
  const f = await reader(a, 'b.jsonl', [], { lines_written: 0 });
  await assertRejects(() => main(argv(a, f.path), depsFor(a).deps), Error, 'empty run');
  assertEquals(await listing(a.out), []);
});

areaTest('main: a line that is not JSON is refused with its number and nothing is written', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1')), '{not json ' + SECRET]);
  const err = await assertRejects(() => main(argv(a, f.path), depsFor(a).deps), Error, 'line 2');
  assert(!String((err as Error).message).includes(SECRET));
  assertEquals(await listing(a.out), []);
});

areaTest(
  'readInput: long multi-byte lines across many read chunks come back whole and the hash is of the bytes',
  async (a) => {
    const text = 'नमस्ते é '.repeat(60_000); // about 1 MB on one line
    const lines = [JSON.stringify(rec('big', text)), JSON.stringify(rec('small'))];
    const f = await reader(a, 'big.jsonl', lines);
    const got = await readInput(f.path, 'records');
    assertEquals(got.records.length, 2);
    assertEquals(got.records[0].text, text);
    assertEquals(got.sha256, f.receipt.output_sha256);
  },
);

areaTest('readInput: a last line without a newline is read, and invalid UTF-8 is refused', async (a) => {
  const path = join(a.work, 'x.jsonl');
  const body = JSON.stringify(rec('k1')) + '\n' + JSON.stringify(rec('k2'));
  await Deno.writeTextFile(path, body);
  await Deno.writeTextFile(
    `${path}.receipt.json`,
    JSON.stringify({
      pack: 'National/v9',
      entry: 'documents/x.gz',
      manifest_sha256: HEX_A,
      lines_written: 2,
      output_sha256: sha(body),
    }),
  );
  assertEquals((await readInput(path, 'records')).records.length, 2);
  const bad = new Uint8Array([123, 34, 255, 34, 125, 10]);
  await Deno.writeFile(path + '2', bad);
  await Deno.writeTextFile(
    `${path}2.receipt.json`,
    JSON.stringify({
      pack: 'National/v9',
      entry: 'documents/x.gz',
      manifest_sha256: HEX_A,
      lines_written: 1,
      output_sha256: sha(bad),
    }),
  );
  await assertRejects(() => readInput(path + '2', 'records'), Error, 'UTF-8');
});

areaTest('main: --out inside the repository is refused', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  const inside = join(a.repo, 'screened');
  const args = (argv(a, f.path)).map((x) => x === a.out ? inside : x);
  await assertRejects(() => main(args, depsFor(a).deps), Error, 'outside the repository');
  assertEquals(await exists(inside), false);
});

areaTest('main: an --out that already holds an output is refused and nothing in it is changed', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  await Deno.mkdir(a.out);
  await Deno.writeTextFile(join(a.out, 'holds.jsonl'), 'precious');
  await assertRejects(() => main(argv(a, f.path), depsFor(a).deps), Error, 'already exists');
  assertEquals(await listing(a.out), ['holds.jsonl']);
  assertEquals(await Deno.readTextFile(join(a.out, 'holds.jsonl')), 'precious');
});

areaTest(
  'main: an unknown screen name, a screen for another collection, and a missing screen block are refused',
  async (a) => {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
    const base = argv(a, f.path);
    await assertRejects(
      () => main(base.map((x) => x === 'test' ? 'nope' : x), depsFor(a).deps),
      Error,
      'unknown screen',
    );
    await assertRejects(
      () => main(base, depsFor(a, { ...screenOf(), collection: 'other' }).deps),
      Error,
      'collection',
    );
    const noBlock = join(a.work, 'noscreen.json');
    await Deno.writeTextFile(
      noBlock,
      JSON.stringify({ collection: 'test', prepare: { maxChunks: 10 }, limits: { ...LIMITS, chunksNow: {} } }),
    );
    await assertRejects(() => main(base.map((x) => x === base[3] ? noBlock : x), depsFor(a).deps), Error, 'screen');
    await assertRejects(() => main(base, depsFor(a, undefined, { screens: {} }).deps), Error, 'unknown screen');
    assertEquals(await listing(a.out), []);
  },
);

areaTest(
  'main: --no-live reads nothing live, holds every record screen_incomplete and says the run was not complete',
  async (a) => {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1')), JSON.stringify(rec('k2'))]);
    const { deps, services } = depsFor(a);
    assertEquals(await main(argv(a, f.path, '--no-live'), deps), 0);
    assertEquals(services, []);
    assertEquals(await Deno.readTextFile(join(a.out, 'screened.jsonl')), '');
    const holds = await readJsonl(join(a.out, 'holds.jsonl'));
    assertEquals(holds.map((h) => h.reasons), [['screen_incomplete'], ['screen_incomplete']]);
    const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
    assertEquals([receipt.complete, receipt.live_reads_ran], [false, false]);
  },
);

areaTest(
  'main: with --no-live a live read attempted by an ordinary check is a check_error, not a result',
  async (a) => {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
    const checks = screenOf().checks.map((c) =>
      c.name === 'c_rights'
        ? {
          ...c,
          one: (_: Rec, x: { live: LiveReader }) =>
            x.live.documents({ sourceKeys: ['k'], fileUrls: [] }).then(() => []),
        }
        : c
    );
    const { deps } = depsFor(a, screenOf(checks));
    await main(argv(a, f.path, '--no-live'), deps);
    const holds = await readJsonl(join(a.out, 'holds.jsonl'));
    assert((holds[0].reasons as string[]).includes('check_error'));
  },
);

areaTest('main: the receipt is published first and every output is created exclusively', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  const order: string[] = [];
  const { deps } = depsFor(a, screenOf(), {
    link: (from, to) => (order.push(to.split('/').pop()!), Deno.link(from, to)),
  });
  await main(argv(a, f.path), deps);
  assertEquals(order[0], 'screen.receipt.json');
  assertEquals(order.slice().sort(), ['holds.jsonl', 'screen.receipt.json', 'screened.jsonl']);
  // Exclusive: a second publication over the first fails and leaves the first untouched.
  await assertRejects(() => Deno.link(join(a.work, 'b.jsonl'), join(a.out, 'screened.jsonl')));
});

areaTest(
  'main: a failure part-way through publication leaves no output, no receipt and no temporary file',
  async (a) => {
    for (const failAt of [1, 2, 3]) {
      const f = await reader(a, `b${failAt}.jsonl`, [JSON.stringify(rec('k1'))]);
      let n = 0;
      const { deps } = depsFor(a, screenOf(), {
        link: (from, to) => ++n === failAt ? Promise.reject(new Error('disk full')) : Deno.link(from, to),
      });
      await assertRejects(() => main([...argv(a, f.path)], deps), Error, 'disk full');
      assertEquals(await listing(a.out), [], `failure at link ${failAt}`);
    }
  },
);

areaTest('main: a failure while checking leaves nothing behind', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  const bad = screenOf().checks.map((c) =>
    c.name === 'c_rights'
      ? { ...c, one: undefined, all: () => Promise.resolve(new Map([['unknown', [finding('x')]]])) }
      : c
  );
  await assertRejects(() => main(argv(a, f.path), depsFor(a, screenOf(bad)).deps), Error, 'not in the set');
  assertEquals(await listing(a.out), []);
});

areaTest('main: patches are projected like records', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  const p = await reader(a, 'p.jsonl', [JSON.stringify(rec('k1', 'patched'))]);
  const { deps } = depsFor(a, withProject((r) => ({ ...r, document_role: 'as_introduced' })));
  await main(argv(a, f.path, '--patches', p.path), deps);
  assertEquals((await readJsonl(join(a.out, 'screened.jsonl')))[0].document_role, 'as_introduced');
  assertEquals((await readJsonl(join(a.out, 'screened-patches.jsonl')))[0].document_role, 'as_introduced');
});
