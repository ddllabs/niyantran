# Larger worker and first measured pilot

> **Status: Historical (2026-10-09).** Owner continued after next50 preflight; worker implementation and first progressive pilot completed. Remaining41 larger sources are not yet ingested.

The worker now supports explicit context-only `worker_profile:"medium_v1"`, up to800 chunks /600,000 source characters. Small defaults100/75,000 remain unchanged. Stage30-document /1,000-chunk, one-document request, two-second gap, exact mapping/PDF/hash/context verification, conservative budget reservation, health pause and partial-write hold behavior remain. These are tested software bounds, not proven790-chunk invocation capacity.

`readCompleteChunks` reads deterministic100-row pages through a bounded extra sentinel. It rejects malformed/oversized pages, repeated/non-increasing chunk indexes and stored overflow; full expected-count/hash/span/vector verification still gates completion. The modern worker uses it for both initial and lost-response reconciliation reads. Legacy23-source directory execution is unchanged.

## Local verification and review

Initial three new profile/pagination tests failed before implementation. Final63 focused checks pass, including actual context handler120-chunk/two-commit integration: lost response reconciles all pages without re-embedding; failing the second commit retains100 unindexed chunks, records a terminal hold and cannot retry automatically. Temporarily restoring the101-row read defect made that real120-chunk integration fail specifically on `stored chunk count mismatch`; restored implementation passes again. Mutation was local, with exact source restored and no live worker running.

Commands:

```bash
node --test scripts/corpus-stage-job.test.mjs scripts/corpus-job-preflight.test.mjs scripts/corpus-job-supervisor.test.mjs scripts/corpus-context-preflight.test.mjs
npm test
npm run lint
npm run build
git diff --check
```

All pass:184 application files /2,465 tests, zero lint warnings. Existing build>500kB bundle and Node experimental type-stripping warnings remain. No Supabase implementation/API/router/schema changes occurred, so unchanged Deno/SQL/router suites were not repeated. The focused Node integration invokes the actual deployed handler source with fake DB/provider for failure injection; production is not a test fixture.

Review considered boundary/sentinel off-by-one cases, unchanged default/legacy behavior, manifest-bound profile identity, partial/lost-response recovery, finite read size and secrets/auth. No provider or backend/chunking contract was changed; no dependencies added. No merge/push acceptance is claimed.

## Production pilot

Smallest passed source: **THE BHARATIYA VAYUYAN VIDHEYAK,2024**, `bill:2024:74`, source `d71b561ac170a359459a414d4ac2ddc144a8287a`, document `fbfa066d-23f7-410d-9991-1ecacfc1b3a2`. [Listing Download PDF](https://sansad.in/getFile/BillsTexts/LSBillTexts/PassedBothHouses/BOTH%20HOU1213202425616PM.pdf?source=legislation).

Owner continuation after the50-candidate preflight authorized tested progressive ingestion. First manifest explicitly limits execution to this one source,103 complete version4 chunks,120-chunk /100,000-character document caps and USD0.015 budget. SHA256 `15a5757bc9d85174f2441d22a2ac1e0105d85d73f425e5eeccbc743f66eca40c`. No other41 or eight identity holds were written in this pilot.

Fresh manifest baseline, live PDF hash/current listing resolver checks, version4 dry run, public model price and foreground supervisor execution succeeded:

```bash
node scripts/corpus-stage-job.mjs --baseline <pilot-release.json> <manifest-sha256>
node scripts/corpus-stage-job.mjs --dry-run <pilot-release.json> <manifest-sha256>
node scripts/corpus-job-supervisor.mjs --execute <pilot-release.json> <manifest-sha256>
node <artifact-dir>/independent-verification.mjs
```

All103 chunks indexed, including96 with source-detected context. Receipt: **16,203 tokens /USD0.00032406**, one live attempt, two underlying provider requests, model `openai/text-embedding-3-small`, no retries, unknown usage or deletions. Model-log embedding latency4,471ms measures the embedding phase, not full invocation duration or larger-source capacity; SQL decimal cost rounds toUSD0.000324.

Independent full paginated reads verified original text/content/input hashes, source spans, context metadata and all103 finite nonzero1536-dimensional embeddings. Both listing features retain the exact original Download PDF; indexed bill attachment lookup returns only this document. Two actual scoped retrieval/text-citation probes used stored vectors without paid query embeddings: each returned40 results scoped to this document, with the matching chunk at similarity1 and correct citation URL/hash/offset/context. This verifies retrieval plumbing, not natural-language answer quality. Existing-text citations do not add PDF-page highlight coordinates.

Baseline broad/scoped p95:665.877/374.576ms (20 probes each). All five subsequent three-probe windows passed; maxima731.274/391.250ms. CPU/RAM and full large-source throughput remain unmeasured. `ANALYZE public.document_chunks; ANALYZE public.documents;` succeeded; planner tuples agree with real counts. Current totals **2,462 documents /2,459 indexed /57,774 chunks /1,353 covered listing bill keys**, exactly +1 document/+103 chunks/+1 key. Postmaster start unchanged2026-09-28 08:19:47.722698UTC.

Artifacts: `/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/medium-worker-first-pilot`: frozen manifest/text/PDF, baseline/checkpoint, implementation fingerprints, initial red/final/mutation tests, application/lint/build logs, execution/audit scripts/results and SQL counts/statistics/model receipts.

Changed paths: `scripts/corpus-stage-job.mjs` and its tests, [spec](../specs/2026-10-09-medium-worker.md), [plan](../plans/2026-10-09-medium-worker.md), this report, operations and R7. Work remains uncommitted on `task/corpus-single-pilot-20261009`; existing corpus changes preserved, main unchanged. No function deployment, schema change, scheduler, cleanup, merge or push.

Remaining41 verified sources total10,068 context chunks. Next measured stages should increase source size gradually, use newly frozen manifests and complete reconciliation/health/ANALYZE checks; code accepting800 is not evidence that a790-chunk request finishes within gateway/function limits. Eight identity holds remain excluded. Owner can test this pilot by attaching Bharatiya Vayuyan Vidheyak2024 and asking “What powers does this bill give the Central Government? Cite the relevant clauses.”
