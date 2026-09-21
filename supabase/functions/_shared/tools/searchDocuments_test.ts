import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { EMBED_DIMS } from '../embed.ts';
import type { RetrievalDeps } from '../retrieval.ts';
import { executeSearchDocuments, SEARCH_DOCUMENTS_TOOL } from './searchDocuments.ts';

Deno.test('the tool declaration is the fixed contract', () => {
  assertEquals(SEARCH_DOCUMENTS_TOOL.type, 'function');
  assertEquals(SEARCH_DOCUMENTS_TOOL.function.name, 'search_documents');
  assertEquals(SEARCH_DOCUMENTS_TOOL.function.parameters.required, ['query']);
  assertEquals(Object.keys(SEARCH_DOCUMENTS_TOOL.function.parameters.properties), ['query', 'desk_tier']);
  assertEquals(SEARCH_DOCUMENTS_TOOL.function.parameters.additionalProperties, false);
});

Deno.test('the executor forwards the query and desk tier; a missing query is refused', async () => {
  const calls: Record<string, unknown>[] = [];
  const deps: RetrievalDeps = {
    embed: () => Promise.resolve({ vector: new Array(EMBED_DIMS).fill(0), model: 'text-embedding-3-small' }),
    rpc: (_fn, args) => {
      calls.push(args);
      return Promise.resolve({ data: [], error: null });
    },
  };
  await executeSearchDocuments(deps, { query: 'flag code amendment', desk_tier: ' national ' });
  assertEquals(calls[0].p_desk_tier, 'national');
  await executeSearchDocuments(deps, { query: 'x' });
  assertEquals(calls[1].p_desk_tier, null);
  await assertRejects(() => executeSearchDocuments(deps, {} as { query: string }), Error, 'empty');
});
