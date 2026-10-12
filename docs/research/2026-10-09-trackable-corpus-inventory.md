# Trackable existing-text cohort refresh

> **Status: Historical (2026-10-09).** Read-only snapshot for the [job plan](../plans/2026-10-09-trackable-corpus-jobs.md); not an ingestion authorization.

## Executed checks

Read production document source IDs/indexed state and 9,817 Bill Passage Probability Index rows through authenticated paginated SELECT requests. Re-ran the application's `analysisFor` / `buildBillModel` against the current rows and embedded analysis file. Checked all rows sharing each candidate key for normalized title/chamber ambiguity. A separate SQL aggregation screened both bill features together; it found 396 platform keys with differing title/chamber identities. This is a conservative ambiguity screen, not proof that every such key is an incorrect association.

The 524-source exact-Download-PDF subset came from the previous frozen 13,919-source inventory. Local source hashes/chunk counts were validated in that earlier preparation; this refresh does not claim to have reread all original corpus text or refetched every PDF. Re-read original text and perform actual-PDF identity/version checks before releasing any new manifest.

| Classification within that 524-source subset | Documents | Expected chunks |
|---|---:|---:|
| Small candidates: ≤100 chunks and ≤50,000 characters; PDF preflight pending | 347 | 7,265 |
| Medium candidates: size-tier validation and PDF preflight pending | 117 | 24,638 |
| Shared-key ambiguity hold | 35 | 3,256 |
| Previously failed PDF preflight | 2 | 37 |
| Already stored in previous stage, including its three text-only holds | 23 | 518 historical expected |
| Total | 524 | 35,714 |

Thus **464 remaining candidate documents** pass current local-text inventory, listing identity and exact URL screens. They are not 464 newly proven PDFs or necessarily 464 newly covered bills. The previous three held documents are part of the already-stored group, not additional candidates. The 35 ambiguity holds are additional remaining sources. No new candidate has completed a new actual-PDF preflight in this refresh.

Small-tier estimates: 1,604,930 embedding tokens, USD 0.03209860. Medium-tier estimates: 5,788,731 tokens, USD 0.11577462. Combined: 31,903 chunks / 7,393,661 estimated tokens / USD 0.14787322 at the previously recorded USD 0.00000002 per token. These are inherited chunker estimates, not billed usage or a complete operating cost. Confirm current model pricing before execution; exclude OCR, hosting, storage, retrieval/chat and retries.

Live aggregate SELECT confirmed 2,364 documents, 2,361 indexed documents and 54,803 chunks. shared_buffers is 512 MB; PostgreSQL start time remains 2026-09-28 08:19:47.722698 UTC. These settings do not establish total RAM or available CPU. No new throughput/p95 or CPU measurements were performed here.

## Evidence locations and limits

Fresh snapshot captured at 2026-10-08T22:34:12.172Z (2026-10-09 in Asia/Kolkata):

`/Users/vighneshshukla/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-job-plan/`

- `summary.json`: classifications and estimates.
- `candidate-inventory.json`: every source in the 524-source subset and its hold/candidate classification.
- `live-documents.json`, `live-bill-rows.json`: current read-only snapshots; no OCR text or secrets copied into these live snapshots.
- `cross-feature-collision-keys.json`: keys from the conservative two-feature SQL screen.

The original `corpus-bulk-preparation` inventory, manifests and execution receipts were left unchanged. No database writes, new embedding/OCR calls or scheduler installations occurred. Snapshot reads are not a transaction-wide frozen database; live identities must be rechecked immediately before writes.
