# National parliamentary-question batch (batch 1: 1,000 Lok Sabha answers)

> **Status: Historical (dated 2026-10-27; note added 2026-10-29).** This is the owner's authorization, the route, the checks and the receipt for one
> batch of 1,000 Lok Sabha question answers from the National citation pack v1.1. Batch 1 is verified; the driver stopped
> after it as instructed.
>
> **2026-10-29.** The route below (migration `20261027120000`, the branch's `suppliedText.ts`) is superseded by F266 on
> `main`; do not re-apply it. `run_section()` and the Colab Secrets sign-in break the owner's 2026-10-29 rules 2 and 7 and
> must not be used again. Batches 2–6: [`receipts/`](receipts/). Live reconciliation:
> [`reconciliation-2026-10-29.md`](reconciliation-2026-10-29.md). Production changes:
> [`production-changes.md`](production-changes.md).

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

- **The rest of the section.** Tamanesh Kauri, chat, 2026-10-27 21:10 IST, after batch 1: "Go ahead and keep doing all
  in this section." `run_section()` runs batches 2, 3, … with decision prefixes `owner-authorized-20261027-national-pq-bNN`,
  each in its own staging folder `pq-batch-NN/`, until no eligible answer remains. Each batch is checked and
  dry-run exactly like batch 1. Answers on hold stay held. A failed verification stops new submissions. Progress is
  logged in `staging/pq-section-status.json`.

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

## Batch 1 receipt (verified 2026-10-27 14:14 UTC)

- **Inputs:**
  - Code: commit `3e72673`, with driver sha256 `07ae236f…0f7c1e` fetched by that commit in Colab.
  - Pack: `NTER_citation_pack_v1.1_2026-10-05.zip`, sha256 `459b354c…dc9b8`.
  - Question member: sha256 `474bb46e…8441`.
  - Rules: sha256 `5cb2d67c…730c`.
- **Deployment (owner-approved, same day):**
  - `ingest-worker` v6 and `admin-ingest` v8 were redeployed. The only file changed is `_shared/suppliedText.ts`; every
    other deployed file was compared with the repository and is unchanged.
  - The migration `supplied_text_national_questions` was applied after CI passed on `3e72673`. Both jobs passed,
    including the SQL fixtures.
  - The inner registration function is executable only by its owner. `service_role` keeps only the wrapper.
- **Live read before the batch:**
  - 3,459 National documents.
  - 8,000 question desk rows, carrying 6,840 distinct PDFs.
  - 82 question answers already stored.
- **Screen of all 6,840 pack records:**
  - 6,486 eligible before chunking.
  - Every eligible answer's desk rows agreed on URL, subject, date, type, ministry and member. No answer was held for
    a desk-row disagreement.
- **Holds:**

  | Reason | Count |
  | --- | --- |
  | already stored (key and legacy file name) | 82 each |
  | page split `none` | 82 |
  | page split `last_page_empty` | 121 |
  | answer date not found in the text | 59 |
  | question number not found in the text | 53 |
  | no answer section | 34 |
  | page split `unsplit_multipage` | 21 |
  | page split `approximate` | 8 |
  | near-duplicate | 3 |
  | same-date containment | 1 |
  | over limits | 2 |
  | too short | 1 |

  Held answers stay out of the database for review; nothing was forced.
- **Selection:**
  - The 1,000 newest eligible answers, from Lok Sabha session 187, in five tranches of 200.
  - Each tranche's offline dry run matched every document's chunk count, with 0 held.
  - Worst-case cost ceiling: US$0.6449.
- **Run (UTC):**
  - T1–T5 registered 11:09–11:32, with 0 uncertain, 0 held and 0 resumes.
  - Indexing finished at 14:11. After registration ended, the queue ran at the worker's scheduled rate of about 2 per
    minute.
- **Verified:**
  - By the driver, over the API: every document.
  - Independently, by `verify.sql` against the database. It returned:

  | Check | Result |
  | --- | --- |
  | Indexed, and stored text hash valid | 1,000 / 1,000 |
  | Chunks | 11,219, equal to the plan; 0 null vectors; all 1536-d |
  | Stored in national / Parliamentary Question Database | 1,000 |
  | Matched to a desk row by URL | 1,000 (1,228 desk rows covered; 1,000 distinct URLs) |
  | One succeeded job each | 1,000 |
  | OCR pages | 0 |
  | Cohort fingerprint | `581081b2650fdc8eb2770cea29f11a53f2eba944ab5e9f46cfeb459cc7f132f4`, equal to the plan |

- **Cost:** 2,412,145 embedding tokens, **US$0.0482**.
- **Deltas:**

  | Item | Before | After |
  | --- | --- | --- |
  | Documents | 11,008 | 12,008 |
  | National documents | 3,459 | 4,459 |
  | Question answers | 82 | 1,082 |
  | Chunks | 325,989 | 337,208 |

  ANALYZE was run on `documents`, `document_chunks` and `desk_rows`.
- **Shared-chunk check:**
  - One pair shares 10 of 24–25 chunks: `AU3492_cjYS5X.pdf` (Progress under AOGUSY) and `AU3500_ClELGq.pdf` (GMP and
    NABL Accreditation under AOGUSY).
  - Both were answered by AYUSH on 13 March 2026, to different questions asked by different members.
  - The shared part is the scheme description common to both answers. It is not a duplicate document. It is listed for
    the owner's information, and nothing was changed.
- **Ledger:** `Data Handover/National/v1.1/staging/pq-batch-01/ledger-national-pq-b01.csv` lists the 1,000 files, all
  with status `verified`, document id and indexed time. The staging folder holds the private corpus copies, decisions
  and reports, which are not committed.
- **Not checked here:**
  - natural-language answers on the website;
  - per-record grounding. Question rows carry no `document_key`, and the frontend's `documentKey()` reads only bill
    and Law keys, so the module-level assistant sees these answers but "ask about this record" does not attach them.
