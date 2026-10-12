# Corpus capacity and larger batches

> **Status: Living.** Owner requested larger batches and a Supabase capacity check, 2026-10-09. Planning/read-only phase; no larger stage released yet.

## Current state and measured limits

NTER (`vfgcppstyzjarlzyqdac`) reports ACTIVE_HEALTHY. Live SQL at2026-10-09 15:03:20 UTC showed16 connections against configured90, one other active session, zero lock waiters, zero cumulative deadlocks and99.038% cumulative database buffer-cache hits. Database size1,134,333,075bytes. Chunk/document planner live counts match67,842/2,503; chunk dead tuples0. No restart since2026-09-28 08:19:47.722698+00.

Current PostgreSQL configuration: shared_buffers512MiB, effective_cache_size1536MiB, work_mem5MiB, maintenance_work_mem128MiB, max_parallel_workers2. These configuration values do **not** establish physical RAM, vCPU count or current CPU/memory/IO pressure. The historical2026-09-29 plan records2GB compute. Its size is not verified as current. The project connector omits compute size and metrics; the in-app dashboard redirected to sign-in, and Chrome inspection timed out. Owner was asked for current Infrastructure compute size and CPU/memory readings. Do not call this a confirmed Large server or infer total RAM from cache settings.

Prior completed medium execution:41 documents /10,068 chunks,93 healthy retrieval windows, no paid retries or unknown usage. Checkpoint timestamps show median write-plus-verification16.714s, nearest-rank-style lower-index p9540.835s and maximum54.747s (790-chunk document). Summed time805.323s excludes preparation, baselines, dry runs, maintenance and independent audits; it is not end-to-end throughput. This is operational evidence for the tested sequential flow, not proof of parallel capacity.

Supabase's current [compute documentation](https://supabase.com/docs/guides/platform/compute-and-disk) distinguishes dedicated PostgreSQL compute from other execution limits and recommends measuring CPU/disk/query performance. Small is2GB/shared CPU; Large is8GB/dedicated2vCPU. Increasing database compute alone does not prove ingestion-function/provider/request limits have changed.

## Outcome and proposed controls

The next logical job may contain up to **50 fully identity-approved documents**, split into bounded stages. Increase the proposed stage chunk budget from1,000 to **2,000**, retain one document in flight and a maximum30 documents per stage. Every document retains its complete section-context chunking, overlap and citations; stage budgets neither truncate a document nor change chunk content. The800-chunk/600,000-character per-document medium profile remains unchanged. Sources above it require a separate resumable large-document design.

This proposal reduces stage setup/maintenance transitions; it does not promise a50-document stage or double raw embedding speed. Existing worker hard checks reject stages above1,000 chunks, so a manifest edit alone is insufficient. Keep all existing executable limits until the narrow worker correction and pilot pass.

Acceptance: explicit opt-in2,000-chunk stage profile passes real sequential/recovery tests; default1,000 unchanged; complete chunks and citations verified; no identity weakening; compared retrieval latency stays inside the current two-consecutive-windows/2×baseline pause gate; exact costs and count/planner deltas accounted for. No concurrent writer or compute upgrade in this plan.

## Ordered tasks and scopes

1. **Capacity evidence** (this plan, R7, artifacts): retain current connector/SQL readings and previous checkpoint-duration analysis. Record current tier/CPU/memory/disk observations if accessible. Avoid calling historical/configuration evidence live telemetry.
2. **Eligible inputs** (identity-review plan/report and diagnostic artifacts): fix and regress marginal-note layout against all prior passing PDFs and body holds; resolve title/version exceptions explicitly. Fresh original/pack hashes, SQL listing/Download identity, fetched PDF hashes and full-source distributed agreement must pass. Currently no new eligible queue exists; all139 approved small/medium sources are complete.
3. **Narrow worker stage profile** (new spec, this plan, `scripts/corpus-stage-job.mjs`, its tests; supervisor tests only if interface actually changes): failing tests for explicit larger-stage opt-in, unchanged defaults,2,001-chunk rejection,30-document and800-per-document limits, sequential writes, full lost-response reconciliation and partial-write holds. Use a named profile; reject unspecified overrides. No changes to OCR, chunking, embedding inputs, handler commits, retrieval or schema. Run focused corpus tests, app suite, lint and build. Record red proof.
4. **Measured pilot** (fresh exact manifest/artifacts/report and R7): select an identity-proven cohort above1,000 but at most1,500 total chunks, ascending document size, one document in flight, USD0.12 reservation ceiling, existing price/hash/dry-run/context gates. Baseline, execute, audit every vector/span/context/citation, ANALYZE documents/chunks and confirm exact totals. Never retry a paid write just because an audit failed; reconcile first.
5. **Expansion** (fresh manifests/artifacts): after the pilot passes, use up to2,000 chunks/stage and USD0.16 stage reservation ceiling, subject to computed source reservation. Queue up to50 ready documents, preserve exact source inventory, checkpoints and maintenance acknowledgements. Continue one writer and existing request gap/retry ceilings. Stop on identity/partial/budget/health hold.

If direct telemetry is available during the pilot, pause further release when sustained CPU reaches70%, connections reach70% of the configured maximum, lock waits develop, memory pressure/OOM appears or disk IO budget/throttling grows. These are proposed operational review triggers, not implemented automatic telemetry guards. Retrieval gates remain automatic. Do not claim CPU protection unless telemetry is actually connected and tested.

No compute size, database settings, Edge Function, frontend, schema, embedding pipeline or worker limits changed in this planning phase. No ingestion was performed. The plan is complete as a reviewable proposal; identity correction, worker implementation and measured pilot remain open under R7. Existing uncommitted work is preserved on `task/corpus-single-pilot-20261009`; fetch succeeded and no merge/push was performed. Verification for this documentation-only phase: live read-only SQL/project checks, prior execution receipt analysis and `git diff --check`; unchanged code tests were not repeated.

Artifact evidence directory: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/capacity-review`.

## Supabase-plugin verification and500-document proposal

Owner subsequently asked about500 documents per stage and explicitly invoked the Supabase plugin to verify. Plugin project/SQL checks at15:13:54 UTC confirmed ACTIVE_HEALTHY,16/90 connections, zero other active queries, lock waiters and cumulative deadlocks. The plugin's documentation search identified the official [Metrics API](https://supabase.com/docs/guides/observability/metrics/vendor-agnostic), accessible with the existing secret API key through Basic authentication. Two direct read-only samples succeeded; credentials remained internal and no monitoring service was installed. This supersedes the earlier statement that direct CPU/RAM telemetry was unavailable.

Metrics at15:14:42–15:16:29 UTC (exporter interval106.152s):

| Measurement | Observed |
| --- | ---: |
| Visible CPU cores |2 |
| CPU non-idle |1.130% |
| CPU execution excluding IO wait/steal |0.913% |
| IO wait / CPU steal |0.066% /0.151% |
| RAM total |2,025,500,672bytes (about1.89GiB usable) |
| RAM available |1,060,040,704bytes (about0.99GiB) |
|1-minute /5-minute /15-minute load |0 /0.01 /0 |
| Root/data disk busy |0.081% /0.068% |
| Data filesystem available, first sample |6,872,952,832bytes |

Swap had137,367,552bytes allocated; this does not prove active swapping or current memory pressure. Physical readings match roughly2GB RAM, rather than an assumed8GB server. Visible cores do not establish dedicated compute or the billed tier. CPU rates use counter deltas; memory availability uses MemAvailable rather than counting reclaimable cache as unavailable. This was an idle interval, not an ingestion load test.

The evidence supports a **500-document sequential stage pilot proposal**, with one document in flight, per-document verification/checkpoint, continuous metrics/retrieval health review and periodic ANALYZE/count acknowledgements within the larger stage.500 is a queue/stage inventory count, not500 documents in one function invocation. Fix the worker's whole-stage eager validation/preparation and30/1,000 guards through an explicit tested profile before executing; incremental internal checkpoint windows can retain1,000–2,000 chunk review intervals without truncating any source. Bound total stage work and budget from the frozen exact inventory, not document count alone. Retain800 chunks/600,000characters per medium document and all identity/context/citation/reconciliation gates.

This supersedes the earlier50-document logical job proposal as the owner's desired size, while the proposed2,000-chunk internal review window remains subject to its worker tests. Prove resume at early/middle/late checkpoints in a500-entry sequential fixture, no concurrent writes, no repeated paid requests, full paginated verification, malformed/partial-source holds and metrics pause behavior. Only after eligible inputs exist and a measured ingestion pilot passes may an exact500-document inventory be released. Current executable limits remain30 documents /1,000 chunks per stage; no code, embedding or production setting changed during this verification.

## Owner go: implementation and exact recovered-source pilot

[Spec](../specs/2026-10-09-corpus-500-stage.md). Add `stage_profile:sequential_500_v1` with500 documents /20,000 aggregate chunks /10million aggregate characters; default profiles unchanged. Live CPU/memory/disk guard plus independent20-document/2,000-chunk maintenance pause/acknowledgement. Write scopes: stage worker/test, supervisor/test where needed, new capacity helper/test, spec/plan/R7/operations and pilot evidence. Preflight layout change follows the identity-review amendment; no backend/schema/OCR/chunker deployment.

The observed-coordinate layout regression failed before the four-point correction; all139 prior passes were retained. Fresh corpus/pack/current listing/PDF checks recovered exactly Delhi Laws2023 `bill:2023:176` (`eca550352a6e3fb47cb493391b2f8bfa5e5c3d25`) and Central Universities2023 `bill:2023:141` (`1e4192198c62e0778e94ded6e7034c8628098a44`). Repealing/Amending year exception excluded. Freeze these two /12 full version4 context chunks under the new profile,USD0.015 stage budget, one-attempt byte reservationUSD0.0001464. Exact manifest SHA256 `1769d85a743c79010949938ff5828fd6864d917a3479e55fb4e0070e5fe5e751`, at `corpus-job-plan/capacity-live-pilot/stage-01.json`. Baseline/dry run/execute with fresh metrics and independent complete-vector/source/context/spans/Download/scoped-citation audit, then ANALYZE/counts. This two-source pilot tests the integrated live path; it does not load-test500 sources or release the unresolved corpus. No previously indexed source re-embedded for testing.

Implemented and verified:76 focused checks,2,465 app tests, lint/build,500-entry sequential/resume/lost-response fixture and maintenance mutation proof. Exact live pilot completed2 sources /12 chunks /USD0.00002810; all vectors/context/spans/Download/attachment scopes and four scoped citations verified, six retrieval windows/capacity gates passed, ANALYZE counts match2,505 documents /2,502 indexed /67,854 chunks /1,396 covered keys. [Report](../research/2026-10-09-corpus-500-worker-pilot.md). No500-source inventory or sustained-load acceptance claimed; proceed with remaining identity/body holds before a larger measured cohort. No deployment/service/merge/push.

## Owner continue/do500: remaining eligibility refresh

Owner requested500 new documents. Current listing/PDF identity requirements remain binding; do not pad with stored, unmapped or unverified sources. Read-only refresh of all7,064 frozen bill sources against19,634 current two-feature rows and2,505 stored documents found327 unstored exact-Download candidates within historical size bounds,438 listing-identity holds,6,124 unresolved Download relationships,11 oversize sources and164 stored sources. These are refreshed classifications, not approved PDFs. Original nonbill6,855 sources remain outside the bill-only worker/scoping scope.

Recheck79 prior body holds using the already-regressed four-point extraction; retain original/pack hashes and freshly fetched PDFs,90% distributed-body threshold and full identity/version checks. Also preflight two normalized-URL exact candidates outside the prior524 subset. No new matcher, mapping, backend or deployment change. Artifact scopes: `corpus-job-plan/body-hold-refresh`, `full-inventory-refresh` and a new exact execution directory. Freeze only passes, prepare complete version4 section-context chunks, then baseline/dry-run/supervised execution with the500-stage profile and independent maintenance acknowledgements. If fewer than500 qualify, ingest only the proven cohort and report the shortfall; do not imply a500-document execution occurred. Independent audit covers every vector/input hash/source span, current Download mapping and scoped citations; allow legitimate other indexed document versions under the same bill key while proving the newly indexed document is included in the attachment scope. ANALYZE/count checks before maintenance acknowledgement and at completion. R7 retains resolver/version/gazette/nonbill/identity follow-ups.

Completed the exact71-source release /5,063 version4 chunks,USD0.01581312 reported cost,71 first-attempt writes. Independent audits/ANALYZE acknowledgements passed at20,40,60,69; final71 audit /142 scoped citations and orphan/count/planner checks passed. Final2,576 total /2,573 indexed /72,917 chunks /1,464 covered bill keys (+68).79 retrieval and21 capacity windows passed. [Full execution evidence and samples](../research/2026-10-09-corpus-recovered-body-run.md).500 remains a worker capacity limit, not a completed source count;256 exact-Download candidates and broader R7 mapping/scoping holds remain. Owner natural-language acceptance pending; no code/deployment/service change in this continuation.
