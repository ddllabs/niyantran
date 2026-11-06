// The fake embedder of the F287 harness. It replaces `embed` at RunDeps and nothing else.
//
// Same return shape as embedTexts (_shared/embed.ts): vectors in input order, the model name, prompt
// tokens, cost 0, one request per call. A vector is a function of the text alone: the same text gives
// the same vector in any run. With a pool of real vectors of the desk (a Float32 file under
// ~/niyantran-eval-cache/load-proof/, built by pool.ts), the vector is a pool vector chosen by the
// text's seed plus seeded Gaussian noise, normalised, so HNSW sees clustered data. Without a pool it is
// a seeded random unit vector, which is what the fixture-size tests use.

import { EMBED_DIMS, EMBED_MODEL, EmbeddingError, type EmbedResult } from '../../supabase/functions/_shared/embed.ts';
import { CACHE_DIR, rng, sha256Hex } from './lib.ts';

export type { EmbedResult };

/**
 * Standard deviation of the noise added to a pool vector, per component. At 1536 dimensions the noise
 * has norm sigma * sqrt(1536) = 39.2 * sigma, and two vectors made from the same base have cosine about
 * 1 / (1 + norm^2). The value below was set from the real nearest-neighbour cosine of the desks
 * (nn.ts, niyantran_rehearsal_b9final, exact search; sigma-<desk>.json holds each desk's own value and
 * both distributions). The earlier 0.03 gave a noise norm of 1.18, larger than the unit base vector,
 * which is isotropic noise to HNSW.
 */
export const DEFAULT_SIGMA = 0.0109;

/**
 * The median exact nearest-neighbour cosine of each desk's real chunks (nn.ts on niyantran_rehearsal_b9final,
 * 2026-11-06). The synthetic distribution is matched to the median, not the shape: the real one is wider and has
 * near-duplicates (a fifth of Bills and a quarter of Regulatory chunks have a neighbour at 0.99 or more).
 */
export const REAL_NN_MEDIAN = { bills: 0.8872, nclt: 0.8552, regulatory: 0.8362, pq: 0.813 };

/** The noise norm for a sigma, and the cosine two vectors of one base are expected to have. */
export const noiseNorm = (sigma: number) => sigma * Math.sqrt(EMBED_DIMS);
export const siblingCosine = (sigma: number) => 1 / (1 + noiseNorm(sigma) ** 2);

export interface Pool {
  dims: number;
  count: number;
  data: Float32Array;
}

export const poolPath = (slug: string) => `${CACHE_DIR}/pool-${slug}.f32`;

/** The pool of one desk, or null when there is none (the caller falls back to random unit vectors). */
export async function loadPool(slug: string): Promise<Pool | null> {
  try {
    const bytes = await Deno.readFile(poolPath(slug));
    const data = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    if (data.length === 0 || data.length % EMBED_DIMS !== 0) {
      throw new Error(`pool ${slug} has ${data.length} floats, not a multiple of ${EMBED_DIMS}`);
    }
    return { dims: EMBED_DIMS, count: data.length / EMBED_DIMS, data };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

export interface FakeEmbedderOptions {
  pool?: Pool | null;
  /** Standard deviation of the noise per component (default DEFAULT_SIGMA). */
  noise?: number;
  /** A failure to raise for a call, to stand in for a provider failure. */
  fail?: (inputs: string[], call: number) => Error | null;
  /** True to make a call never return, which is how the harness stands in for a worker killed during it. */
  hang?: (inputs: string[], call: number) => boolean;
  /** Remember every input (for repeated() and seenInputs()). Off for a long load, where it would hold every text. Default on. */
  track?: boolean;
}

export interface FakeEmbedder {
  embed(inputs: string[]): Promise<EmbedResult>;
  /** Calls made and inputs seen, for assertions. */
  readonly calls: number;
  readonly inputsEmbedded: number;
  /** Inputs asked for more than once. */
  repeated(): string[];
  /** Every distinct input that came back, in first-seen order. */
  seenInputs(): string[];
  reset(): void;
}

function normalise(v: Float32Array): void {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
}

function gaussian(next: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    const u = Math.max(next(), 1e-12);
    const w = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * w);
    return r * Math.cos(2 * Math.PI * w);
  };
}

/** The vector of one text. Pure: no state, no clock. */
export async function vectorFor(text: string, pool: Pool | null = null, noise = DEFAULT_SIGMA): Promise<Float32Array> {
  const h = await sha256Hex(text);
  const seed = parseInt(h.slice(0, 8), 16);
  const next = rng(seed);
  const g = gaussian(next);
  const v = new Float32Array(EMBED_DIMS);
  if (pool) {
    const at = (parseInt(h.slice(8, 16), 16) % pool.count) * pool.dims;
    for (let i = 0; i < EMBED_DIMS; i++) v[i] = pool.data[at + i] + noise * g();
  } else {
    for (let i = 0; i < EMBED_DIMS; i++) v[i] = g();
  }
  normalise(v);
  return v;
}

export function makeFakeEmbedder(opts: FakeEmbedderOptions = {}): FakeEmbedder {
  const pool = opts.pool ?? null;
  const noise = opts.noise ?? DEFAULT_SIGMA;
  const seen = new Map<string, number>();
  let calls = 0;
  let inputsEmbedded = 0;
  return {
    async embed(inputs) {
      calls += 1;
      const failure = opts.fail?.(inputs, calls);
      if (failure) throw new EmbeddingError(failure.message, { costUsd: 0, promptTokens: 0 }, 500);
      if (opts.hang?.(inputs, calls)) await new Promise(() => {});
      const vectors: number[][] = [];
      let tokens = 0;
      for (const text of inputs) {
        tokens += Math.ceil(text.length / 4);
        // Eight significant digits, so the JSON is the size of a real embedding's (about 1.8 MB per 100 chunks).
        vectors.push(Array.from(await vectorFor(text, pool, noise), (x) => Number(x.toPrecision(8))));
      }
      // Counted on return: an input is "paid for" only when its call came back.
      if (opts.track !== false) { for (const text of inputs) seen.set(text, (seen.get(text) ?? 0) + 1); }
      inputsEmbedded += inputs.length;
      return { vectors, model: EMBED_MODEL, promptTokens: tokens, costUsd: 0, requests: 1 };
    },
    get calls() {
      return calls;
    },
    get inputsEmbedded() {
      return inputsEmbedded;
    },
    repeated: () => [...seen].filter(([, n]) => n > 1).map(([t]) => t),
    seenInputs: () => [...seen.keys()],
    reset() {
      seen.clear();
      calls = 0;
      inputsEmbedded = 0;
    },
  };
}
