# Existing-text section context: implementation evidence

> **Status: Living.** Implementation and review on 2026-10-09; the owner-authorized production pilot subsequently completed. See the execution record below.

## What changed
The existing-text endpoint accepts explicit `chunking_mode: "section_context_v1"`, producing version-4 document chunks. Historical requests still use version 2; Mistral page version 3 is unchanged. The new pure source parser recognizes Markdown headings, printed chapters/parts, conservative body clause markers and left-side clause labels, schedules, memoranda and extracted-Act headings. It excludes arrangement-of-clauses context until an enactment formula. Unknown layout falls back to ordinary text; it does not fabricate page coordinates, right-margin notes, missing headings or clause titles.

Chunks pack within detected sections with the existing 1,000-character target, 200-character overlap, 6,000-character fallback maximum, paragraph/sentence splitting, Markdown table handling and atomic link/image placeholders. Overlap remains inside the same section. Hard cuts prefer available whitespace. Short opening labels merge with their following paragraph when the combined span fits the maximum; short entire sections may still produce small chunks. An unbroken token longer than the maximum may still require a character fallback. These rules preserve every returned citation span as an exact slice of the original OCR text; no truncation or source rewriting occurs.

Embedding inputs carry bounded source heading/label context and repeated Markdown table headers where available. Only the embedding input receives the prefix; citation content remains exact. The input hash is stored in `embed_hash`, section data in `metadata.section`. Chunk identity includes version and normalized embedding-input hash. A continuation under changed context cannot reuse its old bare-text vector. The existing retry/commit protocol remains, including full keep lists and indexing only after all commits. An omitted mode refuses already upgraded documents, including interrupted unindexed upgrades, instead of silently downgrading them. Any future parser/prefix contract change must bump the version because unchanged-text requests short-circuit on document version.

The job runner freezes and verifies context hashes, section metadata and full embedding-input byte budgets. JSONB key order does not affect metadata comparison. A version-4 dry run must explicitly acknowledge `chunker_version:4`; an old endpoint is rejected before a paid call even when its chunk count coincidentally matches. Its tested character guard can be set up to 75,000; per-document 100 chunks, stage 1,000 chunks, 30 documents, two-second gap, attempt and budget bounds remain. A 101-chunk document is held whole, never cut to its first 100 chunks.

## Corpus execution evidence
All 48 previously PDF/mapping-verified medium sources were re-read locally, with original text hashes and cached PDF hashes checked. The final version-4 audit yields **10,689 chunks**, compared with 10,093 for version 2. Of these, 9,395 have detected heading context and 6,922 have clause/label context; these counts overlap. All audited spans remain exact; zero word-interior boundaries were found. Largest content span is 6,000 characters and largest embedding input 6,045: none reaches the provider's 32,000-character clamp.

These are source-marker and integrity checks, not a measurement of semantic retrieval accuracy or proof that every OCR heading is recoverable. Live model quality still needs the owner RAG test. The 69 mapping/identity/body holds remain separate and were not ingested.

Six of the 48 fit the worker's 100-chunk /75,000-character bounds after the correction:

| Bill key | Document | Chunks |
| --- | --- | ---: |
| bill:2025:22 | Immigration and Foreigners Bill, 2025 | 91 |
| bill:2025:76 | National Sports Governance Bill, 2025 | 100 |
| bill:2021:158 | Biological Diversity (Amendment) Bill, 2021 | 82 |
| bill:2013:148 | SC/ST (Prevention of Atrocities) Amendment Bill, 2013 | 80 |
| bill:2007:99 | Authority for Advance Rulings on Central Taxes Bill, 2007 | 83 |
| bill:1985:210 | Industrial Finance Corporation (Amendment) Bill, 1985 | 82 |

Total: six documents /518 chunks. The other 42 need a separately bounded larger-document execution design; their source mapping passes have not been revoked by the chunk-count guard. Historical eight-document proposals are superseded for context ingestion, not extended silently.

Final artifact directory: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/text-context-v4-final`. It contains exact cached text/PDFs, all 48 refreshed receipts, input examples, runtime checks and two **unauthorized** proposals:

- `pilot-proposal.json`: one Immigration/Foreigners document, `bill:2025:22`, source `6c18b649806b7aa824a8226ffdb9701fed15e88f`, 91 chunks; SHA-256 `6dcc1bcaef28cd3b344d0b1db38da3c45fb26b57b41fa99791331277b3aa0e9c`. Full input byte ceiling 70,934, one-attempt ceiling USD 0.00141868 at the last verified price; proposed total budget USD 0.015 covers bounded retries. Price must be checked again at release.
- `follow-up-proposal.json`: five other documents /427 chunks; SHA-256 `827f0c29f58c99a26473e4b4a6b70572f12746f5a88a14a314b9c007dd5151bf`; proposed budget USD 0.08. Requires pilot acceptance and separate execution release.

Both proposals load and independently reproduce every frozen span, context hash and token ceiling. Earlier exploratory version-4 drafts remain unauthorized and cannot pass current preparation checks after the label-packing correction.

## Verification and limits
Red tests reproduced short-section merging, missing carried context, incorrect identity reuse, handler mode ignored, legacy upgrade short-circuit, whitespace hard-cut damage, source-preflight hash acceptance, missing runner context validation, unsupported character limit and isolated short clause label. Implementations then passed the relevant guards.

- `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/textContext_test.ts supabase/functions/ingest-documents/handler_test.ts supabase/functions/_shared/chunking_test.ts`: **65 passed**, including unchanged legacy/page regression fixtures.
- `node --test scripts/corpus-context-preflight.test.mjs scripts/corpus-stage-job.test.mjs scripts/corpus-job-preflight.test.mjs scripts/corpus-job-supervisor.test.mjs`: **59 passed**, including real-handler/fake-provider reconciliation and 75,000/75,001 character boundaries.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: **874 passed**.
- `npm test -- --run`: **184 files /2,465 tests passed**.
- `npm run lint`: passed with zero warnings; `npm run build`: passed, existing >500 kB bundle warning.
- `bash supabase/tests/run.sh page_contract corpus_revision_integrity`: both disposable local SQL fixtures passed, with removal-of-migration vacuity checks failing as required. Initial sandbox Docker access failed; the two known disposable containers were started and checks rerun successfully. No live database used as a test fixture.
- Local 91-chunk handler output uses fake vectors only. The actual handler output was committed through the real `chunk_commit` in `niyantran_page_contract_test`: 91 rows, exact global spans and section/input hashes, zero scoped results while unindexed and 91 after indexing. The transaction rolled back. This proves storage/visibility plumbing with fake vectors, not semantic model quality. Docker Desktop had to be reopened after its socket disappeared before this extra probe.
- `git diff --check`: passed. Node emits the existing experimental type-stripping warning. Supabase changelog Markdown could not be fetched through the web reader (unsupported content type); the [current RPC reference](https://supabase.com/docs/reference/javascript/rpc) and existing repository migration/adapter contract were checked. No Supabase client signature or schema changed.

At the pre-release local verification boundary, live read-only counts were: **2,455 documents /2,452 indexed /57,153 chunks**. At that boundary, zero version-4 documents and zero proposed-pilot sources existed in production. No deployment, provider charges, production data writes, existing-document re-embedding or cleanup occurred during that local phase. Changes remain uncommitted on `task/corpus-single-pilot-20261009`, alongside preserved earlier corpus work; main is unchanged and matches origin/main.

## Release procedure
Deploy only `ingest-documents` after exact owner authorization. Then refresh the pilot's actual PDF/current listing mapping and model price, record a manifest-bound health baseline, pass the live dry run, release the frozen one-document proposal, verify stored hashes/sections/spans/vectors/scoped retrieval, ANALYZE and test Download PDF plus text citations in the owner chat. The existing Mistral documents and 2,452 indexed documents are not a blanket migration target. Bulk re-embedding needs its own inventory, budget and release.

## Authorized production pilot

The owner subsequently authorized deployment and the single pilot. `ingest-documents` version19 is deployed; Immigration/Foreigners2025 (`bill:2025:22`) now has91 verified version-4 chunks. CostUSD0.0002621. Current counts:2,456 documents /2,453 indexed /57,244 chunks /1,347 covered listing bill keys. [Execution evidence](2026-10-09-text-context-pilot-run.md). Owner subsequently confirmed the live RAG pilot worked and authorized the five follow-up documents /427 chunks. Their execution is recorded separately; larger sources and broader re-embedding remain outside the release.

Five-document follow-up subsequently completed:427 new chunks,USD0.00133476; all stored source/context/vector/spans and scoped citations verified. [Execution evidence](2026-10-09-text-context-follow-up-run.md). Current totals2,461 documents /2,458 indexed /57,671 chunks /1,352 covered listing bill keys. The six-source bounded context cohort is complete;42 larger approved sources and69 medium holds remain.
