# Law ingestion audit ledger

One row per ingested Law document, all batches, with status DONE only when the job succeeded, the document is indexed
and its listing is published. Columns cover decision, approver, source key, title, case number, order date, official PDF
URL, document/job/listing IDs, text hash, chunks, embedding tokens and cost, timestamps, publication decision and the
screen/rules/package hashes.

- **Where:** owner's Google Drive, `Data Handover/Legal/v1.1/ledger/`. Google Sheet "NTER Law ingestion ledger" (tabs
  "Ingested (DONE)" and "Batches") plus `nter-law-ingestion-ledger.csv` and its `.sha256`. The sheet ID is in `sheet-id.txt`.
  The ledger itself is not committed: it is an operational record.
- **How:** run `ledger-export.sql` (read-only), pass its `n`, `md5`, `len` and `rows` (or gzip+base64 `gz_b64`) as
  `LEDGER_RAW` to `nter-law-ledger.py` in Colab. The script verifies the md5/length, rewrites the CSV and overwrites both
  sheet tabs in full.
- **Batches:** B1 pilot (5), B2 cohort-2 (5), B3 next-100 (100), B4 next-1000 (1,000).
