# Lok Sabha `last_page_empty` cohort (113 answers): proposal for developer review and owner approval

> **Status: Living (2026-10-31).** Prepared and dry-run only. **Nothing has been submitted** (developers' operating
> procedure of 2026-10-31, stage 5a). It needs the developers' review and merge, then its own approval from the owner in
> one message (manifest hash, run-script sha256 from the merge commit, the merge commit, and the limits below), then one
> run, a receipt, website acceptance, and stop. It never touches `staging/pq-remainder-01/`.

## The screen change

**The one change.** A trailing last page is accepted only if it is empty after whitespace normalisation. Every other rule is the remainder cohort's, unchanged (`../pq-remainder-cohort.py`; section rules sha256 `5cb2d67c…730c`).

**What the pack's `last_page_empty` is.** Read-only shape inspection, 2026-10-31: `inspect-last-page-colab.py` printed no text and wrote `pq-lastpage-inspect/last-page-shapes.jsonl` on Drive.
- On all 121 records, `page_count` counts the PDF's blank last page, but `pages` lists only the pages before it: `page_count = len(pages) + 1`.
- The listed spans match the text exactly, and the text ends at the last listed page.

**How an accepted record is supplied.** The importer's adapter requires `page_count = len(pages)` and an exact split. So the blank page is made explicit: one more page, numbered `page_count`, spanning the (empty) text after the last listed page. Text, text hash and page count are unchanged.

**It is still held when:**
- `page_count ≠ len(pages) + 1`;
- any listed page is blank (2 answers: an empty middle page);
- the text after the last listed page has any non-whitespace character;
- or any remainder rule fails.

**`../pq-last-page-cohort.py`** implements this. **`../test_pq_last_page_cohort_offline.py`** has 12 tests:
- **Causal:** the remainder screen holds the record and this screen admits it. With the change removed, nothing is eligible.
- **Negative cases:** an empty middle page, a last page with text, a page count off by more than one, foreign links, and an over-limit answer.
- **Importer:** the real importer's dry run accepts the explicit empty page.

## A finding on the way: the 256-chunk rule

**The rule.** The section rules say "at most 256 chunks". The section driver applied it after its dry run; `pq-remainder-cohort.py` checks only the 300,000-character limit.
- **Remainder (523):** not affected; its largest answer has 164 chunks.
- **This cohort, pass 1** (`staging/pq-lastpage-01/prepare/`, 114 answers, manifest `66988517…41e2`): it included `AU1350_hVpwRk` (Upgradation of Modern Banking, 74 pages) at **290 chunks**.

**Pass 2** (`prepare-2/`) holds answers whose exact dry run exceeds 256 chunks (`--over-limit over-limit-keys.txt`), as the driver did, which leaves **113**. The pass-1 manifest is superseded and must not be approved.

**For the developers:** the remainder prepare script should get the same check before any future use. It is not needed for the 523; this was not changed, because the remainder files are frozen.

## What is proposed

| Item | Value |
|---|---|
| Documents | **113** Lok Sabha answers, sessions 182–187, answered 24 Jul 2024 – 2 Apr 2026 |
| **Manifest** (`decisions.jsonl`) sha256 | **`17315259a79bc4987a0e2b49a5dfed089394df62c32b79c83b0d005ebf0c1005`** |
| Cohort corpus (`corpus.jsonl`, on Drive only) sha256 | `2958bbaabc261704fa0cd9d7b89708ca2e6b19c0f56b5484d2026fbd6348efe4` |
| Decision id | `national-pq-lastpage-20261031-v1` |
| Planned chunks (exact, importer dry run) | **1,390**; largest answer 70 (`AU2114_howzWc`) |
| Conservative cost ceiling | **US$0.0837**. **Proposed limits:** `--max-chunks 1400 --max-estimated-cost-usd 0.09` |
| Expected actual spend | about **US$0.006** (cohort 1 rate) |
| Listing links at admission | **134** rows |
| Plan fingerprint | `c5ccfbbd6887af6ee393091c476b8e8ad0f3c6aba7af0203e1e7619453493a2e` |
| Run script | `run-last-page-cohort.py`, branch sha256 `60e0bf78…c262`; the approval uses the sha256 at the merge commit |
| Expected run time against one token | about **8–12 minutes** (cohort 1: about 3.7 s per answer). The script refuses a token with under 50 minutes left; `resume()` only after exit 2 with a fresh owner token |

**Where the 113 come from.**
1. **Candidates:** 121. These are the open answers in `open-answer-keys.txt` (793, read 2026-10-30), minus the remainder cohort's 523 (`--exclude-cohort ../remainder-cohort/cohort.json`), that the pack marks `last_page_empty`.
2. **Held: 8.**
   - 2 have an empty middle page;
   - 3 have the question number not in the text;
   - 1 has the answer date not in the text;
   - 1 is contained in a same-date answer (containment 0.812);
   - 1 is over 256 chunks.

   See `holds.json`.
3. **Near-duplicates:** checked against all 6,719 non-candidate pack records, which include the 523 and every stored answer.
4. **Independent rebuild here:** `decisions.jsonl` rebuilt from `review.tsv` with the core's decision function is byte-identical (`17315259…`). `review.tsv`, `checks.txt` and `holds.json` were also rebuilt here, and their hashes equal those Colab recorded (`prepare-summary.json`).

**Live, read-only** (`cohort-live-check.sql`, 2026-10-31 ~00:50 IST, on pass 1's 114 answers, a superset of these 113): 0 held by URL, key or path, and all listing rows corroborated. Every count matched: rowsets 114, rows 135 = pack rows, F266 135, key 135, type 135, member 135, house 135, mismatches 0. The committed SQL is the 113-answer version (134 rows); re-run it immediately before the run.

## The run script

`run-last-page-cohort.py` is `../remainder-cohort/run-remainder-cohort.py` with only these lines changed. `../test_run_last_page_cohort_offline.py` proves no other line differs:
- the constants: the hashes, `DECISION_ID`, counts and limits, the staging folder `pq-lastpage-01` and the work folder;
- the header comments naming them;
- **three lines outside the constants, which the developers asked about:**
  - the committed-cohort folder in `setup()` (`last-page-cohort`);
  - the rebuild command's prepare script (`pq-last-page-cohort.py`);
  - two added rebuild arguments: `--exclude-cohort` (the 523) and `--over-limit`.

  The rebuild has to call this cohort's prepare script to reproduce the manifest, so "constants only" could not hold literally. Please confirm these lines.

The same test file carries over the 16 run-script tests (token, `resume()` refusals, double-submit, status-on-crash, shared-code guard) against this script. A causal test removes each check from this script and shows its test fails.

## Website acceptance after the run (rule 5)

Spread across sessions, including the largest:

| Record | Detail | Chunks | Row(s) |
|---|---|---:|---|
| `AU2114_howzWc` | Implementation of Welfare Schemes for STs. Session 187; 27 pages | 70 (largest) | 4061 |
| `AS364_V5q5jG` | New Multi-State Cooperative Societies for Dairy Sector. Starred, session 185 | 20 | 3157, 7729 |
| `AU2310_PIF9Hd` | LPG Connections under PMUY in Jharkhand. Session 184 | 9 | 7275 |
| `AU3_NnZsgO` | Mahila Samman Savings Certificate Scheme. Session 183 | 7 | 3282, 6342, 7655 |
| `AU1402_aHgXTC` | Digital Personal Data Protection Act, 2023. Session 182 | 7 | 1339, 2834 |

For each: Full text, the right PDF, and the page count including the blank last page. Then one attached-record question on Gemini - Flash; the answer must cite one source, the right file, and figures present in the stored chunks.

## Files

**Here:**
- `decisions.jsonl`, `cohort.json`, `holds.json`, `review.tsv`, `checks.txt`, `dry-run.jsonl` and `over-limit-keys.txt`: no corpus text.
- `open-answer-keys.txt`: a copy of the remainder's. `setup()` checks it.
- `cohort-live-check.sql` and `verify.sql`.
- `prepare-last-page-colab.py`, `run-last-page-cohort.py` and `inspect-last-page-colab.py`.

**One level up:** `pq-last-page-cohort.py`, `test_pq_last_page_cohort_offline.py` and `test_run_last_page_cohort_offline.py`.
