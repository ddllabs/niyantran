# Lok Sabha `last_page_empty` cohort (113): receipt (`national-pq-lastpage-20261031-v1`)

> **Status: Historical (dated 2026-11-01).** Rule 4 receipt. **Complete and accepted.** Ingestion is verified
> (`verify.sql` equals its header) and website acceptance passed 5 of 5 (below). Times are UTC, with IST in brackets.

## Approval

- Developers, 2026-11-01 01:33 IST: PR #88 moves the run script's shared-code baseline to `e5275e70` (main at PR #87); new run script sha256 `aa94cb55…d689`; Stage 7 to run from #88's merge commit once the owner's approval is in chat.
- Owner Tamanesh Kauri, in chat as his own message, 2026-11-01 01:34 IST, verbatim:
  > "I, Tamanesh Kauri, approve the Lok Sabha last-page cohort for one run: manifest 17315259a79bc4987a0e2b49a5dfed089394df62c32b79c83b0d005ebf0c1005, run script sha256 aa94cb55e86f875fd133d2c9072ee9123097ca24c69100eddaf8d6b96abcd689, launched from the merge commit of PR ddllabs/niyantran#88 · 113 last-page run: move the… on main, within 1,400 chunks and US$0.09. One run; resume() only after an uncertain stop (exit 2), with the same manifest and a fresh token from me."
- An earlier approval (2026-10-31 22:28 IST, run script `60e0bf78…`, PR #80) was not used: at #80's merge commit `98e87a91` the shared-code guard would have refused (`supabase/tests/` differed from `e1584346`), so Stage 7 was skipped and reported.

## Inputs

| Item | Value |
|---|---|
| Launch commit | `ea34b555484a5e705c6400d9bbee22aa4309d9b5` ("Merge pull request #88 …" on `origin/main`) |
| Run script at the launch commit | `run-last-page-cohort.py`, sha256 `aa94cb55e86f875fd133d2c9072ee9123097ca24c69100eddaf8d6b96abcd689`: checked by the agent at the commit, then printed and asserted in Colab before `exec` (equal to the approval) |
| Manifest (`decisions.jsonl`) | `17315259a79bc4987a0e2b49a5dfed089394df62c32b79c83b0d005ebf0c1005` (equal to the approval) |
| Shared code | `scripts/` and `supabase/` identical between `e5275e70` and the launch commit (empty `git diff`); the script's own guard also passed |
| Cohort corpus (rebuilt in Colab, private) | `2958bbaabc261704fa0cd9d7b89708ca2e6b19c0f56b5484d2026fbd6348efe4` (the script requires it) |
| Limits | `--max-chunks 1400 --max-estimated-cost-usd 0.09` |
| Runner | Colab notebook under the owner's Google account. Token: the owner's own nter.pro session, typed by the owner at the prompt; never seen, stored or logged by the agent. No password used |

## Run log

1. **Pre-flight**, 2026-10-31 20:12–20:14 (01:42–01:44 IST, 1 Nov).
   - PR #88 merged as `ea34b555`; both hashes equal there; shared code unchanged from `e5275e70`.
   - `cohort-live-check.sql` (read-only): cands 113, held by URL / key / path 0 / 0 / 0, stems with rows 113, rowsets equal 113, rows 134 = pack rows; key, corroborated, type, member and house all 134; mismatches 0. Equal to the header.
   - `staging/pq-lastpage-01/` held only `prepare/` and `prepare-2/` (no `submit-*`).
2. **Launch**, ~20:15: hash printed and asserted; Drive mounted without a prompt; rebuild and offline dry run equal to the approved cohort (manifest `17315259…`); the owner's token accepted ("valid for about 59 more minutes").
3. **Submission 1** (`run/submit-1.jsonl`, sha256 `78b750c0672d03b72ea7370792d9f57390234ebb3a17d0aaf1539a509824daa7`; `run/submit-1-status.json`), 20:17:00–20:24:58 (01:47–01:54 IST).
   - **Exit 0**: 113 registered (all new), 0 uncertain, 0 retried, 0 existing, 0 held. One token; no resume.
4. **Indexing**: all 113 jobs succeeded by 20:27 (read-only).

## Counts

| Stage | Count |
|---|---|
| Selected / ready / held (dry run) | 113 / 113 / 0 |
| Registered | **113** |
| Refused by F266 admission checks | 0 |
| Indexed (every chunk vectored, 1536-d) | **113**: 1,390 chunks |
| Linked to listing rows | **113 documents, 134 links**, decision `admission:pq-answer-key-v1` |
| Page split | `exact` on all five acceptance records; stored page counts include the blank last page (27, 7, 4, 4, 3) |
| Signed-in coverage of the 5 acceptance records (resolver, 9 rows) | 9 of 9 `full`, each on the right file |

## Spend

320,014 embedding tokens: **US$0.006400**. Ceiling US$0.083729; limit US$0.09. OCR US$0.

## Verification (`verify.sql`, read-only, 2026-10-31 ~20:27 UTC)

```
docs 113 | indexed 113 | text_hash_valid 113 | chunks 1390 | vectors 1390 | all_1536 true | national 113
linked_docs 113 | links 134 | links_equal_rows 113 | url_eq true | text_eq true | link_decisions admission:pq-answer-key-v1
one_job_ok 113 | ocr_pages 0 | tokens 320014 | cost_usd 0.006400
fingerprint c5ccfbbd6887af6ee393091c476b8e8ad0f3c6aba7af0203e1e7619453493a2e  (equal to the plan)
```

Every value equals the header's expectation.

## Website acceptance (rule 5)

**Passed, 5 of 5.** Done by the agent on 2026-10-31 20:30–20:37 (02:00–02:07 IST, 1 Nov), signed in as the owner on
www.nter.pro. Each record: found through record search; record panel "Full text"; its "Question (PDF)" link is the right
sansad.in file; "Ask AI about this question" attached it alone (focus Attached only) to a new, empty research chat; model
**Gemini - Flash · Low**; one question; web off.

| Record (row opened) | Answer file | Answer | Sources | Credits |
|---|---|---|---|---|
| Implementation of Welfare Schemes for STs, the largest (4061) | `AU2114_howzWc.pdf` | 41 Ministries/Departments besides Tribal Affairs under DAPST; Shri Durgadas Uikey; Statement 10B of the Expenditure Profile | 1, right file | 182 |
| New Multi-State Cooperative Societies for Dairy Sector, starred (3157) | `AS364_V5q5jG.pdf` | 239.3 MMT in 2023-24, 25% of global; organized sector 32% (47 MMT) of 150 MMT surplus; cooperatives 56% (26 MMT) | 1, right file | 124 |
| LPG Connections under PMUY in Jharkhand (7275) | `AU2310_PIF9Hd.pdf` | Launched May 2016; 8 crore target achieved September 2019; 10.33 crore connections as on 01.03.2025, 38.95 lakh in Jharkhand | 1, right file | 109 |
| Mahila Samman Savings Certificate (MSSC) Scheme (3282) | `AU3_NnZsgO.pdf` | Launched 31.03.2023; ₹1,000 minimum, ₹2 lakh maximum; two years; 7.5% p.a. compounded quarterly | 1, right file | 104 |
| Digital Personal Data Protection Act, 2023 (1339) | `AU1402_aHgXTC.pdf` | Passed 8 August 2023; assent 11 August 2023; Rules 2011 under section 43A of the IT Act, 2000 | 1, right file | 101 |

Total: 620 credits. **Every figure above is in the stored text** (read-only checks of `documents.ocr_text`). Retrieval
trace (`chat_turn_traces`): each turn's search returned chunks only from its own answer file (40, 20, 9, 7 and 7 chunks).
No chat model call failed in the window (`model_call_logs`). No wrong file, no "Record only", no figure outside the text.
The search title for record 4 is "Mahila Samman Savings Certificate (MSSC) Scheme"; the README's shorter title found nothing.

## Deviations and findings

1. **Stage 7 was first skipped** (2026-10-31): at PR #80's merge commit the shared-code guard would have refused. The developers moved the baseline in PR #88; this run used #88's merge commit and the new approval.
2. **The website session was signed out twice** because the owner signed out of nter.pro to obtain a fresh token, which ends every session. The owner signed in again for acceptance. For later runs: take the token from a private window and close it without signing out.
3. **Token handling** (owner's request, for the developers): the owner asks that one token cover a run of any length. Two options: (a) the run script takes the session's refresh token once, holds it only in memory, renews the access token before expiry and discards it at the end; (b) a server-issued, single-use ingestion grant bound to one approved manifest. Not built here; a developer decision.
4. **No retry was needed**: the importer's new retry of a lost registration answer (F274) was not exercised (`retried 0`).

## Files

- **Here:** `run/submit-1.jsonl` and `run/submit-1-status.json` (no corpus text).
- **Private copies** (Drive): `Data Handover/National/v1.1/staging/pq-lastpage-01/`, which also holds the cohort `corpus.jsonl`.
