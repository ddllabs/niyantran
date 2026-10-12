# Citation Pack passing-subset ingestion

> **Status: Historical (2026-10-11).** Executed under the owner's instruction to fix mappings and ingest each passing subset without waiting for held files.

## Verified production result

Two previously absent sources are now indexed, adding RAG coverage to two previously uncovered listing keys. The unchanged deployed version-4 Edge Function produced 17 complete chunks and embeddings.

| Listing | Key | Source key | Document ID | Chunks |
| --- | --- | --- | --- | ---: |
| Constitution (Scheduled Tribes) Order (Fifth Amendment) Bill, 2022 — Chhattisgarh | bill:2022:220 | 859abed1c9d3b25a11c15beca6122838b4e6b672 | d689265c-ab66-4354-ab1b-4146ba72ee3e | 10 |
| Constitution (Scheduled Tribes) Order (Third Amendment) Bill, 2022 — Himachal Pradesh | bill:2022:218 | 0be2479d1661d7144d4a18adf8301a848c7014c0 | fdb6f993-c586-4a1f-aad0-807926ee1640 | 7 |

Global counts changed exactly from **2,767 documents / 2,764 indexed / 87,886 chunks** to **2,769 / 2,766 / 87,903**. Covered listing bill keys are now **1,478**. Zero orphan chunks and zero null vectors. ANALYZE completed for documents, document_chunks and desk_rows; both n_live_tup and planner estimates exactly match real counts of 2,769, 87,903 and 34,184 respectively.

All 17 vectors, spans, section values, chunk hashes and embedding-input hashes independently audited. Both operative clauses recognized in each source; Chhattisgarh clause 2 retains all ten amendments and the complete community-name continuation. Back covers have their own section and do not inherit clause 2. Thirteen chunks have section context. All eight independent bill-scoped stored-vector citation probes passed, including every operative chunk; URLs/spans/text hashes and section context agree. These are retrieval/citation probes, not a claim that an owner tested generated natural-language answers.

Two paid requests, one per document; no retries, deletions, existing-source overwrites or unknown usage. Actual **1,750 tokens / USD 0.000035**. Sampled CPU **1.27%**, available memory **52.42%**, disk busy **0.057%**. All four live health windows passed. Supervisor completed and locks released normally. **Never restart this completed release.**

## Mapping and quality corrections

These two sources were deliberately selected outside the earlier 500-source review cohort because their actual deployed Download selections already point to the correct source PDFs. They can proceed without publishing the broader local resolver changes.

The Citation Pack retains original 2022 listing titles, while the final PDFs use 2023 titles with changed amendment ordinals. Covers and operative pages explicitly print registrations **220-F of 2022** and **218-F of 2022** alongside the final titles. Registration keys remain 2022; source_title and citation.bill_name record the final PDF title, with registration_year and passed_title_year kept separately. This is a source-specific reviewed relationship, not a relaxed title/year matcher.

The seven PDF pages were rendered and read. Native PDF text geometry separates marginal references from operative paragraphs while retaining every extracted body/margin word. The unchanged source originals remain in the corpus and the job's raw directory. Separately hash-bound repaired copies restore clause recognition, put margin notes under explicit headings, and terminate operative context before back covers. The 218 cover's spurious OCR label ORIGINAL (absent from the rendered image) was removed and ACT NO spacing joined. Independent PDF.js extraction matched all distributed body samples: 30/30 and 14/14. Wrong title and wrong registration controls were rejected. Mutated original/PDF hash controls were also rejected.

Only **two analysis identity bindings** were added to the local companion, for analysis keys 149 and 152; the previous 65 were preserved exactly. Fresh Supabase rows agree in both listing features without a key collision. The deployed production JavaScript resolver and analysis JSON were fetched; inspected pure resolver functions were replayed against the fresh rows. Their Download URLs agree with the corrected local resolver and the exact freshly fetched source PDF hashes. This is deployed-code/data verification, not an interactive browser click claim.

## Release and verification

Artifact directory:
`/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/citation-pack-preflight-20261011/same-download-review`.

Completed manifest: `job/stage-02.release.json`, SHA-256 **a7fbe4da93456ff9834ed2b39e965bb307f23fa96d0a40bbc1dd07d943ab1faf**. Bound checkpoint, baseline, mapping proof, source-repair proofs, quality reviews and independent verification receipt are alongside it. Limits: USD 0.10, one document in flight, full context mode, standard stage/maintenance limits. The actual two-document run did not reach the 20-document/2,000-chunk maintenance boundary; final audit and ANALYZE were still performed.

The first manifest passed dry run but live execution refused its missing release_note before any write. A new manifest records the owner's authorization and received a fresh hash-bound baseline; the earlier file was preserved. The initial independent citation-metadata audit used order-sensitive JSON serialization and failed because JSONB reordered keys; a fresh live read confirmed values, and key-order-independent deep equality passed. Neither incident caused a paid retry or data alteration.

Executed checks:

- `node --experimental-strip-types --test scripts/corpus-source-repair.test.mjs scripts/corpus-stage-job.test.mjs scripts/corpus-batch-review.test.mjs`: **65 passed**.
- `npx vitest run src/lib/impactRecord.test.js`: **7 passed**.
- `npm run build`: passed; existing >500 kB bundle warning remains.
- `git diff --check`: passed.
- Manifest loader, exact source/PDF/repair hashes, endpoint dry runs, current provider price, fresh retrieval baseline and official metrics passed before writes.
- `verify-same-download.mjs`: independently verified two documents / 17 chunks / eight scoped citation probes.
- Fresh Supabase count, orphan/null-vector and post-ANALYZE real/planner comparisons passed.

## Remaining work

The broader mapping inventory produced **3,040 pack/current-listing identity proposals** from 4,576 analysis entries; **1,536** remain unresolved by that conservative join. Those proposals are saved as drafts, not added wholesale to the application, deployed or certified for ingestion. Mapping agreement alone does not certify the PDF body or Download/version relationship.

The earlier 500-source cohort remains a review inventory, not an executable job. Its source-specific Download/version and text-quality issues remain separate from this completed subset. Existing Government/University context-repair holds, recovery stubs, shared-key collisions, unsupported Gazette relationships and other earlier holds were not released. No claim that all mapping blockers are fixed or the remaining corpus is unusable.

Changed repository paths this turn: local analysis identity companion (two records), active spec/plan, corpus operations guidance, R7 and this execution report. Prior uncommitted code preserved on task/corpus-single-pilot-20261009. No chunker/Edge implementation change, frontend/function deployment, schema/compute change, original corpus edit, Git commit, push or merge.

For owner testing, refresh and reattach either listing. Ask which communities the Chhattisgarh bill adds or renames, or what the Himachal Pradesh bill adds for the Hattee community, requesting citations.
