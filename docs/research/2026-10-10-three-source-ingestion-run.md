# Three pending corpus sources ingested

> **Status: Historical (2026-10-10).** Exact owner-authorized three-source execution, independently verified.

The three previously absent sources are now indexed and attached to their current bill listings. This is actual production ingestion, not an additional mapping-only study. No existing source was overwritten or re-embedded.

| Bill | Bill key | New chunks | Document ID |
| --- | --- | ---: | --- |
| The Code on Social Security, 2019 | bill:2019:375 | 631 | 05b69bc8-9108-4185-9111-4a90e1a9a4ac |
| The Financial Resolution and Deposit Insurance Bill, 2017 | bill:2017:165 | 635 | 59d9b9c8-1919-4168-a166-8737a5c2e7bd |
| THE BHARATIYA NYAYA SANHITA, 2023 | bill:2023:173 | 608 | d462f08d-7e29-4e4e-a192-cf7907a8f705 |

Totals moved from2,751 documents /2,748 indexed /85,759 chunks /1,464 listing-covered bill keys to **2,754 documents /2,751 indexed /87,633 chunks /1,467 listing-covered bill keys**. Exact deltas: +3 documents, +3 indexed, +1,874 chunks, +3 covered bills. Global orphan chunks, null embeddings and chunks attached to unindexed documents are all zero. Three existing unindexed stubs remain unchanged.

## Source preparation and quality

Original OCR remains unchanged. Reviewed local repaired copies separate interleaved PDF margin headings/statutory references into a labeled appendix and exclude printed line numbers. Unaffected page layouts are preserved exactly. Full version4 context chunking retains complete text; no document is truncated. Original output2,306 chunks became1,874 through layout normalization, not a chunk-count cap. Each repaired source retains raw/PDF/repaired hashes, a hash-bound quality review and reproducible edit ledger; both original_text_sha256 and source_repair_proof_sha256 were independently checked in stored metadata.

Independent PDFplumber/PDFjs ordered-body checks cover138/138 Social Security pages,124/124 Financial Resolution pages, and121/122 BNS pages plus the separately rendered overprint exception. On BNS PDFpage53, two identical overprinted37 glyph pairs confuse extractors (3377 versus3737); raw and final text correctly retain one37. The rest of that page agrees exactly. The two trailing blank BNS pages are accounted for. This does not claim every word received manual transcription review.

## Execution and independent verification

Frozen release: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-three-source-20261010/job-v2/stage-01.release.json`

SHA256: `36707dda723abbe868ddb46fc994294c52f1d895e7048a6d52d3bc4b59e44e7f`. Separate draft and zero-write dry-run receipts remain preserved. Release uses medium_v1, sequential_500_v1, section_context_v1/chunker4, three documents,2,000 aggregate chunk bound,800 per-document bound,600,000-character bound and USD0.20 budget. One document was in flight; each source used one paid attempt. Worker/supervisor completed and released their locks.

Live PDF hashes, English bill/year/title/chamber/version, two-feature exact Download identity, source absence and full local chunks/spans/input hashes passed before writes. Fresh release-bound idle baseline: broad513.32ms /scoped676.92ms. All runtime health/capacity checks passed; sampled peakCPU21.82%, minimum available memory41.14%. These are sampled values, not continuous maxima.

Independent post-write auditor verified all1,874 stored1536-dimensional finite/nonzero vectors, complete exact spans/text/input hashes/context and document identities, raw/repair provenance, current listing/Download attachments and six actual bill-scoped citation retrieval probes. Stored-vector probes call real retrieval and citation code, without buying additional query embeddings or generating an answer; owner browser RAG acceptance is still a separate check.

ANALYZE public.document_chunks, public.documents and public.desk_rows completed. Real/planner/n_live_tup counts agree: chunks87,633, documents2,754, desk_rows34,184. Final live count and global orphan/null/unindexed-chunk checks passed.

Provider receipts: **349,118 embedded tokens, USD0.00698236**; zero unknown-usage receipts, zero retries. Cost is endpoint-reported embedding usage, not an estimate of all platform costs.

## Reproducible evidence and code checks

Local receipts: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-three-source-20261010/job-v2/stage-01.release.json.checkpoint.json`, `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-three-source-20261010/job-v2/stage-01.release.json.health.json`, `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-three-source-20261010/job-v2/stage-01.release.json.verification-3.json`; independent auditor `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-three-source-20261010/verify-three-progress.mjs`. Source proofs/raw/PDF/repaired files are in job-v2.

Commands actually run: node --test scripts/corpus-source-repair.test.mjs scripts/corpus-job-preflight.test.mjs scripts/corpus-stage-job.test.mjs scripts/corpus-job-supervisor.test.mjs (86 passed); repair suite12 passed, disabling its verifier caused9 regression failures; npm test -- --run (2,465 passed); npm run lint (passed); npm run build (passed, existing bundle-size and deskBrief dynamic/static import warnings); git diff --check (passed). No standalone typecheck claimed. No src/admin/supabase code changed in this turn, so Deno/SQL fixture suites were not rerun; pre-existing uncommitted changes are preserved. Node emitted its expected experimental type-stripping warning.

The narrow local worker change accepts reviewed raw-to-repaired provenance instead of falsely equating raw and repaired hashes. It does not authorize execution, certify semantics or bypass the identity/budget/health/recovery gates. All work remains local and uncommitted on task/corpus-single-pilot-20261009; no main merge, Git push, deployment, schema/compute changes, deletion, original corpus changes or existing-key backfill.

## Owner RAG samples and remaining scope

Refresh and reattach Code on Social Security,2019; ask about the social security fund and cite the relevant clause. Or reattach Bharatiya Nyaya Sanhita,2023 and ask about unlawful assembly with citations. These citations refer to the exact bill versions linked in the listing; the BNS2023 source is not a claim about the current consolidated Act.

This exact manifest is complete and must never be restarted. The previously completed175-document manifest also stays complete. Larger remaining candidates, the two smaller OCR-header quality holds, existing indexed missing-key recovery,51 version holds and19 wrong-Download proposals remain outside this release. Mapping alone still does not prove readiness; fresh exact preflight/release is required for the next queue.
