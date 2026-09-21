# Document RAG and citations — Implementation plan

**Date:** 2026-09-21
**Spec:** `docs/specs/2026-09-20-document-rag-and-citations-design.md` (module id
`document-rag-and-citations`)
> **Status:** Historical (dated 2026-09-21) — executed, verified against the
> live project and merged to `main` locally the same day. Kept as the record
> of what was built. Known limitations are listed at the end.

**Goal:** After this plan, Niyantran's OCR documents can be pushed into
`NTER` by a script, are chunked and embedded through OpenRouter, are
searchable by vector similarity through `match_documents` and the
`search_documents` tool contract, and a citation can be opened in a reader
that highlights the exact cited passage or says honestly that the passage
moved or changed.

**Architecture:** Pure modules first (normalise, chunk, embed, retrieve,
citations), each with Deno tests and no network; one migration adding the
two RPCs; one service-role-only edge function (`ingest-documents`) that
composes them; one Node script that feeds it; three small frontend files
(the citation type, the marker parser, the reader and list components) with
Vitest. Nothing on the legacy AI path changes.

**Tech stack:** Deno edge functions (`supabase/functions`), Postgres +
`pgvector` (HNSW cosine), OpenRouter `POST /api/v1/embeddings`, Node script,
React 19 components, Vitest and Deno test.

**Branch:** `task/document-rag`, created from `main` at `7080118`. Sequential
tasks, one branch, no worktrees. Executed by the supervisor inline.

**Corpus for this plan:** the owner's export `ten-smallest-ocr-documents.zip`
(ten documents from `01 Legislative & Policy Intelligence / Bill Passage
Probability Index`, 93–1,993 OCR characters each, one in Hindi+English).
The export ships `manifest.json` (rank, filename, markdown, metadata) plus a
`.md` (the saved OCR text, unchanged) and a `.metadata.json` per document.
It is staged under the gitignored `ingest/national-desk/ten-smallest/`.

## Global constraints

- Copied from the spec's Boundaries: `content` is always an exact slice of
  `ocr_text`; `chunk_hash` carries `CHUNK.version`; model and dimensions are
  asserted before every store and every search; the embeddings endpoint is
  never called from the browser; the service key never reaches a client; no
  policy is weakened to make a test pass.
- `EMBED_MODEL = 'openai/text-embedding-3-small'`, `EMBED_DIMS = 1536`.
  Price verified against `GET /api/v1/embeddings/models` on 2026-09-21:
  `pricing.prompt = "0.00000002"` USD per token, `completion = "0"`,
  `context_length = 8192`.
- `CHUNK = { targetChars: 1000, overlapChars: 200, minChars: 200,
  tableAtomicMax: 1500, maxChars: 6000, version: 1 }`. Changing any value
  after the first index is a re-chunk and needs the owner's go-ahead.
- Legacy API keys are disabled. `ingest-documents` is deployed with
  `verify_jwt = false` and authenticates the caller itself: the bearer must
  equal the project's `sb_secret_…` key read from `SUPABASE_SECRET_KEYS`
  (`_shared/supabase.ts` → `secretKey()`), compared timing-safe. Any other
  caller gets 401.
- No document text is committed. `ingest/` is gitignored. Test fixtures use
  synthetic text, except one **short** real OCR passage (≤ 400 characters)
  copied into a Deno test for the exact-span invariant, which the owner
  allowed by supplying the export for this purpose.
- Nothing is pushed and no PR is opened. The owner names the push.
- `docs/plans/2026-09-21-ai-backend-foundation.md` and the foundation's
  files are not edited, except `supabase/config.toml` (one new
  `[functions.ingest-documents]` block) and `.env.example` (one comment).
- Both runners must stay green at every commit:
  `npm test` and `deno test -A --config supabase/functions/deno.json supabase/functions`.

## Fixed interfaces

Fixed before any task starts. A task that needs to change one stops.

```ts
// _shared/textNormalise.ts  (mirror: src/lib/textNormalise.js, same output byte for byte)
export function normalise(text: string): string          // collapse /\s+/g to ' ', trim
export async function sha256Hex(text: string): Promise<string>   // WebCrypto, lower-case hex

// _shared/chunking.ts
export const CHUNK = { targetChars: 1000, overlapChars: 200, minChars: 200, tableAtomicMax: 1500, maxChars: 6000, version: 1 } as const
export interface ChunkUnit { unitKey: string; text: string; sourceKind: 'document' | 'pdf_page'; pageNumber?: number }
export interface ChunkSpan { unitKey: string; sourceKind: 'document' | 'pdf_page'; pageNumber?: number; charFrom: number; charTo: number; content: string }
export interface ChunkRow extends ChunkSpan { chunkIndex: number; chunkHash: string; tokenEstimate: number }
export function chunkUnit(unit: ChunkUnit, opts?: Partial<typeof CHUNK>): ChunkSpan[]  // pure; content === text.slice(charFrom, charTo)
export async function chunkDocument(ocrText: string, opts?: Partial<typeof CHUNK>): Promise<ChunkRow[]>  // one unit 'document'
export function chunkHashInput(version: number, unitKey: string, content: string): string   // `${version}|${unitKey}|${normalise(content)}`
export function estimateTokens(text: string): number     // Math.ceil(text.length / 4)

// _shared/embed.ts
export const EMBED_MODEL = 'openai/text-embedding-3-small'
export const EMBED_DIMS = 1536
export const EMBED_PRICE_USD_PER_TOKEN = 0.00000002
export interface EmbedResult { vectors: number[][]; model: string; promptTokens: number; costUsd: number; requests: number }
export class EmbeddingError extends Error { costUsd: number; promptTokens: number; status?: number }
export interface EmbedDeps { fetch: typeof fetch; apiKey: string; sleep?: (ms: number) => Promise<void> }
export function planBatches(inputs: string[], maxCount = 96, maxTokens = 200_000): string[][]
export async function embedTexts(deps: EmbedDeps, inputs: string[]): Promise<EmbedResult>   // asserts width and model echo

// _shared/retrieval.ts   (spec §E verbatim)
export interface Chunk { … }                       // as spec §E, plus text_hash: string
export interface RetrievalTrace { subQuery: string; chunkIds: string[]; chunkCount: number; topSimilarity: number; latencyMs: number; noChunks: boolean }
export interface RetrievalDeps { embed(query: string): Promise<{ vector: number[]; model: string }>; rpc(fn: 'match_documents', args: Record<string, unknown>): Promise<{ data: unknown[] | null; error: { message: string } | null }>; onTrace?(t: RetrievalTrace): void }
export const DEFAULT_TOP_K = 40
export async function search(deps: RetrievalDeps, input: { query: string; topK?: number; deskTier?: string }): Promise<Chunk[]>
export function accumulate(previous: Chunk[], next: Chunk[]): Chunk[]

// _shared/tools/searchDocuments.ts   (spec §F verbatim)
export const SEARCH_DOCUMENTS_TOOL
export async function executeSearchDocuments(deps: RetrievalDeps, args: { query: string; desk_tier?: string }): Promise<Chunk[]>

// _shared/citations.ts   (spec §G)
export const MAX_CITATION_ID = 99, MAX_RANGE_SPAN = 5
export function parseCitationIds(inner: string): number[]
export function expandGroupedCitations(text: string): string
export function renumberCitations(answer: string, sources: CitationSource[]): { answer: string; sources: CitationSource[] }
export function recoverHandleCitations(answer: string, handles: Record<string, number>): string
export function buildSources(handles: Record<string, Chunk>, cited: number[]): TextCitation[]

// src/lib/citationMarkers.js
export function splitCitationMarkers(text)   // → Array<string | { citation: number }>; expands [2,3] and [2-4]

// src/types/citation.js — JSDoc typedefs for TextCitation | RowCitation exactly as spec §H
// src/ai/sourceReader.js
export async function resolveSpan(ocrText, citation)  // → { from, to, status: 'exact' | 'moved' | 'changed' }
// src/ai/SourceReader.jsx  props { citation, onClose, client? }
// src/ai/SourceList.jsx    props { sources, onOpen }
```

**`ingest-documents`** — `POST /functions/v1/ingest-documents`, bearer =
project secret key.

```
body     { documents: IngestDocument[], dry_run?: boolean }
         IngestDocument { source_key, title, file_name?, file_url?, desk_tier?, desk_feature?, ocr_text, metadata? }
response { results: [{ source_key, status: 'indexed' | 'unchanged' | 'error' | 'dry_run', chunks, inserted, kept, deleted, embedded_tokens, cost_usd, error? }],
           totals: { documents, indexed, unchanged, errors, embedded_tokens, cost_usd } }
```

**Migration `20260921000009_rag_rpcs.sql`** — adds `documents.metadata jsonb
not null default '{}'`, `chunk_commit(uuid, jsonb, text[])` (service role
only) and `match_documents(vector(1536), int, uuid[], text)` (security
invoker, executable by `authenticated` and `service_role`, revoked from
`anon`).

## File structure

| Path | Responsibility |
|---|---|
| `supabase/functions/_shared/textNormalise.ts` (+`_test`) | whitespace folding and SHA-256, the only hashing code |
| `src/lib/textNormalise.js` (+`.test.js`) | byte-identical mirror; parity fixture shared through `src/lib/__fixtures__/normalise.json` |
| `supabase/functions/_shared/chunking.ts` (+`_test`) | heading → table → paragraph → sentence → character cutter; exact spans; versioned hash |
| `supabase/functions/_shared/embed.ts` (+`_test`) | batches, retries, width and model assertions, cost |
| `supabase/migrations/20260921000009_rag_rpcs.sql` | `documents.metadata`, `chunk_commit`, `match_documents` |
| `supabase/functions/ingest-documents/{index,handler}.ts` (+`handler_test`) | upsert → chunk → embed misses → commit → log |
| `supabase/config.toml` | `[functions.ingest-documents] verify_jwt = false` |
| `scripts/ingest-national-desk.mjs` | reads the spec manifest **or** the owner's export (`--export <dir>`), posts batches, `--dry-run` |
| `supabase/functions/_shared/retrieval.ts` (+`_test`) | `search`, `accumulate`, traces, assertions |
| `supabase/functions/_shared/tools/searchDocuments.ts` (+`_test`) | the fixed tool contract |
| `supabase/functions/_shared/citations.ts` (+`_test`) | the citation ladder's pure half |
| `src/lib/citationMarkers.js` (+`.test.js`) | client marker parser; parity fixture `src/lib/__fixtures__/citations.json` read by both runners |
| `src/types/citation.js` | the two `CitationSource` variants, verbatim |
| `src/ai/sourceReader.js` (+`.test.js`) | `resolveSpan` — exact / moved / changed |
| `src/ai/SourceReader.jsx`, `src/ai/SourceList.jsx` | the reader pane and the chip strip; rendered in the agent module |
| `vitest.config.js` | `esbuild.jsx = 'automatic'` so `.jsx` renders in node tests |
| `.env.example` | comment lines for `SUPABASE_URL` + `SUPABASE_SECRET_KEY` use by the ingest script |

## Tasks

### Task 0 — Branch, staging, baseline

1. `git checkout -b task/document-rag` from `main` (done, `7080118`).
2. Stage the export: `ingest/national-desk/ten-smallest/` ← unzip of the
   owner's file. Confirm `git status` does not list it.
3. Baseline: `npm test` (16 pass), Deno tests (35 pass), `npm run build`
   (two baseline warnings).

**Verify:** all three commands green; `git status --short` empty.

### Task 1 — `textNormalise` (both runtimes) and the chunker

**Write scope:** `_shared/textNormalise.ts`, `_shared/textNormalise_test.ts`,
`src/lib/textNormalise.js`, `src/lib/textNormalise.test.js`,
`src/lib/__fixtures__/normalise.json`, `_shared/chunking.ts`,
`_shared/chunking_test.ts`.

Steps:

1. Write the parity fixture: five inputs (tabs, NBSP, CRLF, Devanagari with
   double spaces, leading/trailing whitespace) with their expected
   normalised output and SHA-256. Both test files read it.
2. Failing tests: `normalise` on each fixture line; `sha256Hex('abc')` ===
   `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
3. Implement `normalise = (t) => t.replace(/\s+/g, ' ').trim()` and
   `sha256Hex` via `crypto.subtle.digest('SHA-256', …)` in both runtimes.
4. Chunker tests, written before the code:
   - **one unit:** two units of 1,400 chars each → no span with
     `unitKey` of one and text of the other; every span's `charTo` ≤ its
     unit's length.
   - **exact span:** on a 380-char real OCR passage (from
     `05-2006-32-gaz.md`) and on a 9,000-char synthetic document,
     `content === text.slice(charFrom, charTo)` for every span.
   - **table atomicity:** a 1,200-char Markdown table inside paragraphs is
     one span; a 1,900-char table is split at row boundaries.
   - **target and overlap:** a 5,000-char paragraph-only document yields
     spans ≤ `targetChars + overlapChars` whose starts are ≤ previous
     `charTo` (overlap present) and > previous `charFrom` (progress).
   - **min merge:** a trailing 80-char paragraph is merged into the previous
     span rather than emitted alone.
   - **version in hash:** `chunkDocument(text, { version: 2 })` yields hashes
     disjoint from version 1.
   - **whitespace-only change:** doubling every space yields identical
     hashes and different `charFrom/charTo`.
   - **maxChars:** a 20,000-char string with no whitespace yields spans
     ≤ 6,000.
5. Implement `chunking.ts`:
   - `blocks(text)`: scan lines, group into `{ kind: 'heading' | 'table' | 'para', from, to }`
     where a heading is `/^#{1,6}\s/`, a table is a run of lines starting
     with `|`, and a paragraph is a run of non-blank lines. Offsets are
     absolute into `text`.
   - `pieces(block)`: a table ≤ `tableAtomicMax` is one piece; a longer
     table splits per line; a paragraph splits by
     `/(?<=[.!?।])\s+/` when longer than `targetChars`; any piece longer
     than `maxChars` splits every `maxChars` characters.
   - `pack(pieces)`: greedy; start a new span when adding the piece would
     exceed `targetChars` (a table piece ≤ `tableAtomicMax` may exceed it
     alone); a new span starts at `max(prev.charFrom + 1, prev.charTo −
     overlapChars)` snapped forward to the next whitespace; a final span
     shorter than `minChars` is folded into the previous span when the
     result stays ≤ `maxChars`.
   - `chunkDocument`: `chunkUnit` on the single unit, then index, hash
     (`sha256Hex(chunkHashInput(...))`) and `estimateTokens`.
6. Run both runners; commit
   `feat(rag): text normalisation in both runtimes and the versioned chunker`.

**Vacuity:** delete the `unitKey` guard in `pack` and watch the one-unit
test fail; drop `version` from `chunkHashInput` and watch the version test
fail. Reapply.

### Task 2 — `embed.ts`

**Write scope:** `_shared/embed.ts`, `_shared/embed_test.ts`.

Tests first, all with a fake `fetch`:

- `planBatches` splits 300 short inputs into 4 batches (96/96/96/12) and
  splits two 800k-char inputs (≈200k tokens each) into one per batch.
- A response whose first vector has 1535 numbers → `EmbeddingError`
  with message containing `1535`, before the caller sees any vector.
- A response with `model: 'openai/text-embedding-ada-002'` → throws
  naming the model.
- A 429 then a 200 → success with `requests === 2`; a 400 → throws with
  `status 400` and no retry.
- Cost: `usage.prompt_tokens = 1234` → `costUsd = 1234 * 2e-8`; a second
  batch failing after the first succeeded → `EmbeddingError.costUsd`
  equals the first batch's cost.
- Response order: `data` returned shuffled by `index` is re-sorted.

Implementation notes: request `{ model: EMBED_MODEL, input: string[],
encoding_format: 'float' }` with headers `Authorization: Bearer <key>`,
`HTTP-Referer: https://niyantran.ai`, `X-Title: Niyantran Terminal`; retry
on 429 and ≥ 500 up to 3 attempts with 500 ms × attempt backoff; verified
response fields `data[].embedding`, `data[].index`, `model`,
`usage.prompt_tokens` (OpenRouter docs, 2026-09-21).

Commit `feat(rag): OpenRouter embeddings client with width and model assertions`.

**Vacuity:** remove the width assertion → the 1535 test fails by name.

### Task 3 — Migration 0009: `documents.metadata`, `chunk_commit`, `match_documents`

**Write scope:** `supabase/migrations/20260921000009_rag_rpcs.sql`.

SQL as in spec §D, plus `alter table public.documents add column metadata
jsonb not null default '{}'`, `chunk_commit` returning
`{ inserted, kept, deleted }`, insert requiring a 1536-wide embedding (a
missing embedding on a miss raises), and grants: `chunk_commit` to
`service_role` only; `match_documents` to `authenticated, service_role`,
revoked from `anon` and `public`.

Apply with `supabase db push` (sandbox off), then evidence in SQL with a
synthetic document and a synthetic vector:

1. Insert a document; call `chunk_commit` with three rows → `{3,0,0}`.
2. Same call again with all three hashes kept → `{0,3,0}`; ids unchanged.
3. Replace one hash → `{1,2,1}`; the two kept ids unchanged.
4. `match_documents(<row 1's vector>, 5)` returns row 1 first with
   similarity ≥ 0.999.
5. Delete the synthetic document (cascade).

**Vacuity:** run `match_documents` ordered by `(embedding <=> q)` desc in
an ad-hoc query and observe row 1 last.

Commit `feat(rag): chunk_commit and match_documents RPCs`.

### Task 4 — `ingest-documents`

**Write scope:** `supabase/functions/ingest-documents/{index,handler}.ts`,
`handler_test.ts`, `supabase/config.toml`.

`handler.ts` exports `handleIngest(req, deps)` with

```ts
export interface IngestDeps {
  secretKey: string;
  embed: (inputs: string[]) => Promise<EmbedResult>;
  db: {
    findDocument(sourceKey: string): Promise<{ id: string; content_sha256: string; chunker_version: number | null } | null>;
    upsertDocument(row: DocumentRow): Promise<{ id: string }>;
    existingHashes(documentId: string): Promise<Set<string>>;
    chunkCommit(documentId: string, rows: CommitRow[], keep: string[]): Promise<{ inserted: number; kept: number; deleted: number }>;
    markIndexed(documentId: string, chunkerVersion: number): Promise<void>;
    logCall(row: CallLogRow): Promise<void>;
  };
  origins?: string[];
}
```

Tests (fake deps): 401 without the right bearer; 405 on GET; unchanged
document (same sha, same version) → `status 'unchanged'`, no embed call;
changed document → only the hash misses are embedded and `kept` counts the
hits; one document throwing inside the batch → its `status 'error'` while
the others index; `dry_run` → no writes, counts reported; a
`model_call_logs` row is written per embed request with `caller
'ingest-documents'`, `purpose 'embedding'`, tokens and cost; an
`EmbeddingError` after one successful batch still logs that batch's cost.

`index.ts` wires `serviceClient()`, `embedTexts` with
`OPENROUTER_API_KEY`, and `secretKey()`.

Deploy: `supabase functions deploy ingest-documents` (sandbox off), then
`curl -X POST … -H 'authorization: Bearer wrong'` → 401 and a POST with the
real key and `{ documents: [], dry_run: true }` → 200.

Commit `feat(rag): ingest-documents edge function`.

### Task 5 — The ingest script, run on the ten documents

**Write scope:** `scripts/ingest-national-desk.mjs`, `.env.example`.

The script accepts either `--manifest <file>` (spec shape) or `--export
<dir>` (the owner's export: reads `manifest.json`, each `markdown` file as
`ocr_text`, each `metadata` file into `metadata`, and derives `source_key =
id`, `title`, `file_name = filename`, `file_url = null`, `desk_tier =
'national'`, `desk_feature = feature`). Reads `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` from the environment (`.env.local` is loaded if
present, never committed). Batches of 20. `--dry-run` passes `dry_run: true`.
Prints one line per document and the totals; exits 1 if any `error`.

Run, in order, sandbox off:

```bash
node scripts/ingest-national-desk.mjs --export ingest/national-desk/ten-smallest --dry-run
node scripts/ingest-national-desk.mjs --export ingest/national-desk/ten-smallest
node scripts/ingest-national-desk.mjs --export ingest/national-desk/ten-smallest   # second run: all 'unchanged'
```

Evidence queries: `select count(*) from documents` = 10;
`select count(*) from document_chunks where embedding is not null` = all
chunks; `select count(*), sum(prompt_tokens), sum(cost_usd) from
model_call_logs where caller = 'ingest-documents'`; and for one document,
`content = substr(ocr_text, char_from + 1, char_to - char_from)` for every
chunk.

Commit `feat(rag): national desk ingest script`.

### Task 6 — Retrieval and the `search_documents` tool

**Write scope:** `_shared/retrieval.ts`, `_shared/retrieval_test.ts`,
`_shared/tools/searchDocuments.ts`, `_shared/tools/searchDocuments_test.ts`.

Tests: `search` refuses a 1535-wide query vector and a wrong model before
calling `rpc`; passes `match_count`, `p_desk_tier` and `query_embedding`
through; maps rows to `Chunk` with `text_hash = sha256Hex(normalise(content))`;
emits a trace with `noChunks` when empty; `accumulate` unions by id keeping
the higher similarity; `executeSearchDocuments` forwards `desk_tier` and the
tool JSON equals the spec block.

Live evidence: with the stored vector of the first chunk of
`2005-115-gaz` read back from the database, call `match_documents` under a
minted user session and confirm that chunk ranks first. A natural-language
query end to end needs the OpenRouter key on this machine; that is
recorded as a limitation and closed by the agent module's first turn.

Commit `feat(rag): retrieval module and the search_documents tool contract`.

### Task 7 — Citation ladder (server) and marker parser (client)

**Write scope:** `_shared/citations.ts`, `_shared/citations_test.ts`,
`src/lib/citationMarkers.js`, `src/lib/citationMarkers.test.js`,
`src/lib/__fixtures__/citations.json`, `src/types/citation.js`.

Tests: `[2, 3]` and `[2-4]` expand to singles; `[1-40]` (span > 5) and
`[120]` (> 99) are left as text; `renumberCitations` with sources 1 and 2
and an answer citing `[3]` strips `[3]` and keeps `[1][2]`; an answer
citing only `[2]` renumbers it to `[1]` with one source; `recoverHandleCitations`
matches `ref:k3f-11` before `ref:k3f-1`; the client parser on the shared
fixture produces the same marker list as the server's expansion.

Commit `feat(rag): citation ladder and the shared marker parser`.

### Task 8 — Reader and source list

**Write scope:** `src/ai/sourceReader.js`, `src/ai/sourceReader.test.js`,
`src/ai/SourceReader.jsx`, `src/ai/SourceList.jsx`, `vitest.config.js`.

`resolveSpan(ocrText, citation)`: recompute the hash over
`ocrText.slice(char_from, char_to)`; equal → `exact`; else `indexOf` of the
cited `content` (carried on the citation as `content?` when available;
otherwise search by the normalised text) → `moved` with the new span;
else `changed` at `{0, 0}`. Tests cover the three outcomes.

`SourceReader.jsx`: loads `documents` by id through the Supabase client,
renders three `<span>`s (before, highlighted, after) inside a scrollable
pane, scrolls the highlight into view on mount, shows the `moved` /
`changed` notices, and a header with title, file name, and a link when
`file_url` is present. `SourceList.jsx`: one chip per distinct
`document_id`, in first-citation order. Both render to static markup in a
Vitest test through `react-dom/server`.

`npm run build` must carry only the two baseline warnings.

Commit `feat(rag): source reader and source list components`.

### Task 9 — Close

1. This plan → Historical with the verification record below filled.
2. `docs/agents/coordination.md` shared knowledge: the corpus lives in
   `NTER`, the ingest path, the reader.
3. `git checkout -- public/data` before every commit (the dev server's feed
   plugins rewrite them).
4. Merge `task/document-rag` into `main` locally. Report; do not push.

## Owner inputs

- None blocking. A `file_url` per document is absent from the export; the
  reader shows the file name and omits the link until Niyantran supplies
  URLs.

## Risks

| Risk | Mitigation |
|---|---|
| OpenRouter's embeddings response differs from the documented shape | width and model-echo assertions throw before any store; the first live run is a dry run followed by ten tiny documents |
| Tiny documents produce one chunk each, hiding packing bugs | the synthetic 5,000- and 9,000-char tests exercise packing and overlap |
| Hindi OCR is mostly noise | cited faithfully; not the module's concern |
| `verify_jwt = false` on the ingest function | bearer compared timing-safe to the secret key; 401 test and a live 401 probe recorded |

## Verification record

All on 2026-09-21, branch `task/document-rag`, against `NTER`.

| # | Check | Result |
|---|---|---|
| 0 | Baselines before any change | Vitest 16/16, Deno 35/35, build with the two baseline warnings; `ingest/` staged and absent from `git status` |
| 1 | Task 1 tests | Deno 11 (normalise 2, chunker 9), Vitest 3; parity fixture shared. Vacuity: `.trim()` on `content` → exact-span test fails (after the fixture gained trailing spaces, without which it did **not** fail); version dropped from the hash input → version test fails |
| 2 | Task 2 tests | Deno 7. Vacuity: width assertion removed → the 1535 test fails by name |
| 3 | Migration 0009 applied (`supabase db push`) | history 0001–0009 in sync. Synthetic document: first commit `{3,0,0}`, second `{0,3,0}` with ids unchanged, one hash replaced `{1,2,1}` with the two kept ids unchanged, `match_documents` with row 1's vector → row 1 first at similarity 1.0000, a miss without an embedding raises, cascade delete leaves 0 chunks. Vacuity: ordering by distance desc puts row 1 last. Grants: `chunk_commit` service_role only; `match_documents` authenticated + service_role, anon refused |
| 4 | `ingest-documents` | Deno 6 handler tests; `deno check` on the entrypoint; deployed with `verify_jwt = false`; POST with a wrong bearer and with no bearer → 401 `{"error":"service key required"}` from the handler |
| 5a | First live run | The model-echo assertion fired on every document: OpenRouter echoes `text-embedding-3-small` without the vendor prefix. Nothing stored; ten `error` rows in `model_call_logs`. `servedModelMatches` accepts the unprefixed spelling only; test added; redeployed |
| 5b | Dry run, live run, second run | 10 documents, 19 chunks (1–3 each). Live: 10 indexed, 4,886 prompt tokens, USD 0.0000977. Second run: 10 unchanged, 0 embed calls |
| 5c | Corpus evidence (SQL) | documents 10, indexed 10; chunks 19, embedded 19; `content = substr(ocr_text, char_from+1, char_to-char_from)` for 19/19; `model_call_logs` for `ingest-documents`: 10 success rows (4,886 tokens, USD 0.000098, served `openai/text-embedding-3-small`) and 10 error rows from 5a |
| 6a | Retrieval and tool tests | Deno 4 + 2 (width and model refused before the RPC, arguments forwarded, text hash, trace, accumulate, tool JSON) |
| 6b | `match_documents` live | Probe: first chunk of `2005-115-gaz` with its own stored vector → itself first at 1.000, then `2006-32-gaz#0` 0.769, `2005-115-gaz#1` 0.768. Repeated under a minted user session with the same result; `chunk_commit` as that user → permission denied; anon `select` on `documents` → permission denied |
| 7 | Citation ladder | Deno 7 (limits, fixture expansion, renumber strips `[3]` with two sources and renumbers a lone `[2]` to `[1]`, `ref:k3f-11` before `ref:k3f-1`, buildSources, citedIds); Vitest 3 on the same fixture — parity proven |
| 8a | Reader logic and components | Vitest 4 (`resolveSpan` exact / moved incl. respaced / changed; blank needle) + 3 (chips per document in first-citation order, row citations ignored, empty list renders nothing, reader header + loading state via `react-dom/server`). Vitest total 29/29; Deno total 72/72; build with only the two baseline warnings |
| 8b | Reader live data path | Under the minted user: `documents` and `document_chunks` readable; client `sha256(normalise(content))` equals the server formula → `exact`, and the highlighted span equals the chunk content byte for byte; stored text edited inside the span → `changed`; a preamble inserted before the document → `moved` and the highlight still equals the content |
| 9 | Throw-away user | `rag-smoke-<ts>@example.com` created by the admin API for 8b/6b and deleted in the same script (HTTP 200); `auth.users` is empty again |

## Known limitations

- **The reader is not mounted.** `SourceReader.jsx` and `SourceList.jsx`
  exist, render, and their data path is proven, but nothing in the app
  opens them yet: the citation bubble and the dock wiring belong to
  `streaming-research-agent`, which is the next module. A browser
  screenshot of a highlighted passage therefore waits for that module.
- **No natural-language query has been run end to end.** `match_documents`
  is proven with stored vectors; a query typed in words needs the query
  embedded, and the OpenRouter key exists only as a function secret. The
  agent module's first `search_documents` call closes this.
- **`file_url` is empty** for every document: the export carries none. The
  reader shows the file name and omits the link.
- **Tiny corpus.** One to three chunks per document; packing and overlap
  are exercised by the synthetic tests, not by these files.
- The ten `error` rows in `model_call_logs` from the first live run are
  kept as telemetry of the assertion doing its job.
