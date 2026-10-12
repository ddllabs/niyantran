# Version labels and next uncovered-bill mappings

> **Status: Living.** Executed2026-10-09; R7. [Spec](../specs/2026-10-09-corpus-version-labels.md), [plan](../plans/2026-10-09-corpus-version-labels.md). Local correction and read-only production/source verification; no function deployment, ingestion or publication.

## Result

RAG's local retrieval-to-model path now transports recognized document version roles from documents.metadata and adds a fixed version label to every corresponding passage. Introduced, Lok-Sabha-passed, Rajya-Sabha-passed and both-Houses-passed text can be distinguished explicitly; supported gazette/errata roles are labelled without assuming enactment. Model guidance requires version-specific attribution and does not treat introduced provisions, or a passed-bill label alone, as evidence of enacted law, assent or commencement.

All175 previously prepared alternate documents /12,842 passages passed the new label audit. Original text hashes, character spans, passage content and citation source URLs remain unchanged. No embeddings were regenerated. A complete fake-provider mixed-version search-to-model test confirms separate labels/handles reach the model. This is executable transport evidence, not natural-language production acceptance.

The next read-only mapping cohort found19 additional source-proven documents /18 currently uncovered bill keys /64 complete context chunks. Their actual source PDFs and local OCR match current bill identities, but their current Download links still point elsewhere. They remain correction proposals, **zero ingestion-ready sources from this new cohort**, pending a verified resolver correction. Six of the25 selected sources remain held.

## Implementation and permissions

The existing match_documents ranking/scope RPC is unchanged. Its returned document IDs are deduplicated and read in pages of100 using the **same caller client**, indexed filter, bounded timeout and turn cancellation. Only id/metadata is selected. This read is included within retrieval timing. There is no service-role metadata read in the deployed-code path. Empty retrieval performs no metadata read; missing, foreign, duplicate or failed metadata results fail rather than silently removing labels.

Only a fixed allowlist becomes document_role on Chunk and a fixed human label in renderChunk. Raw or hostile metadata is excluded. Unknown and legacy roles remain absent; unlabeled non-page and page fixtures preserve their old headers. Citation contracts, source text, spans, hashes, embeddings, schema and UI remain unchanged.

Changed source paths: _shared/retrieval.ts and its test; research-chat/index.ts, agent.ts, prompt.ts and their respective tests. Scope stayed outside auth/persistence/billing and the previous ingestion implementation.

## Verification

- Before implementation, recognized-role mapping and passage-render tests failed (95 existing tests passed, two new tests failed); caller-wiring test failed independently. Helper/prompt tests initially failed to compile because the helper did not yet exist. One intentional hostile runtime fixture needed an unknown-to-Chunk cast after introducing the role type. A first combined string filter selected zero tests; the actual focused suite was rerun and failures verified before implementation.
- Final focused Deno:154 pass. Full `deno test -A --config supabase/functions/deno.json supabase/functions`:880 pass. `npm test -- --run`:2,465 pass /184 files. `npm run lint`:pass, zero warnings. `npm run build`:pass, existing>500kB bundle warning remains. `git diff --check`:pass. No schema changes or live SQL test fixtures.
- A disposable mutation removed the passage-label line. The mixed-version search-to-model test failed, proving it catches missing labels. Original source was not mutated; disposable copies removed.
- Prepared audit:175 sources /12,842 passages checked against cached original text/expected offsets and current rowToChunk/renderChunk. Every label, content, normalized citation hash and source URL matched; no paid requests.
- Live stored-vector probe:10 scoped retrievals followed by bounded metadata hydration successfully labelled every passage for one already indexed both-Houses-passed document. Sampled RPC p95~361ms, metadata read p95~336ms, combined p95~692ms. This laptop-to-Supabase server-credential read probe measures an added network round trip, not deployed Edge latency or caller authentication. Caller permission/cancellation wiring is exercised separately in local runtime tests. Zero new query embeddings/provider/model calls. Do not claim500-document load capacity from this probe.
- Fresh Supabase role distribution:2,361 indexed documents have no document_role,100 introduced,84 passed both Houses,21 passed Lok Sabha,seven passed Rajya Sabha. Old missing labels remain unknown; no roles were guessed from filenames or backfilled. Before production version-comparison acceptance, consider verified metadata backfill for relevant existing counterparts as a separate data operation.
- Final read-only counts unchanged:2,576 documents /2,573 indexed /72,917 chunks; zero orphan chunks; restart unchanged2026-09-28T08:19:47.722698Z. Current listing coverage remains1,464 bill keys.

## Fresh remaining-pool screen

Read all2,576 current document metadata records and19,634 current bill listing rows across both bill features. Frozen unstored bill sources remain6,829.761 belong to keys already indexed;6,068 source candidates /5,256 distinct candidate keys currently lack an indexed document. These are **screened candidate keys**, including unresolved collisions and unverified PDFs, not5,256 verified ingestible bills or a claim about total platform coverage.

| Fresh screen | All unstored sources | Uncovered-key sources |
| --- | ---: | ---: |
| Different Download URL, correction/proof pending |5,294|4,595|
| Listing identity hold |438|401|
| Missing Download URL |830|828|
| Exact Download URL, full proof pending |267|244|
| Total |6,829|6,068|

This fresh table groups by current identity/Download relationship without the old separate oversize bucket;267 exact-URL sources include those older size exclusions. Different URLs include valid version differences and wrong-bill links and are not all wrong. The older frozen report categories remain dated evidence, not overwritten conclusions.

Selected25 small ordinary-version candidates on currently uncovered keys, with different Download URLs, sorted by legacy chunk count/source ID. Streamed the original archive and bill citation pack again, checked source hashes/lengths, fetched bounded public PDFs, checked number/year/title/chamber/version and distributed>=90% body agreement, and prepared full context chunks.19 pass source-only proof /18 keys /64 chunks. Holds:four unreadable/disagreeing number/year,one title,one version. No wrong button was treated as corrected, and no execution manifest was released.

Two concrete correction proposals:

- Prohibition of Multi-Digit Lotteries Bill2021, bill:2021:134: source `134 of 2021 AS.pdf` passes introduced-bill proof and produces three context chunks. Current Download resolves to `2011-134-gaz.pdf`, a different year. Source key de9d067e45679d20b349d13f6970d2bf4629a474.
- Infants, Children and Young Adults Comprehensive Care and Protection Bill2022, bill:2022:16: source `16 of 2022 as introduced.pdf` passes and produces one context chunk. Current Download resolves to `16_2000.pdf`. Source key e80756b6e1aba6ea39d9269c732b17d2e50c34e3.

## What remains

Activate the verified research-chat change through an exact function release and exercise owner natural-language mixed-version RAG acceptance. Existing unlabeled documents require verified role provenance before any metadata backfill. Correct the bill Download resolver using verified year/title/house/key mappings, then recheck proposals against the actual UI button/current listing before paid ingestion. Do not join ordinal analysis entries to current tracker rows or bill number alone, and do not publish a replacement corpus registry without an exact inventory/release. Other gazette, collision, missing-link, large-source and nonbill holds remain under R7.

Branch task/corpus-single-pilot-20261009 and all new/prior corpus changes remain local and uncommitted. main, deployed functions/application and original data collections were untouched.

Evidence roots:

- `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-version-labels-20261009/`:prepared-label-audit.json, live-role-probe.json, focused/full test/build/lint/mutation logs.
- `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-uncovered-screen-20261009/`:fresh documents/listings, full screen, selected25, source-PDF/text caches, source-proof receipts and reconciled summaries. No secret credentials saved in evidence.

Supabase's current [AbortSignal documentation](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal) was checked through the plugin. The markdown changelog URL could not be parsed by the browser tool (unsupported content type); no new client/API feature or version change was introduced.
