# Trackable corpus job: implementation and release evidence

> **Status: Historical (2026-10-09).** Executed preparation for the [R7 job plan](../plans/2026-10-09-trackable-corpus-jobs.md). No further live ingestion was performed.

## Preflight outcome

Reread the citation pack and original corpus `_clean.jsonl.gz`, checking source IDs and SHA-256 of actual text. All 347 small candidates matched their original corpus hash. Execute the current version-2 chunker offline; first-occurrence deduplication matches the actual ingestion handler. Check current bill rows in both features sharing the key, exact UI Download PDF resolution, actual PDF bytes, English title/number/year, chamber path, explicit version and distributed body-text agreement at ≥90%.

The first extraction audit incorrectly treated PDF internal text order as reading order, moving marginal notes away from corresponding lines; it also failed on spaced small-cap version headers. Retained its receipts under `preflight/`, added failing layout/header regression tests, reconstructed lines by position and reran under `preflight-v2/`. This changes evidence extraction, not the local source text or acceptance threshold. Conservative failures remain held.

| Final small-tier classification | Sources |
|---|---:|
| Pass, ready for bounded manifest release | 91 |
| Gazette: bill-to-Act identity requires review | 145 |
| PDF/source body-text disagreement under the current check | 63 |
| Bill number/year mismatch or unreadable header | 42 |
| Title mismatch | 3 |
| Version mismatch or unreadable version | 3 |
| Total | 347 |

The 256 holds need internal evidence review; they are not all proved wrong/unusable PDFs and do not all require new client data. The 117 medium candidates, previous 35 key ambiguity holds, two previously failed PDFs and three stored text-only documents remain outside this released-size tier.

Passing 91 sources produce 2,350 expected chunks and 529,357 estimated embedding tokens: estimated USD 0.01058714 at the rechecked model price USD 0.00000002/token. Split into four proposed manifests: 25/681, 25/693, 25/590 and 16/386 documents/chunks. No source has been embedded by this preparation.

## First-stage concrete proposal

Manifest `preflight-v2/stage-01.json` contains the exact source IDs, bill keys, roles, original text hashes, PDF hashes/identity evidence and chunk spans. SHA-256: `0d2f7c2efdc5848ef8c72807a44caf021f7bb03a9477903db0f1e8de4029ffc5`.

25 documents / 681 chunks; 25 distinct bill keys, one already indexed through another document and 24 currently uncovered. Estimated embedding tokens 156,333; estimated cost USD 0.00312666. Sum of conservative byte-based token ceilings 633,305 gives USD 0.01266610 reserved per full-stage attempt; at most five source attempts, approved proposed budget USD 0.08. This is a guard/allowance, not an expected bill. Missing billed receipts remain conservatively reserved and require usage reconciliation.

All 25 passed the real authenticated endpoint with `dry_run:true`, exact expected chunk count and no per-document errors. The local checkpoint is `dry_run_complete`; all source phases are `dry_run`, not indexed/verified. No production documents/chunks were written and no embedding provider was invoked by these requests.

Approve only this stage, then pause for owner Download PDF, bill attachment RAG and text-citation checks. Proposed maintenance scope is post-stage ANALYZE documents/document_chunks, plus desk_rows if the database restarted; no destructive compensation or subsequent-stage release is implied. Execution mode remains false pending exact release authorization.

## Runner and recovery evidence

The worker rechecks manifest/source/cached-PDF hashes and current chunker spans, refetches exact approved PDF bytes, and verifies both features' current mapping before writes. It limits one source/request, 25 documents / 1,000 chunks per stage and a two-second write gap. PDF fetching is restricted to credential-free HTTPS Sansad bill URLs and refuses redirects. No endpoint implementation/schema change was made.

Before a live attempt it fsyncs a checkpoint and reserves conservative cost. After a timeout it reads the source: a fully verified committed document is skipped, without another provider request. Partial/unindexed data stops with an exact repair inventory; no blind retry or deletion. An uncertain absent-source call waits 450 seconds from its start before a paid retry. Read, dry-run and live failures/worker restarts are bounded; held/health-paused states remain terminal until review.

The supervisor is an explicit foreground process, not an installed job service. Actual killed-child testing proved the local dead-owner lock recoverable while a live owner prevents another worker; unknown/foreign ownership fails closed. Automatic reboot startup remains a separate installation decision.

Executed focused command: `node --experimental-strip-types --test scripts/corpus-job-preflight.test.mjs scripts/corpus-stage-job.test.mjs scripts/corpus-job-supervisor.test.mjs`: **46 passed**. Tests include the real ingestion handler with disposable fake database/provider, successfully committed data followed by a lost response, then resume with exactly one fake embedding call. Other fixtures cover invalid mapping/vector/span/hash, partial states, changed manifest, exhausted budget/attempts, wrong PDF/version/body, layout, live/stale/unknown locks and terminal supervisor outcomes. No production failure injection. Core guards were observed red before implementation, including wrong chunk identity, a mapping changing during ingestion, layout reconstruction and first-occurrence deduplication.

`npm test`: **184 files / 2,465 tests passed**. `npm run lint`: passed. `npm run build`: passed, existing >500 kB minified chunk warning. Node prints its experimental type-stripping warning. No standalone type-check, Deno suite or SQL fixture run claimed; changed implementation is limited to scripts. Application tests/build passed before final script-only guards; focused checks and full lint were rerun after those guards.

## Load evidence and limits

Idle baseline: five existing indexed bill documents, 20 broad and 20 scoped RPC probes, 40 results each. Broad p95 **719.85 ms**, scoped p95 **426.98 ms**, including network/REST overhead. The earlier single-document/5-result preliminary baseline is superseded. During the dry run, the final two health windows stayed below twice baseline. No actual ingestion throughput or post-write load is yet measured. This is not end-to-end chat latency or a CPU measurement.

SQL read confirmed 2,364 documents, 2,361 indexed, 54,803 chunks; database size 954,150,035 bytes (~910 MiB); all document_chunks indexes combined 230,965,248 bytes (~220 MiB). Combined index bytes differ from earlier HNSW-only size. shared_buffers 512 MB is not total physical RAM. Database start time remains 2026-09-28 08:19:47.722698 UTC. Planner estimates match 2,364 documents / 54,803 chunks / 34,184 desk rows. No ANALYZE or restart occurred during preparation.

Project API reports ACTIVE_HEALTHY but exposes no compute-tier/RAM/CPU metrics through the available connection. Use the supervised first stage with latency/error gates; automatic CPU protection and unattended expansion are not verified. No compute/index changes were attempted.

## Artifacts and working tree

Artifact root:
`/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/preflight-v2/`.

Contains receipts/hold reasons, original-source checks, exact passing text/PDF bytes, four proposed stage JSON files, first-stage local dry-run checkpoint and health baseline. Existing corpus-bulk-preparation manifests/receipts and earlier historical reports were preserved.

Changed implementation: `scripts/corpus-job-preflight.mjs`, its tests, `scripts/corpus-stage-job.mjs`, its tests, `scripts/corpus-job-supervisor.mjs`, its tests. Durable docs: operator guide, this report, current job spec/plan and R7 tracker. Existing uncommitted pilot/preparation work was left intact. All work remains uncommitted on `task/corpus-single-pilot-20261009`; no main integration, push, deployment or OS-service installation.

Supabase current [function status-code guidance](https://supabase.com/docs/guides/functions/status-codes) informed resource-limit/timeout handling; current changelog and model-price endpoint were checked. The implementation relies on actual local handler and RPC contracts, not inferred Supabase API behavior.
