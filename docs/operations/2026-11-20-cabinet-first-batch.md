# Cabinet Decisions first batch on NTER (F374)

> **Status: Historical (2026-11-20).** The first batch of the Cabinet Decisions desk on NTER: 100 records of the
> National collection, pack v1.1, loaded through the search-only route. Spec:
> [five-desk search-only route](../specs/2026-11-19-five-desk-search-only-route.md). Before this step:
> [the apply record of 2026-11-20](2026-11-20-five-desk-route-apply.md). Open work: F374 (747 eligible Cabinet records
> remain).

The developer approved this step on 2026-11-20. All times are UTC on 2026-11-20. The runner ran from commit
`4504e7ee`. Nothing was deleted.

## Before the load

- 25,894 documents; no Cabinet documents.
- 22,437 ingest jobs, all `succeeded`.
- 36 batches, all `indexed`.
- Default chunk partition: 68,110 chunks.
- `ingest_settings`: max running 1, claim batch 2 (decision `F330-regulatory-load-revert-2026-11-16`).
- `admin-ingest` at version 16; `ingest-worker` at version 14.

## Screening

Read-only, the same day. 868 records read, 847 eligible, 21 held as too short. The screened file's sha256 begins
`e4f86c16`.

## Rehearsal on a local copy

The same day, on a local copy of the database. The same 100 records were used: the part file was byte-identical and
the manifest was the same. 100 records were admitted, 465 chunks were made and acceptance passed 50 of 50. The
rehearsal used generated vectors, so it checks the route, not the embeddings.

**Finding.** A desk without its own partition needs `limits.chunksNow` for that desk in the collection file. Without
it, planning stops with `chunks_unknown` before registration. For Cabinet the value is 0.

## Policy

Approved for `national-cabinet` at 01:59:35.

| Field | Value |
|---|---|
| Decision id | `F374-national-cabinet-2026-11-20` |
| Adapter | `national_search_only` |
| Licence class | `pib_reproducible_with_conditions` |
| Minimum characters per page | 600 |
| Minimum pages for density | 5 |
| Require page count | no |
| Budget | US$5 |
| Chunk ceiling | 200,000 |
| Stop thresholds | refusal share 0.05; failure rate 0.05; uncertain maximum 5; minimum decided 400 |
| Policy sha256 | `a62dedb57cad38d06c3c563fd89bd4d4518b868e02fdd3096d213281556db2dc` |
| Evidence | sha256 of the screen receipt, as for Regulatory |

## Steps

| Time (UTC) | Step | Result |
|---|---|---|
| 01:59:35 | Policy approved for `national-cabinet` | As above |
| 01:59:52 | `ingest_settings` raised | Max running 16, claim batch 8 (decision `F374-cabinet-load-2026-11-20`) |
| 02:00:05 to 02:10:53 | Runner `cli.ts run`, one part of 100 records | One dry run, one register call, no retries; exit 0 |
| 02:12:35 | `ingest_settings` put back | Max running 1, claim batch 2 (decision `F374-cabinet-load-revert-2026-11-20`); read back |
| 02:12:36 to 02:14:02 | `analyze` on `public.documents`, `public.document_chunks`, `public.desk_rows` | Done |

## Result

| Measure | Value |
|---|---|
| Batch id | `45808349-297a-4f77-b0a6-d24dd66b0f6d` |
| Manifest sha256 | `d38973ce0ed51d1bd1f8fbfefe9d11d174519ea09443873e70a475014b0d3521` |
| Batch state | `indexed` |
| Records | 100 admitted, 0 refused, 0 existing |
| Jobs | 100 succeeded, 0 failed, 0 uncertain |
| Chunks | 465 planned and stored, all with embeddings, all in `document_chunks_default` |
| Link rows | none (search-only route) |
| Acceptance | 50 sampled, 0 failures, 0 index misses |
| Spend | US$0.0016 (estimate US$0.0024) |
| Run time | 412.8 s |

## After the load

Read again from a separate read-only session.

| Measure | Before | After |
|---|---|---|
| Documents | 25,894 | 25,994 |
| Cabinet documents | 0 | 100, all indexed |
| Bills | 8,576 | 8,576 (unchanged) |
| Parliamentary Questions | 6,683 | 6,683 (unchanged) |
| Regulatory | 3,079 | 3,079 (unchanged) |
| Industry | 6 | 6 (unchanged) |
| Budget | 1 | 1 (unchanged) |
| Jobs | 22,437, all `succeeded` | 22,537, all `succeeded` |
| Batches | 36, all `indexed` | 37, all `indexed` |
| Default partition chunks | 68,110 | 68,575 |
| `n_live_tup`, documents | not recorded | 25,994 |
| `n_live_tup`, default partition | not recorded | 68,575 |
| Ingest-worker schedule | not recorded | active |
| `ingest_settings` | max running 1, claim batch 2 | max running 1, claim batch 2 (read back after the load's revert) |

## Search check

`match_documents` run as the `authenticated` role in a read-only transaction, for the desk Cabinet Decisions. It
returned 40 results, all Cabinet. The probe document was at rank 1. The search took 499 ms. The probe was a stored chunk
vector of a loaded document, not an embedded question.

Only the document counts of the other desks were compared. Their search was not checked.

## Not verified

- The publisher name in a chat citation. The research chat has not been redeployed, and that needs its own approval.
- A real question through the site.
- The search check for the other desks.
- The 747 eligible Cabinet records that remain. They are not loaded.

## Rollback

Nothing was deleted. The 100 documents can be removed only by a separate step that is approved on its own.

## Raw receipts

Raw receipts and logs are kept outside the repository.
