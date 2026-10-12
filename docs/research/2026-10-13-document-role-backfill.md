# Document role backfill: old `role` key to `document_role` (2026-10-13)

> **Status: Historical (2026-10-13).** This records a production data change
> to NTER, approved by the owner ("go ahead with backfill 2") after a
> read-only description.

## Why

The 2026-10-08 ingestion run stored each bill version under `metadata.role`.
Retrieval (`hydrateDocumentRoles`, `_shared/retrieval.ts`) and the F116
citation labels read only `metadata.document_role`. So these documents
showed no version label, and the model did not see their version. The
problem was found from the owner's anti-doping question: `ad275a72…`
("As passed by both Houses") appeared unlabelled.

## Change

- Table: `public.documents`.
- Column: the `metadata` jsonb column. It adds `document_role` equal to the
  existing `metadata.role`.
- Rows:
  - only these 24 IDs, all created 2026-10-08;
  - a row was updated only if `document_role` was null and `role` was
    `as_introduced` or `as_passed_both_houses`.
- Values: 18 `as_passed_both_houses`, 6 `as_introduced`.
- Not touched:
  - no other column;
  - no chunks or embeddings: `document_chunks` stayed at 100,031 rows;
  - nothing deleted.
- Side effect: the `documents_updated_at` trigger set `updated_at` on the 24
  rows. It is the table's only trigger, and nothing re-indexes.
- Undo: `update public.documents set metadata = metadata - 'document_role'
  where id in (…24 IDs…)`.

| ID | document_key | role |
|---|---|---|
| 1f1ce52a-35c6-4ba7-80d5-2de227d3cd01 | bill:2025:101 | as_passed_both_houses |
| fb64d5ac-2d60-4125-8398-b0f1601381e5 | bill:2025:105 | as_passed_both_houses |
| d6c8f1e5-a90b-4240-a8e8-20d93aeb61a1 | bill:2025:106 | as_passed_both_houses |
| 1b801b87-c069-4545-8771-2681b566ea6d | bill:2025:109 | as_passed_both_houses |
| 90428b54-9955-4d3c-9dff-456279194685 | bill:2025:110 | as_passed_both_houses |
| 0384f9b5-5b99-4798-827a-f45dffcc0fa2 | bill:2025:111 | as_introduced |
| 5fc250f0-f04b-4a77-a981-3f543d9e1437 | bill:2025:112 | as_introduced |
| 38f15384-c4c9-45a3-8d3f-2259ba1411cd | bill:2025:113 | as_introduced |
| 0c3ae72c-afa2-4b56-b664-123e32e02ef7 | bill:2025:140 | as_passed_both_houses |
| 901bcca1-0793-4ccf-97f1-c8f1c8a24871 | bill:2025:143 | as_passed_both_houses |
| 000666a7-1cca-42f1-b678-67d2e602ec23 | bill:2025:150 | as_passed_both_houses |
| 573087ea-b525-4c6d-9e83-fd4f1ea920d8 | bill:2025:193 | as_passed_both_houses |
| 6c2a1bd5-4478-4487-a567-4954364c5c18 | bill:2025:36 | as_passed_both_houses |
| 7daadcae-5b89-43e0-a612-96e49e555cb2 | bill:2025:37 | as_passed_both_houses |
| 0c031875-4d94-45cd-9f5f-d716d89bf7c9 | bill:2025:38 | as_passed_both_houses |
| ad275a72-15ad-4f79-8b2a-ab46523ecae8 | bill:2025:77 | as_passed_both_houses |
| e836edf4-baf0-4d76-aa47-f40afb0145a8 | bill:2026:105 | as_passed_both_houses |
| 624ae9cb-f168-4667-be51-16239cff1191 | bill:2026:107 | as_introduced |
| fd17ddb0-e296-4f55-bd71-b603557d027a | bill:2026:108 | as_introduced |
| 76e36547-a352-40fd-a71c-1d73ffd9531b | bill:2026:33 | as_passed_both_houses |
| 9f3da7f1-040d-49d9-9464-c6cd91e14dcf | bill:2026:72 | as_passed_both_houses |
| 2ec5636d-49f5-4dc4-919a-cdbca16b2ec5 | bill:2026:79 | as_passed_both_houses |
| 8f719d29-1474-4d4a-8b1c-c2b8ea0dc8d7 | bill:2026:82 | as_passed_both_houses |
| 2c4de28b-1cc3-4900-8206-9475513d14c6 | bill:2026:XLI | as_passed_both_houses |

## Verification (after)

- The `UPDATE … RETURNING` returned 24 rows, each with `document_role` equal
  to `role`.
- No row has `role` without `document_role`, and no row has a mismatch.
- Bill documents with `document_role`: 1,070 before, 1,094 after.
- 24 rows were touched; `document_chunks` is unchanged at 100,031 rows.

## Related findings (read-only, same day)

- Of the 1,094 documents added from 2026-10-08, only one repeats a version
  that already existed: `510cd60e…`, the anti-doping "As introduced" text,
  which repeats the 2026-10-01 admin upload `89b71893…` (F115).
- All 41 identical-text groups were created on 2026-09-21, in the original
  bulk load.
- 1,622 original bill documents (2026-09-21 to 2026-10-01) record no role.
  Their sansad.in URL folder names the kind:
  - As introduced: 838
  - Notification: 287
  - Synopsis: 467
  - Errata: 13
  - Passed Lok Sabha: 8
  - Passed both Houses: 7
  - Hindi: 2

  Whether to derive roles from that folder is open (F117).
