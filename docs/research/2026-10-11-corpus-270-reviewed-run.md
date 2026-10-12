# Remaining 270-source review and single ingestion job

> **Status: Historical (2026-10-11).** Completed owner-authorized execution, independently audited. The frozen manifest must never restart.

The owner requested review of all 270 remaining same-Download candidates and one larger job containing every passing source. The exact inventory excludes the 38 completed sources and two previously demonstrated missing-scanned-text failures. No completed manifest is restarted.

## Review result

All 270 sources received archive/pack hash, native/PDF.js extraction, rendered-page overview and context screens. Operative text and section transitions were read for the passing cohort, with larger rendered-page inspection for longer/exceptional sources. The review is not a claim of word-by-word visual transcription of every page. Scanned missing text, numeric table reconstruction, margin/body interleaving, unresolved extractor ordering and missing context boundaries remain source-specific holds.

183 passed local quality review. One subsequently failed the fresh PDF-title preflight, leaving **182 documents / 3,611 complete version-4 context chunks** in one frozen job. The 88 excluded records retain exact reasons; an extraction disagreement is not a claim that the source PDF is unusable. Some require only further layout reconciliation, while others require better OCR/table reconstruction. Printed drafting errors and old years inside clauses are preserved rather than silently corrected.

The prepared text totals 1,395,486 characters. The largest document has 46 chunks; none was truncated. Original corpus and Citation Pack files are untouched. Separately hash-bound repairs separate margins and restore explicit printed headings/back-cover boundaries. Every prepared non-whitespace source character is covered by exact chunk spans, with complete ordered independent-extractor agreement for the accepted text.

## Exact release

Runtime root: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-shared-mapping-20261011/job-reviewed270-v1`.

Manifest `stage-01.release.json`, SHA-256 `e21a71b4fcd2d172447c66f91b897df1e60de1d14b79230ff68d18f60088668b`.

Sibling `review270/quality-release-review.json` contains all quality results; `exclusions.json` and `preflight-holds.json` bind exclusions. The manifest binds original/raw/repaired/PDF/review/mapping hashes and expected chunks/spans/input hashes. Live source absence, both listing features, exact production Download and re-fetched PDF bytes were checked. The only new preflight exclusion is source `10bbe39eafa2057133f2098a131170058999277d`, PDF-title check failure.

Existing sequential supervisor: at most one document in flight, $1 conservative budget, 20-document/2,000-chunk independent maintenance gates. The estimated byte-based upper token reservation is 1,580,947 tokens, $0.03161894 at $0.02/million; actual provider usage will be recorded separately. No new deployment, schema/compute change, overwrite, deletion or original-source edit.

## Execution evidence

Fresh pre-write baseline: 2,807 documents, 2,804 indexed, 88,339 chunks, 1,516 covered listing bill keys; zero orphan chunks/null vectors. Manifest-bound retrieval baseline passed: broad p95 442.20 ms, scoped p95 409.37 ms, 20 probes per scope. All 182 production Edge no-write dry runs passed, producing the expected 3,611 version-4 chunks without paid embedding calls. Official capacity checks passed before execution.

Final independent audit and ANALYZE/count reconciliation completed at **2026-10-11 03:41 UTC**. The single frozen job ingested **182 documents / 3,611 chunks**, including 3,247 chunks with explicit section context. Every stored vector, exact text span, embedding input hash, context, provenance, current listing attachment and Download identity passed. **1,532 real bill-scoped citation probes** passed in the final audit. Cumulative maintenance audits also passed at every 20-document boundary through 180.

Final live totals: **2,989 documents / 2,986 indexed / 91,950 chunks / 1,698 covered listing bill keys**. Deltas from this job's baseline are exactly +182 documents, +182 indexed, +3,611 chunks and +182 covered keys. Zero orphan chunks and zero null vectors. Planner counts match real counts after ANALYZE; desk_rows remains 34,184. Global coverage means an indexed attached document with a non-null-vector chunk exists; the full completeness audit described above applies to all 182 documents in this release.

Actual provider receipts total **360,549 tokens / USD 0.00721098**, all 182 documents with exactly one paid attempt and no unknown usage. Exactly 3,611 chunks inserted, zero kept and zero deleted. Sampled worker peak CPU was 17.56%; the separate recovery-check peak was 24.64%. All mandatory health/capacity gates passed before their subsequent writes. The worker checkpoint is complete, no worker/supervisor locks remain, and the temporary keep-awake process was stopped and its exit verified after the final audit. No persistent power setting or OS service was installed.

Final evidence: `final-completion.json`, `stage-01.release.json.checkpoint.json`, `stage-01.release.json.verification-182.json` and `maintenance-{20,40,60,80,100,120,140,160,180,182}.json` under the runtime root. All 88 exclusions remain in `exclusions.json`; none was silently added to this release. Of the earlier 500-candidate inventory, 220 are now complete (38 prior +182 here); the remaining 280 comprise 88 current source-specific holds, two prior missing-scanned-text holds, 97 identity reviews, 83 version reviews and 10 mapping holds. Unreviewed cohorts are not classified as failures.

For RAG testing, refresh and reattach **The Academic Integrity Bill, 2021** (`bill:2021:XXXV`, document `eefa05d5-bbf6-41f3-b11d-03d25ffa7b68`, 44 chunks) and ask about penalties at different plagiarism levels with clause citations. Alternatively use **The Prevention of Insults to National Honour (Amendment) Bill, 2026** (`bill:2026:LIX`, document `8f71de4c-5e56-41aa-81ad-66fe0d60fa5a`, eight chunks) and ask what the National Song amendment covers and its maximum penalty. Scoped retrieval/citations passed; this run does not claim a separate browser chat-generation test.

Verification executed: production Edge no-write dry runs for all 182; existing `corpus-job-supervisor.mjs --execute` against the exact manifest SHA; runtime `verify-cumulative.mjs` at each maintenance/final boundary; official capacity and manifest-bound retrieval health checks; Supabase ANALYZE with exact real/planner counts and orphan/vector checks. Runtime verifier syntax was checked with Node. No application code changed in this run, so build/lint/application suites were not rerun; prior deployment validation remains in its separate report. Local plan/spec/R7/report changes and external runtime evidence remain uncommitted on `task/corpus-single-pilot-20261009`; unrelated existing dirty work is preserved. Existing unindexed stubs, page-OCR records, Government/University repair holds, original corpus files and all other excluded cohorts were untouched.

## Transport interruption and reviewed recovery

The single job reached 100 verified documents / 2,111 chunks. Cumulative audits and ANALYZE/count checks passed at 20, 40, 60, 80 and 100 documents. Read-only audit concurrency was increased to four documents, retaining every check; the ingestion writer remains strictly sequential.

Subsequent checkpoint reconciliation encountered interrupted database read transports, then the bounded supervisor retry encountered a PDF-fetch timeout. It stopped in `held`, with no paid invocation in flight and no partial or unknown-usage entries. The precise underlying network cause was not established; it was not a chunking, mapping, vector, budget or capacity failure.

Recovery independently re-fetched all 182 exact PDF hashes (zero failures), confirmed the production companion hash, re-audited all 100 stored documents and scoped citations, and obtained a fresh 20-probe-per-scope retrieval baseline (broad p95 378.66 ms; scoped 360.49 ms). Official capacity over a new 60-second window passed: CPU 22.99%, available memory 51.45%, disk pressure 0.069%. ANALYZE and live counts remained 2,907 documents / 2,904 indexed / 90,450 chunks, zero orphan/null vectors; exactly 100 manifest sources were present and 82 absent.

The original held checkpoint is preserved as `checkpoint-transport-held.json`. `network-recovery-decision.json` binds the fresh evidence hashes. Only this proven transport hold was resolved, restoring the exact 100/2,111 maintenance boundary with a fresh acknowledgement. Attempts, paid receipts, budget, original text and frozen manifest remain intact. The same supervisor resumed under the existing owner authorization; this does not declare the remaining 82 complete.

### Sleep cause identified, second reviewed recovery

The resumed job again stopped during pre-write network activity, still at 100 completed documents and with no paid invocation in flight. macOS `pmset` evidence then showed repeated **Idle Sleep**, followed by 15–17 minute maintenance-sleep intervals. A nominal 30-second price request spanned 1,023,633 ms wall time. This explains the long pauses and is strong evidence for the transport interruptions; it is not a server compute limit.

A temporary `caffeinate -i -t 7200` process now prevents idle sleep for this run. Its assertion was verified. It installs no OS service and changes no persistent power setting; release it when this run finishes. The same price request then succeeded in 382 ms at the unchanged price. All 182 PDF hashes passed again; traced baseline reads passed; all 100 records / 2,111 chunks re-audited; exact SQL/planner counts and zero orphan/null-vector checks passed. Fresh capacity: CPU 24.64%, memory available 51.61%, disk 0.066%. Fresh retrieval p95: broad 408.50 ms, scoped 378.68 ms.

First recovery proof files were snapshotted under `network-recovery1-evidence/` before refreshing mutable health state. The second held checkpoint, decision and fresh proof hashes are retained in `checkpoint-transport-held2.json` and `network-recovery2-decision.json`. Only after these checks was the same 100/2,111 maintenance boundary restored and acknowledged. All attempts, usage receipts, budgets and the frozen manifest remain unchanged. No pending record is represented as complete.
