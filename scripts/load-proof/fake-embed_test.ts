import { assert, assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@1';
import { EMBED_DIMS, EMBED_MODEL } from '../../supabase/functions/_shared/embed.ts';
import { assertLocalSupabaseUrl, guardedFetch } from './lib.ts';
import { makeFakeEmbedder, type Pool, vectorFor } from './fake-embed.ts';

const norm = (v: ArrayLike<number>) => Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0));

Deno.test('a vector is 1536 wide, unit length, and the same for the same text', async () => {
  const e = makeFakeEmbedder();
  const r = await e.embed(['alpha', 'beta', 'alpha']);
  assertEquals(r.vectors.length, 3);
  for (const v of r.vectors) {
    assertEquals(v.length, EMBED_DIMS);
    assert(Math.abs(norm(v) - 1) < 1e-5);
  }
  assertEquals(r.vectors[0], r.vectors[2]);
  assertNotEquals(r.vectors[0], r.vectors[1]);
  // A second embedder, a later run: still the same.
  assertEquals((await makeFakeEmbedder().embed(['alpha'])).vectors[0], r.vectors[0]);
});

Deno.test('the result has the shape of embedTexts, at cost 0', async () => {
  const r = await makeFakeEmbedder().embed(['four', 'words here']);
  assertEquals(Object.keys(r).sort(), ['costUsd', 'model', 'promptTokens', 'requests', 'vectors']);
  assertEquals(r.model, EMBED_MODEL);
  assertEquals(r.costUsd, 0);
  assertEquals(r.requests, 1);
  assert(r.promptTokens > 0);
});

Deno.test('with a pool the vector stays near a pool vector, and is still deterministic', async () => {
  const data = new Float32Array(EMBED_DIMS * 2);
  data[0] = 1; // pool vector 0 points along axis 0
  data[EMBED_DIMS + 1] = 1; // pool vector 1 along axis 1
  const pool: Pool = { dims: EMBED_DIMS, count: 2, data };
  const a = await vectorFor('some text', pool, 0.01);
  const b = await vectorFor('some text', pool, 0.01);
  assertEquals(Array.from(a), Array.from(b));
  assert(Math.abs(norm(a) - 1) < 1e-5);
  assert(a[0] > 0.9 || a[1] > 0.9, 'close to one of the pool vectors');
});

Deno.test('it counts repeats and can be made to fail', async () => {
  const e = makeFakeEmbedder({ fail: (_i, call) => (call === 2 ? new Error('provider down') : null) });
  await e.embed(['x']);
  await assertRejects(() => e.embed(['y']), Error, 'provider down');
  await e.embed(['x']);
  assertEquals(e.repeated(), ['x']);
});

Deno.test('the harness refuses a Supabase URL that is not local, and every non-local fetch', async () => {
  assertLocalSupabaseUrl('http://127.0.0.1:54321');
  assertLocalSupabaseUrl('http://localhost:3000');
  for (
    const bad of [
      'https://abcdefgh.supabase.co',
      'https://openrouter.ai/api/v1',
      'http://127.0.0.1.evil.example',
      'not a url',
    ]
  ) {
    let refused = false;
    try {
      assertLocalSupabaseUrl(bad);
    } catch {
      refused = true;
    }
    assert(refused, `accepted ${bad}`);
  }
  await assertRejects(
    () => guardedFetch('https://openrouter.ai/api/v1/embeddings', { method: 'POST' }),
    Error,
    'localhost only',
  );
  await assertRejects(() => guardedFetch('https://api.mistral.ai/v1/ocr'), Error, 'localhost only');
});

Deno.test('the real embedTexts, handed the guarded fetch and no key, cannot reach OpenRouter', async () => {
  const { embedTexts } = await import('../../supabase/functions/_shared/embed.ts');
  await assertRejects(() => embedTexts({ fetch: guardedFetch, apiKey: '' }, ['x']), Error, 'localhost only');
});
