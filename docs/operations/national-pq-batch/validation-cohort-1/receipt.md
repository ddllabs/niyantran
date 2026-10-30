# Lok Sabha validation cohort 1: receipt (`national-pq-validation-20261029-v100`)

> **Status: Historical (dated 2026-10-30).** Rule 4 receipt. **Complete and accepted.** Ingestion is verified (the
> developers re-ran `verify.sql`: equal). Website acceptance passed on 2026-10-30, done by the developers on the default
> model, Gemini - Flash (below). Times are UTC, with IST in brackets.

## Approval

- Owner Tamanesh Kauri, in chat, 2026-10-29 23:23 IST, repeated 2026-10-30 00:14 IST:
  > "I, Tamanesh Kauri, approve Lok Sabha validation cohort 1 for one run only: manifest
  > a3525a9d7a6e53a559b9e3c737a19fd0cffdb4a5db5d4e21a65c436ae792f29c; run script sha256
  > 050da4fad739ff16f0bc2e37b300eccee2442dd23d4647c562a0bf823f11f15b; from main commit
  > e15843463809bb6698347689762dd4e76a9bd1e4; within 2,000 chunks and US$0.05."
- Owner, 2026-10-30 00:34 IST: "ok run for 100 for now".
- After the first submission stopped (below), owner, 00:54 IST: "finish the remaining file".

## Inputs

| Item | Value |
|---|---|
| Manifest (`decisions.jsonl`) | `a3525a9d7a6e53a559b9e3c737a19fd0cffdb4a5db5d4e21a65c436ae792f29c` |
| Cohort corpus (rebuilt in Colab, private) | `521d434c35072915e36988d77bc828690c6fec1c60bf18c036b1518e6ec4c8eb` |
| Source corpus | `pq-batch-06/T5/corpus.jsonl`, `44704d71a67d771217b0fec969cae639b145b0711300d2bade987a999c23652b` |
| Run script | `run-validation-cohort-1.py` at `e158434`; sha256 printed in Colab: `050da4fa…f15b` (equal to the approval) |
| Code checkout | `e15843463809bb6698347689762dd4e76a9bd1e4`. The guard passed: `scripts/` and `supabase/` are byte-identical to `8820f63` |
| Limits | `--max-chunks 2000 --max-estimated-cost-usd 0.05` |
| Runner | Colab notebook `Untitled7.ipynb` under tamanesh1993@gmail.com. Token: the owner's own nter.pro session, typed by the owner at the prompt (never seen, stored or logged by the agent). No password used |

## Run log

1. **Live pre-check** (`cohort-live-check.sql`, read-only), at 2026-10-29 17:55, 18:44 and 19:04 (23:25, 00:14 and 00:34 IST).
   - Every time: 100 candidates, 0 held by URL, key or path; 100 with listing rows (114), 114 corroborated, 0 mismatches. All equal to the header.
2. **Attempts that stopped before submission** (nothing was sent):
   - 18:00: the Drive mount timed out, in a notebook under the wrong Google account.
   - 18:46: Colab timed out waiting for access to the `SUPABASE_PUBLISHABLE_KEY` secret. The dry run had already passed: `run/dry-run-colab.jsonl` is byte-identical to the reviewed `dry-run.jsonl`.
   - 19:25: the agent clicked the run cell again by mistake. The script's guard refused at once ("already holds a submission report … never resubmit"); nothing was sent.
3. **Submission 1** (`run/submit-1.jsonl`, sha256 `7d82d80e…61d4`), 19:16:27–19:19:46.
   - 53 registered, then **HTTP 503** on document 54 (`132ce2837e4f…`), which the importer records as uncertain.
   - The importer then stopped by design: exit 2; 46 not submitted; 0 refused.
   - Read-only check R2: document 54 *had* been registered. Its text hash equals the plan; it is indexed, with 20 chunks and 1 link.
4. **Resume after the owner's decision** (`run/submit-2.jsonl`, sha256 `5bb8426f…7c91`; `run/submit-2-status.json`), 19:27–19:36:39.
   - The importer's own retry path: the same approved manifest and limits, a new report file. The 54 already in returned as existing; 46 were new.
   - Exit 0: 100 registered, 0 uncertain, 0 refused.
   - The resume was typed as a notebook cell, because the run script deliberately refuses to submit twice. It used the script's own functions and the same pinned checkout.
   - **Developers, 2026-10-30:** the hand-typed resume cell was accepted once only and must never be repeated. Later cohorts resume only through a reviewed `resume()` in their run script.

## Counts

| Stage | Count |
|---|---|
| Selected / ready / held (dry run) | 100 / 100 / 0 |
| Registered | **100** |
| Refused by F266 admission checks | 0 |
| Indexed (every chunk vectored, 1536-d) | **100**: 829 chunks |
| Linked to listing rows | **100 documents, 114 links**, decision `admission:pq-answer-key-v1` (written at admission) |
| Visible to signed-in readers (resolver, R3) | 5 of 5 acceptance records (8 rows), `full`, right file |
| Website-accepted | **5 of 5** (developers, 2026-10-30; below) |

## Spend

180,177 embedding tokens: **US$0.003604**. Ceiling US$0.046490; limit US$0.05. OCR US$0. No embedding was repeated: the resume created no new job for the 54 already in.

## Verification (`verify.sql`, read-only, 2026-10-29 19:37 UTC)

```
docs 100 | indexed 100 | text_hash_valid 100 | chunks 829 | vectors 829 | all_1536 true | national 100
linked_docs 100 | links 114 | links_equal_rows 100 | url_eq true | text_eq true | link_decisions admission:pq-answer-key-v1
one_job_ok 100 | ocr_pages 0 | tokens 180177 | cost_usd 0.003604
fingerprint 090b78173e528bde969738af95631bd17236879dfe851e60c25415b1448c3baa  (equal to the plan)
```

Every value equals the header's expectation.

## Website acceptance (rule 5): passed

Done by the developers on 2026-10-30, signed in on production `e1584346`, with the default model **Gemini - Flash (low)**:
736 credits in total. Each answer cited one source, the right answer file, and every listed item is in the stored text.

| Record | Answer file | Checked |
|---|---|---|
| Dairy Farming | `AU2515_4ZRTdy.pdf` | Rajiv Ranjan Singh alias Lalan Singh; Rashtriya Gokul Mission, NPDD, NLM; Kisan Credit Card |
| New Agricultural Policy (starred) | `AS220_iNFz3I.pdf` | Shivraj Singh Chouhan; both quoted sentences; NMSA |
| 10-day bagless guidelines | `AU2182_DgjJUX.pdf` | Jayant Chaudhary; "in consultation with concerned stakeholders"; 29 July 2024 launch |
| Internet Shutdown | `AU2739_sDP7PH.pdf` | 2017 Temporary Suspension Rules; 10.11.2020; "not maintained centrally" |
| Increasing Cyber Crimes | `AU2504_KA5sLT.pdf` | Bandi Sanjay Kumar; ₹2,400 crore / 7.6 lakh complaints; 5.8 lakh SIMs; CyTrain 96,288 |

"Gemini 2.5 Lite", whose provider failed in the agent's first attempt below, has since been removed from the model list
(developers, 2026-10-30).

### The agent's first attempt (2026-10-29, superseded by the table above)

Signed in on www.nter.pro, 2026-10-29 19:40–19:42 (01:10–01:12 IST, 30 Oct), in the owner's Chrome, account shown as "V", MAX plan.

**Record 1, `AU2515_4ZRTdy.pdf` "Dairy Farming":**
- **Listing:** search found both member rows, each showing **Full text**. The title link opened the right sansad.in PDF.
- **Record panel:** "Full text", "Full text is available for research".
- **Question:** "Ask AI about this question" attached the record ("Dairy Farming · Full text", focus Attached only). One question was sent with the default model (Gemini 2.5 Lite, no reasoning, web off).
- **Result: failed.** "The turn failed. Please try a new turn", with no credits used.
  - Trace (R4): the search step returned 40 passages, **all from `AU2515_4ZRTdy.pdf`**, so retrieval was correctly scoped.
  - The model call then failed: `model_call_logs` status `error`, "Provider attempt failed.", `google/gemini-2.5-flash-lite`.
  - Another conversation's turn failed the same way at 19:42:27, so this is a provider-side failure, not a cohort defect.

**Records 2–5 were not attempted.** Under the owner's rules a failure means stop and report, with no retry under a different model. Their signed-in coverage was checked read-only through the released resolver (R3): all `full`, each on the right file.

| Record | Rows | File |
|---|---|---|
| Dairy Farming | 3056, 4765 | `AU2515_4ZRTdy.pdf` |
| New Agricultural Policy (starred) | 669 | `AS220_iNFz3I.pdf` |
| 10-day bagless guidelines | 3513, 3631 | `AU2182_DgjJUX.pdf` |
| Internet Shutdown | 3994, 4829 | `AU2739_sDP7PH.pdf` |
| Increasing Cyber Crimes | 216 | `AU2504_KA5sLT.pdf` |

Superseded: the developers completed acceptance on 2026-10-30 (table above).

## For the developers

1. **HTTP 503 from `admin-ingest`** at 2026-10-29 19:19:46 UTC, on a registration that had committed. Worth checking its logs. The importer's uncertain-then-stop behaviour, and the idempotent resume, both worked as designed.
2. **Chat answers failing**: `research-chat` → `google/gemini-2.5-flash-lite` "Provider attempt failed." (19:41:35 and 19:42:27 UTC).
3. **The resume step** was a typed notebook cell, not a committed script. A reviewed `--resume` mode in the run script would make a stopped run's restart a committed, checkable step.

## Files

- **Here:** `run/submit-1.jsonl`, `run/submit-1-status.json`, `run/submit-2.jsonl`, `run/submit-2-status.json`, `run/dry-run-colab.jsonl` (no corpus text) and `receipt-queries.sql` (R1–R4).
- **Private copies** (Drive): `Data Handover/National/v1.1/staging/pq-validation-01/`, which also holds the cohort `corpus.jsonl`.
