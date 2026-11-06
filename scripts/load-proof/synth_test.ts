import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { callEnd, loadTextPool, MAX_CALL_BYTES, MAX_SYNTH_CHUNKS, pickChunkCount, synthDoc } from './synth.ts';
import { rng } from './lib.ts';
import { prepareSuppliedText } from '../../supabase/functions/_shared/suppliedText.ts';

Deno.test('a synthetic document is what the worker re-plans: same payload, same hash, same chunk plan', async () => {
  const d = await synthDoc({ tag: 't1', n: 1, chunks: 12, seed: 5 });
  const again = await prepareSuppliedText(JSON.parse(d.request.payload), {});
  assertEquals(again.payload_sha256, d.request.payload_sha256);
  assertEquals(again.chunks.length, d.chunks);
  assertEquals(d.request.expected.length, d.chunks);
  assert(d.chunks >= 9 && d.chunks <= 15, `${d.chunks} chunks for a target of 12`);
});

Deno.test('documents are deterministic in (tag, n, seed) and never share a text hash', async () => {
  const a = await synthDoc({ tag: 't2', n: 1, chunks: 5, seed: 5 });
  const b = await synthDoc({ tag: 't2', n: 1, chunks: 5, seed: 5 });
  const c = await synthDoc({ tag: 't2', n: 2, chunks: 5, seed: 5 });
  assertEquals(a.item, b.item);
  assertNotEquals(a.item.content_sha256, c.item.content_sha256);
  assertNotEquals(a.sourceKey, c.sourceKey);
  // The header is what keeps two documents' texts apart even when real paragraphs are drawn.
  assert(c.text.startsWith('LOK SABHA UNSTARRED QUESTION 2 (t2).'), c.text.slice(0, 60));
});

Deno.test('the manifest item carries the real chunk count and a token estimate', async () => {
  const d = await synthDoc({ tag: 't3', n: 1, chunks: 8, seed: 5 });
  assertEquals(d.item.chunks, d.chunks);
  assertEquals(d.item.est_tokens, d.embeddingInputs.reduce((s, t) => s + Math.ceil(t.length / 4), 0));
});

Deno.test('chunk counts follow a given distribution, and the default is long-tailed within 1..120', () => {
  const next = rng(3);
  for (let i = 0; i < 50; i++) assert([4, 9].includes(pickChunkCount(next, [4, 9])));
  const xs = Array.from({ length: 500 }, () => pickChunkCount(next, null));
  assert(xs.every((x) => x >= 1 && x <= 120));
  assert(Math.max(...xs) > 3 * xs.sort((p, q) => p - q)[250], 'a tail longer than three medians');
});

Deno.test('a document at the largest size the generator asks for stays under the worker limit', async () => {
  const textPool = await loadTextPool('bills');
  for (let n = 1; n <= 40; n++) {
    const d = await synthDoc({ tag: 'cap', n: n * 7919, chunks: MAX_SYNTH_CHUNKS, seed: 1, textPool });
    assert(d.chunks <= 800, `${d.chunks} chunks`);
  }
});

Deno.test('a registration call counts the whole request, not only its text', () => {
  // Short text, and rows per chunk that hold nearly all the bytes: what the old estimate missed.
  const request = { payload: 'x', expected: ['y'.repeat(1_000_000)] };
  const requests = Array.from({ length: 20 }, () => request);
  const end = callEnd(requests, 0);
  assertEquals(end, 6);
  assert(JSON.stringify(requests.slice(0, end)).length <= MAX_CALL_BYTES + 100);
  assertEquals(callEnd(requests, end), 12);
});

Deno.test('a registration call stops at 100 documents, and one oversized document still goes alone', () => {
  assertEquals(callEnd(Array.from({ length: 150 }, () => ({})), 0), 100);
  assertEquals(callEnd([{ a: 'z'.repeat(9_000_000) }, {}], 0), 1);
});
