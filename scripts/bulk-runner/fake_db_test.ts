import { assert, assertEquals } from 'jsr:@std/assert@1';
import { FakeDb } from './fake_db.ts';
import { LIMITS, many } from './fixtures.ts';
import { plan } from './plan.ts';

// The fake must behave as the real functions do, or every runner test built on it proves nothing.
async function sealed(db: FakeDb, n = 3, collection = 'bills') {
  const p = await plan(many(n), LIMITS);
  if (!p.ok) throw new Error(p.stop);
  const b = p.batches[0];
  const o = await db.open({
    collection,
    manifest_sha256: b.manifest_sha256,
    items_planned: b.items_planned,
    chunks_planned: b.chunks_planned,
    est_tokens: b.est_tokens,
    est_cost_usd: b.est_cost_usd,
    runner_commit: 'abcdef1',
  });
  if (!('batch_id' in o)) throw new Error('open refused');
  await db.addItems(o.batch_id, b.items);
  return { id: o.batch_id, b, seal: () => db.seal(o.batch_id) };
}

Deno.test('seal refuses what the real one refuses: sums that differ from the manifest, and over_policy_ceiling', async () => {
  const db = new FakeDb();
  const x = await sealed(db);
  assertEquals((await x.seal()).state, 'sealed');

  const wrong = new FakeDb();
  const p = await plan(many(3), LIMITS);
  if (!p.ok) throw new Error();
  const o = await wrong.open({
    collection: 'bills',
    manifest_sha256: p.batches[0].manifest_sha256,
    items_planned: 3,
    chunks_planned: 99,
    est_tokens: 30,
    est_cost_usd: 1,
    runner_commit: 'abcdef1',
  });
  if (!('batch_id' in o)) throw new Error();
  await wrong.addItems(o.batch_id, p.batches[0].items);
  assertEquals((await wrong.seal(o.batch_id)).refused, 'manifest_hash_mismatch');

  const small = new FakeDb();
  small.policy.chunk_ceiling = 5;
  const first = await sealed(small, 3);
  assertEquals((await first.seal()).state, 'sealed');
  const p2 = await plan(
    many(4).map((r, i) => ({
      ...r,
      source_key: `z${i}`,
      item: { ...r.item, source_key: `z${i}`, content_sha256: `${i}`.padStart(64, 'e') },
    })),
    LIMITS,
  );
  if (!p2.ok) throw new Error();
  const o2 = await small.open({
    collection: 'bills',
    manifest_sha256: p2.batches[0].manifest_sha256,
    items_planned: 4,
    chunks_planned: 4,
    est_tokens: p2.batches[0].est_tokens,
    est_cost_usd: 1,
    runner_commit: 'abcdef1',
  });
  if (!('batch_id' in o2)) throw new Error();
  await small.addItems(o2.batch_id, p2.batches[0].items);
  assertEquals((await small.seal(o2.batch_id)).refused, 'over_policy_ceiling');
  assertEquals((await small.status(o2.batch_id)).state, 'open');
});

Deno.test('a re-send of a decided item answers existing and changes nothing', async () => {
  const db = new FakeDb();
  const x = await sealed(db);
  await x.seal();
  const docs = x.b.requests.map((r) => r.request);
  const first = await db.register(x.id, docs, false, false);
  assertEquals(first.results.map((r) => r.outcome), ['admitted', 'admitted', 'admitted']);
  const again = await db.register(x.id, docs, false, false);
  assertEquals(again.results.map((r) => r.outcome), ['existing', 'existing', 'existing']);
  assertEquals((await db.status(x.id)).counts.admitted, 3);
});

Deno.test('existing_not_indexed counts existing items whose document is not indexed', async () => {
  const db = new FakeDb();
  db.existing.add('k000001');
  const x = await sealed(db);
  await x.seal();
  await db.register(x.id, x.b.requests.map((r) => r.request), false, false);
  const s = await db.status(x.id);
  assertEquals(s.counts.existing_not_indexed, 1);
  db.indexedExisting.add('k000001');
  assertEquals((await db.status(x.id)).counts.existing_not_indexed, 0);
});

Deno.test('the first requeue stops the batch when uncertain jobs exceed uncertain_max; the second requeue never happens', async () => {
  const db = new FakeDb();
  db.policy.stop_thresholds.uncertain_max = 0;
  db.failJobs.set('k000001', { times: 5, code: 'text_outcome_uncertain' });
  const x = await sealed(db);
  await x.seal();
  await db.register(x.id, x.b.requests.map((r) => r.request), false, false);
  // Only the one job runs, so the worker's own uncertain check is not what stops it.
  const b = db.batches.get(x.id)!;
  const job = b.jobs.get('job-k000001')!;
  job.status = 'failed';
  job.error_code = 'text_outcome_uncertain';
  job.attempts = 1;
  const r = await db.requeue(x.id, ['job-k000001']);
  assertEquals(r.results[0].reason, 'uncertain_count');
  assertEquals(r.state, 'stopped');

  const db2 = new FakeDb();
  const y = await sealed(db2);
  await y.seal();
  await db2.register(y.id, y.b.requests.map((q) => q.request), false, false);
  const j2 = db2.batches.get(y.id)!.jobs.get('job-k000001')!;
  j2.status = 'failed';
  j2.error_code = 'x';
  assertEquals((await db2.requeue(y.id, [j2.id])).results[0].outcome, 'requeued');
  j2.status = 'failed';
  assertEquals((await db2.requeue(y.id, [j2.id])).results[0].reason, 'failed_after_requeue');
});

Deno.test('the refusal share stops a batch on the call that passes it, not on a dry run', async () => {
  const db = new FakeDb();
  db.policy.stop_thresholds.refusal_share = 0.3;
  db.refuse.set('k000000', 'no_desk_row');
  db.refuse.set('k000001', 'no_desk_row');
  const x = await sealed(db, 4);
  await x.seal();
  const docs = x.b.requests.map((r) => r.request);
  const dry = await db.register(x.id, docs, true, false);
  assertEquals(dry.batch.state, 'sealed');
  const real = await db.register(x.id, docs, false, false);
  assertEquals(real.batch.state, 'stopped');
  assertEquals(real.batch.stop_reason, 'refusal_share:no_desk_row');
  const after = await db.register(x.id, docs, false, false);
  assert(
    after.results.every((r) => r.reason === 'batch_stopped' || r.outcome === 'existing' || r.reason === 'no_desk_row'),
  );
});

Deno.test('the worker does not claim a batch whose spend reached est_cost_usd', async () => {
  const db = new FakeDb();
  db.jobCost = 1;
  const x = await sealed(db, 3);
  await x.seal();
  await db.register(x.id, x.b.requests.map((r) => r.request), false, false);
  db.tick();
  const s = await db.status(x.id);
  assertEquals(s.state, 'stopped');
  assertEquals(s.stop_reason, 'spend_ceiling');
  assert(s.jobs.queued > 0, 'the rest was left unclaimed');
});
