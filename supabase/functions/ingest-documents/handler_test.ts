import { assert, assertEquals } from 'jsr:@std/assert@1';
import { EMBED_DIMS, EmbeddingError, type EmbedResult } from '../_shared/embed.ts';
import { CHUNK } from '../_shared/chunking.ts';
import { handleIngest, type CallLogRow, type CommitRow, type DocumentRow, type IngestDeps } from './handler.ts';

const SECRET = 'sb_secret_test_value';

interface Stored {
  id: string;
  row: DocumentRow;
  chunker_version: number | null;
  hashes: Map<string, CommitRow>;
}

/** An in-memory stand-in for the four tables the function touches. */
function fakeDb() {
  const docs = new Map<string, Stored>();
  const logs: CallLogRow[] = [];
  const metaUpdates: string[] = [];
  let seq = 0;
  const db: IngestDeps['db'] = {
    findDocument: (key) => {
      const d = docs.get(key);
      return Promise.resolve(d ? { id: d.id, content_sha256: d.row.content_sha256, chunker_version: d.chunker_version, metadata: d.row.metadata } : null);
    },
    upsertDocument: (row) => {
      let d = docs.get(row.source_key);
      if (!d) {
        d = { id: `doc-${++seq}`, row, chunker_version: null, hashes: new Map() };
        docs.set(row.source_key, d);
      } else {
        d.row = row;
        d.chunker_version = null;
      }
      return Promise.resolve({ id: d.id });
    },
    updateDocumentMeta: (id, fields) => {
      const d = [...docs.values()].find((x) => x.id === id)!;
      d.row = { ...d.row, ...fields };
      metaUpdates.push(id);
      return Promise.resolve();
    },
    existingHashes: (id) => {
      const d = [...docs.values()].find((x) => x.id === id);
      return Promise.resolve(new Set(d ? d.hashes.keys() : []));
    },
    chunkCommit: (id, rows, keep) => {
      const d = [...docs.values()].find((x) => x.id === id)!;
      let deleted = 0;
      for (const h of [...d.hashes.keys()]) if (!keep.includes(h)) (d.hashes.delete(h), deleted++);
      let inserted = 0;
      let kept = 0;
      for (const r of rows) {
        if (d.hashes.has(r.chunk_hash)) kept++;
        else {
          if (!r.embedding) throw new Error(`new chunk ${r.chunk_hash} has no embedding`);
          d.hashes.set(r.chunk_hash, r);
          inserted++;
        }
      }
      return Promise.resolve({ inserted, kept, deleted });
    },
    markIndexed: (id, v) => {
      const d = [...docs.values()].find((x) => x.id === id)!;
      d.chunker_version = v;
      return Promise.resolve();
    },
    logCall: (row) => {
      logs.push(row);
      return Promise.resolve();
    },
  };
  return { db, docs, logs, metaUpdates };
}

function fakeEmbed(calls: string[][]): IngestDeps['embed'] {
  return (inputs) => {
    calls.push(inputs);
    const r: EmbedResult = {
      vectors: inputs.map(() => new Array(EMBED_DIMS).fill(0.1)),
      model: 'openai/text-embedding-3-small',
      promptTokens: inputs.join('').length / 4,
      costUsd: (inputs.join('').length / 4) * 2e-8,
      requests: 1,
    };
    return Promise.resolve(r);
  };
}

function post(body: unknown, bearer = SECRET, method = 'POST'): Request {
  return new Request('https://x.test/ingest-documents', {
    method,
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

function longText(seed: string): string {
  const s: string[] = [];
  for (let i = 0; i < 40; i++) s.push(`${seed} sentence ${i} says something about clause ${i % 5}.`);
  return s.join(' ');
}

Deno.test('401 without the secret bearer; 405 on GET; 400 without a documents array', async () => {
  const { db } = fakeDb();
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed([]), db };
  assertEquals((await handleIngest(post({ documents: [] }, 'wrong'), deps)).status, 401);
  assertEquals((await handleIngest(post(null, SECRET, 'GET'), deps)).status, 405);
  assertEquals((await handleIngest(post({ nope: 1 }), deps)).status, 400);
});

Deno.test('a new document is chunked, embedded and committed; an unchanged one makes no embed call', async () => {
  const { db, docs, logs, metaUpdates } = fakeDb();
  const calls: string[][] = [];
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed(calls), db };
  const doc = { source_key: 'A', title: 'Doc A', ocr_text: longText('alpha'), metadata: { ocr_lang: 'eng' } };

  const first = await (await handleIngest(post({ documents: [doc] }), deps)).json();
  assertEquals(first.results[0].status, 'indexed');
  assert(first.results[0].chunks >= 2, `expected several chunks, got ${first.results[0].chunks}`);
  assertEquals(first.results[0].inserted, first.results[0].chunks);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].length, first.results[0].chunks);
  assertEquals(docs.get('A')!.chunker_version, CHUNK.version);
  assertEquals(docs.get('A')!.row.metadata, { ocr_lang: 'eng' });
  assertEquals(logs.length, 1);
  assertEquals(logs[0].caller, 'ingest-documents');
  assertEquals(logs[0].purpose, 'embedding');
  assertEquals(logs[0].status, 'success');
  assert(logs[0].cost_usd > 0);
  assertEquals(first.totals.indexed, 1);

  const second = await (await handleIngest(post({ documents: [{ ...doc, title: 'Doc A, retitled', file_url: 'https://e.org/a.pdf', metadata: { document_key: 'bill:2019:55' } }] }), deps)).json();
  assertEquals(second.results[0].status, 'unchanged');
  assertEquals(second.results[0].kept, first.results[0].chunks);
  assertEquals(calls.length, 1, 'no second embed call');
  assertEquals(second.totals.unchanged, 1);
  // unchanged text still refreshes the descriptive fields
  assertEquals(metaUpdates, ['doc-1']);
  assertEquals(docs.get('A')!.row.title, 'Doc A, retitled');
  assertEquals(docs.get('A')!.row.file_url, 'https://e.org/a.pdf');
  assertEquals(docs.get('A')!.row.metadata, { ocr_lang: 'eng', document_key: 'bill:2019:55' });
  assertEquals(docs.get('A')!.chunker_version, CHUNK.version, 'still indexed');
});

Deno.test('a changed document embeds only the hash misses and keeps the rest', async () => {
  const { db, logs } = fakeDb();
  const calls: string[][] = [];
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed(calls), db };
  const text = `${longText('beta')}\n\n${longText('gamma')}\n\n${longText('delta')}`;
  const first = await (await handleIngest(post({ documents: [{ source_key: 'B', title: 'B', ocr_text: text }] }), deps)).json();
  const edited = text.replace('delta sentence 39', 'delta sentence 39 (amended)');
  const second = await (await handleIngest(post({ documents: [{ source_key: 'B', title: 'B', ocr_text: edited }] }), deps)).json();
  assertEquals(second.results[0].status, 'indexed');
  assert(second.results[0].kept >= 1, 'untouched chunks are kept');
  assert(second.results[0].inserted >= 1, 'the edited chunk is new');
  assertEquals(second.results[0].deleted, second.results[0].inserted);
  assertEquals(second.results[0].chunks, first.results[0].chunks);
  assertEquals(calls[1].length, second.results[0].inserted, 'only misses are embedded');
  assertEquals(logs.length, 2);
});

Deno.test('one failing document does not abort the batch; an embedding failure logs the cost already spent', async () => {
  const { db, logs } = fakeDb();
  let n = 0;
  const embed: IngestDeps['embed'] = (inputs) => {
    n++;
    if (n === 2) return Promise.reject(new EmbeddingError('embedding width 1535, expected 1536', { costUsd: 0.000004, promptTokens: 200 }, 200));
    return fakeEmbed([])(inputs);
  };
  const deps: IngestDeps = { secretKey: SECRET, embed, db };
  const body = {
    documents: [
      { source_key: 'ok1', title: 'ok', ocr_text: longText('one') },
      { source_key: 'bad', title: 'bad', ocr_text: longText('two') },
      { title: 'no key', ocr_text: 'x' },
      { source_key: 'ok2', title: 'ok', ocr_text: longText('three') },
    ],
  };
  const res = await (await handleIngest(post(body), deps)).json();
  assertEquals(res.results.map((r: { status: string }) => r.status), ['indexed', 'error', 'error', 'indexed']);
  assert(res.results[1].error.includes('1535'));
  assertEquals(res.results[2].error, 'source_key is required');
  assertEquals(res.totals, { ...res.totals, documents: 4, indexed: 2, errors: 2 });
  const failed = logs.find((l) => l.status === 'error')!;
  assertEquals(failed.prompt_tokens, 200);
  assertEquals(failed.cost_usd, 0.000004);
});

Deno.test('dry_run reports the counts and writes nothing', async () => {
  const { db, docs, logs } = fakeDb();
  const calls: string[][] = [];
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed(calls), db };
  const res = await (await handleIngest(post({ documents: [{ source_key: 'D', title: 'D', ocr_text: longText('dry') }], dry_run: true }), deps)).json();
  assertEquals(res.results[0].status, 'dry_run');
  assert(res.results[0].chunks >= 2);
  assertEquals(res.results[0].inserted, res.results[0].chunks);
  assertEquals(docs.size, 0);
  assertEquals(calls.length, 0);
  assertEquals(logs.length, 0);
});

Deno.test('more than 50 documents is refused', async () => {
  const { db } = fakeDb();
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed([]), db };
  const documents = Array.from({ length: 51 }, (_, i) => ({ source_key: `k${i}`, title: 't', ocr_text: 'x' }));
  assertEquals((await handleIngest(post({ documents }), deps)).status, 413);
});

Deno.test('sparse unchanged refresh preserves provenance and merges supplied metadata without embedding', async () => {
  const { db, docs } = fakeDb();
  const calls: string[][] = [];
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed(calls), db };
  const doc = { source_key: 'provenance', title: 'Original', ocr_text: 'Source text',
    metadata: { source_host: 'sansad.in', licence_class: 'unconfirmed', ocr_quality: 0.8,
      as_of: '2026-09-09', details: { issuer: 'owner', version: 1 }, retrieval_excluded: true } };
  await handleIngest(post({ documents: [doc] }), deps);
  const result = await (await handleIngest(post({ documents: [{ ...doc, title: 'Refreshed',
    metadata: { licence_class: null, source_host: '', ocr_quality: 0, retrieval_excluded: false,
      document_key: 'bill:2026:1', details: { version: 2 } } }] }), deps)).json();
  assertEquals(result.results[0].status, 'unchanged');
  assertEquals(calls.length, 1);
  assertEquals(docs.get('provenance')!.row.metadata, { source_host: 'sansad.in', licence_class: 'unconfirmed',
    ocr_quality: 0, as_of: '2026-09-09', details: { issuer: 'owner', version: 2 }, retrieval_excluded: false,
    document_key: 'bill:2026:1' });
});

Deno.test('changed-text ingestion retains omitted provenance and refreshes inherited text claims', async () => {
  const { db, docs } = fakeDb();
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed([]), db };
  const first = { source_key: 'revision', title: 'Revision', ocr_text: 'A', metadata: { licence_class: 'unconfirmed', n_chars: 1 } };
  await handleIngest(post({ documents: [first] }), deps);
  const result = await (await handleIngest(post({ documents: [{ source_key: 'revision', title: 'Revision', ocr_text: 'A😀' }] }), deps)).json();
  assertEquals(result.results[0].status, 'indexed');
  assertEquals(docs.get('revision')!.row.metadata, { licence_class: 'unconfirmed', n_chars: 2 });
});

Deno.test('declared Unicode count and exact UTF-8 hash are validated before any database write or embedding', async () => {
  const { db, docs, logs } = fakeDb();
  const calls: string[][] = [];
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed(calls), db };
  const text = 'A😀\r\n';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const sha = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
  const documents = [
    { source_key: 'bad-count', title: 'Count', ocr_text: text, metadata: { n_chars: text.length } },
    { source_key: 'bad-hash', title: 'Hash', ocr_text: text, metadata: { text_sha256: '0'.repeat(64) } },
    { source_key: 'bad-format', title: 'Hash', ocr_text: text, metadata: { text_sha256: 'invalid' } },
    { source_key: 'bad-count-type', title: 'Count', ocr_text: text, metadata: { n_chars: [4] } },
    { source_key: 'bad-metadata', title: 'Metadata', ocr_text: text, metadata: [{ n_chars: 0 }] },
    { source_key: 'ok', title: 'Good', ocr_text: text, metadata: { n_chars: 4, text_sha256: sha } },
  ];
  const result = await (await handleIngest(post({ documents }), deps)).json();
  assertEquals(result.results.map((r: {status: string}) => r.status), ['error', 'error', 'error', 'error', 'error', 'indexed']);
  assertEquals(result.totals.errors, 5);
  assertEquals([...docs.keys()], ['ok']);
  assertEquals(calls.length, 1);
  assertEquals(logs.length, 1);
});

Deno.test('duplicate source keys in one request are rejected before either revision writes', async () => {
  const { db, docs } = fakeDb();
  const calls: string[][] = [];
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed(calls), db };
  const result = await (await handleIngest(post({ documents: [
    { source_key: 'duplicate', title: 'First', ocr_text: 'First text' },
    { source_key: 'duplicate', title: 'Second', ocr_text: 'Second text' },
  ] }), deps)).json();
  assertEquals(result.totals.errors, 2);
  assertEquals(docs.size, 0);
  assertEquals(calls.length, 0);
});

Deno.test('Supabase adapter loads stored metadata for the merge (no server or network)', async () => {
  const serve = Deno.serve;
  try {
    // Capture the registration rather than start a real Edge Function listener.
    Deno.serve = (() => undefined) as unknown as typeof Deno.serve;
    const { supabaseDb } = await import('./index.ts');
    const stored = { id: 'stored', content_sha256: 'sha', chunker_version: 1, metadata: { licence_class: 'unconfirmed' } };
    const client = { from: () => ({ select: (columns: string) => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
      data: Object.fromEntries(columns.split(',').map((key) => [key.trim(), stored[key.trim() as keyof typeof stored]])), error: null,
    }) }) }) }) };
    const result = await supabaseDb(client as unknown as Parameters<typeof supabaseDb>[0]).findDocument('source');
    assertEquals(result?.metadata, stored.metadata);
  } finally { Deno.serve = serve; }
});

for (const [name, incoming, expected] of [
  ['ambiguous', { file_url_ambiguous: true, document_key: 'bill:2026:99' }, { file_url_ambiguous: true }],
  ['replacement bill', { file_url_ambiguous: false, file_url_source: 'new bill map', document_key: 'bill:2025:2', bill_number: '2', bill_year: '2025' },
    { file_url_ambiguous: false, file_url_source: 'new bill map', document_key: 'bill:2025:2', bill_number: '2', bill_year: '2025' }],
  ['replacement non-bill', { file_url_ambiguous: false, file_url_source: 'new rule map' }, { file_url_ambiguous: false, file_url_source: 'new rule map' }],
  ['legacy explicit identity update', { document_key: 'bill:2025:2' }, { document_key: 'bill:2025:2' }],
] as const) {
  Deno.test(`link metadata is replaced as a unit: ${name}`, async () => {
    const { db, docs } = fakeDb();
    const calls: string[][] = [];
    const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed(calls), db };
    const doc = { source_key: 'link-update', title: 'Document', ocr_text: 'Same text', file_url: 'https://old.test/bill.pdf',
      metadata: { source_host: 'owner.test', licence_class: 'unconfirmed', document_key: 'bill:2026:1',
        bill_number: '1', bill_year: '2026', house: 'Lok Sabha', status: 'Introduced', file_url_source: 'old bill map' } };
    await handleIngest(post({ documents: [doc] }), deps);
    // A sparse metadata-only refresh must retain the complete existing link unit.
    await handleIngest(post({ documents: [{ ...doc, metadata: { as_of: '2026-09-21' } }] }), deps);
    assertEquals(docs.get(doc.source_key)!.row.metadata, { ...doc.metadata, as_of: '2026-09-21' });
    const result = await (await handleIngest(post({ documents: [{ ...doc, file_url: name === 'ambiguous' ? null : 'https://new.test/source.pdf', metadata: incoming }] }), deps)).json();
    assertEquals(result.results[0].status, 'unchanged');
    assertEquals(calls.length, 1);
    assertEquals(docs.get(doc.source_key)!.row.metadata, { source_host: 'owner.test', licence_class: 'unconfirmed', as_of: '2026-09-21', ...expected });
  });
}

Deno.test('unmarked same-identity and partial companion refreshes preserve omitted link fields', async () => {
  const { db, docs } = fakeDb();
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed([]), db };
  const doc = { source_key: 'sparse-link', title: 'Document', ocr_text: 'Same text',
    metadata: { source_host: 'owner.test', document_key: 'bill:2026:1', bill_number: '1', bill_year: '2026', house: 'Lok Sabha', status: 'Introduced' } };
  await handleIngest(post({ documents: [doc] }), deps);
  for (const metadata of [{ document_key: 'bill:2026:1' }, { house: 'Rajya Sabha' }]) {
    await handleIngest(post({ documents: [{ ...doc, metadata }] }), deps);
  }
  assertEquals(docs.get(doc.source_key)!.row.metadata, { ...doc.metadata, house: 'Rajya Sabha' });
});

Deno.test('an explicit changed identity without a marker does not inherit a prior ambiguity state', async () => {
  const { db, docs } = fakeDb();
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed([]), db };
  const doc = { source_key: 'formerly-ambiguous', title: 'Document', ocr_text: 'Same text', metadata: { source_host: 'owner.test', file_url_ambiguous: true } };
  await handleIngest(post({ documents: [doc] }), deps);
  await handleIngest(post({ documents: [{ ...doc, metadata: { document_key: 'bill:2026:1' } }] }), deps);
  assertEquals(docs.get(doc.source_key)!.row.metadata, { source_host: 'owner.test', document_key: 'bill:2026:1' });
});

/** Long enough to chunk well past a small commit batch, so slicing is actually exercised. */
function manyChunkText(seed: string): string {
  const s: string[] = [];
  for (let i = 0; i < 600; i++) s.push(`${seed} paragraph ${i} records that clause ${i % 7} was moved, debated and put to the House.`);
  return s.join(' ');
}

/** Wraps the db so a test can see the shape of each chunk_commit call, not just the outcome. */
function recordCommits(db: IngestDeps['db']) {
  const calls: { rows: number; keep: number; indexedSoFar: number }[] = [];
  let indexed = 0;
  return {
    calls,
    indexedAt: () => indexed,
    db: {
      ...db,
      chunkCommit: (id: string, rows: CommitRow[], keep: string[]) => {
        calls.push({ rows: rows.length, keep: keep.length, indexedSoFar: indexed });
        return db.chunkCommit(id, rows, keep);
      },
      markIndexed: (id: string, v: number) => {
        indexed++;
        return db.markIndexed(id, v);
      },
    } as IngestDeps['db'],
  };
}

Deno.test('a document larger than COMMIT_BATCH commits in slices, and every chunk still lands', async () => {
  const { db, docs } = fakeDb();
  const rec = recordCommits(db);
  // commitBatch 3 stands in for production's 100: the property under test is that
  // the loop slices and that nothing is lost, not the size of the constant.
  const deps: IngestDeps = { secretKey: SECRET, embed: fakeEmbed([]), db: rec.db, commitBatch: 3 };
  const doc = { source_key: 'big', title: 'Big', ocr_text: manyChunkText('gamma') };

  const res = await (await handleIngest(post({ documents: [doc] }), deps)).json();
  const chunks = res.results[0].chunks;
  assert(chunks > 6, `need several slices to test slicing, got ${chunks} chunks`);

  assertEquals(res.results[0].status, 'indexed');
  // Nothing lost or double-counted: the tally sums the slices and the store agrees.
  assertEquals(res.results[0].inserted, chunks);
  assertEquals(docs.get('big')!.hashes.size, chunks);
  assertEquals(rec.calls.length, Math.ceil(chunks / 3));
  assertEquals(rec.calls.reduce((n, c) => n + c.rows, 0), chunks);
  // Every call carries the FULL keep list. With a per-slice list, chunk_commit's
  // delete would remove the slices already committed by this same loop.
  for (const c of rec.calls) assertEquals(c.keep, chunks);
  // indexed_at is set once, after the last slice - never while the document is
  // half committed, or a reader could see a partial revision (migration 0014).
  assertEquals(rec.indexedAt(), 1);
  for (const c of rec.calls) assertEquals(c.indexedSoFar, 0);
});

Deno.test('a failed slice leaves the document unindexed, and the retry commits only what is missing', async () => {
  const { db, docs } = fakeDb();
  let failAt = 2;
  const failing: IngestDeps['db'] = {
    ...db,
    chunkCommit: (id, rows, keep) => (--failAt === 0
      ? Promise.reject(new Error('chunk_commit: simulated 520'))
      : db.chunkCommit(id, rows, keep)),
  };
  const embedCalls: string[][] = [];
  const doc = { source_key: 'resume', title: 'Resume', ocr_text: manyChunkText('delta') };

  const first = await (await handleIngest(post({ documents: [doc] }), { secretKey: SECRET, embed: fakeEmbed(embedCalls), db: failing, commitBatch: 3 })).json();
  assertEquals(first.results[0].status, 'error');
  // The first slice is committed and keeps its chunks, but the document is not
  // indexed, so match_documents cannot return any of them.
  assertEquals(docs.get('resume')!.chunker_version, null);
  const landed = docs.get('resume')!.hashes.size;
  assertEquals(landed, 3);

  const second = await (await handleIngest(post({ documents: [doc] }), { secretKey: SECRET, embed: fakeEmbed(embedCalls), db, commitBatch: 3 })).json();
  assertEquals(second.results[0].status, 'indexed');
  assertEquals(docs.get('resume')!.chunker_version, CHUNK.version);
  assertEquals(docs.get('resume')!.hashes.size, second.results[0].chunks);
  // The retry re-embeds only the chunks the failed run never committed.
  assertEquals(embedCalls[1].length, second.results[0].chunks - landed);
});
