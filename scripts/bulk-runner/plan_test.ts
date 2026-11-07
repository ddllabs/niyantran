import { assert, assertEquals } from 'jsr:@std/assert@1';
import { manifestSha256 } from '../../src/lib/batchManifest.js';
import { callEnd, MAX_CALL_BYTES, plan, type PlanLimits, splitCalls } from './plan.ts';
import type { PreparedRequest } from './prepare.ts';
import { fake, hex, LIMITS, many } from './fixtures.ts';

const run = (requests: PreparedRequest[], over: Partial<PlanLimits> = {}) => plan(requests, { ...LIMITS, ...over });

Deno.test('batches hold at most 10,000 documents, in source_key order whatever the input order', async () => {
  const reqs = many(10_001);
  const p = await run(reqs);
  assert(p.ok);
  assertEquals(p.batches.map((b) => b.requests.length), [10_000, 1]);
  const shuffled = [...reqs].reverse();
  const q = await run(shuffled);
  assert(q.ok);
  assertEquals(q.batches.map((b) => b.manifest_sha256), p.batches.map((b) => b.manifest_sha256));
  assertEquals(p.batches[0].requests[0].source_key, 'k000000');
});

Deno.test('a batch carries the manifest hash the database will recompute, and its counts', async () => {
  const reqs = many(5, { chunks: 3, tokens: 1000 });
  const p = await run(reqs);
  assert(p.ok);
  const b = p.batches[0];
  assertEquals(b.manifest_sha256, await manifestSha256(reqs.map((r) => r.item)));
  assertEquals(b.items.length, 5);
  assertEquals(b.chunks_planned, 15);
  assertEquals(b.est_tokens, 5000);
  assert(Math.abs(b.est_cost_usd - 0.000125) < 1e-12, `${b.est_cost_usd}: 1.25 times the estimate by default`);
  const free = await run(many(1, { tokens: 0 }));
  assert(free.ok && free.batches[0].est_cost_usd > 0, 'ingest_batch_open refuses a cost of zero');
});

Deno.test('calls hold at most 100 documents', () => {
  const r = many(250);
  assertEquals(callEnd(r, 0), 100);
  assertEquals(callEnd(r, 100), 200);
  assertEquals(callEnd(r, 200), 250);
  assertEquals(splitCalls(r), [{ start: 0, end: 100 }, { start: 100, end: 200 }, { start: 200, end: 250 }]);
});

Deno.test('calls hold at most 7 MB counted on the whole request, not on the text', () => {
  const per = 1_000_000;
  const r = many(20, { bytes: per });
  const end = callEnd(r, 0);
  assert(end >= 6 && end <= 7, `${end} documents of about 1 MB`);
  const bytes = r.slice(0, end).reduce((s, x) => s + new TextEncoder().encode(JSON.stringify(x.request)).length + 1, 0);
  assert(bytes <= MAX_CALL_BYTES);
  // Small payload, large chunk plan: the plan counts.
  const heavy = many(10).map((x) => ({ ...x, request: { ...x.request, expected: ['y'.repeat(2_000_000)] } }));
  assertEquals(callEnd(heavy, 0), 3);
});

Deno.test('a document over the byte limit travels alone, and still makes progress', () => {
  const r = [fake(0), fake(1, { bytes: MAX_CALL_BYTES + 5 }), fake(2)];
  assertEquals(splitCalls(r), [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }]);
  assertEquals(callEnd([fake(1, { bytes: MAX_CALL_BYTES + 5 })], 0), 1);
});

Deno.test('a feature with no partition past 100,000 chunks is refused to start; at the line it is not', async () => {
  const feature = 'Proof Feature Without A Partition';
  const known = { chunksNow: { [feature]: 0 } };
  const at = await run(many(125, { feature, chunks: 800 }), known);
  assertEquals(at.ok, true);
  const over = await run(many(125, { feature, chunks: 800 }).concat(fake(999, { feature, chunks: 1 })), known);
  assert(!over.ok);
  assertEquals(over.stop, 'unpartitioned_feature_over_100k');
  // Chunks already stored count toward the line.
  const stored = await run(many(1, { feature, chunks: 1 }), { chunksNow: { [feature]: 100_000 } });
  assertEquals(!stored.ok && stored.stop, 'unpartitioned_feature_over_100k');
  // A partitioned feature may pass it.
  const part = await run(many(200, { chunks: 800 }));
  assertEquals(part.ok, true);
});

Deno.test('the collection budget: cumulative over batches, refused past it and not at it', async () => {
  // 10,001 documents of 1,000,000 tokens at $0.02 per million: $0.02 each.
  const reqs = many(10_001, { tokens: 1_000_000 });
  const first = 10_000 * 0.02;
  const ok = await run(reqs, { budgetUsd: first + 0.02 + 1e-9, costHeadroom: 1 });
  assertEquals(ok.ok, true);
  const over = await run(reqs, { budgetUsd: first + 0.02 - 0.001, costHeadroom: 1 });
  assert(!over.ok);
  assertEquals(over.stop, 'over_budget');
  const one = await run(many(2, { tokens: 1_000_000 }), { budgetUsd: 0.039, costHeadroom: 1 });
  assertEquals(!one.ok && one.stop, 'over_budget');
});

Deno.test('the collection chunk ceiling: refused one chunk past it, not at it', async () => {
  assertEquals((await run(many(10, { chunks: 5 }), { chunkCeiling: 50 })).ok, true);
  const over = await run(many(10, { chunks: 5 }), { chunkCeiling: 49 });
  assertEquals(!over.ok && over.stop, 'over_chunk_ceiling');
});

Deno.test('projected disk use at 13,970 bytes a chunk against the stop line', async () => {
  const reqs = many(10, { chunks: 100 }); // 1,000 chunks
  const need = 1000 * 13_970;
  assertEquals((await run(reqs, { diskUsedBytes: 1000, diskStopBytes: 1000 + need })).ok, true);
  const over = await run(reqs, { diskUsedBytes: 1000, diskStopBytes: 1000 + need - 1 });
  assertEquals(!over.ok && over.stop, 'disk_over_stop_line');
});

Deno.test('two records with one text are refused unless the pack names the keeper', async () => {
  const text = hex(7, 'd');
  const reqs = [fake(1, { text }), fake(2, { text }), fake(3)];
  const refused = await run(reqs);
  assert(!refused.ok);
  assertEquals(refused.stop, 'duplicate_text');

  const kept = await run(reqs, { dedupe: { [text]: 'k000002' } });
  assert(kept.ok);
  assertEquals(kept.batches[0].requests.map((r) => r.source_key), ['k000002', 'k000003']);
  assertEquals(kept.holds, [{ source_key: 'k000001', reason: 'duplicate_of_keeper', detail: 'k000002' }]);

  // A keeper that is not one of the records sharing the text names nobody.
  const stranger = await run(reqs, { dedupe: { [text]: 'k000009' } });
  assertEquals(!stranger.ok && stranger.stop, 'duplicate_text');
});

Deno.test('one source_key twice, and nothing to load, are refused by name', async () => {
  const twice = await run([fake(1), {
    ...fake(2),
    source_key: 'k000001',
    item: { ...fake(2).item, source_key: 'k000001' },
  }]);
  assertEquals(!twice.ok && twice.stop, 'duplicate_source_key');
  const none = await run([]);
  assertEquals(!none.ok && none.stop, 'nothing_to_load');
});

Deno.test('an item the database would refuse at add_items is a named stop, not a throw', async () => {
  const bad = await run([fake(1, { chunks: 801 })]);
  assertEquals(!bad.ok && bad.stop, 'bad_manifest_item');
});

Deno.test('a feature with no partition and no stored-chunk count is refused: chunks_unknown', async () => {
  const feature = 'Proof Feature Without A Partition';
  const unknown = await run(many(3, { feature }));
  assertEquals(!unknown.ok && unknown.stop, 'chunks_unknown');
  assertEquals((await run(many(3, { feature }), { chunksNow: { [feature]: 0 } })).ok, true);
  // A partitioned feature does not need the count.
  assertEquals((await run(many(3))).ok, true);
});

Deno.test('est_cost_usd carries headroom for estimate error and one requeue, and the budget guard uses that figure', async () => {
  const reqs = many(10, { tokens: 1_000_000 }); // $0.20 raw
  const raw = 10 * 0.02;
  const dflt = await run(reqs, { budgetUsd: 1000 });
  assert(dflt.ok);
  assert(Math.abs(dflt.batches[0].est_cost_usd - raw * 1.25) < 1e-9, String(dflt.batches[0].est_cost_usd));
  const two = await run(reqs, { budgetUsd: 1000, costHeadroom: 2 });
  assert(two.ok && Math.abs(two.batches[0].est_cost_usd - raw * 2) < 1e-9);
  // A budget that fits the raw estimate but not the headroom is refused.
  const tight = await run(reqs, { budgetUsd: raw * 1.1 });
  assertEquals(!tight.ok && tight.stop, 'over_budget');
  assertEquals((await run(reqs, { budgetUsd: raw * 1.1, costHeadroom: 1 })).ok, true);
});
