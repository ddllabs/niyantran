import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { EMBED_DIMS } from './embed.ts';
import { sha256Hex } from './textNormalise.ts';
import { accumulate, type Chunk, DEFAULT_TOP_K, type RetrievalDeps, type RetrievalTrace, search } from './retrieval.ts';

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
    now: over.now,
  };
}

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
