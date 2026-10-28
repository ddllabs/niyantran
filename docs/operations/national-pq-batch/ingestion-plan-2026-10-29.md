# Plan for further ingestion (Law and Lok Sabha answers)

> **Status: Living (2026-10-29).** A proposal under the owner's 2026-10-29 rules. It authorizes nothing: each step below
> is one cohort, with its own manifest hash approved in writing by the owner, then a receipt and website acceptance, then a stop.
> The numbers come from the read-only reconciliation of 2026-10-29.

## Where things stand

| Collection | In production | Left to ingest | State |
|---|---|---|---|
| Lok Sabha answers (`Parliamentary Question Database`) | 5,865 client documents, all indexed and linked; 82 September imports held unlinked | **893** answer files with a listing row and no document | Validation cohort 1 (100) prepared, awaiting approval |
| Law (NCLT / IBBI orders) | 7,549 documents (7,546 served; 3 retired) | The pinned IBBI_NCLT parts were exhausted by Law batch 11 | Next Law source not yet screened |
| Rajya Sabha, Bills, regulators, other National | — | — | **Held**: no reviewed adapter (rule 8) |

The 893 Lok Sabha answer files break down as:

| Group | Count | Path |
|---|---|---|
| Validation cohort 1 | 100 | Step 1 |
| Rest of batch 6 T5: 33 eligible, plus 2 held for size (`AU2083_d6yKQK`, `AS161_XfyBmh`) | 35 | Step 3 |
| Eligible at the 2026-10-27 screen, never planned | 488 | Step 3, re-screened from the pack |
| Held by the screen's text rules | about 270 | Step 4, owner decisions per reason |

## Steps

### Step 1: Lok Sabha validation cohort 1 (100)

Prepared, nothing submitted.
- Manifest `a3525a9d…f29c`; 829 chunks; ceiling US$0.0465 against the US$0.05 limit; about US$0.0036 expected.
- See `validation-cohort-1/README.md`.

Needs from the owner:
- written approval of that manifest hash;
- permission to push this task branch, so Colab can fetch the pinned script;
- a short-lived token typed at the prompt.

Done when:
- `verify.sql` matches the expected values in its header (100 documents indexed, 829 vectors, 114 links, fingerprint equal to the plan, cost ≤ US$0.05);
- the receipt is committed;
- five records pass website acceptance, signed in: Full text, plus one attached-record question each, citing the right answer.

### Step 2: review the results, then stop

The owner and the developer review the receipt and the acceptance before anything larger.
- If any record failed acceptance, the cause is found first. Platform defects go to the developer; nothing is re-ingested.
- The client-script diff on this branch goes for review: `pq-validation-cohort.py`, `pq-cohort-ceilings.mjs`, their tests and the run script.

### Step 3: Lok Sabha remainder cohort (up to 1,000, expected about 520)

Only after step 2 passes and the owner approves.
- **Selection:** re-screen the pack member in Colab, read-only, against live state with the same rules. Expected: about 488 never planned, plus 33 left in batch 6 T5, minus anything held.
- **Large answers:** the two held for size can join here, because the limit for this cohort is set per cohort.
- **Manifest:** one, with the exact chunk count and ceiling from the dry run, sent to the owner.
- **Limits:** stated per submission. Expect roughly 4,300 chunks and a ceiling of about US$0.25; actual spend about US$0.02.
- **Pre-submit check:** the same live corroboration as cohort 1 (no holder; every listing row passes the F266 house, subject, ministry and date checks).
- **Acceptance:** website acceptance on five records again, then the receipt, then stop.

### Step 4: the held Lok Sabha answers (about 270): owner decisions, not ingestion

Each reason needs its own owner decision. Nothing is re-OCRed or forced.
- **`last_page_empty` (121):** the text is complete but the last PDF page is blank.
  - Possible fix: a reviewed rule change that accepts a trailing empty page. That is a client screen change for review; the server already accepts `page_split` `exact` or `none`.
- **`unsplit_multipage` (21), `approximate` (8), `page split none` (82 September imports):** need a page-integrity decision. The 82 also need a decision on whether to re-register them with a URL or leave them held; F266 refuses a second document for the same answer.
- **Date not found (59), number not found (53), no answer section (34):** likely OCR or layout problems. Review a sample; the default is to keep them held.
- **Near-duplicates (2–3), over limits (2), too short (1):** hold.

### Step 5: Law: the next orders

The admitted Law collection is NCLT / IBBI orders, through the listing adapter. The next source is unscreened:
- either later IBBI_NCLT parts of the legal ZIP, if any remain;
- or the next tribunal parts the adapter already supports.

The path is the same as for Lok Sabha:
1. Screen with `scripts/law-cohort-screen.py` against the live reconciliation.
2. A **100-order validation cohort** (at most 2,000 chunks and US$0.05), approved by hash, with receipt and acceptance, then stop.
3. Then up to 1,000 per cohort, each approved separately.

Watch Law's chunk size: earlier Law batches averaged about 31 chunks per order, so 100 orders may exceed 2,000 chunks. The 100 must be chosen to fit, as in Lok Sabha cohort 1.

### Step 6: every other collection stays held

Rajya Sabha, Bills, regulators and the other National modules each need a reviewed adapter and policy boundary from the developer first.

## Limits that apply to every step

- **Owner approval:** one cohort per approval, by manifest hash; approvals are never chained.
- **Runtime limits:** `--max-chunks` and `--max-estimated-cost-usd` on every submission. Validation cohorts: at most 2,000 chunks and US$0.05.
- **Access:** a short-lived token typed at run time. No stored password; the old Colab Secrets password should be deleted and rotated.
- **No shared changes:** no shared code, migrations, deploys or SQL writes from the client. Reconciliation queries are read-only.
- **Search capacity:** feature search recovers within a feature only up to 100,000 eligible chunks (F264 note).
  - The Lok Sabha feature has about 59,500 chunks now; about 64,600 after steps 1 and 3.
  - Before any collection's feature nears 100,000, the developer needs to confirm capacity.
- **Receipts:** every cohort gets a receipt on the branch: manifest and hash, approval, counts (screened, registered, indexed, linked, held with reasons), actual spend and verification output.
