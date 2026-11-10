import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  acceptBatch,
  type AcceptDb,
  type LinkKey,
  type ProbeResult,
  type SampleItem,
  type StoredDoc,
} from './acceptance.ts';

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
  const rowKey = (sourceKey: string) => `desk-record:["national","${BILLS}","${sourceKey}"]`;
  /** Each document's listing rows, found through its document_key (as for Bills) unless a test says otherwise. */
  const keys = new Map<string, LinkKey[]>(
    items.map((it) => [it.document_id, [{ key: rowKey(it.source_key), via: 'document_key' }]]),
  );
  const coverage = new Map<string, string>();
  /** What the resolver gives a row: by default, the document keyed to it, at that row's coverage. */
  const resolved = new Map<string, Array<{ document_id: string | null; coverage: string }>>();
  /** Per document, what each probe attempt finds (attempt 0 is the first chunk); null means no vector there. */
  const probes = new Map<string, Array<ProbeResult | null>>();
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
      return Promise.resolve(ks.flatMap((k) => {
        const own = resolved.get(k) ??
          [{
            document_id: [...keys].find(([, ls]) => ls.some((l) => l.key === k))?.[0] ?? null,
            coverage: coverage.get(k) ?? 'full',
          }];
        return own.map((r) => ({ document_key: k, ...r }));
      }));
    },
    probe: (doc, attempt) => {
      calls.push(`probe ${doc.id} ${attempt}`);
      const own = probes.get(doc.id);
      if (own) return Promise.resolve(own[attempt] ?? null);
      return Promise.resolve({
        content: `text of ${doc.id}`,
        rows: [
          { document_id: doc.id, similarity: 1, content: `text of ${doc.id}` },
          { document_id: id(9999), similarity: 0.7, content: 'other text' },
        ],
      });
    },
  };
  return { db, items, stored, keys, coverage, resolved, probes, calls, rowKey };
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
    ['link_not_full', (x) => x.coverage.set(x.keys.get(id(3))![0].key, 'partial')],
    ['probe_empty', (x) => x.probes.set(id(3), [{ content: 'a', rows: [] }])],
    ['probe_empty', (x) => x.probes.set(id(3), [null])],
    [
      'probe_not_first',
      (x) =>
        x.probes.set(id(3), [{
          content: 'own',
          rows: [{ document_id: id(9999), similarity: 0.99, content: 'other' }, {
            document_id: id(3),
            similarity: 0.98,
            content: 'own',
          }],
        }]),
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
  x.probes.set(id(2), [{
    content: 'same',
    rows: [{ document_id: id(9999), similarity: 1, content: 'same' }, {
      document_id: id(2),
      similarity: 1,
      content: 'same',
    }],
  }]);
  assertEquals((await acceptBatch(x.db, BATCH, OPT)).ok, true);
});

/** Ten other documents holding the probe's text word for word fill the top ten; the document itself is not returned. */
const shared = (text: string): ProbeResult => ({
  content: text,
  rows: Array.from({ length: 10 }, (_, i) => ({ document_id: id(5000 + i), similarity: 1, content: text })),
});

Deno.test('F313: a first chunk shared word for word with other documents is set aside and the next chunk decides', async () => {
  const x = healthy(5);
  x.probes.set(id(2), [
    shared('THE GAZETTE OF INDIA  EXTRAORDINARY'),
    { content: 'own', rows: [{ document_id: id(2), similarity: 1, content: 'own' }] },
  ]);
  const r = await acceptBatch(x.db, BATCH, OPT);
  assertEquals(r.ok, true, JSON.stringify(r.failures));
  assert(x.calls.includes(`probe ${id(2)} 1`));
});

Deno.test('F313: shared text counts the same with different spacing', async () => {
  const x = healthy(5);
  x.probes.set(id(2), [
    { ...shared('THE GAZETTE OF INDIA\n EXTRAORDINARY'), content: 'THE GAZETTE OF INDIA EXTRAORDINARY ' },
    { content: 'own', rows: [{ document_id: id(2), similarity: 1, content: 'own' }] },
  ]);
  assertEquals((await acceptBatch(x.db, BATCH, OPT)).ok, true);
});

Deno.test('F313: a different text ranked above the document still fails, shared rows or not', async () => {
  const x = healthy(5);
  const p = shared('heading');
  p.rows[4] = { document_id: id(6000), similarity: 1, content: 'a different passage' };
  x.probes.set(id(2), [p, { content: 'own', rows: [{ document_id: id(2), similarity: 1, content: 'own' }] }]);
  const r = await acceptBatch(x.db, BATCH, OPT);
  assertEquals(r.failures.map((f) => [f.source_key, f.check]), [['k2', 'probe_not_first']]);
  assert(!x.calls.includes(`probe ${id(2)} 1`), 'a real failure is not retried');
});

Deno.test('F313: when every tried chunk is shared, the probe fails and says so', async () => {
  const x = healthy(5);
  x.probes.set(id(2), [shared('a'), shared('b'), shared('c'), shared('d')]);
  const r = await acceptBatch(x.db, BATCH, OPT);
  assertEquals(r.failures.map((f) => [f.source_key, f.check]), [['k2', 'probe_not_first']]);
  assert(/shared/.test(r.failures[0].detail ?? ''), r.failures[0].detail);
  assertEquals(x.calls.filter((c) => c.startsWith(`probe ${id(2)} `)).length, 3);
});

Deno.test('F313: a document whose only chunks are shared fails when it runs out of chunks', async () => {
  const x = healthy(5);
  x.probes.set(id(2), [shared('a'), null]);
  const r = await acceptBatch(x.db, BATCH, OPT);
  assertEquals(r.failures.map((f) => [f.source_key, f.check]), [['k2', 'probe_not_first']]);
});

Deno.test("F316: another bill's row on a shared key is not one of the document's links", async () => {
  // The Bills of Lading document's key is also the Constitution (130th Amendment) row's; the resolver gives that row
  // only its own held document, so it is not this document's link and its coverage does not count.
  const x = healthy(5);
  const other = x.rowKey('constitution-130');
  x.keys.get(id(2))!.push({ key: other, via: 'document_key' });
  x.resolved.set(other, [{ document_id: null, coverage: 'registered' }]);
  const r = await acceptBatch(x.db, BATCH, OPT);
  assertEquals(r.ok, true, JSON.stringify(r.failures));
});

Deno.test("F316: the document's own row still fails when another document of its bill is missing", async () => {
  // As The Indian Institutes of Management (Amendment) Bill, 2025: the row resolves to this document and to a held one.
  const x = healthy(5);
  const own = x.keys.get(id(2))![0].key;
  x.resolved.set(own, [{ document_id: id(2), coverage: 'partial' }, { document_id: null, coverage: 'partial' }]);
  const r = await acceptBatch(x.db, BATCH, OPT);
  assertEquals(r.failures.map((f) => [f.source_key, f.check]), [['k2', 'link_not_full']]);
});

Deno.test('F316: an approved link counts even when the resolver holds the document back', async () => {
  // A link the reviewer approved whose identity no longer matches: the resolver returns no document, state "held".
  const x = healthy(5);
  const linked = x.rowKey('pq-row');
  x.keys.set(id(2), [{ key: linked, via: 'link' }]);
  x.resolved.set(linked, [{ document_id: null, coverage: 'held' }]);
  const r = await acceptBatch(x.db, BATCH, OPT);
  assertEquals(r.failures.map((f) => [f.source_key, f.check, f.detail]), [[
    'k2',
    'link_not_full',
    '1 of 1 listing links: held',
  ]]);
});

Deno.test('F316: a document no row of its key resolves to has no listing link', async () => {
  // On a shared key, a document titled as neither bill: the record would not show it.
  const x = healthy(5);
  const own = x.keys.get(id(2))![0].key;
  x.resolved.set(own, [{ document_id: id(4000), coverage: 'full' }]);
  const r = await acceptBatch(x.db, BATCH, OPT);
  assertEquals(r.failures.map((f) => [f.source_key, f.check]), [['k2', 'no_listing_link']]);
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
