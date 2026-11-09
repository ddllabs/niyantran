import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { acceptBatch, type AcceptDb, type SampleItem, type StoredDoc } from './acceptance.ts';

const BATCH = '0b6c2a52-6d7e-4b0e-9a55-3f2f8f0c1d11';
const BILLS = 'Bill Passage Probability Index';
const h = (n: number) => n.toString(16).padStart(64, '0');
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** A batch of `count` loaded documents where every check passes; tests then break one thing. */
function healthy(count: number) {
  const items: SampleItem[] = Array.from({ length: count }, (_, i) => ({
    source_key: `k${i}`,
    document_id: id(i),
    content_sha256: h(i),
    chunks: 3,
  }));
  const stored = new Map<string, StoredDoc>(items.map((it) => [it.document_id, {
    id: it.document_id,
    content_sha256: it.content_sha256,
    indexed: true,
    chunks: 3,
    vectors: 3,
    desk_tier: 'national',
    desk_feature: BILLS,
  }]));
  const keys = new Map<string, string[]>(
    items.map((it) => [it.document_id, [`desk-record:["national","${BILLS}","${it.source_key}"]`]]),
  );
  const coverage = new Map<string, string>();
  const probes = new Map<string, Array<{ document_id: string; similarity: number }>>();
  const calls: string[] = [];
  const db: AcceptDb = {
    sample: (batch, n) => {
      calls.push(`sample ${n}`);
      assertEquals(batch, BATCH);
      return Promise.resolve(items.slice(0, n));
    },
    stored: (ids) => Promise.resolve(ids.map((i) => stored.get(i)).filter((d): d is StoredDoc => !!d)),
    linkKeys: (ids) => Promise.resolve(Object.fromEntries(ids.map((i) => [i, keys.get(i) ?? []]))),
    resolve: (ks) => {
      calls.push(`resolve ${ks.length}`);
      return Promise.resolve(
        ks.map((k) => ({ document_key: k, document_id: null, coverage: coverage.get(k) ?? 'full' })),
      );
    },
    probe: (doc) =>
      Promise.resolve(
        probes.get(doc.id) ?? [{ document_id: doc.id, similarity: 1 }, { document_id: id(9999), similarity: 0.7 }],
      ),
  };
  return { db, items, stored, keys, coverage, probes, calls };
}

const OPT = { sample: 50, requireLinks: true };

Deno.test('a healthy batch passes, sampling at most the configured number', async () => {
  const t = healthy(80);
  const r = await acceptBatch(t.db, BATCH, OPT);
  assertEquals(r.ok, true, JSON.stringify(r.failures));
  assertEquals(r.sampled, 50);
  assertEquals(t.calls[0], 'sample 50');
});

Deno.test('a small batch is checked whole', async () => {
  const r = await acceptBatch(healthy(7).db, BATCH, OPT);
  assertEquals([r.ok, r.sampled], [true, 7]);
});

Deno.test('nothing to check is not an acceptance', async () => {
  const r = await acceptBatch(healthy(0).db, BATCH, OPT);
  assertEquals(r.ok, false);
  assertEquals(r.failures[0].check, 'nothing_to_check');
});

Deno.test('each check fails by name for the document it catches, and only that one', async (t) => {
  const cases: Array<[string, (x: ReturnType<typeof healthy>) => void]> = [
    ['missing_document', (x) => x.stored.delete(id(3))],
    ['not_indexed', (x) => (x.stored.get(id(3))!.indexed = false)],
    ['text_hash', (x) => (x.stored.get(id(3))!.content_sha256 = h(777))],
    ['chunk_count', (x) => (x.stored.get(id(3))!.chunks = 2)],
    ['vectors', (x) => (x.stored.get(id(3))!.vectors = 2)],
    ['no_listing_link', (x) => x.keys.set(id(3), [])],
    ['link_not_full', (x) => x.coverage.set(x.keys.get(id(3))![0], 'partial')],
    ['probe_empty', (x) => x.probes.set(id(3), [])],
    [
      'probe_not_first',
      (x) =>
        x.probes.set(id(3), [{ document_id: id(9999), similarity: 0.99 }, { document_id: id(3), similarity: 0.98 }]),
    ],
  ];
  for (const [check, breakIt] of cases) {
    await t.step(check, async () => {
      const x = healthy(10);
      breakIt(x);
      const r = await acceptBatch(x.db, BATCH, OPT);
      assertEquals(r.ok, false);
      assertEquals(r.failures.map((f) => [f.source_key, f.check]), [['k3', check]]);
    });
  }
});

Deno.test('a document tied at the top similarity counts as first (an identical text kept elsewhere)', async () => {
  const x = healthy(5);
  x.probes.set(id(2), [{ document_id: id(9999), similarity: 1 }, { document_id: id(2), similarity: 1 }]);
  assertEquals((await acceptBatch(x.db, BATCH, OPT)).ok, true);
});

Deno.test('links are optional only when the collection says so', async () => {
  const x = healthy(5);
  x.keys.set(id(1), []);
  assertEquals((await acceptBatch(x.db, BATCH, OPT)).ok, false);
  assertEquals((await acceptBatch(x.db, BATCH, { ...OPT, requireLinks: false })).ok, true);
});

Deno.test('keys are resolved at most 24 at a time, the resolver’s own limit', async () => {
  const x = healthy(30);
  const r = await acceptBatch(x.db, BATCH, OPT);
  assert(r.ok);
  for (const c of x.calls.filter((c) => c.startsWith('resolve '))) assert(Number(c.split(' ')[1]) <= 24, c);
});

Deno.test('a sample size outside 1 to 1000 is refused', async () => {
  for (const sample of [0, -1, 1.5, 1001]) {
    await assertRejects(() => acceptBatch(healthy(5).db, BATCH, { ...OPT, sample }), Error, 'sample');
  }
});

Deno.test('a database error is not an acceptance: it throws, and the runner stops with awaiting_acceptance', async () => {
  const x = healthy(5);
  x.db.probe = () => Promise.reject(new Error('psql exited 2'));
  await assertRejects(() => acceptBatch(x.db, BATCH, OPT), Error, 'psql');
});
