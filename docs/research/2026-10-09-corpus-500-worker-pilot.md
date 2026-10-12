# Sequential500-stage worker and recovered-source pilot

> **Status: Historical (2026-10-09).** Owner authorized implementation and the measured pilot after the Supabase capacity review. Local worker complete; exact two-source pilot complete. No500-source live release occurred.

The opt-in `stage_profile:"sequential_500_v1"` accepts at most500 documents,20,000 aggregate chunks and10million aggregate Unicode characters. Default30-document/1,000-chunk stage limits and existing per-document100/800 profiles remain unchanged. One document is sent per request; source/context chunking is unchanged. Aggregate bounds apply when loading manifests before network work and again before execution. All source/PDF identities and prepared inputs are validated before paid work; full vectors/source/spans/context are verified after each document.

Large stages require Supabase capacity checks. The helper reads only matching project/database infrastructure series, rejects stale/missing/invalid/reset counters and computes CPU/disk rates from successive snapshots. The runtime samples no more often than once per minute, pauses at70% non-idle CPU,15% available-memory floor or80% disk busy, and retains the independent retrieval-latency gate. Initial rate acquisition waits60seconds; this is intentional, not an ingestion timeout. These are conservative pilot triggers; no capacity guarantee or dedicated-CPU claim follows from idle measurements.

The job pauses every20 verified documents or2,000 verified chunks before the next paid request. A source can cross the chunk window without truncation. Resume requires an exact manifest/progress acknowledgement, independent audit and ANALYZE/count confirmation, timestamped within30minutes. The supervisor stops on maintenance pause and resumes only with a valid acknowledgement. No service, scheduled job, automatic self-approval, new SQL RPC or parallel writer was installed.

## Verification and review

-500-entry sequential fixture completed across24 maintenance pauses. Lost responses at entries0,249 and499 reconciled without repeated writes;500 total writes, maximum concurrency1, all500 checkpoints verified; complete restart added no writes.
- Missing metrics,501-document/20,001-chunk/aggregate-character bounds, invalid profiles, unacknowledged maintenance and mid-stage CPU pressure fail closed. Mid-stage pressure preserves five verified documents and prevents subsequent writes.
- Capacity tests cover project identity, freshness, counter reset, CPU/memory/disk pressure and exact recent maintenance acknowledgement binding. Real previously captured Supabase metrics parse with1.130% non-idle CPU,52.335% available memory and0.081% maximum disk busy.
- The500 profile tests failed against the original bounds before implementation. Maintenance supervisor mutation removed its pause statuses and caused both maintenance tests to fail; restored implementation passed. An observed-coordinate PDF layout regression also failed before its correction.
- All139 previously identity-approved cached PDFs retain their source/body passes with the four-point marginal-note layout correction. Distinct close body lines have a separate guard; original text/hash, number/year, chamber/version/title and90% body threshold remain unchanged.

Final commands: `node --test scripts/corpus-capacity.test.mjs scripts/corpus-stage-job.test.mjs scripts/corpus-job-supervisor.test.mjs scripts/corpus-job-preflight.test.mjs scripts/corpus-context-preflight.test.mjs` **76 passed**; `npm test -- --run` **184 files /2,465 tests passed**; `npm run lint` passed; `npm run build` passed; `git diff --check` passed. Existing large-bundle, Node experimental type-stripping and PDF font warnings remain. No standalone type-check claimed. This phase changed scripts/documentation only; existing backend/schema was not changed and no new Deno/SQL fixture run was required. Tests using the real local handler/120-chunk reconciliation remain part of the focused suite.

## Exact live pilot

Fresh original corpus/pack hashes, current SQL listing/Download URLs and fetched PDF identity/body checks recovered two previously held sources, with100% distributed body agreement. The Repealing/Amending2022-key/2023-title exception remains excluded. Prepared version4 receipts retain whole source text and exact spans, with no midword boundaries.

| Bill | Key | Document ID | Chunks |
| --- | --- | --- | ---: |
| Delhi Laws (Special Provisions) Second (Amendment),2023 | `bill:2023:176` | `4c7912fe-6c27-462f-bed5-bd9fb1ed287c` |7 |
| Central Universities (Amendment),2023 | `bill:2023:141` | `6c341e16-8883-4432-a0f1-7e9b595ddf63` |5 |

Frozen manifest SHA256 `1769d85a743c79010949938ff5828fd6864d917a3479e55fb4e0070e5fe5e751`, budgetUSD0.015, one-attempt byte reservationUSD0.0001464. Baseline used20 probes per scope (broad p95458.188ms/scoped384.947ms). Deployed dry run confirmed version4,12 chunks and zero paid usage. Actual two-source execution completed with **1,405 embedding tokens /USD0.00002810**, one paid attempt each, no retries, deletes or unknown usage.

Independent audit checked all12 finite nonzero1536-dimensional vectors, source/context/input hashes and exact citation spans; eight chunks carry clause context. Both listing features resolve the original PDF and each bill attachment resolves its expected document. Four real scoped stored-vector probes returned only their document's passages (7/5 results), similarity1 for the expected chunk, correct source URL/hash/span/section. No paid query embeddings were used. This proves pipeline/scoping/citation behavior, not natural-language answer quality or PDF coordinate highlights.

All six recorded dry/execute retrieval-health windows passed; maximum broad/scoped p95529.706/635.135ms. Capacity samples passed: dry-run interval10.172% non-idle CPU /52.448% memory available /1.561% disk busy; execution pre-write interval1.131% /52.533% /0.108%. Sampling caches within a minute, so this tiny pilot does not measure a sustained ingestion peak or establish500-document throughput. No restart occurred.

Automatic approval review initially rejected execution because it classified the OCR payload as private outbound data. Complete payload/metadata inspection verified only public Sansad legislation; the same command was accepted on review with that new provenance evidence. No workaround, private-data transfer, unauthorized source or extra paid retry was used.

After `ANALYZE public.document_chunks; ANALYZE public.documents;`, live SQL confirmed **2,505 documents /2,502 indexed /67,854 chunks /1,396 covered listing bill keys**. Exact delta+2 documents/+12 chunks/+2 keys; planner document/chunk counts match. Postmaster start remains2026-09-28 08:19:47.722698+00. Earlier Mistral documents and text-only held stubs were outside the release.

## Remaining work and samples

The500-document profile is available, but no500-source eligible inventory exists yet. Of the earlier325 small/medium holds,323 remain after these two recoveries; the54 selected identity cases now have52 unreleased sources. Next investigate79 body-agreement cases under the regressed layout, then the43 unreadable-header cases, remaining title/version exceptions,192 gazette-to-Act cases and separate shared-key/other corpus cohorts. A larger real cohort above1,000 chunks still needs a measured pilot before claiming sustained throughput or unattended operation.

Owner samples: attach Delhi Laws2023 and ask “What changes does the bill make to the2023 expiry dates? Cite the relevant clauses.” Attach Central Universities2023 and ask “Which university is established, where does it operate, and whom does it primarily serve? Cite the relevant clauses.” Check source text and the listing Download PDF. Owner natural-language acceptance remains pending.

Changed paths: capacity helper/test, stage worker/test, supervisor/test, preflight layout/test,500-stage spec, capacity/identity plans, R7, operations and this report. Work is uncommitted on `task/corpus-single-pilot-20261009`; earlier changes preserved, main equals origin/main after fetch. No backend/frontend/schema deployment, compute change, cleanup, merge or push.

Evidence directories: `corpus-job-plan/capacity-review` (metrics, layout139 comparison and red/green/mutation/full verification logs), `capacity-pilot-preparation` (fresh identity receipts) and `capacity-live-pilot` (frozen release/text/PDF/context, baseline/checkpoint/metrics, execution and independent audit). All are under `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f`.
