# Plan: reviewable bulk corpus preparation

> **Status: Living.** Tracked under R7 in `open-work.md`; [spec](../specs/2026-10-09-corpus-bulk-preparation.md). Sequential; no delegation.

Preparation completed:
1. Read current production document identities and bill listings; exclude existing source IDs.
2. Stream all screened local candidates, validate hashes/lengths and execute the production chunker offline. No provider calls or writes. Preserve source IDs, keys, roles, URLs, source line locations, chunks and estimates.
3. Execute the current UI Download PDF resolver against the live bill row and existing embedded analysis map. Classify exact URLs, other same-bill versions, other bill keys, missing links and unproven URLs.
4. Fetch and inspect the actual PDFs of 25 proposed short recent exact-URL candidates. Accept the passed-both-houses `-F` header suffix only with the corresponding version metadata. Hold identity discrepancies and unreadable headers; prepare a frozen manifest for the 23 that pass.
5. Record price, capacity, assumptions, holds and the exact proposed first-stage scope. Review manifest hashes/counts and `git diff --check`.

Proposed job after separate approval:
1. Revalidate live source IDs, document keys, source hashes, PDF mapping and preflight scope. Stop if the inventory has changed.
2. Use the existing authenticated ingestion endpoint, one document per request, one worker. Run dry-run before each live request; require the manifest's expected chunk count.
3. Write durable per-source receipts/checkpoints immediately. Successful documents are skipped on resume. Investigate partially indexed documents before retrying that exact source ID; never retry the whole corpus blindly. No silent fallback from missing key or URL to a guessed association.
4. Verify each success: indexed status, real embeddings, exact source text/hash, chunk spans and correct URL/key. Treat HTTP 200 with per-document errors as failure. Pause on an unexpected identity, chunk count, repeated network/provider failure, timeout or resource-limit response.
5. Pause at the 23-document checkpoint. Expected delta is exactly +23 documents / +518 chunks if no concurrent writer changes the baseline. Compare per-source successes rather than relying only on global counts. Check scoped retrieval and sample citations; measure real index growth and broad/scoped query latency before expanding.
6. Subsequent cohorts are separately inventoried and preflighted. The 524 exact-URL, non-oversized bill candidates include the proposed first 23; the other 501 still need PDF checks. Fix the cross-year Download PDF resolver and verify bill-version behavior before expanding to affected listings. Resolve generic nonbill scoping before their rollout. Documents over 700 chunks require a separately validated ingestion approach.
7. Recheck database capacity at each stage. Current halfvec index ~205 MiB and shared_buffers 512 MiB. Use 70% of shared_buffers (~358 MiB) as a conservative operational review threshold, not a guaranteed performance limit. Pause rather than exceed it automatically. After a bulk stage, ANALYZE documents/document_chunks and verify planner statistics; after any restart verify desk_rows statistics as well. Do not resize compute or change indexes without owner authorization.

Preparation originally required implementing and testing resume behavior, receipt format and batching guards before launch. The execution amendment below now records that implementation and its outcome; preparation itself introduced no code changes. No wall-clock completion estimate is asserted before measured first-stage throughput. Embedding estimates exclude OCR, compute, storage, chat and retry charges; tokens are chunker estimates, not billed usage.

## Authorized execution — 2026-10-09

Owner approved the proposed 23-document stage. Fixed write scope: runner `scripts/corpus-stage-job.mjs`, isolated Node tests `scripts/corpus-stage-job.test.mjs`, this plan/spec, stage research record and R7 tracker. Validate and test the runner; run `node --test scripts/corpus-stage-job.test.mjs`, `npm test`, `npm run lint`, `npm run build`. No server/API/Edge Function implementation is changing. Execute one worker, one source per request; persist in-flight and successful receipts and verify before the next write. Final SELECT/retrieval/capacity checks and ANALYZE documents/document_chunks are authorized maintenance for this batch. Later expansion remains pending.

## Stage execution outcome — 2026-10-09

[Execution evidence](../research/2026-10-09-corpus-first-stage-run.md): ingested exactly 23 documents / 518 chunks. Final listing-join check found three existing shared-key/different-title collisions; their indexed status is held, preserving text and embeddings. Final eligible stage: 20 documents / 457 chunks. Total provider cost USD 0.00234268. Runner now rejects multi-identity keys before writes; regression test proven red then green. Final global totals 2,364 documents (2,361 searchable), 54,864 chunks; 1,257 current covered bill keys. Subsequent cohorts and owner browser acceptance remain pending; no resolver/key migration or deployment performed.

## Held embedding cleanup — 2026-10-09

Owner authorized removal of the held vectors. [Cleanup evidence](../research/2026-10-09-held-embedding-cleanup.md): exactly 61 chunk rows removed atomically; all three original texts, hashes and PDF URLs retained. indexed_at remains null, chunker_version cleared. Verified zero remaining chunks/embeddings for these three; other 20 stage documents unchanged. Current total chunks 54,803. Mapping correction and separately verified re-ingestion remain pending.

## Follow-up planning — 2026-10-09

The [trackable existing-text job plan](2026-10-09-trackable-corpus-jobs.md) supersedes the earlier 501-source remainder estimate for the next release: refreshing current shared-key identities leaves 464 candidates (347 small / 117 medium), 35 additional ambiguity holds and the two previous PDF holds. All 464 still require actual-PDF preflight. This follow-up specifies automatic resume/retry/supervision gaps; it does not authorize further production execution or alter the frozen first-stage evidence.
