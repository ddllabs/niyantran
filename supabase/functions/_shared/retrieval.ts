// Retrieval over document_chunks (RAG spec §E). `search` embeds one sub-query,
// asserts the model and the width, calls match_documents under the caller's
// client, and returns structured chunks with a text hash the reader can
// recheck. `accumulate` unions the chunks of several sub-queries.

import type { CitationSection } from './citation.types.ts';
import { documentFacts, FACTS_MAX_CHARS } from './documentFacts.ts';
import { EMBED_DIMS, servedModelMatches } from './embed.ts';
import { normalise, sha256Hex } from './textNormalise.ts';

export const DOCUMENT_ROLE_LABELS = {
  as_introduced: 'As introduced',
  as_passed_lok_sabha: 'As passed by Lok Sabha',
  as_passed_rajya_sabha: 'As passed by Rajya Sabha',
  as_passed_both_houses: 'As passed by both Houses',
  gazette_notification: 'Gazette notification',
  errata: 'Errata',
  synopsis: 'Synopsis',
} as const;
export type DocumentRole = keyof typeof DOCUMENT_ROLE_LABELS;
export function documentRole(value: unknown): DocumentRole | undefined {
  return typeof value === 'string' && Object.hasOwn(DOCUMENT_ROLE_LABELS, value) ? value as DocumentRole : undefined;
}

/**
 * Metadata stays caller-authorized and bounded; no source text or filename inference. Each row also gets
 * `document_facts`, the catalogue line built from the metadata read here and the row's own tier and feature; a value the
 * RPC supplied is discarded, as `document_role` is. Building the line is total: a failure leaves the row without it.
 */
export async function hydrateDocumentRoles(
  rows: unknown[], read: (ids: string[]) => Promise<{ id: string; metadata?: unknown }[]>,
  format: typeof documentFacts = documentFacts,
): Promise<Record<string, unknown>[]> {
  const records = rows.map(row => row as Record<string, unknown>);
  const ids = [...new Set(records.map(row => String(row.document_id ?? '')))];
  if (ids.some(id => !id)) throw new Error('retrieved document identity missing');
  const roles = new Map<string, DocumentRole | undefined>();
  const metadatas = new Map<string, Record<string, unknown>>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const page = ids.slice(offset, offset + 100), wanted = new Set(page);
    for (const doc of await read(page)) {
      if (!wanted.has(doc.id) || roles.has(doc.id)) throw new Error('document role read identity mismatch');
      const metadata = doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
        ? doc.metadata as Record<string, unknown> : {};
      roles.set(doc.id, documentRole(metadata.document_role));
      metadatas.set(doc.id, metadata);
    }
    if (page.some(id => !roles.has(id))) throw new Error('retrieved document metadata unavailable');
  }
  return records.map(row => {
    const { document_role: _unverifiedRole, document_facts: _unverifiedFacts, ...rest } = row;
    const id = String(row.document_id);
    const role = roles.get(id);
    let facts = '';
    try {
      facts = format(row.desk_tier, row.desk_feature, metadatas.get(id));
    } catch {
      facts = '';
    }
    return { ...rest, ...(role ? { document_role: role } : {}), ...(facts ? { document_facts: facts } : {}) };
  });
}

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
  document_role?: DocumentRole;
  /** The document's catalogue line (documentFacts): never embedded, never cited, one line of at most 160 characters. */
  document_facts?: string;
  /** sha256(normalise(content)) — what a citation carries and the reader recomputes. */
  text_hash: string;
  // Page chunks only (chunk-contract spec). Absent - never null or empty - on
  // an old row, so an old row maps to exactly the chunk it always did.
  /** document_page_blocks ids whose span overlaps this chunk's. */
  block_ids?: string[];
  /** document_page_images ids whose placeholder lies inside this chunk. */
  image_ids?: string[];
  section?: CitationSection;
  /** Exact positional source text, hydrated under caller authorization; not a role label. */
  preceding_heading?: { text: string; chunkId: string; charFrom: number };
  /** Nearest earlier decimal-paragraph opening; positional context, not proof of governing speaker. */
  paragraph_context?: { text: string; chunkId: string; charFrom: number };
  /** Earlier heading and intervening numbered lines, in source order; ambiguous, not a speaker label. */
  heading_context?: { text: string; chunkId: string; charFrom: number }[];
}

export interface RetrievalTrace {
  subQuery: string;
  chunkIds: string[];
  chunkCount: number;
  topSimilarity: number;
  latencyMs: number;
  noChunks: boolean;
}

export type RetrievalPhase = 'embeddingMs' | 'retrievalMs';

/** The one feature keyword search applies to (match_documents_hybrid, migration 20261102120000). */
export const HYBRID_FEATURE = 'NCLT / NCLAT (Insolvency)';
/** Time budgets of the hybrid path (F288), in ms. */
export const HYBRID_DEFAULTS = { hybridMs: 2_500, fallbackMs: 4_000 } as const;
/** A thrown failure this close to its budget (timers fire a little early against a wall clock) is reported as a timeout. */
const HYBRID_TIMER_SLACK_MS = 50;
export interface HybridConfig { enabled: boolean; hybridMs: number; fallbackMs: number }
/** Safe bounds for the two budgets, in ms. The maximum is NETWORK_TIMEOUT_MS: no setting waits longer than today's single step. */
export const HYBRID_BOUNDS = { hybridMs: [500, 4_000], fallbackMs: [1_000, 4_000] } as const;
const budget = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
/**
 * The `hybrid_search` app_flags value. Only the boolean `true` in `enabled` turns hybrid on; anything else, whatever its
 * shape, is off. Budgets that are absent or not finite numbers take the defaults; the rest are clamped.
 */
export function parseHybridFlag(value: unknown): HybridConfig {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    enabled: v.enabled === true,
    hybridMs: budget(v.hybrid_ms, HYBRID_BOUNDS.hybridMs, HYBRID_DEFAULTS.hybridMs),
    fallbackMs: budget(v.fallback_ms, HYBRID_BOUNDS.fallbackMs, HYBRID_DEFAULTS.fallbackMs),
  };
}
/** How a search that consulted the hybrid switch was served. Never carries query text or an error message. */
export interface RetrievalPathInfo {
  path: 'hybrid' | 'hybrid_fallback';
  hybridMs?: number;
  fallbackMs?: number;
  fallbackReason?: 'timeout' | 'error';
  errorCode?: string;
}

const afterRpc = new WeakSet<object>();
/**
 * For `deps.rpc`: rethrow a failure that happened after the RPC itself succeeded (role hydration of its rows). The error is
 * passed on unchanged, but the hybrid path will not treat it as a hybrid failure: a second search would repeat the work
 * that just failed.
 */
export function afterRpcFailure(e: unknown): never {
  if (e && typeof e === 'object') afterRpc.add(e);
  throw e;
}

export interface RetrievalDeps {
  embed(query: string): Promise<{ vector: number[]; model: string }>;
  rpc(
    fn: 'match_documents' | 'match_documents_hybrid',
    args: Record<string, unknown>,
    budgetMs?: number,
  ): Promise<{ data: unknown[] | null; error: { message: string; code?: string } | null }>;
  /** Present only where the hybrid path may run. A rejecting `config` means vector-only. */
  hybrid?: { config(): Promise<HybridConfig> };
  /** The turn's signal: an aborted turn starts no fallback. */
  signal?: AbortSignal;
  onPath?(info: RetrievalPathInfo): void;
  onTrace?(trace: RetrievalTrace): void;
  onTiming?(phase: RetrievalPhase, ms: number): void;
  now?: () => number;
}

export const DEFAULT_TOP_K = 40;

function optional(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function ids(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return out.length ? out : undefined;
}

function section(v: unknown): CitationSection | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const s = v as Record<string, unknown>;
  const heading = optional(s.heading);
  const note = optional(s.note);
  if (!heading && !note) return undefined;
  return { ...(heading ? { heading } : {}), ...(note ? { note } : {}) };
}

export async function rowToChunk(raw: unknown): Promise<Chunk> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const content = String(r.content ?? '');
  const chunk: Chunk = {
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
  const blockIds = ids(r.block_ids);
  const imageIds = ids(r.image_ids);
  const sect = section(r.section);
  if (blockIds) chunk.block_ids = blockIds;
  if (imageIds) chunk.image_ids = imageIds;
  if (sect) chunk.section = sect;
  const role = documentRole(r.document_role);
  if (role) chunk.document_role = role;
  const facts = r.document_facts;
  if (typeof facts === 'string' && facts && facts.length <= FACTS_MAX_CHARS && !/[\r\n\u2028\u2029]/.test(facts)) chunk.document_facts = facts;
  return chunk;
}

export interface SearchInput {
  query: string;
  topK?: number;
  deskTier?: string;
  /** A desk module's exact `documents.desk_feature`, sent with its tier. */
  deskFeature?: string;
  documentIds?: string[];
}

export async function search(deps: RetrievalDeps, input: SearchInput): Promise<Chunk[]> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const query = input.query.trim();
  if (!query) throw new Error('search: empty query');
  const measure = async <T>(phase: RetrievalPhase, operation: () => Promise<T>): Promise<T> => {
    const start = now();
    try { return await operation(); }
    finally { deps.onTiming?.(phase, Math.max(0, Math.round(now() - start))); }
  };
  const { vector, model } = await measure('embeddingMs', () => deps.embed(query));
  if (!servedModelMatches(model)) throw new Error(`search: query embedded by ${model}, expected the corpus model`);
  if (vector.length !== EMBED_DIMS) throw new Error(`search: query embedding width ${vector.length}, expected ${EMBED_DIMS}`);
  const args: Record<string, unknown> = {
    query_embedding: vector,
    match_count: input.topK ?? DEFAULT_TOP_K,
    p_document_ids: input.documentIds ?? null,
    p_desk_tier: input.deskTier ?? null,
    // Omitted, never null, when absent: the SQL before the feature migration
    // has no such argument, and PostgREST refuses a call that names one it
    // does not know. Omitting it keeps this function deployable either side
    // of that migration.
    ...(input.deskFeature ? { p_desk_feature: input.deskFeature } : {}),
  };
  const vectorRows = async (budgetMs?: number): Promise<unknown[]> => {
    const { data, error } = budgetMs === undefined
      ? await deps.rpc('match_documents', args)
      : await deps.rpc('match_documents', args, budgetMs);
    if (error) throw new Error(`match_documents: ${error.message}`);
    return data ?? [];
  };
  // F288: only an NCLT feature search with no document ids can differ in hybrid (the SQL makes every other scope
  // identical), so only that search reads the switch. A switch that cannot be read is off.
  let hybrid: HybridConfig | null = null;
  if (deps.hybrid && input.deskFeature === HYBRID_FEATURE && !input.documentIds?.length) {
    try { hybrid = await deps.hybrid.config(); } catch { hybrid = null; }
  }
  const hybridRows = async (config: HybridConfig): Promise<unknown[]> => {
    const hybridStart = now();
    let failed: { threw: boolean; code?: string };
    try {
      const result = await deps.rpc('match_documents_hybrid', { ...args, query_text: query }, config.hybridMs);
      if (!result.error && Array.isArray(result.data)) {
        deps.onPath?.({ path: 'hybrid' });
        return result.data;
      }
      failed = { threw: false, code: result.error?.code };
    } catch (e) {
      // The RPC answered and what failed was the work on its rows: not a hybrid failure, so no repeat of the search.
      if (e && typeof e === 'object' && afterRpc.has(e)) throw e;
      failed = { threw: true };
    }
    // Stop or the turn deadline is not a hybrid failure: no second call, no wasted spend.
    deps.signal?.throwIfAborted();
    const hybridMs = Math.max(0, Math.round(now() - hybridStart));
    const fallbackReason = failed.threw && hybridMs >= config.hybridMs - HYBRID_TIMER_SLACK_MS ? 'timeout' : 'error';
    const fallbackStart = now();
    try {
      return await vectorRows(config.fallbackMs);
    } finally {
      deps.onPath?.({
        path: 'hybrid_fallback',
        hybridMs,
        fallbackMs: Math.max(0, Math.round(now() - fallbackStart)),
        fallbackReason,
        ...(failed.code ? { errorCode: failed.code } : {}),
      });
    }
  };
  const data = await measure('retrievalMs', () => hybrid?.enabled ? hybridRows(hybrid) : vectorRows());
  const chunks: Chunk[] = [];
  for (const row of data) chunks.push(await rowToChunk(row));
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
