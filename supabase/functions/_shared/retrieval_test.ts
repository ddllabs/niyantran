import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { EMBED_DIMS } from './embed.ts';
import { sha256Hex } from './textNormalise.ts';
import { accumulate, type Chunk, DEFAULT_TOP_K, type RetrievalDeps, type RetrievalTrace, rowToChunk, search } from './retrieval.ts';

const vec = (n = EMBED_DIMS) => new Array(n).fill(0.01);

function row(id: string, similarity: number, content = `content ${id}`) {
  return { id, document_id: 'doc-1', content, similarity, chunk_index: 0, source_kind: 'document', page_number: null, char_from: 0, char_to: content.length, title: 'T', file_name: 'f.pdf', file_url: null, desk_tier: 'national', desk_feature: 'Bill Passage Probability Index' };
}

function deps(over: Partial<RetrievalDeps> & { rows?: unknown[]; calls?: Record<string, unknown>[] } = {}): RetrievalDeps {
  return {
    embed: over.embed ?? (() => Promise.resolve({ vector: vec(), model: 'openai/text-embedding-3-small' })),
    rpc: over.rpc ?? ((_fn, args) => {
      over.calls?.push(args);
      return Promise.resolve({ data: over.rows ?? [], error: null });
    }),
    onTrace: over.onTrace,
    onTiming: over.onTiming,
    now: over.now,
  };
}

Deno.test('retrieval measures embedding and database RPC boundaries including zero', async () => {
  let t = 100;
  const measurements: unknown[] = [];
  await search(deps({ now:()=>t, onTiming:(phase,ms)=>measurements.push([phase,ms]),
    embed:()=>{t+=5;return Promise.resolve({vector:vec(),model:'openai/text-embedding-3-small'});},
    rpc:()=>Promise.resolve({data:[],error:null}),
  }),{query:'q'});
  assertEquals(measurements,[['embeddingMs',5],['retrievalMs',0]]);
  measurements.length=0;
  await assertRejects(()=>search(deps({now:()=>t,onTiming:(phase,ms)=>measurements.push([phase,ms]),
    embed:()=>{t+=3;return Promise.reject(new Error('failed'));},
  }),{query:'q'}));
  assertEquals(measurements,[['embeddingMs',3]]);
});

Deno.test('a 1535-wide query vector and a foreign model are refused before the RPC', async () => {
  const calls: Record<string, unknown>[] = [];
  await assertRejects(() => search(deps({ calls, embed: () => Promise.resolve({ vector: vec(1535), model: 'openai/text-embedding-3-small' }) }), { query: 'q' }), Error, '1535');
  await assertRejects(() => search(deps({ calls, embed: () => Promise.resolve({ vector: vec(), model: 'openai/text-embedding-3-large' }) }), { query: 'q' }), Error, 'text-embedding-3-large');
  await assertRejects(() => search(deps({ calls }), { query: '   ' }), Error, 'empty');
  assertEquals(calls.length, 0);
});

Deno.test('the RPC receives the vector, the top-k and the desk tier; rows map to chunks with a text hash', async () => {
  const calls: Record<string, unknown>[] = [];
  const traces: RetrievalTrace[] = [];
  let t = 100;
  const d = deps({ calls, rows: [row('c1', 0.91, ' The  Finance Bill,  2020 '), row('c2', 0.42)], onTrace: (x) => traces.push(x), now: () => (t += 7) });
  const chunks = await search(d, { query: 'finance bill', deskTier: 'national' });
  assertEquals(calls[0].match_count, DEFAULT_TOP_K);
  assertEquals(calls[0].p_desk_tier, 'national');
  assertEquals((calls[0].query_embedding as number[]).length, EMBED_DIMS);
  assertEquals(chunks.map((c) => c.id), ['c1', 'c2']);
  assertEquals(chunks[0].text_hash, await sha256Hex('The Finance Bill, 2020'));
  assertEquals(chunks[0].content, ' The  Finance Bill,  2020 ', 'content is never normalised');
  assertEquals(chunks[0].page_number, undefined);
  assertEquals(chunks[0].file_url, undefined);
  assertEquals(traces.length, 1);
  assertEquals(traces[0].chunkIds, ['c1', 'c2']);
  assertEquals(traces[0].topSimilarity, 0.91);
  assertEquals(traces[0].noChunks, false);
  assert(traces[0].latencyMs > 0);

  const empty = await search(deps({ rows: [], onTrace: (x) => traces.push(x) }), { query: 'nothing', topK: 5 });
  assertEquals(empty, []);
  assertEquals(traces[1].noChunks, true);
});

Deno.test('an RPC error surfaces with its message', async () => {
  await assertRejects(() => search(deps({ rpc: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }) }), { query: 'q' }), Error, 'permission denied');
});

Deno.test('accumulate unions by id and keeps the higher similarity', () => {
  const a = { id: 'x', similarity: 0.5 } as Chunk;
  const b = { id: 'y', similarity: 0.6 } as Chunk;
  const a2 = { id: 'x', similarity: 0.8 } as Chunk;
  const out = accumulate([a, b], [a2, { id: 'z', similarity: 0.1 } as Chunk]);
  assertEquals(out.map((c) => c.id), ['x', 'y', 'z']);
  assertEquals(out[0].similarity, 0.8);
  assertEquals(accumulate([a2], [a])[0].similarity, 0.8);
});

Deno.test('document scope passes through unchanged; absent scope stays null and empty scope stays empty', async () => {
  const calls: Record<string, unknown>[] = [];
  const d = deps({ calls });
  await search(d, { query: 'q', documentIds: ['doc-1', 'doc-2'] });
  await search(d, { query: 'q', documentIds: [] });
  await search(d, { query: 'q' });
  assertEquals(calls.map((c) => c.p_document_ids), [['doc-1', 'doc-2'], [], null]);
});

// Deploy order (retrieval-scope spec): the migration adds p_desk_feature with a
// default, but a function deployed ahead of it - or rolled back behind it - must
// never name an argument the SQL does not have, so it is sent only when set.
Deno.test('p_desk_feature is omitted when no feature is set and sent when one is', async () => {
  const calls: Record<string, unknown>[] = [];
  const d = deps({ calls });
  await search(d, { query: 'q', deskTier: 'national' });
  await search(d, { query: 'q', deskTier: 'national', deskFeature: '' });
  await search(d, { query: 'q', deskTier: 'national', deskFeature: 'Parliamentary Questions' });
  assertEquals(calls.map((c) => 'p_desk_feature' in c), [false, false, true]);
  assertEquals(calls[2].p_desk_feature, 'Parliamentary Questions');
  assertEquals(calls[2].p_desk_tier, 'national');
});

// The page contract (chunk-contract spec, "match_documents"): three nullable
// return columns. Old rows carry nulls - or, before the migration, no such
// keys at all - and must map to exactly the chunk they mapped to before.
Deno.test('rowToChunk: an old row, with the new columns null or absent, keeps the old chunk shape', async () => {
  const base = row('c1', 0.5);
  const absent = await rowToChunk(base);
  const nulls = await rowToChunk({ ...base, block_ids: null, image_ids: null, section: null });
  const empties = await rowToChunk({ ...base, block_ids: [], image_ids: [], section: {} });
  for (const c of [absent, nulls, empties]) {
    assertEquals(Object.keys(c).sort(), Object.keys(absent).sort());
    assertEquals('block_ids' in c || 'image_ids' in c || 'section' in c, false, JSON.stringify(c));
  }
  assertEquals(nulls, absent);
});

Deno.test('rowToChunk: a page row maps block_ids, image_ids and section; junk inside them is dropped', async () => {
  const c = await rowToChunk({
    ...row('c2', 0.7),
    source_kind: 'pdf_page',
    page_number: 4,
    block_ids: ['b-1', 'b-2', null, 7],
    image_ids: ['i-1'],
    section: { heading: 'CHAPTER I PRELIMINARY', note: 'Definitions.', extra: 'x' },
  });
  assertEquals(c.page_number, 4);
  assertEquals(c.block_ids, ['b-1', 'b-2']);
  assertEquals(c.image_ids, ['i-1']);
  assertEquals(c.section, { heading: 'CHAPTER I PRELIMINARY', note: 'Definitions.' });
  const noteOnly = await rowToChunk({ ...row('c3', 0.7), section: { heading: '', note: 'Espionage.' } });
  assertEquals(noteOnly.section, { note: 'Espionage.' });
  assertEquals((await rowToChunk({ ...row('c4', 0.7), section: 'not an object', block_ids: 'b-1' })).section, undefined);
});
