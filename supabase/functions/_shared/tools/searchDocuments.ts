// The search_documents tool (RAG spec §F). Fixed interface consumed by
// streaming-research-agent exactly as declared here. The executor returns
// structured chunks; labelling them with handles and rendering them for the
// model is the agent loop's job.

import { type Chunk, type RetrievalDeps, search } from '../retrieval.ts';

export const SEARCH_DOCUMENTS_TOOL = {
  type: 'function',
  function: {
    name: 'search_documents',
    description:
      'Search the National Desk source documents (bills, notifications, orders, reports) for passages relevant to one specific question. Call it more than once with different phrasings; stop when new calls return nothing new.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search text for this sub-query, phrased as the document would phrase it.' },
        desk_tier: { type: 'string', description: 'Optional desk to restrict to.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
} as const;

export async function executeSearchDocuments(deps: RetrievalDeps, args: { query: string; desk_tier?: string }): Promise<Chunk[]> {
  const query = typeof args?.query === 'string' ? args.query : '';
  const deskTier = typeof args?.desk_tier === 'string' && args.desk_tier.trim() ? args.desk_tier.trim() : undefined;
  return await search(deps, { query, deskTier });
}
