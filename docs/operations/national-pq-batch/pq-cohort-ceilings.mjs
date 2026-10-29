// Per-document exact chunk count and conservative cost ceiling, computed exactly as scripts/corpus-text-import.mjs
// does (prepareSuppliedText + embedding_input bytes x price x 3), for choosing a cohort inside the owner's limits.
// Offline. Usage: node --experimental-strip-types pq-cohort-ceilings.mjs <corpus.jsonl> <keys.txt>  -> JSON lines
import { readFile } from 'node:fs/promises';
import { EMBED_PRICE_USD_PER_TOKEN } from '../../../supabase/functions/_shared/embed.ts';
import { prepareSuppliedText } from '../../../supabase/functions/_shared/suppliedText.ts';
const [corpus, keysFile] = process.argv.slice(2);
const keys = (await readFile(keysFile, 'utf8')).split('\n').map(s => s.trim()).filter(Boolean);
const recs = new Map((await readFile(corpus, 'utf8')).split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return [r.source_key, r]; }));
for (const [i, k] of keys.entries()) {
  const r = recs.get(k);
  if (!r) { console.log(JSON.stringify({ order: i, source_key: k, error: 'not in corpus' })); continue; }
  // The review only gates validation; it does not change chunking or the ceiling. This probe review is never submitted.
  const review = { status: 'eligible', source_key: k, text_sha256: r.text_sha256, rules_sha256: '0'.repeat(64),
    package_id: 'probe', mapping_version: 'probe', decision_id: 'probe-not-submitted',
    checks: { identity: true, completeness: true, sensitivity: true, dedupe: true, rights: true } };
  const p = await prepareSuppliedText({ ...r, review });
  const ceiling = p.chunks.reduce((n, c) => n + Buffer.byteLength(c.embedding_input, 'utf8'), 0) * EMBED_PRICE_USD_PER_TOKEN * 3;
  console.log(JSON.stringify({ order: i, source_key: k, chunks: p.chunks.length, ceiling_usd: ceiling }));
}
