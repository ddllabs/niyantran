# National parliamentary-question batch (batch 1: 1,000 Lok Sabha answers)

> **Status: Living (2026-10-27).** This is the owner's authorization, the route and the checks for one batch of up to
> 1,000 Lok Sabha question answers from the National citation pack v1.1. The batch receipt is added here once it is
> verified.

## Authorization

- **Batch.** Tamanesh Kauri, chat, 2026-10-27 15:57 IST: "Start with 1,000 parliamentary questions … check whether
  that is mapped to the correct section in nter.pro … Maintain a ledger … Do a batch of 1,000 and stop … Maintain the
  previous standards of injection."
  - Decision prefix: `owner-authorized-20261027-national-pq-b01`.
  - One batch only. The driver stops after it.
- **Route.** The owner approved the same day "option 1 but check it doesn't break anything": extend the supplied-text
  connection to National questions. This means:
  - the migration `20261027120000_supplied_text_national_questions`;
  - `_shared/suppliedText.ts`, redeployed in `admin-ingest` and `ingest-worker`;
  - the importer's cost envelope.

  Law registration is unchanged. The SQL fixture `supplied_text_national` proves it, as do the Law listing fixtures
  re-run on top of the migration and the unchanged Deno and importer suites.

## Where the documents go on nter.pro

- **Section.** Each document is stored as `documents.desk_tier = 'national'`,
  `desk_feature = 'Parliamentary Question Database'`.
  - This is the module whose rows are the Lok Sabha question register: 8,000 desk rows, 6,840 distinct answer PDFs.
  - The research assistant scopes a question asked in that module to these documents (`research-chat` binds the
    module's tier and feature).
- **Record link.** The pack links every answer to its desk rows (`links[].row_key`).
  - Before registration, the batch requires each linked row to carry the same official PDF as `source_url`, and its
    subject, date, question type, ministry and member to agree with the answer's citation.
  - The database re-checks the URL on every registration.
  - The pack key (`pq:ls:<session>:<file>`) is kept as `metadata.document_key_suggested`.
  - Record panels keep their existing "Question (PDF)" link. The desk rows themselves are not changed.

## Checks

This is the same standard as the Law batches, plus question-specific identity and section checks.
`nter-national-pq-core.py` holds the code, and its rules hash is bound into every decision.

- **Identity.**
  - The URL must be `https://sansad.in/getFile/loksabhaquestions/annex/<session>/<AS|AU><no>_<id>.pdf?source=pqals`.
  - The URL, file name, title and citation must agree on session, question type and number.
  - The question number and the answer date must appear in the text.
  - The house must be Lok Sabha.
- **Section mapping.** As described above, for every linked desk row.
- **Completeness.**
  - The text hash and the character count must match.
  - The page split must be exact, with every page span equal to its page text.
  - The text must have at least 300 characters and an ANSWER section.
  - At most 256 chunks and 300,000 characters.
- **Dedupe.**
  - The answer must not already be in the database by `source_key`, `file_url` or legacy file name. This covers the 82
    answers loaded in September.
  - The Law near-duplicate and same-date containment holds apply, against the stored answers and earlier candidates.
- **Chunking.** Chunk counts are exact, taken from the importer's own offline dry run. Each tranche's dry run must
  reproduce them, with 0 held and a cost ceiling under US$2.50 for the batch.
- **Verification**, per document:
  - indexed;
  - stored text hash equal to the plan;
  - chunk count equal to the plan;
  - no null vectors;
  - stored in the question section;
  - URL equal to the desk row's `source_url`.

  The fingerprint over sorted `source_key|chunks|text_sha256` must equal the plan's.

## Running it (Colab)

The driver is `nter-national-pq-batch.py`.

1. **Fetch it.** Fetch the driver by pinned commit and check its sha256. Then call
   `run('plan', <commit>)` followed by `run('submit', <commit>)`.
2. **Plan writes nothing.** `MODE plan` makes no database writes. It writes the following to
   `Data Handover/National/v1.1/staging/pq-batch-01/`:
   - `plan.json`;
   - five tranches of 200, each with its corpus, decisions and dry-run report;
   - `ledger-national-pq-b01.csv`.
3. **Submit.** `MODE submit` registers each tranche through the same ingestion account used for Law.
   - **Resuming.** An incomplete submission is resumed: the driver re-reads the database, and every key present must
     be this plan's text in the question section.
   - **Then:** it waits for indexing, verifies every document and updates the ledger to `verified`.
4. **The ledger.** `ledger-national-pq-b01.csv` lists every file ingested, one row each:
   - key, file name, title;
   - session, question type and number;
   - answer date, ministry, members;
   - desk rows, URL;
   - chunks, text hash;
   - status, document id.

Offline tests:

```bash
python3 -I docs/operations/national-pq-batch/test_national_pq_offline.py
python3 -I docs/operations/national-pq-batch/test_national_pq_driver_offline.py
```

Both run the real importer in dry-run mode. No network is used.
