// Retrieval over document_chunks (RAG spec §E). `search` embeds one sub-query,
// asserts the model and the width, calls match_documents under the caller's
// client, and returns structured chunks with a text hash the reader can
// recheck. `accumulate` unions the chunks of several sub-queries.

import { EMBED_DIMS, servedModelMatches } from './embed.ts';
import { normalise, sha256Hex } from './textNormalise.ts';

export interface Chunk {
  id: string;
  document_id: string;
  content: string;
  similarity: number;
  chunk_index: number;
  source_kind: 'document' | 'pdf_page';
  page_number?: number;
  char_from: number;
  char_to: number;
  title: string;
  file_name?: string;
  file_url?: string;
  desk_tier?: string;
  desk_feature?: string;
  /** sha256(normalise(content)) — what a citation carries and the reader recomputes. */
  text_hash: string;
}

export interface RetrievalTrace {
  subQuery: string;
  chunkIds: string[];
  chunkCount: number;
  topSimilarity: number;
  latencyMs: number;
  noChunks: boolean;
}

export interface RetrievalDeps {
  embed(query: string): Promise<{ vector: number[]; model: string }>;
  rpc(fn: 'match_documents', args: Record<string, unknown>): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  onTrace?(trace: RetrievalTrace): void;
  now?: () => number;
}

export const DEFAULT_TOP_K = 40;

function optional(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

export async function rowToChunk(raw: unknown): Promise<Chunk> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const content = String(r.content ?? '');
  return {
    id: String(r.id),
    document_id: String(r.document_id),
    content,
    similarity: Number(r.similarity ?? 0),
    chunk_index: Number(r.chunk_index ?? 0),
    source_kind: r.source_kind === 'pdf_page' ? 'pdf_page' : 'document',
    page_number: typeof r.page_number === 'number' ? r.page_number : undefined,
    char_from: Number(r.char_from ?? 0),
    char_to: Number(r.char_to ?? 0),
    title: String(r.title ?? ''),
    file_name: optional(r.file_name),
    file_url: optional(r.file_url),
    desk_tier: optional(r.desk_tier),
    desk_feature: optional(r.desk_feature),
    text_hash: await sha256Hex(normalise(content)),
  };
}

export async function search(deps: RetrievalDeps, input: { query: string; topK?: number; deskTier?: string; documentIds?: string[] }): Promise<Chunk[]> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const query = input.query.trim();
  if (!query) throw new Error('search: empty query');
  const { vector, model } = await deps.embed(query);
  if (!servedModelMatches(model)) throw new Error(`search: query embedded by ${model}, expected the corpus model`);
  if (vector.length !== EMBED_DIMS) throw new Error(`search: query embedding width ${vector.length}, expected ${EMBED_DIMS}`);
  const { data, error } = await deps.rpc('match_documents', {
    query_embedding: vector,
    match_count: input.topK ?? DEFAULT_TOP_K,
    p_document_ids: input.documentIds ?? null,
    p_desk_tier: input.deskTier ?? null,
  });
  if (error) throw new Error(`match_documents: ${error.message}`);
  const chunks: Chunk[] = [];
  for (const row of data ?? []) chunks.push(await rowToChunk(row));
  deps.onTrace?.({
    subQuery: query,
    chunkIds: chunks.map((c) => c.id),
    chunkCount: chunks.length,
    topSimilarity: chunks[0]?.similarity ?? 0,
    latencyMs: now() - started,
    noChunks: chunks.length === 0,
  });
  return chunks;
}

/** Union by id; a repeated chunk keeps its highest similarity. Order: previous first, then new ids. */
export function accumulate(previous: Chunk[], next: Chunk[]): Chunk[] {
  const byId = new Map<string, Chunk>();
  for (const c of previous) byId.set(c.id, c);
  for (const c of next) {
    const seen = byId.get(c.id);
    if (!seen || c.similarity > seen.similarity) byId.set(c.id, seen ? { ...seen, similarity: c.similarity } : c);
  }
  return [...byId.values()];
}
