# Plan for further ingestion (Law and Lok Sabha answers)

> **Status: Living (2026-10-29, updated to `main` `4cc23a7`).** A proposal under the owner's rules for every ingestion
> run (`docs/operations/2026-10-28-corpus-client-handoff.md`). It authorizes nothing. Each step is one cohort and follows
> the same order:
> developer review of the scripts and dry run → reviewed pull request to `main` → the owner's written approval of the exact
> manifest hash → one run → receipt and website acceptance → stop.
> Numbers come from the read-only reconciliation of 2026-10-29 and the developer's reply on `main`.

## Where things stand

| Collection | In production | Left to ingest | State |
|---|---|---|---|
| Lok Sabha answers (`Parliamentary Question Database`) | 5,865 client documents, all indexed and linked, **60,611 chunks** in the section; website acceptance of batches 1–6 passed on 2026-10-29 | **893** answer files with a listing row and no document | Validation cohort 1 (100) prepared; branch pushed (`5dba5f6`), reviewed by the developer |
| Law (NCLT / IBBI orders) | 7,549 documents (7,546 served; 3 retired); NCLT / NCLAT section at **225,273 chunks** | The pinned IBBI_NCLT parts were exhausted by Law batch 11 | Next Law source not yet screened |
| Rajya Sabha, Bills, regulators, other National | — | — | **Held**: no reviewed adapter (rule 9) |

**The 82 imports of 2026-09-21 are decided:** kept held and unlinked, no action (owner). They are not part of this plan.

The 893 Lok Sabha answer files break down as:

| Group | Count | Path |
|---|---|---|
| Validation cohort 1 | 100 | Step 1 |
| Rest of batch 6 T5: 33 eligible, plus 2 held for size (`AU2083_d6yKQK`, `AS161_XfyBmh`) | 35 | Step 2 |
| Eligible at the 2026-10-27 screen, never planned | 488 | Step 2, re-screened from the pack |
| Held by the screen's text rules | about 270 | Step 3 (`last_page_empty` only); the rest stay held |

## Steps

### Step 1: Lok Sabha validation cohort 1 (100)

Prepared and dry-run; nothing submitted.
- **Manifest:** `a3525a9d7a6e53a559b9e3c737a19fd0cffdb4a5db5d4e21a65c436ae792f29c`.
- **Size and cost:** 829 chunks; ceiling US$0.0465 against the US$0.05 limit; about US$0.0036 expected.
- **Details:** `validation-cohort-1/README.md`.

Order:
1. Done: branch pushed; scripts, tests and dry run reviewed by the developer at `5dba5f66`.
2. The developer raises the reviewed pull request to `main`.
3. The owner, Tamanesh Kauri, approves that manifest hash in writing (rule 1).
4. One run of `run-validation-cohort-1.py`. The person running it signs in on nter.pro with their own admin account and types that session's access token at the prompt (rule 7).

Done when:
- `verify.sql` (read-only transaction) matches its header: 100 indexed, 829 vectors, 114 links, fingerprint equal to the plan, cost ≤ US$0.05;
- the receipt is committed on the branch;
- the five proposed records pass website acceptance, signed in: Full text, plus one attached-record question each, citing the right answer.

Then stop. The developer reviews the receipt and acceptance; any failure is traced first, with platform defects going to the developer and nothing re-ingested.

> **Update 2026-10-30.**
> - **Step 1 ran:** 100 indexed and linked, US$0.003604. Website acceptance is incomplete: the chat provider failed. See `validation-cohort-1/receipt.md`.
> - **Step 2 is prepared** in `remainder-cohort/` at the owner's request, before the developers have accepted step 1. It has 523 answers, manifest `8b1ac8f3…0b27`, 5,234 chunks and a US$0.305 ceiling. Nothing has been submitted.
> - **The rest of National v1.1, and v1.2,** are planned in `../national-plan-v1.1-to-v1.2-2026-10-30.md`.

### Step 2: Lok Sabha remainder cohort (expected about 520)

Only after cohort 1 is accepted, and in the same order: review → pull request → owner approval → one run.
- **Selection:** re-screen the pack member in Colab with the same rules, against live state read-only. Expected: about 488 never planned, plus the 33 left in batch 6 T5, minus anything held.
- **Large answers:** the two held for size are included, so the cohort stays representative.
- **Limits:** one manifest, with `--max-chunks` and `--max-estimated-cost-usd` set from its dry run. Expect about 4,300 chunks and a ceiling of about US$0.25; actual spend about US$0.02.
- **Pre-submit check:** the same live corroboration as cohort 1 (no holder; every listing row passes the F266 house, subject, ministry and date checks).
- **Then:** website acceptance on five records, the receipt, and stop.

### Step 3: `last_page_empty` holds (121): a proposal, only after cohort 1 is accepted

These answers' text is complete; only the last PDF page is blank.
- **Proposal:** a reviewed client screen change that accepts a trailing empty page, with its own causal test, shown to fail without the change.
- **Approval:** if accepted, those answers form their own cohort, with their own manifest and approval.

All other screen holds stay held by default, with no re-OCR and nothing forced:
- `unsplit_multipage` (21) and `approximate` (8);
- answer date not found (59), question number not found (53), no answer section (34);
- near-duplicates (2–3), over limits (2), too short (1).

### Step 4: Law validation cohort (100 orders)

May follow after the Lok Sabha cohort, under rule 3's Law limits: **at most 4,000 chunks and US$0.25**.
- **Selection:** the cohort must be representative of typical orders, not short orders chosen to fit. Earlier Law batches averaged about 31 chunks per order.
- **Source:** NCLT / IBBI orders through the listing adapter. The next source is unscreened: later IBBI_NCLT parts of the legal ZIP, if any remain, or the next tribunal parts the adapter already supports.
- **Path:** screen with `scripts/law-cohort-screen.py` against live state read-only; dry run; review; pull request; owner approval of the hash; one run; receipt and website acceptance; stop.

**Law cohorts of 1,000 wait for F272.** The NCLT / NCLAT section already has 225,273 searchable chunks, above the 100,000 fallback-search bound. An underfilled Law search there fails explicitly instead of recovering.

### Step 5: every other collection stays held

Rajya Sabha, Bills, regulators and the other National modules each need a reviewed adapter and policy boundary from the developer first (rule 9).

## Limits that apply to every step

- **Owner approval:** the owner is the only approver, one cohort per approval, by manifest hash. The developer reviews the scripts, dry run and receipts before each approval request and after each run. Approvals are never chained (rules 1–2).
- **Runtime limits:** `--max-chunks` and `--max-estimated-cost-usd` on every submission, set from the dry run. Validation cohorts: Lok Sabha at most 2,000 chunks and US$0.05; Law at most 4,000 chunks and US$0.25 (rule 3).
- **Access:** the runner's own nter.pro admin session token, typed at run time. No stored password anywhere (rule 7). The disabled drivers that used one now refuse to run (see `README.md`).
- **No shared changes:** no shared code, migrations, deploys, listing changes or SQL writes from the client, including `ANALYZE`. Production reads only inside `begin transaction read only; … rollback;`, with each query committed beside the receipt that uses it (rules 6 and 8).
- **Search capacity (F272):** fallback search within a section is bounded at 100,000 searchable chunks.
  - Lok Sabha is at 60,611: about 61,400 after step 1 and about 65,700 after step 2, still under the bound.
  - NCLT / NCLAT (225,273) is already over it.
- **Receipts:** every cohort gets a receipt on the branch: manifest and hash, approval, counts (screened, registered, indexed, linked, held with reasons), actual spend, verification output and website acceptance (rules 4–5).
