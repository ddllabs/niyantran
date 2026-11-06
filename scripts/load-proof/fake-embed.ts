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
  /** Standard deviation of the noise per component, relative to a unit vector (0.03 per component at 1536 dimensions is about 1.2 in norm). */
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
export async function vectorFor(text: string, pool: Pool | null = null, noise = 0.03): Promise<Float32Array> {
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
  const noise = opts.noise ?? 0.03;
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
        vectors.push(Array.from(await vectorFor(text, pool, noise)));
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
