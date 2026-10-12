# Next corpus batch — 2026-10-11

**Status: Historical (2026-10-11).** This exact 32-document release is complete and independently audited. Never restart it. The remaining corpus is not declared complete.

## Scope and review

Owner instruction: continue with the next set after the completed 182-document job. The remaining identity/version cohort contains 180 absent candidates (97 identity-review and 83 version-proof candidates), with 1,514 PDF pages. The original archive and Citation Pack hashes, current source presence and 19,634 bill-listing rows were reconciled. The completed 182-document manifest is untouched.

All 180 received native-layout extraction and independent PDF.js checks, original alphanumeric conservation, identity and version-4 context screening. Sixty-five passed the initial identity/layout screen. Manual review then distinguished actual margin/table problems from whitespace in registration headers and descriptive listing-title annotations. A printed source title is recorded separately from the unchanged listing title; registration, chamber, version, operative subject and current two-feature attachment still must agree. No validation guard was changed.

The first reviewed subset contains **32 same-Download sources / 588 complete chunks**. Operative text was read, rendered page-layout overviews inspected, clause/continuation and tail boundaries checked. Full native ordered-character comparison and original alphanumeric conservation cover substantive text; this is not a claim of word-by-word visual transcription of every page. Original wording, including printed drafting errors, remains intact. The Residential Schools source needed an explicit back-cover heading before trailing blank PDF pages. Original corpus files are untouched.

The review ledger separately records **119 holds** and **29 requiring further body/version review**. The 29 are not declared defective or ready. Actual new issues include interleaved Juvenile Justice margins and university table rows mistaken for operative clauses. The prior 88 quality holds, two earlier missing-text holds and ten mapping holds are outside this 180-source review and remain separate.

## Frozen release

Runtime evidence: `corpus-shared-mapping-20261011/review-next180/` and `corpus-shared-mapping-20261011/job-next180-v1/` under this chat's visualization directory.

Manifest: `job-next180-v1/stage-01.release.json`.

SHA256: `78793b58f987b08238f22e062577e81c48a6a5e6b57b178d55f61637b8691025`.

All 32 original/archive/pack hashes, live absence, unique two-feature listing identity, deployed Download resolver and exact live/cached PDF hashes passed preparation. The deployed companion hash remains `f525755410084da348f95f5ad1c9051b9571e029655e48b4e9df09a42c14dca2`. Complete context chunks and source repair ledgers are hash-bound and loaded successfully by the existing worker. No deployment, schema change, overwrite or deletion is included.

Fresh SQL baseline: **2,989 documents / 2,986 indexed / 91,950 chunks / 34,184 desk rows**, zero null vectors and zero orphan chunks. Earlier verified covered listing keys: 1,698; final coverage must be freshly queried.

Use the existing sequential supervisor, one document in flight, a $1 conservative budget and the required 20-document/2,000-chunk maintenance audit. Fresh manifest-bound retrieval baseline, Edge no-write dry runs, provider price and official capacity gates precede writes. Independent cumulative vector/span/context/provenance/attachment/scoped-citation checks and ANALYZE with exact real/planner counts precede maintenance acknowledgement and completion.

Temporary `caffeinate -i -t 7200` prevents idle sleep during this run. Stop it after final verification; no persistent power setting or OS service is created.

## Pre-write gates

All 32 Edge Function no-write dry runs passed against the exact manifest and produced the expected 588 chunks, with no paid requests. Manifest-bound idle retrieval p95: broad 652.71 ms, scoped 659.80 ms (20 probes each). Initial official capacity: CPU 1.25%, available memory 52.34%, disk pressure 0.094%; no pressure gate failed. The byte-based reservation ceiling is 252,593 tokens / USD 0.00505186, below the $1 job budget; actual receipts are recorded separately after writes. Fresh covered-key baseline is 1,698 and none of the 32 released bill keys previously had an indexed document.

Execution used the existing supervisor, which rechecked live PDF hashes, listings, current provider price, retrieval health and official capacity before paid requests.

## Verified completion

All **32 documents / 588 chunks** were ingested, with **524 contextual chunks**. The independent audit checked every vector, span, context, embedding-input hash, source provenance, Download/listing attachment and provider receipt. All **208 final bill-scoped citation probes** passed. These are actual scoped retrieval/citation executions, not a claim of user natural-language RAG acceptance.

At the required maintenance boundary, all 20 documents / 372 chunks passed the independent audit (137 scoped citation probes), then ANALYZE and exact real/planner counts passed before the fresh manifest-bound acknowledgement. The same supervisor resumed the remaining 12 documents without changing the manifest.

Final live totals after ANALYZE: **3,021 documents / 3,018 indexed / 92,538 chunks / 1,730 covered listing bill keys**. Exact deltas: +32 documents, +32 indexed, +588 chunks, +32 covered bill keys. All 34,184 desk rows remain present. Planner counts match real counts; zero orphan chunks and zero null vectors.

Actual provider usage: **57,972 tokens / USD 0.00115944**. All 32 paid attempts succeeded once; no paid retry or unknown usage. Inserted 588, kept 0, deleted 0. Seven capacity windows and 37 retrieval health windows passed; sampled peak CPU 16.08%. The checkpoint is complete, worker/supervisor locks are released, and the temporary keep-awake process was stopped. Final machine-readable receipt: `job-next180-v1/final-completion.json`.

Remaining within the original 500-source working pool: **252 completed / 248 pending**. The 248 comprise this review's 119 validation/quality holds and 29 remaining body/version reviews, plus the prior 88 quality holds, two missing-text holds and ten mapping holds. Mapping or an automatic identity pass is not readiness. No ready unfinished manifest is left by this run.

Verification executed: `node --check` on the runtime cumulative verifier; manifest load and prepared-entry recomputation; `corpus-stage-job.mjs --baseline`; `corpus-job-supervisor.mjs --dry-run` and `--execute`; independent `verify-cumulative.mjs` at 20 and 32; Supabase ANALYZE, exact counts, coverage, planner and orphan/vector checks. Node emitted its existing experimental type-stripping warning. No application code changed, so build/lint/application suites were not rerun. Only task documentation and local runtime evidence were written in this continuation; the prior dirty application work remains preserved and uncommitted on `task/corpus-single-pilot-20261009`. No deployment, schema/compute change, existing-source overwrite/deletion, original corpus edit, Git publication or OS service occurred.
