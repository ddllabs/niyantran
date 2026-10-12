# Document role from sansad.in URL folder (F117, 2026-10-13)

> **Status: Historical (2026-10-13).** This records a production data change
> to NTER, approved by the owner ("go ahead with F117 using the URL folders";
> "Yes, run it") after a read-only description.

## Change

- Table: `public.documents`.
- Column: the `metadata` jsonb column. It adds `document_role` from the
  sansad.in folder in `file_url`, and the provenance marker
  `document_role_source: "sansad_url_folder"`.
- Rows: bill documents (`document_key` `bill:%`) with neither
  `document_role` nor `role`, whose `file_url` starts with
  `https://sansad.in/getFile/` and one of these folders:

  | Folder | `document_role` | Rows |
  |---|---|---|
  | `BillsTexts/LSBillTexts/Asintroduced/`, `BillsTexts/RSBillTexts/Asintroduced/` | `as_introduced` | 838 |
  | `BillsPDFFiles/Notification/` | `gazette_notification` | 287 |
  | `BillsTexts/LSBillTexts/Errata/` | `errata` | 13 |
  | `BillsTexts/LSBillTexts/PassedLoksabha/` | `as_passed_lok_sabha` | 8 |
  | `BillsTexts/LSBillTexts/PassedBothHouses/` | `as_passed_both_houses` | 7 |

- Inventory: the 1,153 IDs and roles in
  [`2026-10-13-document-role-folder-backfill.csv`](2026-10-13-document-role-folder-backfill.csv),
  saved before the update.
- Not changed:
  - the 467 `BillsPDFFiles/synopsis/` documents, which wait on the owner's
    decision on a "Synopsis" role;
  - the 2 `LSBillTexts/Hindi/` documents;
  - every other column;
  - chunks and embeddings: still 100,031;
  - nothing deleted.
- Side effect: the `documents_updated_at` trigger set `updated_at` on the
  updated rows.
- Undo: `update public.documents set metadata = metadata - 'document_role' -
  'document_role_source' where metadata->>'document_role_source' =
  'sansad_url_folder'`.

## Read-only checks before

- All 1,622 unversioned bill documents mapped to exactly one folder.
- All are on the sansad.in host.
- No bill has two documents with the same folder role.
- Only one row ends up sharing a role with an existing document on its bill:
  the anti-doping admin upload `89b71893…`, the known F115 duplicate.

## Verification (after)

- 1,153 rows updated: 838 / 287 / 13 / 8 / 7.
- `md5` of the sorted `id,role` lines of the updated rows is
  `d4d82b920242d721b82b6dca2156215b`, identical to the saved inventory.
- 1,153 rows carry the marker.
- Bill documents with a role: 1,094 before, 2,247 after. 469 remain without
  one: 467 synopses and 2 Hindi.
- `document_chunks` is unchanged at 100,031.

## Amendment 1: synopsis role (2026-10-13)

The owner approved a "Synopsis" role ("go ahead with the Synopsis label").

- Code: `synopsis: 'Synopsis'` was added to `DOCUMENT_ROLE_LABELS` in
  `supabase/functions/_shared/retrieval.ts` and `src/types/citation.js`. The
  grounding prompt now says a Synopsis passage summarises a bill or Act and is
  not its legal text.
- Data:
  - which rows: the remaining unversioned bill documents under
    `https://sansad.in/getFile/BillsPDFFiles/synopsis/`, 456 rows on 456 bills
    (467 before the F115 cleanup removed 11 misfiled synopsis copies);
  - what changed: they gained `document_role: "synopsis"` and the same
    `document_role_source: "sansad_url_folder"` marker;
  - inventory: the `md5` of the sorted IDs, `fa1a6bd7d77c693c4e46e2aeb00c1f9d`,
    taken before the update and identical in the `UPDATE … RETURNING`.
- Undo: `update public.documents set metadata = metadata - 'document_role' -
  'document_role_source' where metadata->>'document_role' = 'synopsis' and
  metadata->>'document_role_source' = 'sansad_url_folder'`.
- After: 2,695 of 2,697 bill documents carry a role. The remaining two are
  Hindi errata files (`LSBillTexts/Hindi/Errata/`). `document_chunks` is
  unchanged at 99,263.
- The label reaches the model and citations from `research-chat` v50.
