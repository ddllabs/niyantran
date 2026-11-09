import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { entryStream, readDirectory, type ReadRange, type ZipEntry } from './zip.ts';
import { buildZip, cat, collect, enc, seededBytes, type Spec, u32 } from './zip_fixture.ts';

/** A range reader over bytes; records every request so tests can see what was asked for. */
function reader(bytes: Uint8Array) {
  const calls: Array<[number, number]> = [];
  const read: ReadRange = (start, end) => {
    calls.push([start, end]);
    if (start < 0 || end < start || start >= bytes.length) return Promise.reject(new Error('fake reader: bad range'));
    return Promise.resolve(bytes.slice(start, Math.min(end, bytes.length - 1) + 1));
  };
  return { read, calls };
}

const TEXT = enc.encode('{"a":1}\n{"a":2}\n'.repeat(50));
const SPECS: Spec[] = [
  { name: 'citation_pack_v1/documents/a.jsonl.gz', data: TEXT, method: 0 },
  { name: 'citation_pack_v1/manifest.json', data: enc.encode('{"files":{}}'), method: 8 },
];

Deno.test('readDirectory: names, methods, sizes and offsets of a plain zip', async () => {
  const zip = await buildZip(SPECS);
  const { read } = reader(zip);
  const entries = await readDirectory(zip.length, read);
  assertEquals(entries.map((e) => [e.name, e.method, e.size]), [
    ['citation_pack_v1/documents/a.jsonl.gz', 0, TEXT.length],
    ['citation_pack_v1/manifest.json', 8, 12],
  ]);
  assertEquals(entries[0].offset, 0);
  assertEquals(entries[0].compressedSize, TEXT.length);
  assert(entries[1].offset > 0);
});

Deno.test('readDirectory: a zip64 directory is read from the zip64 records', async () => {
  const zip = await buildZip(SPECS, { zip64: true });
  const entries = await readDirectory(zip.length, reader(zip).read);
  assertEquals(entries.map((e) => [e.name, e.method, e.size]), [
    ['citation_pack_v1/documents/a.jsonl.gz', 0, TEXT.length],
    ['citation_pack_v1/manifest.json', 8, 12],
  ]);
  assert(entries[1].offset > 0);
  assert(entries[1].compressedSize > 0);
});

Deno.test('readDirectory: finds the end record behind a zip comment', async () => {
  const zip = await buildZip(SPECS, { comment: 'x'.repeat(300) });
  const entries = await readDirectory(zip.length, reader(zip).read);
  assertEquals(entries.length, 2);
});

Deno.test('readDirectory: a file with no end record is refused', async () => {
  const bytes = new Uint8Array(500).fill(7);
  await assertRejects(() => readDirectory(bytes.length, reader(bytes).read), Error, 'end of central directory');
});

Deno.test('readDirectory: a central directory that does not hold the counted entries is refused', async () => {
  const zip = await buildZip(SPECS);
  // Break the first central entry's signature.
  const at = zip.length - 22 - (46 + SPECS[0].name.length + 46 + SPECS[1].name.length);
  zip[at] = 0;
  await assertRejects(() => readDirectory(zip.length, reader(zip).read), Error, 'central directory');
});

Deno.test('readDirectory: asks for the tail and the directory only, never the whole file', async () => {
  const big = await buildZip([{ name: 'big', data: new Uint8Array(300_000).fill(65), method: 0 }, ...SPECS]);
  const { read, calls } = reader(big);
  await readDirectory(big.length, read);
  for (const [s, e] of calls) assert(e - s + 1 < 70_000, `asked for ${e - s + 1} bytes`);
});

async function entryOf(zip: Uint8Array, name: string): Promise<ZipEntry> {
  const e = (await readDirectory(zip.length, reader(zip).read)).find((x) => x.name === name);
  assert(e);
  return e;
}

Deno.test('entryStream: a stored entry comes back as its stored bytes', async () => {
  const zip = await buildZip(SPECS);
  const e = await entryOf(zip, SPECS[0].name);
  assertEquals(await collect(entryStream(e, reader(zip).read)), TEXT);
});

Deno.test('entryStream: a deflated entry comes back inflated', async () => {
  const zip = await buildZip(SPECS);
  const e = await entryOf(zip, SPECS[1].name);
  assertEquals(new TextDecoder().decode(await collect(entryStream(e, reader(zip).read))), '{"files":{}}');
});

Deno.test('entryStream: works over a zip64 directory too', async () => {
  const zip = await buildZip(SPECS, { zip64: true });
  const e = await entryOf(zip, SPECS[0].name);
  assertEquals(await collect(entryStream(e, reader(zip).read)), TEXT);
});

Deno.test('entryStream: reads in bounded ranges, ascending, one at a time', async () => {
  const data = new Uint8Array(1000).map((_, i) => i % 251);
  const zip = await buildZip([{ name: 'f', data, method: 0 }]);
  const e = await entryOf(zip, 'f');
  const { read, calls } = reader(zip);
  const before = calls.length;
  assertEquals(await collect(entryStream(e, read, 64)), data);
  const mine = calls.slice(before);
  assert(mine.length >= 1000 / 64);
  for (const [s, end] of mine) assert(end - s + 1 <= 64, `range of ${end - s + 1} bytes`);
  mine.forEach((r, i) => assert(i === 0 || r[0] > mine[i - 1][0], 'ranges ascend'));
});

Deno.test('entryStream: a short range answer is an error, never a silent short entry', async () => {
  const zip = await buildZip(SPECS);
  const e = await entryOf(zip, SPECS[0].name);
  const real = reader(zip).read;
  const short: ReadRange = async (s, end) => {
    const b = await real(s, end);
    return end - s > 100 ? b.slice(0, b.length - 1) : b;
  };
  await assertRejects(() => collect(entryStream(e, short, 200)), Error, 'short');
});

Deno.test('entryStream: a size that disagrees with the directory is an error', async () => {
  const zip = await buildZip(SPECS);
  const e = await entryOf(zip, SPECS[1].name);
  await assertRejects(
    () => collect(entryStream({ ...e, size: e.size + 1 }, reader(zip).read)),
    Error,
    'size',
  );
});

Deno.test('entryStream: an unsupported method is refused', () => {
  const e: ZipEntry = { name: 'x', method: 12, compressedSize: 1, size: 1, offset: 0, crc32: 0 };
  let thrown: unknown;
  try {
    entryStream(e, () => Promise.resolve(new Uint8Array(1)));
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof Error && thrown.message.includes('method 12'));
});

Deno.test('entryStream: a bad local header is refused', async () => {
  const zip = await buildZip(SPECS);
  const e = await entryOf(zip, SPECS[0].name);
  zip[0] = 0;
  await assertRejects(() => collect(entryStream(e, reader(zip).read)), Error, 'local header');
});

// ---- review round: guards that had no test ----

Deno.test('readDirectory: a central directory that starts past the end of the file is refused', async () => {
  const zip = await buildZip(SPECS);
  new DataView(zip.buffer).setUint32(zip.length - 6, zip.length, true); // EOCD directory offset
  await assertRejects(() => readDirectory(zip.length, reader(zip).read), Error, 'outside the file');
});

Deno.test('readDirectory: saturated end-record values with no zip64 locator are refused', async () => {
  const patched = await buildZip(SPECS);
  new DataView(patched.buffer).setUint16(patched.length - 12, 0xffff, true); // EOCD entry count
  await assertRejects(() => readDirectory(patched.length, reader(patched).read), Error, 'zip64 locator');
  const noLoc = await buildZip(SPECS, { zip64: true, noLocator: true });
  await assertRejects(() => readDirectory(noLoc.length, reader(noLoc).read), Error, 'zip64 locator');
});

Deno.test('readDirectory: a byte pattern that looks like an end record inside the comment is not taken for one', async () => {
  const fake = cat(u32(0x06054b50), new Uint8Array(18)); // 22 bytes, comment length 0, but 22 bytes from the file's end
  const zip = await buildZip(SPECS, { comment: new TextDecoder('latin1').decode(cat(fake, enc.encode('tail'))) });
  const entries = await readDirectory(zip.length, reader(zip).read);
  assertEquals(entries.length, 2);
});

Deno.test('readDirectory: a zip64 extra field too short for the values it must hold is refused', async () => {
  const zip = await buildZip(SPECS, { zip64: true, zip64Extra: 'short' });
  await assertRejects(() => readDirectory(zip.length, reader(zip).read), Error, 'too short');
});

Deno.test('readDirectory: an extra field that claims more bytes than its entry holds is refused', async () => {
  const zip = await buildZip(SPECS, { zip64: true, zip64Extra: 'overrun' });
  await assertRejects(() => readDirectory(zip.length, reader(zip).read), Error, 'overruns');
});

Deno.test('readDirectory: a saturated size or offset that no zip64 field replaced is refused', async () => {
  const zip = await buildZip(SPECS, { zip64: true, zip64Extra: 'none' });
  await assertRejects(() => readDirectory(zip.length, reader(zip).read), Error, 'no zip64 field');
});

Deno.test('readDirectory: an entry whose data would end past the end of the zip is refused', async () => {
  const zip = await buildZip(SPECS, { centralCompressedSize: 10_000_000 });
  await assertRejects(() => readDirectory(zip.length, reader(zip).read), Error, 'outside the zip');
});

Deno.test('entryStream: bytes that do not match the entry CRC-32 are an error, stored or deflated', async () => {
  const zip = await buildZip(SPECS, { crc: 0x12345678 });
  for (const spec of SPECS) {
    const e = await entryOf(zip, spec.name);
    assertEquals(e.crc32, 0x12345678);
    await assertRejects(() => collect(entryStream(e, reader(zip).read)), Error, 'crc32');
  }
});

Deno.test('entryStream: more bytes than the directory declares stop the stream early', async () => {
  const data = seededBytes(5000);
  const zip = await buildZip([{ name: 'f', data, method: 8 }]);
  const e = await entryOf(zip, 'f');
  const { read, calls } = reader(zip);
  const before = calls.length;
  await assertRejects(() => collect(entryStream({ ...e, size: 10 }, read, 64)), Error, 'exceeds');
  const used = calls.length - before;
  assert(used < 40, `${used} ranges were read before the error; the whole entry is about 80`);
});
