// Sets the fake embedder's noise from the real data (review finding B2) and records both distributions.
//
// Real: for a sample of chunks of a desk in niyantran_rehearsal_b9final, the exact cosine to the nearest
// OTHER chunk of the desk (a sequential scan, index scans off, in a read-only transaction; nothing is
// written to it). Synthetic: the same statistic over a population of vectors made by the fake embedder
// (the desk's pool plus noise) of the desk's size, capped. Sigma is chosen so the synthetic median
// nearest-neighbour cosine matches the real one, then both distributions are written, with quantiles, to
// ~/niyantran-eval-cache/load-proof/sigma-<desk>.json, which load.ts requires and copies into its results.
//
//   deno run scripts/load-proof/nn.ts --feature bills [--queries 300] [--population-cap 100000]
//
// Needs the pool (pool.ts) of the desk first.

import { CACHE_DIR, psql } from './lib.ts';
import { loadPool, noiseNorm, siblingCosine, vectorFor } from './fake-embed.ts';
import { type FeatureKey, FEATURES } from './synth.ts';

const SOURCE = 'niyantran_rehearsal_b9final';
const DIMS = 1536;
const arg = (flag: string, fallback?: string) => {
  const i = Deno.args.indexOf(flag);
  return i >= 0 ? Deno.args[i + 1] : fallback;
};

export function quantiles(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(4);
  return {
    n: s.length,
    p05: q(0.05),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p95: q(0.95),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(4),
    share_over_0_99: +(s.filter((x) => x >= 0.99).length / s.length).toFixed(4),
  };
}

/** Exact nearest-neighbour cosine of each query among `pop` (both unit vectors, row-major Float32). */
export function nearestCosines(pop: Float32Array, queryIdx: number[]): number[] {
  const n = pop.length / DIMS;
  return queryIdx.map((qi) => {
    const q = pop.subarray(qi * DIMS, (qi + 1) * DIMS);
    let best = -1;
    for (let r = 0; r < n; r++) {
      if (r === qi) continue;
      const o = r * DIMS;
      let d = 0;
      for (let k = 0; k < DIMS; k++) d += q[k] * pop[o + k];
      if (d > best) best = d;
    }
    return best;
  });
}

async function syntheticPopulation(slug: string, size: number, sigma: number): Promise<Float32Array> {
  const pool = await loadPool(slug);
  if (!pool) throw new Error(`no pool for ${slug}; run pool.ts first`);
  const pop = new Float32Array(size * DIMS);
  for (let i = 0; i < size; i++) pop.set(await vectorFor(`nn-population ${slug} ${i}`, pool, sigma), i * DIMS);
  return pop;
}

if (import.meta.main) {
  const key = (arg('--feature') ?? '') as FeatureKey;
  if (!(key in FEATURES) || key === 'other') throw new Error('--feature must be bills, nclt, regulatory or pq');
  const feature = FEATURES[key].feature.replaceAll("'", "''");
  const nQueries = Number(arg('--queries', '300'));
  const cap = Number(arg('--population-cap', '100000'));

  // Real.
  const total = Number(
    await psql(`select count(*) from public.document_chunks where desk_feature = '${feature}'`, { db: SOURCE }),
  );
  const stride = Math.max(1, Math.floor(total / nQueries));
  const t0 = performance.now();
  const out = await psql(
    `begin read only;
     set local search_path = public, extensions; set local enable_indexscan = off; set local enable_bitmapscan = off; set local max_parallel_workers_per_gather = 0;
     with q as (select id, embedding from public.document_chunks where desk_feature = '${feature}' and embedding is not null
                 and abs(hashtext(id::text)) % ${stride} = 0 limit ${nQueries})
     select (select 1 - (c.embedding <=> q.embedding) from public.document_chunks c
              where c.desk_feature = '${feature}' and c.id <> q.id and c.embedding is not null
              order by c.embedding <=> q.embedding limit 1) from q;
     commit;`,
    { db: SOURCE, timeoutMs: 3 * 3600_000 },
  );
  const real = out.split('\n').filter((l) => l !== '').map(Number);
  console.log(`real: ${real.length} queries over ${total} chunks in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  const realQ = quantiles(real);
  console.log(JSON.stringify(realQ));

  // Synthetic: a population of the desk's size (capped), sigma refined until the medians agree.
  const population = Math.min(total, cap);
  const probe = Math.min(population, 30000);
  const queryIdx = Array.from({ length: Math.min(nQueries, probe) }, (_, i) => Math.floor(i * probe / nQueries));
  let sigma = Math.sqrt(1 / realQ.p50 - 1) / Math.sqrt(DIMS); // sibling cosine = real median
  let lo = sigma / 4, hi = sigma * 4;
  for (let it = 0; it < 6; it++) {
    const med = quantiles(nearestCosines(await syntheticPopulation(key, probe, sigma), queryIdx)).p50;
    console.log(`  sigma ${sigma.toFixed(5)} -> synthetic median ${med} (target ${realQ.p50}, ${probe} vectors)`);
    if (Math.abs(med - realQ.p50) < 0.01) break;
    if (med > realQ.p50) lo = sigma;
    else hi = sigma; // more noise lowers the cosine
    sigma = (lo + hi) / 2;
  }
  const pop = await syntheticPopulation(key, population, sigma);
  const fullQueries = Array.from({ length: nQueries }, (_, i) => Math.floor(i * population / nQueries));
  const synth = quantiles(nearestCosines(pop, fullQueries));
  console.log(`synthetic at ${population} vectors: ${JSON.stringify(synth)}`);
  const record = {
    desk: FEATURES[key].feature,
    slug: key,
    source: SOURCE,
    measured: new Date().toISOString(),
    sigma: +sigma.toFixed(5),
    noise_norm: +noiseNorm(sigma).toFixed(3),
    sibling_cosine: +siblingCosine(sigma).toFixed(3),
    method: 'exact nearest-neighbour cosine to any other chunk of the desk; sequential scan, read only',
    real: { desk_chunks: total, ...realQ },
    synthetic: { population, pool_vectors: (await loadPool(key))?.count, ...synth },
  };
  await Deno.writeTextFile(`${CACHE_DIR}/sigma-${key}.json`, JSON.stringify(record, null, 1));
  console.log(`sigma-${key}.json written: sigma ${record.sigma}`);
}
