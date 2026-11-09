import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { dirname, fromFileUrl, join, resolve } from 'jsr:@std/path@1';
import type { DriveClient, DriveItem } from './drive.ts';
import { checkEntry, checkPack, lines, main, type PackDeps, parseArgs, REPO_ROOT } from './pack.ts';
import { buildZip, cat, enc, gzip, hex, seededBytes, type Spec, type ZipOptions } from './zip_fixture.ts';

// ---- a pack: documents entries plus the manifest the real packs carry ----
const P = 'citation_pack_v1/';
const rec = (key: string, extra: Record<string, unknown> = {}, text = 'plain') =>
  JSON.stringify({ schema: 'nter.citation_pack/1.1', source_key: key, ...extra, text });

interface PackFile {
  name: string; // relative to citation_pack_v1/
  data: Uint8Array; // the file's bytes as the pack stores them
  method?: 0 | 8;
  manifestSha?: string; // override, to build a mismatching manifest
  manifestBytes?: number; // override of the manifest's byte count
  notInZip?: boolean; // listed in the manifest, absent from the zip
}
/** `manifests`: which manifest files the zip holds (default the v1.1 name only). */
async function makePack(
  files: PackFile[],
  opt: ZipOptions = {},
  manifests: string[] = ['manifest.json'],
) {
  const manifest = enc.encode(JSON.stringify({
    pack: 'test',
    built: '2026-01-01',
    files: Object.fromEntries(
      await Promise.all(
        files.map(async (
          f,
        ) => [f.name, { bytes: f.manifestBytes ?? f.data.length, sha256: f.manifestSha ?? await hex(f.data) }]),
      ),
    ),
  }));
  const specs: Spec[] = [
    ...manifests.map((m) => ({ name: P + m, data: manifest, method: 8 as const })),
    { name: `${P}README.md`, data: enc.encode('readme'), method: 8 },
    ...files.filter((f) => !f.notInZip).map((f) => ({ name: P + f.name, data: f.data, method: f.method ?? 0 })),
  ];
  return { zip: await buildZip(specs, opt), manifest };
}

function fakeDrive(zip: Uint8Array, pack = 'National/v1.1', zipCopies = 1) {
  const calls = { ranges: [] as Array<[number, number]>, folders: [] as string[] };
  const zipItem: DriveItem = {
    id: 'zip1',
    name: 'NTER_citation_pack_v1.1_2026-11-01.zip',
    mimeType: 'application/zip',
    size: zip.length,
    sha256Checksum: 'ab'.repeat(32),
  };
  const client: DriveClient = {
    folderByPath(path) {
      calls.folders.push(path);
      if (path !== pack) return Promise.reject(new Error(`not found: ${path}`));
      return Promise.resolve({ id: 'root', name: 'v1.1', mimeType: 'application/vnd.google-apps.folder' });
    },
    children(id) {
      if (id === 'root') {
        return Promise.resolve([{ id: 'sub', name: 'file to ingest', mimeType: 'application/vnd.google-apps.folder' }]);
      }
      if (id === 'sub') return Promise.resolve(Array.from({ length: zipCopies }, () => zipItem));
      return Promise.reject(new Error('unknown folder'));
    },
    readRange(id, start, end) {
      assertEquals(id, 'zip1');
      calls.ranges.push([start, end]);
      return Promise.resolve(zip.slice(start, Math.min(end, zip.length - 1) + 1));
    },
  };
  return { client, calls, zipItem };
}

// ---- a working area: a stand-in repository, a home, and a place to write; removed after each test ----
interface Area {
  root: string;
  repo: string;
  home: string;
  work: string;
}
async function withArea(fn: (a: Area) => Promise<void>): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: 'pack-test-' });
  try {
    const a: Area = { root, repo: join(root, 'repo'), home: join(root, 'home'), work: join(root, 'work') };
    for (const d of [a.repo, a.home, a.work]) await Deno.mkdir(d);
    await fn(a);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}
const areaTest = (name: string, fn: (a: Area) => Promise<void>) => Deno.test(name, () => withArea(fn));

function depsFor(a: Area, client: DriveClient, over: Partial<PackDeps> = {}) {
  const logs: string[] = [];
  const keys: string[] = [];
  let t = Date.parse('2026-11-10T10:00:00Z');
  const deps: PackDeps = {
    drive: (k) => {
      keys.push(k);
      return Promise.resolve(client);
    },
    git: () => Promise.resolve({ commit: 'c0ffee'.repeat(6) + 'c0ff', dirty: false }),
    home: a.home,
    repoRoot: a.repo,
    log: (l) => logs.push(l),
    now: () => (t += 1000),
    ...over,
  };
  return { deps, logs, keys };
}
const sel = (a: { work: string }, entry: string, ...more: string[]) => [
  'select',
  '--pack',
  'National/v1.1',
  '--entry',
  entry,
  '--out',
  join(a.work, 'out.jsonl'),
  ...more,
];
const exists = (p: string) => Deno.stat(p).then(() => true, () => false);
const listing = (d: string) => [...Deno.readDirSync(d)].map((e) => e.name).sort();
const receiptOf = async (a: Area) => JSON.parse(await Deno.readTextFile(join(a.work, 'out.jsonl.receipt.json')));

const ENTRY = 'documents/q.jsonl.gz';
const LINES = [
  rec('k1'), // kept
  rec('k2', { servable: false }), // not_servable
  rec('k3', { licence_class: 'BARRED_PRIVATE' }), // licence_barred
  rec('k4', { v16_replaces: true }), // replacement
  rec('k5'), // skipped_key
  rec('k1'), // duplicate_key
  rec('k7', { servable: true, licence_class: 'OPEN', v16_replaces: false }), // kept
  rec('k8'), // over_limit when limit 2
  rec('k9', { servable: false, licence_class: 'BARRED_X', v16_replaces: true }), // not_servable only
];
const NL = '\n';

// ---- command line ----
Deno.test('parseArgs: list and select take their own options, and each required one', () => {
  assertEquals(parseArgs(['list', '--pack', 'National/v1.1']), { cmd: 'list', pack: 'National/v1.1', key: null });
  const s = parseArgs([
    'select',
    '--pack',
    'National/v1.1',
    '--entry',
    ENTRY,
    '--out',
    '/o/x.jsonl',
    '--limit',
    '5',
    '--skip-keys',
    '/s',
  ]);
  assertEquals(s, {
    cmd: 'select',
    pack: 'National/v1.1',
    entry: ENTRY,
    out: '/o/x.jsonl',
    skipKeys: '/s',
    limit: 5,
    cache: null,
    key: null,
  });
  assertThrows(() => parseArgs(['list']), Error, '--pack');
  assertThrows(() => parseArgs(['select', '--pack', 'National/v1.1', '--out', '/o']), Error, '--entry');
  assertThrows(() => parseArgs(['list', '--pack', 'National/v1.1', '--out', '/o']), Error, 'unknown option --out');
  assertThrows(() => parseArgs(['list', '--pack', 'a', '--pack', 'b']), Error, 'twice');
  assertThrows(
    () => parseArgs(['select', '--pack', 'National/v1.1', '--entry', ENTRY, '--out', '/o', '--limit', '0']),
    Error,
    '--limit',
  );
  assertThrows(
    () => parseArgs(['select', '--pack', 'National/v1.1', '--entry', ENTRY, '--out', '/o', '--limit', '1.5']),
    Error,
    '--limit',
  );
  assertThrows(() => parseArgs(['nope']), Error, 'usage');
});

Deno.test('checkPack: only a path under National/ is accepted', () => {
  assertEquals(checkPack('National/v1.1'), 'National/v1.1');
  for (
    const bad of [
      'Legal/v1.1',
      'National',
      'National/',
      '/National/v1.1',
      'National/../Legal/x',
      'National//v1',
      'National/./v1',
      'national/v1.1',
      '',
    ]
  ) {
    assertThrows(() => checkPack(bad), Error, 'National/');
  }
});

Deno.test('checkEntry: only documents/<name>.jsonl.gz, no traversal', () => {
  assertEquals(checkEntry(ENTRY), ENTRY);
  assertEquals(checkEntry('documents/bills-00.jsonl.gz'), 'documents/bills-00.jsonl.gz');
  const bad = [
    '',
    '/etc/passwd',
    '../x',
    'documents/../../x',
    'a//b',
    'documents/',
    'a\\b',
    'rows/x.jsonl.gz',
    'links/a.csv',
    'README.md',
    'manifest.json',
    'documents/a/b.jsonl.gz',
    'documents/.jsonl.gz',
    'documents/a.jsonl',
    'documents/a.csv',
    'documents//a.jsonl.gz',
    'documents/../manifest.json',
    'documents/a.jsonl.gz/',
  ];
  for (const e of bad) assertThrows(() => checkEntry(e), Error, '--entry');
});

Deno.test('REPO_ROOT is found from the module location', async () => {
  assert(await exists(join(REPO_ROOT, 'AGENTS.md')));
  assertEquals(REPO_ROOT, resolve(dirname(fromFileUrl(import.meta.url)), '../..'));
});

// ---- list ----
areaTest('list: prints the zip and each entry with its size and manifest sha256', async (a) => {
  const data = await gzip(LINES.join(NL) + NL);
  const { zip } = await makePack([{ name: ENTRY, data }]);
  const d = fakeDrive(zip);
  const { deps, logs, keys } = depsFor(a, d.client);
  assertEquals(await main(['list', '--pack', 'National/v1.1'], deps), 0);
  assertEquals(keys, [join(a.home, '.config/niyantran/drive-reader.json')]);
  const text = logs.join('\n');
  assert(text.includes(d.zipItem.name) && text.includes(String(zip.length)) && text.includes('ab'.repeat(32)));
  assert(text.includes(`${ENTRY}  ${data.length}  ${await hex(data)}`), text);
  assert(text.includes('manifest.json'));
});

areaTest('list: --key overrides the default key path', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('k1') + NL) }]);
  const { deps, keys } = depsFor(a, fakeDrive(zip).client);
  await main(['list', '--pack', 'National/v1.1', '--key', '/somewhere/key.json'], deps);
  assertEquals(keys, ['/somewhere/key.json']);
});

areaTest('list: a pack outside National/ is refused before Drive is touched', async (a) => {
  const d = fakeDrive(new Uint8Array(0));
  const { deps, keys } = depsFor(a, d.client);
  await assertRejects(() => main(['list', '--pack', 'Legal/v1.1'], deps), Error, 'National/');
  assertEquals(keys, []);
});

// ---- select: the happy path, receipts, byte for byte ----
areaTest('select: drops by rule, in order, counts them, and writes kept lines byte for byte', async (a) => {
  // Unusual spacing, escapes, non-ASCII, CRLF and a last line without a newline: none of it may be re-serialised.
  const odd1 = '{ "schema" : "nter.citation_pack/1.1",\t"source_key":"k1", "text":"café \\u00e9 नमस्ते" }\r';
  const lastNoNewline = rec('k8');
  const body = [odd1, ...LINES.slice(1, 7), lastNoNewline, LINES[8]].join(NL);
  const data = await gzip(body);
  const { zip, manifest } = await makePack([{ name: ENTRY, data }]);
  const skip = join(a.work, 'skip.txt');
  await Deno.writeTextFile(skip, 'k5\n\n  k99  \r\n');
  const { deps, logs } = depsFor(a, fakeDrive(zip).client);
  assertEquals(await main(sel(a, ENTRY, '--skip-keys', skip, '--limit', '2'), deps), 0);
  const out = await Deno.readFile(join(a.work, 'out.jsonl'));
  assertEquals(new TextDecoder().decode(out), [odd1, LINES[6]].join(NL) + NL);
  const r = JSON.parse(await Deno.readTextFile(join(a.work, 'out.jsonl.receipt.json')));
  assertEquals(r.pack, 'National/v1.1');
  assertEquals(r.zip, {
    id: 'zip1',
    name: 'NTER_citation_pack_v1.1_2026-11-01.zip',
    size: zip.length,
    drive_sha256: 'ab'.repeat(32),
  });
  assertEquals(r.skip_keys, 2);
  assertEquals(r.skip_keys_sha256, await hex(enc.encode('k5\n\n  k99  \r\n')));
  assertEquals(r.manifest_json_sha256, await hex(manifest));
  assertEquals(r.entry, ENTRY);
  assertEquals(r.manifest_sha256, await hex(data));
  assertEquals(r.manifest_verified, true);
  assertEquals(r.lines_read, 9);
  assertEquals(r.dropped, {
    not_servable: 2,
    licence_barred: 1,
    replacement: 1,
    skipped_key: 1,
    duplicate_key: 1,
    over_limit: 1,
  });
  assertEquals(r.lines_written, 2);
  assertEquals(r.output_sha256, await hex(out));
  assertEquals(r.reader_commit, 'c0ffee'.repeat(6) + 'c0ff');
  assert(Date.parse(r.started_at) < Date.parse(r.finished_at));
  assert(
    logs.includes(
      'lines_read 9, dropped not_servable 2, licence_barred 1, replacement 1, skipped_key 1, duplicate_key 1, over_limit 1, lines_written 2',
    ),
    logs.join('\n'),
  );
  assertEquals(await listing(a.work), ['out.jsonl', 'out.jsonl.receipt.json', 'skip.txt']);
});

areaTest('select: without --limit or --skip-keys every other rule still applies and over_limit is 0', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(LINES.join(NL) + NL) }]);
  const { deps } = depsFor(a, fakeDrive(zip).client);
  await main(sel(a, ENTRY), deps);
  const r = JSON.parse(await Deno.readTextFile(join(a.work, 'out.jsonl.receipt.json')));
  assertEquals(r.dropped, {
    not_servable: 2,
    licence_barred: 1,
    replacement: 1,
    skipped_key: 0,
    duplicate_key: 1,
    over_limit: 0,
  });
  assertEquals(r.lines_written, 4); // k1, k5, k7, k8
});

areaTest('select: licence_class is barred by the BARRED_ prefix only', async (a) => {
  const lines = [
    rec('a', { licence_class: 'BARRED_X' }),
    rec('b', { licence_class: 'NOT_BARRED_X' }),
    rec('c', { licence_class: 'OPEN' }),
    rec('d'),
  ];
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(lines.join(NL) + NL) }]);
  await main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps);
  assertEquals((await Deno.readTextFile(join(a.work, 'out.jsonl'))).trim().split(NL).length, 3);
});

Deno.test('select: a deflated entry and a zip64 directory read the same way', async () => {
  const data = await gzip(LINES.slice(0, 1).join(NL) + NL);
  for (const [method, zip64] of [[8, false], [0, true], [8, true]] as const) {
    const { zip } = await makePack([{ name: ENTRY, data, method }], { zip64 });
    await withArea(async (a) => {
      assertEquals(
        await main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps),
        0,
        `method ${method} zip64 ${zip64}`,
      );
      assertEquals(await Deno.readTextFile(join(a.work, 'out.jsonl')), LINES[0] + NL);
    });
  }
});

/** About 125 KB of gzip that does not shrink further, so the entry is larger than the tail read of the zip. */
function bigEntry() {
  const noise = seededBytes(90_000);
  const text = btoa(String.fromCharCode(...noise.subarray(0, 45_000))) +
    btoa(String.fromCharCode(...noise.subarray(45_000)));
  return gzip([rec('big1', {}, text), rec('big2', {}, text.split('').reverse().join(''))].join(NL) + NL);
}

areaTest('select: the entry goes to the default cache outside the repository, fetched in bounded ranges', async (a) => {
  const data = await bigEntry();
  assert(data.length > 70_000, 'the entry must be larger than the tail read');
  const { zip } = await makePack([{ name: ENTRY, data }]);
  const d = fakeDrive(zip);
  await main(sel(a, ENTRY), depsFor(a, d.client, { chunkBytes: 4096 }).deps);
  assertEquals(await Deno.readFile(join(a.home, 'niyantran-packs/National/v1.1', ENTRY)), data);
  const [, ...rest] = d.calls.ranges; // the first call is the tail read of the zip
  for (const [s, e] of rest) assert(e - s + 1 <= 4096, `range of ${e - s + 1} bytes`);
  assert(rest.length >= data.length / 4096, `${rest.length} ranges for ${data.length} bytes`);
});

areaTest(
  'select: --cache puts the entry elsewhere; a matching cached file is reused without fetching it again',
  async (a) => {
    const data = await bigEntry();
    const { zip } = await makePack([{ name: ENTRY, data }]);
    const cache = join(a.root, 'cache');
    const d = fakeDrive(zip);
    await main(sel(a, ENTRY, '--cache', cache), depsFor(a, d.client, { chunkBytes: 4096 }).deps);
    assertEquals(await Deno.readFile(join(cache, ENTRY)), data);
    const first = d.calls.ranges.length;
    assert(first > 20);
    await Deno.remove(join(a.work, 'out.jsonl'));
    await Deno.remove(join(a.work, 'out.jsonl.receipt.json'));
    const { deps, logs } = depsFor(a, d.client, { chunkBytes: 4096 });
    await main(sel(a, ENTRY, '--cache', cache), deps);
    const second = d.calls.ranges.length - first;
    assert(second <= 4, `${second} ranges on a cache hit (tail, directory, manifest only)`);
    assert(logs.some((l) => l.includes('cache: reusing')));
    assertEquals(await exists(join(a.work, 'out.jsonl')), true);
  },
);

areaTest('select: a cached file that no longer matches the manifest is fetched again', async (a) => {
  const data = await gzip(LINES.join(NL) + NL);
  const { zip } = await makePack([{ name: ENTRY, data }]);
  const cache = join(a.root, 'cache');
  await Deno.mkdir(join(cache, 'documents'), { recursive: true });
  await Deno.writeFile(join(cache, ENTRY), cat(data.slice(0, 10), new Uint8Array([1, 2, 3])));
  await main(sel(a, ENTRY, '--cache', cache), depsFor(a, fakeDrive(zip).client).deps);
  assertEquals(await Deno.readFile(join(cache, ENTRY)), data);
  assertEquals(await exists(join(a.work, 'out.jsonl')), true);
});

// ---- select: which manifest ----
areaTest(
  'select: a pack with manifest_delta.json and no manifest.json is read through the delta manifest',
  async (a) => {
    const data = await gzip(LINES.join(NL) + NL);
    const { zip, manifest } = await makePack([{ name: ENTRY, data }], {}, ['manifest_delta.json']);
    const { deps } = depsFor(a, fakeDrive(zip).client);
    assertEquals(await main(sel(a, ENTRY), deps), 0);
    const r = await receiptOf(a);
    assertEquals(r.manifest_sha256, await hex(data));
    assertEquals(r.manifest_json_sha256, await hex(manifest));
  },
);

areaTest('select: a pack holding both manifest.json and manifest_delta.json is refused', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('k1') + NL) }], {}, [
    'manifest.json',
    'manifest_delta.json',
  ]);
  await assertRejects(() => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps), Error, 'exactly one');
  assertEquals(await listing(a.work), []);
});

areaTest('select: a pack holding neither manifest is refused', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('k1') + NL) }], {}, []);
  await assertRejects(() => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps), Error, 'exactly one');
  assertEquals(await listing(a.work), []);
});

// ---- select: refusals leave no output ----
areaTest('select: a manifest sha256 mismatch is refused, with no output and no cached file', async (a) => {
  const data = await gzip(LINES.join(NL) + NL);
  const { zip } = await makePack([{ name: ENTRY, data, manifestSha: '0'.repeat(64) }]);
  await assertRejects(() => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps), Error, 'sha256');
  assertEquals(await listing(a.work), []);
  assertEquals(await exists(join(a.home, 'niyantran-packs/National/v1.1', ENTRY)), false);
  assertEquals(await exists(join(a.home, 'niyantran-packs/National/v1.1', ENTRY + '.part')), false);
});

areaTest('select: an entry the manifest does not list is refused', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL) }]);
  await assertRejects(
    () => main(sel(a, 'documents/other.jsonl.gz'), depsFor(a, fakeDrive(zip).client).deps),
    Error,
    'manifest',
  );
  assertEquals(await listing(a.work), []);
});

areaTest('select: a truncated gzip is refused and leaves no output', async (a) => {
  const whole = await gzip(LINES.join(NL) + NL);
  const cut = whole.slice(0, whole.length - 12); // a valid manifest entry for the cut bytes: only the gzip is wrong
  const { zip } = await makePack([{ name: ENTRY, data: cut }]);
  await assertRejects(() => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps), Error, 'gzip');
  assertEquals(await listing(a.work), []);
});

areaTest('select: a line that is not JSON is refused with its number, and nothing is written', async (a) => {
  const text = [rec('a'), rec('b'), '{"schema": "nter.citation_pack/1.1", "source_key": "c", ', rec('d')].join(NL) + NL;
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(text) }]);
  const { deps, logs } = depsFor(a, fakeDrive(zip).client);
  const e = await assertRejects(() => main(sel(a, ENTRY), deps), Error, 'line 3');
  assert(!e.message.includes('source_key'), 'the message must not repeat the record');
  assertEquals(await listing(a.work), []);
  assert(!logs.join('\n').includes('"c"'));
});

areaTest('select: a blank line in the middle is refused as a bad line', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip([rec('a'), '', rec('b')].join(NL) + NL) }]);
  await assertRejects(() => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps), Error, 'line 2');
});

areaTest(
  'select: a record with the wrong schema, no source_key or a non-object is refused with its line',
  async (a) => {
    const bad: Array<[string, string]> = [
      ['{"schema":"other/1","source_key":"x"}', 'schema'],
      ['{"schema":"nter.citation_pack/2.0","source_key":"x"}', 'schema'],
      ['{"schema":"nter.citation_pack/1.1"}', 'source_key'],
      ['{"schema":"nter.citation_pack/1.1","source_key":""}', 'source_key'],
      ['{"schema":"nter.citation_pack/1.1","source_key":7}', 'source_key'],
      ['[1,2]', 'line 2'],
      ['"text"', 'line 2'],
    ];
    for (const [line, word] of bad) {
      const { zip } = await makePack([{ name: ENTRY, data: await gzip([rec('a'), line].join(NL) + NL) }]);
      const e = await assertRejects(() => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps), Error, 'line 2');
      assert(e.message.includes(word), `${line}: ${e.message}`);
      assertEquals(await listing(a.work), []);
    }
  },
);

areaTest('select: an --out inside the repository is refused before Drive is touched', async (a) => {
  const d = fakeDrive(new Uint8Array(0));
  const { deps, keys } = depsFor(a, d.client);
  for (const out of [join(a.repo, 'x.jsonl'), join(a.repo, 'new/dir/x.jsonl'), a.repo]) {
    await assertRejects(
      () => main(['select', '--pack', 'National/v1.1', '--entry', ENTRY, '--out', out], deps),
      Error,
      'outside the repository',
    );
  }
  assertEquals(keys, []);
  assertEquals(await listing(a.repo), []);
});

areaTest('select: an --out that reaches the repository through a symlink is refused', async (a) => {
  await Deno.symlink(a.repo, join(a.work, 'link'));
  const { deps } = depsFor(a, fakeDrive(new Uint8Array(0)).client);
  await assertRejects(
    () => main(['select', '--pack', 'National/v1.1', '--entry', ENTRY, '--out', join(a.work, 'link/x.jsonl')], deps),
    Error,
    'outside the repository',
  );
  assertEquals(await listing(a.repo), []);
});

areaTest('select: a --cache inside the repository is refused', async (a) => {
  const { deps, keys } = depsFor(a, fakeDrive(new Uint8Array(0)).client);
  await assertRejects(
    () => main(sel(a, ENTRY, '--cache', join(a.repo, 'cache')), deps),
    Error,
    'outside the repository',
  );
  assertEquals(keys, []);
});

areaTest('select: an existing --out (or receipt) is refused and left untouched', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL) }]);
  const out = join(a.work, 'out.jsonl');
  await Deno.writeTextFile(out, 'mine');
  const { deps, keys } = depsFor(a, fakeDrive(zip).client);
  await assertRejects(() => main(sel(a, ENTRY), deps), Error, 'already exists');
  assertEquals(await Deno.readTextFile(out), 'mine');
  assertEquals(keys, []);
  await Deno.remove(out);
  await Deno.writeTextFile(out + '.receipt.json', 'mine');
  await assertRejects(() => main(sel(a, ENTRY), deps), Error, 'already exists');
  assertEquals(await exists(out), false);
});

areaTest('select: a pack outside National/ is refused', async (a) => {
  const { deps, keys } = depsFor(a, fakeDrive(new Uint8Array(0)).client);
  await assertRejects(
    () => main(['select', '--pack', 'Legal/v1', '--entry', ENTRY, '--out', join(a.work, 'o.jsonl')], deps),
    Error,
    'National/',
  );
  assertEquals(keys, []);
});

areaTest(
  'select: logs and receipt carry counts and names, never record text, the key path contents or a token',
  async (a) => {
    const secret = 'SECRET-RECORD-TEXT-9f3';
    const { zip } = await makePack([{
      name: ENTRY,
      data: await gzip([rec('a', {}, secret), rec('b', { servable: false }, secret)].join(NL) + NL),
    }]);
    const { deps, logs } = depsFor(a, fakeDrive(zip).client);
    await main(sel(a, ENTRY), deps);
    const receipt = await Deno.readTextFile(join(a.work, 'out.jsonl.receipt.json'));
    assert(!logs.join('\n').includes(secret) && !receipt.includes(secret));
    assert(!receipt.includes('"a"') && !receipt.includes('source_key'));
  },
);

areaTest('select: no line kept is a refusal: no records file, no receipt, and the counts are logged', async (a) => {
  const { zip } = await makePack([{
    name: ENTRY,
    data: await gzip([rec('a', { servable: false }), rec('b', { servable: false })].join(NL) + NL),
  }]);
  const { deps, logs } = depsFor(a, fakeDrive(zip).client);
  await assertRejects(() => main(sel(a, ENTRY), deps), Error, 'no line');
  assertEquals(await listing(a.work), []);
  assert(
    logs.includes(
      'lines_read 2, dropped not_servable 2, licence_barred 0, replacement 0, skipped_key 0, duplicate_key 0, over_limit 0, lines_written 0',
    ),
    logs.join('\n'),
  );
});

areaTest('select: an entry the manifest lists but the zip lacks is refused', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL), notInZip: true }]);
  await assertRejects(() => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps), Error, 'not in the zip');
  assertEquals(await listing(a.work), []);
});

areaTest('a pack folder with no pack zip, or with two, is refused rather than guessed at', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL) }]);
  for (const copies of [0, 2]) {
    await assertRejects(
      () => main(['list', '--pack', 'National/v1.1'], depsFor(a, fakeDrive(zip, 'National/v1.1', copies).client).deps),
      Error,
      'expected one',
    );
  }
});

// ---- review round ----

areaTest(
  'select: no path inside any checkout of the repository is accepted: the module root, the main checkout of a worktree, a directory with .git above it',
  async (a) => {
    const main1 = join(a.root, 'main'); // the main checkout; it has no .git entry here, so only commonDir can reveal it
    await Deno.mkdir(main1);
    const withGit = join(a.root, 'elsewhere');
    await Deno.mkdir(join(withGit, '.git'), { recursive: true });
    const { deps, keys } = depsFor(a, fakeDrive(new Uint8Array(0)).client, {
      commonDir: () => Promise.resolve(join(main1, '.git')),
    });
    for (
      const out of [
        join(main1, 'x.jsonl'),
        join(main1, 'deep/er/x.jsonl'),
        join(withGit, 'x.jsonl'),
        join(withGit, 'a/b/x.jsonl'),
      ]
    ) {
      await assertRejects(
        () => main(sel(a, ENTRY).slice(0, 5).concat(['--out', out]), deps),
        Error,
        'outside the repository',
      );
    }
    await assertRejects(
      () => main(sel(a, ENTRY, '--cache', join(main1, 'cache')), deps),
      Error,
      'outside the repository',
    );
    await assertRejects(
      () => main(sel(a, ENTRY, '--cache', join(withGit, 'cache')), deps),
      Error,
      'outside the repository',
    );
    assertEquals(keys, []);
    assertEquals(await listing(main1), []);
  },
);

areaTest('select: the main checkout is judged through symlinks too', async (a) => {
  const main1 = join(a.root, 'main');
  await Deno.mkdir(main1);
  await Deno.symlink(main1, join(a.work, 'to-main'));
  const { deps } = depsFor(a, fakeDrive(new Uint8Array(0)).client, {
    commonDir: () => Promise.resolve(join(main1, '.git')),
  });
  await assertRejects(
    () => main(sel(a, ENTRY).slice(0, 5).concat(['--out', join(a.work, 'to-main/x.jsonl')]), deps),
    Error,
    'outside the repository',
  );
  assertEquals(await listing(main1), []);
});

areaTest('select: a gzip with no lines is refused', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip('') }]);
  await assertRejects(() => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps), Error, 'no lines');
  assertEquals(await listing(a.work), []);
});

areaTest('select: a step that fails while publishing leaves neither the records file nor a receipt', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL) }]);
  for (const failing of ['.receipt.json', 'out.jsonl']) {
    const link = (from: string, to: string) =>
      (failing === '.receipt.json' ? to.endsWith('.receipt.json') : !to.endsWith('.receipt.json'))
        ? Promise.reject(new Error('injected failure'))
        : Deno.link(from, to);
    await assertRejects(
      () => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client, { link }).deps),
      Error,
      'injected failure',
    );
    assertEquals(await listing(a.work), [], `after a failure at ${failing}`);
  }
});

areaTest(
  'select: an --out that appears after the checks is never overwritten, and the receipt this run made is removed',
  async (a) => {
    const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL) }]);
    const out = join(a.work, 'out.jsonl');
    const afterCacheVerified = () => Deno.writeTextFile(out, 'mine');
    await assertRejects(
      () => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client, { afterCacheVerified }).deps),
      Error,
    );
    assertEquals(await Deno.readTextFile(out), 'mine');
    assertEquals(await listing(a.work), ['out.jsonl']);
  },
);

areaTest('select: the receipt is created before the records file', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL) }]);
  const order: string[] = [];
  const link = (from: string, to: string) => {
    order.push(to.endsWith('.receipt.json') ? 'receipt' : 'out');
    return Deno.link(from, to);
  };
  await main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client, { link }).deps);
  assertEquals(order, ['receipt', 'out']);
});

areaTest('select: bytes that change between verification and parsing are refused', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL) }]);
  const other = await gzip(rec('zzz') + NL);
  const afterCacheVerified = (path: string) => Deno.writeFile(path, other);
  await assertRejects(
    () => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client, { afterCacheVerified }).deps),
    Error,
    'changed after it was verified',
  );
  assertEquals(await listing(a.work), []);
});

areaTest('select: the cache download uses its own temporary name, never a fixed .part', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL) }]);
  const stale = join(a.home, 'niyantran-packs/National/v1.1', ENTRY + '.part');
  await Deno.mkdir(dirname(stale), { recursive: true });
  await Deno.writeTextFile(stale, 'another run is writing this');
  await main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps);
  assertEquals(await Deno.readTextFile(stale), 'another run is writing this');
});

areaTest(
  'select: a zip entry whose size differs from the manifest is refused before anything is downloaded',
  async (a) => {
    const data = await bigEntry();
    const { zip } = await makePack([{ name: ENTRY, data, manifestBytes: data.length + 1 }]);
    const d = fakeDrive(zip);
    await assertRejects(
      () => main(sel(a, ENTRY), depsFor(a, d.client, { chunkBytes: 4096 }).deps),
      Error,
      'the manifest says',
    );
    assert(
      d.calls.ranges.length <= 4,
      `${d.calls.ranges.length} ranges: only the directory and the manifest may be read`,
    );
    assertEquals(await exists(join(a.home, 'niyantran-packs')), false);
  },
);

areaTest('select: a bad entry CRC-32 in the manifest is reported as that, not as bad JSON', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL) }], { crc: 7 });
  await assertRejects(() => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps), Error, 'crc32');
});

areaTest(
  'select: a key seen on an earlier line, even one dropped by another rule, makes a later line a duplicate',
  async (a) => {
    const text = [rec('k1', { servable: false }), rec('k1', { servable: true }), rec('k2')].join(NL) + NL;
    const { zip } = await makePack([{ name: ENTRY, data: await gzip(text) }]);
    await main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps);
    const r = await receiptOf(a);
    assertEquals(r.dropped.not_servable, 1);
    assertEquals(r.dropped.duplicate_key, 1);
    assertEquals(r.lines_written, 1);
    assertEquals(await Deno.readTextFile(join(a.work, 'out.jsonl')), rec('k2') + NL);
  },
);

areaTest('select: the receipt names the zip file and has null for a --skip-keys file that was not given', async (a) => {
  const { zip } = await makePack([{ name: ENTRY, data: await gzip(rec('a') + NL) }]);
  await main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps);
  const r = await receiptOf(a);
  assertEquals(r.zip.id, 'zip1');
  assertEquals(r.skip_keys_sha256, null);
  assertEquals(r.skip_keys, 0);
});

areaTest('select: an invalid gzip says so without guessing at the cause', async (a) => {
  const whole = await gzip(rec('a') + NL);
  const { zip } = await makePack([{ name: ENTRY, data: whole.slice(0, whole.length - 8) }]);
  const e = await assertRejects(
    () => main(sel(a, ENTRY), depsFor(a, fakeDrive(zip).client).deps),
    Error,
    'gzip stream',
  );
  assert(e.message.includes('damaged, truncated, or more than one member'), e.message);
});

Deno.test('lines: splits chunks at newlines, keeping bytes, with a last line that has no newline', async () => {
  const pieces = ['ab', 'c\nde', '\n', 'f\n\ng', 'hi'].map((t) => enc.encode(t));
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pieces) c.enqueue(p);
      c.close();
    },
  });
  const got: string[] = [];
  for await (const l of lines(stream, 'x')) got.push(new TextDecoder().decode(l));
  assertEquals(got, ['abc', 'de', 'f', '', 'ghi']);
});

Deno.test('lines: one long line in very many chunks is joined once, not re-copied for every chunk', async () => {
  const chunk = new Uint8Array(100).fill(65);
  const count = 40_000; // a 4 MB line
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < count; i++) c.enqueue(chunk);
      c.enqueue(new Uint8Array([10]));
      c.close();
    },
  });
  const t0 = performance.now();
  const got: number[] = [];
  for await (const l of lines(stream, 'x')) got.push(l.length);
  const ms = performance.now() - t0;
  assertEquals(got, [chunk.length * count]);
  assert(ms < 1500, `${ms} ms: copying per chunk would take many seconds`);
});
