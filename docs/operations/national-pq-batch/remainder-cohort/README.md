# Lok Sabha remainder cohort (523 answers): proposal for developer review and owner approval

> **Status: Living (2026-10-30).** Prepared and dry-run only. **Nothing has been submitted.** It finishes every Lok Sabha
> answer in the National citation pack v1.1 that passes the section screen. The other 270 stay held (below).
>
> Prepared at the owner's request of 2026-10-30, 01:19 IST ("finish the parliamentary question in one go, ensure i dont have
> to give token multiple times"), with his go-ahead to prepare before the developers accept cohort 1 ("Prepare now").
>
> Order from here: the developers accept validation cohort 1 (its receipt is `../validation-cohort-1/receipt.md`, website
> acceptance still open); they review this folder and the new tooling; they merge. Then the owner approves the manifest
> hash in one message, there is one run with one token, a receipt and website acceptance, and stop.

## What is proposed

| Item | Value |
|---|---|
| Collection | Lok Sabha question answers → `national` / `Parliamentary Question Database` (F266 adapter, admission links) |
| Documents | **523**, all session 182, answered 22 Jul–05 Aug 2024 |
| **Manifest** (`decisions.jsonl`) sha256 | **`8b1ac8f3b9f1cbe856063fc419c091b10f69c0f5e8483ff13fb7113a72750b27`** |
| Cohort corpus (`corpus.jsonl`; corpus text, on Drive only) sha256 | `781c224017c3710097d2b899b95e2c5c64f1c93cae2d666fcdbcf03787a46b52` |
| Decision id | `national-pq-remainder-20261030-v1` |
| Planned chunks (exact, importer dry run) | **5,234**; largest answer 164 (`AU2083_d6yKQK`) |
| Conservative cost ceiling (importer) | **US$0.305**; submit with `--max-chunks 5300 --max-estimated-cost-usd 0.31` |
| Expected actual spend | about **US$0.023** (cohort 1 rate: US$0.003604 / 829 chunks) |
| Expected listing links at admission | **632** rows for the 523 answer files |
| Plan fingerprint (sorted `source_key\|chunks\|text_sha256`) | `b83f8cf9688b1cae31d55b8101d84c52a70ca0358fdd8473b9c01b00fc9b8aa0` |
| Run script | `run-remainder-cohort.py` (sha256 in the approval message, after merge) |
| Expected run time | about 35 minutes (cohort 1: about 3.7 s per answer). One token covers it: the script refuses a token with under 50 minutes left |

The plan expected about 4,300 chunks and a US$0.25 ceiling; the exact dry run gives 5,234 and US$0.305, because the two
large answers held from cohort 1 (`AU2083_d6yKQK`, 164 chunks; `AS161_XfyBmh`, 66) are included. These limits are
the remainder cohort's own, set from its dry run. They are not the validation-cohort limits of rule 3.

## Where the 523 come from

1. **Open answers (live, read-only).** `open-answer-keys.sql` lists answer files with a listing row and no document, by URL, answer key or older pack path.
   - Result: 793 keys, which is the 893 of the 2026-10-29 reconciliation minus cohort 1's 100.
   - They are in `open-answer-keys.txt` (sha256 `66553914…6092`). The query's md5 over the same keys equals the file's.
2. **Screen (offline, Colab, no token).** `prepare-remainder-colab.py` at `557bfbf` ran `../pq-remainder-cohort.py` on the pinned pack. Pack `459b354c…dc9b8`; question member `474bb46e…8441`, checked against the pack manifest.
   - **793 candidates, all found in the pack; 523 eligible, 270 held.**
   - The rules are the section screen's (`nter-national-pq-core.py`, rules sha256 `5cb2d67c…730c`, bound into every decision), and the supplied-record rules of `pq-validation-cohort.py`.
   - **Near-duplicates:** checked against every non-candidate pack record (6,047 texts), then against earlier candidates. All stored answers are in the pack, so this is at least as strict as comparing with stored texts.
3. **Dry run.** `main`'s importer, offline: 523 ready, 0 held, 5,234 chunks (`dry-run.jsonl`, `review.tsv`).
4. **Independent rebuild here.** `decisions.jsonl` rebuilt from `review.tsv` (key and text hash) with the core's own decision function is byte-identical (`8b1ac8f3…`).
5. **Live corroboration** (`cohort-live-check.sql`, read-only, 2026-10-30 ~02:00 IST), computed from `checks.txt`:

   | Check | Result |
   |---|---|
   | Candidates | 523 |
   | Held by URL / key / path | 0 / 0 / 0 |
   | Stems with listing rows | 523 |
   | Rows (pack row sets equal the live rows for all 523) | 632 of 632 |
   | F266 house / subject / ministry / date | 632 corroborated |
   | Answer key | 632 |
   | Question type | 632 |
   | Member | 632 |
   | House | 632 |
   | Mismatches | 0 |

   No F266 refusal is predicted. Re-run it immediately before submission.

## The 270 held (`holds.json`, by answer key)

| Reason | Count | Next |
|---|---:|---|
| Page split `last_page_empty` | 121 | Plan step 3: a reviewed screen change with a causal test, then its own cohort |
| Question number not found in the text | 45 | Held |
| Answer date not found in the text | 52 | Held |
| No answer section | 28 | Held |
| Page split `unsplit_multipage` / `approximate` | 21 / 8 | Held |
| Over answer-read limits | 2 | Held |
| Near-duplicate text | 2 | Held |

Some answers have more than one reason; there are 270 answers in total.

## Website acceptance after the run (rule 5)

Open these five records signed in. Confirm Full text and the right PDF, then ask one attached-record question each; the cited passage must come from the right answer.
- `AU2083_d6yKQK`: Closing of Iron Industrial Unit at Giridih. Largest: 51 pages, 164 chunks; row 7314.
- `AS161_XfyBmh`: Drugs under DPCO. Starred, 66 chunks; row 6083.
- `AU10_3ev8MA`: Paper Leaks in India in Last 10 Years. Eight members' rows: 232, 678, 957, 1355, 4019, 4184, 4588, 4854.
- `AU1332_xkywjc`: Training for Panchayati Raj Representatives. Four rows: 2577, 4944, 5697, 6729.
- `AU1507_byiDVL`: Rail Service to Poonch and Rajouri District. Small, 5 chunks; row 623.

## How it would run (after review, merge and approval)

1. Re-run `cohort-live-check.sql` (read-only); it must equal the table above.
2. Sign in on nter.pro and copy that session's token. Then in Colab, launch `run-remainder-cohort.py` from the merged commit. It:
   - checks out that commit and pinned Node 24, and refuses unless `scripts/` and `supabase/` equal `main` `e158434`;
   - checks the committed manifest and open-answer list;
   - rebuilds the cohort from the pack and requires both hashes;
   - re-runs the dry run and requires 523 / 0 / 5,234 / ≤ US$0.31;
   - asks for the token once and refuses it with under 50 minutes left;
   - submits once and writes `staging/pq-remainder-01/submit-1.jsonl` and its status;
   - stops.

   It refuses if a submission report already exists.
3. **If the importer stops uncertain** (exit 2, as cohort 1 did on an HTTP 503): stop and report.
   - The owner may then decide, in writing, to finish the same manifest with `resume()`.
   - `resume()` re-runs the importer's idempotent submission into the next report: registered answers return as existing.
4. **After indexing**, run `verify.sql`; the expected values are in its header. Then the receipt, website acceptance, and stop.

## Files

- `open-answer-keys.sql` / `.txt`: the open answers.
- `decisions.jsonl`: the manifest.
- `cohort.json`, `holds.json`, `review.tsv`, `checks.txt`, `dry-run.jsonl` and `prepare-summary.json`: no corpus text.
- `cohort-live-check.sql`, `verify.sql`.
- `prepare-remainder-colab.py`, `run-remainder-cohort.py`.
- Tooling, one level up:
  - `pq-remainder-cohort.py`;
  - `pq-near-duplicate.py`: a verbatim copy of the Law core's dedupe functions, so the disabled core is never loaded;
  - `test_pq_remainder_cohort_offline.py`: 6 tests. They prove the copy is byte-identical and that the near-duplicate test fails with the rule disabled, and they run the real importer.
