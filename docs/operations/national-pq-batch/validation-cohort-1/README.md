# Lok Sabha answers, validation cohort 1 (100 documents): proposal for owner approval

> **Status: Living (2026-10-29).** Handoff step (c): prepared and dry-run only. **Nothing has been submitted.** Submission
> needs the owner's written approval of the exact manifest hash below (rule 1); then one run, a receipt and website
> acceptance, and stop (rules 2, 4, 5). Built on `main` `498152f` (F266 admission); merged with and re-pinned to `main` `8820f63` (PR #75) on 2026-10-29, dry run re-run with identical results.

## What is proposed

| Item | Value |
|---|---|
| Collection | Lok Sabha question answers → `national` / `Parliamentary Question Database` (F266 adapter) |
| Documents | **100**, all session 182, answered 05–07 Aug 2024 (92 unstarred, 8 starred; 315 pages; 1,024–44,194 characters) |
| **Manifest** (`decisions.jsonl`) sha256 | **`a3525a9d7a6e53a559b9e3c737a19fd0cffdb4a5db5d4e21a65c436ae792f29c`** |
| Cohort input (`corpus.jsonl`, not committed: corpus text) sha256 | `521d434c35072915e36988d77bc828690c6fec1c60bf18c036b1518e6ec4c8eb` |
| Decision id | `national-pq-validation-20261029-v100` |
| Planned chunks (exact, importer dry run) | **829** (limit 2,000) |
| Conservative cost ceiling (importer) | **US$0.046490** (limit US$0.05); submitted with `--max-chunks 2000 --max-estimated-cost-usd 0.05` |
| Expected actual spend | about **US$0.0036** (batch 2–6 rate per chunk) |
| Plan fingerprint (sorted `source_key\|chunks\|text_sha256`) | `090b78173e528bde969738af95631bd17236879dfe851e60c25415b1448c3baa` |
| Expected listing links at admission | **114** (100 answer files; some answers serve several members' rows) |

## Where the 100 come from

- **Universe.** 893 answer files have a listing row and no document (`../reconciliation-2026-10-29.md`). Of these, the
  135 batch-6 T5 answers were screened, planned and exactly dry-run on 2026-10-27 but never registered.
- **Input.** `Data Handover/National/v1.1/staging/pq-batch-06/T5/corpus.jsonl`, sha256 `44704d71…3652b`. That equals the
  `corpus_sha256` that batch 6's `plan.json` recorded when the driver extracted it from the pinned pack member
  (`474bb46e…8441` in `NTER_citation_pack_v1.1_2026-10-05.zip`, `459b354c…dc9b8`).
- **Selection rule.** The plan's order, skipping only a candidate whose own conservative ceiling exceeds US$0.004.
  - Two of the 135 exceed it: `AU2083_d6yKQK` (164 chunks, US$0.0084 alone, 17% of the limit) and `AS161_XfyBmh`
    (66 chunks, US$0.0077), so `candidate-keys.txt` has 133 keys. Only `AU2083_d6yKQK` falls inside the first 100;
    `AS161_XfyBmh` came after them anyway. Both stay for a later cohort.
  - The first 100 in plan order (all 135 with no skip) gave 988 chunks and US$0.0547, over the limit.
  - `candidate-keys.txt` holds the 133 ordered keys. `pq-validation-cohort.py` takes the first 100 that pass.
- **Reproducible.** Rebuilding from the input and `candidate-keys.txt` gives a byte-identical manifest and corpus (checked).

## Checks (all passed)

| Check | Result |
|---|---|
| Screen rules (`nter-national-pq-core.py`, rules sha256 `5cb2d67c…730c`), re-run on the supplied records | 100 pass, 0 held: text hash, character count, exact page spans, 300–300,000 characters, an ANSWER section, URL shape, file name, answer key = URL key, session/house, question type and number, title number, number and answer date in the text |
| Dry run re-run 2026-10-29 on the branch merged with `main` `8820f63` (Node 22.22.0) | cohort rebuilt from the staged input and `candidate-keys.txt`: manifest and corpus byte-identical; report byte-identical to `dry-run.jsonl` (sha256 `222a68b3…8343`): 100 ready, 0 held, 829 chunks, ceiling US$0.046490 |
| Dry run, `main`'s importer (`scripts/corpus-text-import.mjs` with `main`'s `suppliedText.ts`), offline | selected 100, ready 100, held 0, chunks 829, ceiling US$0.046490, manifest `a3525a9d…` (`dry-run.jsonl`, no corpus text) |
| Live, read-only (`cohort-live-check.sql`, 2026-10-28 about 19:45 UTC, 29 Oct 01:15 IST) | 0 already held by a document (by URL or URL variant, answer key, or older pack path); all 100 have listing rows (114); all 114 rows corroborate under the server's own `pq_norm` / `pq_date` (house, subject, ministry, date); answer key equals on all 114 → **no F266 refusal predicted** |
| Near-duplicate / containment | checked against all stored answers and earlier candidates at batch-6 planning; nothing has been added to the section since except batch 6 itself |

## How it would run (after approval)

1. Re-run `cohort-live-check.sql` (read-only). It must give the expected row in its header.
2. In Colab, launch `run-validation-cohort-1.py` from the pinned commit (header). It:
   - checks out that commit and pinned Node 24, and refuses unless `scripts/` and `supabase/` are byte-identical to `main` `8820f63`;
   - verifies the committed manifest hash equals the approved one;
   - rebuilds the cohort from the staged input and requires the same two hashes;
   - re-runs the dry run and requires 100 / 0 / 829 / ≤ US$0.05;
   - asks the person running it, signed in on nter.pro with their own admin account, for **that session's access token** at a prompt (rule 7; never stored or printed; no password);
   - submits once with `--approval a3525a9d… --max-chunks 2000 --max-estimated-cost-usd 0.05`;
   - writes `staging/pq-validation-01/submit-1.jsonl` and `submit-1-status.json`, and stops.

   It refuses to run if a submission report already exists.
3. Indexing proceeds on the existing worker schedule. Then run `verify.sql` (expected values in its header) and write the receipt.
4. **Website acceptance** (rule 5), signed in. Open five records, confirm Full text, and ask one attached-record
   question each; the cited passage must be from the right answer. Proposed records:
   - `AU2515_4ZRTdy`: Dairy Farming; rows 3056 and 4765; 50 chunks, 17 pages.
   - `AS220_iNFz3I`: New Agricultural Policy; starred; row 669.
   - `AU2182_DgjJUX`: 10-day bagless guidelines; rows 3513 and 3631.
   - `AU2739_sDP7PH`: Internet Shutdown; rows 3994 and 4829.
   - `AU2504_KA5sLT`: Increasing Cyber Crimes; row 216.
5. Stop and report. A 1,000-document cohort is proposed only after this one passes and the owner approves it.

## Files

- `decisions.jsonl` (the manifest), `cohort.json` (keys, URLs, answer keys, text hashes, F266 signatures; no text) and `candidate-keys.txt`.
- `dry-run.jsonl`, `f266-signatures.txt`, `cohort-live-check.sql` and `verify.sql`.
- `run-validation-cohort-1.py`.
- Tooling, one level up:
  - `pq-validation-cohort.py` (prepare); `pq-cohort-ceilings.mjs` (exact per-document chunks and ceiling, the importer's own computation);
  - `test_pq_validation_cohort_offline.py`: 9 tests, including the real importer. The answer-key hold test was shown to fail with the hold disabled.
