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
      return Promise.resolve(d ? { id: d.id, content_sha256: d.row.content_sha256, chunker_version: d.chunker_version } : null);
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
  assertEquals(docs.get('A')!.row.metadata, { document_key: 'bill:2019:55' });
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
