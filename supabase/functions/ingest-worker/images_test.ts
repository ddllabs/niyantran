import { assert, assertEquals } from 'jsr:@std/assert@1';
import { processPageImages } from './images.ts';
import { INGEST } from './types.ts';
import {
  dataUri,
  GIF_BASE64,
  JPEG_BASE64,
  MAGIC,
  PNG_1X1_BASE64,
  toBase64,
  WEBP_BASE64,
  withMagic,
} from './__fixtures__/images.ts';

/** Independent decode and hash, so the test does not trust the code under test. */
async function expectedSha(b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const box = { top_left_x: 10, top_left_y: 20, bottom_right_x: 110, bottom_right_y: 220 };

Deno.test('images: a PNG data URI is decoded, hashed, typed by its bytes and queued for upload', async () => {
  const sha = await expectedSha(PNG_1X1_BASE64);
  const { images, uploads } = await processPageImages([{
    id: 'img-0.png',
    ...box,
    image_base64: dataUri('image/png', PNG_1X1_BASE64),
  }]);
  assertEquals(images, [{ id: 'img-0.png', ...box, sha256: sha, mime: 'image/png', byte_size: 70 }]);
  assertEquals(uploads.length, 1);
  assertEquals(uploads[0].path, `img/${sha}.png`);
  assertEquals(uploads[0].contentType, 'image/png');
  assertEquals(uploads[0].sha256, sha);
  assertEquals(uploads[0].bytes.length, 70);
  assertEquals([...uploads[0].bytes.subarray(0, 8)], [...MAGIC.png]);
  assert(!('image_base64' in images[0]), 'base64 must not be kept');
});

Deno.test('images: bare base64 is typed by its magic bytes (jpeg, webp)', async () => {
  const { images, uploads } = await processPageImages([
    { id: 'a', image_base64: JPEG_BASE64 },
    { id: 'b', image_base64: WEBP_BASE64 },
  ]);
  assertEquals(images.map((i) => i.mime), ['image/jpeg', 'image/webp']);
  assertEquals(uploads.map((u) => u.path), [
    `img/${await expectedSha(JPEG_BASE64)}.jpeg`,
    `img/${await expectedSha(WEBP_BASE64)}.webp`,
  ]);
});

Deno.test('images: image/jpg in a data URI is read as image/jpeg', async () => {
  const { images } = await processPageImages([{ id: 'a', image_base64: dataUri('image/jpg', JPEG_BASE64) }]);
  assertEquals(images[0].mime, 'image/jpeg');
});

Deno.test('images: a declared type the bytes contradict is skipped as unsupported_type', async () => {
  const { images, uploads } = await processPageImages([{
    id: 'a',
    ...box,
    image_base64: dataUri('image/png', JPEG_BASE64),
  }]);
  assertEquals(images, [{ id: 'a', ...box, sha256: null, mime: null, byte_size: 32, skipped: 'unsupported_type' }]);
  assertEquals(uploads, []);
});

Deno.test('images: GIF (declared or sniffed) is skipped as unsupported_type', async () => {
  const { images, uploads } = await processPageImages([
    { id: 'a', image_base64: dataUri('image/gif', GIF_BASE64) },
    { id: 'b', image_base64: GIF_BASE64 },
  ]);
  assertEquals(images.map((i) => i.skipped), ['unsupported_type', 'unsupported_type']);
  assertEquals(uploads, []);
});

Deno.test('images: missing, empty or undecodable data is skipped as no_data', async () => {
  const { images, uploads } = await processPageImages([
    { id: 'a' },
    { id: 'b', image_base64: null },
    { id: 'c', image_base64: '' },
    { id: 'd', image_base64: 'data:image/png;base64,' },
    { id: 'e', image_base64: 'data:image/png;base64,@@not base64@@' },
  ]);
  assertEquals(images.map((i) => [i.id, i.skipped, i.sha256]), [
    ['a', 'no_data', null],
    ['b', 'no_data', null],
    ['c', 'no_data', null],
    ['d', 'no_data', null],
    ['e', 'no_data', null],
  ]);
  assertEquals(uploads, []);
});

Deno.test('images: the size cap is INGEST.maxImageBytes (at the cap kept, one byte over skipped as too_large)', async () => {
  const atCap = toBase64(withMagic([...MAGIC.png], INGEST.maxImageBytes));
  const over = toBase64(withMagic([...MAGIC.png], INGEST.maxImageBytes + 1));
  const { images, uploads } = await processPageImages([
    { id: 'at', image_base64: dataUri('image/png', atCap) },
    { id: 'over', ...box, image_base64: dataUri('image/png', over) },
  ]);
  assertEquals(images[0].byte_size, INGEST.maxImageBytes);
  assertEquals(images[0].skipped, undefined);
  assertEquals(images[1], {
    id: 'over',
    ...box,
    sha256: null,
    mime: null,
    byte_size: INGEST.maxImageBytes + 1,
    skipped: 'too_large',
  });
  assertEquals(uploads.length, 1);
});

Deno.test('images: beyond INGEST.maxImagesPerPage on a page, images are skipped as over_page_cap', async () => {
  const many = Array.from(
    { length: INGEST.maxImagesPerPage + 2 },
    (_, i) => ({ id: `i${i}`, image_base64: PNG_1X1_BASE64 }),
  );
  const { images, uploads } = await processPageImages(many);
  assertEquals(images.length, INGEST.maxImagesPerPage + 2);
  assertEquals(images.filter((i) => !i.skipped).length, INGEST.maxImagesPerPage);
  assertEquals(images.slice(INGEST.maxImagesPerPage).map((i) => [i.skipped, i.sha256]), [['over_page_cap', null], [
    'over_page_cap',
    null,
  ]]);
  // All the kept ones are the same bytes: one upload.
  assertEquals(uploads.length, 1);
});

Deno.test('images: a page with no images gives nothing', async () => {
  assertEquals(await processPageImages(undefined), { images: [], uploads: [] });
  assertEquals(await processPageImages([]), { images: [], uploads: [] });
});
