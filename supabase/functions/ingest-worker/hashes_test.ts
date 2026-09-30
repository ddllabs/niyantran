import { assert, assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@1';
import { sha256Hex } from '../_shared/textNormalise.ts';
import { canonicalJson, extractHash, jobHashes, ocrHash, ocrHashInput } from './hashes.ts';
import { IngestError, type IngestJob, OCR_FLAGS, OCR_MODEL } from './types.ts';

Deno.test('canonicalJson sorts keys recursively and has no whitespace', () => {
  assertEquals(
    canonicalJson({ b: 1, a: { d: [3, { z: true, y: null }], c: 'x' } }),
    '{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}',
  );
});

Deno.test('canonicalJson: key order is irrelevant, array order is kept', () => {
  assertEquals(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assertNotEquals(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

Deno.test('canonicalJson refuses values JSON cannot represent exactly', () => {
  for (const bad of [undefined, NaN, Infinity, () => 1, { a: undefined }, [undefined]]) {
    let threw = false;
    try {
      canonicalJson(bad);
    } catch {
      threw = true;
    }
    assert(threw, `accepted ${String(bad)}`);
  }
});

Deno.test('ocrHash is SHA-256 of the canonical {file_sha256, model_id, ...flags}', async () => {
  const expected = await sha256Hex(
    '{"extract_footer":true,"extract_header":true,"file_sha256":"abc","include_blocks":true,"include_image_base64":true,"model_id":"m","table_format":"markdown"}',
  );
  assertEquals(await ocrHash('abc', 'm'), expected);
});

Deno.test('ocrHash input carries every approved flag, and nothing about pages per call', () => {
  const input = ocrHashInput('abc', 'm');
  for (const key of Object.keys(OCR_FLAGS)) assert(key in input, `flag ${key} missing`);
  assertEquals(Object.keys(input).sort(), ['file_sha256', 'model_id', ...Object.keys(OCR_FLAGS)].sort());
  assert(!Object.keys(input).some((k) => k.includes('page')));
});

Deno.test('ocrHash changes with the file and with the model', async () => {
  assertNotEquals(await ocrHash('abc', 'm'), await ocrHash('abd', 'm'));
  assertNotEquals(await ocrHash('abc', 'm'), await ocrHash('abc', 'n'));
});

Deno.test('extractHash is SHA-256 of the canonical {ocr_hash, page_chunk_version, composition_version}', async () => {
  // PAGE_CHUNK_VERSION is 3 and COMPOSITION_VERSION is 1 today; raising either changes every extract_hash.
  const expected = await sha256Hex('{"composition_version":1,"ocr_hash":"h","page_chunk_version":3}');
  assertEquals(await extractHash('h'), expected);
  assertNotEquals(await extractHash('h', { page_chunk_version: 4, composition_version: 1 }), expected);
  assertNotEquals(await extractHash('h', { page_chunk_version: 3, composition_version: 2 }), expected);
});

type JobIds = Pick<IngestJob, 'file_sha256' | 'model_id' | 'ocr_hash' | 'extract_hash' | 'pages_per_call'>;
const job: JobIds = {
  file_sha256: 'f'.repeat(64),
  model_id: null,
  ocr_hash: null,
  extract_hash: null,
  pages_per_call: 25,
};

Deno.test('jobHashes computes all three with OCR_MODEL on a fresh job and reports them as new', async () => {
  const ids = await jobHashes(job);
  assertEquals(ids.modelId, OCR_MODEL);
  assertEquals(ids.ocrHash, await ocrHash(job.file_sha256, OCR_MODEL));
  assertEquals(ids.extractHash, await extractHash(ids.ocrHash));
  assertEquals(ids.newFields, { model_id: OCR_MODEL, ocr_hash: ids.ocrHash, extract_hash: ids.extractHash });
});

Deno.test('jobHashes: pages per call does not change the hashes', async () => {
  const smaller: JobIds = { ...job, pages_per_call: 3 };
  assertEquals((await jobHashes(smaller)).ocrHash, (await jobHashes(job)).ocrHash);
});

Deno.test('jobHashes keeps a pinned model and hashes, and reports nothing new', async () => {
  const pinned = { ...job, model_id: 'mistral-ocr-old', ocr_hash: 'o'.repeat(64), extract_hash: 'e'.repeat(64) };
  const ids = await jobHashes(pinned);
  assertEquals([ids.modelId, ids.ocrHash, ids.extractHash], ['mistral-ocr-old', 'o'.repeat(64), 'e'.repeat(64)]);
  assertEquals(ids.newFields, {});
});

Deno.test('jobHashes computes from a pinned model when only the model is set', async () => {
  const ids = await jobHashes({ ...job, model_id: 'mistral-ocr-old' });
  assertEquals(ids.ocrHash, await ocrHash(job.file_sha256, 'mistral-ocr-old'));
  assertEquals(ids.newFields, { ocr_hash: ids.ocrHash, extract_hash: ids.extractHash });
});

Deno.test('jobHashes refuses a hash without the model (or ocr_hash) it derives from', async () => {
  await assertRejects(() => jobHashes({ ...job, ocr_hash: 'o'.repeat(64) }), IngestError);
  await assertRejects(() => jobHashes({ ...job, model_id: 'm', extract_hash: 'e'.repeat(64) }), IngestError);
});
