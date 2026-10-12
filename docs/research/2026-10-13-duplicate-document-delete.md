# Duplicate anti-doping document removed (F115, 2026-10-13)

> **Status: Historical (2026-10-13).** This records a production data
> deletion on NTER, approved by the owner ("yes, run the delete and push")
> after the backup and the exact statement were shown.

## What and why

`bill:2025:77` (The National Anti-Doping (Amendment) Bill, 2025) held two
"As introduced" copies of the same sansad.in PDF:

- the 2026-10-01 admin upload `89b71893…` (page pipeline, stored PDF); kept;
- the 2026-10-09 text ingest `510cd60e…`; removed.

It was the only bill with two documents of the same version.

## Statement

```sql
delete from public.documents where id = '510cd60e-7fd7-4e74-a91e-d99a12765686';
```

The `ON DELETE CASCADE` foreign keys removed its 98 `document_chunks` rows. It
had no pages, blocks, images, files, OCR pages or ingest jobs.

## Backup (before)

The backup is local only, in a git-ignored folder, and is not committed:
`tmp/backups/2026-10-13-doc-510cd60e/`.

- `document.json`: the full row. SHA-256
  `2220db91f37205c175f783091613d6e5e6ead4165fe82c10b4c4d1fcb309ed49`.
- `document_chunks.json`: 98 chunks (indexes 0–97), each with its 1,536-value
  embedding. SHA-256
  `71c3944e4cf009761ddccb25697a10cb1b9f7866203902612a4ce3b8b4a665de`.

To restore, re-insert the row and then the chunks from these files.

## Verification (after)

- The document and its chunks are gone, with no orphans.
- `document_chunks` went from 100,031 to 99,933; `documents` from 3,434 to
  3,433.
- `bill:2025:77` now has three documents: `as_introduced` (the PDF),
  `as_passed_lok_sabha` and `as_passed_both_houses`.
- No bill has two documents with the same `document_role`.
- Saved answers that cited `510cd60e…` show that source as unavailable.

The remaining F115 items (TRAI repeats and the text shared across different
bills, all from 2026-09-21) are still open.
