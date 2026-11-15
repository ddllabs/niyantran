import { assert, assertEquals, assertNotEquals, assertRejects } from 'jsr:@std/assert@1';
import { EMBED_DIMS, EMBED_MODEL } from '../../supabase/functions/_shared/embed.ts';
import { assertLocalSupabaseUrl, guardedFetch, rng } from './lib.ts';
import {
  DEFAULT_SIGMA,
  makeFakeEmbedder,
  noiseNorm,
  clusteredVector,
  type Pool,
  REAL_NN_MEDIAN,
  siblingCosine,
  vectorFor,
} from './fake-embed.ts';

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

// ─── the shipped default noise (review finding B2) ──────────────────────────

/** A pool of one unit vector, so every text made from it is a sibling of the same base. */
const onePool = (): Pool => {
  const data = new Float32Array(EMBED_DIMS);
  data[0] = 1;
  return { dims: EMBED_DIMS, count: 1, data };
};
const cosine = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);

Deno.test('the default noise is smaller than the base vector: the base dominates', () => {
  // The earlier 0.03 had a noise norm of 1.18, larger than the unit base, which is isotropic noise to HNSW.
  assert(noiseNorm(DEFAULT_SIGMA) < 0.7, `noise norm ${noiseNorm(DEFAULT_SIGMA)}`);
  assert(noiseNorm(DEFAULT_SIGMA) > 0.2, 'some noise, or every sibling is a duplicate');
});

Deno.test('two vectors made from one base with the default noise have the cosine the real desks show', async () => {
  const pool = onePool();
  const cos = [];
  for (let i = 0; i < 20; i++) {
    cos.push(cosine(await vectorFor(`left ${i}`, pool), await vectorFor(`right ${i}`, pool)));
  }
  const mean = cos.reduce((a, b) => a + b, 0) / cos.length;
  assert(
    Math.abs(mean - siblingCosine(DEFAULT_SIGMA)) < 0.03,
    `mean ${mean}, expected ${siblingCosine(DEFAULT_SIGMA)}`,
  );
  const real = Object.values(REAL_NN_MEDIAN);
  assert(
    mean > Math.min(...real) - 0.05 && mean < Math.max(...real) + 0.05,
    `${mean} is outside the real desks' median nearest-neighbour cosines ${real.join(', ')}`,
  );
});

Deno.test('a vector is the size of a real embedding in JSON: about 1.8 MB for 100 (eight significant digits)', async () => {
  const r = await makeFakeEmbedder({ pool: onePool() }).embed(Array.from({ length: 100 }, (_, i) => `chunk ${i}`));
  const mb = JSON.stringify(r.vectors).length / 1e6;
  assert(mb > 1.4 && mb < 2.3, `${mb} MB`);
});

// ─── clustered vectors (F305) ───────────────────────────────────────────────

/**
 * Text with a known structure: C topics, D documents per topic, K chunks per document. A chunk draws about
 * 55% of its words from its document's own words, 30% from its topic's and 15% from a common stock.
 */
function structuredCorpus(clusters: number, docsPer: number, chunksPer: number, seed: number) {
  const next = rng(seed);
  const word = (tag: string, i: number) => `${tag}${i.toString(36)}word`;
  const pick = (tag: string, n: number) => word(tag, Math.floor(next() * n));
  const docs: { cluster: number; doc: number; chunks: string[] }[] = [];
  for (let c = 0; c < clusters; c++) {
    for (let d = 0; d < docsPer; d++) {
      const chunks: string[] = [];
      for (let k = 0; k < chunksPer; k++) {
        const w: string[] = [];
        for (let i = 0; i < 120; i++) {
          const r = next();
          w.push(r < 0.55 ? pick(`d${c}x${d}x`, 30) : r < 0.85 ? pick(`t${c}x`, 80) : pick('common', 40));
        }
        chunks.push(w.join(' '));
      }
      docs.push({ cluster: c, doc: d, chunks });
    }
  }
  return docs;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

Deno.test('a clustered vector is 1536 wide, unit length and the same for the same text and seed', () => {
  const t = 'the reserve bank issued a circular on digital lending and loan servicing';
  const a = clusteredVector(t, 7);
  assertEquals(a.length, EMBED_DIMS);
  assert(Math.abs(norm(a) - 1) < 1e-5);
  assertEquals(Array.from(clusteredVector(t, 7)), Array.from(a));
  assertNotEquals(Array.from(clusteredVector(t, 8)), Array.from(a), 'another seed, another space');
  assertNotEquals(Array.from(clusteredVector(t + ' extra', 7)), Array.from(a));
  // Text with no usable word still gives a unit vector.
  assert(Math.abs(norm(clusteredVector('', 7)) - 1) < 1e-5);
});

Deno.test('clustered vectors: chunks of one document are closer than documents of other clusters', () => {
  const docs = structuredCorpus(6, 5, 6, 11);
  const v = docs.map((d) => d.chunks.map((t) => clusteredVector(t, 3)));
  const within: number[] = [], sameCluster: number[] = [], between: number[] = [];
  for (let a = 0; a < docs.length; a++) {
    for (let b = a; b < docs.length; b++) {
      for (let i = 0; i < v[a].length; i++) {
        for (let j = a === b ? i + 1 : 0; j < v[b].length; j++) {
          const c = cosine(v[a][i], v[b][j]);
          if (a === b) within.push(c);
          else if (docs[a].cluster === docs[b].cluster) sameCluster.push(c);
          else between.push(c);
        }
      }
    }
  }
  assert(mean(within) > mean(sameCluster) + 0.1, `within ${mean(within)}, same cluster ${mean(sameCluster)}`);
  assert(mean(sameCluster) > mean(between) + 0.05, `same cluster ${mean(sameCluster)}, between ${mean(between)}`);
  assert(mean(within) > mean(between) + 0.3, `within ${mean(within)}, between ${mean(between)}`);
  // Near neighbours look like a real desk's (median 0.81 to 0.89), not the near-random 0.1 of the default.
  assert(mean(within) > 0.6 && mean(within) < 0.95, `within ${mean(within)}`);
  assert(mean(between) < 0.5, `between ${mean(between)}`);
});

Deno.test('the fake embedder in clustered mode is deterministic, and the default stays random', async () => {
  const t = 'a clustered chunk of text about securities and exchange board listing rules';
  const a = (await makeFakeEmbedder({ vectors: 'clustered', seed: 5 }).embed([t])).vectors[0];
  const b = (await makeFakeEmbedder({ vectors: 'clustered', seed: 5 }).embed([t])).vectors[0];
  assertEquals(a, b);
  assertEquals(a.length, EMBED_DIMS);
  const def = (await makeFakeEmbedder().embed([t])).vectors[0];
  assertEquals(def, Array.from(await vectorFor(t), (x) => Number(x.toPrecision(8))));
  assertNotEquals(a, def);
});
