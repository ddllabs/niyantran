# Document RAG and citations — Design

**Date:** 2026-09-20
**Module id:** `document-rag-and-citations`
> **Status:** Normative — an open design, binding on its implementation plan.
> Becomes Historical (dated) when the plan is executed and verified.

**Origin:** Niyantran will supply the National Desk source documents as file
names, file URLs and raw OCR text — whole-document text with no page
structure; page-wise Markdown is promised later. Nothing in the application
indexes, embeds or retrieves documents today; the assistant sees only what a
user pins or selects (`docs/research/2026-09-20-ai-path-audit.md` §2–3). The
pattern is the owner's other product's RAG path
(`docs/research/2026-09-20-tenderbase-reference-patterns.md` §2–6, §8),
re-derived for a global corpus (`docs/decisions/0003`) with the chunk
identity rule of `docs/decisions/0004` and the embedding baseline of
`docs/decisions/0002`.

## Decisions

Recorded from the owner's answers, 2026-09-20:

1. **The OCR text lives in Postgres** (`documents.ocr_text`), with a separate
   chunk table carrying embeddings, anchors and metadata.
2. **Citations resolve by chunk id**, with a character span and a text hash
   as the fallback and the staleness check. No page structure until Niyantran
   supplies it; the anchor columns exist now, nullable.
3. **Embeddings through OpenRouter**, `openai/text-embedding-3-small`, 1536,
   asserted on every call.
4. **HNSW, cosine.**
5. **Corpus is global; ingestion is service-role only.** No upload UI.
6. **Rows are not embedded.** Tabular questions go to `desk-row-grounding`.

## What the owner receives

A script that reads a local manifest of Niyantran's documents and pushes
them through an `ingest-documents` edge function; the function chunks,
embeds only what changed, and commits idempotently. A `match_documents` RPC
and a `search_documents` tool contract that the agent calls. In the
terminal: citation bubbles in an answer that open a **reader pane** showing
the cited document scrolled to the cited passage with the passage
highlighted, and a source-chip strip under the answer, one chip per
document.

**Named limitation:** a citation opens the document and highlights a
character span. It cannot say "page 7" and cannot draw a rectangle on a
rendered page, because the supplied OCR carries neither. When page-wise
Markdown arrives, `page_number` is filled and a page view is added without
changing the citation shape.

## Design

### A. Ingestion

**Input.** `ingest/national-desk/manifest.json` (a local, **gitignored**
folder — the corpus is Niyantran's content; Supabase is its system of record,
not this repository) listing documents:

```json
{ "documents": [
  { "source_key": "ND-2025-0417", "title": "…", "file_name": "…pdf",
    "file_url": "https://…", "desk_tier": "national",
    "desk_feature": "Bill Passage Probability Index", "ocr_file": "ND-2025-0417.txt" }
]}
```

`scripts/ingest-national-desk.mjs` reads the manifest, loads each `ocr_file`,
and `POST`s batches to `/functions/v1/ingest-documents` with the **service
role key from the environment** — never from a browser. `--dry-run` reports
what would change without writing.

**Function.** `ingest-documents` (POST, service role only) accepts
`{ documents: [{ source_key, title, file_name, file_url, desk_tier,
desk_feature, ocr_text }], dry_run? }` and, per document:

1. Upsert `documents` on `source_key`; if `content_sha256` is unchanged and
   `chunker_version` matches, skip.
2. Chunk (§B) → rows with `chunk_hash`, `chunk_index`, `char_from`, `char_to`,
   `content`.
3. Read the document's existing hashes; embed **only the misses** (§C).
4. `chunk_commit(document_id, rows, keep_hashes)` (§D).
5. Log one `model_call_logs` row per embedding request (`purpose =
   'embedding'`) with tokens and `cost_usd`.

Per-document failure is reported in the response and never aborts the
batch. Response per document:
`{ source_key, status, chunks, inserted, kept, deleted, embedded_tokens, cost_usd, error? }`.

### B. Chunker — `supabase/functions/_shared/chunking.ts`

Pure; no I/O. Order *heading → table → paragraph → sentence → character*.
Constants (`CHUNK`): `targetChars 1000`, `overlapChars 200`, `minChars 200`,
`tableAtomicMax 1500`, `maxChars 6000`, `version 1`.

Two invariants, enforced by the function's types:

- **One unit.** A chunk is cut from exactly one unit. Today the unit is the
  whole document (`source_kind = 'document'`); with page-wise Markdown the
  unit is a page (`source_kind = 'pdf_page'`, `page_number` set). A chunk
  can never straddle units.
- **Exact span.** `content === ocr_text.slice(char_from, char_to)`. No
  trimming, no normalisation inside the stored content. This is what lets
  the reader highlight the passage and what lets the text hash be
  recomputed from the document.

`chunk_hash = sha256(`${CHUNK.version}|${unit_key}|${normalise(content)}`)`
where `normalise` collapses whitespace and trims, so an OCR re-run that
changes only spacing reuses every embedding. `normalise` is one small
module, `_shared/textNormalise.ts`, mirrored as `src/lib/textNormalise.js`
with a parity test.

### C. Embedding — `supabase/functions/_shared/embed.ts`

`EMBED_MODEL = 'openai/text-embedding-3-small'`, `EMBED_DIMS = 1536`.
`POST https://openrouter.ai/api/v1/embeddings` with
`{ model, input: string[] }`. Batches bounded by count (96) **and** estimated
tokens (200k); single inputs clamped to ~7k tokens. Retry on 429 and 5xx
only. The first vector of a run is checked for width, and the `model`
echoed by the provider is checked against `EMBED_MODEL`; either mismatch
throws before anything is stored. Cost is computed from the provider's
reported token usage. `EmbeddingError` carries the cost already spent by
batches that succeeded.

The exact response shape of OpenRouter's embeddings endpoint is verified
against its documentation when the plan is written (source-driven); the
assertions above are what protect the index if that reading is wrong.

### D. Commit and match — migrations

```sql
create or replace function public.chunk_commit(
  p_document_id uuid, p_rows jsonb, p_keep_hashes text[]
) returns jsonb language plpgsql security definer set search_path = public, extensions as $$
-- delete chunks of p_document_id whose chunk_hash is not in p_keep_hashes;
-- for each row: on (document_id, chunk_hash) hit → update chunk_index, char_from,
--   char_to, page_number, source_kind, metadata, chunker_version — keep id and embedding;
--   on miss → insert (embedding must be present);
-- return { inserted, kept, deleted }
$$;
revoke all on function public.chunk_commit(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.chunk_commit(uuid, jsonb, text[]) to service_role;

create or replace function public.match_documents(
  query_embedding extensions.vector(1536),
  match_count     int default 40,
  p_document_ids  uuid[] default null,
  p_desk_tier     text default null
) returns table (
  id uuid, document_id uuid, content text, similarity float8,
  chunk_index int, source_kind text, page_number int, char_from int, char_to int,
  title text, file_name text, file_url text, desk_tier text, desk_feature text
) language sql stable security invoker set search_path = public, extensions as $$
  select c.id, c.document_id, c.content, 1 - (c.embedding <=> query_embedding),
         c.chunk_index, c.source_kind, c.page_number, c.char_from, c.char_to,
         d.title, d.file_name, d.file_url, d.desk_tier, d.desk_feature
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.embedding is not null
    and (p_document_ids is null or c.document_id = any (p_document_ids))
    and (p_desk_tier is null or d.desk_tier = p_desk_tier)
  order by c.embedding <=> query_embedding
  limit match_count
$$;
```

No ownership prelude (`docs/decisions/0003`). `security invoker` with the
`select using (true)` policy means the function is callable under the
caller's JWT.

### E. Retrieval — `supabase/functions/_shared/retrieval.ts`

```ts
export interface Chunk {
  id: string; document_id: string; content: string; similarity: number;
  chunk_index: number; source_kind: 'document' | 'pdf_page';
  page_number?: number; char_from: number; char_to: number;
  title: string; file_name?: string; file_url?: string;
  desk_tier?: string; desk_feature?: string;
}
export interface RetrievalDeps {
  embed(query: string): Promise<{ vector: number[]; model: string }>;
  rpc(fn: 'match_documents', args: Record<string, unknown>): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  onTrace?(trace: RetrievalTrace): void;
}
export async function search(deps: RetrievalDeps, input: { query: string; topK?: number; deskTier?: string }): Promise<Chunk[]>;
export function accumulate(previous: Chunk[], next: Chunk[]): Chunk[];   // union, dedup by id, keep max similarity
```

`search` asserts model and dimensions before the RPC and emits a
`RetrievalTrace` (`subQuery, chunkIds, chunkCount, topSimilarity, latencyMs,
noChunks`) for `chat_turn_traces`. `DEFAULT_TOP_K = 40`.

### F. The `search_documents` tool — fixed interface

Consumed by `streaming-research-agent` exactly as declared here.

```ts
// supabase/functions/_shared/tools/searchDocuments.ts
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

export async function executeSearchDocuments(
  deps: RetrievalDeps, args: { query: string; desk_tier?: string },
): Promise<Chunk[]>;
```

The executor returns structured chunks. Labelling them with handles and
rendering them as text for the model is the agent loop's job, so the handle
namespace stays single across both tools.

### G. Citation integrity — `supabase/functions/_shared/citations.ts`

Pure functions over the model's envelope, mirrored on the client where the
parser is concerned:

- `parseCitationIds(inner)` / `expandGroupedCitations(text)` — `[2, 3]`,
  `[2-4]` → `[2][3]`; `MAX_CITATION_ID = 99`, `MAX_RANGE_SPAN = 5`.
  **Mirrored** in `src/lib/citationMarkers.js` (`splitCitationMarkers`) with
  a parity test.
- `renumberCitations(answer, sources)` — keep only sources that resolve,
  renumber 1..n, rewrite markers, strip dangling markers.
- `recoverHandleCitations(answer, handles)` — rescue handle tokens the model
  left in the prose, matched longest-first against this turn's map.
- `buildSources(handles, cited)` → `CitationSource[]`.

The **repair pass** (a second model call) is not here; it needs the
transport and belongs to `streaming-research-agent`, which calls these
functions before and after it.

### H. The `text` citation and the reader — fixed interface

```ts
// src/types — shared by both citation modules and the agent
export type CitationSource =
  | { id: number; kind: 'text';
      chunk_id: string; document_id: string; title: string;
      file_name?: string; file_url?: string; desk_tier?: string; desk_feature?: string;
      char_from: number; char_to: number; text_hash: string;
      source_kind: 'document' | 'pdf_page'; page_number?: number }
  | { id: number; kind: 'row';
      tier: string; feature: string; row_key: string; title: string;
      row_snapshot: Record<string, string>;   // the slim row as cited
      snapshot_at: string | null };            // null for the injected selection
```

`text_hash = sha256(normalise(content))`. The `row` variant is fixed by
`desk-row-grounding` §G and reproduced here verbatim because this module
owns `src/types/citation.js`; the two modules run concurrently and must not
both edit it.

**`src/ai/SourceReader.jsx`** (new) opens inside the AI dock when a `text`
bubble is clicked: reads the `documents` row through the Supabase client
(RLS permits), scrolls to `char_from`, highlights `[char_from, char_to)`.
Before highlighting it recomputes `sha256(normalise(ocr_text.slice(char_from,
char_to)))`:

- equal → highlight;
- different → search the document for the cited text; if found, highlight
  there with the notice "this passage moved since it was cited"; if not,
  show the document top with "this passage has changed since it was cited".

A citation therefore never silently shows the wrong passage.

**`src/ai/SourceList.jsx`** (new) renders one chip per distinct `document_id`
under an assistant message, with title and file name; clicking a chip opens
the reader at the first citation of that document.

### I. Testing and verification

Deno (`deno test supabase/functions`), no network, fake fetch:

- Chunker: one-unit invariant (a synthetic two-unit input yields no chunk
  spanning both); exact-span invariant on a real OCR fixture; table
  atomicity below 1500; version participates in the hash (bump → every hash
  changes); whitespace-only change → identical hashes.
- Embed: 1535-wide vector → throws before commit; provider echoes another
  model → throws; batch planner splits a 908k-token-equivalent input.
- Citations: grouped expansion; renumber strips a `[3]` with two sources;
  recover matches `ref:k3f-11` before `ref:k3f-1`; parity with the client
  parser on a shared fixture.

Executed against the live project with one fixture document (recorded as
evidence in the plan):

- `chunk_commit` twice → second run `inserted 0, kept N, deleted 0`; edit one
  paragraph → `inserted 1, kept N-1, deleted 1`; the untouched rows keep
  their ids.
- `match_documents` with the fixture's own first chunk vector returns that
  chunk first with similarity ≈ 1.
- Reader: cited span highlights; altering the stored text produces the
  "changed" notice.

**Vacuity:** remove the dimension assertion — the 1535 test fails by name;
change `1 - (…)` to `(…)` in `match_documents` — the ordering test fails.

### J. Commands

```bash
deno test supabase/functions
node scripts/ingest-national-desk.mjs --dry-run
node scripts/ingest-national-desk.mjs                    # requires SUPABASE_SERVICE_ROLE_KEY in env
supabase functions deploy ingest-documents               # owner authorises
psql "$DB_URL" -c "select count(*) from document_chunks where embedding is not null"
```

## Write scope

`supabase/functions/_shared/{chunking,embed,retrieval,citations,textNormalise}.ts`
and their tests, `supabase/functions/_shared/tools/searchDocuments.ts`,
`supabase/functions/ingest-documents/`, `supabase/migrations/*chunk_commit*`,
`supabase/migrations/*match_documents*`, `scripts/ingest-national-desk.mjs`,
`src/lib/citationMarkers.js`, `src/lib/textNormalise.js`,
`src/ai/SourceReader.jsx`, `src/ai/SourceList.jsx`, `src/types/citation.js`
(both variants), `ingest/` (already gitignored by `ai-backend-foundation`).

**Not touched:** `AiPanel.jsx`, `AiMarkdown.jsx`, `aiDrop.js`,
`sourceUrls.js`, `citationGuard.js`, the legacy path, `backup/`,
`public/data/`.

## Boundaries

- **Always:** keep `content` an exact slice; keep `chunk_hash` versioned;
  assert model and dimensions before every store and every search.
- **Ask first:** committing any document text to the repository (default:
  never — `ingest/` is ignored); changing `CHUNK` constants after the first
  index (it is a re-chunk); any deploy.
- **Never:** call the embeddings endpoint from the browser; expose the
  service role key to any client; weaken a policy to make a test pass.

## Accepted consequences

- Citations are document-level with a highlighted span. Page-level arrives
  with page-wise Markdown as a fill, not a redesign.
- The reader loads the whole `ocr_text` of a document. For very long
  documents that is a large read; it is acceptable for the National Desk
  corpus and revisited if documents grow.
- OCR quality is Niyantran's. A garbled passage is cited faithfully as
  garbled.
- The page-wise re-index will change most chunk boundaries and therefore
  most ids; §H keeps those citations honest rather than dead.

## Out of scope

- Page-wise Markdown, page anchors, bounding boxes, a rendered-PDF view.
- User uploads, per-user documents.
- Hybrid retrieval (`pgroonga` / `rum` are installed-ready), reranking,
  query rewriting beyond the model's own decomposition.
- Web search.
- Any change to how rows are grounded (`desk-row-grounding`).
