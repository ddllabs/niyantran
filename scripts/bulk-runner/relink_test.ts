// Tests for `cli.ts relink` (F390): a records file's dead file links replaced from a checked map, with a receipt that
// chains the reader's. Fakes only, except one test that writes to a temporary directory for the screen's own reader.
import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from 'jsr:@std/assert@1';
import { join } from 'jsr:@std/path@1';
import { sha256Hex } from '../../supabase/functions/_shared/textNormalise.ts';
import { type CliDeps, main, parseArgs, readRecordsText, REPO_ROOT } from './cli.ts';
import { readInput } from './screen.ts';

// deno-lint-ignore no-explicit-any
type Rec = Record<string, any>;

const KA = 'a'.repeat(40);
const KB = 'b'.repeat(40);
const OLD_A = 'https://mha.gov.in/sites/default/files/old-order-a.pdf';
const OLD_B = 'https://mha.gov.in/sites/default/files/old-order-b.pdf';
const NEW_A = 'https://mha.gov.in/sites/default/files/2026-01/new-order-a.pdf';

const recA: Rec = {
  schema: 'nter.citation_pack/1.1',
  source_key: KA,
  title: 'Order A',
  file_url: OLD_A,
  file_bytes: 1234,
  page_count: 2,
  text: 'Order A text',
};
// Spaced and escaped as a file might hold it: an unmapped line must come out byte for byte, not re-serialised.
const lineB = `{"schema": "nter.citation_pack/1.1", "source_key": "${KB}", "title": "Order \\u0042",` +
  ` "file_url": "${OLD_B}", "file_bytes": 99, "text": "B"}`;
const RECORDS = `${JSON.stringify(recA)}\n${lineB}\n`;

const mapLine = (over: Rec = {}): Rec => ({
  source_key: KA,
  new_url: NEW_A,
  http_status: 200,
  content_type: 'application/pdf',
  sha256: 'c'.repeat(64),
  bytes: 1234,
  match_basis: ['file_name', 'bytes=file_bytes'],
  ...over,
});
const mapOf = (...lines: Rec[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

const READER = {
  pack: 'National/v1.1',
  entry: 'documents/transfer_orders.jsonl.gz',
  manifest_sha256: 'd'.repeat(64),
  manifest_verified: true,
  lines_read: 2,
  lines_written: 2,
  limit: null,
  reader_commit: 'e'.repeat(40),
  reader_dirty: false,
};

async function files(records = RECORDS, map = mapOf(mapLine()), receipt: Rec = {}): Promise<Record<string, string>> {
  return {
    'r.jsonl': records,
    'r.jsonl.receipt.json': JSON.stringify({
      ...READER,
      output_bytes: new TextEncoder().encode(records).length,
      output_sha256: await sha256Hex(records),
      lines_read: records.split('\n').filter((l) => l.trim()).length,
      lines_written: records.split('\n').filter((l) => l.trim()).length,
      ...receipt,
    }),
    'map.jsonl': map,
  };
}

const notFound = (p: string) => Promise.reject(new Deno.errors.NotFound(`no file ${p}`));

function deps(f: Record<string, string>, over: Partial<CliDeps> = {}) {
  const lines: string[] = [];
  const written = new Map<string, string>();
  const enc = (s: string) => new TextEncoder().encode(s);
  const d: CliDeps = {
    readText: (p) => p in f ? Promise.resolve(f[p]) : notFound(p),
    readBytes: (p) => p in f ? Promise.resolve(enc(f[p])) : notFound(p),
    fileSize: (p) => p in f ? Promise.resolve(enc(f[p]).length) : notFound(p),
    readChunks: () => {
      throw new Error('relink reads the records file whole');
    },
    writeText: (p, b) => {
      if (written.has(p)) return Promise.reject(new Error(`exists: ${p}`));
      written.set(p, b);
      return Promise.resolve();
    },
    git: () => Promise.resolve({ commit: 'f'.repeat(40), dirty: true }),
    db: () => {
      throw new Error('relink touches no database');
    },
    acceptDb: () => {
      throw new Error('relink touches no database');
    },
    listDir: () => Promise.resolve([]),
    makeDir: () => Promise.resolve(),
    log: (l) => lines.push(l),
    now: () => Date.UTC(2026, 10, 23, 12, 0, 0),
    sleep: () => Promise.resolve(),
    ...over,
  };
  return { d, lines, written };
}

const OUT = '/var/relink-out';
const args = (out = OUT) => ['relink', '--records', 'r.jsonl', '--map', 'map.jsonl', '--out', out];

Deno.test('parseArgs: relink takes --records, --map and --out, each required, and nothing else', () => {
  assertEquals(parseArgs(args()), { cmd: 'relink', records: 'r.jsonl', map: 'map.jsonl', out: OUT });
  assertThrows(() => parseArgs(['relink', '--records', 'r', '--map', 'm']), Error, '--out is required');
  assertThrows(() => parseArgs(['relink', '--records', 'r', '--out', 'o']), Error, '--map is required');
  assertThrows(() => parseArgs([...args(), '--lines', '2']), Error, 'unknown option');
});

Deno.test('relink: the mapped record gets the new file_url and its provenance; the unmapped line is byte-identical', async () => {
  const f = await files();
  const { d, lines, written } = deps(f);
  assertEquals(await main(args(), d), 0);
  assertEquals([...written.keys()], [`${OUT}/relinked.jsonl`, `${OUT}/relinked.jsonl.receipt.json`]);
  const out = written.get(`${OUT}/relinked.jsonl`)!;
  const [l1, l2, rest] = out.split('\n');
  assertEquals(rest, '');
  assertEquals(l2, lineB);
  const r1 = JSON.parse(l1);
  // Only file_url changes, in its place; the provenance is the one field added, last.
  assertEquals(Object.keys(r1), [...Object.keys(recA), 'file_url_relinked']);
  const { file_url, file_url_relinked, ...same } = r1;
  const { file_url: _old, ...origSame } = recA;
  assertEquals(same, origSame);
  assertEquals(file_url, NEW_A);
  const mapText = f['map.jsonl'];
  assertEquals(file_url_relinked, {
    from: OLD_A,
    map_sha256: await sha256Hex(mapText),
    map_line_sha256: await sha256Hex(mapText.split('\n')[0]),
  });
  // Counts only: no link and no file name is printed.
  const printed = lines.join('\n');
  assertStringIncludes(printed, '2 records read, 1 relinked, 1 unchanged');
  for (const s of [OLD_A, NEW_A, 'old-order-a', 'new-order-a', OLD_B]) assert(!printed.includes(s), s);
});

Deno.test('relink: the receipt chains the reader’s, and the output passes the runner’s and the screen’s receipt checks', async () => {
  const f = await files();
  const { d, written } = deps(f);
  assertEquals(await main(args(), d), 0);
  const out = written.get(`${OUT}/relinked.jsonl`)!;
  const receiptText = written.get(`${OUT}/relinked.jsonl.receipt.json`)!;
  const receipt = JSON.parse(receiptText);
  const input = JSON.parse(f['r.jsonl.receipt.json']);
  assertEquals(receipt.pack, input.pack);
  assertEquals(receipt.manifest_sha256, input.manifest_sha256);
  assertEquals(receipt.reader_commit, input.reader_commit);
  assertEquals(receipt.entry, `${input.entry}+relink-f390`);
  assertEquals(receipt.lines_read, 2);
  assertEquals(receipt.lines_written, 2);
  assertEquals(receipt.output_sha256, await sha256Hex(out));
  assertEquals(receipt.output_bytes, new TextEncoder().encode(out).length);
  assertEquals(receipt.derived_from, {
    output_sha256: input.output_sha256,
    receipt_sha256: await sha256Hex(f['r.jsonl.receipt.json']),
  });
  assertEquals(receipt.relink, {
    map_sha256: await sha256Hex(f['map.jsonl']),
    map_bytes: new TextEncoder().encode(f['map.jsonl']).length,
    map_lines: 1,
    counts: { read: 2, relinked: 1, unchanged: 1 },
    runner_commit: 'f'.repeat(40),
    runner_dirty: true,
    input_receipt: input,
  });
  assertEquals(receipt.started_at, '2026-11-23T12:00:00.000Z');
  assertEquals(receipt.finished_at, '2026-11-23T12:00:00.000Z');

  // The runner's own check (split, plan and run read through it) accepts the output under its receipt ...
  const rf = { 'x/relinked.jsonl': out, 'x/relinked.jsonl.receipt.json': receiptText };
  const read = await readRecordsText('x/relinked.jsonl', deps(rf).d);
  assertEquals(read.records.length, 2);
  // ... and refuses it once edited.
  await assertRejects(
    () => readRecordsText('x/relinked.jsonl', deps({ ...rf, 'x/relinked.jsonl': out + out }).d),
    Error,
    'receipt_mismatch',
  );
  // So does split, end to end.
  const s = deps(rf, {
    readChunks: async function* () {
      yield new TextEncoder().encode(out);
    },
  });
  assertEquals(
    await main(['split', '--records', 'x/relinked.jsonl', '--lines', '1', '--out', '/var/relink-parts'], s.d),
    0,
  );
  // The screen reads the reader's output from disk: the same files on disk pass its reader too.
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(dir, 'relinked.jsonl'), out);
    await Deno.writeTextFile(join(dir, 'relinked.jsonl.receipt.json'), receiptText);
    const inp = await readInput(join(dir, 'relinked.jsonl'), 'records');
    assertEquals(inp.lines, 2);
    assertEquals(inp.packageId, `${input.pack}/${input.entry}+relink-f390#${input.manifest_sha256}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** Each rule a map line must meet, with what the refusal must say. Nothing is written for any of them. */
const REFUSALS: [string, string, string[]][] = [
  ['not JSON', '{"source_key": ', ['map line 2', 'not a JSON object']],
  ['not an object', '[1, 2]', ['map line 2', 'not a JSON object']],
  ['key not hex', JSON.stringify(mapLine({ source_key: 'A'.repeat(40) })), ['map line 2', 'source_key']],
  ['key too short', JSON.stringify(mapLine({ source_key: 'a'.repeat(39) })), ['map line 2', 'source_key']],
  ['key not in records', JSON.stringify(mapLine({ source_key: 'c'.repeat(40) })), [
    'c'.repeat(40),
    'not in the records',
  ]],
  ['http', JSON.stringify(mapLine({ new_url: NEW_A.replace('https', 'http') })), [KA, 'new_url']],
  ['query', JSON.stringify(mapLine({ new_url: `${NEW_A}?x=1` })), [KA, 'new_url']],
  ['empty query', JSON.stringify(mapLine({ new_url: `${NEW_A}?` })), [KA, 'new_url']],
  ['fragment', JSON.stringify(mapLine({ new_url: `${NEW_A}#p2` })), [KA, 'new_url']],
  ['userinfo', JSON.stringify(mapLine({ new_url: NEW_A.replace('https://', 'https://u:p@') })), [KA, 'new_url']],
  ['port', JSON.stringify(mapLine({ new_url: NEW_A.replace('mha.gov.in', 'mha.gov.in:8443') })), [KA, 'new_url']],
  ['not pdf', JSON.stringify(mapLine({ new_url: NEW_A.replace('.pdf', '.html') })), [KA, 'new_url']],
  ['not a string', JSON.stringify(mapLine({ new_url: 7 })), [KA, 'new_url']],
  ['status 404', JSON.stringify(mapLine({ http_status: 404 })), [KA, 'http_status']],
  ['status text', JSON.stringify(mapLine({ http_status: '200' })), [KA, 'http_status']],
  ['html', JSON.stringify(mapLine({ content_type: 'text/html' })), [KA, 'content_type']],
  ['bytes differ', JSON.stringify(mapLine({ bytes: 1235 })), [KA, 'bytes', 'file_bytes']],
  ['bytes missing', JSON.stringify(mapLine({ bytes: undefined })), [KA, 'bytes', 'file_bytes']],
  ['same url', JSON.stringify(mapLine({ new_url: OLD_A })), [KA, 'already']],
  [
    'duplicate key',
    [JSON.stringify(mapLine()), JSON.stringify(mapLine())].join('\n'),
    ['map line 3', KA, 'more than once'],
  ],
];

for (const [name, map, says] of REFUSALS) {
  Deno.test(`relink refuses the whole run: ${name}`, async () => {
    // Line 1 maps the other record correctly: one bad line takes the whole run down, not only itself.
    const good = mapLine({ source_key: KB, bytes: 99, new_url: NEW_A.replace('-a.pdf', '-b.pdf') });
    const { d, written, lines } = deps(await files(RECORDS, `${JSON.stringify(good)}\n${map}\n`));
    const e = await assertRejects(() => main(args(), d), Error);
    for (const s of says) assertStringIncludes(e.message, s);
    assertEquals(written.size, 0);
    // A refusal names the key and the rule, never the link.
    for (const s of [OLD_A, NEW_A, 'new-order']) assert(!e.message.includes(s), `${name}: ${s}`);
    assertEquals(lines.length, 0);
  });
}

Deno.test('relink refuses a record mapped twice in the records, and a record with no file_url or file_bytes', async () => {
  const twice = `${JSON.stringify(recA)}\n${JSON.stringify(recA)}\n`;
  const x = deps(await files(twice));
  await assertRejects(() => main(args(), x.d), Error, 'more than once in the records');
  assertEquals(x.written.size, 0);
  const { file_url: _u, ...noUrl } = recA;
  const y = deps(await files(`${JSON.stringify(noUrl)}\n`));
  await assertRejects(() => main(args(), y.d), Error, 'file_url');
  const { file_bytes: _b, ...noBytes } = recA;
  const z = deps(await files(`${JSON.stringify(noBytes)}\n`));
  await assertRejects(() => main(args(), z.d), Error, 'file_bytes');
});

Deno.test('relink refuses a record that was relinked already: the first relink’s provenance is never overwritten', async () => {
  const again = {
    ...recA,
    file_url_relinked: { from: 'x', map_sha256: 'a'.repeat(64), map_line_sha256: 'b'.repeat(64) },
  };
  const x = deps(await files(`${JSON.stringify(again)}\n`));
  await assertRejects(() => main(args(), x.d), Error, 'already carries file_url_relinked');
  assertEquals(x.written.size, 0);
});

Deno.test('relink refuses two keys sent to one new link, and an empty map', async () => {
  const both = mapOf(mapLine(), mapLine({ source_key: KB, bytes: 99 }));
  const x = deps(await files(RECORDS, both));
  await assertRejects(() => main(args(), x.d), Error, 'new_url of another map line');
  assertEquals(x.written.size, 0);
  const y = deps(await files(RECORDS, '\n'));
  await assertRejects(() => main(args(), y.d), Error, 'no lines');
});

Deno.test('relink: the records file is checked against its receipt as split and plan check it, before the map is read', async () => {
  const f = await files();
  const { 'r.jsonl.receipt.json': _, ...none } = f;
  for (
    const [fs, code] of [
      [none, 'receipt_missing'],
      [{ ...f, 'r.jsonl.receipt.json': 'nope' }, 'receipt_unreadable'],
      [{ ...f, 'r.jsonl': f['r.jsonl'] + f['r.jsonl'] }, 'receipt_mismatch'],
      [
        {
          ...f,
          'r.jsonl.receipt.json': JSON.stringify({ ...JSON.parse(f['r.jsonl.receipt.json']), lines_written: 3 }),
        },
        'receipt_mismatch',
      ],
      [
        { ...f, 'r.jsonl.receipt.json': JSON.stringify({ ...JSON.parse(f['r.jsonl.receipt.json']), pack: undefined }) },
        'receipt_unreadable',
      ],
    ] as const
  ) {
    const x = deps(fs as Record<string, string>);
    await assertRejects(() => main(args(), x.d), Error, code);
    assertEquals(x.written.size, 0);
  }
});

Deno.test('relink takes only the pack reader’s output: a screened file or a split part is refused', async () => {
  for (const name of ['out/screened.jsonl', 'p/part-000.jsonl']) {
    const f = await files();
    const x = deps({
      [name]: f['r.jsonl'],
      [`${name}.receipt.json`]: f['r.jsonl.receipt.json'],
      'map.jsonl': f['map.jsonl'],
    });
    await assertRejects(
      () => main(['relink', '--records', name, '--map', 'map.jsonl', '--out', OUT], x.d),
      Error,
      "the pack reader's output",
    );
    assertEquals(x.written.size, 0);
  }
});

Deno.test('relink refuses an --out inside a checkout, or one that already holds a relinked file', async () => {
  const f = await files();
  const inside = deps(f, { commonDir: () => Promise.resolve(null) });
  await assertRejects(() => main(args(`${REPO_ROOT}/relink`), inside.d), Error, 'outside the repository');
  assertEquals(inside.written.size, 0);
  for (const held of ['relinked.jsonl', 'relinked.jsonl.receipt.json']) {
    const x = deps(f, { listDir: () => Promise.resolve([held]) });
    await assertRejects(() => main(args(), x.d), Error, 'already holds');
    assertEquals(x.written.size, 0);
  }
});
