// Builds the pools the load uses, from niyantran_rehearsal_b9final (read only), into
// ~/niyantran-eval-cache/load-proof/ (outside the repository; these are real client chunks):
//
//   pool-<slug>.f32      real chunk vectors of the desk, Float32, 1536 each (the fake embedder's base)
//   text-<slug>.json     real chunk text of the desk, used as the paragraphs of synthetic documents
//   counts-<slug>.json   chunks per document of the desk (its real distribution)
//
//   deno run -A scripts/load-proof/pool.ts --feature bills [--vectors 3000] [--texts 5000] [--docs 20000]
//
// The rehearsal database is only read, inside a read-only transaction. Nothing is written to it.

import { CACHE_DIR, psql } from './lib.ts';
import { type FeatureKey, FEATURES } from './synth.ts';

const SOURCE = 'niyantran_rehearsal_b9final';
const arg = (flag: string, fallback?: string) => {
  const i = Deno.args.indexOf(flag);
  return i >= 0 ? Deno.args[i + 1] : fallback;
};

const key = (arg('--feature') ?? '') as FeatureKey;
if (!(key in FEATURES) || key === 'other') {
  throw new Error(`--feature must be one of ${Object.keys(FEATURES).filter((k) => k !== 'other').join(', ')}`);
}
const feature = FEATURES[key].feature.replaceAll("'", "''");
const nVectors = Number(arg('--vectors', '3000')),
  nTexts = Number(arg('--texts', '5000')),
  nDocs = Number(arg('--docs', '20000'));
for (const n of [nVectors, nTexts, nDocs]) {
  if (!Number.isInteger(n) || n < 0) throw new Error('counts must be non-negative integers');
}

const ro = (sql: string) => `begin read only; ${sql}; commit;`;
const roJson = async <T>(sql: string) =>
  JSON.parse(await psql(ro(`select coalesce(json_agg(t), '[]'::json) from (${sql}) t`), { db: SOURCE })) as T;
await Deno.mkdir(CACHE_DIR, { recursive: true });

if (nVectors) {
  // A stride over the hash of the id spreads the sample over the desk without sorting it.
  const total = Number(
    await psql(ro(`select count(*) from public.document_chunks where desk_feature = '${feature}'`), { db: SOURCE }),
  );
  const stride = Math.max(1, Math.floor(total / nVectors));
  const rows = (await psql(
    ro(
      `select embedding::text from public.document_chunks where desk_feature = '${feature}' and embedding is not null and (abs(hashtext(id::text)) % ${stride}) = 0 limit ${nVectors}`,
    ),
    { db: SOURCE },
  )).split('\n').filter((l) => l.startsWith('['));
  const data = new Float32Array(rows.length * 1536);
  rows.forEach((line, i) => {
    const v = line.slice(1, -1).split(',');
    if (v.length !== 1536) throw new Error(`a vector of width ${v.length}`);
    for (let j = 0; j < 1536; j++) data[i * 1536 + j] = Number(v[j]);
  });
  await Deno.writeFile(`${CACHE_DIR}/pool-${key}.f32`, new Uint8Array(data.buffer));
  console.log(`pool-${key}.f32: ${rows.length} vectors of ${total} chunks`);
}
if (nTexts) {
  const rows = await roJson<Array<{ content: string }>>(
    `select content from public.document_chunks where desk_feature = '${feature}' and length(content) between 200 and 3000 order by random() limit ${nTexts}`,
  );
  await Deno.writeTextFile(`${CACHE_DIR}/text-${key}.json`, JSON.stringify(rows.map((r) => r.content)));
  console.log(`text-${key}.json: ${rows.length} chunk texts`);
}
if (nDocs) {
  const rows = await roJson<Array<{ n: number }>>(
    `select n from (select count(*)::int n from public.document_chunks where desk_feature = '${feature}' group by document_id) x order by random() limit ${nDocs}`,
  );
  await Deno.writeTextFile(`${CACHE_DIR}/counts-${key}.json`, JSON.stringify(rows.map((r) => r.n)));
  console.log(`counts-${key}.json: ${rows.length} documents`);
}
