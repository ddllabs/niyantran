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
  runScreenSets,
  type ScreenDeps,
  screenSets,
  validateScreen,
} from './screen.ts';
import { SCREENS } from './screens/index.ts';
import { LIMITS } from './fixtures.ts';
import { type Check, type Finding, type LiveReader, type Report, REVIEW_CHECKS, type Screen } from './screen_types.ts';
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
  identity: () => Promise.reject(new Error('unexpected live read')),
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

/** The rules hash as the spec defines it, written out by hand for the stand-in repository's one rule file. */
const expectedRules = (settings: Rec) =>
  sha(
    JSON.stringify([{ length: 9, path: 'rules/a.ts', sha256: sha('rule file') }, { settings }]),
  );

Deno.test("rulesSha256: canonical JSON of each file's path, length and sha256, then the settings", async () => {
  const files: Record<string, string> = { 'a.ts': 'AAA', 'b.ts': 'BBB' };
  const read = (p: string) => {
    const name = p.split('/').pop()!;
    return name in files ? Promise.resolve(new TextEncoder().encode(files[name])) : Promise.reject(new Error('nope'));
  };
  const entry = (path: string, text: string) => ({ length: text.length, path, sha256: sha(text) });
  assertEquals(
    await rulesSha256(['a.ts', 'b.ts'], '/r', read, { z: 1, a: { y: 2, b: [3] } }),
    sha(JSON.stringify([entry('a.ts', 'AAA'), entry('b.ts', 'BBB'), { settings: { a: { b: [3], y: 2 }, z: 1 } }])),
  );
  const base = await rulesSha256(['a.ts', 'b.ts'], '/r', read, {});
  assert(await rulesSha256(['b.ts', 'a.ts'], '/r', read, {}) !== base, 'order');
  assert(await rulesSha256(['a.ts', 'b.ts'], '/r', read, { x: 1 }) !== base, 'settings');
  assertEquals(
    await rulesSha256(['a.ts', 'b.ts'], '/r', read, { b: 1, a: 2 }),
    await rulesSha256(['a.ts', 'b.ts'], '/r', read, { a: 2, b: 1 }),
  );
  files['a.ts'] = 'AAX';
  assert(await rulesSha256(['a.ts', 'b.ts'], '/r', read, {}) !== base, 'content');
  // The same bytes cut at a different place are not the same rules.
  files['a.ts'] = 'AAB';
  files['b.ts'] = 'BB';
  assert(await rulesSha256(['a.ts', 'b.ts'], '/r', read, {}) !== await rulesSha256(['b.ts', 'a.ts'], '/r', read, {}));
  const cut = await rulesSha256(['a.ts', 'b.ts'], '/r', read, {});
  files['a.ts'] = 'AA';
  files['b.ts'] = 'BBB';
  assert(await rulesSha256(['a.ts', 'b.ts'], '/r', read, {}) !== cut, 'file boundary');
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
    psql: 'psql',
    service: 'nter-accept',
  });
  const all = parseArgs([...base, '--patches', 'p.jsonl', '--no-live', '--no-pages']);
  assertEquals([all.patches, all.noLive, all.noPages], ['p.jsonl', true, true]);
  assertEquals(parseArgs([...base, '--psql', '/opt/pg/psql']).psql, '/opt/pg/psql');
  assertThrows(() => parseArgs([...base, '--psql', 'a', '--psql', 'b']), Error, 'twice');
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
  assertEquals(Object.keys(SCREENS), ['national-bills', 'national-regulatory']);
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
  const psqls: string[] = [];
  const errs: string[] = [];
  let t = Date.parse('2026-11-10T10:00:00Z');
  const deps: ScreenDeps = {
    screens: { test: () => Promise.resolve(screen) },
    live: (svc, psql) => (services.push(svc), psqls.push(psql), noLive),
    git: () => Promise.resolve({ commit: 'c0ffee'.repeat(6) + 'c0ff', dirty: false }),
    repoRoot: a.repo,
    log: (l) => logs.push(l),
    err: (l) => errs.push(l),
    now: () => (t += 1000),
    ...over,
  };
  return { deps, logs, services, psqls, errs };
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
    assertEquals(review.rules_sha256, await expectedRules({ licences: ['x'] }));
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
    assertEquals(receipt.rules_sha256, await expectedRules({ licences: ['x'] }));
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
  const stats = {
    fetched: 2,
    cached: 1,
    unverifiedPages: 7,
    unverifiedRecords: 3,
    scans: ['k1'],
    url: 'https://example.test/secret.pdf',
    text: SECRET,
    label: SECRET,
    nested: { n: 1 },
    nan: NaN,
    list: [1, 2],
  };
  const checks = [...screenOf().checks, passing('with_stats', ['rights'], { stats } as Partial<Check>)];
  const { deps } = depsFor(a, screenOf(checks));
  assertEquals(await main(argv(a, f.path), deps), 0);
  const raw = await Deno.readTextFile(join(a.out, 'screen.receipt.json'));
  assertEquals(JSON.parse(raw).checks_stats, {
    with_stats: { fetched: 2, cached: 1, unverifiedPages: 7, unverifiedRecords: 3, scans: ['k1'] },
  });
  assert(!raw.includes(SECRET) && !raw.includes('example.test'), 'stats leaked more than counts and keys');
});

areaTest('main: a receipt has an empty checks_stats when no check carries stats', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  assertEquals(await main(argv(a, f.path), depsFor(a).deps), 0);
  const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
  assertEquals(receipt.checks_stats, {});
});

areaTest(
  'main: a screened patch is written into screened.jsonl after the main records, with its own review',
  async (a) => {
    const f = await reader(a, 'bills.jsonl', [JSON.stringify(rec('k1')), JSON.stringify(rec('k2'))]);
    const p = await reader(a, 'fixed.jsonl', [JSON.stringify(rec('k1', 'patched text'))]);
    const { deps } = depsFor(a);
    assertEquals(await main(argv(a, f.path, '--patches', p.path), deps), 0);
    assertEquals(await listing(a.out), ['holds.jsonl', 'screen.receipt.json', 'screened.jsonl']);
    const screened = await readJsonl(join(a.out, 'screened.jsonl'));
    assertEquals(screened.map((r) => r.source_key), ['k2', 'k1']);
    const patch = screened[1];
    assertEquals(patch.text, 'patched text');
    const review = patch.review as Rec;
    assertEquals(review.package_id, `National/v9/documents/fixed.jsonl.gz#${sha('manifest-fixed.jsonl')}`);
    assertEquals(review.file_sha256, p.receipt.output_sha256);
    assertEquals((screened[0].review as Rec).file_sha256, f.receipt.output_sha256);
    // The original is held, not screened.
    const holds = await readJsonl(join(a.out, 'holds.jsonl'));
    assertEquals(holds.map((h) => [h.source_key, h.set, h.reasons]), [['k1', 'records', [
      'superseded_by_patch_input',
    ]]]);
    const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
    assertEquals(receipt.patches.output_sha256, p.receipt.output_sha256);
    assertEquals(receipt.screened_from_patches, 1);
    assertEquals(receipt.screened_from_patches_keys_sha256, sha('k1'));
    assertEquals(receipt.outputs.screened.lines, 2);
    assertEquals('screened_patches' in receipt.outputs, false);
  },
);

areaTest('main: a patch that is held leaves neither it nor its original in screened.jsonl', async (a) => {
  const f = await reader(a, 'bills.jsonl', [JSON.stringify(rec('k1')), JSON.stringify(rec('k2'))]);
  const p = await reader(a, 'fixed.jsonl', [JSON.stringify(rec('k1', 'patched text', { title: 'bad patch' }))]);
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights'
      ? { ...c, one: (r: Rec) => Promise.resolve(r.title === 'bad patch' ? [finding('licence_not_admitted')] : []) }
      : c
  );
  await main(argv(a, f.path, '--patches', p.path), depsFor(a, screenOf(checks)).deps);
  assertEquals((await readJsonl(join(a.out, 'screened.jsonl'))).map((r) => r.source_key), ['k2']);
  const holds = await readJsonl(join(a.out, 'holds.jsonl'));
  assertEquals(holds.map((h) => [h.source_key, h.set, h.reasons]), [
    ['k1', 'records', ['superseded_by_patch_input']],
    ['k1', 'patches', ['licence_not_admitted']],
  ]);
  const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
  assertEquals(receipt.screened_from_patches, 0);
  assertEquals(receipt.screened_from_patches_keys_sha256, sha(''));
  assertEquals(await listing(a.out), ['holds.jsonl', 'screen.receipt.json', 'screened.jsonl']);
});

areaTest(
  'main: screened_from_patches names the screened patches by a hash of their sorted keys, never by text',
  async (a) => {
    const f = await reader(a, 'bills.jsonl', [JSON.stringify(rec('k9'))]);
    const p = await reader(a, 'fixed.jsonl', [JSON.stringify(rec('b', 'two')), JSON.stringify(rec('a', 'one'))]);
    await main(argv(a, f.path, '--patches', p.path), depsFor(a).deps);
    const raw = await Deno.readTextFile(join(a.out, 'screen.receipt.json'));
    const receipt = JSON.parse(raw);
    assertEquals(receipt.screened_from_patches, 2);
    assertEquals(receipt.screened_from_patches_keys_sha256, sha('a\nb'));
    assert(!raw.includes(SECRET));
  },
);

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

areaTest('main: a receipt that cannot be read is reported as unreadable, not as missing', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  await Deno.remove(`${f.path}.receipt.json`);
  await Deno.mkdir(`${f.path}.receipt.json`); // a directory in the receipt's place: present, but not readable as a file
  const e = await assertRejects(() => readInput(f.path, 'records'), Error, 'could not be read');
  assert(!e.message.includes('is missing'), e.message);
  const g = await reader(a, 'c.jsonl', [JSON.stringify(rec('k1'))]);
  await Deno.remove(`${g.path}.receipt.json`);
  await assertRejects(() => readInput(g.path, 'records'), Error, 'is missing');
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
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k0'))]);
  const p = await reader(a, 'p.jsonl', [JSON.stringify(rec('k1', 'patched'))]);
  const { deps } = depsFor(a, withProject((r) => ({ ...r, document_role: 'as_introduced' })));
  await main(argv(a, f.path, '--patches', p.path), deps);
  assertEquals((await readJsonl(join(a.out, 'screened.jsonl')))[0].document_role, 'as_introduced');
  assertEquals((await readJsonl(join(a.out, 'screened.jsonl'))).map((r) => r.document_role), [
    'as_introduced',
    'as_introduced',
  ]);
});

// ---- review round 1: patches, onlyIfClean, identity, provenance, logging, streaming ----

const setOf = (records: Rec[], tag = 'a') => ({
  records,
  packageId: `National/v9/documents/${tag}.jsonl.gz#` + HEX_A,
  fileSha256: (tag === 'a' ? 'b' : 'd').repeat(64),
});
const shared = (over: Partial<RunOptions> = {}) => {
  const { packageId: _p, fileSha256: _f, ...rest } = opts(over);
  return rest;
};

Deno.test("patches: every main record whose key is in the patches input is held, whatever the patch's outcome", async () => {
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights'
      ? { ...c, one: (r: Rec) => Promise.resolve(r.title === 'bad patch' ? [finding('licence_not_admitted')] : []) }
      : c
  );
  const out = await runScreenSets(
    screenOf(checks),
    {
      records: setOf([rec('k1'), rec('k2'), rec('k3')]),
      patches: setOf([rec('k1', 'new text'), rec('k2', 'other', { title: 'bad patch' })], 'p'),
    },
    ctx(),
    shared(),
  );
  assertEquals(out.records.screened.map((r) => r.source_key), ['k3']);
  assertEquals(out.records.holds.map((h) => [h.source_key, h.reasons]), [
    ['k1', ['superseded_by_patch_input']],
    ['k2', ['superseded_by_patch_input']],
  ]);
  assertEquals(out.records.holds[0].findings, [{
    check: 'patches',
    covers: ['dedupe'],
    reason: 'superseded_by_patch_input',
  }]);
  assertEquals(out.patches!.screened.map((r) => r.source_key), ['k1']);
  assertEquals(out.patches!.holds.map((h) => [h.source_key, h.reasons]), [['k2', ['licence_not_admitted']]]);
  // Each set's reviews carry that set's own package and file.
  assertEquals((out.records.screened[0].review as Rec).file_sha256, 'b'.repeat(64));
  assertEquals((out.patches!.screened[0].review as Rec).file_sha256, 'd'.repeat(64));
  assertEquals(((out.patches!.screened[0].review as Rec).package_id as string).includes('/p.jsonl.gz#'), true);
});

Deno.test('patches: a main record is never held for this when no patch has its key', async () => {
  const out = await runScreenSets(
    screenOf(),
    { records: setOf([rec('k1')]), patches: setOf([rec('k2')], 'p') },
    ctx(),
    shared(),
  );
  assertEquals(out.records.holds, []);
  assertEquals(out.records.screened.length, 1);
});

Deno.test('patches: a whole-set check runs once over records and patches together, split back per set', async () => {
  const seen: string[][] = [];
  const dup = passing('dups', ['dedupe'], {
    one: undefined,
    all: (records: Rec[]) => {
      seen.push(records.map((r) => String(r.source_key)));
      // k2 (a main record) and k9 (a patch) have the same text.
      return Promise.resolve(new Map([['k9', [finding('duplicate_text', 'same as k2')]]]));
    },
  });
  const others = REVIEW_CHECKS.filter((c) => c !== 'dedupe').map((c) => passing(`c_${c}`, [c]));
  const out = await runScreenSets(
    screenOf([...others, dup]),
    { records: setOf([rec('k1'), rec('k2')]), patches: setOf([rec('k1', 'fixed'), rec('k9')], 'p') },
    ctx(),
    shared(),
  );
  // k1 of the main set is superseded and is not offered; its patch stands for the key.
  assertEquals(seen, [['k2', 'k1', 'k9']]);
  assertEquals(out.records.screened.map((r) => r.source_key), ['k2']);
  assertEquals(out.patches!.screened.map((r) => r.source_key), ['k1']);
  assertEquals(out.patches!.holds.map((h) => [h.source_key, h.reasons]), [['k9', ['duplicate_text']]]);
});

Deno.test('patches: a repeated key inside one set is still a duplicate, but one key in both sets is not', async () => {
  const out = await runScreenSets(
    screenOf(),
    { records: setOf([rec('x'), rec('a')]), patches: setOf([rec('x', 'fixed'), rec('b'), rec('b')], 'p') },
    ctx(),
    shared(),
  );
  assertEquals(out.patches!.holds.map((h) => h.reasons), [['duplicate_source_key'], ['duplicate_source_key']]);
  assertEquals(out.patches!.screened.map((r) => r.source_key), ['x']);
  assertEquals(out.records.holds.map((h) => h.reasons), [['superseded_by_patch_input']]);
  assertEquals(out.records.screened.map((r) => r.source_key), ['a']);
});

const onlyIf = (calls: string[], find: (r: Rec) => Finding[] = () => []) =>
  passing('expensive', ['completeness'], {
    onlyIfClean: true,
    one: (r: Rec) => (calls.push(String(r.source_key)), Promise.resolve(find(r))),
  });
const without = (cover: Check['covers'][number]) =>
  REVIEW_CHECKS.filter((c) => c !== cover).map((c) => passing(`c_${c}`, [c]));

Deno.test('onlyIfClean: runs only on records with no earlier finding, and held records stay held', async () => {
  const calls: string[] = [];
  const early = passing('early', ['identity'], {
    one: (r: Rec) => Promise.resolve(r.source_key === 'bad' ? [finding('bad_shape')] : []),
  });
  const rest = REVIEW_CHECKS.filter((c) => c !== 'identity' && c !== 'completeness').map((c) => passing(`c_${c}`, [c]));
  const out = await runScreen(
    screenOf([early, ...rest, onlyIf(calls)]),
    [rec('good'), rec('bad'), rec('nt', '')],
    ctx(),
    opts(),
  );
  assertEquals(calls, ['good']);
  assertEquals(out.screened.map((r) => r.source_key), ['good']);
  assertEquals(out.holds.map((h) => [h.source_key, h.reasons]), [['bad', ['bad_shape']], ['nt', ['no_text']]]);
});

Deno.test("onlyIfClean: a whole-set check gets only the clean records, and a later check's finding does not skip it", async () => {
  const offered: string[][] = [];
  const dup = passing('dups', ['dedupe'], {
    one: undefined,
    onlyIfClean: true,
    all: (records: Rec[]) => (offered.push(records.map((r) => String(r.source_key))), Promise.resolve(new Map())),
  });
  const first = passing('first', ['identity'], {
    one: (r: Rec) => Promise.resolve(r.source_key === 'x' ? [finding('f')] : []),
  });
  const mid = REVIEW_CHECKS.filter((c) => c !== 'identity' && c !== 'dedupe').map((c) => passing(`c_${c}`, [c]));
  // A check after the onlyIfClean one that finds something does not make the earlier run wrong.
  const last = passing('last', ['rights'], {
    one: (r: Rec) => Promise.resolve(r.source_key === 'y' ? [finding('late')] : []),
  });
  const out = await runScreen(screenOf([first, ...mid, dup, last]), [rec('x'), rec('y'), rec('z')], ctx(), opts());
  assertEquals(offered, [['y', 'z']]);
  assertEquals(out.screened.map((r) => r.source_key), ['z']);
});

Deno.test('onlyIfClean: it can never let a record pass; a skipped record has no clean mark and stays held', async () => {
  // The onlyIfClean check is the only cover of `completeness`. A record held by an earlier check is skipped by it, and
  // must not come out screened even though the skipped check reported nothing.
  const early = passing('early', ['identity', 'rights'], { one: () => Promise.resolve([finding('f')]) });
  const rest = REVIEW_CHECKS.filter((c) => !['identity', 'rights', 'completeness'].includes(c)).map((c) =>
    passing(`c_${c}`, [c])
  );
  const calls: string[] = [];
  const out = await runScreen(screenOf([early, ...rest, onlyIf(calls)]), [rec('a'), rec('b')], ctx(), opts());
  assertEquals(calls, []);
  assertEquals(out.screened, []);
  assertEquals(out.holds.length, 2);
  // And when nothing was found, it does run and the record passes with completeness true.
  const clean = await runScreen(
    screenOf([...rest, passing('ok1', ['identity', 'rights']), onlyIf(calls)]),
    [rec('a')],
    ctx(),
    opts(),
  );
  assertEquals(calls, ['a']);
  assertEquals(((clean.screened[0].review as Rec).checks as Rec).completeness, true);
});

Deno.test('onlyIfClean: skipped under --no-pages like any pages check, and must be a boolean', async () => {
  const calls: string[] = [];
  const pages = { ...onlyIf(calls), needs: 'pages' as const };
  const out = await runScreen(
    screenOf([...without('completeness'), pages]),
    [rec('a')],
    ctx(),
    opts({ noPages: true }),
  );
  assertEquals(calls, []);
  assertEquals(out.holds[0].reasons, ['screen_incomplete']);
  assertThrows(
    () => validateScreen(screenOf([...without('completeness'), { ...onlyIf([]), onlyIfClean: 'yes' as never }])),
    Error,
    'onlyIfClean',
  );
});

Deno.test('check_error: the message goes to the log sink, never into the hold, and the check is named', async () => {
  const lines: string[] = [];
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights'
      ? { ...c, one: (r: Rec) => Promise.reject(new RangeError(`cannot read ${String(r.text)}`)) }
      : c
  );
  const out = await runScreen(screenOf(checks), [rec('a')], ctx(), opts({ log: (l) => lines.push(l) }));
  assert(lines.some((l) => l.startsWith('check c_rights: cannot read ')), lines.join('|'));
  assert(!JSON.stringify(out.holds).includes(SECRET));
  assertEquals(out.holds[0].findings[0].detail, 'RangeError');
  // A whole-set check that throws is logged the same way.
  const all = passing('dups', ['dedupe'], { one: undefined, all: () => Promise.reject(new Error('whole set failed')) });
  const lines2: string[] = [];
  await runScreen(screenOf([...without('dedupe'), all]), [rec('a')], ctx(), opts({ log: (l) => lines2.push(l) }));
  assert(lines2.includes('check dups: whole set failed'), lines2.join('|'));
});

Deno.test('progress: each check is logged, and every 250 records inside a check and among the outcomes', async () => {
  const lines: string[] = [];
  const records = Array.from({ length: 600 }, (_, i) => rec(`k${i}`));
  await runScreen(screenOf(), records, ctx(), opts({ log: (l) => lines.push(l) }));
  for (const c of REVIEW_CHECKS) {
    assert(lines.includes(`check c_${c}: start`) && lines.includes(`check c_${c}: done, 0 findings`));
  }
  assert(lines.includes('check c_identity: 250 records') && lines.includes('check c_identity: 500 records'));
  assert(!lines.includes('check c_identity: 600 records') && !lines.includes('check c_identity: 100 records'));
  assert(lines.includes('outcomes: 250 of 600 records') && lines.includes('outcomes: 500 of 600 records'));
});

Deno.test('streaming: outcomes are handed over one at a time, in input order, records then patches, each awaited', async () => {
  const order: string[] = [];
  let busy = false;
  const tick = async (label: string) => {
    assert(!busy, 'an outcome was handed over before the previous one finished');
    busy = true;
    await new Promise((r) => setTimeout(r, 1));
    order.push(label);
    busy = false;
  };
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights' ? { ...c, one: (r: Rec) => Promise.resolve(r.source_key === 'h' ? [finding('x')] : []) } : c
  );
  await screenSets(
    screenOf(checks),
    { records: setOf([rec('a'), rec('h'), rec('b')]), patches: setOf([rec('p1'), rec('h')], 'p') },
    ctx(),
    shared(),
    {
      screened: (set, r) => tick(`${set}:ok:${String(r.source_key)}`),
      hold: (set, h) => tick(`${set}:hold:${String(h.source_key)}`),
    },
  );
  assertEquals(order, ['records:ok:a', 'records:hold:h', 'records:ok:b', 'patches:ok:p1', 'patches:hold:h']);
});

// ---- the command: identity, provenance, psql, streaming ----

const BILLS_REC = (key: string, text?: string, extra: Rec = {}) =>
  rec(key, text, { desk_tier: 'national', desk_feature: 'Bills', ...extra });
const liveCheck = (): Check => passing('listing', ['identity'], { needs: 'live' });
const liveScreen = () => screenOf([liveCheck(), ...without('identity')]);
const identityReader = (
  id: { database: string; server: string; documents: number; deskRows: number },
  asked: Array<{ tier: string; feature: string }> = [],
): LiveReader => ({
  ...noLive,
  identity: (q) => (asked.push(q), Promise.resolve(id)),
});
const GOOD_ID = { database: 'nter', server: '10.1.2.3', documents: 40, deskRows: 50 };

areaTest("identity: asked once with the records' tier and feature, recorded in the receipt", async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(BILLS_REC('k1')), JSON.stringify(BILLS_REC('k2'))]);
  const asked: Array<{ tier: string; feature: string }> = [];
  const { deps } = depsFor(a, liveScreen(), { live: () => identityReader(GOOD_ID, asked) });
  assertEquals(await main(argv(a, f.path), deps), 0);
  assertEquals(asked, [{ tier: 'national', feature: 'Bills' }]);
  const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
  assertEquals(receipt.live_identity, {
    database: 'nter',
    server: '10.1.2.3',
    tier: 'national',
    feature: 'Bills',
    documents: 40,
    desk_rows: 50,
  });
});

areaTest('identity: a zero count stops the run with no outputs, naming the database', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(BILLS_REC('k1'))]);
  for (const id of [{ ...GOOD_ID, documents: 0 }, { ...GOOD_ID, deskRows: 0 }]) {
    const { deps } = depsFor(a, liveScreen(), { live: () => identityReader(id) });
    await assertRejects(() => main(argv(a, f.path), deps), Error, 'nter');
    assertEquals(await listing(a.out), []);
  }
});

areaTest('identity: a reader that gives no usable identity, or fails, stops the run with no outputs', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(BILLS_REC('k1'))]);
  for (const id of [{ ...GOOD_ID, database: '' }, { ...GOOD_ID, documents: -1 }, { ...GOOD_ID, deskRows: 1.5 }]) {
    const { deps } = depsFor(a, liveScreen(), { live: () => identityReader(id) });
    await assertRejects(() => main(argv(a, f.path), deps), Error, 'identity');
    assertEquals(await listing(a.out), []);
  }
  const failing: LiveReader = { ...noLive, identity: () => Promise.reject(new Error('psql exited 2')) };
  await assertRejects(
    () => main(argv(a, f.path), depsFor(a, liveScreen(), { live: () => failing }).deps),
    Error,
    'psql exited 2',
  );
  assertEquals(await listing(a.out), []);
});

areaTest(
  'identity: not asked under --no-live, or when no check reads live data; the receipt then says null',
  async (a) => {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(BILLS_REC('k1'))]);
    const asked: Array<{ tier: string; feature: string }> = [];
    await main(
      argv(a, f.path, '--no-live'),
      depsFor(a, liveScreen(), { live: () => identityReader(GOOD_ID, asked) }).deps,
    );
    assertEquals(asked, []);
    assertEquals(JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json'))).live_identity, null);
    await Deno.remove(a.out, { recursive: true });
    await main(argv(a, f.path), depsFor(a, screenOf(), { live: () => identityReader(GOOD_ID, asked) }).deps);
    assertEquals(asked, []);
  },
);

areaTest('identity: records that name no single tier and feature are refused before anything is judged', async (a) => {
  const mixed = await reader(a, 'm.jsonl', [
    JSON.stringify(BILLS_REC('k1')),
    JSON.stringify(BILLS_REC('k2', undefined, { desk_feature: 'Other' })),
  ]);
  await assertRejects(
    () => main(argv(a, mixed.path), depsFor(a, liveScreen(), { live: () => identityReader(GOOD_ID) }).deps),
    Error,
    'desk_feature',
  );
  const none = await reader(a, 'n.jsonl', [JSON.stringify(rec('k1'))]);
  await assertRejects(
    () => main(argv(a, none.path), depsFor(a, liveScreen(), { live: () => identityReader(GOOD_ID) }).deps),
    Error,
    'desk_feature',
  );
  assertEquals(await listing(a.out), []);
});

areaTest("identity: the patches' tier and feature must be the same as the records'", async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(BILLS_REC('k1'))]);
  const p = await reader(a, 'p.jsonl', [JSON.stringify(BILLS_REC('k2', undefined, { desk_tier: 'law' }))]);
  await assertRejects(
    () =>
      main(
        argv(a, f.path, '--patches', p.path),
        depsFor(a, liveScreen(), { live: () => identityReader(GOOD_ID) }).deps,
      ),
    Error,
    'desk_feature',
  );
});

areaTest(
  "main: the receipt records the collection file's sha256, and the rules hash includes the screen settings",
  async (a) => {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
    await main(argv(a, f.path), depsFor(a).deps);
    const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
    assertEquals(receipt.collection_file_sha256, sha(await Deno.readFile(join(a.work, 'collection.json'))));
    assertEquals(receipt.rules_sha256, await expectedRules({ licences: ['x'] }));
    // Other settings, other hash.
    await Deno.remove(a.out, { recursive: true });
    await collectionFile(a, { screen: { decisionId: 'decision-7', settings: { licences: ['y'] } } });
    await main(argv(a, f.path), depsFor(a).deps);
    const other = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
    assertEquals(other.rules_sha256, await expectedRules({ licences: ['y'] }));
    assert(other.collection_file_sha256 !== receipt.collection_file_sha256);
  },
);

areaTest('main: --psql is passed to the live reader factory, default psql', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  const d1 = depsFor(a);
  await main(argv(a, f.path), d1.deps);
  assertEquals(d1.psqls, ['psql']);
  await Deno.remove(a.out, { recursive: true });
  const d2 = depsFor(a);
  await main(argv(a, f.path, '--psql', '/opt/pg/bin/psql'), d2.deps);
  assertEquals(d2.psqls, ['/opt/pg/bin/psql']);
});

areaTest(
  'main: a check_error is logged to stderr with its message, and appears in no output, receipt or stdout line',
  async (a) => {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
    const checks = screenOf().checks.map((c) =>
      c.name === 'c_rights' ? { ...c, one: (r: Rec) => Promise.reject(new Error(`cannot read ${String(r.text)}`)) } : c
    );
    const { deps, errs, logs } = depsFor(a, screenOf(checks));
    await main(argv(a, f.path), deps);
    assert(errs.some((l) => l.startsWith('check c_rights: cannot read ')));
    assert(!logs.join('\n').includes(SECRET));
    for (const name of await listing(a.out)) {
      assert(
        !(await Deno.readTextFile(join(a.out, name))).includes(SECRET),
        name,
      );
    }
  },
);

areaTest(
  'main: with patches, a superseded main record is held and counted, and the receipt counts both sets',
  async (a) => {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1')), JSON.stringify(rec('k2'))]);
    const p = await reader(a, 'p.jsonl', [JSON.stringify(rec('k1', 'fixed'))]);
    await main(argv(a, f.path, '--patches', p.path), depsFor(a).deps);
    const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
    assertEquals(receipt.records.held_by_reason, { superseded_by_patch_input: 1 });
    assertEquals([receipt.records.records_out, receipt.records.held, receipt.patches.records_out], [1, 1, 1]);
    const holds = await readJsonl(join(a.out, 'holds.jsonl'));
    assertEquals(holds.map((h) => [h.source_key, h.set]), [['k1', 'records']]);
    assertEquals((await readJsonl(join(a.out, 'screened.jsonl'))).map((r) => r.source_key), ['k2', 'k1']);
  },
);

areaTest(
  "main: outputs are real files of the receipt's sizes, hashes and line counts (streamed writers close correctly)",
  async (a) => {
    const lines = Array.from({ length: 700 }, (_, i) => JSON.stringify(rec(`k${i}`, `text ${i} é`)));
    const f = await reader(a, 'b.jsonl', lines);
    const { deps, errs } = depsFor(a);
    await main(argv(a, f.path), deps);
    const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
    const bytes = await Deno.readFile(join(a.out, 'screened.jsonl'));
    assertEquals(receipt.outputs.screened, { sha256: sha(bytes), bytes: bytes.length, lines: 700 });
    assertEquals(receipt.outputs.holds.lines, 0);
    assert(errs.includes('outcomes: 500 of 700 records'));
    assertEquals(await listing(a.out), ['holds.jsonl', 'screen.receipt.json', 'screened.jsonl']);
  },
);

// ---- T1: --service, listingRows, reports ----

Deno.test('parseArgs: --service names the libpq service; default nter-accept; a plain name only; no repeat', () => {
  const base = ['--screen', 's', '--collection', 'c.json', '--records', 'r.jsonl', '--out', '/o'];
  assertEquals(parseArgs(base).service, 'nter-accept');
  assertEquals(parseArgs([...base, '--service', 'nter-load-copy']).service, 'nter-load-copy');
  assertThrows(() => parseArgs([...base, '--service', 'a', '--service', 'b']), Error, 'twice');
  assertThrows(() => parseArgs([...base, '--service']), Error, 'needs a value');
  for (const bad of ['has space', 'a/b', "x'y", 'x'.repeat(65), '$(id)', 'a;b']) {
    assertThrows(() => parseArgs([...base, '--service', bad]), Error, 'service');
  }
});

areaTest('main: --service reaches the live reader factory, and the default is still nter-accept', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(BILLS_REC('k1'))]);
  const asked: string[] = [];
  const { deps, services } = depsFor(a, liveScreen(), {
    live: (svc) => (asked.push(svc), identityReader(GOOD_ID)),
  });
  assertEquals(await main(argv(a, f.path, '--service', 'nter-load-copy'), deps), 0);
  assertEquals(asked, ['nter-load-copy']);
  assertEquals(services, []);
  await Deno.remove(a.out, { recursive: true });
  asked.length = 0;
  assertEquals(await main(argv(a, f.path), deps), 0);
  assertEquals(asked, ['nter-accept']);
});

Deno.test('validateScreen: listingRows is required, none or absent; reports are well formed', () => {
  validateScreen({ ...screenOf(), listingRows: 'required' });
  validateScreen({ ...screenOf(), listingRows: 'none' });
  validateScreen(screenOf());
  for (const bad of ['optional', '', 1, null, true]) {
    assertThrows(() => validateScreen({ ...screenOf(), listingRows: bad as never }), Error, 'listingRows');
  }
  const ok: Report = { name: 'scan_a', one: () => [] };
  validateScreen({ ...screenOf(), reports: [ok] });
  assertThrows(() => validateScreen({ ...screenOf(), reports: 'x' as never }), Error, 'reports');
  assertThrows(() => validateScreen({ ...screenOf(), reports: [{ name: '', one: () => [] }] }), Error, 'report');
  assertThrows(
    () => validateScreen({ ...screenOf(), reports: [{ name: 'Bad Name', one: () => [] }] }),
    Error,
    'report',
  );
  assertThrows(() => validateScreen({ ...screenOf(), reports: [{ name: 'x' } as never] }), Error, 'report');
  assertThrows(() => validateScreen({ ...screenOf(), reports: [ok, ok] }), Error, 'twice');
  // A report shares no name with a check, so the receipt's two kinds of entry cannot be confused.
  assertThrows(
    () => validateScreen({ ...screenOf(), reports: [{ name: 'c_identity', one: () => [] }] }),
    Error,
    'c_identity',
  );
});

const noneScreen = (): Screen => ({ ...liveScreen(), listingRows: 'none' });

areaTest(
  'listingRows none: zero listing rows is accepted, and the receipt says there were none required',
  async (a) => {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(BILLS_REC('k1'))]);
    const id = { ...GOOD_ID, deskRows: 0 };
    const { deps } = depsFor(a, noneScreen(), { live: () => identityReader(id) });
    assertEquals(await main(argv(a, f.path), deps), 0);
    const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
    assertEquals(receipt.listing_rows, 'none');
    assertEquals(receipt.live_identity.desk_rows, 0);
    assertEquals(receipt.live_identity.documents, 40);
    assertEquals((await readJsonl(join(a.out, 'screened.jsonl'))).length, 1);
  },
);

areaTest('listingRows none: zero documents still stops the run with no outputs', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(BILLS_REC('k1'))]);
  const { deps } = depsFor(a, noneScreen(), { live: () => identityReader({ ...GOOD_ID, documents: 0, deskRows: 0 }) });
  await assertRejects(() => main(argv(a, f.path), deps), Error, 'nter');
  assertEquals(await listing(a.out), []);
});

areaTest('listingRows required (also when absent): zero listing rows still stops the run', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(BILLS_REC('k1'))]);
  for (const screen of [liveScreen(), { ...liveScreen(), listingRows: 'required' as const }]) {
    const { deps } = depsFor(a, screen, { live: () => identityReader({ ...GOOD_ID, deskRows: 0 }) });
    await assertRejects(() => main(argv(a, f.path), deps), Error, '0 listing rows');
    assertEquals(await listing(a.out), []);
  }
  // And the receipt of a required run says so.
  const { deps } = depsFor(a, liveScreen(), { live: () => identityReader(GOOD_ID) });
  await main(argv(a, f.path), deps);
  assertEquals(JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json'))).listing_rows, 'required');
});

const obs = (group: string, counts: Record<string, number>) => ({ group, counts });
const reportScreen = (reports: Report[], checks?: Check[]): Screen => ({ ...screenOf(checks), reports });

Deno.test('reports: counters are added up by group and name, over every record, held ones too', async () => {
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights'
      ? { ...c, one: (r: Rec) => Promise.resolve(r.source_key === 'held' ? [finding('licence_not_admitted')] : []) }
      : c
  );
  const report: Report = {
    name: 'scan_a',
    one: (r) => [obs(String(r.title), { records: 1, matches: String(r.source_key) === 'k2' ? 3 : 0 })],
  };
  const sum = await screenSets(
    reportScreen([report], checks),
    {
      records: setOf([
        rec('k1', 't', { title: 'h1' }),
        rec('k2', 't', { title: 'h1' }),
        rec('held', 't', { title: 'h2' }),
      ]),
    },
    ctx(),
    shared(),
    { screened: () => {}, hold: () => {} },
  );
  assertEquals(sum.reports, { scan_a: { h1: { records: 2, matches: 3 }, h2: { records: 1, matches: 0 } } });
  assertEquals(sum.reportErrors, {});
});

Deno.test('reports: a report never adds a hold or removes one, however it behaves', async () => {
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights'
      ? { ...c, one: (r: Rec) => Promise.resolve(r.source_key === 'held' ? [finding('licence_not_admitted')] : []) }
      : c
  );
  const records = () => [rec('k1'), rec('held'), rec('k2')];
  const plain = await runScreen(screenOf(checks), records(), ctx(), opts());
  const hostile: Report[] = [
    { name: 'throws', one: () => Promise.reject(new Error(`boom ${SECRET}`)) },
    {
      name: 'throws_sync',
      one: () => {
        throw new TypeError('x');
      },
    },
    { name: 'not_a_list', one: () => 'yes' as never },
    {
      name: 'bad_counts',
      one: () => [obs('h', { records: -1 }), obs('h', { records: 1.5 }), obs('h', { records: NaN })],
    },
    { name: 'bad_name', one: () => [obs('h', { 'Not A Name': 1 })] },
    { name: 'huge', one: () => [obs('h', { records: Number.MAX_SAFE_INTEGER })] },
    {
      name: 'mutates',
      one: (r) => {
        (r as Rec).title = 'changed';
        delete (r as Rec).text;
        return [];
      },
    },
  ];
  const withReports = await runScreen(reportScreen(hostile, checks), records(), ctx(), opts());
  assertEquals(withReports.holds, plain.holds);
  assertEquals(withReports.screened.map((r) => r.source_key), ['k1', 'k2']);
});

Deno.test('reports: a failing report is counted in report_errors, counts only, and the others still run', async () => {
  const good: Report = { name: 'good', one: () => [obs('h', { records: 1 })] };
  const bad: Report = {
    name: 'bad',
    one: () => {
      throw new Error(`boom ${SECRET}`);
    },
  };
  const lines: string[] = [];
  const sum = await screenSets(
    reportScreen([bad, good]),
    { records: setOf([rec('k1'), rec('k2')]) },
    ctx(),
    shared({ log: (l) => lines.push(l) }),
    { screened: () => {}, hold: () => {} },
  );
  assertEquals(sum.reportErrors, { bad: 2 });
  assertEquals(sum.reports, { good: { h: { records: 2 } } });
  assert(!JSON.stringify(sum).includes(SECRET));
  assert(!lines.join('\n').includes(SECRET), 'a report error must not log a message that could quote a record');
});

Deno.test('reports: a group that is not a plain label is counted as other; groups per report are capped', async () => {
  const labels = ['ok.host-1_a', 'has space', 'a/b', '', 'x'.repeat(101), 'émoji', 'a\nb'];
  const report: Report = { name: 'scan', one: (r) => [obs(String(labels[Number(r.n)]), { records: 1 })] };
  const recs = labels.map((_, n) => rec(`k${n}`, 't', { n }));
  const sum = await screenSets(reportScreen([report]), { records: setOf(recs) }, ctx(), shared(), {
    screened: () => {},
    hold: () => {},
  });
  assertEquals(sum.reports, { scan: { 'ok.host-1_a': { records: 1 }, other: { records: 6 } } });
  // 150 distinct plain labels: the first 100 are kept, the rest are other.
  const many: Report = { name: 'many', one: (r) => [obs(`g${String(r.n)}`, { records: 1 })] };
  const sum2 = await screenSets(
    reportScreen([many]),
    { records: setOf(Array.from({ length: 150 }, (_, n) => rec(`m${n}`, 't', { n }))) },
    ctx(),
    shared(),
    { screened: () => {}, hold: () => {} },
  );
  assertEquals(Object.keys(sum2.reports.many).length, 101);
  assertEquals(sum2.reports.many.other, { records: 50 });
});

Deno.test('reports: they run with live reads and the page check switched off, and the records are still all held', async () => {
  const report: Report = { name: 'scan', one: () => [obs('h', { records: 1 })] };
  const out: string[] = [];
  const sum = await screenSets(
    reportScreen([report]),
    { records: setOf([rec('k1'), rec('k2')]) },
    ctx(),
    shared({ noLive: true, noPages: true }),
    {
      screened: () => void out.push('screened'),
      hold: () => void out.push('hold'),
    },
  );
  assertEquals(out, ['hold', 'hold']);
  assertEquals(sum.reports, { scan: { h: { records: 2 } } });
});

Deno.test('reports: a report is not shown a record that is not an object', async () => {
  const seen: unknown[] = [];
  const report: Report = { name: 'scan', one: (r) => (seen.push(r), [obs('h', { records: 1 })]) };
  const sum = await screenSets(
    reportScreen([report]),
    { records: setOf([rec('k1'), null as never, 5 as never, [] as never]) },
    ctx(),
    shared(),
    { screened: () => {}, hold: () => {} },
  );
  assertEquals(seen.length, 1);
  assertEquals(sum.reports, { scan: { h: { records: 1 } } });
});

areaTest(
  'main: the receipt carries the reports and report_errors, counts only; a screen without reports has empty ones',
  async (a) => {
    const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1')), JSON.stringify(rec('k2'))]);
    const report: Report = { name: 'scan', one: () => [obs('rbi.org.in', { records: 1, matches: 2 })] };
    const bad: Report = {
      name: 'bad',
      one: () => {
        throw new Error('x');
      },
    };
    const { deps } = depsFor(a, reportScreen([report, bad]));
    assertEquals(await main(argv(a, f.path), deps), 0);
    const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
    assertEquals(receipt.reports, { scan: { 'rbi.org.in': { records: 2, matches: 4 } } });
    assertEquals(receipt.report_errors, { bad: 2 });
    assertEquals(receipt.records.records_out, 2);
    await Deno.remove(a.out, { recursive: true });
    assertEquals(await main(argv(a, f.path), depsFor(a).deps), 0);
    const plain = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
    assertEquals([plain.reports, plain.report_errors], [{}, {}]);
  },
);

Deno.test('a check that did not run for a record never passes it: a switched-off check and an onlyIfClean skip hold', async () => {
  const mk = (over: Partial<Check>) =>
    screenOf(screenOf().checks.map((c) => c.name === 'c_dedupe' ? { ...c, ...over } : c));
  // Under --no-live a live check is skipped, and the record is held rather than passed.
  const live = await runScreen(mk({ needs: 'live' }), [rec('k1')], ctx(), opts({ noLive: true }));
  assertEquals(live.screened, []);
  assertEquals(live.holds[0].reasons, ['screen_incomplete']);
  const pages = await runScreen(mk({ needs: 'pages' }), [rec('k1')], ctx(), opts({ noPages: true }));
  assertEquals(pages.screened, []);
  // A check that returns a finding set for a record it was not offered is a refusal of the whole run, not a pass.
  await assertRejects(
    () =>
      runScreen(
        mk({ one: undefined, all: () => Promise.resolve(new Map([['zzz', [finding('x')]]])) }),
        [rec('k1')],
        ctx(),
        opts(),
      ),
    Error,
    'not in the set',
  );
});

Deno.test('project: a record the projection cannot copy (a value structuredClone refuses) is held project_failed, not a failed run', async () => {
  const s: Screen = { ...screenOf(), project: (r) => ({ ...r, extra: 1 }) };
  const out = await runScreen(s, [rec('k1', 't', { odd: () => 1 }), rec('k2')], ctx(), opts());
  assertEquals(out.screened.map((r) => r.source_key), ['k2']);
  assertEquals(out.holds[0].source_key, 'k1');
  assertEquals(out.holds[0].reasons, ['project_failed']);
});

Deno.test('holds: a source_key that is not a name (over 200 characters) is not repeated; the hold has null, the reasons stay', async () => {
  const long = 'k'.repeat(201);
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights' ? { ...c, one: () => Promise.resolve([finding('licence_not_admitted')]) } : c
  );
  const out = await runScreen(screenOf(checks), [rec(long), rec('k'.repeat(200)), rec('k1')], ctx(), opts());
  assertEquals(out.holds.map((h) => h.source_key), [null, 'k'.repeat(200), 'k1']);
  assert(out.holds.every((h) => h.reasons[0] === 'licence_not_admitted'));
  assert(!JSON.stringify(out.holds).includes(long));
});

Deno.test('reports: each report is told whether the record was screened or held, and may carry a fixed note', async () => {
  const seen: string[] = [];
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights'
      ? { ...c, one: (r: Rec) => Promise.resolve(r.source_key === 'held' ? [finding('licence_not_admitted')] : []) }
      : c
  );
  const report: Report = {
    name: 'scan',
    note: 'a fixed note',
    one: (r, _c, outcome) => (seen.push(`${String(r.source_key)}:${outcome}`), [obs(outcome, { records: 1 })]),
  };
  const sum = await screenSets(
    reportScreen([report], checks),
    { records: setOf([rec('k1'), rec('held')]) },
    ctx(),
    shared(),
    { screened: () => {}, hold: () => {} },
  );
  assertEquals(seen.sort(), ['held:held', 'k1:screened']);
  assertEquals(sum.reports, { scan: { screened: { records: 1 }, held: { records: 1 } } });
  assertEquals(sum.reportNotes, { scan: 'a fixed note' });
  assertThrows(
    () => validateScreen({ ...screenOf(), reports: [{ name: 'x', one: () => [], note: 5 as never }] }),
    Error,
    'note',
  );
});

areaTest('main: the receipt carries the report notes and says the scan covers every input record', async (a) => {
  const f = await reader(a, 'b.jsonl', [JSON.stringify(rec('k1'))]);
  const report: Report = { name: 'scan', note: 'a fixed note', one: () => [obs('screened', { records: 1 })] };
  assertEquals(await main(argv(a, f.path), depsFor(a, reportScreen([report])).deps), 0);
  const receipt = JSON.parse(await Deno.readTextFile(join(a.out, 'screen.receipt.json')));
  assertEquals(receipt.report_notes, { scan: 'a fixed note' });
  assertEquals(receipt.reports_cover, 'every input record, screened and held');
});

Deno.test('holdKeys hex40: a hold repeats a source_key only when it is 40 hex characters; the default is unchanged', async () => {
  const checks = screenOf().checks.map((c) =>
    c.name === 'c_rights' ? { ...c, one: () => Promise.resolve([finding('x')]) } : c
  );
  const hex = 'ab'.repeat(20);
  const recs = () => [rec(hex), rec('k1'), rec('HOSTILE-text')];
  const plain = await runScreen(screenOf(checks), recs(), ctx(), opts());
  assertEquals(plain.holds.map((h) => h.source_key), [hex, 'k1', 'HOSTILE-text']);
  const strict = await runScreen({ ...screenOf(checks), holdKeys: 'hex40' }, recs(), ctx(), opts());
  assertEquals(strict.holds.map((h) => h.source_key), [hex, null, null]);
  validateScreen({ ...screenOf(), holdKeys: 'hex40' });
  for (const bad of ['hex', '', 1, null]) {
    assertThrows(() => validateScreen({ ...screenOf(), holdKeys: bad as never }), Error, 'holdKeys');
  }
});
