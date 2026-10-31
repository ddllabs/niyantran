# Lok Sabha remainder cohort (523): receipt (`national-pq-remainder-20261030-v1`)

> **Status: Historical (dated 2026-10-31).** Rule 4 receipt. **Complete and accepted.** Ingestion is verified (`verify.sql` equals its
> header) and website acceptance passed 5 of 5 (below). Times are UTC, with IST in brackets.

## Approval

- Owner Tamanesh Kauri, in chat, 2026-10-31 00:36 IST, verbatim:
  > "I, Tamanesh Kauri, approve the Lok Sabha remainder cohort for one run: manifest 8b1ac8f3b9f1cbe856063fc419c091b10f69c0f5e8483ff13fb7113a72750b27, run script sha256 c545a41c2c8aa8e99fce89650cb7aef1b94cb4008cd2b7f1587a952026844327, launched from the merge commit of PR ddllabs/niyantran#79 · Client corpus: remainder cohort… on main, within 5,300 chunks and US$0.31. One run; resume() only after an uncertain stop (exit 2), with the same manifest and a fresh token from me."
- Developers, 2026-10-31: "PR #79 is merged. M = 0ef60067f2507316f6e2593b5e66a3cf57eb0466 … Start Stage 1 now."
- Owner, 2026-10-31 16:22 IST, after the first launch stopped at the Drive mount (below), to "may I start it again exactly as before": "yes".

## Inputs

| Item | Value |
|---|---|
| Launch commit M | `0ef60067f2507316f6e2593b5e66a3cf57eb0466` ("Merge pull request #79 …" on `origin/main`) |
| Run script at M | `run-remainder-cohort.py`, sha256 `c545a41c2c8aa8e99fce89650cb7aef1b94cb4008cd2b7f1587a952026844327`: checked by the agent at M and printed and asserted in Colab before `exec` (equal to the approval) |
| Manifest at M (`decisions.jsonl`) | `8b1ac8f3b9f1cbe856063fc419c091b10f69c0f5e8483ff13fb7113a72750b27` (equal to the approval) |
| Shared code | `scripts/`, `supabase/`, `src/`, `api/`, `server/` identical between `e1584346` and M (empty `git diff`); the script's own guard also passed |
| Cohort corpus (rebuilt in Colab, private) | `781c224017c3710097d2b899b95e2c5c64f1c93cae2d666fcdbcf03787a46b52` (the script requires it) |
| Limits | `--max-chunks 5300 --max-estimated-cost-usd 0.31` |
| Runner | Colab `Untitled7.ipynb` under tamanesh1993@gmail.com. Tokens: the owner's own nter.pro sessions, typed by the owner at the prompt; never seen, stored or logged by the agent. No password used |

## Run log

1. **Pre-flight (stage 1)**, 2026-10-31 10:35–10:40 (16:05–16:10 IST).
   - M found on `origin/main`; both hashes equal at M; shared code identical.
   - `cohort-live-check.sql` (read-only): cands 523, held by URL / key / path 0 / 0 / 0, stems with rows 523, rowsets equal 523, rows 632 = pack rows; key, corroborated, type, member and house all 632; mismatches 0. Equal to the header.
   - `staging/pq-remainder-01/` held only `prepare/` (no `submit-*`).
2. **Launch 1 stopped before submission**, ~10:41 (16:11 IST). Hash printed and asserted equal. The Drive mount then timed out (`ValueError: mount failed`) while the Drive approval dialog waited for the owner. Nothing sent; no token asked; staging unchanged. **Hard stop reported**; relaunched unchanged only after the owner's "yes" (above).
3. **Launch 2**, from ~10:52 (16:22 IST): hash equal; Drive mounted; rebuild and offline dry run equal to the approved cohort (manifest `8b1ac8f3…`); owner's token accepted ("valid for about 54 more minutes").
4. **Submission 1** (`run/submit-1.jsonl`, sha256 `e2a080c3928fcfbd9404bb04f4f19baf7d8a6010a9f18952290b8af8ac02fbb4`; `run/submit-1-status.json`), 10:54:48–11:17:31.
   - 328 registered, then document 329 (`e2a23c70…`, `AU814_OVWdkf.pdf`) came back **uncertain** ("registration outcome unknown; reconcile exact manifest"). The importer stopped by design: **exit 2**; 194 not submitted; 0 refused. `stderr_tail` empty.
   - Read-only check: document 329 *had* been registered at 11:17:02, text hash `ac4f49c9…c84e` equal to the plan, indexed, 5 chunks, 1 link, job succeeded.
5. **Resume**: `resume(M)` from the same script (the reviewed path; no hand-typed cell). It confirmed the last status was exit 2 and the staged files unchanged, then asked for a fresh token.
   - The token prompt was answered at 16:18, 16:21 (21:48, 21:51 IST) with a token issued ~15:49 that had 31, then 27 minutes left. The script refused both (`token has under 50 minutes left`), before any submission; no `submit-2` file was written.
   - ~16:23 (21:53 IST) **the agent clicked the wrong cell** while reopening the prompt and re-ran the launch cell. `run()` refused at once ("already holds a submission report … never resubmit from here"); nothing was sent.
   - The prompt was reopened once more; the owner's fresh token was accepted ("valid for about 59 more minutes").
6. **Submission 2** (`run/submit-2.jsonl`, sha256 `0b12b185c0d03e0315e35c70cf0d809881a9f77b64bb1d20a482d156841c404b`; `run/submit-2-status.json`), 16:26:32–16:46:21 (21:56–22:16 IST).
   - The same approved manifest and limits. 329 returned **existing** (exactly submission 1's 328 plus document 329); 194 new.
   - **Exit 0**: 523 registered, 0 uncertain, 0 held. One resume used of the two the procedure allows.
7. **Indexing**: all 523 jobs `succeeded` by 16:50 (read-only).

## Counts

| Stage | Count |
|---|---|
| Selected / ready / held (dry run) | 523 / 523 / 0 |
| Registered | **523** (523 distinct file URLs; no duplicates) |
| Refused by F266 admission checks | 0 |
| Indexed (every chunk vectored, 1536-d) | **523**: 5,234 chunks |
| Linked to listing rows | **523 documents, 632 links**, decision `admission:pq-answer-key-v1` |
| Signed-in coverage of the 5 acceptance records (resolver, 15 rows) | 15 of 15 `full`, each on the right file |

## Spend

1,174,780 embedding tokens: **US$0.023496**. Ceiling US$0.305076; limit US$0.31. OCR US$0. No embedding was repeated: the resume created no new job for the 329 already in.

## Verification (`verify.sql`, read-only, 2026-10-31 ~16:50 UTC)

```
docs 523 | indexed 523 | text_hash_valid 523 | chunks 5234 | vectors 5234 | all_1536 true | national 523
linked_docs 523 | links 632 | links_equal_rows 523 | url_eq true | text_eq true | link_decisions admission:pq-answer-key-v1
one_job_ok 523 | ocr_pages 0 | tokens 1174780 | cost_usd 0.023496
fingerprint b83f8cf9688b1cae31d55b8101d84c52a70ca0358fdd8473b9c01b00fc9b8aa0  (equal to the plan)
```

Every value equals the header's expectation.

## Website acceptance (rule 5)

**Passed, 5 of 5.** Done by the agent on 2026-10-31 17:00–17:08 (22:30–22:38 IST), signed in as the owner on www.nter.pro
(account "V", MAX). Each record: found through record search; record panel "Full text"; its "Question (PDF)" link is the
right sansad.in file; "Ask AI about this question" attached it alone (focus Attached only) to a new, empty research chat;
model **Gemini - Flash · Low** (the menu's "Default"; see finding 7); one question; web off.

| Record (row opened) | Answer file | Question asked about | Answer | Sources | Credits |
|---|---|---|---|---|---|
| Closing of Iron Industrial Unit at Giridih (7314) | `AU2083_d6yKQK.pdf` | Act and section for CPCB directions; re-opening protocol | Section 5, Environment (Protection) Act, 1986; Standard Protocol … (March 2023); Office Order dated January 01, 2024 | 1, right file | 149 |
| Drugs under DPCO, starred (6083) | `AS161_XfyBmh.pdf` | Ceiling prices; new-drug retail prices; MRP cap | 926 scheduled formulations as on 30.07.2024; around 2,894 new drugs; not more than 10% in 12 months | 1, right file | 304 |
| Paper Leaks in India in Last 10 Years (1355) | `AU10_3ev8MA.pdf` | NEET(UG) date; committee; Supreme Court order | 5 May 2024; High-Level Committee 22.6.24, report in two months; order 18.7.2024 in WP (Civil) No. 335/2024 | 1, right file | 110 |
| Training for Panchayati Raj Representatives (2577) | `AU1332_xkywjc.pdf` | MoU institutes; minister | IIM Ahmedabad, Amritsar, Bodh Gaya, Jammu, Shillong, Rohtak; IIT Dhanbad; IRMA (8); Prof. S.P. Singh Baghel | 1, right file | 130 |
| Rail Service to Poonch and Rajouri District (623) | `AU1507_byiDVL.pdf` | Survey length, route, cost | 223 km via Akhnur and Rajauri; ₹22,771 crore | 1, right file | 99.8 |

Total: about 793 credits. **Every figure above is in the stored text** (read-only checks of `documents.ocr_text`; the
January 2024 office order is stored as "JanuarY 01,01,2024", an OCR artefact of the source PDF). Retrieval trace
(`chat_turn_traces`, R5): each turn's search returned chunks only from its own answer file (40, 40, 9, 20 and 5 chunks).
All five model calls (`google/gemini-3.8-flash`) succeeded. No wrong file, no "Record only", no figure outside the text.

Signed-in coverage through the released resolver (R4): all 15 listing rows of the five records are `full`, each on the
right file.

## Deviations and findings

1. **Launch 1 stopped at the Drive mount** (timed out waiting for the owner's approval click). Nothing sent; relaunched unchanged after the owner's written "yes".
2. **Uncertain registration** on document 329 (`AU814_OVWdkf.pdf`, 11:17:02): the registration had committed. As in cohort 1, the importer's uncertain-then-stop and the idempotent resume worked as designed. The cause was not captured in the report (`stderr_tail` empty); the `admin-ingest` logs around 11:17 UTC are worth checking.
3. **Two stale tokens refused** by the 50-minute guard: the owner's browser kept handing out the same session token (issued ~15:49) until a full sign-out and sign-in. The guard worked; nothing was sent.
4. **Agent error:** a mis-click re-ran the launch cell; `run()`'s double-submit guard refused it. Nothing was sent.
5. **Report counter:** submission 2's summary says `already_registered: 0`, though 329 of its `registered` lines carry `existing: true`. The summary's `submitted` counts existing documents too. Worth a look in the importer's summary; it does not affect the result.
6. **256-chunk rule** (from the last-page cohort): `pq-remainder-cohort.py` does not enforce it. Not relevant here (the largest answer has 164 chunks).

7. **Model default:** the chat opened on "Gemini - Lite · Minimal" (apparently the account's last choice), while the menu marks "Gemini - Flash" as "Default". The agent selected Gemini - Flash, as the procedure names, before the first question, and used it for all five; no switch after any failure.
8. **A failed Lite call at 17:07:33** (`google/gemini-2.5-flash-lite`, status `error`, `model_call_logs`) beside the fifth turn's successful Flash call. Probably a side call (follow-up suggestions); the answer was unaffected. As in cohort 1, the Lite provider path is failing.

## Files

- **Here:** `run/submit-1.jsonl`, `run/submit-1-status.json`, `run/submit-2.jsonl`, `run/submit-2-status.json` (no corpus text) and `receipt-queries.sql`.
- **Private copies** (Drive): `Data Handover/National/v1.1/staging/pq-remainder-01/`, which also holds the cohort `corpus.jsonl`.
