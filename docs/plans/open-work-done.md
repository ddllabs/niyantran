# Open work: the Done archive

> **Status: Living (append-only).** Split out of [open-work.md](open-work.md) on 2026-11-26: every closed (`[x]`) item,
> the old Done sections and the record-only sections, moved unchanged. Closed items from a section that is still in
> open-work.md are under that section's name with "(closed items)". New closed items are added here with their commit
> hash. Open items stay only in open-work.md.

## Top of the list (closed items)

- [x] **F280 — Flaky SQL fixture `feature_search_recovery`.** *Fixed 2026-11-01: `1432c03d`.* "recovery matches exact oracle" failed on CI with no related change: `main` `c94f3a58` (2026-10-28) and `98e87a91` (2026-10-31), and PR #89 `d1613062` (2026-11-01). Cause, reproduced in CI's image (x86_64, pgvector 0.8.7): HNSW builds a random graph, and on 7 of 200 builds the helper's approximate pass filled all 40 results with far chunks, so recovery never ran and the oracle compared an approximate set. arm64 never filled in 240 runs. The first suspect, `halfvec` ties among the far chunks, was not the cause: spreading them out still failed 2 of 38 runs. Fix: before calling the helper, the fixture repeats its approximate pass and rebuilds the index until that pass underfills (at most 10 attempts, then a named failure); search on a fixed graph is deterministic, so recovery runs every time. Oracle ties break by id, as recovery does. Evidence: the fixture passes with its vacuity check; forcing one rebuild still passes all checks; forcing every attempt to fill fails with "approximate pass underfills". The CI-platform repeat run stopped at 13 passing runs when the local disk filled, so a fill was not observed under the new fixture.

- [x] **F290 — Registration times out at full size.** *Done: `20261106120000_admission_scans.sql` (`67e8b140`) is in NTER's migration history (read 2026-11-10), and the Bills adapter, which requires its index, is applied. 2026-11-10 (F299)* On the full-size copy a real 100-document `ingest_register_batch` call is cancelled at `corpus_ingest`'s 60 s limit. `ingest_admit_document` costs about 870 ms a National document and grows with the corpus, because it scans `documents` through `pq_answer_key()`, scans `documents` again for older pack imports by `metadata` key and `source_path` regexp (56 ms, not covered by the test indexes), and scans `desk_rows` by `source_url`, a cost the empty test table did not show. The `order by id limit 1` keeps the planner on the primary key, so an index alone is ignored, and a cost hint held only until an automatic analyze flipped the plan mid-run. A `UNION ALL` rewrite plus indexes took one lookup from 1,120 ms to 0.15 ms. Fix all three as a reviewed migration; the duplicate-text check has the same query shape. `scripts/load-proof/admission-indexes.sql` is a test-only stand-in. **2026-11-06:** migration built and proved locally ([spec](../specs/2026-11-06-admission-scans.md)): a 100-document call that was cancelled at 60 s now takes about 2 s. Not on NTER; it applies straight after batch registration, with separate approval.

- [x] **F294 — Decide the NTER disk plan.** *Decided 2026-11-11: the developer expanded the NTER disk to 40 GB (option B of the disk plan); reported by the developer, not read back from the dashboard.* *Waits on the developer. 2026-11-10 (F299)* Peak use for National v1.1 with hybrid is about 25.7 GB against a 20 GB disk. Options are in the [disk plan](../operations/2026-11-06-nter-disk-plan.md), from US$1.25 a month. The developer decides. The developer has said not to drop `document_chunks_unpartitioned` yet. 2026-11-11 (read-only on NTER, 2026-11-10 22:21 UTC): the database is 16.75 GB and WAL on disk 1.07 GB, 17.82 GB together, against the 18 GB auto-grow trigger of a 20 GB disk. The provisioned size was last read on 2026-11-05 (20 GB) and cannot be read by SQL; the dashboard shows it. Largest relations: `document_chunks_unpartitioned` 5.3 GB, the Bills partition 4.7 GB, NCLT 3.1 GB, the default partition 0.9 GB, `ingest_text_inputs` 0.66 GB. v1.4's answers (F307) would add about 4.2 GB, so the choice is needed before that load.

- [x] **F299 — Tracker sweep.** *Done 2026-11-10: all 89 open items checked read-only against code, git, docs and production; each is annotated in place with its status ("2026-11-10 (F299)"), 22 closed. The checks and evidence are in PR #127.* 2026-11-10 (F299) From the 2026-11-06 audit, not yet verified one by one. Look done: F263, editable AI personas, desk module scrolling, F109, F110, F169, F215, F160 rollout. Duplicates or superseded: F234 (P12), the F37 note, R7 continuation, P6, Law cohort-2, Law bulk follow-up, the Corpus inventory spec item. Partly stale text: F272, F274, F267, F281, F273, F202, P12. Possibly stale: production RAG acceptance, RAG citation/web acceptance, the test browser-global audit, O9, O1, L1, P8, F170, T15.

- [x] **F300 — Bill readers join by key alone.** *Merged into F314 on 2026-11-10.* `record_resolve_document_keys` and readiness find a bill's documents through `metadata.document_key`, not links, and a key has no house. 398 stored keys are held by more than one row, so a row can resolve to another bill's document. Read from the code, and shown on a local copy during the F275 review. Switch these readers to `record_document_links` after the live bills are linked. The resolver half was fixed under F314 (`20261110180000`, applied 2026-11-10); readiness and the admin functions that read `document_key` themselves stay open there.

- [x] **F303 — `run.sh` exits 0 when a fixture has no `chain()` entry.** *Fixed 2026-11-07: `57077bf0`. `run_fixture` now fails a fixture whose `chain` fails, and the fixtures after it still run; the SQL job's step "An unknown fixture fails" was shown failing on the old script and passing on the new.* Seen 2026-11-07, and the same on `main`: `chain` prints "unknown fixture" and returns 1, `run_fixture` ignores that, and the next line's unset `CONTAINER` ends the script with exit status 0. With no arguments every `.sql` file in `supabase/tests/` is run, so a new fixture file without a `chain()` entry ends the run early, skips every fixture after it, and still passes CI. The header says such a fixture "fails as unknown fixture". Make `run_fixture` return 1 when `chain` fails, and prove it with an unknown name before relying on it.

- [x] **F304 — `analytics_rate_limit` fixture fails in the first seconds after an hour.** *Fixed 2026-11-07: `6125b6f9`.* Seen on PR #108's pull-request run: the fixture started at 17:59:58 UTC, its test hits went into the hourly window starting 17:00:00, and the purge just after 18:00 found that window stale as well, so "purge removes one stale window" counted 3. The purge itself is right. The check now clears the earlier windows and ages one window two hours and one 30 minutes by hand. Shifting the hourly windows back an hour fails the old fixture with the CI error and passes the new one; vacuity still holds.

- [x] **F306 — CI does not run the bulk runner's tests.** *Fixed 2026-11-10: `051a995a`.* Found 2026-11-10 while specifying the pack reader: `.github/workflows/ci.yml` runs `deno test` on `supabase/functions` only, so the 125 tests under `scripts/bulk-runner/` (acceptance, CLI, plan, prepare, run, the `psql` Db) run only by hand. Add `deno test -A --config supabase/functions/deno.json scripts/bulk-runner` and its lint to the `Build and tests` job, and show a failing runner test fails CI before relying on it. Fixed: two steps after the Edge Function tests run the runner's tests and its lint and format check; locally a broken assertion and a mis-formatted file each fail them. One pdfjs test is skipped on a clean runner (it needs `pdfjs-dist` in Deno's cache), as it is locally without the cache.

- [x] **F308 — The runner reads a whole records file into one string.** *Fixed 2026-11-11 (`49814d75`): `split` reads the file in chunks in two passes (check, then cut) and writes part receipts only after the second pass finds the file unchanged; `plan` and `run` refuse a file over 256 MiB and point to `split`; a part over that limit is refused before anything is written ([spec](../specs/2026-11-08-runner-cli-and-acceptance.md)). Independent review: accept with changes, all applied; a 127 MB, 300,000-record file split under a 48 MB heap, parts byte-equal to the old code's.* From the pack reader review (2026-11-09): `cli.ts` `parseRecords` reads the file with one `readText`, so a records file from a large v1.5 or v1.6 entry (up to 520 MB compressed) can pass V8's string limit. Stream it, or select large entries in parts with `--limit` and `--skip-keys`.

- [x] **F309 — Nothing binds the runner's input to the reader's receipt.** *Fixed 2026-11-10: `6180a586`. `plan`, `run` and the new `split` refuse a records file whose receipt is missing, unreadable or disagrees with the text they parse; `split` replaces the hand split and writes a receipt per part. Proved on the real screened Bills file (953 records).* The runner does not read `<records>.receipt.json` or check its `output_sha256`, so a records file edited after selection would load. Check the receipt before planning.

- [x] **F310 — `checkReceiptsDir` misses the main checkout from a worktree.** *Fixed 2026-11-10: `6180a586`. `checkReceiptsDir` uses the pack reader's guard.* `cli.ts` compares receipts against its own repository root only; run from a worktree, receipts under the main checkout are accepted. Use the pack reader's guard (module root, git common dir, any ancestor with `.git`).

- [x] **F313 — The acceptance probe fails on shared first chunks.** *Fixed 2026-11-10: `875c09de`.* Found 2026-11-10: `probe` in `scripts/bulk-runner/acceptance.ts` searches with a document's first chunk, which for gazette notifications is a heading that 12 Bills documents share word for word, so a correct document can miss the top ten (`probe_not_first`, The Insolvency and Bankruptcy Code, 2016 gazette notification). Probe with a chunk whose text is not shared, or count an exact tie on identical text as a pass. The probe now sets aside a chunk whose text every higher-ranked chunk shares and tries the next, up to three; any other text ranked above the document still fails. Re-run read-only on NTER: the rescued Bills' last file now fails only on F312 (49 of 50), and the first rescued file still passes 50 of 50.

- [x] **F315 — A bill dropped into the chat is scoped by its shared key.** *Closed 2026-11-10: not a defect.* Found 2026-11-10 in the F314 review: an attachment carries `bill:<year>:<number>` (`documentKey`, `src/lib/deskRows.js`; `materializeAiDrop`, `src/lib/aiDrop.js`), and research-chat finds documents by that key directly (`supabase/functions/research-chat/index.ts`, the `metadata->>document_key` lookup), not through `record_resolve_document_keys`, so on a shared key (F314) the chat's scope takes in both bills. Send the row's `desk-record:` key when the tier and feature are known, as the selection does (`src/ai/AiPanel.jsx`). Closed after a second review, traced in code and tests: the browser never sends a chip's stored key (`requestAttachments`, `src/ai/AiPanel.jsx`, sends `recordAttachmentIdentity`, the `desk-record:` key; `AiPanel.test.jsx` asserts it for a chip holding `bill:2007:70`), and research-chat replaces every row or record attachment's key with one built from the stored row (`handler.ts`, `findDeskRow` in `index.ts` returns `recordDocumentKey`), so attachments go through `record_resolve_document_keys` and F314's rule. The `metadata->>document_key` lookup in `index.ts` is not fed a `bill:` key by any request; removing or guarding it is optional tidy-up.

- [x] **F316 — Acceptance's link check joins rows by key alone.** *Fixed 2026-11-10: `14233e86`.* Found 2026-11-10 after F314's apply: `linkKeys` in `scripts/bulk-runner/acceptance.ts` takes every listing row whose `document_key` is the document's, so on a shared key (F314) a document is checked against the other bill's row too. Re-run read-only on the rescued Bills' last file: The Bills of Lading Bill, 2025's own row now resolves `full`, but the check also counts the Constitution (130th Amendment) row, which reads `registered`, and fails `link_not_full` (49 of 50). Apply the resolver's shared-key rule in `linkKeys` (or take a document's rows from the resolver) before the next Bills acceptance. Fixed: `linkKeys` says how each row was found; a row found through `document_key` counts only when the resolver gives it this document, and an approved link always counts. Re-run read-only on NTER: the rescued Bills' last file passes 50 of 50, the first still 50 of 50, and the two indexed The Indian Institutes of Management (Amendment) Bill, 2025 documents still fail `link_not_full` on their own row (its held sibling, F312), now 1 of 1 rows instead of 2.

- [x] **F317 — Two state feeds have failed for days.** *Fixed 2026-11-10: `a409e042`. The two modules searched Google News for 7 days (the default) while their rows and note use 30; both now search 30 days, and a search that answered with titled headlines, none on topic, is recorded as nothing new (ok) instead of failed. Outages, empty or unreadable answers and untitled rows stay failures. Confirmed in production 2026-11-10, read-only: `www.nter.pro` serves `54fd5dfc` (PR #129, which includes this fix); since 18:00 UTC each feed ran 3 times, all `unchanged` ("the source listed nothing new; the kept items stand"), none failed; both `consecutive_failures` are 0, and no feed is at 3 or more (M1's condition, T15).* Found 2026-11-10 in the F299 sweep, read-only on NTER: `feed_state` shows Legislative Productivity Comparison at 255 consecutive failures (last fetch 2026-11-04) and MLA Defection & Anti-defection Case Tracker at 145 (last fetch 2026-11-07); 673 failed runs in 7 days across all feeds. M1's checkpoint (no scheduled source above 3 consecutive failures) is therefore not met (T15). Read the two sources' `last_error`, fix or retire them.

- [x] **F319 — Curated news modules search 7 days but filter and report 30.** *Fixed 2026-11-10: `b4699bf5`. A curated module without `when` now searches `newsDays(spec)`; only two modules searched less than they report (Sports Governance & Policy, Governor Friction & President's Rule Tracker), not most of them as first written.* Found 2026-11-10 in the F317 review: `newsRssUrlForFeature` (`server/featureFeed.mjs`) asks Google News for `when:7d` unless a module's spec in `src/lib/curatedNews.js` sets `when`, while the rows and the note use the 30-day `newsDays` default. Four modules set `when: '30d'`; F317 fixed two more; the rest search a quarter of the window they report. Make the search window follow `newsDays(spec)` (or set `when` per module), and check each module's note.

- [x] **F320 — A verified-empty module reads "Source offline or empty".** *Fixed 2026-11-10: `b4699bf5`. The verified-empty row reads "No on-topic stories" with readiness `empty`, and `resolveDataState` returns a new `empty` state from that flag; outages unchanged.* Found 2026-11-10 in the F317 review: when a curated news module's search answered with nothing on topic, the refresh now records ok (`meta.nothing_new`), but the page's status row (`statusRow`, `server/featureFeed.mjs`) still says the source is offline or empty, and `dataState` treats that wording as offline. Say "no on-topic stories in the last N days" for a verified-empty answer.

- [x] **F321 — Harden the runner's receipt check.** *Fixed 2026-11-11 (`2349e0ad`): the count, the reader's fields or a named part's source, the hash over raw bytes with a fatal UTF-8 decode and no byte-order mark, and `receipt_missing` only when not found ([spec](../specs/2026-11-08-runner-cli-and-acceptance.md)). Not built: requiring `screened.jsonl` for a collection that has a screen. From its review, fixed 2026-11-11 (`5b55097f`): `screen.ts` reported any receipt read error as missing, and `pack.ts` kept a line that starts with a byte-order mark, which the runner refuses.* From the F309 review (2026-11-10): a hand-written receipt with the right hash is accepted (receipts are not signed), so also require `lines_written` to equal the parsed record count and, for reader receipts, `pack`, `entry` and `manifest_sha256` (as `screen.ts` does); hash the raw bytes and decode with a fatal UTF-8 decoder, refusing a leading byte-order mark (today invalid bytes hash as their replacement character); report `receipt_missing` only for a file that is not found; consider requiring `screened.jsonl` for a collection that has a screen.

- [x] **F329 — Source titles and features reach the model unflattened.** Found 2026-11-12 while specifying bill metadata in the chat (read from code, not tested): `renderChunk` in `supabase/functions/research-chat/agent.ts` prints a passage's title and feature without removing line breaks or control characters, so a document title from a pack could carry text shaped like an instruction or a source handle. Sanitise them as the proposed metadata line is. *Fixed 2026-11-12 with F331 (`21e050cb`): titles and features are printed on one line; line breaks, control and format characters become a space, except the two joiners Indic scripts need. Takes effect when `research-chat` is deployed. Live since 2026-11-12 in `research-chat` v112 ([record](../operations/2026-11-13-release.md)); read again on NTER 2026-11-15.*

- [x] **F344 — Live TV fact-check: live transcript and claim verdicts.** *Slice 1 (pull request 151, `a9361450`) and the re-check of one verdict (pull request 154, `1684fc9e`) merged 2026-11-16. Migrations `20261116090000`, `20261116100000` and `20261116110000` applied on NTER 2026-11-16 11:19 to 11:20 UTC through `supabase db query --linked -f` (the method of the 2026-11-09 hybrid apply), history rows written by hand; the scheduled jobs `factcheck-settle-expired` and `factcheck-recheck-collect` each ran and succeeded. A first attempt wrote three malformed history rows and applied nothing; those rows were removed before the real apply. Function `factcheck` version 1 deployed 2026-11-16 from main `1684fc9e`; called from outside it refuses a request with no token (401), a malformed token (401), a foreign origin (403) and a GET (405). Flag row `livetv_factcheck` created 2026-11-16 11:50 UTC: admin accounts only, 500 credits a minute, re-check 100 credits. Slice 2 (shared results and paid unlock on recorded videos) built and reviewed 2026-11-16 on `task/f344-sharing` ([plan](2026-11-16-f344-sharing.md)): one correctness review, one security audit and a second security pass, all findings applied. Merged 2026-11-17, pull request 157, `bf2dfcc9`. Migration `20261117090000_factcheck_sharing.sql` applied on NTER 2026-11-17 (about 14:10 UTC) and recorded in the migration history; function `factcheck` redeployed the same day as version 3 from main `858c9d33`; `LIVETV_API_BASE` set to the app's public origin. Sharing stays off: flag keys `share_recorded` and `unlock_credits_per_minute` are not set, and will stay unset until the owner's first live admin session. Remaining: no real session or re-check has run; the owner's first live admin session is the first proof of the audio path, the verdict sources, the cost per minute, the usage screens and the positions on a recorded video; the owner confirms the sharing decisions; not built: re-analyze a block, a past-sessions view, an admin screen for reports; the owner accepts worst-case spend before the audience is set to "all".* Owner brief 2026-11-15: a paid, opt-in button on the Live TV player opens a right-hand panel with a live transcript in the spoken language and a verdict on every checkable claim. Twenty-seven decisions were locked with the owner the same day and are in the [spec](../specs/2026-11-15-live-tv-fact-check.md); the audio route and its policy risk are in [ADR 0015](../decisions/0015-live-tv-fact-check-audio-capture.md). Gate G1 passed on Chrome by automation (a manual run is still owed); version 1 transcribes in 10-second pieces with `elevenlabs/scribe-v2` through OpenRouter (G2a); cost measured at about US$0.04 to 0.05 a minute (G2b). Built in three slices behind an admin-only flag; [slice 1 plan](2026-11-15-f344-live-tv-fact-check-slice-1.md). Slice 1 (database, server function, browser capture, panel) is committed on the branch with independent reviews and a security audit; a real session has not been run. Branch `task/f344-livetv-fact-check`. Owner decisions later on 2026-11-15: transcripts stored for recorded videos, unlock 100 credits a minute, re-check 100 credits; [slice 2 plan](2026-11-15-f344-live-tv-fact-check-slice-2.md); the re-check of one verdict is built on `task/f344-recheck` ([plan](2026-11-16-f344-recheck.md)), not merged. Opened to everyone 2026-11-19 on the owner's named go, Free plan included, before the owner's real session on the new page (the owner will run that check afterwards): the flag row `livetv_factcheck` on NTER had `audience` set from `admin` to `all` at 01:08 UTC; nothing else in the row changed (500 credits a minute, re-check 100). Executed: `private.factcheck_flag()` returns audience `all`; a signed-in account that is not an administrator reads the flag row; `private.factcheck_share_flag()` is still null, so sharing of recorded results stays off. Read, not executed: no plan check exists on the path, only the credit hold, so an account without enough credits is refused with `insufficient`. Not verified: a session started by an account that is not an administrator. To go back: set `audience` to `admin` in the same row. Sharing of recorded results switched on 2026-11-19 on the owner's named go, also before the owner's real session: at 09:26 UTC the same flag row gained `share_recorded` true and `unlock_credits_per_minute` 100; nothing else changed. Executed: `private.factcheck_share_flag()` returns audience `all` and unlock price 100; `public.factcheck_share_on(false)` returns true; an account that is not an administrator reads the two new keys; the Live TV page on the live site loads after the change and offers Fact-check at 500 credits a minute. No recorded-video session exists yet (0 of 13 sessions), so nothing is shared and no unlock has happened. Not verified: a recorded-video session with sharing on, an unlock, a report, and re-analyze a block (F363) on a real video. To go back: remove the two keys from the row. Closed 2026-11-19: every planned part is built and released, the audience is everyone and sharing is on. Evidence 2026-11-19 (executed, read-only on NTER): four real one-minute sessions ran after the feature was opened, three by an account with no earlier session on the old layout and one by an earlier account on the new layout; all four settled and charged 500 credits; the model-call log holds 67 fact-check calls for them (28 transcription, 16 extraction, 23 checks), every one a success, none `unusable`, US$0.17 in all. What still needs a person is listed once, in F375.

- [x] **F347 — Usage activity list does not show fact-check charges.** *Merged 2026-11-16 (pull request 153, `325c7c68`) and applied on NTER the same day with F344's migrations; the three report functions answered for a real account inside a rolled-back transaction. Remaining: the screens seen with a real fact-check charge.* Found 2026-11-15 in the design review for F344 (read from code, not executed): a fact-check charge is an ordinary ledger charge, so it is right in the balance, in `my_credits` and in usage totals, but `my_usage_activity` is driven by `research_turns` and will not list it, and `my_credits.recent` shows it with no title. Slice 1 is admin-only, so this is deferred; fix before the feature opens to all plans. Closed 2026-11-19: built and applied; the one thing left, seeing the usage screens with a real charge, is in F375.

- [x] **F349 — Live TV fact-check: verdicts fail or time out and the panel shows stale state.** The owner reported this on 2026-11-17 after the first live admin sessions: at the time of reading there were 3 sessions and 28 claims on NTER, of which 17 were checked, 4 errored and 7 were not checkable. A check sometimes timed out and the claim showed as failed until "Run again" was pressed. After closing and reopening the panel, the same claim sometimes showed a different state (failed, or not searched first and then Supported), which suggests the stored result is right and the panel does not refresh. The owner also saw a connection drop during checking. Traced 2026-11-17 ([note](../research/2026-11-17-f349-fact-check-first-sessions.md)): no timeout and no provider failure in the data (133 requests answered in at most 7.5 s); one claim was stored as `error` four times although the provider answered (the reply was rejected by the verdict rules; which rule is not established); the only session the server ended followed a second page ending it; the other sessions ended from the browser side; the two browser test runs could not start a capture. A longer time limit would not change any of it. The owner decided on 2026-11-17 that a verdict with no source is shown as "No sources found", with no "Check again"; "End that session" stays, and the other page explains the ending; no paid replay. The fixes are in the [fix plan](2026-11-17-f349-fact-check-fixes.md). They were built, reviewed and merged on 2026-11-17 in pull request 162 (`ac4a7726`, which carried pull request 161 with the findings and plan): a rejected check records why (`fail_reason`: `no_label`, `bad_label`, `label_conflict`, `no_sources`), stored on the claim and logged without the reply text; the browser sends an end reason with `stop`; the session-level button reads "Start a new session" with the price; capture errors say what to do and that nothing was charged; the panel keeps one height and keeps its actions visible. Migration `20261118090000_factcheck_fail_reason.sql` was applied on NTER on 2026-11-17 at about 17:35 UTC and recorded in the migration history (43 existing claims unchanged). Function `factcheck` version 4 was deployed the same minute from `main` at `ac4a7726`. From outside it refuses a GET (405), no token (401), a malformed token (401) and a foreign origin (403). Proof by real sessions, 2026-11-17 (executed; the supervisor ran both in the owner's Chrome on the live site, the owner accepting Chrome's sharing prompt, 5 minutes each): session 1 (22:25:31 to 22:30:48 UTC) ran on a stale page loaded before these browser fixes, still showing "Run again", against function version 4; session 2 (22:32:28 to 22:37:53 UTC) ran after a reload, with the page confirmed to carry the new code. Both settled, charged 2,500 credits each, and left no active session. Session 2 showed the start button that unmutes, a panel of fixed height (603 to 640 px) during and after the session, the end screen ("Time is up.", the charge, the new balance, "Start a new session" with its price, and "Close", kept in view), and "Check failed" on failed checks. Six of 42 check calls in the two sessions were stored as `error` with `fail_reason` `no_label`: the reply had no LABEL line. That is the cause of the failed checks, and it is now tracked as F351. The timeout and provider-failure hypotheses stay refuted. Still open: the "No sources found" state, which no real session has shown; closing and reopening the panel during a session, which was not tested and is one of the symptoms the owner reported; the panel height, which changed from 603 px while running to 640 px after the end, so the one-height fix is not confirmed (the same range was in the 5-minute session, see the F349 plan); and the failed checks, which move to F351. The owner confirmed on 2026-11-17 that Live TV was open in two tabs or windows at about 14:52 UTC, so the cause of the server-ended session is confirmed. Traced 2026-11-18 (read from code; the five related test files run, 253 tests pass): no defect found in the two leftovers. Height: the panel has one height rule, `min(640px, calc(90vh - 152px))` (`src/shell/factcheck/factCheck.css`), with no state selector, so it follows the window and not the content; 603 px and 640 px fit a window that grew by about 41 px when capture stopped (the browser's sharing bar going away; the window height was not measured). Reopening: the panel shows what the page holds in memory and reads no claims back from the server; closing Live TV stops the session and lets checks in flight finish for up to 100 s, so cards that read "Checking…" on reopening and then turn into verdicts are real progress; reopening during that finishing period has no test. The Live TV page ([spec](../specs/2026-11-18-live-tv-page.md), F359) gives the panel the height of the page column and removes closing by accident; a test for reopening while finishing is part of it. Closed 2026-11-19: the fixes are released and no check failed or timed out in the sessions since. Evidence 2026-11-19 (executed, read-only on NTER): four real one-minute sessions ran after the feature was opened, three by an account with no earlier session on the old layout and one by an earlier account on the new layout; all four settled and charged 500 credits; the model-call log holds 67 fact-check calls for them (28 transcription, 16 extraction, 23 checks), every one a success, none `unusable`, US$0.17 in all.

- [x] **F350 — Live TV fact-check: more session lengths.** The owner asked on 2026-11-17 for session lengths of 1, 2, 5, 10, 15, 20 and 30 minutes; today only 5, 10 and 15 are offered. Open decision for the owner: the credit hold and the per-session spend bounds grow with the length (a 30-minute block holds 15,000 credits at 500 a minute), so the longer blocks need the owner's acceptance of the larger hold and worst-case spend. The 1 and 2 minute lengths need a check that the minimum charge and the extraction cadence still make sense. Spec and plan written 2026-11-17 ([spec](../specs/2026-11-17-f350-shorter-pieces-and-session-lengths.md), [plan](2026-11-17-f350-shorter-pieces-and-session-lengths.md)); The owner agreed on 2026-11-17 to 1, 2, 5, 10 and 15 minutes; 20 and 30 minutes are held until the F349 fixes are proven. Shorter audio pieces (about 5 or 7 seconds) were tested on four recorded clips the same day (gate G1, executed) and both failed the accuracy rule fixed in advance, so the piece length stays at about 10 seconds and the transcript does not get faster from this item. Released 2026-11-17 (executed): the five lengths and a steady "Listening…" line. Pull request 167 (server) merged as `bdad3eef`; before the migration the live rule was read (`IN (5, 10, 15)`, no session active); migration `20261119090000_factcheck_session_lengths.sql` applied by `supabase db query --linked -f` and verified (rule now lists 1, 2, 5, 10 and 15; settings and SECURITY DEFINER unchanged; service role may execute, anon and authenticated may not); history row written by hand; function `factcheck` version 5 deployed from `bdad3eef`; outside checks refused as before (GET 405, no token 401, bad token 401, foreign origin 403). Pull request 168 (browser) merged as `c76e0b58`, with main CI and the production deployment passing. Pull request 166 (spec and plan) merged as `246e934e`. On the live site the length choice shows five options with 5 minutes selected, and 1 minute changes the start button to "Start 1 minute · 500 credits". A real 1-minute session ran on 2026-11-17 (executed, after a page reload, the owner accepting the sharing prompt): the start button read "Unmute and start 1 minute · 500 credits", 500 credits were held and then charged, and the session settled with no session left active. The "Listening…" line showed under the last transcript line while running and was gone after the end. Still open: a real 2-minute session. Two earlier attempts at a 1-minute session stopped because Chrome's sharing prompt was not accepted; the panel showed "Your browser did not allow tab sharing", and no session row was created or charged (checked on the server). Whether such an attempt should count towards "failed twice in a row" is open: the code counts `blocked` and `failed` and not `denied` ([capture.js](../../src/lib/factcheck/capture.js) lines 37 to 43; [controller](../../src/shell/factcheck/factCheckController.js) lines 55 to 56), and the panel's wording is the `blocked` text ([factCheckText.js](../../src/shell/factcheck/factCheckText.js) line 169). The cause is not established. The F349 plan has no wording on this count; the design is in those code comments and tests. Stays open, not Done: the 2-minute length is part of what was released and has not run (release step 7); 20 and 30 minutes are held by the owner's decision; and the faster-transcript routes were the owner's original request and are not part of this item's delivered scope. A second 1-minute session exists in the live database (started 23:30:40 UTC, 1 minute used, 500 credits charged); the supervisor did not start it and it was not part of this test. After that, by the owner's agreement the same day: Live TV as a page of its own in place of the pop-up (own spec), then sharing switched on, then a streaming transcription test when a key is available. Correction 2026-11-18 (read from code, and the existing tests run): a declined prompt (`NotAllowedError`) has its own text, "Sharing was declined. Nothing was charged.", and does not count; the text those two attempts showed, "Your browser did not allow tab sharing", is the `blocked` text, so Chrome raised a different error (which one was not captured) and both attempts did count towards "failed twice in a row". The code is consistent; the sentence above that treats them as declined prompts is wrong. Not established: which error Chrome raises when the prompt is left unanswered by automation. Closed 2026-11-19: seven session lengths are live (F361); the streaming transcription test stays parked until the owner supplies a provider key (plan 2026-11-19-live-tv-phase-2.md).

- [x] **F265 — Production ran corpus code that was not on `main`.** *Done 2026-10-28: PR #70 (`498152f3`) carries National admission on `main`; migration `pq_admission_links` applied (NTER `20261028185850`); `admin-ingest` v10 and `ingest-worker` v7 deployed from `main` and equal to it file for file. The orphan NTER history row `20261027110836` stays as a recorded difference. [Release evidence](../operations/2026-10-29-f266-release.md).*

- [x] **F266 — Records first for Parliamentary questions.** *Done 2026-10-28/29 ([spec](../specs/2026-10-28-parliamentary-records-first.md), [release evidence](../operations/2026-10-29-f266-release.md)): Lok Sabha answers are admitted only with their listing links (PR #70, `498152f3`); 1,207 links backfilled for 1,116 documents (6,845 links; all 5,865 client documents linked); question ids pinned by a CI test and a loader guard, linked rows change only through the reviewed refresh, Session and Has answer from the answer URL (PR #72, `60f453f1`; refresh and load run on NTER; 6,845 of 6,845 links bound).*

- [x] **F267 — Client corpus inventory.** *Closed: the cohorts landed (`82321da5`, `fb410a49`); the rest of v1.1 is F278's, the 157 held answers and the 82 September imports the owner keeps held are F307's. 2026-11-10 (F299)* *2026-10-28: the 6 failed jobs re-run and indexed; the 1,116 linked under F266; the 82 question documents imported 2026-09-21 stay held, unlinked (owner: keep, not retire). 2026-10-29: the client agent's receipts for batches 2–6, its production-change list and a live reconciliation arrived as a single-file handoff (branch `task/client-corpus-claude-2026-10-29`). Website acceptance of batches 1–6 passed 2026-10-29 (one answer per batch, [evidence](../operations/2026-10-29-f266-release.md)). The branch was pushed and reviewed (`5dba5f66`, then `4316929c` after fixes) and carried to `main` (PR #77). 2026-10-29/30: validation cohort 1 approved by the owner and run (100 documents, 829 chunks, 114 links, US$0.0036; `verify.sql` re-run by the developer and equal); the resume after F274's 503 was a hand-typed notebook cell, accepted once. Website acceptance passed 2026-10-30, done by the developer on the default model: five records, each citing only its own answer, every checked figure in the stored text. 2026-10-31: the remainder cohort's run-script fixes reviewed at `88c18a3d` (run script sha256 `c545a41c2c8aa8e99fce89650cb7aef1b94cb4008cd2b7f1587a952026844327`; the developer re-ran all five offline suites, 3/11/6/9/16 tests, and confirmed `scripts/`, `supabase/`, `src/`, `api/`, `server/` byte-identical to `e1584346`) and carried to `main` with this entry. Next: the owner's approval of the remainder cohort (523, manifest `8b1ac8f3…`), one run from the merge commit, receipt and website acceptance; the client agent then prepares the `last_page_empty` proposal (121) and the read-only v1.2 report (B0) for one combined review. 2026-10-31: both prepared at `78219056` and reviewed by the developer: the `last_page_empty` cohort is 113 answers (8 held, one of them `AU1350_hVpwRk` at 290 chunks over the 256-chunk rule), manifest `17315259a79bc4987a0e2b49a5dfed089394df62c32b79c83b0d005ebf0c1005`, 1,390 chunks, ceiling US$0.09, run script sha256 `60e0bf78e5bc7a157b43611a5214d0918a682b25318a022bce9552a5b7e1c262` (only constants and three prepare-call lines differ from the remainder script; the empty trailing page is a zero-length span, which `suppliedText.ts` and `document_pages_span` accept); all seven offline suites pass. B0 (`docs/operations/national-v1.2/b0-report.md`): 13,031 records, of which 10,492 candidate affidavits (personal data, about 617k chunks), 1,819 replacement texts (would delete 42,920 live chunks), 565 MP profiles, 155 bill patches and recoveries; its seven decisions are added to F275. `scripts/record-mapping-inventory.sql` now exports the unlinked set on demand.* 2026-10-31: remainder cohort (523) integrated from the client branch (`82321da5`). Receipt complete; website acceptance 5/5. The developer re-ran `verify.sql` read-only and every value equals the header (fingerprint `b83f8cf9…`); `analyze` run on the three corpus tables afterwards. The receipt's finding 8 is a citation repair declined by the server (F273), not a side call. The last-page cohort (113) has not started; every pre-approval condition is now met. The owner's Gmail address in two receipts was redacted; the cohort-1 copy remains in public git history. 2026-11-01: the client agent correctly refused to launch the 113 from PR #80's merge (`98e87a91`). That merge carried two billing test fixtures, so `supabase/` differed from the run script's baseline `e1584346`; nothing was sent. The developer review had missed it. The run script's baseline is moved to main at PR #87 (`e5275e70`), which includes the importer retry; the manifest is unchanged. New run script sha256 `aa94cb55…`. It needs the owner's new approval, launched from this change's merge commit, with no other `scripts/` or `supabase/` merge in between. 2026-11-01: last-page cohort (113) integrated (`fb410a49`). It launched from `ea34b555`, ran in one pass with exit 0 (no retry or resume), and website acceptance passed 5/5. The developer re-ran `verify.sql` read-only and every value equals the header (fingerprint `c5ccfbbd…`, US$0.0064). Lok Sabha v1.1 now holds 6,683 of 6,840 answers; 157 stay held. The rest of v1.1 (Bills, corrigenda, regulatory, cabinet, budget, transfer orders, industry, MP profiles) waits for developer-built adapters (F278). The owner asked that one token cover a whole run; the agent proposed keeping a renewal token in Colab memory, or a manifest-bound grant. It is tracked under F278: no long-lived credential in a client notebook.

- [x] **F270 — Listing rows show Record only before their coverage is checked.** *Done 2026-10-29: PR #74 (`41839f07`): an unchecked or re-checking record shows a neutral "…" (Checking) indicator in listings, chips and the question panel; a failed lookup, or no client, still reads Record only.*

- [x] **F269 — Ingestion rules after the 2026-10-28 review.** *Adopted 2026-10-29 (owner: "go ahead for all recommendations"): written into the client handoff as "Rules for every ingestion run" — owner the only approver; no autopilot; 100-document validation cohort then 1,000; stated chunk and spend limits; a receipt and website acceptance per cohort; shared code, migrations, deploys and record changes only through reviewed PRs; no stored admin password.*

- [x] **F263 — Make feature-search recovery fixture prove the recovery branch.** *Closed: duplicate of F280, fixed in `1432c03d`. 2026-11-10 (F299)* Docs-only PR #65 CI 40594375279 failed `recovery matches exact oracle`, while parallel same-head run 40594341876 passed. Read-only EXPLAIN confirms the oracle uses an exact full-vector sort; the helper may legitimately return a full approximate result without recovery. The fixture does not prove branch entry. First 80 synthetic far vectors have 80 full-precision distances but one halfvec distance, supporting (not reproducing) nondeterministic ANN selection. Diagnose and make the fixture deterministic with causal evidence; do not change production retrieval or weaken scope/recall checks merely to turn CI green. F261 runtime passed its own branch, PR and main CI.

- [x] **F262 — Empty unsent chat appears as a deletion confirmation in History.** *Fixed 2026-11-10: `89b4ab72`. The pending-delete state used `''` for none, the id of a new unsent chat; none is now `null` in `AiPanel.jsx` and in the focus hook `usePanelPopovers.js`, where `''` is a real id. A Delete on the unsent chat still asks; tests fail on the old code.* During F261 live acceptance, opening History from New research displayed “Delete New research and its 0 messages?” without selecting Delete. Cancelled; no deletion. Investigate empty chat identity versus the pendingDelete sentinel in AiPanel before a scoped fix; preserve real deletion confirmation. Separate from corpus/display readiness. [Observation](../operations/2026-10-28-f261-release.md).

- [x] **Editable AI personas — 2026-10-27.** *Done: PR #60 (`23f73a46`) and PR #61 (`1ee5b800`); see the Done entry for the published personas. 2026-11-10 (F299)* Owner approved implementation: server drafts, current-text tests, publish/rollback and account-restricted production pilot. Customer activation requires separate approval. [Spec](../specs/2026-10-27-admin-persona-prompts.md), [plan](2026-10-27-admin-persona-prompts.md). Branch task/admin-persona-prompts; deployed baseline and owner identity must be verified before pilot activation.

- [x] **Law cohort-2 and cohort screener — 2026-10-23 (PR #13 merged e651b7f0).** *Closed: the cohort and screener landed (`e651b7f0`); the larger NCLT cohort it led to waits with Law under F318. 2026-11-10 (F299)* Owner-authorized (`owner-authorized-20261023-law-cohort-2`) ingestion of five IBBI NCLT orders is done on NTER: 286 chunks, manifest `79760ace…`, zero OCR, USD 0.00127518, duplicate-safe rerun, ANALYZE; [evidence](../operations/law-cohort-2-release/results.json). New offline screener `scripts/law-cohort-screen.py` ([guide](../operations/supplied-text-import.md#preparing-a-bounded-cohort-with-the-screener)). Review of `09e6db24` found three defects — unverified policy hashes still finalized, repeated ZIP entries skipped, `--no-scan-subtree` screens finalized — fixed with red-first regression tests, now in CI. Schema-3 repair `91254514` merged after independent review and required CI; [explanation](../operations/law-cohort-screen-review-fix.md). Open: natural-language retrieval check with fresh query embeddings and the website answer flow (only stored-vector lookup was verified). Before any larger batch or autopilot: current-database reconciliation in screening, durable batch checkpoints, explicit supported-collection and policy boundaries, document/chunk/spend limits; then a bounded larger NCLT cohort with owner approval, not unrestricted legal-pack ingestion. The five cohort-2 documents need no re-ingestion.

- [x] **Law bulk ingestion follow-up — 2026-10-23.** *Closed: superseded; the follow-up landed (`ff13a953`) and bulk work continues under F278. 2026-11-10 (F299)* Owner authorized implementation, reusing existing ingestion. [Plan/evidence](2026-10-23-supplied-text-connection.md), [client guide](../operations/supplied-text-import.md). Local connector, authenticated registration, immutable input migration, existing-queue/index-loop integration and no-OCR tests implemented; local verification passed: 6,555 app / 1,199 Deno / 7 client tests, all 56 disposable SQL fixtures, lint/build and negative controls. Released via PR#11/main `ff13a953`; connector migration and three Edge Functions deployed. Authorized five-source pilot passed with 5 indexed documents/241 chunks, zero OCR and duplicate-safe rerun. Full package-policy decision generation, relationship/feature adapters, sensitive serving enforcement, PDF/box integration, capacity qualification and broader rollout remain open. Existing National checkpoint unchanged.

- [x] **R7 continuation — 2026-10-23, owner authorized.** *Closed: superseded by the bulk pipeline; Bills are loaded (F307, `39faf8ae`); what remains is tracked under F275, F311, F312 and F314. 2026-11-10 (F299)* Resume pending National bill ingestion targeting 1,000 distinct bill identities per review cohort, using existing bounded sequential stages (at most 500 documents each). Fresh baseline: 3,379 documents / 3,376 indexed / 99,225 chunks / 2,134 of 9,415 bill keys covered. First 1,000-bill cohort screened; 395 documents / 7,368 expected chunks frozen; all 395 no-write endpoint checks passed and the supervised run started, with 605 held or awaiting review. Latest checkpoint audited: 80 documents / 1,491 chunks / 80 new covered bills; current totals 3,459 documents / 3,456 indexed / 100,716 chunks / 2,214 covered keys. 315 staged sources remain. Execution is held after a recurring pre-write fetch failure; exactly 80 paid attempts, 80 verified sources and no in-flight entry. All 395 source hashes and pricing passed subsequent read-only checks, but the transient cause remains unconfirmed. Resolve request-specific transport diagnostics before another recovery; preserve the frozen manifest and receipts. [Current evidence](../research/2026-10-23-national-corpus-continuation.md). Preserve all prior completed manifests and holds; Law, existing-source replacements and deployment remain excluded. [Spec](../specs/2026-10-23-national-corpus-continuation.md), [plan](2026-10-23-national-corpus-continuation.md). This supersedes the parked status only for this National continuation.

- [x] **Production RAG acceptance (2026-10-19).** *Closed: superseded by the later signed-in live acceptances recorded under F251, F253 and F256. 2026-11-10 (F299)* Implementation shipped on main
  8f72418 (clock-test prerequisite7a10c32), Vercel Production READY/exact commit,
  research-chat v68 exact36-file bundle and unauthenticated401 verified. Local
  6292 application and1158 Deno tests,lint/build/bundle/router pass. CI39258763690
  app+SQL fully green. Arc now shows vs/3304 credits and research history; owner needs
  existing conversation Reload and signed-in normal turn acceptance. Saved answer
  complete3191chars, charge880.688 retained; network closure cause unproven.
  No balance/schema/payment/corpus changes. Spec/plan2026-10-19-rag-production-recovery.

- [x] **F410 — Storage usage and quota of any user readable by id.** *Done 2026-11-26: merged in PR #235 (`69074ae4`) and applied to NTER the same day with the developer's go-ahead. Applied from a cloud session that had no connection string, so not by `psql` (the developer chose this route) and not by `apply_migration`: the file's `DO` block, unchanged, ran as `postgres` through the Supabase connection's SQL runner, and the history row was inserted by hand under `20261126090000` (113 rows). Checked before: no history row, and both live functions byte-identical to the fixture's stand-in. Checked after: both definitions hash the same as the tested migration produces on a local database; ACL `{postgres, authenticated, service_role}`; anon cannot execute either; the security advisor no longer reports lint 0028. Lint 0029 still lists both for `authenticated`, as intended: the bodies limit each caller to its own figures.* Found in the 2026-11-25 review (read-only on NTER): `user_storage_used_bytes(uuid)` and `user_storage_quota_bytes(uuid)` are SECURITY DEFINER and executable by anon and PUBLIC (advisor lint 0028). `used_bytes` checks the owner only when `auth.uid()` is set, so a signed-out caller reads any user's usage by id; `quota_bytes` checks no owner, so any caller reads any user's quota and plan. The two are part of the file-manager schema, which is on NTER from a dashboard paste, in no migration on `main` and not otherwise tracked here; adopting it into `main` or removing it waits on the developer's decision. Built: migration `20261126090000_user_storage_own_user` (a no-op where the functions are absent) revokes anon and PUBLIC and makes both bodies refuse another user's id for any end-user request; fixture `user_storage_own_user` (16 assertions, vacuity and three mutations shown failing). Spec: [2026-11-26-user-storage-own-user](../specs/2026-11-26-user-storage-own-user.md). Remaining: the apply by `psql` with the history row by hand, then the advisor check.

- [x] **F411 — The file-manager schema is on NTER but not in main.** *Done 2026-11-26: merged in PR #240 (`d5e8fce1`) and recorded on NTER the same day with the developer's go-ahead. Before: NTER's catalog fingerprint read again, read-only, and still equal to the capture the fixture compares with (178 lines, md5 `1bca21d8…`); no history row under `20261126150000`; the file on `main` byte-identical to the one CI tested (sha256 `ced4a78e…`). Then the history row was inserted by hand under `20261126150000` (114 rows); nothing else was run, since NTER already had the whole schema. Open from this item: F412, F413, and the contributor's branch dropping its own migration files when it is brought up to date with `main`.* Found in the 2026-11-25 review: the private file-manager schema (four `user_*` tables, the `user-files` bucket and its policies, 15 functions, three `ingest_settings` columns) was applied to NTER from the file-manager branch's dashboard SQL and changed there, with no migration on `main` and no history row; no file on the branch reproduces NTER (five functions exist only on NTER). Built: migration `20261126150000_file_manager_schema`, NTER's catalog as read on 2026-11-26 after F410, and fixture `file_manager_schema`, which compares a 178-line catalog fingerprint with NTER's and checks owner isolation, anon refusal and the bucket's folder rule (vacuity and five mutations shown failing). Spec: [2026-11-26-file-manager-schema-adoption](../specs/2026-11-26-file-manager-schema-adoption.md). Remaining: a read-only check that NTER still matches, then the history row by hand under `20261126150000`; and the contributor's branch must drop its own migration files when it is brought up to date with `main` (the developer tells the contributor). The branch's tracker number F341 is taken on `main`; this is F411.

- [x] **F412 — File-manager grants are wider than they need to be.** *Done 2026-11-27: merged in PR #243 (`1682de1c`) and applied to NTER the same day with the developer's go-ahead, by the route used for F410 (the Supabase connector's SQL, as `postgres`; this session has no connection string). Before: NTER's file-manager grants read again, read-only, and still equal to F411's capture (30 lines, md5 `6e36ed20…`); no history row under `20261126180000`; the file on `main` byte-identical to the one CI tested (sha256 `70291de2…`). Then the file's statements ran unchanged in one transaction (its header comments left out), its self-check passed, and the history row was inserted by hand under `20261126180000` (116 rows). After: the grants equal the fixture's 25 lines (md5 `24109542…`); anon holds no privilege of any kind on the four tables or the job sequence (MAINTAIN included); `has_table_privilege('anon','public.user_files','select')` and `has_function_privilege('anon','public.user_files_empty_trash()','execute')` are both false; the security advisor lists no file-manager object that anon can reach.* *Built 2026-11-26 on `task/f412-file-manager-grants`.* From F411: anon holds every table privilege on `user_folders`, `user_files`, `user_file_chunks` and `user_file_jobs` and the job sequence's privileges, and seven SECURITY INVOKER file-manager functions are executable by PUBLIC and anon (first written as eight; NTER's catalog has seven). Row-level security has no anon policy, so anon reads and writes no rows today. Built: migration `20261126180000_file_manager_grants` revokes all of anon's privileges on the four tables and the sequence, and execute on the seven functions from PUBLIC and anon, with a self-check; fixture `file_manager_grants` compares the 25 resulting grant lines and checks anon's refusal and the signed-in user's access (vacuity and three mutations shown failing). Spec: [2026-11-26-file-manager-grants](../specs/2026-11-26-file-manager-grants.md). Remaining: a read-only check that NTER's grants still match F411's capture, then the migration by psql with its history row by hand under `20261126180000`. Left as is: authenticated's TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on the four tables (the Data API cannot issue them).

- [x] **F413 — The file-manager credit functions bill twice and charge after a cancel.** *Done 2026-11-27: reviewed in PR #246 (`85e0cab3`), fixed in PR #248 (`e0966466`) and applied to NTER the same day with the developer's go-ahead, by the route used for F410 and F412 (the Supabase connector's SQL, as `postgres`). Before: the four functions on NTER still equal to F411's capture (md5 `f0d1ec95…`, `5e443ed0…`, `077459c3…`, `bb84e124…`); `user_file_jobs` empty, no duplicate active jobs, no `settled_attempt` column, no `user_file_jobs_one_active_per_file` index, no history row under `20261127100000`; the file on `main` byte-identical to the one CI tested (sha256 `36f4f97f…`). Then the file's statements ran unchanged in one transaction (header comments left out), its self-check passed, and the history row was inserted by hand under `20261127100000` (117 rows). After: the four functions, the index and the column equal a local build of `main` (md5 `f0a72604…`, `f4a2a8f6…`, `0464d9ae…`, `e00e46f0…`; index `7a844e19…`); grants unchanged; the `file_indexing_billing` flag still absent (off). Open from this item: F415 (the hold lapsing on a long job, and the Cancel button shown for running jobs).* From F411: `user_file_enqueue_indexing`, `user_file_job_cancel`, `user_file_job_retry` and `user_file_settle_credits` hold or settle credits and are adopted as they run on NTER, gated by the `file_indexing_billing` flag. On NTER the flag row is absent and there are no file jobs, holds or ledger rows, so nobody has been billed. Review: [2026-11-27-f413-file-manager-credit-review](../research/2026-11-27-f413-file-manager-credit-review.md). Reproduced on a throwaway database with NTER's function text: (1) two concurrent `enqueue` calls for one file create two jobs and two holds, so the file is indexed and billed twice (no unique index on active jobs per file; the check runs before any lock); (2) `settle` is idempotent only for completed jobs charged above 0, so a repeated settle of a failed job charges again (two charges, 190 credits, for a job showing 95); (3) `advance` and `settle` ignore `cancelled`, so a cancelled job is charged in full and flipped to `completed` after its hold was released; (4) the job row keeps only the last charge (100 shown, 290 in the ledger). From reading: (5) `retry` leaves the hold's `swept_at` and `inr_per_credit` as they were; (6) a hold lasts 30 minutes while a job can run longer, so the user can overspend into debt. Decided (developer, 2026-11-27): a started job runs to the end and is billed, so cancel is allowed only while a job is queued; the double charges are defects. Built: migration `20261127100000_file_manager_credit_fixes` (one active job per file by a unique index; settle once per attempt; the job row adds each charge; retry re-arms the hold at the current rate with no sweep mark; cancel refuses a running job with `job_running`) and fixture `file_manager_credit_fixes` (without the migration, checks 1a, 1b, 2a, 3a, 4 and 5 each fail on their defect; a two-session race on a migrated database leaves one job). Spec: [2026-11-27-file-manager-credit-fixes](../specs/2026-11-27-file-manager-credit-fixes.md). The flag may be turned on now that the fix is applied; finding 6 and the Cancel button are F415.

## Frontend follow-up (closed items)

- [x] **F406 — Two duplicate bills in the bundled register; two MPs share a row key.** *Done: merged in PR #220 (`3f883eec`), and the NTER `desk_rows` reload has run (read 2026-11-26: MP Profiles 782 rows, two of them `rs-` keys; Bill Passage Probability Index 9,817 rows; both loaded 2026-11-22 02:27 UTC). Fixed in the working tree 2026-11-21 (developer: "fix everything and merge").* (1) `national_bill_tracker.json` held 9,819 rows and 9,817 distinct ids (the landing counted 9,819, the home page and `desk_rows` 9,817). Two pairs shared an id (bill 155, Lok Sabha, and bill XLIV, Rajya Sabha; same number, house and date, different title year and stage). Sansad's own listing holds both rows of each pair too, so it could not delete one; it settled which is right: for 155 the 2002-titled row's introduced-bill file is named for 2000 and the 2000-titled row carries the stage, so the 2000 row stays; for XLIV the 1973 row has the passage and assent dates and the 1976 row has none, so the 1973 row stays. The 2002 and 1976 rows are removed (9,817 rows, 9,817 ids); `national_bill_tracker.meta.json` `row_count` follows. (2) `national_mp_report_card.json`: 782 members, 780 `desk_rows`, because the register's `id` repeats across the houses (2664 and 2554 each name a Lok Sabha and a Rajya Sabha member) and `id` is the row key. `shapeMpRows` (`src/lib/parliament.js`, run by `prepareDeskFeed` for the loader and the desk) now keys a Rajya Sabha row whose id a Lok Sabha row also holds as `rs-<id>` (original in `id_raw`); every other key is unchanged. Reload needed: `npx vite-node --config vitest.config.js scripts/load-desk-rows.mjs -- --dry-run --tier national`, then the same without `--dry-run`; expected 5 upserts (the 2 colliding keys change content, 2 new `rs-` keys, 1 FCRA bill row) and 0 deletes. 2026-11-21

## Current state — 2026-11-11 (milestone check)

Checked 2026-11-10 at 13:56 UTC, and refreshed 2026-11-10 at 22:21 UTC (2026-11-11 in India), against `main`, NTER's migration history and Edge Function versions, and read-only
aggregate SQL on NTER. In this section, as in the F278 records, "the owner" is the client and "the developer" is DDL Labs
([START-HERE](../START-HERE.md), "Owner conventions").

- **Git:** `main` at `6fffce11` (PR #134). NTER's history differs from the repository's for older files (F283), so
  migrations go by `psql`, never `supabase db push`.
- **Corpus on NTER:** 23,289 documents, 23,285 indexed, 662,322 chunks; database 16.75 GB plus 1.07 GB of WAL on disk (F294), of which the Phase B backup
  `document_chunks_unpartitioned` is 5.3 GB, kept by the developer's decision until an agreed drop. By desk: Bills 8,576
  (5,680 bulk-loaded on 2026-11-09 and 10, [record](../operations/2026-11-10-bills-load.md)), NCLT 7,549, Parliamentary
  Questions 6,683, Regulatory 474. No worker job queued or running. The disk is 40 GB since 2026-11-11 (developer).
- **On NTER, newest first:** `20261111090000_search_keep_warm` (F324, `pg_cron` job 7 every 10 minutes), `20261110180000_record_resolver_shared_bill_keys` (F314), `20261110120000_bills_admission_rules`,
  `20261107120000_bills_adapter`, `20261106120000_admission_scans`, `20261102130000_batch_registration`,
  `20261102120000_chunk_hybrid_search` (applied 2026-11-09; the app does not call it). Edge Functions: `research-chat`
  v111, `ingest-worker` v10, `admin-ingest` v13. `ingest_settings` `claim_batch` 8 and `max_running` 16 (raised for the
  Bills load; reverting is one update).
- **Bulk runner (F285):** pack reader, screen (Bills), command line, production connection and automated acceptance are
  built and proved on the Bills load. Parliamentary Questions have no screen yet (F307).
- **Hybrid search (T9):** live for NCLT desk searches since 2026-11-16. Cold window 1 failed the 2.5 s rule (5.5 s first call)
  and window 2 passed (1.03 s worst): the cold cost follows eviction, not idle time, and hybrid also rereads TOAST
  embeddings. Keep-warm (F324) was applied on 2026-11-10 at 21:06 UTC. The cold measurement after the Regulatory load
  (2026-11-16) passed: hybrid's slowest call 1.29 s. The developer chose to ship and the app was switched the same day
  (`hybrid_search` row, 11:49 UTC); a signed-in check on 2026-11-17 took the hybrid path (retrieval 1.7 s).
- **Bills follow-ups:** F312 and the held bills (owner decisions), F311 (long bills), a key with house and introduction
  date (F314). F315 closed as not a defect. No further Bills load is pending: the library bills in v1.5 and v1.6 are
  all `servable=false` (F307, 2026-11-11).
- **Parliamentary Questions:** v1.4 holds 49,330 servable answers, none with a listing row on NTER; v1.6's 144,694
  library questions are all `servable=false` (F307, 2026-11-11).
- **M4:** in progress, and the live milestone. Of the [bulk ingestion spec](../specs/2026-11-01-bulk-ingestion.md) §10,
  steps 1, 2, 3, 6, 8 and 9 are done and live; step 4 (hybrid) is on NTER but unused (T9); step 10 (acceptance) is
  automated and was used for Bills; step 11 (the 10k, 100k, 1M ramp) has its first collection loaded. Step 5 (headers) is held under F289; step 7
  (capacity) waits on F279 and F294.
- **Site and payments:** public since 2026-10-18; Live checkout public since 2026-10-22. M1 and M2 closed; M3 waits on
  owner sources; M5 checkpoint not evidenced (F107); M6 smoke test passed on 2026-10-18.
- **Tracker:** swept on 2026-11-10 (F299): every open item carries a status line.
- **Since this check (2026-11-13):** `main` is at `d93325ed` (PR #142). On NTER: migration
  `20261112090000_batch_resume_requeue` (F291), `ingest-worker` v11 (F301) and `research-chat` v112 (F331, F332, F288
  dormant) ([record](../operations/2026-11-13-release.md)). `admin-ingest` is still v13 and
  `20261113090000_national_search_only` (F330) is not applied. The corpus figures above were not re-read.
- **Since this check (2026-11-15):** `main` is at `261e9c1d` (PR #147). Merged since `d93325ed` (PR #142): PR #143 `d60f0a42` (the 2026-11-13 release record); PR #144 `3879933f` (F330 rehearsal proof on a local database; F339 and F340 recorded); PR #145 `67946477` (signed-in chat checks for F331 and F332 on the live site); PR #146 `adab9e8f` (F332 reader header shows the publisher in full; the "Attached only" note under the suggestions removed; F341 recorded); PR #147 `261e9c1d` (F341: the reader's bar takes two rows in a narrow pane). The last two are client changes not yet checked on the live site. On NTER, read 2026-11-15: 96 migration history rows, the latest `20261112090000_batch_resume_requeue`; `20261113090000_national_search_only` is not applied; 11 Edge Functions deployed: `health` v16, `refresh-model-pricing` v17, `admin-models` v17, `ingest-documents` v24, `research-chat` v112, `desk-brief` v20, `ingest-worker` v11, `admin-ingest` v13, `document-file` v5, `transcribe-audio` v6, `admin-personas` v3, so no change to NTER since the 2026-11-13 release record. The corpus figures were not re-read.
- **Since this check (2026-11-15, later):** PR #148 is merged as `c1ebb102`. NTER was re-read the same day: 23,289 documents (Bills 8,576 with 8,572 indexed, NCLT 7,549, Parliamentary Questions 6,683, Regulatory 474, other National 7), 19,832 ingest jobs all succeeded and none queued, and no `hybrid_search` flag row (the only `app_flags` row is `record_briefs`). Four local branches are built and not pushed: `task/f342-script-tests` (`4a4fa6d0`), `task/f340-f305-proof-harness` (`455c5b57`), `task/f305-acceptance-index-miss` (`1045538f`) and `task/f295-retrieval-timing-tests` (`65826255`). The Regulatory load is held on F346. The order of the remaining work is in the [close-out plan](2026-11-15-ingestion-closeout.md).

## UI follow-ups (closed items)

- [x] **F109. INR billing.** *Done: `69dea865`; what it listed as remaining closed with F110 (`1940b021`), F111 and the public Live checkout (F241), except O6, which stays open on its own. 2026-11-10 (F299)* Code converted on `task/inr-billing`
  (2026-10-12): four monthly INR plans from `src/lib/publicPlans.js`, no GST
  (plain invoices), no trials, database values free/plus/pro/max via migration
  `20261012120000_inr_plans.sql`, applied to NTER and verified on 2026-10-12
  (owner authorized; see coordination Operations), then `main` pushed.
  Remaining for live payments: F110, F111, O6. [Spec](../specs/2026-10-12-inr-billing.md).

- [x] **F110. In-app upgrade and checkout screen.** *Done: `1940b021`; the test-mode runs and the open checkout followed (O6, F241). 2026-11-10 (F299)* Shipped in `1940b02`
  (production 2026-10-13): "Plan & billing" panel in the profile
  menu (current plan, Plus/Pro/Max in rupees, renew or upgrade only, invoices,
  renewal reminder), pricing hand-off for signed-in users, and a server switch
  `BILLING_CHECKOUT_OPEN` that keeps checkout closed until credits (F111).
  [Spec](../specs/2026-10-12-upgrade-screen.md). Owner checked the panel on
  production 2026-10-13. Remaining: a Razorpay test-mode run on a preview with test keys, then open checkout after
  F111.

- [x] **F115. Duplicate and misattributed corpus documents.** Found
  2026-10-13 from the owner's anti-doping question. It returned three
  citations to `bill:2025:77`: the admin-uploaded PDF (`89b71893…`, page
  pipeline), the same "As introduced" PDF ingested again as text on 2026-10-09
  (`510cd60e…`, 98 chunks), and the "As passed Lok Sabha" version
  (`965211c8…`, legitimate).

  Read-only corpus counts (3,434 documents, 100,031 chunks):
  - The PDF-plus-text twin affects only this bill (only two documents have a
    stored PDF): 1 extra document, 98 chunks.
  - Byte-identical text in 41 groups (95 documents, 54 extra):
    - 21 groups of TRAI uploads stored three times under file-name variants
      (`_VF`, `_0`, `_1`): 32 extra documents, 492 extra chunks;
    - 3 groups where one bill's synopsis and gazette files are identical:
      3 extra documents, 55 chunks;
    - 17 groups where one text is attached to different bills (for example
      `bill:2003:41` and `bill:2012:106`): 19 extra documents, 161 chunks.
      These are likely wrong-file mappings, not copies.
  - In total about 55 surplus documents and about 806 surplus chunks (0.8%).
  - Passage-level repeats across bills (2,035 passages) are mostly standard
    clauses (rule-making powers, delegated-legislation memoranda, Finance Act
    rules). They are expected, not duplicates.

  Cleanup deletes corpus rows, so it needs an approved data-migration task
  with an exact inventory. The misattributed bills need their correct
  documents identified first.
  - **Anti-doping duplicate removed, 2026-10-13** (owner approved): `510cd60e…`
    and its 98 chunks were deleted after a local backup. No bill now has two
    documents of the same version.
    [Record](../research/2026-10-13-duplicate-document-delete.md).
    Remaining: the TRAI repeats and the text shared across different bills.
  - **Repeats and misattributed bill files removed, 2026-10-13** (owner
    approved the exact list): 51 documents and 670 chunks, each identical to
    a kept document; 32 TRAI/CCI repeats and 19 bill files whose text names
    a different Act or version. Corpus: 3,382 documents, 99,263 chunks.
    [Record](../research/2026-10-13-f115-cleanup.md).
  - **The three review pairs were resolved, 2026-10-13**, from the text and
    bill records; the wrong copies were deleted (amendment 1 of the record).
    No identical-text documents remain. Corpus: 3,379 documents, 99,225
    chunks.

- [x] **F117. Versions for the original bill corpus.** 1,622 bill documents
  loaded between 2026-09-21 and 2026-10-01 record no `document_role`, so they
  show no version label and the model does not see their version.
  - Their sansad.in URL folder names the kind:
    - As introduced: 838
    - Notification: 287
    - Synopsis: 467 (not a current role)
    - Errata: 13
    - Passed Lok Sabha: 8
    - Passed both Houses: 7
    - Hindi: 2
  - **Done for five folders, 2026-10-13** (owner approved the URL-folder
    approach): 1,153 documents gained `document_role`, with a
    `document_role_source` marker.
    [Record](../research/2026-10-13-document-role-folder-backfill.md).
  - **Synopsis role done, 2026-10-13** (owner approved): 456 synopsis
    documents tagged; label maps and grounding prompt updated;
    `research-chat` v50. Only 2 Hindi errata files remain unversioned.
  - The 24-document old-key backfill is done:
    [record](../research/2026-10-13-document-role-backfill.md).

- [x] **F119. Sector picture cards select instead of opening.** Owner
  2026-10-13: a card selects its sector, with a visible switch and a scroll
  into view on phones; the module cards open the terminal. Built on
  `task/sector-card-select`, merged `8441097`, pushed 2026-10-13.
  [Spec](../specs/2026-10-13-sector-cards-select.md). Remaining: owner check
  on production.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F120. One header on every page.** Owner 2026-10-13: All sections
  and refresh on every page (landing refresh reloads its summaries); the
  search box shows a short label below 1,110px instead of truncating. Built on
  `task/consistent-header` and merged locally.
  [Spec](../specs/2026-10-13-consistent-header.md). Pushed in `cec56ee` and
  live on production. Remaining: owner check.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F121. Global record panels.** Owner request 2026-10-13: every Global
  record opens one consistent panel modelled on the owner's reference (header,
  01 at a glance, 02 about, 03 what it touches, a footer with Ask AI and
  provenance). Owner decisions: staged rollout; re-skin the Alliances,
  Sanctions, Aid and Nuclear dossiers; add a Record tab for Heads of State and
  Commodities; rule-based links and no impact page.
  [Research](../research/2026-10-13-global-record-panels.md) ·
  [Spec](../specs/2026-10-13-global-record-panels.md) ·
  [Plan](2026-10-13-global-record-panels.md).
  - Batch 1: the kit, Open Fronts, Global Intelligence and Infra (the
    supervisor, sequential).
  - Batch 2: seven modules (parallel sub-agents).
  - Batch 3: the four dossiers (parallel sub-agents).
  - Status: batch 1 merged to `main` at `a62c2bb` and pushed on 2026-10-13,
    after an independent re-review. Batch 2 (seven modules, the value board,
    country centres, and Record tabs for Heads of State and Global
    Commodities) passed an independent review and re-check and was merged to
    `main` locally at `931538c` and pushed at `3978309`. Batch 3 (Alliances,
    Sanctions, Global Aid, Nuclear Watch on the new panel; old dossier record
    views retired) passed an independent review and was merged to `main`
    locally at `067f09b` and pushed at `a3d79d7` on 2026-10-13. Still open
    after F121: the cached AI brief (F123) and the follow-ups in F122.
    Maritime Choke-Points and Energy stay as they are: the reference has no
    panel for them (owner, 2026-10-13).
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F124. National record panels.** Owner request 2026-10-13: the same
  record-panel makeover as Global (F121) for the eight National modules the
  client reference covers. The reference is a mockup: its layout and kind of
  information count, its figures do not.
  [Research](../research/2026-10-13-national-record-panels.md) ·
  [Spec](../specs/2026-10-13-national-record-panels.md) ·
  [Plan](2026-10-13-national-record-panels.md).
  - Owner decisions 2026-10-13: saved AI briefs only (no model call on
    selection); one batch; the Cabinet filter and the MP house fix as separate
    tasks (F125, F126).
  - Status: all eight panels built (N1–N9), independently reviewed (one
    must-fix, fixed), merged at `51a707f` and pushed on 2026-10-13. F125 and
    F126 followed (pushed at `abfb912`).
  - Backend gaps the reference points to (not in F124's scope):
    - Cabinet Decisions serves the unfiltered PIB feed;
    - the MP register has no house column, mixes Lok Sabha and Rajya Sabha
      under an "18th Lok Sabha" label, and has inconsistent party names;
    - affidavit criminal cases are a single count, not individual listings
      (owner asked for a fix; blocked: it needs a richer source, and MyNeta/ADR
      restrict redistribution);
    - questions hold no answer text;
    - the stored bill `probability_score` and `summary` are empty;
    - Pipeline sources are `news.google.com` links;
    - status labels in `src/lib/apiStatus.js` call embedded packs "live".
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them." The six backend gaps listed above stay recorded here for the corpus work.*

- [x] **F125. Cabinet Decisions: only Cabinet decisions.** Owner 2026-10-13.
  [Spec](../specs/2026-10-13-cabinet-filter-mp-house.md).
  - **Marker:** PIB names each release's issuing body on its release page; the
    stored CCEA decision reads "Cabinet Committee on Economic Affairs (CCEA)".
  - **Server:** reads that field for every PIB release it already opens, and
    keeps only the Cabinet and its committees (`isCabinetBody`,
    `src/lib/parliament.js`; never the Cabinet Secretariat).
  - **Fallback:** when the live window has none, it shows the stored Cabinet
    decisions and says so. On 2026-10-13 none of the 18 latest releases was a
    Cabinet decision.
  - **Client and panel:** the client keeps the body's name as written
    ("(CCEA)", not "(Ccea)"), and the panel reads the body as its marker.
  - **Verification:** a server test with PIB stubbed fails on the old code.
    Merged and pushed at `abfb912` on 2026-10-13.

- [x] **F126. MP register: house and party names.** Owner 2026-10-13.
  - **House:** each row's `house` comes from its own `sansad.in` link (540
    Lok Sabha, 242 Rajya Sabha).
  - **Party:** `party` is unified to the Lok Sabha abbreviation only where the
    full name certainly means that party, with the original kept in
    `party_raw`. "Shiv Sena", "Nationalist Congress Party" and
    "Independent & Others" are left as held.
  - **Shaping:** done in `prepareDeskFeed`, so the live and stored paths agree.
  - **Labels and panel:** the labels now say both houses, and the panel shows
    "Listed as" where the name differs.
  - Merged and pushed at `abfb912` on 2026-10-13.

- [x] **F128. Law record panels.** Owner request 2026-10-13 ("go ahead with
  Law now, same process").
  - All twelve Law modules get the record panel in the Law reference's form:
    four tile questions with the clock last, a "what a lawyer needs" board,
    Quick exit handing off to AI Research, and a health strip.
  - Two source fields are kept: the IBBI claims deadline and the Google News
    publisher.
  - [Spec](../specs/2026-10-13-law-record-panels.md),
    [plan](2026-10-13-law-record-panels.md),
    [research](../research/2026-10-13-law-record-panels.md). Branch
    `task/law-record-panels`.
  - Done: twelve panels, Fable review (one must-fix, fixed), merged locally on
    2026-10-13 and pushed at `5806d13`.
  - Follow-up fixed 2026-10-13: module headings and menus no longer
    title-case abbreviations ("Nclt" → "NCLT", "Icc" → "ICC", and about 30
    labels on other desks, such as "GDP, CPI, PMI", "CBAM", "OTT").
    `featureMenuLabel` keeps a word written with inner capitals unless the
    whole label is in capitals; `src/lib/national.test.js`.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F129. ICJ and WTO registers from the stored packs.** Found in the F128
  research (2026-10-13).
  - Owner 2026-10-13: ICJ stays as it is ("keep what we have"); WTO approved
    for collection.
  - WTO built on `task/wto-register`
    ([spec](../specs/2026-10-13-wto-register.md)): the WTO's own register
    (646 disputes) collected from wto.org's data files, a register panel, and a
    Fable review with all findings fixed (several current stages, third-party
    naming by the WTO's exception lists, parser hardening, the news-fallback
    table, two guards made falsifiable).
  - The WTO's terms of use for wto.org could not be read; the owner chose
    to publish on 2026-10-13 ("merge and push the WTO register"), with the
    WTO credited on every row and panel. Confirming the terms with the WTO
    (enquiries@wto.org) remains advisable.
  - ICJ is unchanged by the owner's choice, so F129 stays open only for a
    possible ICJ register later.
  - Planned: [record follow-ups plan](2026-10-13-record-followups-plan.md) (2026-10-13).
  - `backup/` holds 177 ICJ General List cases and 641 WTO DS case pages.
    Either would turn a wire module into a register.
  - `backup/` is probably not deployed, so this is a data task that needs
    approval.
  - The Sector Tribunals pack holds a PAN in at least one title; check it for
    personal data before any use.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them." WTO register checked; the ICJ register was dropped by the owner ("keep what we have").*

- [x] **F122. Global desk data honesty follow-ups.** Found by the F121 batch 2
  agents (2026-10-13); outside F121's scope.
  - Planned: [record follow-ups plan](2026-10-13-record-followups-plan.md) (2026-10-13).
  - G1 done `bed03ba` and G2 done `e0c3e8d` (2026-10-13): the Commodities
    search, "$2.5B", whole-token sanctions issuers, one Ukraine leader row;
    illustrative commodity levels, register-only leader profiles with outside
    sites "for checking", office names not verified, no JSON launch link,
    alliance fallbacks "Not stated". The desk catalogue's Heads of State count
    is now 43 (`supabase/functions/_shared/deskCatalog.json`; reaches the Edge
    Functions on their next deploy).
  - G3 done `9dffe65` (2026-10-13; owner approved the deletions): Cook
    Islands, French Polynesia, New Caledonia, Niue and Montserrat placed on the
    maps (Pacific Islands Forum 18 of 18, CARICOM 15 of 15); EU, AU and SADR
    stay unplaced, as non-places. Removed: `AssetAnalytics.jsx`, the
    `.geo-holistic` rules, the dossier-only heat/legend helpers in
    `alliances.js`, `sanctions.js`, `globalAid.js` and `strategicAssets.js`,
    and `fillSiteLabel` (`operatorCountries` stays: `statsFor` uses it).
    F122 is complete.
  - Global Commodities desk: a KPI tile says "Live · API-ready" and the sources
    list names Trading Economics and CME, but the levels are illustrative pack
    values (`src/desks/CommoditiesDesk.jsx`; feed `links` in
    `server/featureFeed.mjs` near the Global Commodities branch; the pack note
    in `src/data/commodities.json`). The record panel already says illustrative.
  - Global Commodities desk: the search box does not filter, because
    `groupsFrom` returns `feed.meta.groups` whenever the feed has them
    (`src/desks/CommoditiesDesk.jsx`).
  - Heads of State pack: row `ua2` duplicates `ua` ("Ukraine (see
    Zelensky)"), and several names are offices that `flattenLeader` does not
    flag as unverified ("UK Prime Minister", "German Chancellor", "Japan PM",
    "Poland (govt)", "Taliban (IEA)", "Qatar (Emir)") (`src/data/leaders.json`,
    `src/lib/globalResources.js`).
  - The Heads of State feed lists Wikidata and the CIA World Factbook as links,
    though its rows come from the embedded pack (`server/featureFeed.mjs`).
  - The `.geo-holistic` workspace rules in `src/index.css` no longer apply to
    any desk since F121 T15 and can be removed.
  - Satellite Infrastructure: a launch's "Source" link is the Launch Library
    JSON endpoint, not a readable page (`flattenLaunch` in
    `server/assetsApi.mjs`).
  - Global Aid: `money()` in `src/lib/globalAid.js` prints "$2.50B" (the
    trailing zero is not trimmed).
  - Alliances: `bindingType` falls back to "Political declaration" and
    `defaultStanding` to "Full member"/"Participant", asserting more than the
    rows hold (`src/lib/alliances.js`); the record panel ignores the fallbacks.
  - Sanctions: `issuerTokens` matches by substring, so "AUS" yields both the US
    and Australia (`src/lib/sanctions.js`).
  - Map coverage: territories on alliance rosters (Cook Islands, French
    Polynesia, New Caledonia, Niue, Montserrat) and non-states (EU, AU,
    Sahrawi Arab Democratic Republic) have no position in
    `src/shell/record/countryCentres.js`, so they are left off the maps.
  - Dead code: `src/desks/AssetAnalytics.jsx` has no importer; helpers in
    `src/lib/alliances.js`, `sanctions.js`, `globalAid.js` and
    `strategicAssets.js` used only by the retired dossier record views may
    now be unused; `fillSiteLabel` in `src/lib/geoTip.js` is now called only
    by its test, and its comment and the F28 note below still name the
    deleted `NuclearSiteMap.jsx`.

- [x] **F123. AI brief in the Global record panels.** Owner 2026-10-13: the
  old brief box was largely a dummy (its base text was a template filled from
  the row, labelled "AI analyst brief"); keep a box there for now and revisit
  it properly with AI credits (F111).
  - Interim, built 2026-10-13: every record panel has a "✦ Niyantran analysis"
    card in 02 · About. It shows a brief saved earlier from AI Research
    (`useEntryBrief`, cache read only, no generation) or says that none is saved.
    No template text is shown as AI.
  - Remaining, with F111: whether selecting a record should generate a brief,
    what it costs in credits, and how it is labelled.
  *Done 2026-10-15 (owner: "create that AI brief automatically and store it … the credit cost can be borne by us"): `6cf8f35`, `c408f46`, `26dbf4d`; migration 57 `20261015220000_record_briefs`; desk-brief v10; `app_flags.record_briefs` on. Opening a record panel (adapter panels, `RecordDetail`, National generic records) asks `desk-brief` scope `record`; the first viewer's request writes the brief at the platform's cost (Claude Haiku 5.5, `RECORD_BRIEF_MODEL` to change), every later viewer reads it; regenerated only when the record changes, at most once per 24 h; 10 a minute and 200 a day per user, 5,000 a day in all; failures back off and stop after 5. Browser-supplied rows (not in `desk_rows`) get content-addressed briefs only (two security reviews; the second found a field-hiding gap, fixed in `c408f46`). [Measurement](../research/2026-10-15-record-brief-measurement.md): 20/20 correct on Haiku, about $0.16 per 1,000. Production: two briefs written ($0.000188 each), served again from the store; a re-announced account briefly hid a stored brief, fixed in `26dbf4d` with a retried account check. Open: `RecordDetail`'s separate source-document brief sits next to the record brief (product choice); Morning Brief's module is not in the catalogue; `BillRecordPane` is unreachable and could be removed.*

- [x] **F130. Web search in AI Research.** Owner request 2026-10-13: web
  context for records without indexed documents, site-wide, through
  OpenRouter's server web-search tool (Exa), as in TenderBase. Owner
  decisions: automatic per record or module without an indexed document; the
  composer globe overrides both ways and is stored per conversation; at most
  three searches per turn; web sources labelled unofficial, shown as a "From
  the web" row and a side-panel list, with a plain globe and the domain;
  searches and cost recorded for F111.
  [Research](../research/2026-10-13-web-search.md) ·
  [Spec](../specs/2026-10-13-web-search.md). Branch `task/web-search`
  (worktree `.claude/worktrees/web-search`).
  - **Status, 2026-10-13: shipped.** Migration `20261013140000` applied to
    NTER, `research-chat` v51 deployed, `origin/main` at `3d937af` (see
    coordination Operations). Remaining: the owner's check on production,
    and the follow-ups below.
    - Research and probes; spec with amendments 1–2.
      [Plan](2026-10-13-web-search.md),
      [local run](../research/2026-10-13-web-search-local-run.md).
    - Sub-agents built the fixtures, the agent loop, the policy and the UI,
      and ran the security pass and an independent review.
    - Checks: 993 Deno and 3,166 Vitest tests, lint, the build and all SQL
      fixtures pass; the migration's Down block was executed.
    - Spend: $0.31 of an approved $1.00.
  - **Owner decision, 2026-10-13:** no per-user search cap. The per-turn
    limit of three stays, and every search is logged with its cost.
  - The privacy policy names OpenRouter's web search, run by Exa, and what
    it receives (updated 13 October 2026; the F107 lawyer review still
    applies).
  - The globe's prediction now counts exactly the records the next send
    carries (`webPredictionRecords`), so it agrees with the server in the two
    cases spec amendment 2 listed. No follow-ups remain.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F131. Web search: one stream, live sources and site icons.** Owner
  report 2026-10-13: on a web turn the answer streams, vanishes and streams
  again, and the sources appear only at the end. Cause: a research call that
  searched is never the answer, so its live draft is always taken back and
  rewritten. Owner decisions: stay on OpenRouter (search terms are not
  exposed, Probe 3); real site icons through our server via DuckDuckGo; four
  icons, then "+N". Probe 3 also found the reported search count can exceed
  `max_uses` by one (billed correctly), so F130 logs overstate.
  [Spec](../specs/2026-10-13-web-search-streaming.md). Branch
  `task/web-search`.
  - **Status, 2026-10-13: shipped.** `research-chat` v52 is deployed and
    `origin/main` is pushed (see coordination Operations). Remaining: the
    owner's check on production.
    - The owner approved the spec with both recommendations: hold drafts on
      web turns only, and add the privacy half-sentence. Production logs
      showed that all three retractions in 24 hours were on web turns.
    - Checks: 3,663 Vitest and 1,012 Deno tests, lint, the build and the
      router check.
    - The local run streamed each answer once, with the strip filling live
      and real icons ([spec](../specs/2026-10-13-web-search-streaming.md),
      "Build and local run").
    - Spend: $0.57 of $1.00 in total.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F133. Desk tabs: the separator back and less space.** Owner request 2026-10-13. The line
  between the search row and the desk tabs was lost in `38fae22`, and F112 made the tab row 58 px.
  The tabs are now their own row at every width under a full-width line, in a 42 px row; the
  current desk's highlight fills the row from line to line (owner's choices). Header at 1440 px: 107 px (was 119). On `task/ui-polish`;
  [spec](../specs/2026-10-13-ui-polish.md). Remaining: review, merge, push, owner check.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F134. Header search results drag into AI research.** Owner request 2026-10-13. Catalogue and
  Records results now carry the shared drag payload (a record carries its row); a drag opens AI
  research and the search window steps aside. On `task/ui-polish`. Remaining: a real mouse drag in
  the browser (the drop could not be simulated), review, merge, push.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F135. The side panel closes on a click outside or Escape on every page.** Owner request
  2026-10-13. Only AI had an outside-click close; Desk and Record now collapse to the slim bar on a
  click outside or Escape (owner's choice), and picking the selected row again reopens its record.
  On `task/ui-polish`. Remaining: review, merge, push, owner check.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F140. Homepage header, hero, globe and "Curated for" strip to the client's design.** Owner
  request 2026-10-13 (client review of `NTER-Homepage-Final.html` and `globe-animation/`). The
  design's look, our data and links: white header kept sticky at 72 px with "Data coverage", Sign in
  beside "Get started ↗" and "BY NTER.PRO"; the design's hero (no mouse-follow); the orbiting globe
  with seven data labels that pass behind Earth, each opening its desk or module (signed out: sign in
  first); figures 9,817 bills, 120 modules and 246 source endpoints (counted from the source registry);
  the six personas in a strip. Measured against the design: identical positions at 1440 px apart from
  the shorter header. On `task/home-hero`; [spec](../specs/2026-10-14-home-hero-redesign.md).
  Reviewed (fixes: a new account now keeps a destination chosen before sign-up, as sign-in already
  did; the signed-in label path uses the hash, as Pricing). Owner kept "246 · Source endpoints" (of
  the 246, 189 are per-module search URLs on GDELT and Google News; 31 distinct hosts). Remaining:
  push, owner and client check. Not done, low priority: "Data coverage" from another page scrolls
  after an 80 ms timer; inherited from the client's globe, its focus listeners are re-added on
  reconnect and a partly hidden rear label stays clickable through Earth. The homepage's sideways
  scroll at 375 px is fixed on `task/mobile-overflow` (the trivia band, see the Done entry below);
  its 47 px overhang on desktop is left as it is.
  *Done 2026-10-15 (`bba5434`): owner checked on production; the three small defects fixed: the "Data coverage" scroll waits for the home page instead of an 80 ms timer, the globe's focus listeners are added once and removed on disconnect, and a disc over Earth stops clicks on the hidden part of rear labels (checked in a browser: front labels and the visible edge of a rear label still click). Rear labels stay keyboard-focusable on purpose (a focused label comes to the front).*

- [x] **F141. One globe across the marketing site.** Owner request 2026-10-14: the client's globe
  (F140) replaces the old `AuthEarth` on sign-in, sign-up and pricing (globe only; page styling
  stays), behind one shared wrapper; then the old globe is retired.
  [Spec](../specs/2026-10-14-one-globe.md). Built on `task/one-globe`: `DataGlobe.jsx` on all four
  pages; the Earth keeps the old size at 1440 px (sign-in 490 px, sign-up 331 px), is 179 px where
  sign-in and sign-up sit beside a narrow 280 px box (was 280 px) and 256 px on pricing (was 400 px),
  so labels never cross the form, heading or copy and nothing leaves the screen (checked over a full
  orbit at 1440, 1024, 939, 858 and 375 px). Old globe retired (6 files, 79 CSS rules). Reviewed:
  a pause button on every globe (WCAG 2.2.2, as the old globe had), the mount wiring tested, the old
  globe's docs marked historical. Left for later: the `three` package has no importer now (it was the
  old globe's renderer); removing it is a dependency change. Remaining: merge, push.
  *Done 2026-10-15 (`9bb01f9`): owner checked on production; the unused `three` dependency removed.*

- [x] **F142. Live, database-backed figures on the marketing site.** Owner request 2026-10-14: today
  9,817 bills and 3,431 documents are typed constants, and the carousel counts come from snapshot
  files, so new records never show. One `site_figures()` database function (service role) behind a
  cached public `/api/site-figures`, with the measured constants as the fallback; the hero, KPIs,
  ribbon, pricing and carousel read it. [Spec](../specs/2026-10-14-live-site-figures.md). Owner
  2026-10-14: migration approved; bills stay one per bill ID. Built on `task/live-figures`: the
  function and its SQL fixture (27 fixtures pass; vacuity and 7 mutations caught), the endpoint
  (15-minute cache, last good then measured fallback, CDN header per source), the carousel and the
  pages (the homepage's hand-typed "48 MINISTRIES" now reads the count; the ribbon's and the
  walkthrough's "200+ authoritative sources" now read the endpoint count). Reviewed (5 s database
  timeout, a minute of failure memory, client refresh). Migration 46 applied to NTER 2026-10-14; live
  counts equal direct counts (bills 9,817, documents 3,376, ministries 56, fronts 88); see coordination
  Operations. Remaining: merge, push. Still hand-typed on the homepage (F30): the preview cards'
  other figures (houses, series start, status bars and the other desks' samples).
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F143. Desk landing counters restart on load.** Owner bug report 2026-10-14: the counters ran
  at high speed from 0 two or three times on load, sometimes kept doing it, sometimes loaded fine.
  Cause (code read): every summary arriving (up to 16 per landing, 45 s timeouts) restarted every
  counter from 0, through a key built from the raw summaries; a retry could leave "NaN". Fixed on
  `task/landing-counters`: each number counts once from the value it shows to its target, unchanged
  numbers do not move, the key follows the numbers on screen, a cleared value is left to React.
  Unit-tested (each guard fails without its code). Remaining: a browser check with the pane visible
  (a hidden pane pauses motion), merge, push.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F144. Homepage desk preview: only real figures.** Owner 2026-10-14: fix the figures our data
  backs under their current labels; list the rest for the client. Fixed on `task/preview-figures`:
  bill houses, series start and the four stage bars (real counts, checked against NTER), MP states
  covered (36), macro series (7) and publishers (2), fronts (88) and theatres (17), and the false
  "probability scores" note; generated from the snapshot files with a recount test. Waiting on the
  client: 15 items in [the client document](../research/2026-10-14-homepage-preview-for-client.md)
  (retitling Media, Ops and Economy to real datasets; the bars, rows and tiles with no data).
  Remaining: merge, push, then the client's answers.
  *Closed 2026-10-15: the owner says the client has given everything needed; the preview shows only figures the data supports (Part A of `research/2026-10-14-homepage-preview-for-client.md`).*

- [x] **F145. Globe handover and page speed.** Owner request 2026-10-14, from the client: a globe on
  a black background flashes before the real globe on every page change, and pages feel slow. Causes
  (measured on a production build): the globe's stand-in image is a photo of Earth on black space
  (inherited from the client's package), and each page rebuilds the globe from scratch; the homepage
  loads a 34 MB GIF as the walkthrough backdrop (since 2026-09-21), the whole terminal script
  (2.6 MB) for signed-out visitors, and 2.3 MB of Earth images; nothing is cached by browsers.
  [Spec](../specs/2026-10-14-globe-handover-and-page-speed.md). Owner 2026-10-14: GIF becomes a still,
  caching rule approved, unused files removed. Built on `task/page-speed` (T1–T5): a transparent still
  of our globe and shared textures and time across pages (no flash; later globes draw at once); the
  GIF is an 11 KB lazy still; the terminal, admin and chooser load on demand (entry 723 → 220 KB gzip,
  CSS byte-identical); WebP textures (2.28 → 0.52 MB), a 4 KB logo; `vercel.json` caching. A first
  homepage visit is about 0.94 MB over the wire, against about 40 MB. Reviewed (fixes: a late
  lost-context event, a reload screen for a failed download after a deploy, the terminal loading at
  start-up for a signed-in visitor, the Earth clock, a stylesheet guard in `check:bundle`). Merged
  (`3daa484`) and pushed (`5503287`, owner 2026-10-14); CI passed on both jobs.
  - **Live check, 2026-10-14:** build files are cached a year as immutable, brand images a day, and
    pages still revalidate. The signed-in terminal loads its on-demand chunks with no error screen.
  - **Finding: a missing `/assets/` file also gets the one-year header**, because Vercel applies
    headers to 404s. A browser that hit a missing build file would keep that 404 for a year (it
    matters only for a rollback to the deployment that has the file). Owner 2026-10-14: the rule is
    narrowed to top-level build files (`/assets/([^/]+)`). Checked live after `d6c8849`:
    - a build file keeps the year;
    - a subfolder 404 (`/assets/uploads/…`) gets `max-age=0`;
    - brand images keep the day.
  - Remaining: owner and client check.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F146. Withdrawn, not a defect (2026-10-14).** Reported during the F145 live check as broken
  news images under our `/assets/uploads/`. That was a measurement error by the supervisor: the
  filter matched `/assets/` on any host. The images are absolute `https://nter.news/assets/uploads/…`
  URLs in the snapshot, the API and the page (`server/nterNews.mjs` makes ingested paths absolute),
  and they load from nter.news (200). Nothing under `public/data` needs changing.

- [x] **F214. Homepage globe 5% larger; the brief animation every time.** Done 2026-10-17 (`27d4bbf`,
  `30ebebb`, `157d689`; owner: "push merge clean"). CI passed on the first attempt (both jobs); Vercel
  production READY on `157d689`. Live: the hero globe scene at scale 1.05 (683 -> 717 px at the pane's
  width); the served terminal chunk carries the new brief card (reading fallback, no plain skeleton).
  A signed-in record check on production is still to do. Owner 2026-10-16, UI only.
  The hero globe scene, labels included, scaled 5% from 701 px up (phones keep their size: the globe
  already spans the screen and 5% more pushed its labels past the edge). The brief card plays the
  client's animation for 2.5 s with every record it opens, stored, new or seen this session, and
  restarts it on a record switch; fetching is unchanged. Spec: `docs/specs/2026-10-16-globe-and-brief-animation.md`.

- [x] **F213. The persona column's smallest text, a step larger.** Done 2026-10-16 (`8bb0ca9`; owner:
  "Push everything, deploy everything"). CI passed on the first attempt (run 38829697824, both jobs);
  Vercel production READY on `8bb0ca9`. Live check on the deployment: the persona column with subtitles
  and hint at 10 px, the seven coverage figures, the hover popover, no sideways scroll; the production
  domain serves the same entry bundle. Card subtitles and the hint 8.5/8 px → 10 px (10.5 px on phones),
  the popover kicker 7 → 9 px, the column's overline and line and the coverage box heading one step up;
  colours unchanged.

- [x] **F212. Homepage hero: persona column and coverage box from the client reference.** Done 2026-10-16
  (`813f061`, owner: "Push, merge, and tidy up"). Live: production serves the `05cc82d` build, whose entry
  bundle holds the persona column, the reference's wording and the coverage box. The "Curated for" strip
  became the hero's third column: six cards with the reference's names and subtitles; hovering or
  focusing a card previews a popover with the reference's text, a click keeps it open, and "Explore this
  perspective" opens that persona in the personas section (keyboard reachable after the review fixes).
  The three figures under the copy became a seven-figure coverage box, every figure from our own sources
  (desks: 8, as on pricing), with no date line. Header, copy, globe and lower sections unchanged; the
  reference's Replay button and auto-preview left out. Raised, not changed: the reference's 8 px hint and
  8.5 px light-grey subtitles are below 4.5:1 contrast (owner's call). Spec:
  `docs/specs/2026-10-16-hero-persona-column.md`.

- [x] **F211. The client's record animation plays while a brief is written.** Done 2026-10-16 (`14e323f`;
  owner: "push"). Live check: a bill with no stored brief showed the skeleton, then the animation, then
  its brief at 4.7 s. Owner 2026-10-16. The
  "NTER-Record-Animation-Final" web component (copied unchanged to `public/animation`) mounts in the
  brief card only in F209's `writing` state, loaded on first use, scaled to the card; a quick write
  waits for its 2.5 s; stored briefs and revisits are unchanged. Spec:
  `docs/specs/2026-10-16-record-brief-animation.md`.

- [x] **F209. The record brief shows "writing" only while it is written.** Done 2026-10-16 (`078100c`;
  desk-brief deployed first, then Vercel; CI green). Owner 2026-10-16 ("go"),
  before the client's new writing animation. Measured: stored reads took 1.1-2.5 s and showed the
  writing look; nothing was regenerated (50 briefs before and after). `desk-brief` gains a read mode
  (`peekDecision` mirrors `record_brief_claim`, no claim, no model call); the panel reads first and
  writes only on `missing`; briefs seen this session show at once; the account check is reused. Spec:
  `docs/specs/2026-10-16-record-brief-read.md`. Live check: stored briefs show the skeleton only
  and land in 0.5-0.75 s (were 1.1-2.5 s with the writing look); a record with no current brief read
  'missing' in 450 ms, then showed the writing look for its 3.2 s write; a revisit shows in 98 ms with
  no request.

- [x] **F207. Cleanup after F203-F206.** Done 2026-10-16 (`d7b0b02`, `59e54ed`; owner: "merge everything to
  main, and deploy"). Owner 2026-10-16 ("clean up the small gaps"). The record
  adapters no longer compute the graph's `lanes`/`nodes` (27 adapters, 24 test files, 867 lines out;
  node checks moved to links and About rows where they had a match); footer notes no longer promise
  companies or sectors the panels do not show; questions and the pipeline no longer fetch the
  ontology. The bundle baseline is re-recorded at 222,125 B gzip: the growth was bisected to F202's
  column definitions and F196's modules, which the desk catalogue puts in the entry. Also (owner,
  2026-10-16): the All sections cards lose their ↗ arrow, and Home shows the Niyantran Terminal logo.
  On `task/cleanup`.

- [x] **F204. Record panels draw no relations graph.** Done 2026-10-16 (`e2a9613`; owner: "push and
  merge"). Owner 2026-10-16 ("not genuine … remove that
  wherever it comes"). The four-lane graph is gone from all 26 record types; their related register
  rows stay as "Related on record". The unread `lanes`/`nodes` left the adapters in F207.
  Spec: `docs/specs/2026-10-16-record-panel-and-chat.md`. On `task/module-scroll`.

- [x] **F205. The AI brief card tells reading from writing.** Done 2026-10-16 (`9ef80e5`, `56ee533`). Owner 2026-10-16. A stored brief shows a
  plain skeleton; one being written (server 'pending', or slower than 1.2 s) shows the Niyantran mark
  with a shimmer. Same spec and branch.

- [x] **F206. AI opens on a new chat by default.** Done 2026-10-16 (`e1aad94`, `56ee533`). Owner 2026-10-16. After a desk, module or record
  change, opening AI starts a new local chat; a history pick, the credits page, a running answer and
  an untouched new chat are kept. Same spec and branch.

- [x] **F203. Module pages that cannot scroll, are cut off, or lose their menu.** Done 2026-10-16
  (`d53c029`, `4e0e1f5`, `8e6a0a4`). Owner request
  2026-10-16 (UI only). Measured on all 120 desk modules: the 101 on the shared table were fine; of the
  19 hand-built pages, 7 lost their bottom 36 px (`.nat-panel` content-box padding), MP Profiles and
  Centre-sanctioned Projects could not scroll (`.alliances-wrap` grew past a clipped area), a focused
  card could push a page's top out of reach (`.main-col` hidden, not clipped), and Alliances, Sanctions
  and Global Aid were cut on the right beside the map. Category menus switched under a diagonal
  pointer. Spec: `docs/specs/2026-10-16-module-scroll.md`. Reviewed; the menu's hover bridge fix
  followed the owner's look. Making the 19 hand-built pages share the
  table look is a separate owner decision.

- [x] **F195. Desk rail on module pages.** Done 2026-10-15 (`1a1b2e7`, `315de13`, `bb2e7da`, `ff17ad1`;
  owner: "once that is fixed, push"). Owner request 2026-10-15 (revisits F102 for module pages
  only). Inside a desk, the desk tabs leave the header for a 56 px icon rail on the left; its toggle
  widens it to 208 px with names over the page; at 900 px and below it is a drawer from a Desks
  button in the category row. Landing pages, Home and the credits page keep the header tabs. Spec:
  `docs/specs/2026-10-15-desk-left-rail.md`. Built on `task/desk-left-rail` (from
  `task/chat-credits-strip`); reviewed, then the toggle moved to the start of the category row with a
  three-line icon and a sliding reveal (owner follow-up).

- [x] **F194. `openCreditsUsage` has no caller left.** Done 2026-10-15 on `task/chat-credits-strip` (owner:
  "fix them too"): removed with its event and the shell's listener. Found in the F193 review, 2026-10-15. F193
  removed the chat's "Credits" link, the last caller of `openCreditsUsage` (`src/lib/creditsStore.js`);
  the shell's `OPEN_USAGE_EVENT` listener (`src/shell/TerminalShell.jsx`) now hears nothing, and the
  comments there still name the chat's Credits link. Remove both, or give the event a new caller.

- [x] **F193. Chat credit notices at the header pill; "Web sources" strip.** Done 2026-10-15 (`337f9c1`,
  `baf263d`, `16cac7a`). Owner request
  2026-10-15 (UI only). The credit line under the chat box goes; the chat's refusal (no credits,
  credits in use, could not be checked with Try again) and every warning show at the header's balance
  pill, whose popover opens by itself for a refusal without taking focus. The web strip becomes site
  icons side by side in their own pill, "Web sources" and the page count, with no outer border; the
  search count and "N cited in the answer" move into the list it opens. The model's citation
  instructions are unchanged (owner). Spec: `docs/specs/2026-10-15-chat-credits-and-web-strip.md`.
  Built on `task/chat-credits-strip`, reviewed, owner-checked on the local preview.

- [x] **F184. Credits page, balance pill and visual credits UI.** Done 2026-10-15 (`65c940e`; owner:
  "push + merge"). Owner request 2026-10-15
  (UI only). Credits get their own page from the profile menu, with a left side menu holding a
  balance card and four sections:
  - **Overview:** period bar, pace estimate, where credits went, recent answers.
  - **Usage:** today's analytics, complete, plus a 90-day heat map.
  - **Activity:** every existing filter; rows led by the question; a role bar on expand; group by
    chat.
  - **Plan and invoices.**

  Also: a header balance pill with a glance popover, and a status bar keeping every existing
  message. Every credit-to-rupee conversion goes, the CSV included; plan prices and invoices stay
  in ₹. Spec and plan: `docs/specs/2026-10-15-credits-page.md`; design canvas, board 9. Built on
  `task/credits-ui` (spec "As built"), independently reviewed twice, and checked by the owner on a
  signed-in local preview; their feedback (ring, page shift, chart colours, By feature icons) is in.

- [x] **F177. Globe position and sizes.** Done 2026-10-14 (owner: "push merge"). Owner request:
  Pricing's globe sat at the extreme right (24 px from the screen, a label 18 px); the homepage
  globe 5% larger; sign-in and sign-up smaller ("the globe" is the whole box). As built
  (spec `docs/specs/2026-10-14-globe-sizes.md`): Pricing's hero keeps `clamp(32px, 5vw, 96px)`
  clear on the right and its globe is 10% larger (400 → 440 px, 96 px from the edge at 1440 px);
  home `width: 105%` and cap × 1.05, centred; every scene width × `--globe-scale`, `.9` on sign-in
  and `.95` on sign-up. Browser-measured at 1920, 1440, 1200, 900 and 390 px. Accepted trade-off: on
  height-limited screens such as 1440×900 the homepage pushes the "Curated for" strip about
  15–26 px below the fold. Not checked in Safari or Firefox.

- [x] **F154. Terminal page speed (phase 1).** Done 2026-10-14 (`719a7eb`, pushed `1e5d065`). Owner request 2026-10-14: opening a terminal link
  takes 5–7 s; the owner asked for caching. A read-only audit on production found the page files
  fast (0.12–0.19 s) and the API slow: every `/api/*` answer was `no-store`, the function ran in
  `iad1` (US East) while users and Supabase are in India, and desk landing counts and module pages
  waited for the full live scrape (Cabinet Decisions 9–21 s, Morning Brief 28 s or a 504, Athlete
  Index 7 s). Built on `task/terminal-speed` (uncommitted, for the supervisor):
  - **Edge caching.** One allow-list in `api/router.js` (`cachePolicyFor`): the seven
    `/api/*-landing` routes, `/api/feature-feed`, `/api/home/segments`, `/api/constitutions` and
    `/api/growth`, GET or HEAD only. A 2xx answer gets `Cache-Control: public, max-age=0,
    must-revalidate` (the browser re-checks) and `Vercel-CDN-Cache-Control: public, s-maxage=300,
    stale-while-revalidate=86400` (Vercel's CDN only, not passed on; 60 s when the answer is the
    archive). Every other route, and every error, refusal or timeout, keeps `no-store`;
    `site-figures` and `site-icon` keep their own rules. `/api/home/markets|latest|pulse` stay
    `no-store` because `fresh=1` is the refresh button.
  - **Live time limit.** `serveFeatureFeedWithinLimit` (`server/featureFeed.mjs`) gives a request's
    live sources 4 s in all (`LIVE_TIME_LIMIT_MS`), then answers from the stored archive: the same
    feed code runs again with every live source refusing at once, so each module takes the fallback
    it already has. The answer carries `served: 'live' | 'archive'` (landing summaries pass it on).
    One live attempt per feed runs at a time, and a late live answer is used by later requests on
    the same instance for 10 minutes. Measured from the owner's Mac against the real sources
    (unbounded → bounded): Morning Brief 41.9 → 4.0 s, NSE/BSE 12.0 → 4.0 s (144 stored quotes),
    Athlete Index 45.0 → 4.0 s, Geopolitics News Wire 26.3 → 4.0 s.
  - **Archive first on module pages.** `fetchFeature` with `onUpdate` (used by `DeskView`) starts
    the shipped archive and the API together. If the API has not answered within 0.5 s, the
    archive shows with the note "Showing stored rows. Refreshing live data…", and live rows replace
    it when they arrive ("Updated live."). A quicker API answer is shown as before; other callers
    are unchanged.
  - **Region and data files.** `vercel.json`: `"regions": ["bom1"]` (Mumbai, next to Supabase
    ap-south-1), and `/data/(.*)` cached `public, max-age=300, stale-while-revalidate=86400`.
  - Checked on production after the push (repeat requests, from the owner's Mac): the function
    runs in `bom1`; `/data/` carries the new header; Cabinet Decisions landing 9–21 s → 0.13 s
    (edge `STALE`/`HIT`); NSE/BSE landing 4.2 s cold, 0.16 s `HIT`; Cabinet Decisions module page
    0.72 s cold, 0.12 s `HIT`; Morning Brief module page 28 s/504 → 4.2 s from stored rows.
    Morning Brief, Statement Tracker and Economic Overview landing counts can answer 502
    "unavailable" at 4.2 s (never cached): they are live-only modules with no stored copy, and the
    live fetch finishes on the server a few seconds later (Morning Brief: 502, 502, then 200 with
    219 reports about 24 s later). Corrected 2026-10-14 by the F156 measurements; the retry is F156.
  - Not in this phase (F156): one call per desk for its counts, new-tab start-up (`App.jsx`,
    `userStore.js`), re-encoding `public/images/desks-v6`, Vite `json.stringify`.

- [x] **F157. State desk landing downloads 26 whole modules to count them.** Done 2026-10-14 (`791b01e`, pushed `701e22d`). Live: `/api/state-landing` answers 0.7–0.9 KB per module (booth modules were about 110 KB each), 0.15–0.37 s, edge `HIT` on repeat; browser check on the local copy: 26 count requests, 29 KB raw in all, no whole-module downloads. Found by the F156
  measurements: at least about 440 KB compressed per State landing visit; the other seven desks
  have count-only routes. Recommended: a count-only `/api/state-landing` like the others.
  - 2026-10-14, built, not yet committed or deployed: `/api/state-landing?feature=…`
    (`server/stateLandingSummary.mjs`, `stateLandingAnswer` in `src/lib/stateLandingSummary.js`),
    on the F154 edge allow-list and in the Vite middleware, read through
    `serveFeatureFeedWithBackup` as the State landing's `/api/feature-feed` requests were. It
    answers the 26 configured modules (Local-tier booth modules included, in the catalogue's
    tier); the 15 planned modules are still summarised in the browser without a request.
    `useStateLanding.js` and the catalogue search's State summary use it, with `landingRetry.js`
    for counts pending after the live time limit.
    - Same numbers and labels: the server reproduces the browser's fallback (a feed answer with no
      real rows was replaced by the shipped archive, which has no register for these modules).
      `src/lib/stateLandingParity.test.js` compares the new answer with the old browser summary for
      every module, with live sources answering in time, failing, and past the time limit. Run live
      against a local dev server, 26 of 26 summaries were identical.
    - Measured locally (dev server from the worktree, live sources on), the 26 requests of one
      State landing visit: before, 4.2–4.8 MB raw, 677–725 KB gzip, 542–578 KB brotli (the two
      booth modules about 110 KB each); after, 29.6 KB raw, 17.8 KB gzip, 14.2 KB brotli (each
      answer at most 1.1 KB). Loader wall time 5.5–11.3 s before, 0.5–1.3 s after. Per route after:
      median 47–81 ms, slowest 0.2–0.7 s (news modules).
    - Change in behaviour: a count whose live source misses the 4 s limit now shows
      "Loading live count…" and is asked for again at 6 s and 15 s (before: "Measured data
      unavailable"); if still missing it shows "Summary unavailable" with Retry.

- [x] **F158. The Goa booth geography pack is in every terminal visit's JavaScript.** Done 2026-10-14 (`9faeade`, pushed `701e22d`). Live: served on its own as `assets/niy-geo-BQCNMAF0.js` (122 KB gzip), fetched only when a geography module opens; browser check on the local copy: not loaded on the State landing, loaded when Booth Political History opened (1,731 rows shown). Found by the
  F156 measurements: `niy-geo.json` costs 120 KB compressed whether or not a booth module opens.
  Recommended: load it only when a booth module opens (`archiveFeed.js`).
  - 2026-10-14 (task/geo-pack-lazy, awaiting review): `archiveFeed.js` now loads the pack with
    `import()` inside the geography branch, so it is its own chunk (`niy-geo-*.js`, 378 KB / 119.7 KB
    gzip) fetched only when a booth or state electoral-roll module opens. Measured with
    `npm run build`: the shared `AiMarkdown-*.js` chunk fell from 215,264 to 95,290 B gzip, and a
    terminal visit's first view (entry, `TerminalShell`, `PersonaChooser`, `AiMarkdown`) from
    702,541 to 582,570 B gzip (-119,971 B). The entry chunk is unchanged (220,773 B gzip; the pack
    was never in it), so the baseline is not changed. If the chunk fails to load, the module shows
    its error state. `npm run check:bundle` now fails when the pack is not in its own chunk or a
    chunk imports it statically; tests in `src/lib/archiveFeedGeoLazy.test.js`. The server copy
    (`server/featureFeed.mjs`) is unchanged.

- [x] **F159. Module pages show developer wording when live data is slow or fails.** Owner,
  2026-10-14: "On a couple of modules in national, it's showing that the 4-second limit has passed
  ... This kind of error is not very user-friendly." Also an error card "Something went wrong ·
  feature-feed HTTP 404 · Retry" (Policy Pipeline Tracker, local server stopped). Cause: F154's
  archive answer put its reason in `source.note`, which the module banner, the side panel and the
  State/Sports/Entertainment landing details show, and a module page did not retry the way F156's
  landing counts do.
  - 2026-10-14 (task/friendly-feed-errors, awaiting review): the server's archive answer says
    "Showing the latest stored records. Live data is still loading." / "The live source isn't
    responding. Showing the latest stored records." / "Live data is taking longer than usual." and
    keeps the reason in `source.diagnostic` (`server/featureFeed.mjs`). A module page with nothing
    stored shows "Live data is taking longer than usual. Retrying…", asks again at 6 s and 15 s (the
    landing schedule), then "This module couldn't load right now." with Retry; with stored records
    on screen it asks once after 8 s and swaps in live rows ("Updated live.")
    (`src/desks/moduleLiveRetry.js`, `DeskView.jsx`). Retries stop when the reader leaves; paged
    modules and genuine failures are not retried. The error card and the desk landing chart show
    plain words and log the reason with `console.warn`; a backup pack is described as stored
    records. Tests: `moduleLiveRetry.test.js`, `deskViewLiveWait.test.jsx`,
    `railLiveWait.test.jsx`, `deskLandingError.test.jsx`, additions to `featureFeed.test.js` and
    `featureFeedTimeLimit.test.js`, each shown to fail without its code.
  *Done 2026-10-15: owner checked on production; an independent review then found the stored-records retry answered from the edge cache and the old wording in two tooltips. Fixed in `4cb1ade`: answers served from stored records stay 5 s at the edge with no stale window (the retry 8 s later reaches the server); a failed live attempt is marked `liveFailed` and not retried; the public `source.diagnostic` holds codes only (`timeout`, `upstream-error`, `no-stored-records`, `backup-error`), the raw reason goes to the server log; Morning Brief and Statement Tracker log the diagnostic instead of a tooltip; the error card no longer blames the reader's connection for a server error. Checks: new tests red then green, lint, build, router import, 5,451 Vitest tests. Not changed: `shortFail` still passes unrecognised text into status rows for all modules.*

- [x] **F171. The bug programme.** Owner 2026-10-14: "Regarding the bugs, I'll follow your order.
  Ideally, we need to fix all of it." [Spec](../specs/2026-10-14-bug-programme.md) and
  [plan](2026-10-14-bug-programme.md): B1 to B22 in order (source links, chat uploads, chat
  connection recovery, file size, legal pages, SheetJS, Live TV, planned modules, desk count,
  reasoning usage, log redaction, desk-filter spellings, document titles, then measurements and
  small closures). Starts after F169 phases 2 and 3. Owner decisions taken as recommended.
  - 2026-10-15: B19 done (F35, migration 51 live); B20 done (F41, latency routing, v60).
  - Done 2026-10-14: B1 source links (F89), B2 chat uploads (F172), B3 dropped connection (F66), B4
    file size (F62), B5 legal pages (F108), B6 SheetJS (P12), B7 closed into its accepted risk (F44),
    B8 Live TV (F7), B9 planned modules (F173), B10 desk count (F30); 2026-10-15: B11 (F67), B12 (F36),
    B13 closed (F39), B14 (F52), B15 (F61), B16 (F80), B18 (F31). Left: B17 (F47, closed 2026-10-15 on a local check), B19 (F35, a measurement on a local replica), B20 (F41, a paid provider trial), B21
    (F37, parked with F170), B22 (F59, a signed-in viewer measurement).
  *Closed 2026-10-15: owner "the bug programme is complete". B17, B19, B20 and B22 are done (see above and `coordination.md`); B21 (F37) stays parked with F170.*

- [x] **F192. Hindi interface: the page language and the toggle's name.** Done 2026-10-15 (`9a66bf3`, `63398e1`).
  The document's `lang` stayed `en` while the interface was in Hindi, and the EN/HI toggle had no
  accessible name (local check 2026-10-15, `docs/research/2026-10-15-local-signed-in-checks.md`).
  Now the shell sets `lang` to `hi` or `en` with the toggle and puts back the page's own value when it
  unmounts (`src/shell/interfaceLang.js`); the toggle is named "EN, switch the interface to Hindi"
  (in Hindi mode "HI, इंटरफ़ेस अंग्रेज़ी में बदलें"), so its name starts with its visible text.
  Checks: the new tests failed before the change, and the wiring test fails with the shell's effect
  removed; lint, build, 5,429 Vitest tests; independent review approved. Not checked in a browser
  (the shell needs a signed-in local stack). Possible follow-up, not opened: in Hindi mode,
  English-only content (dataset names, feeds) is now read with a Hindi voice unless marked `lang="en"`.

- [x] **F197. AI counts from desk rows: an unknown filter field returns a silent zero (D3, 2026-10-15).**
  "How many Lok Sabha bills in 2026" answered 0 (truth 23, 11 assented): `search_desk_rows` filters are
  exact JSON containment, so an invented field (`year`) matches nothing and the model reports zero as
  fact. Fix: reject unknown filter fields with the module's real field list, and support a year or date
  range on the module's date field. [D3 record](../research/2026-10-15-d3-paid-live-round.md).
  *Done 2026-10-15 (`71f4897`, migration 56 `20261015210000_desk_rows_date_range`, research-chat v62): a filtered zero checks the module's real fields and returns an error listing them for an unknown field; `date_from`/`date_to` on the row date; a case-insensitive retry only when the exact match finds nothing; a valid zero is reported as "0 matching rows for …". Production re-run: "23 bills … 11 assented", matching the register.*

- [x] **F198. Changing model or reasoning mid-conversation breaks the thread (D3).** The last answer
  vanishes from view (it is saved) and the next send fails "Your research session changed" until Reload.
  *Done 2026-10-15 (`ea78041`): the cause was the account being re-announced (tab focus, token refresh) during the thread's account check, which dropped the re-read answer and cancelled the send; the same account now keeps the send and retries the check. Red-then-green integration tests; not reproduced in a signed-in browser.*

- [x] **F199. High reasoning on a document question can outrun the server's time limit (D3).** Gemini
  Flash · High was cut off at 108.7 s after reading 40 passages; the answer is lost (not charged). Bound
  the passages or the reasoning budget so a turn finishes, or save what was written.
  *Done 2026-10-15 (`71f4897`, research-chat v62): the turn deadline is 120 s; the agent keeps 45 s for the answer, stops a call with no text at that line and answers at low effort from what it has, and caps passages at 24,000 characters at high effort. Production: Gemini Flash · High answered the count question in about a minute.*

- [x] **F200. Small chat issues found in D3.** Escape closes the whole panel instead of the open menu; a
  greeting gets a full structured brief opening "Search widened."; one click on a listed source reloaded
  the desk and re-showed the desk tour (not reproduced); a model listed under its raw id
  "gpt-luna-latest"; the owner's admin account cannot pick GPT – Astra (plan gate; decide whether
  admins bypass it).
  *Done 2026-10-15 (`ea78041`, `71f4897`): Escape closes an open panel menu first (checked on production); the desk tour waits for the account before deciding (it re-showed on any reload); an empty or id-only model label shows a readable name ("GPT Luna Latest", checked on production); greetings get a one-to-three-sentence reply with no search. The one-off reload on a source click is most likely a deploy landing mid-session (the viewer chunk reloads the page once). Admins bypass model plans (owner 2026-10-15, `a0c1216`): GPT – Astra selectable on the owner's admin account on production; research-chat checks `is_platform_admin()` as the caller.*

- [x] *Done: every cause shipped (`b9830fa`, `c05db22`, `dec0e08`, `c8aa5b2`, `af03724`, `3cfe20c`, `eaab332`, `6657958`, `d4c0054`); cause 6 is F160's. 2026-11-10 (F299)* **F202. Module data quality (owner 2026-10-15: "Is this feed even true? What about the other
  modules and fields?").** [Audit](../research/2026-10-15-module-quality-audit.md) of all 117 modules
  on production: 31 OK, 60 minor, 23 major, 3 broken. Causes and fixes:
  1. LIVE badge is the default and fires on the word "live" in any note: 28 stored modules show LIVE
     (`src/lib/dataState.js`). Fix: LIVE only for positively live answers.
  2. State Governance Brief prepends 40 undated national PIB releases; PIB dates are fetched only by
     the national modules; Policy Pipeline shows unfiltered PIB. Fix: PIB out of State Governance, PIB
     dates wherever PIB stays, Policy Pipeline filtered.
  3. Name-built searches stored in the data files break Municipal Watch and Panchayat Watch ("Watch").
  4. National or unguarded searches: State Cabinet, Governor Assent, CAG, HC judges, ICJ, District
     Media, State Governance. Fix: title guards as F196's curated modules have.
  5. No age limit or headline de-duplication on news (rows from 2017–2020 under LIVE).
  6. Store not serving yet (timer on since 2026-10-15; serve after the comparison day); modules with
     no stored copy can come back empty.
  7. Stored data files: bill dates a day early (time zone), 19 leaders stored as titles, expired
     tenders marked Open, Isometric rows undated, constitution names as slugs (data-migration task).
  8. Column setups that do not match the data (Centre-Sanctioned Projects, MLA Report Card, District
     Performance, Energy); resolved prediction markets and 9999 dates; raw HTML entities; Goa-only
     modules unlabelled; "Vernacular" modules that are English news; State Tender shown as configured.
  Owner 2026-10-15: all recommendations approved, including the data-file fixes (cause 7) as a
  data-migration task with an exact inventory. Also from the owner's review: the AI record brief takes
  the format of the code-written blue box (brief, why it matters, watch for, tags) and that box is
  removed (one analysis box per record); "Source date" and "Last verified" fall back to the dataset's
  as-of and our fetch time.
  - Done 2026-10-15: cause 1 (`b9830fa` badge, `c05db22` source line) and cause 8 (`3cfe20c`: columns
    match the answers, only open prediction markets and play money labelled, Goa modules named Goa, no
    "Vernacular" claim, State Tender Aggregator planned, table cells decode HTML entities; desk-brief
    redeployed for the module list). Checks: lint, build, router import, 5,779 Vitest (an earlier run
    under load from parallel agents had 10 failures that pass alone and in a quiet rerun).
  - Done 2026-10-15, brief format (`eaab332`): the AI record brief is the analysis box (brief, why
    it matters, watch for, tags; JSON from Claude Haiku 5.5, format 2), the code-written box is gone
    where the AI card shows, and Source date / Last verified fall back to the dataset's as-of and our
    fetch time, labelled. Migration `20261015240000_record_brief_format` applied, desk-brief
    redeployed; old briefs regenerate once on their next open (about $0.0002 each). The prompt also
    forbids "suggests/indicates", repeated bookkeeping fields and advice (5 Haiku samples, $0.0009).
  - Done 2026-10-15, news relevance (`dec0e08`, causes 2–5): State Governance without national PIB
    rows; PIB releases dated wherever PIB stays; Policy Pipeline keeps only policy releases (it is
    honestly empty when PIB's latest 20 have none); curated searches and headline guards for
    Municipal, Panchayat, State Cabinet, Governor Assent, CAG, HC judges, ICJ, district courts and
    media, the Assembly digest and the wires; age windows; one row per story, reworded copies
    included (five shared content words covering 55% of the shorter headline; the eight rewordings of
    one Kerala resolution fold into one). Live probe: every module but Policy Pipeline 80%+ on-topic
    in its top 20. *2026-10-16 (`c8aa5b2`): same-event rewordings fold further (Guv/TN/number words; a
    shared count and proper name; 18 more same-event merges and none wrong on ~1,480 live headlines;
    "LG gives nod to 6 bills" vs "six bills" still two rows); Climate Newswire says "N stories in the
    last 30 days"; the AI & Tech PIB filter keeps technology-industry releases only; the UK and
    Netherlands leaders' notes about the previous government blanked (addendum in the data-file
    inventory).* Closed cleanup 2026-10-17 (`6657958`): removed 57 inventoried duplicate feature-map
    source fields. The registry fields are actually read by admin/provenance consumers and remain;
    the earlier blanket claim that both files were unread was incorrect.
  - Done 2026-10-15, data files (`af03724`, cause 7; inventory
    [2026-10-15-data-file-fixes](../research/2026-10-15-data-file-fixes.md)): 9,819 bill dates are
    the source's IST day; 19 heads of state named from Wikidata (as of 2026-10-15); expired stored
    tenders read Closed (in code); 14 Isometric rows dated; constitution names readable (in code).
    desk_rows reloaded for Bill Passage, Policy Intelligence Graph, Heads of State and Carbon
    Registry Wire (9,817 + 9,817 + 43 upserted / 1 pruned + 24 / 13); analysed, 34,183 rows.
    The remaining leader source-link UI was closed 2026-10-17 (`d4c0054`, integrated `0e970f4`):
    exact Wikidata item links with safe new-tab behavior, generic/unsafe links absent.
  - Checks for each: lint, build, router import, full Vitest (5,794 / 5,862 / 5,875), Deno 1,134,
    SQL fixture record_brief_format (vacuity and Down).

- [x] **F201. RBI Handbook registers keep only the newest whole years per table.** One store page is
  500 figures, so 85 of 152 tables drop older years (e.g. table 176 keeps 480 of 12,565 figures, and
  its newest year alone is over 500, so 4 indicators including "Outstanding Liabilities" are left out;
  table 95 keeps 16 of 21 indicators). Full history needs several store variants per table (by year
  range) and a year picker. Older years remain on RBI's table pages.
  Planned 2026-10-15 ([spec](../specs/2026-10-15-rbi-handbook-full-history.md),
  [plan](2026-10-15-rbi-handbook-full-history.md)): full history is 101,277 figures (+36,832 store
  items, est. 40–60 MB); recommended: keep one variant per table read whole (up to four 500-item
  pages), split only tables 176 and 151 into whole-year blocks, no migration; T1–T11 with checkpoints.
  Owner 2026-10-15: approach approved; full history shown by default; a Year control on the Cross-State
  Comparison; and the AI must be able to query the figures ("Isn't that the entire point: AI should
  query over it") — added as T9b: load the full handbook into desk_rows for search_desk_rows.
  *Done 2026-10-16 (`c18110f`, review fixes `dec9411`): every figure stored (101,277; Tables 176 and 151
  in whole-year blocks), served whole from the store (Table 176 p95 264 ms), a Years control on
  block tables and a Year control on the Cross-State Comparison; database +80 MB (1,733 MB). Production
  steps and probes: coordination.md, 2026-10-16. An independent review found two defects before go-live,
  both fixed with tests (the Year control offered years the server ignored; `years` values could
  multiply live RBI fetches and kept answers).*
  - [x] **T9b production: the handbook in desk_rows for the AI.** Owner 2026-10-16: no vectors for
    tabular figures; structured search. *Done 2026-10-16: 102,569 rows loaded (desk_rows 34,183 →
    136,752; database 1,733 → 1,882 MB); catalogue `f96a7d7` lists the eight modules with every table
    title, fields and year forms (State-desk prompt +~3,500 tokens), and the tool description and prompt
    allow a year filter on handbook rows; research-chat redeployed (deployed copy matched main first).
    Production question in the owner's tab (Gemini Flash, 48 s, 63.2 credits): Maharashtra's GSDP
    2019-20 at current and constant prices (Tables 21, 22) and the highest 2023 outstanding liabilities
    (Tamil Nadu ₹7,58,931.5 crore, Table 176, from "state debt") — every figure equal to desk_rows.
    Seen: the answer's Gaps section asserted the 2023 figures are provisional, which the rows do not say.*
  - [x] **Before the 2026-27 edition is loaded: stable block names.** *Done 2026-10-16 (`3d577f3`):
    block names are unchanged; the loader finds every stored block of a split table (orphans of an
    unfinished cleanup included), prints one statement that switches the new blocks on and obsolete ones
    off, never deletes, and exits 4 until consistent; a re-cut block that the shrink guard refuses is
    named with its finish command (no auto-repeat past the guard). Yearly steps: dry run with
    `--target prod`, `--apply … --force`, repeat for a named re-cut block, run the printed statement,
    re-run for exit 0. Optional later: an admin RPC `feed_set_block_serve` and a variant listing in
    place of the printed SQL and the probes.* Original finding: `yearBlocks` groups newest-first, so
    one new year renames most older blocks; a shrunk block is refused and keeps serving last edition's
    years, and obsolete blocks keep `serve` on until the printed SQL is run. Group oldest-first or have
    the loader switch new blocks on and obsolete ones off in one step (review finding 3).
  - [x] Optional review completed 2026-10-17 (`81912bd`, `acadaa2`, `8cd624c`): exact-year gaps,
    immediate previous period across blocks, only necessary pages, and financial/survey interval
    overlap. No handbook reload or corpus change. Live January–March 2020 search returns exact
    2019-20 financial-year rows; TOTAL 446.

- [x] **F215. Fixtures & Results — World Leagues: its source is failing.** *Done: the same fix as T6 (`acadaa2`, integrated `0e970f4`). 2026-11-10 (F299)* Found 2026-10-17 in the
  milestone check ([status](../research/2026-10-17-live-module-status.md)): 14 consecutive failed
  runs since the last good fetch at 2026-10-16 18:35 UTC ("TheSportsDB did not return Premier League,
  NBA, IPL or La Liga"); 16 failures and 4 timeouts in 24 hours. The stored copy (7 rows) is still
  served and stops at the 7-day stale ceiling, about 2026-10-23. Find out whether TheSportsDB changed
  its free endpoints or rate limit, then fix the adapter or move to another source.
  Rollout 2026-10-17 (`acadaa2`, integrated `0e970f4`): documented public configuration
  repaired, all four leagues checked; first scheduled run at 10:40 UTC succeeded with 7 items
  and reset failures to zero. Closure awaits three real hourly opportunities under T15.

- [x] **F160 rollout status 2026-10-17:** *Closed: a status note; its one remainder is T15. 2026-11-10 (F299)* code, compatibility SQL, exact constitution key repair,
  MLA reference transition and serve-on are complete. Local/bundle/browser/production probes pass.
  Remaining: T15's three real post-rollout refresh opportunities across source intervals. First
  fixtures and MLA checks succeeded, zero unexplained high-failure sources. District Performance
  remains deliberately planned/off; real MLA scorecards and additional sources stay M3.

- [x] **F160. Serve module data from the database, filled by scheduled jobs (ingest, then serve).** *Done: ADR 0012, the feed-record migrations (`20261015150000_feed_records.sql` and those after it) and the store-serving fix (`ffbc8ff6`); leftovers T2 to T7 are ticked. The live refresh check stays under T15. 2026-11-10 (F299)*
  [Spec](../specs/2026-10-14-scheduled-module-data.md) written 2026-10-14. Owner's answers the same
  day: the timer every 5 minutes, not every minute; the other recommendations adopted. Now phase 4
  of F169.
  Owner 2026-10-14: "eventually we would keep this as part of our database … a combination of both
  live pull and data-backed entries." Today a visitor's request pulls the live source (4 s limit),
  the edge keeps the answer 5 minutes (stale up to a day), and the shipped archive is a fixed
  snapshot. Recommended: background jobs fetch each source on a schedule (15 minutes to daily) into
  `desk_rows` (34 modules, about 34,000 rows there today for AI search); pages read the database
  and show "updated N min ago"; live sources are touched only by the jobs. Start with live-only
  modules (Morning Brief, Statement Tracker, news wires). Needs a spec and the owner's go-ahead;
  after or alongside O6.

- [x] **F161. Credits wording.** Done 2026-10-14 (owner: "approved, push it"): all nine approved changes — the Free card and Plan & billing no longer call AI free; model access on every plan card; "Top-ups coming soon. Need more credits now? Write to niyantranai@gmail.com." always shown until O6; the blocked chat message says to upgrade or write in; the Terms state paid-only models and no automatic renewal; the refund policy drops the mandate sentence. Guards in `publicPlans.test.js`, `legalPolicies.test.js`, `PlanBilling.test.jsx`, `CreditBalance.test.jsx`. Was: From the credits audit 2026-10-14:
  - Free is described as "every desk and the AI research assistant at no cost"
    (`src/lib/publicPlans.js:10`, `src/shell/PlanBilling.jsx:169`) although Free is 1,000 credits
    once and paid models are locked.
  - A user who runs out is not told how to get credits before O6: add "write to us for more
    credits" beside "Top-ups coming soon" and on the blocked state (`CreditBalance.jsx:66`).
  - "Top-ups coming soon" shows only while plan checkout is closed (`PlanBilling.jsx:71`); it should
    depend on top-ups being on sale.
  - Terms and refund policy describe automatic renewal and a payment mandate
    (`legalPolicies.js:123,155`), against the no-auto-renew decision; the Terms say "Other models use
    credits on every plan" (`legalPolicies.js:120`) although paid-only models exist (F150), and
    pricing never mentions model access.

- [x] **F162. Credits clarity.** Done 2026-10-14 (owner: "do F162 and F163 and push"): credits held for a running answer show beside the balance in the chat and in Plan & billing ("N credits held for a running answer"); an account with no allowance is warned at 200 credits or fewer (`LOW_BALANCE_WITHOUT_ALLOWANCE`, 10% of Plus's 2,000), without "this cycle". Was: From the credits audit: credits held by a running answer are not
  shown; the low-balance warning never shows without a monthly allowance (top-up-only users,
  `creditsStore.js:258-263`). The word "wallet" is internal only; users see "AI credits", the
  balance, "Credits by expiry" and "Credits usage". Size S.

- [x] **F163. Questions note reads like an internal note.** Done 2026-10-14: now "Search covers all 8,000 questions. Answers are not in this dataset yet, so \"Has answer\" shows Not reported." (`src/lib/shapeQuestions.test.js`). Was: "Answer text is missing on every row in
  this archive — Has answer stays Not reported until Sansad answer fields are wired."
  (`src/lib/shapeQuestions.js:55-56`, there since 2026-09-09). Owner asked whether it was new: it
  is not. Recommended: "Answers are not yet in this dataset" or hide it until answers are loaded.

- [x] **F165. Technical words left on other screens.** Done 2026-10-14 (owner: "do F165 and push"): every desk's landing cards, the module header ("complete list · stored copy" instead of "exhaustive · sync backup"), Home, the record panels, the critical-minerals note and the side-panel overview tiles (`src/lib/analytics.js`) now use plain words; data and status matching unchanged. Browser check on the local copy: Global, Economics, Carbon, Sports, Home and a module page show no developer terms. Was: Found while building F164 (2026-10-14), not
  in its scope: other desks' landing card text (Global "Reporting search / RSS", Economics "PIB RSS
  reporting" and "existing adapter", National "not a live ECI API", Carbon "The API response
  blends…", the Sports sector card "not yet available in the existing adapter"); the module header's
  "exhaustive · sync backup / sync present" labels; the critical-minerals board note ("unless the
  pack supplies them"); `HomeDesk.jsx` "nter.news feed not configured on this build" and the
  latest-news note; the record panel's `reporting_search` field ("GDELT DOC 2.0 — …").
  Recommended: the same display-only treatment with `plainSourceNote.js`. Size S–M.
  - 2026-10-14 (task/plain-words-rest, awaiting review): status matching is unchanged (`dataState.js`
    and `refreshFeeds.js` read the same notes). Landing cards in plain words on every desk ("News
    stories found by a news search and outlet feeds…", "Press Information Bureau releases…", "not
    live Election Commission data", "This source mixes live Verra publications with stored
    entries…", "the governance register is not available yet"; "workspace overlays" and "fallback"
    gone). The module header reads "500 rows · 4,104 in the full list · stored copy" or
    "2 rows · complete list · to the present" (`completenessLabel`, `freshnessLabel`; a capped stored
    copy is no longer called complete). The Critical Minerals note says "when the source does not
    give them". Home shows "No nter.news headlines yet" / "nter.news headlines aren't available right
    now" (the server's note kept as the title) and "waiting for stories", "NEWS SEARCH · LIVE". The
    National record panel says "Found by a news search, not an official dataset." instead of the
    `reporting_search` tile (`plainReportingNote`). Sweep: the record panels name sources plainly
    ("News search", "BBC World feed", "PIB release feed", "Website", "stored on the platform",
    "benchmark set", "latest stored copy", "not a full history"), the side-panel warning, Transit,
    Industry, Commodities, Global Aid, Policy Graph, the bill and manifesto panels and the loader.
    Left: the side panel's overview tiles from `src/lib/analytics.js` ("GDELT" source tile, "outlet
    RSS", "extracted pack"), outside this sweep; module names ("Order Archive by Topic",
    "Candidate Affidavit Database (Structured + API)" as an id); Live TV "archive"; admin and legal
    pages. Tests: `landingPlainNotes.test.jsx` (every desk), `deskViewPlainNotes.test.jsx`,
    `homePlainNotes.test.jsx`, `recordPlainNotes.test.jsx`, `railPlainNotes.test.jsx`,
    `plainSourceNote.test.js`, each shown to fail without its code; adapter tests that pinned the
    old wording updated.

- [x] **F164. Live source notes are technical.** Done 2026-10-14 (owner: "do F164 and push and merge"): `src/lib/plainSourceNote.js` turns technical notes into a plain source line on screen ("Live · 24 stories from BBC World"); the data and status matching are unchanged; the original note is kept as a `title`. Checked in a browser on the local copy (Geopolitics News Wire, Morning Brief). Was: Seen 2026-10-14: Geopolitics News Wire shows
  "GDELT paced ≥5s; primary DOC 2.0 search retries on the next refresh … rate limited"; Morning
  Brief and Statements show "GDELT wire unreachable…" and "PIB releases arrive through the backend
  (/api/rss)…"; landing detail cards repeat source notes; planned/offline state cards mention
  archives and hosts. Recommended: show a plain source line ("Source: BBC World") and keep the
  technical note in `source.diagnostic` (as F159 does). Size M.
  - 2026-10-14 (task/plain-source-notes, awaiting review): the feed data is unchanged
    (`refreshFeeds.js` and `dataState.js` read `source.note` word for word); screens pass notes
    through `src/lib/plainSourceNote.js`. A note without technical wording (hosts, paths, files,
    GDELT/DOC 2.0, RSS, API, proxy, backend, adapter, archive, backup, pack, fallback, pacing,
    seconds, rate limits, error text, internal identifiers) is shown as written; from a technical one
    only the plain sentences are kept, after a plain source line such as "Live · 24 stories from BBC
    World", "Latest stored records" or "Stored records from the published source". The original
    stays as the line's `title`. Used on the module page (feed-head note, strip labels such as
    "TOP WORLD STORIES — BBC WORLD", the stored-records banner), the planned/offline state card (no
    "Configured host"; sources listed by name as links), the side panel (source note, banners), the
    desk landing chart source, the record panel's fallback source, Morning Brief and Statement
    Tracker banners ("This section couldn't load right now."), and the State, Sports and
    Entertainment landing detail cards (the summary's `limitations` uses the plain note; the
    original is kept as `sourceNote`; four Sports and three Entertainment card texts no longer say
    RSS, fallback or adapter). Board notes and other notes written for readers are not changed.
    Tests: `plainSourceNote.test.js` (real notes from production answers and the code),
    `deskViewPlainNotes.test.jsx`, `railPlainNotes.test.jsx`, `landingPlainNotes.test.jsx`,
    `briefPlainNotes.test.jsx`, each shown to fail without its code.

- [x] **F111. AI credits.** Done 2026-10-14: enforced for everyone (`787bced`; migrations 47–49 live). Follow-ups: F155, F160–F164, O6. Was: Plans sell AI credits, but no credit ledger,
  allowance or enforcement exists; research-chat only logs USD cost. Needs the
  owner's credit definition, then a spec (ledger, allowances per plan, unused
  credits carried forward, enforcement in research-chat, NYAI gating to
  Pro/Max).
  - 2026-10-14: TenderBase's credits system reviewed against its code
    ([research](../research/2026-10-14-ai-credits-reference-review.md)).
    Take its log-then-trigger ledger; avoid its defects (last-round-only
    billing, broken renewal after overspend, free stopped turns, no chat
    reservation).
  - 2026-10-14: owner decisions taken; the
    [spec](../specs/2026-10-14-ai-credits.md),
    [plan](../plans/2026-10-14-ai-credits.md) (the working log, with
    progress) and [ADR 0011](../decisions/0011-per-user-credit-ledger.md)
    are approved.
    - Code starts on the owner's word.
    - Task 0 is done: the median answer costs 21 credits, and the dearest
      301.
    - A design review (`security-auditor`) found 3 critical and 10
      important issues; all are fixed in the spec.
    - The owner settled the last two questions: a failed turn that still
      showed text is charged, and credit history is deleted with the
      account.
  - 2026-10-14: built on `task/ai-credits`, local only, nothing deployed.
    - Tasks 1–6 are done, with two reviews (1R and R) fixed.
    - Local runs 1 and 2 (server, then the browser at desktop and phone
      width) both passed.
    - Remaining:
      - task 7 (pricing and policy wording, awaiting the owner's approval);
      - the production steps in the plan, each on the owner's go-ahead:
        migration, functions in shadow mode, push, a shadow week, then
        enforcement.
  - 2026-10-14, later: **enforced for everyone** (owner: "remove the entire shadow concept"):
    the secret `CREDITS_ENFORCED=1` and research-chat v56, then the shadow code removed in
    `787bced`.
  - 2026-10-14: **live in shadow mode** (superseded the same day).
    - Shipped: migration 47, research-chat v54, transcribe-audio v2, and the
      push `2a85579..80aeaa6`. Task 7's wording is live.
    - Remaining:
      - the shadow-week check on or after 2026-10-21;
      - then enforcement for everyone (owner: "we should enforce it").
    - The steps and the check queries are in the plan's "After launch"
      section.
  - Owner decisions (summary):
    - 1 credit = 10 paise of AI cost.
    - Free gets 1,000 once (30 days). Plus 2,000, Pro 6,500 and Max 75,000 a
      month.
    - 10% of unused credits roll over for one cycle.
    - Top-ups are valid 12 months.
    - Failed turns are free, and Stop charges the part used.
    - Briefs and dictation are free.
  - transcribe-audio calls a paid model with no `model_call_logs` row (plan
    task 3).
  - For O6: a downgrade must start at the next cycle, but `grant_paid_plan`
    starts a different plan at once.

- [x] **F147. Admin user list paging.** Done 2026-10-14 (`1336047`): pages of 100, search by email or name, the header shows the directory total. The directory reads every profile in
  one request (and every wallet, in pages). Recommended: page it 100 at a
  time with search, once there are more than 300 users.

- [x] **F148. Plan & billing dark mode.** Done 2026-10-14 (`a964eb4`): dark styles from the app's tokens, contrast ≥ 4.5:1 tested. The panel, its credits section
  included, has light styles only. A small CSS task for the next UI polish
  pass.

- [x] **F149. Open an answer from Plan & billing.** Done 2026-10-14 (`a964eb4`): rows open the chat in the AI panel (`niy-open-conversation`). Recent answers are plain
  text, because no route selects a conversation. Recommended: a
  `niy-open-conversation` event, like `niy-open-billing`.

- [x] **F150. Model access by plan.** Done 2026-10-14 (`787bced`). Owner: Free gets Gemini Flash-class, DeepSeek, GPT Luna and Claude Haiku; GPT Terra, Sol, Astra and Claude Sonnet and Opus need a paid plan; new models default to paid; Gemma is off. `ai_models.min_plan`, enforced by research-chat (403, including the failover chain) and shown in the picker. Was: One Claude Sonnet
  answer costs about 170 credits, and a Free account can leave one answer
  of debt unpaid. Recommended: tier-3 models on paid plans only.

- [x] **F151. Credit estimate in the model picker.** Done 2026-10-14 (`787bced`, `a964eb4`): `model_credit_estimates()`, measured median or list price. Was: Show "≈ N credits a
  typical answer" per model beside the cost diamonds. After enforcement.

- [x] **F152. Leaked-password protection (owner's dashboard action).** Done 2026-10-14: the owner switched it on; the Supabase security advisor no longer reports it. Owner 2026-10-14: will switch it on. The Supabase security advisor flags it as off (Auth → Passwords).

- [x] **F153. Credits usage page.** Done 2026-10-14 (`0d5671a`; migration `20261014233000_credit_usage_reports` applied; pushed `3d0a0d8`). Owner 2026-10-14: a separate page like TenderBase's (AI
  activity card, AI analytics with charts and legends, all AI activity, credits by expiry) plus a
  small version in Plan & billing; built from the owner's screenshots.
  [Spec](../specs/2026-10-14-credits-usage-page.md). Next after the speed work.
  Built as specified: the full-screen page (activity, analytics chart, all AI activity with CSV,
  credits by expiry), the small version in Plan & billing, the profile-menu item and the chat
  chip's Usage link; the §12 amendment is in the credits spec.

- [x] **F155. Admin can set a model's plan.** Done 2026-10-14 (`cf5231c`; migration `20261014234500_admin_model_plan` applied; `admin-models` v15). Was: The owner adds new models from the admin AI models
  page; it needs a plan selector (`admin_models_upsert` + `admin-models` + the allowlist editor) so
  each model's `min_plan` is chosen there. New models default to paid until then. Credits audit
  2026-10-14: still missing (`admin-models/handler.ts` leaves out `min_plan`; no selector in
  `AllowlistEditor.jsx`). Size S; deploys the `admin-models` function.
  - 2026-10-14, built on `task/admin-model-plan` (not yet applied or deployed): migration
    `20261014234500_admin_model_plan.sql` replaces `admin_models_upsert` (same signature, SECURITY
    DEFINER, `search_path ''`, service_role only) so a model row may carry `min_plan`: only
    `free`/`plus`/`pro`/`max` (anything else, null included, is refused with 22023), a new model
    without it gets `plus`, an existing model without it keeps its plan; no stored plan changes.
    `admin-models` passes `min_plan` through and answers 400 for any other value; its list already
    returns the column. The AI models page has a Plans selector per model ("Free and paid plans",
    "Paid plans", "Pro and Max", "Max only") saved with the row's Save, a note while a change is
    unsaved, and a selector beside "Add from catalogue" that starts at "Paid plans". Evidence: SQL
    fixture `supabase/tests/admin_model_plan.sql` (with vacuity check), Deno and Vitest tests. To
    go live: apply the migration, then deploy `admin-models`.

- [x] **F99. Reconcile public pricing copy and inventory retired commercial UI.** Pricing page done on `task/pricing-inr` (2026-10-12): owner INR plans, no GST, no unsupported claims; see the legal-policies spec. Remaining: retired commercial UI inventory below, and billing alignment (F109). Free signed-in desk access is implemented, but src/lib/pricingStore.js still advertises five core desks in public pricing. UpgradeModal.jsx has no production importer; copyPolicy.js has test-only references; onboarding.css retains unused niy-plan-wait styling. These are outside the approved terminal/signup scope. Decide marketing scope and exact removal inventory before changing them; billing history and AI limits are not removal targets.
  *Done 2026-10-15 (`f664612`, owner: "fix the loose ends"): `src/shell/copyPolicy.js` and its test and the unused `.niy-plan-wait` style removed; the pricing copy and retired screens were already done.*

- [x] **F76. Owner browser acceptance of dictation.** F74 production activation completed; verify real signed-in microphone → editable transcript in both Ask AI and command search, permission refusal and grouped production record search. Synthetic English/Hindi OpenRouter probes and deployed auth/CORS passed; authenticated browser full path is not yet exercised. [Release evidence](2026-10-04-dictation-activation.md).
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

## 1. Done

- [x] **F354 — `eval-retrieval.mjs --compare` printed "no worse" when it had compared nothing.** Found 2026-11-16 in the Regulatory load ([record](../operations/2026-11-16-regulatory-load.md)); traced 2026-11-18 (executed): with a feature-only baseline and a feature-only run, `judgeNoWorse` in `src/lib/retrievalEval.js` compared no mode, and the call and latency checks alone passed. Built 2026-11-18 (`6f9590c0`), independently reviewed (accept with changes; the report heading fixed): a mode that ran is compared with the same mode in the baseline, any question leaving the first 10 fails the verdict, and a verdict that compared no required mode fails. Run read-only on NTER against the pre-load baseline it reports "worse" and names the lost questions. Open from the review, optional: a partial baseline stops the script with an error instead of a verdict; a set of only ambiguous questions still passes. Those two stay unbuilt. The load record carries a dated correction. *Done 2026-11-18: pull request #174, `5204ed30`.*

- [x] **F328 — A provider outage still fails every document of a claim.** Found 2026-11-12 in the F301 review (read from code): after a shared embedding call fails, each solo call makes its own three attempts; during an outage (429, 5xx or a network error) all fail, so every job is failed permanently as before, after extra logged calls. Consider releasing the jobs with no error on those errors while the deadline reserve allows, so the queue's backoff retries them. *Ready to design. 2026-11-12* **Developer decision, 2026-11-15:** on a provider outage (429, 5xx, network error) release the jobs with no error while the deadline reserve allows, so the queue retries them. *Built and merged in PR #158 / `6f56aa5c`; `ingest-worker` deployed to NTER 2026-11-17 ([record](../operations/2026-11-17-ingest-worker-deploy.md)).* On 429, 5xx or a network error the batch step returns the unfinished jobs to the queue as `embed_outage` with backoff, and one failing document no longer stops the claim. Edge Function suite on 2026-11-17 with main merged in: 1,859 passed, 0 failed. Not exercised on NTER: no job has run through this version and no outage has been seen with it; that rests on the tests.

- [x] **F326 — A job that fails again after its one requeue blocks its batch for good.** Found 2026-11-11 in the F291 design (read from code): `ingest_batch_requeue` refuses a job with `requeues` 1 as `failed_after_requeue` and stops the batch (`20261102130000_batch_registration.sql` 1174-1175), and a batch is `indexed` only when every admitted job succeeded (1086). Neither resume nor the proposed F291 fix clears it. Decide: a second requeue under a recorded decision, or a way to close a batch with named failures. *Ready to design. 2026-11-11* **Developer decision, 2026-11-15:** allow a batch to be closed with its failed jobs named, under a recorded decision; no second automatic requeue. *Built and merged in PR #159 / `a85a6cfb`; migration `20261115090000_batch_close_and_failure_count` applied on NTER 2026-11-17 ([record](../operations/2026-11-17-batch-close-apply.md)).* `ingest_batch_close` closes a batch with its failed jobs named. Fixture `supabase/tests/ingest_batch_close.sql`; bulk runner tests on 2026-11-17 with main merged in: 618 passed, 0 failed. The SQL fixture was not run locally that day (Docker was not running); CI runs it. Not exercised on NTER: closing a real failed batch (none exists); that rests on the fixture.

- [x] **F327 — The batch failure rate counts only jobs failed now.** Found 2026-11-11 in the F301 design (read from code): `failure_rate` is failed / (failed + succeeded) over current statuses (`20261102130000_batch_registration.sql` 874, 891), so a requeued job leaves the count and earlier failures are hidden. Decide whether the rule should count failures ever seen. *Ready to design. 2026-11-11* **Developer decision, 2026-11-15:** count failures ever seen, so a requeue cannot hide an earlier failure. *Built and merged in PR #159 / `a85a6cfb`; migration `20261115090000_batch_close_and_failure_count` applied on NTER 2026-11-17 ([record](../operations/2026-11-17-batch-close-apply.md)).* The failure rate counts failures seen since the last recorded resume (`ingest_jobs_count_failure`). Fixture `supabase/tests/ingest_batch_close.sql`; bulk runner tests on 2026-11-17 with main merged in: 618 passed, 0 failed. The SQL fixture was not run locally that day (Docker was not running); CI runs it. Not exercised on NTER: closing a real failed batch (none exists); that rests on the fixture.

- [x] **F291 — A strict batch cannot recover after a kill.** Proved by E1 (2026-11-06). When a killed claim leaves more uncertain jobs than `uncertain_max`, the claim does not stop the batch; `ingest_batch_requeue` then refuses as `uncertain_count` and stops it; `ingest_batch_resume` keeps the policy snapshot, so requeue is refused again. Requeue is the only thing that lowers the count, so no job can move. Design a way out before a large batch. 2026-11-11, design (read from code, not run): the claim does stop the batch when it still has due jobs (`ingest_register_batch.sql` fixture, lines 630-640); the tracker's wording holds only when the killed claim held every remaining job, as in E1. Either way resume keeps the policy snapshot and nothing lowers the count. At Bills settings (`max_running` 16, `uncertain` 20) two worker kills in one batch reach it. Recommended: `ingest_batch_resume` takes an optional `requeue_failed` flag and requeues, in the same transaction that clears the stop, every failed job with no requeue yet, with the usual ledger entries; one migration, no function deploy; a new fixture on the `ingest_register_batch` chain (estimated 5 to 10 more minutes of the SQL job, so F302's split first). Awaits the developer's choice. 2026-11-12: built (`30eaa1b5`), not applied to NTER: migration `20261112090000_batch_resume_requeue` gives `ingest_batch_resume` an optional `requeue_failed` flag; with it, in the transaction that clears the stop, every failed job of the batch not yet requeued is requeued as `ingest_batch_requeue` does one, and the result says what moved (`requeued`), what did not (`left_failed`, `blocking_jobs`), what is still running and whether the batch is `still_blocked`. Without the flag the function does and returns what it did. Fixture `ingest_batch_resume_requeue` (6 s, vacuity proved). The builder's trace corrects the 2026-11-11 note: when the killed claim held every remaining job, the claim does not stop the batch; the first requeue does. An independent review accepted it with changes, all applied except an automatic Down check in `run.sh` (done once by hand: after the Down block the function body, privileges and settings equal the current ones). Not closed by this: a job that fails again after its one requeue (F326). Requeued uncertain jobs are embedded again; the spend counts against the batch's estimate. Applied to NTER on 2026-11-12 with its history row, after a rolled-back dry run ([record](../operations/2026-11-13-release.md)). Not exercised on a real stopped batch.

- [x] **F287 — Ingestion onto partitions proved at load.** Merged 2026-11-06 in PR #100 / `5538314d` ([results](../research/2026-11-06-ingestion-load-proof.md), [disk plan](../operations/2026-11-06-nter-disk-plan.md)). The worker runs end to end on every partition by both write paths, at about 13,970 bytes a chunk, so National v1.1 is about 8.8 GB. Local only: the first validation batch is still its own test. Findings are F290 to F294.

- [x] **F276 — Billing fixtures tied to the calendar; legacy renewal arithmetic.** Closed 2026-10-31.
  - **Fixtures:** on 31 Oct every SQL fixtures run failed, main included. Fixed in PR #81 / `ac0477b4`: renewals now expect the code's chained arithmetic, and manual cycle 8 is minted at a fixed date.
  - **Audit:** all three suites ran on fake clocks from 1 Nov 2026 to 29 Feb 2028. Two more date-dependent tests were found and fixed in PR #84 / `97683eeb`: the "away for three months" fixture, and the Manifold market tests, which would have failed from 1 Jan 2027.
  - **Legacy grant retired:** customers were never affected, because checkout renews on the anchor day. The uncalled legacy `grant_paid_plan`, the only code that chained months, was dropped. PR #82 / `c175e33b`; NTER migration `20261031165846 retire_grant_paid_plan`. See the [evidence](2026-10-31-retire-grant-paid-plan.md#applied-2026-10-31).

- [x] **F257 — Cross-desk record/document mapping and corpus reconciliation.** Released in PR #62 / `8f01b348`; see [production receipt](../operations/2026-10-28-corpus-repair-review/release.md).

- [x] **F258 — Large-feature search false emptiness.** Released in PR #62 / `8f01b348`; see [production receipt](../operations/2026-10-28-corpus-repair-review/release.md).

- [x] **F259 — Enforce retrieval boundaries without implicit widening.** Released in PR #62 / `8f01b348`; see [production receipt](../operations/2026-10-28-corpus-repair-review/release.md).

- [x] **F260 — Reject empty successful answers.** Released in PR #62 / `8f01b348`; see [production receipt](../operations/2026-10-28-corpus-repair-review/release.md).

- [x] **Published AI personas for all users — 2026-10-28 (`88140bd3`, PR #61).** Owner-authorized rollout: active users consume their own published persona; only active platform admins manage drafts, tests, publication and rollback. Migration applied, admin-personas v2/research-chat v106 verified, global consumption enabled, all six prompt hashes/revisions preserved. Full local app/Edge tests and required CI jobs passed; production frontend assignment remains behind the protected merge checks. [Spec](../specs/2026-10-28-persona-global-rollout.md), [release evidence](2026-10-28-persona-global-rollout.md).

- [x] **F243 — Globiz NCLT listing released.** PR #14 merged `258827a0`; branch, PR and main app/SQL CI passed. Production domain serves 435 rows; guarded one-row mirror correction applied. Company/case searches return exactly one order. All 434 old rows and Globiz document/80 chunks/job fingerprints unchanged. No re-ingestion or paid calls. [Evidence](2026-10-23-globiz-listing.md).

- [x] **Law release verification prerequisite — landed `1cd6d38b` / `ff13a953`:** remove the calendar expiry from the existing feedServeRoute test fixture (two failures reproduced on October 23); test-only relative date, no feed runtime changes. Tracked with the [five-document release plan](2026-10-23-law-five-pilot.md).

- [x] **Five real Law documents pilot — released `ff13a953`, 2026-10-23.** [Client instructions](../operations/law-five-pilot.md), [plan](2026-10-23-law-five-pilot.md). Portable pinned extraction and offline adapter test passed on five actual NCLT sources: 97 pages, 241 chunks; 15 adapter negative checks and one corrupted-record rejection passed. Hosted 5/5 succeeded;241 chunks fully verified; semantic top1 searches 5/5; exact rerun same IDs/fingerprints and no new calls/spend. Migration/three functions deployed; CI branch/PR/main green. Client guide finalized. Larger batches remain excluded.

- [x] **F241 — Public Live checkout.** Runtime e7317a8d, PR #7 merged d74798be; branch/PR/main CI both required jobs pass. Production dpl_7nu9FCu5vH6XGppSMPzKsoufD9DY READY and domain assigned. Live config enabled/open; unauthenticated401, unsigned webhook400. Keys and webhook events unchanged. Real Live payment and signed delivery remain unverified under O6. [Evidence](2026-10-22-public-live-checkout.md).

- [x] **F240 — Restricted Live pilot and closed Production release.** Gate `792aab3e`, PR #6 merged as `f8eabcbf`; both main CI jobs passed, Production deployment `dpl_2ozSNjA5VH4umSwqHfHqADQ3ZNaP` automatically assigned www.nter.pro. Runtime config enabled=false, checkoutOpen=false, empty key; unauthenticated order401. Owner-only Live UUID configured; Live credentials unchanged. [Evidence](2026-10-21-closed-live-pilot.md).

- [x] **F239 — Git-triggered CI release path recovered and verified.** Preview `792aab3e` and Production `f8eabcbf` both observed pending alias while CI ran, then automatic assignment after both required checks passed. No bypass/settings changes. Original delayed-event cause remains unproven; no claim of a provider root-cause fix. [Evidence](2026-10-21-closed-live-pilot.md).

- **F238 — Refunded unused top-up provenance and customer status.** Runtime05907f12 released to Razorpay Test Preview through passing required CI checks. Approved migration activated; browser review removed only the original untouched20,000-credit lot once, companion acknowledgement changed no benefits, exact retry made no second debit. Other lots/invoice fingerprints and Max expiry unchanged. Browser history shows Refund recorded without pending review. Production checkout remains closed. [Evidence](2026-10-21-unused-topup-refund.md).

- [x] **Frontend default icons (2026-10-19).** c748e26 deployed Production READY. Both icon paths200/image MIME;46 frontend asset checks pass; Chrome32 successful requests and empty Console after reload. Evidence and remaining unrelated DevTools issues: [release record](2026-10-19-frontend-icons.md).

- [x] **Research citation/web repair implementation (2026-10-19).** 4a1c978:
  current selection anchors retrieval; pinned rows carry tier and server-verified
  handles; exact-anchor citation repair preserves prose; one bounded web-only
  fallback and truthful unverified notices. Local6293 app/1172 Deno tests pass.
  Existing PDF/Text viewer verified in owner Arc; hosted activation/acceptance
  remains open above.

- [x] **Production research recovery implementation (2026-10-19).** Main8f72418:
  refresh saved answer after terminal verification, including initial-read race;
  one bounded structured-output correction before visible text. No second turn,
  retrieval replay or credit reset. Acceptance remains tracked above.

- [x] **F230. Combine profile and credits controls.** Source7756c67, owner
  accepted local UI and authorized push/merge/deploy2026-10-18. Credit ring
  surrounds avatar; Account contains all prior credit details, warnings/retries
  and the same Credits route. No backend or credit calculation change.
  Guards4 red before green, focused49/full6268 pass; lint/build/bundle pass.
  Browser fixture desktop/mobile/dark, dismissal/focus, quiet refusal/retry and
  route pass. Independent review found no blocking source issues. Branch
  CI39131057499 app/SQL passed attempt1; merged main and deployed
  dpl_AbnvcMevyeMwtL71YxpoeoMMsTZg READY at7756c67. Public assets verified on
  www.nter.pro and retained Vercel alias. MainCI39131455379 app/SQL passed
  attempt1; zero5xx in bounded deployment request scan. Evidence in
  [Release record](2026-10-18-profile-credit-summary.md#authorized-release--2026-10-18).
  Scheduled M1/M2 checks continue; Razorpay held, corpus excluded.

- [x] **F229. Full selected-record pane animation.** Source8a33c19, released
  fae886b2026-10-18 after explicit owner approval. Adapted, generic National and
  fallback records show one native-size pane loader while loading/writing/pending;
  Close stays available, normal details return on settlement. Hook/provider/
  cache/timing/billing unchanged. Guards9 red before/22 green after, focused86,
  full6264, lint/build/bundle pass. BranchCI39128091215 app/SQL pass attempt1;
  production dpl_J3uHbqrdoHcJSoK3cGyEBqvLjgX2 READY; updated loader CSS verified
  on both aliases. MainCI39128436114 app/SQL pass attempt1.
  Browser visual check unavailable due Arc control; limitation disclosed before
  owner release approval. No paid call, backend, corpus or payment change.
  [Release evidence](2026-10-18-record-pane-animation.md#authorized-release--2026-10-18).

- [x] **F228. Homepage/sign-in presentation.** Source4e739b1, releasedfae886b
  2026-10-18. Removed hero/header CTA arrows; enlarged homepage globe/orbits5%,
  shifted desktop scene24px left, increased role names/descriptions with fixed
  line boxes, reduced sign-in globe5%. Mobile globe/sign-up preserved. Owner
  accepted local homepage preview; follow-up tweaks explicitly approved for
  release. Full6264 tests, lint/build/bundle pass; production CSS smoke checks
  pass on custom and retained aliases. Same release/CI evidence as F229.

- [x] **F227. Supabase Auth redirect cleanup.** *Closed2026-10-18,
  evidence0cc7198.* Owner applied nine-entry allowlist: broad all-Vercel wildcard,
  malformed entry and obsolete bare root removed; exact retained Vercel root/
  reset added. Site URL, four custom entries, scoped preview and localhost
  preserved. Live no-follow invalid-token checks11/11 pass; unrelated Vercel
  destination accepted before and rejected after. Owner confirms reload persists
  all9 URLs and Google sign-in/recovery/reset/sign-in pass after cleanup. No
  source deployment needed; D2 unchanged, T15 independent/open.
  [Evidence](../research/2026-10-18-f227-auth-evidence.md).

- [x] **F226. Policy Pipeline stored landing summary.** *Done2026-10-18,
  source441343e, released6c08b48.* Only this National summary selects the
  existing stored-first loader in both routers; fetch/stale provenance retained.
  Both production URLs return200/count3, matching their module;16/16 National
  resources pass, post-release request scan zero5xx. Four regressions failed
  before fix;18 new/102 focused,6242 app/1155 Deno, lint/build/bundle/router pass.
  Branch/main CI39120245451/39120540412 pass both jobs attempt1 (including SQL).
  One local paging timeout passed isolated and full retry at unchanged limits.
  No filter/data/schedule/serve/Edge/payment/corpus change.
  [Evidence](../research/2026-10-18-nter-domain-launch-evidence.md).

- [x] **D2. nter.pro application launch.** *Done2026-10-18, planning commits
  a84175c/6711578, release/evidence6c08b48.* Namecheap BasicDNS and Vercel team/
  hostname ownership verified; HTTPS www serves the existing production project,
  apex308 to www; niyantran-six retained. Old site remains available at
  niyantran-weld.vercel.app (owner-controlled mutable alias, no deletion).
  Auth/CORS prepared and verified; owner confirms sign-in, recovery-email,
  password reset and subsequent sign-in. Saved history and two-message pilot
  survive reload; exactly one USD0.000533 call/5.0635-credit charge reconciles
  balance3309.553→3304.4895, no duplicate charge/grant or active hold.
  F226 fixed before closure. Final20/20 CORS, home API, disabled checkout,
  current release, unchanged10 Edge versions/hashes and bounded no5xx gate pass.
  Known DNS resolver caches, Node DEP0169 and build-size warnings recorded;
  Auth allowlist follow-up is F227. No additional paid call or backend data/
  timer/ingestion change. T15 remains independent/open; Razorpay held.
  [Spec](../specs/2026-10-18-nter-domain-launch.md),
  [plan](2026-10-18-nter-domain-launch.md),
  [execution evidence](../research/2026-10-18-nter-domain-launch-evidence.md).

- [x] **F225. Redenominate AI credits to one paisa before payments.** *Done
  2026-10-18 IST (`679921a`, released through `de51434`).* Owner approved
  push/deploy and controlled backfill. Migrations `20261017194626` /
  `20261017194628` applied separately; compatible production deployment
  `dpl_99ho6FyZMshn7f5HECTbpqyMydsM` READY. All three wallets, lots and debt
  reconciled at 10x while paused; original 20 ledger rows, 17 draws, 92 cost
  mappings, 18 holds and entitlements fingerprint-identical. Writes resumed
  only after checks at 20:34:28 UTC October 17. Legacy stored values/rates
  remain immutable; usage/answer projections use the current unit. Allowances
  10k/20k/65k/750k, INR prices/dates unchanged. 6,224 app / 1,155 Deno tests,
  44 SQL fixtures with vacuity, lint/build/router/bundle/browser gates pass;
  branch/main CI 39066720672 / 39066765071 green on attempt 1.
  [Spec](../specs/2026-10-18-credit-paise.md),
  [plan](2026-10-18-credit-paise.md),
  [production reconciliation evidence](../research/2026-10-18-credit-paise-evidence.md).
  Top-up prices were subsequently confirmed by the owner; the catalogue is
  recorded under O6 in current one-paisa units. Razorpay planning authorized
  2026-10-18; local implementation and later Test-branch publication separately
  approved; hosted migration/activation still gated. Corpus excluded;
  M1/M2 T15 remains independent/open.

- [x] **F221. Feed timeout tests release their own live producers.** Landed
  `389dbed` (2026-10-17): disposable source stubs reject pending and fallback
  requests, tracked real/custom loaders settle before fetch/timers restore.
  Two real-loader regressions failed with original teardown (0→1 / 1→2 calls),
  pass after disposal; preference source and all 36 assertions unchanged.
  Full 6,194 Vitest / 1,155 Deno, lint/build/bundle/router pass. Branch CI
  39052609249 and main CI 39052960359 app/SQL passed attempt 1; production
  dpl_EC2dNBS1rX9ZPrcEBJDJydXmoqWh READY at exact 389dbed. Details recorded
  in [F221 evidence](../research/2026-10-17-f221-test-isolation-evidence.md).
  Test-only: no backend/data/SQL/corpus/payment change. T15 remains open and
  hourly closure monitoring ACTIVE.

- [x] **F224. Bound Growth Indicators requests and diagnose source failures.**
  Runtime `0074991`, owner approved implementation/push/deploy 2026-10-17.
  Growth alone uses sequential series, 6-second attempts / 18-second active
  total, one bounded transient retry per series; host queue time excluded.
  Safe per-series logs, cancellation and HTTP-body cleanup; no partial success
  or replacement on failure. Existing worker budgets/host limits/schedule and
  source/country/value contracts preserved. New guards fail on original runtime;
  final 128 focused / 6,192 Vitest / 1,155 Deno, lint/build/bundle/router pass.
  Branch/main CI 39048250037 / 39048651791 passed app/SQL on attempt 1.
  Production READY. First live probe failed truthfully on unemployment after
  GDP/CPI succeeded; a later live GET recovered, 200/20 rows exactly matching
  stored values. Store fingerprint/fetch time and all ten Edge Functions unchanged.
  Natural post-deploy writer acceptance is explicitly pending under T15 at the
  next daily refresh, not claimed from public reads. Hourly monitoring ACTIVE,
  corpus excluded, payment held. [Spec](../specs/2026-10-17-f224-growth-budget.md),
  [plan](2026-10-17-f224-growth-budget.md),
  [evidence](../research/2026-10-17-f224-growth-budget-evidence.md).

- [x] **F223. Use stored data for MLA Directory and MLA Profiles landing summaries.**
  Done 2026-10-17 (`0c1319c`), owner explicitly approved implementation/push/deploy.
  Both routers reuse the existing stored-first loader for exactly these two
  features. Summary fetch/stale metadata preserved; safe validated-feature
  diagnostics added. Original runtime fails nine new guards; final focused
  143 tests, full 6,166 Vitest / 1,155 Deno, lint/build/bundle/router pass.
  Production READY `dpl_8cMAHjxjfBroGdaPLeHz1MwNuJdp`: both summaries/modules
  HTTP 200/store with matching notes/fetch times and 496 sampled Directory rows
  (4,104 full stored records) / 500 Profiles rows. Store fingerprints and all
  ten Edge Function versions/hashes/settings unchanged. No migration, forced
  refresh or production data/timer change. Exact feature names of the original
  two 13:08 failures remain unknown. F221 and T15 stay open; corpus excluded,
  payment held, hourly closure follow-up active.
  [Spec](../specs/2026-10-17-f223-state-summaries.md),
  [plan](2026-10-17-f223-state-summaries.md),
  [evidence](../research/2026-10-17-f223-state-summaries-evidence.md).

- [x] **F222. Retain upstream Manifold market IDs in feed rows.**
  Done 2026-10-17 (`294a273`, released at `e1a5557` with owner push/deploy approval).
  Optional bounded `market_id` passes through both mappers and existing JSON
  storage, preserving keys/filters/variants/dates. Real 13:10 UTC refresh:
  204 Political Odds / 17 Election Forecast items, all distinct IDs, zero new
  item keys; both public APIs 200 from store with all IDs. All 598 prior-day
  snapshots retain their exact fingerprint. No schema, backfill, forced refresh,
  timer or Edge Function change. Local 206 focused / 6,147 Vitest / 1,155 Deno
  tests pass; lint/build/bundle/router pass; branch/main app+SQL CI pass attempt 1.
  Final documentation CI/deployment verified after push; F223 separately records
  two state-landing 502s outside this change. Closure monitor active, corpus
  excluded, payment held.
  [Spec](../specs/2026-10-17-f222-manifold-identity.md),
  [plan](2026-10-17-f222-manifold-identity.md),
  [evidence](../research/2026-10-17-f222-manifold-identity-evidence.md).

- [x] **F220. Fractional watchdog cutoff restores high reasoning effort.**
  Done 2026-10-17 (`256f042`), research-chat v66 ACTIVE. Controlled clocks prove
  the timer can cut 0.75 ms before the boundary; the checkpoint now retains
  reserve entry across replacement calls/provider retry. Null/absent overrides,
  caller abort, active streaming and independent turns preserved. Nine F199
  cases pass ten independent executions; old runtime fails four guards.
  Full Deno 1,155 and Vitest 6,126 pass; branch/main CI first-attempt green,
  including SQL. Exact deployed diff is only agent.ts; authentication/CORS and
  all unrelated functions preserved. T15 observations and separate F221 remain.
  [Spec](../specs/2026-10-17-f220-answer-reserve.md) ·
  [plan](2026-10-17-f220-answer-reserve.md) ·
  [evidence](../research/2026-10-17-f220-answer-reserve-evidence.md).

- [x] **F218. Satellite Infrastructure landing summary bypasses usable feed-store data.**
  Done 2026-10-17 (`0e2ebfb`): both routers use the canonical stored-first loader
  for this summary, preserving fetched time/stale markers and existing fallbacks.
  Production deployment `dpl_GFrsGgPzU3A8mjzmHuGUoYrcQeaX` READY; landing and module
  both return 12 stored launches with fetched time `2026-10-17T11:15:01.824Z`.
  6,126 Vitest / 1,150 Deno tests pass; branch/main CI first-attempt green,
  including 41 SQL fixtures/vacuity and 10 Down checks. Desktop/mobile browser
  verifies count and navigation. Other summaries retain their existing loaders;
  no broad shared-register change or corpus/payment work.
  Later documentation-only CI exposed F220, now fixed separately in `256f042`;
  F218 code/source and production checks remain unchanged.
  [Spec](../specs/2026-10-17-f218-stored-summary.md) ·
  [evidence](../research/2026-10-17-f218-stored-summary-evidence.md).

### Login/logout race released — 2026-10-18

- [x] **F233. Fix login/logout passive-verification race.** Runtime fix
  `66cc4f2`, merged/released with evidence as main `68c4aff`. Passive refusal
  grants no authority and emits no false logout; genuine logout/account/token
  invalidation protections retained. Causal regression,6,288 app/1,155 Deno
  tests, lint/build/bundle and independent review passed. Branch CI39138273293
  and main CI39138686342 app+SQL green attempt1. Production READY deployment
  dpl_5B3sUpd4zBEoLz3kAJCmGsifsNv6; Arc real password sign-in verified three
  times with two intervening logout → public home → sign-in cycles, no reload
  between cycles and no verification error. No credentials read/exported,
  provider/model calls or Supabase settings/function/schema changes.
  [Spec](../specs/2026-10-18-login-logout-race.md) ·
  [Production evidence](2026-10-18-login-logout-race.md#production-verification--2026-10-18).
  M1/M2 T15 remains open; hourly checks ACTIVE, Razorpay held, corpus excluded.

### Warning fixes released — 2026-10-18

- [x] **F231. Reduce large JavaScript chunks through real load boundaries.**
  Landed `f158aa8`, released on main `cd0e14d`. Home-route gzip down25.4%
  locally; production TerminalShell495.71kB, largest xlsx499.55kB, no chunk
  advisory. Production initial180,869B gzip below unchanged182,446B budget.
  App/SQL CI branch39134798867 and main39135220208 green on attempt1.
  [Spec](../specs/2026-10-18-bundle-node-warnings.md) ·
  [Release evidence](2026-10-18-bundle-node-warnings.md#production-verification--2026-10-18).

- [x] **F232. Remove deprecated lazy URL-parser path.**
  Landed `32c611e`, released on main `cd0e14d`. Causal legacy-helper tests,
  routing/query compatibility and full suites pass. Two uncached live router
  probes returned expected404; bounded deployment runtime scan zeroDEP0169
  and zeroerrors, versus eightDEP0169 entries on the prior deployment in1h.
  Ongoing monitoring continues; this is bounded evidence, not a guarantee about
  every dependency/path. Same release evidence as F231. No Supabase changes.

### M1/M2 implementation and rollout — 2026-10-17

- [x] **F210. `researchThreadIntegration.test.js` is flaky in CI.** Found 2026-10-16: "a TOKEN_REFRESHED
  for the same account while a send is checked does not fail the send" saw the server called 3 times,
  not 2, on CI run 38818354932 (commit 56f42d2); it passed 6 of 6 locally and on the next CI run.
  A timing assumption under a busy runner; make the test wait on the send, not on time.
  - Again on CI run 38828313006 (commit 05cc82d, no `src/ai` changes): attempt 1 failed the SIGNED_IN
    and TOKEN_REFRESHED cases (server called 3 times, not 2); attempt 2 failed "changing the model and
    reasoning after an answer…" with `SyntaxError: "undefined" is not valid JSON`. The file passed 5 of 5
    locally on the same commit.
  - Also failed locally (SIGNED_IN and TOKEN_REFRESHED cases) in a full `npm test` on 2026-10-16 during
    F213, then passed 3 of 3 run alone: it is load-sensitive, not CI-only.
  Done 2026-10-17 (`8d6dec5`, integrated `0e970f4`; final source `d63192b`):
  all three actual post-fix CI runs passed first attempt, without retries/cancelled runs/empty commits.

The items below are integrated/released; T15 owns the remaining multi-day observations.
Evidence: [cleanup execution record](../research/2026-10-17-m1-m2-cleanup-evidence.md).

- [x] **T0 (M1/M2):** safe baseline, reproducible defects and measured initial assets. Integrated/released 2026-10-17 (`0e970f4`); evidence below.

- [x] **T1 (F210):** deterministic research-thread integration tests, preserving ownership checks. Integrated/released 2026-10-17 (`8d6dec5`); evidence below.

- [x] **T2 (F160):** retained-item guard and truthful verified-empty source outcomes. Integrated/released 2026-10-17 (`8cd624c`); evidence below.

- [x] **T3 (F160):** caller cancellation while queued, including Music Charts fallback. Integrated/released 2026-10-17 (`acadaa2`); evidence below.

- [x] **T4 (F160):** stable constitution identity, with exact stored-key inventory. Integrated/released 2026-10-17 (`acadaa2, 0e970f4`); evidence below.

- [x] **T5 (F160):** bounded, complete latest-run pagination beyond 2,000 accumulated items. Integrated/released 2026-10-17 (`8cd624c, acadaa2`); evidence below.

- [x] **T6 (F215):** diagnose/repair World Leagues fixtures and preserve four-league coverage. Integrated/released 2026-10-17 (`acadaa2`); evidence below.

- [x] **T7 (F160):** reliable MLA Profiles reference serving; no scorecard/source expansion. Integrated/released 2026-10-17 (`acadaa2`); evidence below.

- [x] **T8 (F201):** exact selected-year comparisons and immediate comparable previous period. Integrated/released 2026-10-17 (`81912bd`); evidence below.

- [x] **T9 (F201):** whole-variant reads request only necessary handbook pages. Integrated/released 2026-10-17 (`acadaa2`); evidence below.

- [x] **T10 (F201):** exact-period and overlapping-range handbook filtering; inventory any required
  handbook-only repair separately. Corpus ingestion remains excluded. Integrated/released 2026-10-17 (`8cd624c, 81912bd`); evidence below.

- [x] **T11 (F216):** grounded qualifications, focused guards and behavioral evaluation evidence. Integrated/released 2026-10-17 (`73cfd87, 00aaf99`); evidence below.

- [x] **T12 (F202):** inventory and remove only proven unused stored searches. Integrated/released 2026-10-17 (`6657958`); evidence below.

- [x] **T13a (F208):** lightweight public catalogue identity/counts, separate terminal schema. Integrated/released 2026-10-17 (`e5f45c2`); evidence below.

- [x] **T13b (F208):** preserve deferred search/navigation and lower measured bundle baseline. Integrated/released 2026-10-17 (`e5f45c2`); evidence below.

- [x] **T14 (F202/M2):** show the selected leader's real Wikidata item link. Integrated/released 2026-10-17 (`d4c0054`); evidence below.

- [x] **F208. The desk catalogue puts every module's columns in the first-load bundle.** Found in F207,
  2026-10-16. `src/desks/landing/deskCatalogue.js` imports `feedColumns` (`src/lib/columns.js`, 40 KB
  of source) and the full feature map, so a signed-out visitor downloads them. Load them with the
  terminal instead, then lower the baseline.
  Done 2026-10-17 (`e5f45c2`, integrated `0e970f4`): public initial JS 229,274 -> 185,438 B gzip including globe; desktop/mobile search and production homepage checks pass.

- [x] **F216. Research answers state caveats the data does not.** Seen 2026-10-16 in the F201 T9b
  production question: the answer's Gaps section said the 2023 outstanding-liability figures are
  provisional, which the desk rows do not say. Rule for `research-chat`: a gap or caveat must come from
  a returned row, document or tool result, or be worded as unknown. Prompt change plus a test;
  redeploy after diffing the deployed source.
  Done 2026-10-17 (`73cfd87`, `00aaf99`; research-chat v65): all five frozen rubric cases have passing faithful evidence (four on v64; corrected page/TOTAL case on v65). Total authorized evaluation cost $0.03677325; failed batches preserved.

- [x] **F217. Morning Brief fixture clock ages out.** Found 2026-10-17 during M1/M2
  verification: the fixed 14 October RSS date crossed the three-day retention window.
  Owner authorized the test-only fix on 2026-10-17. `src/lib/briefFeeds.test.js`
  now freezes Date at 15 October and restores real timers after each test;
  runtime retention rules are unchanged. Focused 3/3 pass; final integration evidence
  is recorded with T1. Committed locally as `8d6dec5`; final full suite passes. Integration/release closure remains T15.
  Done 2026-10-17 (`8d6dec5`, integrated `0e970f4`): test-only Date clock, runtime retention unchanged; full suite passes.

- [x] **F59. First-traversal and remaining heavy-viewer stutter attribution.** F58 observed isolated 105/55/111ms long tasks and a 650.7ms frame gap whose cause was not established. If the real issue remains reproducible, collect a CPU/render trace, profile full view with thumbnails and signed-storage network timing under fixed conditions before optimizing. Warm loopback scrolling was steady; this is not production performance acceptance. [F58 evidence](../research/2026-10-03-heavy-pdf-profile.md). Safari acceptance remains F50.

## 4. Payments

- [x] **F6.** Plan gating on the server, before real payments (closed 2026-10-14, superseded; see below). Desk data is
  public (static files, and `desk_rows` is readable by any signed-in user).
  Locks, row caps and export limits run only in the browser. The spec must
  settle which data is premium, how premium desks are served (an API behind
  `my_entitlement`, or RLS), server-side exports and API row caps.
  - **Parked by the owner (2026-10-02)** until payments are integrated: "when the payment plan
    is actually integrated, we might have to make changes again."
  - **Closed 2026-10-14 as superseded (owner).** There are no paid desk tiers: plans differ in
    AI credits and in which models they may use (F150). Credits are enforced on the server.
  - **Decisions recorded for then:**
    - core desks stay persona-based and user-editable;
    - the AI assistant respects the same desk locks when it reads desk rows;
    - the desk packs stay public for now.
  - **The access map** (every path to desk data, the client-only rules, and the smallest real
    enforcement) is kept locally in `docs/security/2026-10-02-plan-gating-map.md`, which is not
    published.
  - **Noted there:** the trial row cap (25) is below the free cap (40), and prices are defined in
    both the client and the server.
  *Closed 2026-10-15 (F171 B22): three 12-second scroll profiles of a 250-page, 64 MB PDF on the real
  viewer, first traversal included: 60 fps at p99, no long task, at most 4 canvases; the only
  one-second gaps fell while the page was hidden (`research/2026-10-15-local-signed-in-checks.md`).
  Reopen with the document if a reader reports it.*

- [x] **F47.** Found during the F46 fixes and left out of their scope.
  - **In progress (2026-10-02):** spec `specs/2026-10-02-chat-panel-fixes.md` (approved: the dimming
    is restored), plan `plans/2026-10-02-chat-panel-fixes.md`.
    - **Done:**
      - T1, the live timing word (`ea0e07c`, a `research-chat` change);
      - T2, the region rules and dimming (`4e030e8`);
      - T3, the phone dock (`fabae3a`): the thread goes from 18 px to 318 px at 375 × 812;
      - T4, measured: zero shift at the end of a turn.

      The local run is in `research/2026-10-02-chat-panel-fixes-local-run.md`.
    - **`research-chat` v45 deployed** on 2026-10-02, with T1's frame and the widened limit.
    - **Shipped:** T1–T3 at `da32cb3`; T5 at `c2c3069` (operations record, 2026-10-02).
    - **Noted in the run, then fixed by T5** (`01d1714`, `research/2026-10-02-phone-header-local-run.md`):
      - at 375 px the header fits, with no Log out duplicated in the bar below 900 px;
      - the history list stays on screen (x 57–359);
      - the account menu, clipped below 900 px by the scrolling bar, now opens and works.
    - **Open, an owner design choice:** at 320 px the avatar is still cut, because the actions
      need 212 px and get 172. Closing it costs the wordmark, a button or touch-target size.
  - **Phone width:** the AI dock gets 268 px under the desk at 375 × 812. The composer is clipped
    71 px below it and the thread is 18 px tall. The same happens with the pre-fix CSS.
  - **Dead dimming:** the history-open dimming selectors (`index.css`,
    `.ai-shell.ai-shell-v2.history-open > .ai-v2-body` etc.) match nothing in the research
    shell, because its rows sit inside `.ai-panel-background`.
  - **Live timing word:** it reads "waited" until the saved row replaces it, even when the saved
    row then says "thought". The live stream carries no reasoning count.
  *Closed 2026-10-15 (F171 B17): measured on a local signed-in copy at 320 px, every header action
  fits (avatar x 276–308 of 320, no sideways scroll); the open phone items were fixed by the chat and
  header work since (`research/2026-10-15-local-signed-in-checks.md`).*

- [x] **F188. Google News rows on Geopolitics were labelled "BBC World feed".** *Done 2026-10-15
  (`b5c86cb`, `41551bc`): a Google News kind with the real publisher; a row with a BBC outlet stays BBC;
  a summary that only repeats the headline gets no card; the link says it opens through Google News.*

- [x] **F189. The Google News reroute matched a generated URL.** *Done 2026-10-15 (`c045bfb`,
  `c83cbf2`): an explicit `news-topic` marker in the feature map (16 entries) and the source register
  (118 rows, fallback is the marker or empty); answers compared over 169 modules in three stubbed
  worlds: identical.*

- [x] **F190. MLA Directory had no state picker.** *Done 2026-10-15 (`b049d69`, `b369dae`): a State
  select (All states, or one of 31); a state's request never shows another state's MLAs on the store
  or live path; race-tested; the count is announced.*

- [x] **F179. Status rows claimed a GDELT search.** *Done 2026-10-15 (`f2d2d87`): no answer carries a
  `gdelt` flag, server or client; every client branch that read it was dead (false, or true only on
  failure status rows). Compared over 169 features in three stubbed fetch worlds: identical apart
  from one status row naming news.google.com.*

- [x] **F180. GDELT addresses in the source registry.** *Done 2026-10-15 (`f2d2d87`): 131 registry rows
  and 44 feature-map sources name the routes the loaders take; `isGdelt` removed. The homepage figure
  is F191.*

- [x] **F181. Home Top Stories had no live source.** *Done 2026-10-15 (`d676a14`, `583fe8e`): Google
  News India top stories (owner: "Go ahead with all your recommendations"); production: 38 stories.*

- [x] **F182. The conflict register was labelled an agent snapshot.** *Done 2026-10-15 (`c8aefb1`,
  `8dcec27`, `65d386c`): the register is never saved as a snapshot, the browser fallback skips the
  seed, an agent snapshot needs its own marker, and the health line says "register".*

- [x] **F183. Other PDF readers lacked the character maps.** *Done 2026-10-15 (`c8aefb1`): the page
  viewer passes them; the admin upload reads only page count and encryption, so it gains nothing.
  Legacy Hindi fonts still need OCR (F170).*

- [x] **F185. District Performance Tracker stored malformed rows.** *Done 2026-10-15 (`d676a14`): a body
  that starts as JSON is never read as CSV; production 500 clean rows.*

- [x] **F186. NSE/BSE was scheduled with no live source.** *Done 2026-10-15 (`fb52292`): off the timer
  (`OFF_TIMER`), with the drift test still strict for every other module.*

- [x] **F187. Cabinet Decisions listed a decision twice.** *Done 2026-10-15 (`d676a14`, `3e4487a`): one
  release per decision (`pickReleasePairs`) in the live loader, the store's page and the register load.*

- [x] **F41.** A widened chat turn is slow: on 2026-10-01 a bill question waited 65 s, of which
  Gemini Flash took 46 s on a 25,850-token prompt. Search took 0.6 s. Measure the prompt size
  of widened turns and cap it.
  - **In progress (2026-10-02).** Spec `specs/2026-10-02-chat-turn-cost.md` (approved: "measure,
    then cap"); plan `plans/2026-10-02-chat-turn-cost.md`. It also covers F46's agent-loop cost.
    - **Built:** a widened search asks for 15 passages, and a search reply stops at 24,000
      characters (`0de8178`, `13c050e`).
    - **The benchmark** has a widened kind and per-call prompt tokens (`a76d093`).
    - **Measured** (`research/2026-10-02-turn-cost-benchmark.md`, $2.83):
      - the reply cap missed the narrow depth mark and is off;
      - the widened limit deepens widened answers but does not speed them up;
      - prompt size explains little of call time (r = 0.14).
    - **The slow turn's NTER log** (owner-approved read): the provider was slow, not the prompt.
      One call ran at 21 tokens a second; the next took 18.6 s to write 29 tokens.
    - **Next:**
      - the owner decides on the widened limit;
      - a measured trial of OpenRouter provider preferences (by throughput or latency), which is
        where F41's speed lies.
    - **Routing trial run (2026-10-02, $2.43, 25 questions, no errors):** `thru` and `lat` are
      much faster than `v45`. First word p50 falls from 21.3 s to 8.7 s and 7.4 s; p90 from
      40.9 s to 15.0 s and 10.9 s. Cost falls 15% and 27%. Both miss the depth pass mark on
      briefs: 3.1 and 2.8 searches against 4.5, and 7.8 and 7.3 pages against 8.3. Citations are
      100% valid. By the amendment's rule nothing ships. Results are in
      `research/2026-10-02-turn-cost-benchmark.md`.
    - **Owner discussion open (2026-10-02):** routing, and whether widened searches return to 40
      passages.
    - **Second pass of 40 against 15 (2026-10-02, $0.56):** the first pass's advantage for 15 did
      not repeat. Pooled over 25 question-runs the two are level on depth: documents 1.32
      against 1.44, pages 4.84 against 4.68, the expected document 25/25 against 24/25. 15 is
      1.6 s slower at p50, and costs the same.
    - **Done:** widened searches are back to 40 (owner, 2026-10-02; `2f0c71d`), deployed as
      `research-chat` v46.
    - **Still open:** the provider-routing decision. By the rule nothing ships; the owner has not
      decided.
    - **Re-measured 2026-10-15 on v59 code (about $2.50, `589d577`)**, with the same result, then
      **option 3** (latency routing plus the prompt's coverage check, about $0.83, `93c42b0`): the
      check brings the depth back (brief documents 2.33, expected document 15/15, pages 7.6 against
      8.6) but takes the speed back too (brief total 37 s, as default routing). Nothing ships. The
      owner chooses option 1 (latency routing: briefs in about 20 s, a third cheaper, slightly less
      depth) or option 2 (default routing).
  *Done 2026-10-15 (`0dde63f`, `research-chat` v60): latency routing on every call, owner's choice of
  option 1 (briefs about 20 s instead of 37 s, a third cheaper, about one page fewer cited).*

- [x] **F35.** NTER's unscoped search loses results to its HNSW index.
  Measured 2026-10-01 in `research/2026-10-01-feature-filter-measurements.md`:
  - against an exact search, NTER's top 40 has a recall of 0.913;
  - exact search finds the right document in the top 10 for 170 of 184
    questions, NTER's index for 157;
  - Budget and Industry are lost on NTER's index build.

  Next: measure raising `hnsw.ef_search` for the unscoped branch (100–200)
  with the `eval` harness, on the replica and then live.
  Also measure lowering the feature filter's exact threshold T (15,000)
  so that Regulatory takes the index path. Its exact scan takes 733 ms on
  NTER.
  - **Measured on the replica (2026-10-15, $0,
    `research/2026-10-15-unscoped-search-recall.md`, `435779e`):** `ef_search` 200 finds the right
    document in the top 10 for 170 of 184 questions, as exact search does (40: 162), at about 2 ms
    more p50. Above about 500 the planner switches to an exact scan (11 to 57 s). Lowering T is not
    safe: an off-topic question in Regulatory's scope returns no rows on the index path at any
    `ef_search` up to 400, so it needs an exact fallback first.
  - **Migration `20261015130000_unscoped_ef_search`** (`task/ef-search`): `ef_search` 200 in the
    unscoped branch only, set and restored with `set_config`. Fixture `unscoped_ef_search` (index plan
    asserted; fails at 40 and without the restore). Read-only checks on NTER, 2026-10-15: the live
    body is the repository's apart from comments; at 200 the plan stays on the HNSW index; warm index
    scan 10.0 ms against 7.6 ms at 40. Side effect (review): pgvector returns at most `ef_search`
    candidates, so an unscoped call that lost rows to the `indexed_at` or tier filter now fills its
    40; prompt size per turn can rise slightly against the F41 baselines.
  *Done 2026-10-15: migration 51 `20261015130000_unscoped_ef_search` (`9bafdc1`, `74e6d66`) applied to
  NTER with `supabase db push --linked` after a dry run that listed only it; live check: one overload,
  the 200 constant in the body, grants unchanged, an authenticated call returns 40 rows and leaves
  `ef_search` at 40. Lowering T stays open (needs an exact fallback; not scheduled).*

- [x] **F178. Chat upload follow-ups (review, 2026-10-14).** Messages on the chip were English only and
  sat in a tooltip; CID-font PDFs read as nothing; a second dropped connection started a second
  re-check loop. *Done 2026-10-15 (`096375d`, `35ae106`): the reason a file was not sent and what was
  cut show as visible text, in Hindi too (joined notes sentence by sentence); pdf.js gets its character
  maps and standard fonts from `/pdfjs/` (copied from the installed `pdfjs-dist` at build); one re-check
  per conversation, replaced when a new turn is sent. Not checked with a real CID-font PDF in a browser
  (local signed-in checks). Legacy Hindi fonts and the other PDF readers are F183.*

- [x] **F175. Admin Website settings were per-browser.** *Done 2026-10-15 (A3, `1994396`, `6ff005a`):
  the site name, contact details and search tags are published from code (`src/lib/siteSettings.js`,
  company facts from `COMPANY`); the admin page keeps only the intro video. Visible change: the contact
  email is `COMPANY.email`, as on the policy pages.*

- [x] **F176. Dead GDELT code.** *Done 2026-10-15 (`ad31f52`): removed from the server loaders, the home
  conflict feed and the browser fallback. The browser branch was live: Geopolitics News Wire asked
  GDELT from the reader's browser; that request is gone. Every module's rows and source were recorded
  with the old code and the new, sources up and down: identical (Top Stories drops its false GDELT
  flag). Follow-ups F179 to F182.*

- [x] **F67. Reasoning usage accuracy.** `sendTerminal` in research-chat
  coerces unavailable `row.usage.reasoning_tokens` to zero. Preserve unknown
  versus measured zero and identify observed partial counts explicitly; add
  stream/persisted parity guards before changing this. Read-only finding from
  the owner's F65 annotation; the displayed turn's actual provider usage has
  not been inspected. No backend change or deployment in the styling amendment.
  *Done 2026-10-15 (F171 B11, `de2d1b2`; `research-chat` v59 deployed): unknown reasoning usage is sent as null and a partial count as partial, as the saved row does.*

- [x] **F36.** `_shared/logging.ts` redacts by field name, and any name
  containing "token" is hidden. So `embed_tokens` and other counts appear as
  `[redacted]` in Edge logs (seen in the I7 run). Names containing "key" are
  hidden too: `document_key`, `expected_key` and `key_holder` in `admin-ingest`'s
  logs (C5). Redact known secret names and secret-shaped values instead.
  *Done 2026-10-15 (F171 B12, `de2d1b2`): secrets redacted by exact name and by value shape (Bearer, JWT, sk-), inside arrays too; counts and record keys are logged. Live in `research-chat` v59; the other nine functions take it on their next deploy (several hold undeployed code on `main`, so they were not redeployed for this).*

- [x] **F39.** `research-chat`'s `featureScopeOf` keeps only the first
  spelling of a desk feature (`handler.ts:515-536`). It should collect every
  spelling, e.g. "(RBI / SEBI / TRAI / CCI)" and "(RBI/SEBI/TRAI/CCI)".
  *Closed 2026-10-15 (F171 B13): not reproduced. Read-only SQL: every module has exactly one `desk_feature` spelling in `documents` (Regulatory is stored as "(RBI SEBI TRAI CCI)"), and `featureScopeOf` resolves it. Reopen if a second spelling is ever ingested.*

- [x] **F52.** Some document titles are stored malformed. For example "The Farmers (Old Age
  Allowance Bill,2000" has an unbalanced parenthesis and no space before the year. They show as
  stored in the sources list and the reader. Needs a count over `documents.title` and a decision
  on cleaning at ingestion or at display.
  - **Also found (2026-10-02, research-coverage T1):** some records carry another document's
    title. `4618230e` ("The Airlines (Penalty for Delays) Bill,2005") and `a76358ab` ("The
    Communal Violence(Prevention,Control and Rehabilitation of Victims) Bill,2005") each hold one
    passage of an unrelated 2004 Appropriation Act. Read in the local replica, a copy of the
    legacy corpus; nothing was changed.
  *Done 2026-10-15 (F171 B14, `e91d959`): titles are tidied for display only (unbalanced bracket before Bill/Act/Ordinance, the space before the year, a stray final bracket); versions differing only that way share a sources card. Stored titles are unchanged; the records that carry another document's text (second note above) remain a data task.*

- [x] **F61. Broader tab keyboard audit.** *2026-10-14 (F171 B15): the Nuclear tab component no longer exists (`d25eb24`); Live TV remains.* Review the remaining Live TV and
  Nuclear analytics tab patterns for consistent roles and keyboard behavior.
  Outside the concrete F60 repair scope; coordinate with the next UI brief.
  *Done 2026-10-15 (F171 B15, `e91d959`): Live TV categories are pressed buttons; the lower tabs are tabs with one tab stop, arrows, Home and End, and a labelled panel. Not checked in a signed-in browser.*

- [x] **F80. Existing mobile marketing trivia overflow.** *2026-10-14 (F171 B16): fixed in code by `3717f95` at 768 px and below; 320 px and desktop not yet measured.* Browser at 320/768px has scrollWidth 335/783px. Main's unchanged stylesheet reproduces the 335px trivia block in a minimal browser fixture. Outside the homepage Earth scope; inspect .mkt-trivia-inner sizing before changing it. [Evidence](2026-10-04-earth-replacement.md).
  *Done 2026-10-15 (F171 B16, `e91d959`): border-box at every width; measured on the local copy: no sideways scroll at 320, 768 or 1440 px, the band inside the gutters (16–304 at 320, 24–1416 at 1440).*

- [x] **F31.** `deno.lock` is stale: it still lists `sql.js` (removed in C3)
  and lacks the ESLint packages. Regenerate it in its own commit.
  *Done 2026-10-15 (F171 B18, `e91d959`): `deno.lock` deleted; nothing read it (`"lock": false`); 1,079 Deno tests pass without it.*

- [x] **F172. Files uploaded into AI chat never reach the AI.** Found 2026-10-14 (F171 research,
  read): `requestAttachments` (`src/ai/AiPanel.jsx:171-186`) keeps only attachments with a top-level
  `text`; an uploaded file's text sits under `files[]`, so every uploaded file is dropped without a
  word while its chip shows it as attached. The server's file extraction (`extractBuffer`) lost its
  only caller in `def5f71`. F171 B2.
  *Done 2026-10-14 (F171 B2): text, CSV, spreadsheets and PDFs (page by page) are read in the browser and sent; the AI reads 12,000 characters a file (the prompt's limit, tied by a test) and the chip says so; scanned pages, images, Word and binary files say "Not sent". Commits `7f28aeb`, `7d432c5`. Follow-ups are F178.*

- [x] **F173. Four unbuilt modules are not marked planned.** Found 2026-10-14 (read): Sports
  Governance & Policy, Election Forecast Aggregator, State Fiscal Deep-Dive and Municipal &
  Panchayat Tender Aggregator show news rows or an empty state instead of "Module planned", unlike
  the other 15 unbuilt modules. F171 B9.
  *Done 2026-10-14 (F171 B9, `402622d`, `7fbc3b1`): all 19 show "Module planned"; the server fetches nothing for them and borrows no stored rows; the record loader skips them (none in `desk_rows`, checked).*

- [x] **F174. A timing test fails when the machine is busy.** `src/lib/backupFallbackRoute.test.js`
  "reads the largest pack (5.9 MB) in under a second" failed once in a full run on 2026-10-14 and
  passed three times alone. Make the bound relative or skip it in the full suite.
  *Done 2026-10-14 (`8109eff`): the bound is 2.5 s, which still catches an unbounded read.*

- [x] **F66. Connection recovery state.** Owner screenshots show Failed to
  fetch, an unknown saved outcome, excess empty space and a remaining Stop
  button. Root cause unverified; investigate separately without using live
  conversations as test fixtures. Outside F65 visual scope.
  *Done 2026-10-14 (F171 B3, `9763250`, `7d432c5`): plain message; the partial answer stays; the saved answer is re-checked every 5 s for two minutes, then "Still not saved. Use Recover answer or Reload."; Stop stays only for a turn the server acknowledged.*

- [x] **F62. File admission policy.** File attachment materialization still reads
  whole files before admission. F60 reuses those bytes and shows processing/overflow;
  choose a file-size/total-byte policy before supporting large user uploads. No
  arbitrary new size cap was introduced in the defect fixes.

Historical baseline (read-only observations, 2026-10-03; superseded by
"Current state — 2026-10-12" above):
- `main` is the only long-lived branch; production follows origin/main.
  The review began at local `f0058b1`, one documentation commit ahead of
  origin/main `322c76a`. Subsequently F57 was pushed at `3b40cba` and its
  Vercel deployment succeeded; the infrastructure observations below remain the
  dated read-only review snapshot. No fresh Supabase probe is implied.
- Supabase NTER: ACTIVE_HEALTHY, PostgreSQL 17.6, 43 applied migrations
  through `20261002180000_search_folding`; 33 public tables, all with RLS enabled.
- Nine ACTIVE Edge Functions: `health` v12, `admin-models` v12,
  `refresh-model-pricing` v13, `ingest-documents` v18, `research-chat` v46,
  `desk-brief` v7, `ingest-worker` v1, `admin-ingest` v2, `document-file` v1.
- Corpus: 2,340 indexed documents, 54,340 chunks and 34,184 desk rows.
  The stored-PDF/page pipeline covers two documents: 34 pages, 561 blocks,
  no page images. This is separate from legacy text-only corpus coverage.
- The worker cron is active every 30 seconds. Pricing refresh is every
  twelve hours; analytics retention is daily and rate-window purge every 15 minutes.
- Verification evidence: local `npm run lint` and router import passed during
  the review. GitHub CI for `322c76a` passed lint, build, router import,
  Vitest, Deno and disposable SQL fixtures. No local build or test-suite run
  was performed in the read-only review. CI is advisory.
- GitHub authenticated as `ddllabs`; repository read access and Supabase
  SELECTs/function metadata were verified. Vercel READY states below are
  dated operations records, not an independent October 3 Vercel probe.
  *Done 2026-10-14 (F171 B4, owner decision taken as recommended): 25 MB a file, 50 MB a drop, refused before reading; no file contents or file text in browser storage.*

- [x] **F89. National external source-link reliability.** V6 popup audit executed18 unique public targets:15 responded200; eprocure link returned500, GDELT returned429, and `https://ipm.mospi.gov.in/` has an expired TLS certificate. Do not bypass TLS or guess replacement sources. [Exact targets/evidence](../specs/2026-10-07-national-v6-link-audit.md). Existing source/feed integrations unchanged; refresh/replacement requires a scoped source task.
  *Done 2026-10-14 (F171 B1, `402622d`, `7fbc3b1`): GDELT API addresses are never listed as sources; Centre-sanctioned Projects links MoSPI's main site while ipm.mospi.gov.in's certificate is expired; eProcure answers again.*

- [x] **F166. Morning Brief and Statement Tracker cannot load on the live site.** Found by the F160
  research 2026-10-14: both pages fetch through `/api/rss` (`MorningBriefDesk.jsx:51-53`,
  `StatementsDesk.jsx:45-47`), which only the local dev server has (`server/homeApi.mjs:955`);
  production answers 404 (checked), and the pages are also gated on `VITE_LIVE_API`. Readers see a
  plain "not available" message. The server already builds the same content (`server/nationalFeed.mjs`
  :504 Morning Brief, :439 Statement Tracker for the first leader). Recommended: switch both pages to
  `/api/feature-feed` now (small), rather than adding an open `/api/rss?url=` proxy to the live
  function (it would fetch any URL it is given). F160 phase 1 then serves them from the database.
  *Done 2026-10-14 (F169 T3, `afcd931`, pushed `df556a4`): both pages read `/api/feature-feed`; production probe: Morning Brief 220 items, Statement Tracker 100 per leader.*

- [x] **F167. `/api/home/refresh` is public and makes outside fetches.** Found by the F160 research:
  anyone can call it (GET or POST) and trigger fetches of every home source. Recommended: require
  the same secret as F160's refresh route, or remove it from the live router. Size S.
  *Done 2026-10-14 (F169 T8, `7bff816`, pushed `df556a4`): the route is off the live function; production answers 404 (checked).*

- [x] **F168. An empty "taking longer than usual" answer is edge-cached for 60 s.** Found by the F160
  research: a pending module answer (`served: 'archive'` with no rows) is a 200, so the edge keeps
  it, and the F159 retries can be served the same empty answer. Recommended: send pending answers
  with `no-store`. Size S.
  *Done 2026-10-14 (F169 T8, `7bff816`, pushed `df556a4`): a pending answer is `no-store` (router test).*

- [x] **F108. Legal page content is per-browser.** `privacyStore.js` and
  `termsStore.js` keep edited content in `localStorage`, so an admin edit is
  not seen by other visitors. Make published legal content shared (part of
  F107).
  *Done 2026-10-14 (F171 B5, `4efa9ce`, pushed `df556a4`): Privacy and Terms show the published text; the per-browser editors are removed. The same per-browser problem in the admin Website settings is F175.*

- [x] **F7 / O7.** Live TV content is partly invented. `server/liveTvApi.mjs:664`
  serves a hand-written transcript labelled "ASR Verified Record"; `:609` is
  an invented archive entry; channels without a schedule get placeholder
  programmes. It needs the new Live TV sources, UI and sample codebase.
  *Done 2026-10-14 (F171 B8, `43cf837`, `8990ef9`): invented schedules, archive, transcripts, programmes, stock photos, dates and live status removed; five wrong channel IDs corrected (Sansad TV was Google for Developers); swapped titles set from YouTube. Left for a real Live TV source: schedules, archive, transcripts, checked live status.*

- [x] **F156. Terminal speed (phase 2): paged module lists and stored copies on the server.**
  Paging and the landing retry are live (`97828b2`, pushed `3d0a0d8`). Production, from the
  owner's Mac: Bills page 1 is 9.4 KB compressed (was 534 KB for the whole register, plus a
  450 KB archive), 0.82 s cold and 0.37 s from the edge; a search 0.19 s; Questions page 1
  8.5 KB, 0.44 s.
  - **Backup packs, decided 2026-10-14 (owner: "go with your recommendation … make a note"):**
    `backup/` holds 99 Excel workbooks and 8 manifests (82 MB), a one-time snapshot from
    2026-09-11 (`c83fabe`), never refreshed and not in Supabase (`desk_rows` holds none of them).
    They are a last resort, read only when a module's live source and its shipped archive are both
    empty. Only four modules reach that point on the live site, so the live function carries only
    their packs and manifests (about 5 MB): Satellite Infrastructure, Growth Indicators and
    Global Trade (`backup/GLOBAL`) and Athlete Index (`backup/SPORTS`), listed by name in
    `vercel.json` and `api/router.js` `config.includeFiles` (test: `src/backupPacksDeploy.test.js`).
    **Correction 2026-10-14 (module audit):** this list restricts nothing. Vercel's file tracing
    packages the whole `backup/` folder because `server/backupFeed.mjs` reads it at run time, so
    every pack is on the live function and in use since F156. Several packs hold a different kind
    of record from their module (Box Office → headlines, OTT → a TV schedule), and none of the four
    chosen here matches its module. Fixed by F169 phase 1 (T1).
    The other 95 workbooks stay in the repository for the local dev server and must not be deleted
    without an approved data task. (Superseded by F169 T1: backup packs are off on the live
    site; a module is added to `LIVE_BACKUP_PACKS` only with a test proving its pack holds the
    module's kind of record.) Refreshing or converting the packs is a separate data task.
  Owner request 2026-10-14: large module lists are loaded whole, which keeps load times high and
  costs server time; load them in pages instead.
  [Spec](../specs/2026-10-14-paged-module-lists.md), with measurements: only Bills (9,819 rows,
  about 0.9 MB per cold open) and Parliamentary Questions (8,000 rows, about 0.6 MB) are large;
  every other module is at most about 60 KB compressed. Planned: server pages of 100 rows for those
  two (search, sort, filters and counts on the server, edge-cached); pending landing counts retried
  instead of shown as "unavailable"; the deployed site reading the backup packs with a bounded
  read (the `includeFiles` line awaits the owner's approval).
  *Closed 2026-10-14: paging is live; the backup-pack part is superseded by F169 T1 (no backup-pack answer on production in the post-deploy probe).*

- [x] **Homepage sideways scroll at phone width.** Fixed on `task/mobile-overflow` (2026-10-14). The
  trivia band is a `.mkt-wrap` with its own padding and border added on top, so on phones and tablets
  (to 768 px) it was 47 px wider than the page (scrollWidth 390 at 375). Its padding and border now
  sit inside its width there: scrollWidth equals the viewport at 375, 390 and 768 px. The walkthrough
  globe image also measured past the edge but is clipped by its container and never scrolled the page.
  Desktop is unchanged; there the band still starts at x=1 instead of the 24 px gutter (no scroll),
  a one-line fix if wanted.

- [x] **F132. Gemini sometimes double-escapes newlines in the strict JSON
  answer.** Done `54b98e6` (2026-10-13). Found in the F131 local run, 2026-10-13: one answer in three was
  saved with 41 literal `\n` sequences and rendered them as text. The answer
  phase is unchanged by F131, and production had none in 11 answers over 14
  days.
  - **Measured 2026-10-13 (owner: "run the test first, then add the safety
    net"):**
    - **Production, read-only:** 0 of 12 saved answers ever, 10 of them from
      Gemini 3.8 Flash and 3 of those web turns. `chat_messages` is the only
      table that stores answers.
    - **Probe:** 20 answer-phase calls to Gemini 3.8 Flash, built with
      production's own prompt builder, answer schema and OpenRouter client.
      14 were follow-up questions with a prior markdown answer and web
      evidence, and 6 were first questions. **None was double-escaped**
      (0 literal `\n` in any answer). With a sizing call, the probe cost
      $0.13. Web search spend is now $0.70 of the approved $1.00.
    - Together with the one local case, that is 1 in 36 known answers: rare,
      but real.
  - **Safety net, on `task/f132-json-newlines`:** `undoDoubleEscapes`
    (`answerStream.ts`), applied to the answer in `handler.ts` before the
    citation ladder.
    - It turns literal `\n`, `\t` and `\"` back into real characters, but
      only when there are at least three literal `\n` and they outnumber the
      real line breaks.
    - The saved answer is corrected, and the terminal patch corrects what the
      reader already sees.
    - There are 3 tests, and each guard was proved by mutation: removing the
      call, lowering the threshold to one, and dropping the line-break
      comparison.
  - **Status, 2026-10-13: shipped.** `research-chat` v53 is deployed (fix
    `54b98e6`) and `origin/main` is pushed (see coordination Operations).
    - Checks on Node 24.21.0: 3,688 Vitest and 1,015 Deno tests, lint, the
      build and the router check.
    - Nothing remains unless the double escaping shows up on production:
      search `chat_messages` for literal `\n` now and then.

- [x] **F127. Record adapter helper clean-up.** Done `d19a9f3` (2026-10-13). One strict feed-date reader (`feedDate.js`, options for IST, full month names and RBI's zoneless times) and one plain-text helper (`feedText.js`) replace the copies in five adapters. Behaviour changes, deliberate: zero-width characters are stripped everywhere; the Cabinet adapter no longer reads a month fragment such as "Marc"; a weekday may be spelt out. Bill and question names print as Parliament writes them; only all-capitals names are title-cased, keeping abbreviations and roman numerals ("The ASHA Workers…", "Chapter VIIB", not "Asha", "Viib"). The Morning Brief dedup is one pass.

- [x] **F84. Law reporting-query relevance.** Fixed `897ccc7` (2026-10-13). The nine Law news-wire modules search Google News with each forum's own name and legal terms instead of product-name OR queries; ICC excludes cricket, and the international forums carry no India filter. Live check: ICC moved from cricket to International Criminal Court coverage, and the other eight moved likewise. Also fixed: Google News descriptions showed as raw link markup in tables and in the Law summary card; they are now plain text. [Spec](../specs/2026-10-13-law-news-queries.md).

- [x] **F112. Terminal navigation, type scale and search.** Owner review
  2026-10-13: no "Choose a desk" row on Home, larger highlighted desk tabs, one
  type scale on desk landings, a wider "Search desks, modules and records" box.
  The desk hero now grows to fit the larger title (amendment 1). Shipped in
  `ef4754a` (production `dpl_89StSPmjxkYuVtFLdWBq7bABvDXF`).
  [Spec](../specs/2026-10-13-nav-type-search.md).
  Owner checked on production and accepted, 2026-10-13.

- [x] **F114. Side panel collapsed by default on module pages.** Approved
  2026-10-13. A module page loads with the slim bar so the table gets the
  width; a row click opens Record; picking up a record opens AI.
  Commit `408835e`, merged `426a879`, pushed 2026-10-13.
  [Spec](../specs/2026-10-13-panel-collapsed-default.md).
  Owner checked on production and accepted, 2026-10-13.

- [x] **F116. Citations do not say which version or format a source is.** Two
  versions of a bill appear under identical titles. 413 bills have several
  documents (versions). Only two documents have a stored PDF, so all other
  citations open in Text. Show the version (`document_role`, for example "As
  introduced" or "As passed Lok Sabha") on source cards and in the reader.
  Shipped 2026-10-13: merged `839d7dc`, pushed, Vercel
  `dpl_5terWzWj3hK3nRtkVpsW9e9dgfma`, `research-chat` v49.
  [Spec](../specs/2026-10-13-citation-version-labels.md).
  Owner checked on production and accepted, 2026-10-13.

- [x] **F118. One source card per bill.** Versions of one bill cited in an
  answer share a card with a tag per version (owner, 2026-10-13). Built on
  `task/source-card-per-bill`, merged `46290e8`, pushed 2026-10-13.
  [Spec](../specs/2026-10-13-source-card-per-bill.md).
  Owner checked on production and accepted, 2026-10-13.

- [x] **F105. Reconcile stale documentation.** Owner approved 2026-10-13.
  - `agents/rollback-runbook.md`: all eight `verify_jwt = false` functions,
    the 2026-10-13 deploy-500 and unreadable-bundle notes, and the preview
    origin pattern.
  - `Architectures/01` and `06`: the 2,338-document and 54,219-chunk figures
    dated as 2026-09-22 snapshots, with the 2026-10-13 counts.
  - `ai-agent.md` rule 8: the retired upstream remote.
  - Nine Living plans, specs and research reports whose "uncommitted / local
    only" lines are stale got a dated reconciliation note naming the `main`
    commit. Historical records were left as written.

- [x] **F106. Retire the unused NterEarth runtime.** Owner approved
  2026-10-13. Removed `src/marketing/NterEarth.jsx` and its test,
  `public/brand/earth/nter-earth.js` (282 KB), `earth-poster.png` (450 KB),
  and the dead `.mkt-earth*`, `.mkt-login-earth .mkt-login-orb` and
  `.mkt-login-earth-control` CSS. Kept `.mkt-login-orb`, which the Forgot and
  Reset password pages still render. Lint, 2,578 tests and the build pass.
  The browser check found the homepage and login globes and the forgot/reset
  orbs intact, no requests to the removed files and no console errors.
  Merged `8ef1acf`.

- [x] **F69. Deploy F64 retrieval telemetry.** Deployed with F104 as
  `research-chat` v48 on 2026-10-13. Verified on the owner's live turn (`1e584cfc…`):
  `search_documents` recorded `requestedTopK` 40, `embeddingMs` 1,387,
  `retrievalMs` 103 and `latencyMs` 1,494. The v47 turn before it (18:54 UTC)
  has none of these fields.
  Existing turns cannot acquire missing measurements retroactively.

- [x] **F104. Deploy the retrieval section-context fix.** `a796383` (bill
  versions and continuation sections reach the model; `_shared/retrieval.ts`,
  `research-chat/{agent,index,prompt}.ts`) is in `main` since `d0a8020`, but
  the last recorded `research-chat` deploy is v47 on 2026-10-10. The review
  record says the correction is local only
  (`research/2026-10-12-corpus-integration-review.md`). Before any deploy,
  compare the live function bytes with `main`; then a separately authorized
  `research-chat` deployment and live RAG/citation checks. No re-embedding
  needed.
  - **Read-only comparison attempted, 2026-10-13.** The live code could not be
    downloaded: Supabase returned "Failed to retrieve function bundle" for v47
    to the MCP read, to the CLI `--use-api` path, and to the legacy eszip
    unpacker. Indirect evidence:
    - Live is still v47, deployed 2026-10-10 00:28 IST, with the same bundle
      hash recorded on 2026-10-10 (`a54690a5…`). It is unchanged since then.
    - v47 was built from uncommitted files, and its record lists only
      version-role edits to four files. The section-rendering correction was
      made on 2026-10-12, after v47, so live lacks it.
    - That record also says no telemetry changes were deployed. F64's
      retrieval telemetry (`8d0ba3d`, F69) is in `main` but has no recorded
      deploy.
    - Deploying `main`'s `research-chat` would therefore ship F104 and F69
      together, plus v47's version roles (already live), unless the deploy is
      narrowed.
  - **Deployed as v48, 2026-10-13 (owner: "go with option 1, deploy main").**
    - The saved v47 release source turned up at
      `~/.codex/visualizations/2026/10/08/01a11c8e-85fa-72c1-8681-1fd77f93549f/corpus-version-live-20261010/research-chat-release`.
      Its recorded hashes match the v47 release. It is the rollback copy.
    - Compared with `main`, ignoring trailing newlines, seven files differ:
      - section labels on document passages (F104);
      - retrieval timing, requested top-k and cancelled status (F69);
      - research-coverage switches A (`coverageCheck`) and B (`digNudge`),
        which nothing sets. Empty prompt parts are filtered, so the system
        prompt is byte-identical.
    - Two deploys of `50dca74` (Deno 881 passed) failed with Supabase 500
      "Function deploy failed due to an internal error": one with `--use-api`,
      one by the owner without Docker. The third, `--use-api --debug`,
      succeeded.
    - Result: v48 ACTIVE, `verify_jwt` false, bundle `4adce437…`.
      Unauthenticated POST returns 401, the CORS preflight 204, and no
      function errors are logged.
    - The bundle still cannot be read back ("Failed to retrieve function
      bundle"), so byte equality with `main` rests on the deploy source.
    - Remaining: owner live RAG/citation check on a bill question, then a
      read-only check that `chat_messages.activity` carries
      `embeddingMs`/`retrievalMs`/`requestedTopK` (F69).
  - **Verified live, 2026-10-13.** The owner asked a bill question on
    production after v48. The turn (assistant message `1e584cfc…`, 19:57 UTC)
    completed on `google/gemini-3.8-flash` with six citations to the National
    Anti-Doping (Amendment) Bill, 2025.
    - Three are `document` passages whose stored sections ("CHAPTER VII ›
      MISCELLANEOUS" and two insertion notes) now reach the model; before
      v48 only page passages carried sections.
    - The model input is not stored, so that last step rests on the deployed
      code plus these source rows.
    - Side observation, not fixed: some stored section notes are garbled, for
      example "Insertion of › 22.". That is a chunking data-quality question,
      separate from F104.

- [x] **F113. Drag a record to AI from any panel tab.** A record or file
  dragged over the right-hand panel switches it to AI research (from Desk,
  Record or collapsed); a drop outside the chat or before it loads is handed
  over through `niy-ai-open`. Commit `06e1fe0`, merged `dae877b`, deployed in
  `dpl_89StSPmjxkYuVtFLdWBq7bABvDXF` (`ef4754a`). Owner confirmed on
  2026-10-13 that a dropped bill attaches in a signed-in chat.
  [Spec](../specs/2026-10-13-panel-drag-ai.md).

- [x] **F102 / F103. Client UI refinement and shared orbit globe.** Owner
  accepted on 2026-10-12 ("it's perfect") and authorized commit and local merge.
  Merged into local `main` at `f20ef35` (no-ff; branch `task/client-ui-spec`
  at `2ff385e`, tree identical). F102: cream desks/Home, top desk navigation,
  record graph removal, signup composition (`01634e4`, `d072308`, `b0ba405`,
  `35366d8`). F103: photographic globe (`9e6f12c`) plus amendments 1–5
  (`f7c6ffa`): India start, orbit rings and satellites, clean fade-in, persona
  labels at homepage spacing on sign-in/signup, no blue rim, and the same
  globe on the homepage hero. Final checks: 189 files / 2,527 tests, lint,
  build. **Not pushed or deployed**; production still serves `2a5be9c`.
  [Client UI spec](../specs/2026-10-12-client-ui/index.md),
  [auth Earth spec](../specs/2026-10-12-auth-earth.md).

- **Status reconciliation (2026-10-12):** F93, F95, F96, F97, F98, F100 and
  F101 below say "local only / no merge / no push" as of their execution.
  All their commits (`69595a5`, `9fe245e`, `66c7944`, `540f99d`, `12a148c`,
  `ec89cdc`, `70267e8`, `19ffef6`) are now in `origin/main`, verified by
  `git merge-base --is-ancestor`. Owner acceptance is not inferred from that.

- [x] **F101. Polish V6 sector selector.** Implemented locally in `19ffef6`: refined typography/surface/spacing, decorative chevron and theme/focus styling; native selection retained. All eight desks/35 options, mobile/desktop and keyboard checks, 29 focused tests, lint/build passed. [Evidence](../specs/2026-10-12-sector-selector-polish.md). Corpus untouched; no merge/push/deploy.

- [x] **F100. Restore original V6 selected-sector explorer.** Owner preview correction implemented locally in `70267e8`: original left sector details and right icon/count/coverage module cards, with approved internal sector select; all 35 picture-card defaults and 120 direct module destinations retained. 2,506 tests, lint/build/assets and eight-desk browser matrix passed. [Evidence](../research/2026-10-12-v6-explorer-restoration-local-run.md). Corpus untouched; no merge/push/deploy.

- [x] **F96. Optional landing module discovery.** Implemented locally in `66c7944`: collapsed all-module disclosure, per-sector accordions and 120 direct links across eight desks; all 35 approved picture-card defaults retained. [Evidence](../research/2026-10-12-terminal-follow-up-local-run.md).

- [x] **F97. Meaningful terminal header controls.** Implemented locally in `540f99d` / `12a148c`: disabled bell and unused icon removed, landing refresh hidden, Home/module refresh retained, sun/moon with next-action labels. [Evidence](../research/2026-10-12-terminal-follow-up-local-run.md).

- [x] **F98. Free signed-in desk access, copy and export.** Implemented locally in `ec89cdc`: all known desks/modules, no commercial row caps, no terminal Upgrade interruption or signup plan step, entry independent of subscription metadata. Account authorization, stored billing facts and AI limits retained. This owner-approved desk contract supersedes earlier commercial-lock assumptions; no backend enforcement work activated. 2,504 Vitest / 880 Deno, lint/build/assets and isolated browser matrix passed. Corpus excluded. [Evidence](../research/2026-10-12-terminal-follow-up-local-run.md). No push/deployment/main merge.

- [x] **F95. Direct desk-card entry and AI dismissal.** Implemented locally in `9fe245e`: all 35 cards link to approved defaults, all 120 sibling modules retain sector-menu access, outside clicks and landing navigation hide AI while retaining mounted chat. 2,472 Vitest / 880 Deno, lint/build/assets and desktop/mobile/dark browser fixture checks passed. Corpus changes excluded. [Evidence](2026-10-12-desk-direct-entry.md). No push/deployment.

- [x] **F93. Legacy landing UI cleanup.** Removed the approved 12 unused files in `69595a5`; lint, build, assets, 2,468 Vitest and 880 Deno tests passed, all 318 build outputs unchanged. [Evidence](2026-10-12-unused-landing-ui.md). Local only; corpus changes excluded.

- [x] **F88/F90/F91/F92. Desk v6 integration, canonical restricted handoffs, shared-shell alignment and explorer readability.** Owner authorized main publication on2026-10-08 after disclosure of unchanged P12 dependency risk. Verified candidate453f8ec merged into main at `d480b11`; eight desk landings including State, catalogue/search, source-backed summaries, exact images and preserved canonical module workspaces. Final2,465Vitest/862Deno,lint/build/router/assets pass; independent review and native zoom/reduced-motion/intentional coarse-pointer/hidden-tab acceptance complete. Voice remains explicitly owner-deferred under F76. [Release evidence and rollback](2026-10-08-desk-v6-release-candidate.md). Task branches retained; F93 optional old-code cleanup and P12 remain separate.

- [x] **F79. Homepage spherical Earth replacement.** Implementation `071cd13`, original isolated evidence `43c7690`. Owner authorized remaining branch integration/publication and local/remote cleanup on 2026-10-05. Combined desk/Earth code passed 2,160 Vitest tests, 862 Deno tests, lint/build/router import and homepage Chrome pause/resume smoke. See the release amendment in [plan](2026-10-04-earth-replacement.md). Existing F80 trivia overflow remains separate.

- **2026-10-04, F68 recovery cleanup — 071cd13:** Archived and hash-verified all 16 old worktrees plus their branch history, then removed them with owner authorization. Only main remained before creating task/earth-replacement. Remote has only main. Recovery archives remain local under .git/local-archives/2026-10-04-earth-preparation/. [Evidence](2026-10-04-earth-replacement.md).

- [x] **F81. National landing redesign.** Completed in the verified stacked release: implementation/fidelity and signed-in route evidence through `49aef80`, final polish/environment verification `1ad22d0`. Twelve canonical routes, real summaries, sampled-question disclosure, bills by sector and shared navigation. Owner authorized main integration and push on 2026-10-05. [Final evidence](2026-10-05-desk-landing-release-verification.md).

- [x] **F82. Global landing redesign.** Implemented and verified through `9eb4637`; final release checks `1ad22d0`. Sixteen routes, reference artwork/motion, real source-coordinate map and coverage-aware totals; illustrative commodity prices excluded. [Final evidence](2026-10-05-desk-landing-release-verification.md).

- [x] **F83. Law landing redesign.** Implemented `b3a781f`; final release checks `1ad22d0`. Twelve routes, reference artwork, source summaries and shared Supreme Court dedup. Reporting-feed limitations disclosed; F84 remains separate. Owner corrected State scope to Law. [Final evidence](2026-10-05-desk-landing-release-verification.md).

- [x] **F85. Cross-desk final polish audit.** Fixed singular module counts and tour guidance in `1ad22d0`. Reference row grid deliberately retained. Native reduced motion across three desks, coarse-pointer disclosures and actual hidden-tab lifecycle executed. Full 2,152 Vitest/862 Deno tests, lint/build/router import and whitespace checks pass. [Evidence](2026-10-05-desk-landing-release-verification.md).

- [x] **F86. Login globe and compact desk headers.** Landed in `6d4b66e`; owner authorized merge/push on 2026-10-07. Reused homepage Earth on login; compacted three desk headers. 2,160 tests, lint/build passed; browser evidence and limitations in [plan](2026-10-07-login-globe-compact-desks.md).

- [x] **F78. Publish F77 microphone waveform UI.** Owner instruction “pushed”; main pushed to 9b159f0. Vercel production dpl_BnzKVUC38fHqSxftdX2RuAjWSB9G READY with niyantran-six.vercel.app alias. No backend redeployment required. Actual microphone acceptance remains F76.

- [x] **F77. Live microphone waveform UI.** `bd37d43`: real microphone energy history and elapsed time; cancel/stop/transcription states replace existing toolbar without height growth, reduced-motion meter, sending blocked during dictation. 2,103 tests/lint/build and responsive browser checks pass. [Evidence](2026-10-04-dictation-waveform.md).

- [x] **F74. Publish and activate OpenRouter dictation.** F75 published at f346ab8; Vercel production READY, transcribe-audio v1 ACTIVE, existing OpenRouter secret present. Live auth/CORS and synthetic English/Hindi provider probes pass. Browser acceptance is F76. [Release evidence](2026-10-04-dictation-activation.md).

- [x] **F75. OpenRouter Whisper dictation.** `d352997`: uses openai/whisper-large-v3-turbo and existing server-side OPENROUTER_API_KEY. 2,100 Vitest / 862 Deno tests, lint/build and function compilation pass; provider/credential guards proved red first. Live activation remains F74. [Evidence](2026-10-04-openrouter-dictation.md).

- [x] **F73. Editable copy, grouped command search and Whisper dictation.** Local commits `75bddf3`, `a60e2cf`, `2ac4850`: native input/editor copy skips Upgrade; accessible Desks/Modules/Records groups with 300ms-debounced cancellable snapshot lookup; shared microphone controls append editable text in command search and chat; authenticated active-account endpoint calls OpenAI whisper-1 directly. 2,100 Vitest and 861 Deno tests pass, lint/build pass (existing mixed-import/large-chunk warnings), local Chrome fixture passes at 320–1440px with mocked audio/provider. Production activation is F74. [Plan and evidence](2026-10-04-command-search-dictation.md).

- [x] **F72. Compact chat footer.** `a5bc525`: tighter attachment/composer
  spacing, subtle blue follow-up pills; 28.19px saved in browser fixture with
  control sizes preserved. 61 focused checks, lint/build and light/dark browser
  checks passed. Published in `660977e`; Vercel READY (2026-10-04).
  [Plan](2026-10-04-compact-chat-footer.md).

- [x] **F71. Chat reading space and durations.** `3455988`: shared 50% dock
  default, wrapping tables and known Searching/Processing/Writing durations
  instead of user-facing reasoning tokens. 2,090 frontend tests, lint/build
  and isolated browser geometry checks passed. Published in `660977e`; Vercel READY (2026-10-04). [Plan](2026-10-04-chat-reading-space.md).

- [x] **F70. Live activity disclosure.** `899b47a`: opens while generating,
  closes on completion and preserves manual toggles within each phase.
  2,089 frontend tests, lint/build and isolated browser lifecycle check passed.
  Published in `660977e`; Vercel READY (2026-10-04). [Plan](2026-10-04-live-activity-disclosure.md).

- [x] **F63–F65. Chat presentation, activity metadata and research flow.**
  Owner authorized integration/publication on 2026-10-04. Combined code through
  `0638dbd` (24 commits beyond prior main), including F63 `3be5117`, F64
  `8d0ba3d`, F65 `f47ccb4` and amendments through `3c0a02e`. Full checks:
  2,089 frontend tests, 856 Edge Function tests, lint/build and router import
  passed. Landed and pushed on main at `75b521d`; exact Vercel deployment READY.
  F64 backend deployment tracked as F69.
  [Consolidation record](2026-10-04-main-consolidation.md).

- **2026-10-04, F60 frontend defects, verified locally on UI branch:**
  `8cfe0a4`, `7e51a0c`, `9c9fb27`, `9b5ecfb`. AI reading space, popover
  keyboard/focus, attachment/save feedback, stale briefs, desk selection and
  marketing/admin accessibility repaired. 2,068 Vitest and 854 Deno tests,
  lint/build, independent review and offline browser checks passed.
  `task/f60-ui-defect-fixes` retained; no push/deployment or owner acceptance
  inferred. [Plan, exact evidence and limits](2026-10-04-ui-defect-fixes.md).

- **2026-10-03, F58 heavy PDF local profiling:** `d971245`. Offline harness and repeated measurements on 25-page Budget and 740-page Economic Survey; steady warm scrolling, three live canvases, no sampled visible-page loading. No production optimization justified. [Results and limits](../research/2026-10-03-heavy-pdf-profile.md); remaining first-traversal attribution is F59. Locally integrated only.

- **2026-10-03, F56 documentation reconciliation:** `b79e335`. Architecture, ADR amendments, entrypoints and shipped-work statuses reconciled against source and dated operations. Independent review and Markdown checks passed; documentation-only, locally integrated. [Plan and evidence](2026-10-03-documentation-reconciliation.md).

Newest first. Detail is in `git log`, the linked documents and the
"Operations" entries in `agents/coordination.md`.

- **2026-10-03, F57 citation viewer reliability, verified locally by supervisor:** `6df6d7c`. Stable PDF slot order preserves highlights; repeated citation events and cited-page controls reveal the exact passage, including after redraw. 2,029 Vitest tests, lint, build, independent review and local browser checks pass. [Plan and evidence](2026-10-03-citation-viewer-reliability.md). Pushed to origin/main at `3b40cba`; GitHub Vercel status confirmed deployment success. Timing follow-up is F58.

- **2026-10-03, F55 `chat-attach-fixes`, closed by the owner:** the AI chat's drop frame, duplicate
  attachments and Reload.
  - **The drop frame** is an overlay on all four sides.
  - **Attachments are identified by document key or file content.** The same bill by any route is
    one chip, and two different files that share a name are two. Skipped duplicates are named
    ("Already attached: …").
  - **Reload and its row** appear only when needed.
  - **Spec:** `specs/2026-10-03-chat-attach-fixes.md`. On production at `e651613` (Vercel READY).
- **2026-10-03, F54 `side-panel`, closed by the owner:** Desk, Record and AI research are one
  `SidePanel`, replacing the rail and the AI dock that took turns in the same slot.
  - **What it has:**
    - one tablist;
    - one draggable, remembered width (36% by default, 400 px to 60%);
    - one expand mode for every tab (the citation overlay generalised);
    - Collapse with a handle;
    - AI's actions in the tab bar;
    - the docked shadow.
  - **A row click or page load always opens the panel.** On AI, a row click stays on AI.
  - **Spec:** `specs/2026-10-03-side-panel.md`, with amendments 1 and 2; local run
    `research/2026-10-03-side-panel-local-run.md`. On production at `57e3d8c` and `1f0ab07` (Vercel
    READY).
- **2026-10-03, F53 `research-coverage`, closed by the owner:** questions that sound simple but
  need digging. Measured; neither fix ships.
  - **The test set:** `eval/agent/coverage.v1.jsonl`, 15 bill questions with 75 points, revised
    after an independent review (`research/2026-10-02-coverage-set-review.md`).
  - **The measured risk:** today's agent covers 88% of the points and answers 57% of the questions
    in full. Its misses are provisions later in the bill than its first search reached.
  - **The fixes:**
    - The prompt coverage check did not help.
    - The dig nudge passed the coverage mark at the threshold but failed on ordinary questions:
      +9 s and +122% cost on narrow questions, firing on 6 of 10.
    - Both stay in the code as options, off by default. NTER is unchanged.
  - **Not scheduled:** a narrower nudge, or a reader-side "Dig deeper" action, if a real answer
    shows this failure.
  - **Spec:** `specs/2026-10-02-research-coverage.md`; results in
    `research/2026-10-02-research-coverage.md` (`cf54c58`). About $10.40 spent.
- **2026-10-02, R6 `citations-pdf`:** a page-wise viewer for ingestion-v2 citations.
  - **What it does:**
    - the original PDF, with box highlights;
    - an OCR text view, both with page switching;
    - signed byte-range reads through `document-file`;
    - the chat widens into a resizable overlay;
    - Fit text, zoom and a full view;
    - a click outside closes both panels, while Close citation keeps the chat.
  - Legacy documents keep the old reader.
  - **Spec:** `specs/2026-10-01-rag-v2-citations-pdf.md`, revisions 3–5.
  - **Local runs:** `research/2026-10-01-citations-pdf-local-run.md` (V7, V7b and V7c).
  - **On NTER:**
    - `document-file` deployed (V8 step 1);
    - frontend at `e76a48a` (revision 4) and `3a44ff2` (revision 5), Vercel READY.
  - **Owner checks passed (2026-10-02):** citations on the Anti-Doping bill, click outside,
    Close citation and the full view. The "Open stored copy" tab is still to check, listed
    under R8.
- **2026-10-02, F45 (on NTER with R6 revision 5):** `0181b71`, wired in `ee206bb`.
  - **Per-part requests:** the viewer passes the part layout it read from `document_files`, so
    `document-file` is asked once per part, not once per page.
  - **Ask state:** "Ask about this document" is disabled, with a reason, for a deleted or not-live
    document.
  - **Verified:** V7c on the local stack. Paging 21 times across a 3-part document made 3
    requests.
- **2026-10-01, F43 (local, `task/admin-records`):** `ad34438`. The chat panel kept
  resetting on every same-account auth event (tab refocus, token refresh), which dropped
  an unsent chat's attachments and draft and aborted a streaming answer. A same-account
  event now re-verifies quietly; a sign-out or another account still clears at once.
  Reproduced and verified in the browser on the local stack (the old code drops the
  attached row on one same-account `SIGNED_IN`; the fix keeps it; `SIGNED_OUT` clears it).

- **2026-09-29, evening (local session):**
  - Declutter before the new ingestion pipeline (owner-approved). Removed
    from the repository: eleven unused scripts, `api-status.pdf`,
    `_kpi_slides.txt`, `.oxlintrc.json`, the root
    `NTER_BACKEND_FIRST_INTEGRATION_REPORT.md`, the deleted-branches archive
    in `docs/`, the never-deployed backend module (`backend/src`,
    `backend/index.ts`, `backend/package.json`, three invite functions) and
    the `extract`, `feed` and `export-map` npm scripts. `backend/sql` stays
    for the SQL fixtures. Outside git: `dist/` and `tmp/` removed, the old
    link map `ingest/national-desk/` moved to the Trash, the local Supabase
    stack's Docker images and volumes removed, and five superseded zips and
    folders in Downloads moved to the Trash. The corpus folder was first
    completed from its zip (7 files it lacked, about 1.1 GB, sizes and CRCs
    checked). The Supabase corpus is kept until the new pipeline replaces it.
  - O2, closed without deleting (owner's decision). Four Vercel variables
    are unused: `VITE_AI_BACKEND`, `PROJECT_ID`, `GOOGLE_CLIENT_ID` and
    `VITE_GOOGLE_CLIENT_ID`. No code reads them, and nothing reads
    `import.meta.env` as a whole, so Vite puts neither `VITE_` value in the
    bundle. Google sign-in runs through Supabase's own provider settings.
    They stay because the Vercel tools can't delete variables; remove them
    whenever someone is in the dashboard.
  - D1 (part), the Auth redirect URLs: the owner added
    `http://localhost:5173/**` and `https://niyantran-*-ddl-labs.vercel.app/**`
    (site URL stays production). Verified by starting a Google sign-in from
    each origin and reading `auth.flow_state.referrer`: production, the
    `main` alias, a preview deployment and localhost each return to
    themselves, and an unknown origin falls back to production. Before
    this, the Auth logs showed a preview sign-in (28 Sep 08:43 UTC) landing
    on production. Google sign-in itself has worked since 27 Sep (5
    accounts).
  - P16, the home carousel shows only computed figures and true constants
    (`87dc8bf`):
    - computed: bills 9,817 (unique IDs; the feed repeats two rows),
      ministries 56, fronts 88, market instruments 9;
    - constants: 543 seats, 2 Houses, 36 states and UTs (was 28), 6 CBAM
      sectors, 27 EU states, 25 High Courts;
    - the invented figures are dropped.

    Its test fails on any figure outside those.
  - F13, a transient identity failure no longer signs the user out
    (`179a708`; spec `specs/2026-09-29-f13-transient-identity-failure.md`,
    `3a51724`, approved with no retry).
    - Network errors and 5xx refuse the request but keep the identity, the
      retained turns and the signed-in UI; callers show "Connection problem.
      Try again."
    - Authoritative failures still sign out.
    - The new tests fail on the old code.
    - In a browser against a local stack with PostgREST stopped, the old
      code dropped a valid session to the landing page on reload; the new
      code stays signed in.
  - F17, both untested database paths run against a local Supabase stack
    (`5259ffa`). `scripts/verify-local-storage-paths.mjs` checks:
    - the preferences merge-upsert through PostgREST, read back as the
      owner, with `service_role` refused;
    - the intro-video signed-URL upload, finalize, public read and delete.

    12 of 12 checks pass. The two merge checks fail when the handler nulls
    omitted fields. The script refuses any non-local URL.
  - C3 (T7), SQLite retired (`31c3915`):
    - the `entry_briefs` tier removed from `server/deskBrief.mjs`;
    - `server/db.mjs` and `sql.js` deleted;
    - `KNOWN_OFFENDERS` emptied, so the guard fails with both offences when
      SQLite is reinstated;
    - the seven tests' dead `db.mjs` mocks removed;
    - the two serverless specs marked Historical.

    O4: the laptop's only SQLite file held three 100-byte briefs written by
    a test run, so nothing was kept. The other worker's machine was not
    checked.
  - F1, `user_preferences.ai_chats` dropped (`92893f1`; migration 36, live
    and pinned). The `drop_ai_chats` fixture fails without the migration.
  - A1, all six Edge Functions redeployed with the standard CLI. The
    dashboard shows the real files, and each function was probed.
  - O5, `ALLOWED_ORIGINS` includes `https://niyantran-*-ddl-labs.vercel.app`.
    Preview and deployment hosts are allowed; foreign origins are refused.
  - O3, the merged branches `task/docs-pass` and `task/f2-server-entitlements`
    deleted on GitHub.
  - F29, the `/api/home/latest` contract test runs offline (`b60c0dc`). It
    used to query live Supabase whenever `.env.local` existed. It now fails
    if the stub isn't used.

- **2026-09-29:**
  - F28, the nuclear-site map builds its marker labels from text nodes (`fillSiteLabel` in `src/lib/geoTip.js`, used by `NuclearSiteMap.jsx`). Its test fails on the old `innerHTML` code. Both helpers were also run in Chromium with an `<img onerror>` name: no element was created and the handler never ran. The other `innerHTML` uses are deliberate: `siteHead.js` injects the admin-configured head snippet and `bootLegacy.js` a same-origin static file.
  - F26, the map tooltip sets feed text with `textContent` (`src/lib/geoTip.js`, used by `GeoDotsMap.jsx`). Its test fails on the old `innerHTML` code with an `<img onerror>` name.
  - F27, test 13 of `scripts/test-auth-complete-suite.mjs` asserts the signed-out profile read. It uses a fresh client (the old `anonClient` had held the test user's session since test 10), and passes only on `42501` or zero rows, so a network error does not pass. `42501` confirmed live on NTER with `set local role anon`; the script itself was not run, because it creates real users.
  - F25, the lint backlog cleared:
    - ESLint 9 core ignores JSX, so 218 of the 253 "unused" warnings were components used only as `<Foo />`, and an undefined `<Bar />` was never reported. `eslint-plugin-react` now supplies `jsx-uses-vars` and `jsx-no-undef` (it found no undefined component).
    - The 35 real unused bindings are gone, including dead code: the Wire RSS fetcher in `server/homeApi.mjs`, `sampleRows` in `server/deskBrief.mjs`, and `QuestionRecord` and `RegulatoryRecord` (both desks render through `BillRecord`).
    - Of the 13 hook notes: `LiveTvModal` compared a loaded archive against the broadcast selected when the fetch began, so a pick made while it loaded could be overwritten (found by reading, not reproduced; now functional updates). Three desks rebuilt memos every render from a fresh `[]` fallback. `AiPanel` now lists `research.actions`, a stable ref. The other seven are deliberate and carry a reason.
    - `no-unused-vars` is an error and `npm run lint` runs with `--max-warnings 0`. F26 and F27 were found on the way.
  - F21, a lint gate. `npm run lint` (ESLint 9 with `react-hooks`) fails on errors and runs in CI as an advisory step; the warnings are F25. Its first run found two `ReferenceError`s in shipped code, fixed in `03f039c`:
    - the right rail's record detail crashed for rows without an analysis;
    - `/data/news.json` answered 502 when nter.news had no live rows.
  - F17 (part): the `pg_cron` branch verified live. `analytics-events-retention` ran at 03:17 UTC and succeeded; `analytics-rate-windows-purge` 105 of 105 runs; `refresh-model-pricing` 18 of 18. The dev server's 503 without `SUPABASE_SECRET_KEY` is documented in `README.md`.
  - F20, the desk-row loader writes only new or changed rows and deletes removed keys (`src/lib/deskRowSync.js`, `scripts/load-desk-rows.mjs`). A dry run now reads the stored rows, so it needs the Supabase variables. The first run rewrites most rows once, because the stored `record_text` lines are in jsonb key order. F19 needed no change: the header of `backend/sql/auth_schema.sql` and `Architectures/README.md` already state its fixture-bootstrap role.
  - F13 (part): the generic "Try Reload" error from `reconcileSavedTurn` keeps the real failure as its `cause`, instead of masking read and programming errors (`src/lib/researchChat.js`).
  - F24, the signup plan step runs: a free email signup with a session sees "Choose plan" and can start its trial; a Pro or Enterprise pick enters directly (`src/lib/signupFlow.js`; checked in a browser against a mocked Supabase).
  - F16, the unused `reasoningSegments` modules (browser and Edge copies, and their tests) deleted; `params` and `max_tokens` parked as P15.
  - F14, the model and effort choice survives a reload (per browser, `useResearchThread.js`); F15, the follow-up pills are a labelled list (`SuggestionPills.jsx`).
  - F23, the `--pdf-text` ingest mode in `scripts/ingest-national-desk.mjs` (tests in `src/lib/ingestPdfText.test.js`).
  - F22, a half-precision search index (migrations `20260929120000` and `20260929120100`, live; fixture `halfvec_retrieval.sql`). 204 MB instead of 404 MB; recall@40 0.9875 against 0.990, measured on 20 queries against an exact scan.
  - F10, one account per normalised email (migration `20260929110000_email_unique`, live; fixture `email_unique.sql`); signup explains the refusal (`src/lib/signupErrors.js`). F11, the review of `my_entitlement` and `start_trial` (`Architectures/06` §9.2).
  - F8, preview origins in CORS; F9, no legacy keys in Edge Functions; F12, the chunker's table rule (version 2) (`d1567d1`). All six functions were redeployed from that commit: `health` v8, `admin-models` v8, `refresh-model-pricing` v9, `ingest-documents` v12, `desk-brief` v3, `research-chat` v33. The four that are reachable without a JWT answered their own 401 with the production CORS header.
  - F2 phase 1, server-owned plans (`f74c8c1`; `specs/2026-09-29-f2-entitlements.md`); this file (`docs:` commit of 2026-09-29).
- **2026-09-28/29:**
  - F3, one secret-key name (`3572e53`);
  - F4, Live TV quota (`47fa681`);
  - D4, legacy AI path retired (`14b2344`), and `aiChatStore` removed (`f05a5b6`);
  - D5, rollback runbook;
  - C1, invoices (`19d25e6`);
  - C2, nter.news (`7160391`);
  - C4, admin persona probe (`8a21133`);
  - C5, persona prompt (`c24d379`);
  - C6, testing flag retired (`9e7a125`);
  - C7, UI decisions (`96594d3`, `aee1e8a`);
  - B1 and B2, security reviews (`docs/specs/2026-09-28-authorization-review.md`);
  - B3–B6, tests stop rewriting `public/`, STAT-1 cache, `loadEnv`, CI;
  - A3, operations record.
- **2026-09-28**, the serverless move:
  - T0 (`d55da42`);
  - wave 1: T1 preferences, T2 analytics, T4 flags and media;
  - wave 2: T3, local users retired (`5a2ded0`);
  - T5 and T6 as C1 and C2;
  - the analytics rate limit (`483b3b2`).

  Only T7 (C3) remains.
- **2026-09-22 and earlier:** the first corpus pass, 2,338 documents all
  indexed (`plans/2026-09-21-corpus-ingest-first-pass.md`); scoped
  retrieval; the streaming research agent; citations; desk-row grounding.

## 2. Awaiting the owner's decision (closed items)

- [x] **F30. The other hand-written marketing figures** *(2026-10-14: "9,819", "211+" and "99.9%" are gone (F142); "12 Desks" fixed to 8 and tied to the desk list (F171 B10, `df556a4`). The homepage preview cards' sample figures are on the client's list, F144.)* (found while doing
  P16). They weren't part of P16's approval:
  - `src/marketing/HomePage.jsx` shows "9,819" bills in four places (lines
    36, 290, 584 and 736); the carousel now says 9,817 unique bills;
  - "211+" live API endpoints (`HomePage.jsx:286` and `:727`, and
    `PricingPage.jsx:135`);
  - "UPTIME 99.9%" (`HomePage.jsx:294`, `PricingPage.jsx:143`), which nothing
    measures.
  *Closed 2026-10-15: superseded by F142 (live figures), F171 B10 and F144; `src/lib/siteFigures.test.js` fails if the old hand-written figures return.*

  Decide per figure: compute it (the bills count can reuse P16's), keep it
  as a constant, or drop it.

## 3. RAG v2: retrieval and page-aware ingestion (in progress) (closed items)

Part 1 is planned in `plans/2026-09-30-rag-v2-retrieval-and-contract.md`
(tasks T1–T17):

- [x] **R1. `eval`** (spec `specs/2026-09-30-rag-v2-eval.md`). Done on
  2026-10-01 (`952d4e8`):
  - the frozen set of 195 questions and its vectors;
  - the harness;
  - the live baseline in `research/2026-09-30-retrieval-baseline.md`
    (broad doc@10 85.3%, focused chunk@10 97.8%).

  The 20-question owner review was done by the supervisor on the owner's
  behalf.

- [x] **R2. `retrieval-scope`**. Done on 2026-10-01:
  - migration `20261001100000`, and `research-chat` deployed from `2d4f9bd`;
  - frontend `6f1b94b`;
  - live eval "no worse", with the desk filter at doc@10 171/184 against 157;
  - F32 fixed by `document_modules()`.

  Remaining: the owner's signed-in check of the button.

- [x] **R3. `chunk-contract`**. Done on 2026-10-01 (`b9bcb6c`):
  - migration `20261001120000` live;
  - `research-chat` and `ingest-documents` redeployed;
  - page text rules, the page chunker (version 3), citation fields, and the refusal of
    page-aware documents by the old path;
  - the ADR 0002 and 0004 amendments.

  Live eval "no worse".

Part 2: deployed ingestion and the remaining pilot/acquisition work:

- [x] **R4. `ingestion-v2`** (spec `specs/2026-10-01-rag-v2-ingestion-v2.md`,
  approved; plan `plans/2026-10-01-rag-v2-ingestion-v2.md`):
  - a private `corpus` bucket, content-addressed by file hash;
  - a job-table queue (skip-locked claims, lease, fencing), with a pg_cron
    timer switched on by the owner;
  - the `ingest-worker` Edge Function running Mistral OCR in page ranges and
    indexing slice by slice;
  - first extractions only.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

  The owner sets `MISTRAL_API_KEY` and runs the secret steps.

  Built on `task/rag-v2-ingestion-v2` (I0–I5, checkpoint D, 2026-10-01). The
  local end-to-end run (I7) passed:
  `research/2026-10-01-ingestion-v2-local-run.md`, $0.197. The later NTER
  deployment below supersedes the earlier checkpoint E/I8 deployment steps.
  `MISTRAL_API_KEY` is already set on NTER (the owner, 2026-10-01).
  **Live on NTER, 2026-10-01** (`agents/coordination.md`): migration 39, the worker
  secret, both functions deployed, and the first document (the 12-page bill) ingested
  for $0.048. R8 subsequently switched the schedule on; it was active in the
  October 3 read-only check. Remaining: the owner's signed-in citation check, then
  mark R4 done.

- [x] **R5.** *Closed: superseded by I7 and the live runs. 2026-11-10 (F299)* A pilot of about 10 PDFs from the candidates in the research
  doc §6, which proves pages, boxes, images, cost and re-run cost.

- [x] **R7. `acquisition`.** *Closed: superseded by F278, F285 and F307 (the owner's supplied-text packs replace download and OCR, ADR 0014); its holds are under F311, F312, F314 and the Bills load record; its notes on served text (for example `bill:1996:49`'s repeated nonsense phrases, 123 indexed bill documents with no key) move to F281. 2026-11-10 (F299)* Download the 5,327 linked `pdf_text`
  records (5,218 sansad.in bills), then backfill on a separate owner
  go-ahead. This replaces L1 for the linked records; the unlinked ones wait
  for R8.
  - **Verified code integrated (2026-10-12):** the reviewed 12-commit corpus stack landed on local and origin/main at `d0a8020`, preserving the released UI and Download fix. Supervisor reruns passed 2,506 application, 881 Edge and 113 corpus tests, lint/build, and 22 SQL fixtures with 22 non-vacuity checks. Original shared copies are retained in a verified external backup. No Edge Function deployment, migration, source release or ingestion restart; R7 holds remain open. [Integration evidence](../research/2026-10-12-main-consolidation.md).
  - **Latest scope, owner requests larger batches toward the full corpus:** reconcile all Citation Pack categories and select the next up-to-500 absent bill cohort beyond the earlier 500-source pool. Use deployed mapping and full quality/operational gates; keep nonbill scoping and actual failures separate. Current runtime preparation is `corpus-wide-20261011/`; no new readiness count is claimed before review.
  - **Latest owner continuation, completed 2026-10-11:** next 180 identity/version candidates screened; 32 reviewed same-Download sources / 588 context chunks ingested and independently audited, including 208 final scoped citation probes. Global 3,021 documents / 3,018 indexed / 92,538 chunks / 1,730 covered bill keys; exact deltas and planner counts pass, zero orphan/null vectors. Usage 57,972 tokens / USD 0.00115944. Original 500-source pool: 252 complete, 248 pending (this review's 119 validation/quality holds +29 remaining body/version reviews, prior 88 quality +2 missing-text +10 mapping holds). [Next-set run evidence](../research/2026-10-11-corpus-next180-run.md). `job-next180-v1` and all earlier completed manifests must never restart; no unfinished ready release remains. Existing-source repair holds are untouched.
  - **Next set, owner continuation (2026-10-11):** review the remaining 97 identity and 83 version candidates from the existing 500-source pool, reconcile fresh live absence/current Download mapping, and ingest every independently passing source in one new bounded job. Preserve completed releases and the 88 + two earlier quality holds; revisit a hold only with new evidence. Active corpus-batch-blockers spec/plan extended for this continuation; no deployment, original edit, existing-source replacement or guard waiver.
  - **270-source single job COMPLETE (2026-10-11 03:41 UTC):** all 270 reviewed; 182 ingested in one frozen job with 3,611 full v4 chunks and 1,532 final scoped citation probes, all independently audited. 88 source-specific holds remain aside. Live 2,989 documents / 2,986 indexed / 91,950 chunks / 1,698 covered bill keys; zero orphans/null vectors, planner exact. `job-reviewed270-v1/stage-01.release.json` SHA `e21a71b4fcd2d172447c66f91b897df1e60de1d14b79230ff68d18f60088668b` is COMPLETE and must NEVER restart. [Final evidence](../research/2026-10-11-corpus-270-reviewed-run.md). Within the earlier 500-candidate pool, 220 complete (38 prior +182 here), 280 remain: 88 current holds, two prior missing-text holds, 97 identity reviews, 83 version reviews, 10 mapping holds. Preserve existing-source repair exclusions; R7 remains open.
  - **Production mapping and larger ingestion completed (latest 2026-10-11):** [verified execution](../research/2026-10-11-download-mapping-production-run.md). Only resolver + companion deployed from isolated production baseline; served hashes and 19,634-row deployed-function replay pass. Two releases added 38 documents / 436 complete v4 chunks / 38 covered bills; all vectors/spans/context/mapping and 118 scoped citation probes pass. Live totals 2,807 documents / 2,804 indexed / 88,339 chunks / 1,516 covered keys; zero orphans/null vectors, planner exact. Both job-quality18 and job-quality20 releases COMPLETE: never restart. Of 500 candidates: 38 complete, 2 missing-scanned-text holds, 270 pending full quality review, 97 identity reviews, 83 version reviews, 10 mapping holds. Continue passing absent sources without renewed ingestion permission; preserve existing-source and actual issue holds. Earlier deployment-pending snapshots below are historical.
  - **Passing Citation Pack subset completed (2026-10-11):** [execution evidence](../research/2026-10-11-citation-pack-passing-subset-run.md). Two absent sources, bill:2022:218 and bill:2022:220, independently mapped to current Download PDFs; 17 complete version-4 chunks, eight scoped citation probes, zero orphans/null vectors. Totals 2,769 documents / 2,766 indexed / 87,903 chunks / 1,478 covered bill keys. Completed manifest stage-02.release.json SHA a7fbe4da93456ff9834ed2b39e965bb307f23fa96d0a40bbc1dd07d943ab1faf must never restart. Two local identity bindings added; broader 3,040 proposals remain drafts and other holds remain separate.
  - **Citation Pack preflight (2026-10-11):** [executed findings](../research/2026-10-11-citation-pack-preflight.md): full 9,709-bill pool reconciled, 6,295 absent exact mapping matches, 2,408 initial screen candidates. Selected 500 all pass deployed Edge Function dry run / 11,247 chunks / zero paid usage or ingestion writes; capacity healthy. Source PDF identity passes 402; Download/version and complete quality checks remain unresolved. Owner requested findings before starting; no live release.
  - **Shared blockers and next batch (2026-10-11):** owner authorized local mapping/proof fixes and preparation only; [spec](../specs/2026-10-11-corpus-batch-blockers.md), [plan](2026-10-11-corpus-batch-blockers.md). The owner subsequently said “go Ingest” after reviewing the report: ingestion is authorized once mandatory checks pass. Zero quality-accepted sources currently exist in this batch; keep it non-executable until quality and live mapping holds are resolved. Deployment and quality waivers are not authorized. Local resolver/provenance fixes tested; [readiness evidence](../research/2026-10-11-corpus-batch-readiness.md): 500 review candidates, 81 paired PDF identity passes, 65 local identity bindings, zero release-ready. Remaining work: broader binding/coverage review, source-specific OCR/layout/table-context proof, deployed Download verification and exact owner-reviewed release.
  - **Pending corpus continuation (owner authorized2026-10-10):** [spec](../specs/2026-10-10-pending-corpus-continuation.md), [plan](2026-10-10-pending-corpus-continuation.md). Thirteen sources stored /253 full version4 chunks; live2,767 documents /2,764 indexed /87,886 chunks /1,476 covered bills, all vectors/spans/identity/citations verified. Government2023 and University2025 now have mandatory section-quality repair holds: small-cap B E enactment marker lost operative context; exact no-write correction draft10+121 chunks awaits existing-source replacement authorization. Two Appropriation sources remain accepted. All43 next-header candidates screened: Repealing2022/2023 ingested19 chunks and Deposit Insurance2021 mapped to its proven2021 key/ingested23 chunks with all seven clauses.41 remain:40 historical OCR/header holds and Coconut2021 shared-key collision. Three modern body-held sources now ingested21 chunks with both clauses recognized and independent full audit; five separate body leads remain held: four historical scans now visually reviewed with substantive OCR corruption (three pass90% identity but fail quality), plus encoded Appropriation2024. Pension1982 incomplete image-backed transcription now preserves corrigendum; distorted scan proviso requires legible independent copy before release.Two modern Lok Sabha versions now ingested14 chunks and independently audited with both clauses and six scoped citations; original Download proof resolved using independently image-backed cover assent boxes, unchanged original hashes/guards. Completed job-two-version-v1 must never restart; pool423 indexed/3 stubs/6638 absent, still mapping candidates. Next Pharmacy2023 Lok Sabha version c096aac25ab0399414247b7c4ef408e8ba1d7733 is absent and source draft passes14/14; original Download only15/17 due margin/body ordering, held with no release. Scheduled Castes2023 lead already indexed and excluded. Next Rajya Sabha Tribes2024 d5b22b9100ac0aa8b01b040bb55597b7bf30c686 and Lok Sabha JKCastes5a6ac11448aefcae53ff1d08ac87288af3b12474 source drafts pass but unchanged Download OCR fails11/13 and 7/11; held/no release. Five additional already indexed leads excluded. Two AP/Industrial introduced2026 versions now ingested24 chunks with both clauses/reasons/annexures and IR financial memorandum; nine scoped citation probes passed. Completed job-introduced-v1 must never restart.15-minute heartbeat ACTIVE with context gate. [Execution record](../research/2026-10-10-pending-corpus-continuation-run.md). No original edits, deployments or waived holds.
  - **Three-source ingestion priority (owner go,2026-10-10):** [spec](../specs/2026-10-10-three-source-ingestion.md), [plan](2026-10-10-three-source-ingestion.md). Completed exact three-source ingestion after full reviewed repair/preflight:1,874 complete version4 chunks, all vectors/spans/context/identity/provenance and six scoped citation probes independently verified. Live2,754 documents /2,751 indexed /87,633 chunks /1,467 covered listing keys, zero orphans/null vectors; ANALYZE counts agree. [Execution report](../research/2026-10-10-three-source-ingestion-run.md). Owner browser acceptance and next exact queue remain. No hold waiver, original edit, deployment or existing-source cleanup.
  Finding (I7, 2026-10-01): rbidocs.rbi.org.in answers a scripted download
  with "Request Rejected", and may refuse Mistral's fetch as well. Its 76
  links need another route, such as an admin upload.
  - **Existing-text single pilot (owner-authorized 2026-10-09):** exactly one document, `bill:2025:113`, through the existing text ingestion endpoint; [spec](../specs/2026-10-09-corpus-single-pilot.md), [plan](2026-10-09-corpus-single-pilot.md). Completed after connectivity returned: exactly one indexed document (`38f15384-c4c9-45a3-8d3f-2259ba1411cd`), six real embedded chunks, original hash/spans/URL/key and scoped retrieval verified; totals now 2,341 documents / 54,346 chunks. Owner confirmed the live RAG sample worked on 2026-10-09; single-document pilot accepted. Bulk ingestion remains pending separate authorization and plan. This specific authorization supersedes R7's re-OCR requirement for this one sample only.
  - **Bulk preparation (2026-10-09):** [readiness evidence](../research/2026-10-09-corpus-bulk-readiness.md), [spec](../specs/2026-10-09-corpus-bulk-preparation.md), [plan](2026-10-09-corpus-bulk-preparation.md). Remaining screened direct-PDF inventory: 13,919 sources, including 7,064 bills. Owner authorized the first stage: 23 documents / 518 chunks ingested; final key-collision check held three, leaving 20 searchable documents / 457 chunks. Owner subsequently authorized [removing the held embeddings](../research/2026-10-09-held-embedding-cleanup.md): exactly 61 chunk rows deleted, source text/PDF URLs retained and chunking status reset for later corrected re-ingestion. [Execution and correction evidence](../research/2026-10-09-corpus-first-stage-run.md). Provider cost USD 0.00234268; runner implemented and verified. Owner browser acceptance and later cohort authorization remain pending.
  - **Owner continue/do500 eligibility refresh (2026-10-09):** [exact run evidence](../research/2026-10-09-corpus-recovered-body-run.md). Complete current two-feature screen of7,064 bill sources:327 unstored exact-Download candidates before actual-PDF approval;500 not eligible yet. Fresh79 body-hold rechecks recover71 sources /5,063 complete version4 chunks; eight body holds and two additional header failures excluded. Freeze71 under500-capacity sequential profile,USD0.42 reservation budget, fresh baseline/dry-run/metrics and independent20-document/2,000-chunk audit/ANALYZE acknowledgements. Completed71 /5,063 full version4 chunks /USD0.01581312,71 first-attempt paid writes; four independent maintenance audits/ANALYZE acknowledgements, final142 scoped citations and all vectors/spans/input hashes/Download attachments pass. Final2,576 total /2,573 indexed /72,917 chunks /1,464 covered keys (+68). Zero orphan chunks or unindexed documents retaining chunks;79 retrieval/21 capacity windows pass.256 exact-Download candidates remain unapproved. Owner natural-language RAG acceptance and resolver/version/gazette/shared-key/nonbill/oversize holds remain open; no guard relaxation or500 ingestion claim.
  - **Alternate-version mapping (owner continuing mapping,2026-10-09):** [spec](../specs/2026-10-09-corpus-version-mapping.md), [plan](2026-10-09-corpus-version-mapping.md).6,829 unstored frozen bill sources already have local text/URL/key mappings;827 share a bill with another Download version. Read-only two-PDF proof of226 ordinary alternate-version candidates /141 keys, narrow optional worker guard and context drafts. No new paid ingestion/publication in this phase. Broader wrong-bill resolver/gazette/collision/nonbill holds remain separate.
  - **Alternate-version audit complete (2026-10-09):** [report](../research/2026-10-09-corpus-version-mapping.md).226 sources reconciled:175 /116 bill keys pass two-PDF/original/listing proof,12,842 complete context chunks; all175 endpoint dry checks and corrected-worker probe pass.51 held; production unchanged2,576 /2,573 indexed /72,917 chunks /1,464 covered listing keys. All116 bill keys already covered: these add versions, zero new bill coverage.90 focused/2,465 app tests,lint/build pass; two guard-removal mutations fail as intended. Before alternate-version bulk release, separately scope explicit RAG passage version labels and owner version-specific pilot: current passage formatter omits document_role. Broader wrong-bill Download resolver/gazette/nonbill holds remain open; no new paid ingestion/backend deployment/main change.
  - **Version labeling follow-up (owner continue,2026-10-09):** [spec](../specs/2026-10-09-corpus-version-labels.md), [plan](2026-10-09-corpus-version-labels.md). Caller-scoped bounded document-role hydration and fixed passage labels, legacy/span preservation and mixed-version runtime evidence; fresh uncovered-cohort screening. Local only; no deployment/ingestion/publication in this phase.
  - **Version labeling local verification complete (2026-10-09):** [report](../research/2026-10-09-corpus-version-labels.md). Caller-scoped role hydration/fixed passage labels;175 drafts /12,842 passages preserve original text/hash/URL, mixed-version model-context probe and removed-label mutation prove behavior.154 focused/880 full Deno/2,465 app tests,lint/build pass. Fresh unstored screen6,829:6,068 sources /5,256 candidate keys lack indexed text, not verified ingestion counts. Next25 source proofs yield19 /18 uncovered keys /64 chunks, six held; zero ready until Download resolver correction. Function activation/owner mixed-version acceptance and verified legacy-role provenance remain open; no deployment/ingestion/backfill/publication/main change.
  - **Production ingestion resume completed (owner2026-10-10):** [plan](2026-10-10-corpus-ingestion-resume.md), [execution evidence](../research/2026-10-10-corpus-version-ingestion-run.md). Served research-chat v47 narrowly activates version roles; exact175 documents /12,842 complete version4 chunks ingested and independently audited with350 scoped citation probes. Final2,751 documents /2,748 indexed /85,759 chunks /1,464 covered listing keys; zero orphan chunks, exact real/planner counts after ANALYZE.1,984,754 tokens,USD0.03969508,175 paid attempts/no paid retries/unknown usage. Ten maintenance gates; sampled CPU max17.07%, available memory min38.23%; two isolated retrieval outliers, no health pause.500 is the supported job ceiling; this eligible175-version queue is exhausted and adds versions to116 already-covered bills.19 wrong-button proposals and other holds remain excluded; broader mapping and owner natural-language sample acceptance remain open. No frontend/schema/backfill/service/main publication; changes remain uncommitted.
  - **Scheduled follow-up (owner2026-10-10):** existing `check-corpus-ingestion` heartbeat updated ACTIVE every15 minutes in this chat; no duplicate writer, only eligible approved-manifest resumes with exact audits/maintenance, otherwise read-only remaining mapping investigation. Current175-doc queue is complete; held cohorts remain excluded. Monitor explicitly inventories mapped-but-absent/unindexed/unembedded sources and applies mandatory full preflight plus post-write audits; mapping alone cannot release a manifest or bypass partial-write recovery. Configuration status/interval/target and this added scope read back and verified. See the execution evidence above.
  - **Mapped-pending heartbeat investigation (2026-10-10):** [evidence](../research/2026-10-10-corpus-mapped-pending-monitor.md). Fresh live sources reconcile6,654 remaining candidates from the prior bill screen, not proven-ready counts. Of267 historical exact-URL candidates,254 have prior identity/body/Gazette holds; eleven large candidates lack receipts, and two smaller candidates freshly fail PDF-header extraction (incomplete/encoded digits/title). Rendered first-page review confirms both expected bill numbers/year/title/version; PDF.js drops/encodes glyphs, so these are potentially recoverable extraction cases. Follow-up full PDF.js body samples match23/23 and40/40, but the local corpus texts contain the same corrupt header/title/date characters. Both remain source-quality holds; alternative pypdf/pdfplumber extraction still fails the unchanged header gate. Six visually verified repair spans are now preserved in two local drafts,42 complete version4 chunks with exact source spans/input hashes and zero midword splits. Original corpus unchanged. Worker currently requires original/text hashes equal, so a verified raw-to-repaired provenance path and full preflight remain necessary; zero complete ingestion-preflight passes or paid writes. No approved unfinished job/managed locks; live2,751 /2,748 indexed /85,759 chunks, zero null/orphan vectors.
  - **Large exact-URL size screen (2026-10-10,03:55 IST):** eleven original/Citation Pack hashes and full version4 context spans/input hashes verified locally. Three fit current600k-character/800-chunk worker bounds: Social Security2019 (773), Financial Resolution/Deposit Insurance2017 (776), Bharatiya Nyaya Sanhita2023 (757); eight remain oversize. None has complete fresh preflight or an authorized manifest. Existing preflight700-chunk/older-chunker contract requires reviewed reconciliation before release; no bypass or production writes. See the mapped-pending evidence above.
  - **Three-source PDF/listing proof (2026-10-10,04:10 IST):** fresh read-only checks prove exact current two-feature Download attachments and unchanged PDF identity gates for Social Security2019, Financial Resolution/Deposit Insurance2017 and BNS2023:40/40,40/40,37/40 body samples;2,306 full version4 chunks, exact spans/input hashes, zero midword cuts. All three sources and their exact bill keys have no live documents. No released queue or writes; source-quality review, preflight contract, budget/dry-run/manifest health/capacity/release remain. Evidence in mapped-pending research; broader holds unchanged.
  - **Pending-source layout review (2026-10-10,04:25 IST):** five rendered body pages compared with original OCR and actual version4 content/input. Opening chapter/clause context is correct, but margin labels and (in introduced bills) printed line numbers remain interleaved in body prose. Exact hashes/spans do not certify reading order. Three sources /2,306 chunks remain pending quality assessment; no text repair, ready/released manifest or writes. Broader quality decision and any hash-bound repair route precede release; mapped-pending evidence updated.
  - **Existing indexed mapping-recovery inventory (2026-10-10,04:40 IST):**123 bill-feature documents lacking metadata keys already contain6,079 chunks. All123 match exact pack and individual OCR hashes;114 have pack key/URL proposals across94 keys.73 keys have unique two-feature rows,18 are absent and three have duplicates. No ready metadata correction or reupload: current Download/PDF/identity and complete legacy chunk/vector recovery proof plus narrow authorization required. Separately107 indexed bill docs /79 metadata keys lack either current listing;1,543 metadata keys versus1,464 current listing-covered keys is confirmed. Three stubs remain0 chunks, two page-OCR records121 chunks; global structural indexing/vector-dimension/span-presence checks pass, not a full semantic/vector audit. See mapped-pending evidence; no metadata/data writes.
  - **Missing-key recovery Download refresh (2026-10-10,04:55 IST):**88 existing indexed candidates /73 unique two-feature keys refreshed read-only.7 match row identity/exact current Download;80 differ/miss Download,1 identity mismatch. Pack-level URL relationships for80:55 other mapped keys,15 same-key other source requiring two-PDF proof,9 missing/multiple,1 not in pack. Seven still need PDF/year/version/source-quality/full legacy chunk-vector audit and exact authorized metadata recovery; zero recovery/ingestion-ready releases or writes. See mapped-pending evidence; never upload these already-indexed sources again.
  - **Seven recovery-PDF checks (2026-10-10,05:10 IST):** all7 exact-Download candidates remain automatic header holds:6 scanned PDFs have no extractable text,1 only128 characters. Rendered first pages match5 expected bill headers;2 differ in title (2003:63,1996:49), requiring independent version/title provenance proof. No full-body OCR/legacy-vector proof or approved alias/recovery; already-indexed sources must not be uploaded again. Zero OCR/embedding/metadata writes, no ready release. Evidence in mapped-pending research.
  - **Seven-source legacy integrity (2026-10-10,05:25 IST):** complete readback178 vectors/chunks:1536 finite/nonzero vectors, exact raw spans and v1 hash identity. Historical3a1e565 chunker reproduces all7 expected deduplicated sets exactly;23 duplicate hashes explain the127-chunk source's index gap (not a missing-write conclusion). PDF scan/body/source-quality and two title-provenance holds remain; missing-key metadata untouched, no scoped-attachment approval or ready recovery release. See mapped-pending evidence; no paid requests or writes.
  - **Full short-scan review (2026-10-10,05:40 IST):** visually compared all4 PDFpages for existing indexed candidatebill:2019:3 with its full stored OCR. Operative body appears complete; bill-number headers/marginal labels/back-page imprint and some quote punctuation omitted. Prior3-chunk/v1 vector audit intact. Automatic scan hold and missing metadata key remain; reviewed scan/quality/attachment recovery and exact authorization required, no duplicate ingestion or production writes. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0540.
  - **Full RBI scan quality hold (2026-10-10,05:55 IST):** all4 pages of existing indexed candidatebill:1991:3 reviewed. Operative clauses appear complete, but numeric/mixed-script OCR noise after clause3 is embedded in legacy chunk1; faint mirrored bleed-through visible on scan. Two-vector structural audit does not establish clean text. Source-quality/repair and exact attachment recovery required; no writes or duplicate upload. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0555.
  - **Full1992 scan context hold (2026-10-10,06:10 IST):** all5 pages of existing indexed candidatebill:1992:LXXX reviewed. Operative/statement/annexure body appears present; retained line digit, broken nominated word, moved margin label and omitted statement heading are embedded context defects. Suspicious statement wording matches printed source and must not be guessed away. Eight prior v1 chunks structurally complete; quality/scan/attachment recovery remains held, no writes. See mapped-pending report andcorpus-monitor-20261010-0610.
  - **Full1971 scan quality hold (2026-10-10,06:25 IST):** all5 pages of existing indexed candidatebill:1971:173 reviewed. Main clauses appear present, but separate margin headings inserted into clauses2/3 and clause(1) misread as clause(i) are embedded defects; regulations remains split across pages. Eight historical-v1 chunks structurally complete; source-quality/scan/attachment recovery held, no writes. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0625.
  - **Full2003 scan dual hold (2026-10-10,06:40 IST):** all4 pages of indexed candidatebill:2003:63 reviewed. OCR and PDF both say Ninety-second; listing says One Hundredth, requiring independent version/title provenance. Clause2 lead reordered and literal HTML image markup embedded; two structurally complete v1 chunks do not certify context quality. Title/quality/scan/attachment recovery held, no writes. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0640.
  - **2003 official title-change evidence (2026-10-10,06:55 IST):** primary Lok Sabha reference indexed passage/page337 explicitly records Bill63/2003 formal short-title change One-hundredth→Ninety-second on22Dec2003, corroborated by High Court index. Direct capture timed out; hash-bound reviewed alias/recovery proof still pending. Separate scan-vs-official assent-date annotation conflict preserved; OCR markup/order hold remains. No metadata/embedding writes or release. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0655.
  - **1996 severe OCR hold (2026-10-10,07:10 IST):** indexed candidatebill:1996:49 contains805 repeated nonsense-phrase occurrences/mixed-script prefix before readable title at offset10,366, embedded in legacy chunks. Three of9 PDFpages visually reviewed show readable operative English/bleed-through;28 structurally valid v1 chunks do not certify quality. Full recovery and exact title provenance remain pending, no alias/metadata/vector writes. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0710.
  - **2005 sampled reading-order hold (2026-10-10,07:25 IST):** indexed candidatebill:2005:LXXIX PDFpages4–5/34 confirm definitions(i)/(h) reversed in raw text and lowercase(l) label stored as capital(I); both definitions present.127 expected deduplicated legacy chunks remain complete;23removed duplicate hashes explain index gap, not semantic quality. Broader PDF/source-repeat/quality review and exact recovery remain pending; no writes. Evidence in mapped-pending monitor andcorpus-monitor-20261010-0725.
  - **Recovery inventory consolidation (2026-10-10,07:40 IST):** fresh seven-source live IDs/hashes/indexing/counts confirm178 existing chunks, zero null vectors and missing key/fileURL unchanged. Hash-bound draft inventory separates full versus sampled quality evidence; all7 held/execution_authorized:false,0ready, no duplicate-upload eligibility. Subset of123 indexed missing-key sources, not added absent-source coverage. Current readiness table in mapped-pending monitor, corpus-monitor-20261010-0740; no writes.
  - **Alternate-version recovery review (2026-10-10,07:55 IST):** fresh unique two-feature listing for bill:2024:98 confirms Download differs from indexed source367cda61. Both public PDFs cached/hashed; visual covers show98-C/2024 Lok Sabha versus98-F/2024 both Houses, latter title2025. Source is a16-page scan with no extractable text; original OCR starts at clause2 and lacks page1 clause1 short-title/commencement phrases. Existing49chunks/zero null vectors remain missing key/fileURL; no reupload/recovery release. Full body/quality, reviewed repair provenance, two-version title proof, legacy audit and authorized recovery remain pending. Evidence corpus-monitor-20261010-0755; no writes,0ready.
  - **Bulk pending preparation refresh (2026-10-10,10:56UTC):** full7,064 pool/source presence and19,634 current two-feature listing rows reconciled;423 indexed-present/3 recovery/6,638 absent, not readiness counts. Current Download screen254 exact URLs,5,098 differing URLs and1,286 mapping/identity holds;254 include193 Gazette/61 ordinary leads.68 alternate-version source/Download archive/pack hashes and complete local context screens,24 paired PDF identity checks; two Repealing2022 pairs pass identity only and require full image-backed quality/manual-year/version proof before release. Batch ledger /private/tmp/corpus-bulk-screen-20261010; no ingestion/provider calls or new ready manifest. Continue batch preparation with all gates. [Evidence](../research/2026-10-10-pending-corpus-continuation-run.md).
  - **Extended bulk quality screening (2026-10-10,11:11UTC):**51 additional absent version candidates raw/archive/pack/context checked,7 PDF pairs screened. Three larger sources independently pass unchanged source/Download identity: Aircraft Objects2025 /Indian Ports2025 /FinanceNo2 2024,206/297/575 local chunks (1,078 total), not stored/ready counts. Exact spans/input hashes pass, but12 sampled image pages reveal margin/line-number interleaving, incomplete clause-prefix recognition and financial-table column reconciliation requirements. Full hash-bound quality/context proof pending; no release/pay/write. Evidence /private/tmp/corpus-bulk-extended-20261010-1111; prior Repealing2022 manual-year/version-contract hold unchanged. [Execution record](../research/2026-10-10-pending-corpus-continuation-run.md).
  - **R7 listing-link blocker:** fix and verify the bill analysis fallback join, which omits year and currently resolves 4,584 remaining bill-source candidates to a URL associated with another bill key in the pack. Separate valid document-version differences from wrong-bill links; never treat all different URLs as wrong. Keep missing/unproven links, 93 current-identity holds, 53 oversized bills, and two failed first-stage PDF identity probes on hold. Also resolve the three first-stage shared-key/different-title collisions (2025:109, 2025:111, 2026:107) before releasing the held documents; the runner now rejects such keys. Nonbill scoping and measured capacity gates remain required before later cohorts.
  - **Trackable existing-text job plan (2026-10-09):** [spec](../specs/2026-10-09-trackable-corpus-jobs.md), [ordered plan](2026-10-09-trackable-corpus-jobs.md), [read-only refresh](../research/2026-10-09-trackable-corpus-inventory.md). Of the earlier 524 exact-URL candidates, 23 are already stored, 35 additional sources have ambiguous shared keys and two failed PDF checks. Remaining 464 candidates: 347 small and 117 medium; all still need actual-PDF preflight before release. J1–J8 cover manifest preparation, bounded worker, partial-write reconciliation, restart supervision, capacity verification and separately authorized execution. Start with one worker, proposed stages of at most 25 documents / 1,000 chunks; no new ingestion, paid provider calls or service installation during planning. Current totals rechecked: 2,364 documents / 2,361 indexed / 54,803 chunks. Mapping fixes for excluded cohorts need not block preflight of the clear subset.
  - **Job implementation/preflight (owner “go”, 2026-10-09):** [executed evidence and release proposal](../research/2026-10-09-trackable-corpus-job-preparation.md), [operator guide](../operations/corpus-jobs.md). 347 small sources checked against original text/pack/current listings/PDFs: 91 pass (2,350 chunks), 256 held for internal evidence review (145 gazette identity, 63 body comparison, 42 header, three title, three version). Generic worker/reconciliation and foreground supervisor implemented; 46 focused checks, 2,465 application tests, lint/build pass. First proposed stage 25 documents / 681 chunks (24 newly covered bill keys) passed no-write endpoint checks; exact release approval pending, with USD 0.08 budget and post-stage ANALYZE. J7/J8 unexecuted; no service installed or new vectors produced. CPU telemetry unavailable, so first release must be supervised. The 117 medium, 35 additional key ambiguity, two prior PDF failures and three text-only holds remain pending; do not classify all preflight holds as client-data blockers.
  - **First released trackable-text stage (owner-authorized 2026-10-09):** [execution evidence and two RAG samples](../research/2026-10-09-trackable-corpus-stage-01-run.md). Completed 25 documents / 681 chunks; all source hashes, bill keys, listing Download PDFs, vectors, citation spans and scoped retrieval verified. 24 newly covered bill keys; totals 2,389 documents / 2,386 indexed / 55,484 chunks / 1,281 covered bill keys. Receipts: 112,646 embedding tokens / USD 0.00225292; no failures or unknown usage. ANALYZE and planner-count checks passed; all 27 retrieval health windows passed. Paused for owner chat/citation tests before any next stage; 66 other passing small sources remain. No persistent service or new cleanup.
  - **Second trackable-text stage (2026-10-09):** owner confirmed first-stage RAG works and instructed “Working, continue.” [Executed evidence](../research/2026-10-09-trackable-corpus-stage-02-run.md): 25 documents / 693 chunks completed, all source/link/vector/span/bill-scoped retrieval checks passed, 25 newly covered bill keys. Receipt cost USD 0.00215422; no failures/retries/unknown usage. ANALYZE and 27 health windows passed. Current totals: 2,414 documents / 2,411 indexed / 56,177 chunks / 1,306 covered bill keys. Stopped at batch boundary; 41 passing small sources remain, no later release/service/cleanup.
  - **Final approved subset completed (2026-10-09):** [execution evidence](../research/2026-10-09-trackable-corpus-final-run.md). Owner-authorized modest increase to 30-document cap; final 41 / 976 chunks completed as 30 + 11. All mappings, Download PDFs, vectors/spans/scoped retrieval verified; 40 new bill keys, no failures/retries/unknown usage, receipt cost USD 0.00322986. 45 health windows and ANALYZE passed. Full approved 91-source queue complete (2,350 chunks / 89 newly covered bill keys). Current totals 2,455 documents / 2,452 indexed / 57,153 chunks / 1,346 bill keys. 48 focused checks, 2,465 application tests, lint/build passed. Broader holds/medium/other cohorts remain open; no service/deployment or main change.
  - **Medium corpus investigation completed (2026-10-09):** [readiness report](../research/2026-10-09-medium-corpus-readiness.md), [spec](../specs/2026-10-09-medium-corpus-preflight.md), [plan](2026-10-09-medium-corpus-preflight.md). All 117 audited: 48 pass /10,093 chunks /48 currently uncovered bill keys; all 48 no-write endpoint checks pass and no embedding clamp affects them. 69 held for internal evidence review (47 gazette,16 body,4 header,1 title,1 version); no concrete client-input blocker established. Eight lower-risk passes /672 chunks require only a tested character-limit increase to75,000; exact83-chunk Immigration2025 pilot and seven589-chunk follow-up proposals frozen, execution unauthorized. Live worker unchanged;51 focused checks,2,465 application tests,lint/build pass. No ingestion/embedding charge; production remains2,455 documents /2,452 indexed /57,153 chunks. Medium execution and hold review remain open.
  - **Existing-text context correction (owner requested 2026-10-09):** [spec](../specs/2026-10-09-text-section-context.md), [plan](2026-10-09-text-section-context.md). [Local implementation/evidence](../research/2026-10-09-text-section-context.md): explicit version-4 context ingestion, original spans, context-aware vector identity, section-bounded packing and whitespace fallback; legacy/page regressions unchanged. 65 focused Deno,59 focused Node,874 full Deno,2,465 application tests,lint/build and two non-vacuous local SQL fixtures pass;91-chunk fake-vector local storage/visibility probe rolled back.48-source refreshed audit:10,689 chunks; six fit bounded worker (518 total), Immigration pilot91/follow-up427 proposals frozen and unauthorized. Production remains2,455 documents /2,452 indexed /57,153 chunks, zero version4. Function activation and owner RAG pilot pending exact release; no broad re-embedding authorized.
  - **Context pilot release completed (owner “go”, 2026-10-09):** [execution evidence](../research/2026-10-09-text-context-pilot-run.md). Only `ingest-documents` deployed as version19; Immigration/Foreigners2025 (`bill:2025:22`) indexed with91 complete context-aware chunks, original text/PDF/listing identity preserved. Independent vector/hash/span/section and real bill-scoped retrieval/text-citation checks pass. One provider request,13,105 tokens,USD0.0002621; no retries or unknown usage. ANALYZE completed; current totals2,456 documents /2,453 indexed /57,244 chunks /1,347 covered listing bill keys. One transient slow pre-write health window recovered; no consecutive-window pause. Owner natural-language RAG acceptance pending; five /427 follow-up remains unauthorized. No broader re-embedding, scheduler, merge or push.
  - **Owner RAG acceptance and follow-up release (2026-10-09):** Owner confirmed the context pilot worked and instructed continuation. Five prepared context documents /427 chunks now authorized under the existing USD0.08 supervised manifest; fresh baseline and all no-write checks passed. Larger42 sources, identity holds and broad re-embedding remain outside this release.
  - **Context follow-up completed (2026-10-09):** [execution evidence](../research/2026-10-09-text-context-follow-up-run.md). Five complete documents /427 chunks /five new covered bill keys, all mappings, source/input hashes, spans, vectors and real scoped retrieval/text citations verified. Five live attempts, six provider requests,66,738 tokens,USD0.00133476; no retries or unknown usage. All nine health windows passed; ANALYZE counts agree. Current totals2,461 documents /2,458 indexed /57,671 chunks /1,352 covered listing bill keys. Full bounded context cohort six /518 is complete;42 verified larger sources /10,171 context chunks require measured larger-document policy;69 medium holds remain open. No code/deployment/merge/push or broad re-embedding in this stage.
  - **Next50 preflight (owner requested2026-10-09):** [plan](2026-10-09-next-50-preflight.md). Read-only audit of42 remaining prior medium passes plus eight non-gazette held candidates, selected by ascending legacy chunk count/source key. Refresh original text/pack/current listing/live PDF checks and version4 spans/context/endpoint dry runs. No ingestion or guard expansion in this task; all50 must reconcile to evidence/holds and worker capacity.
  - **Next50 preflight completed (2026-10-09):** [evidence](../research/2026-10-09-next-50-preflight.md). Exact50:42 refreshed original/pack/listing/PDF identity passes and eight unchanged internal holds (six body,one version,one header). All42 context endpoint dry runs pass:10,171 chunks, zero word-interior cuts/input clamps. Actual worker guard rejects every source (103–790 chunks);38 exceed75,000 characters. Estimated embeddingUSD0.04360756, one-attempt byte reserveUSD0.17527916; no charges/writes. Counts unchanged2,461 /2,458 indexed /57,671 chunks. Tested larger-document worker reads/limits and progressively measured release remain required; no truncation or50-source one-shot capacity claim.
  - **Larger worker (owner Continue,2026-10-09):** [spec](../specs/2026-10-09-medium-worker.md), [plan](2026-10-09-medium-worker.md). Explicit context-only medium profile, bounded paginated full-chunk reads; default small/stage guards preserved.63 focused checks including real120-chunk multi-commit/lost-response/partial-hold integration,2,465 application tests,lint/build passed. First progressively measured pilot: Bharatiya Vayuyan2024 (`bill:2024:74`),103 chunks,USD0.015, fresh checks pending. Other41 and eight holds remain outside this pilot release.
  - **Larger worker/first pilot complete (2026-10-09):** [evidence](../research/2026-10-09-medium-worker-pilot.md). Explicit medium_v1 context profile800/600,000, complete bounded pagination; small/stage guards intact.63 focused checks incl actual120-chunk multi-commit lost-response/partial-hold and101-row defect mutation,2,465 application tests,lint/build pass. Bharatiya Vayuyan2024 (`bill:2024:74`) ingested103 complete verified chunks,USD0.00032406, no retries/unknown usage; five health windows and ANALYZE pass. Current2,462 documents /2,459 indexed /57,774 chunks /1,353 covered listing bill keys. Remaining41 /10,068 context chunks require progressively measured release; eight identity holds excluded. No deployment/merge/push/cleanup.
  - **Remaining41 progressive release (owner Continue,2026-10-09):** [plan](2026-10-09-medium-worker.md).13 frozen ascending-size stages /10,068 chunks,USD0.08 stage ceiling, full fresh identity/PDF/price/health/dry checks and independent audit/ANALYZE/count acknowledgement between stages. Eight identity holds excluded. Foreground only, no code/deployment/service/cleanup; halt on failed verification or partial state.
  - **Remaining41 progressive release completed (2026-10-09):** [evidence](../research/2026-10-09-medium-progressive-run.md).13 ascending-size stages,41 sources /10,068 complete version4 chunks /41 new covered keys; all vectors/source/context/spans/Download identity and82 scoped citation probes verified.1,647,072 tokens,USD0.03294144,41 live attempts/129 prepared provider batches, no paid retries or unknown usage.93 health windows passed; all post-stage ANALYZE/planner/count checks match. Stage9 read-only timeout recovered without paid retry. Final2,503 documents /2,500 indexed /67,842 chunks /1,394 covered listing keys. Approved48 medium sources /10,689 context chunks now complete; next50 audit resolves42 ingested plus eight unchanged holds.69 medium identity/body holds and other R7 cohorts remain open; owner natural-language sample acceptance pending. No implementation/deployment/service/merge/push/cleanup in this execution.
  - **Identity-hold investigation (owner continue,2026-10-09):** [plan](2026-10-09-identity-hold-review.md).54 header/title/version holds selected across small/medium; preserve fresh PDF/source diagnostics and recheck original hashes/current listing Download identity. Read-only first; no threshold relaxation, guessed mapping, OCR/embeddings or cleanup. Gazettes/body disagreements/shared-key conflicts remain separate.
    -54 fresh diagnostic failures preserved; local figure-dash parser defect corrected with red/green regression proof,65 focused checks and2,465 app tests plus lint/build. Corrected cached review:43 header /4 title /4 version /3 body holds, zero released. Three modern sources reach100% body agreement only in a marginal-note layout experiment; next establish and regress a justified layout rule, compare all prior passing PDFs and body holds, resolve Repealing/Amending2022-key/2023-title version identity, then fresh preflight/context dry run before release. [Report](../research/2026-10-09-identity-hold-review.md). Production unchanged2,503 documents /2,500 indexed /67,842 chunks; no new embeddings/OCR/mapping writes.
  - **Larger-batch capacity plan (owner request,2026-10-09):** [plan](2026-10-09-corpus-capacity-and-larger-batches.md). Live healthy16/90 connections, zero lock waits/deadlocks,99.038% cumulative cache hits; physical tier/CPU/RAM remains unverified (dashboard sign-in/Chrome timeout; historical2GB only). Proposed50-document queue, single writer,2,000-chunk stages after a tested explicit worker profile and1,000–1,500-chunk pilot; retain30/stage and800/document guards, context quality, reconciliation, health/cost gates and ANALYZE. Current executable1,000-stage cap unchanged; no new eligible inputs or ingestion. Complete identity/layout evidence first. No compute upgrade or parallel writer authorized by this plan.
    - **Supabase-plugin follow-up:** official metrics API now verified using two read-only samples:106s idle interval,2 visible cores, roughly2GB RAM /1GB available,1.13% non-idle CPU, disks below0.1% busy. CPU/RAM telemetry is available; billed tier remains unknown. Owner desires500-document stages; plan amended to one writer, per-document checkpoints/full verification and internal maintenance/health windows. Requires explicit tested incremental worker profile and measured load pilot; existing30/1,000 guards unchanged and identity holds remain. No ingestion or production settings changed. Evidence in `corpus-job-plan/capacity-review/metrics-{first,second,summary}.json`.
    - **Owner go:500-stage worker and recovered-source pilot complete.** [Report](../research/2026-10-09-corpus-500-worker-pilot.md), [spec](../specs/2026-10-09-corpus-500-stage.md). Explicit500/20,000/10million-char profile, one writer, live metrics guards and20-document/2,000-chunk maintenance pauses; default bounds unchanged.76 focused tests,2,465 app tests, lint/build,500-entry resume/lost-response fixture and mutation proof. Regressed marginal layout retained139/139 prior passes; fresh identity checks recovered two public Sansad sources,12 complete version4 chunks,USD0.00002810, no paid retries. Full audit/four scoped citations/ANALYZE passed; current2,505 documents /2,502 indexed /67,854 chunks /1,396 covered keys.323 small/medium holds remain; next79 body cases, unreadable headers/title/version/gazette/key cohorts. No500-source live release or sustained throughput proof; owner natural-language samples pending. No deployment/service/merge/push/cleanup.

- [x] **R8. `admin-upload`.** A platform-admin upload tab, with splitting
  in the browser. Spec `specs/2026-10-01-rag-v2-admin-upload.md` (draft,
  approved 2026-10-01). Moved ahead of R5–R7 by the owner
  (2026-10-01): it is the milestone.
  Built on `task/rag-v2-admin-upload` (B0–B4, checkpoint F). The local end
  to end (B5) passed: `research/2026-10-01-admin-upload-local-run.md`.
  **Live on NTER, 2026-10-01** (`agents/coordination.md`): migration 40,
  `admin-ingest`, the Documents tab, and the schedule ON. Remaining: the owner's
  upload of *Budget at a Glance* with "split every 10 pages" and the citation
  check on pages 10/11. Then mark R8 done and make the plan Historical.
  **Amendment A** (records-first document management, approved 2026-10-01; plan
  `plans/2026-10-01-rag-v2-admin-records.md`): built on `task/admin-records`
  (C0–C4, migration `20261001180000_corpus_records`), checkpoint H passed, and the
  local end to end (C5) passed: `research/2026-10-01-admin-records-local-run.md`.
  **Live on NTER, 2026-10-01:** the migration, `admin-ingest` and the frontend. Owner check 1
  passed: the Anti-Doping bill was attached to `bill:2025:77`.
  **Remaining, deferred by the owner on 2026-10-02.** The NTER logs and audit table showed none of
  these had run yet:
  1. upload *Budget at a Glance* with "split every 10 pages" (3 parts), then open a citation on
     page 11 or later;
  2. delete one document (it must show in `corpus_admin_actions`);
  3. from R6, "Open stored copy" opening the PDF in a new tab.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

  Then mark R8 done and make its plans Historical.

- [x] **F32.** (fixed by R2, 2026-10-01) `research-chat` `documentModules` (`index.ts:265-281`)
  reads one row per document with no range. PostgREST caps a read at
  `max_rows` 1000, so modules can be missing from the list. Fixed by R2
  (`document_modules()`).

- [x] **F40.** *Done: the generalised record key and `record_document_links` shipped with F257 (`8f01b348`); `desk_rows.document_key` holds bill keys only, by design. 2026-11-10 (F299)* Rows in 73 of 75 desk features carry no `document_key`, so a dropped row
  from those desks can never attach its document. Only the two bill features have keys. This
  needs stable keys from the loader for every row, and a generalised client key in place of
  `billDocumentKey`. It is admin-upload Amendment A, part A4, and needs its own spec.

- [x] **F42.** *Closed: superseded by R6; the 2,338 older documents stay without pages by the owner's decision (2026-09-30). 2026-11-10 (F299)* Show page numbers in the current text citation reader before the PDF viewer
  (R6) lands. Page-aware chunks already return `page_number`, blocks and the section.

- [x] **F46.** The AI Research chat experience: review `research/2026-10-02-chat-experience-review.md`
  (owner request, 2026-10-02). The owner discusses it before a spec. Confirmed defects:
  - the composer is not pinned to the bottom;
  - the thread opens at the top;
  - finished turns lose their search steps;
  - "thought" is never shown;
  - one model has two names.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

  Also covered there: loading in stages, the thinking indicators, the agent loop's speed and cost
  (53 s and $0.105 for one answer), no visible streaming, and re-render cost.

  **Bug fixes on `task/chat-bug-fixes` (2026-10-02):** `7abd31e`, `a5f84af`, `8dfc571`,
  `cd6a7ac`. All five defects above are fixed, each with a test shown red first.
  - **Verified in a local browser run:**
    - the composer is pinned 14 px from the bottom from first paint;
    - a reload opens at the newest message (0 px from the bottom, re-pinned after the pills);
    - saved steps keep their three lookups;
    - "thought 23.5s" shows when the row has a reasoning count;
    - the saved answer reads "Gemini - Flash".
  - **Pushed to NTER** with `b3b95d0` (Vercel READY).

  **The thinking display (2026-10-02).** Spec `specs/2026-10-02-thinking-display.md`, approved;
  plan `plans/2026-10-02-thinking-display.md`. Built on `task/thinking-display` (`18343c0`,
  `1c882af`, `4491abe`, `c234e51`), and the local browser run passed.
  - **What it does:**
    - one indicator from Send;
    - each stage labelled once;
    - "Found so far";
    - a collapsed summary;
    - the NyAI card removed (ADR 0007 amended).
  - **Shipped:** the thinking-display deployment and frontend push are recorded in
    `agents/coordination.md` on 2026-10-02.
  - **Still open from F46:** loading in stages, and the agent loop's speed and cost.
    - **Update (2026-10-02):** loading in stages was closed by panel loading. The end-of-turn
      shift (D4) measured zero in the chat-panel-fixes run. The agent loop's cost is measured in
      `research/2026-10-02-turn-cost-benchmark.md`: a cap on prompt size costs depth, and the slow
      calls are provider latency (F41).

  **Answer streaming (2026-10-02).** Spec `specs/2026-10-02-answer-streaming.md`, approved, with
  amendments 1 and 2. Built on `task/answer-streaming` (`4150197`, `6e0e9e7`). The local run
  passed: `research/2026-10-02-answer-streaming-local-run.md`.
  - **Result:** answers arrive in 13–37 pieces instead of one block. `timing` records
    `first_model_ms`, `first_answer_ms` and `rounds`. `session_id` is sent.
  - **Owner-approved latency cuts shipped:** Google requests omit explicit cache
    breakpoints; the duplicate client pre-send identity check was removed while
    server authorization remains. The measured tradeoffs and authorization are in
    coordination's October 2 operations record.
  - **Shipped implementation (2026-10-02):** research-chat v42 and frontend
    pushes `0aa8077` and `947dc82`; later function deployments retain these changes.

  **Panel loading, A–E (2026-10-02).** Spec `specs/2026-10-02-panel-loading.md`, approved. Built
  on `task/panel-loading`, and the local browser run passed.
  - **What changed:**
    - one verification per open;
    - the panel kept alive between opens (reopen makes 0 network calls and keeps scroll);
    - one reveal;
    - one layout per open;
    - memoised message rows.
  - **Pushed:** to NTER at `a4da602`, with the bundle re-baselined.

  **Answer speed (2026-10-02).** Spec `specs/2026-10-02-answer-speed.md`, approved; chunks stay
  at 40.
  - **The change:** the question is searched before the first model call (`3efcca9`).
  - **The benchmark** (`research/2026-10-02-answer-speed-benchmark.md`, two passes):
    - 32% fewer model calls;
    - first word earlier;
    - cost 13–38% lower;
    - citations valid 40/40, gold citations 38/40 against 34/40.
  - **Batching** was measured and is not recommended.
  - **Deployed** as research-chat v43.
  - **A fast routing model** (step 4) was dropped by the owner: with the pre-search it would add a
    call to most turns.
  - **Amendment 1** (`1a46546`), so speed never costs depth:
    - the pre-search reply asks for a search per part it does not cover;
    - follow-ups are not pre-searched.
  - **Benchmark pass 3** (`research/2026-10-02-answer-speed-depth-benchmark.md`) is partial: the
    OpenRouter account ran out of credits.
    - Narrow questions keep the gain.
    - Briefs search more than before and cite at least as much, but take about 13 s longer to the
      first word.
  - **Benchmark pass 4** (`research/2026-10-02-answer-speed-depth-benchmark-pass4.md`) is complete:
    all 15 briefs and the 10 follow-ups, $3.68, every call succeeded.
    - **Briefs meet the pass mark.** Pooled over 24, amendment 1 against the baseline: 4.71 against
      3.79 searches, 2.38 against 2.33 documents, 8.50 against 8.25 pages, and the expected
      document 24/24. The first word comes 3 s sooner at p50.
    - **Follow-ups run as the baseline by construction.** v43's verbatim pre-search missed the
      expected document once.
  - **Deployed** on 2026-10-02 as `research-chat` v44 (`agents/coordination.md`).
  - **Next:** the owner checks, signed in on production, a four-part brief and a follow-up.

- [x] **F48.** The citation viewer's header is about 190 px of text buttons in the side pane. It
  becomes a compact, icon-based chrome: two rows in the side pane, and a header plus a floating
  page pill in the full view.
  - **Spec:** `specs/2026-10-02-viewer-toolbar.md` (owner-approved).
  - **Plan:** `plans/2026-10-02-viewer-toolbar.md`.
  - **Piece 2 is re-scoped by the owner (2026-10-02)** into a standard PDF viewer, with its own
    spec:
    - continuous scrolling in the side pane and the full view, opening at the cited page;
    - thumbnails on the left;
    - search in the document;
    - the citation marked by its exact text on the PDF's text layer. Block rectangles stay only as
      a visibly different fallback for pages without a text layer.
    - The PDF loader must hold a few stored parts open at once.
    - **Spec:** `specs/2026-10-02-viewer-continuous.md` (owner-approved; the Text view gets both
      layouts for documents with pages).
    - **Plan:** `plans/2026-10-02-viewer-continuous.md`, T1–T9.
  - **Piece 1 is built and verified locally** (2026-10-02):
    - side pane chrome 83 px, against about 190 px before;
    - a review's four required fixes are applied;
    - 1,826 tests pass;
    - the main bundle is +0, the viewer chunk +5.7 KB.
  - **Piece 2 is built and verified locally** (2026-10-02, T1–T9 and the search start page). An
    independent review found nothing critical; its four behaviour defects are fixed (plan,
    Checkpoint B), and the rest are F50.
  - **Migration 42** (`search_document_pages`) was applied to NTER on 2026-10-02 and verified live
    (`agents/coordination.md`).
  - **Pushed** on 2026-10-02 (`7565408`); production deploy `dpl_GvdNsfQHM8wQwxbLV2SBMt2Zu9FN` is
    READY.
  - **Next:** the owner checks on production:
    - the clipboard's success path (the test browser refuses clipboard access);
    - a real split document;
    - search, exact marks and thumbnails on the live bills;
    - the continuous Text view in Safari (F50).
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F49.** The citation viewer cropped pages to their body text by default ("Fit text"). The
  anti-doping bill's page 1 lost its "As introduced in Lok Sabha" header and its top two thirds,
  and read as a different document from the stored PDF.
  - **Spec:** `specs/2026-10-02-viewer-whole-page.md` (owner-approved).
  - **The fix:**
    - Fit width is the default;
    - Fit text never crops the page's height or any block;
    - the zoom is saved only when the reader chooses it, under a new key.
  - **Shipped:** `4f714f8` reached production in `60b49f4` (Vercel READY, operations
    record 2026-10-02). Owner acceptance is not inferred from deployment.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F50.** Follow-ups from the viewer-continuous review (2026-10-02). None blocks the push.
  - **Built and verified locally** (spec `specs/2026-10-02-viewer-f50.md`, plan
    `plans/2026-10-02-viewer-f50.md`, `4a0871d`..T5). Every item below is fixed except the
    stored-column note, which was settled at migration 42's apply.
  - **Migration 43** (`20261002180000_search_folding`) was applied to NTER on 2026-10-02 and verified
    live (`agents/coordination.md`).
  - **Pushed** on 2026-10-02 (`55d7595`); production deploy `dpl_CaCMMxNPeJoxYPzUjYUdGvW3Y93z` is
    READY.
  - **Next:** the owner checks the continuous Text view in Safari. Then move F50 to Done.
  - **Original findings below (fixed or settled as noted above):**
  - **Query folding.** The client folds with NFC and JS whitespace (NBSP, U+2000–U+200A); the database
    does neither, and `lower()` follows the database collation. Text with NBSP, or precomposed
    Devanagari nukta letters, can find 0 pages in the database yet match on the page. Fold both
    sides alike, and add fixture cases for NBSP and É.
  - **The part pool.** A failed thumbnail job closes the part it shares with page renders, which can
    show the PDF error banner. `pdfPage.cleanup()` is never called, so a long single-part document
    keeps the operator lists of every page visited (memory cost not measured).
  - **Safari.** The continuous Text view relies on `overflow-anchor`, which WebKit lacks, so batches
    arriving above the view may shift the reader. Check in Safari. WebP thumbnails are stored as
    PNG there (they work, but take more space).
  - **Highlight names are global** (`pv-cite`, `pv-match`), each with its own registry. Two viewers
    mounted at once would clear each other's marks. Use a shared, counted registry.
  - **The rail tabs lack Home and End.**
  - **On apply to NTER,** `search_text` is a stored generated column, so adding it rewrites
    `document_pages` under an exclusive lock and doubles its stored text. That is fine at today's
    34 live pages, but note it for the apply.
  - **The search result is not reset** when the document's extraction changes while search is open.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F51.** The sources list under an answer had no styles, so it drew as default grey buttons
  plus the storage file name (owner: "it looks like windows 98"). The owner chose the compact
  list: spec `specs/2026-10-02-source-list.md`, plan `plans/2026-10-02-source-list.md`.
  - **Built and verified locally (2026-10-02):** `2d95bf6` (content) and `2b1bdde` (styles). The
    local run is in `research/2026-10-02-source-list-local-run.md`.
  - **Shipped:** production at `5b49049` (Vercel READY, operations record 2026-10-02).
    Owner acceptance is not inferred from deployment.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

- [x] **F37 note (2026-10-01):** *Closed: a note on F37; its evidence belongs to F37. 2026-11-10 (F299)* in the R6 local run, the 25-page *Budget at a Glance* `index`
  step hit the local Edge CPU soft limit once and succeeded on retry. The F37 risk shows earlier
  than 1,000 pages on a busy machine.

- [x] **F44.** *Closed 2026-10-14: already an accepted risk (section 7, "The preview wildcard in `ALLOWED_ORIGINS`"); the functions take a bearer token, not cookies. Reopen with that risk.* The shared CORS allowlist's Vercel preview pattern (`_shared/cors.ts:21-36`;
  production `ALLOWED_ORIGINS` includes it) matches any `niyantran-*-ddl-labs.vercel.app` host.
  A third party could probably claim such a name.
  - **Risk:** small, because functions authenticate with bearer tokens, not cookies.
  - **Fix:** pin previews to the team scope, or drop them from production and point previews at
    a separate Supabase project.
  - Raised in the R6 security review (2026-10-01).

- [x] **L1.** *Closed: superseded by F278, F307 and ADR 0014. 2026-11-10 (F299)* The 18,071 never-ingested `pdf_text` documents: 7,966 bills,
  6,758 parliamentary questions, 2,813 regulatory documents and others.
  The 5,327 with direct links are R7. The rest have no link and wait for
  admin upload (R8) or an API source.

- [x] **L2.** *Closed: moved to F318 (Law, on hold), with its 874-PDF text-layer check. 2026-11-10 (F299)* Law tier: 874 Supreme Court and NCLT PDFs. First confirm they
  have a text layer.

- [x] **P5.** Page-level citations. Now R3 and R6, for new documents. The
  2,338 existing documents keep unpaged citations (owner decision,
  2026-09-30).
  *Closed 2026-10-15: done by R3 and R6 for new documents; the 2,338 existing documents keep unpaged citations (owner decision, 2026-09-30).*

- [x] **P7.** Affidavits (10,492 documents, 809 M characters; 5,093 current,
  100,151 pages). **Out of scope by owner decision (2026-09-30):** no links,
  personal data.
  *Closed 2026-10-15: out of scope (owner, 2026-09-30: no affidavits).*

- [x] **P14.** Bill-key collisions (two documents on one `bill:<year>:<number>`
  key). Accept, or keep one document per key.
  *Closed 2026-10-15: superseded by the versions model (F116 to F118, F115 clean-up); the remaining collisions (2025:109, 2025:111, 2026:107) are tracked under R7.*

- [x] **P3.** Metering and credits (ADR 0002); an effort column in
  `model_call_logs`.
  - 2026-10-14: metering and credits are delivered by F111; the effort column
    (`model_call_logs.reasoning_effort`) landed in `787bced`. Done.

## 5. Launch (closed items)

- [x] **D1. Supabase dashboard: what remains.** The Auth redirect URLs are
  done (see Done), and leaked-password protection is on (F152, owner,
  2026-10-14). Left:
  - confirm the Storage global upload limit is at least 50 MB. The
    `marketing` bucket allows 50 MB and Supabase's default global limit is
    50 MB, but no tool here can read the global setting. The O8 intro-video
    upload proves it either way;
  - optionally, Auth connections as a percentage.
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

  The tools can't change Auth or Storage settings safely: the CLI's
  `config push` would overwrite the whole remote config.

- [x] **O8 and A2. Signed-in smoke test on production** with a test
  account:
  - save preferences;
  - upload the intro video;
  - switch to Academic and ask one question (the answer opens with
    RESEARCH QUESTION / EVIDENCE / CHRONOLOGY).
  *owner checked on production, 2026-10-15: "The checks that you wanted me to perform are all done. Everything is working. Close them."*

  Agents may not create accounts or sign in on production, so this is the
  owner's. Afterwards an agent can check the rows with read-only SQL.

- [x] **D3. Paid live round.** *Done 2026-10-15 on production (owner signed in, supervisor ran it): greeting, document answer with a highlighted passage, Stop and reload, Gemini Lite medium and cross-account denial passed; defects opened as F197 to F200. [Record](../research/2026-10-15-d3-paid-live-round.md).* Five paid-model scenarios plus a
  cross-account denial check, including:
  - the first live `search_documents` turn with a highlighted span;
  - the admin persona chat on Gemini Lite, Gemini Flash and GPT Astra;
  - medium and high reasoning in production.

- [x] **O10. Vercel plan upgrade (owner).** Owner completed upgrade2026-10-18.
  Authenticated API for team_QFu1p3ObeXmlMQczPBcZb582 confirms plan=pro and
  status=active. No subscription purchase was executed from this checkout.
  [Evidence](../research/2026-10-18-nter-domain-launch-evidence.md).

## Latest v6 candidate acceptance amendment — 2026-10-08

F88/F90/F91/F92 application work is verified through ca70175. Final native shared-shell zoom, reduced-motion, intentional coarse-pointer sector/module tap and hidden-tab evidence is recorded in [the release candidate](2026-10-08-desk-v6-release-candidate.md), superseding earlier pending native statuses above. Live voice remains owner-deferred under F76. Owner subsequently approved publication with “go”; candidate merged into main at d480b11. Branch cleanup remains unapproved. Fresh production dependency audit reconfirms the unchanged P12 xlsx high advisory; it was not introduced by this branch.

R7 execution update: the owner's remaining-270 review and single 182-document / 3,611-chunk ingestion job are complete and independently audited. All 88 source-specific exclusions remain aside. See [270-source final run evidence](../research/2026-10-11-corpus-270-reviewed-run.md) and the latest R7 entry above. Never restart this completed manifest or earlier completed releases. Remaining cohorts and existing-source repairs retain their documented review/authorization requirements.

R7 wider-corpus continuation: [413-document release completed](../research/2026-10-11-corpus-wide-batch.md). All 413 passing sources from the fresh 500-source cohort were ingested in one frozen job: 7,493 complete context chunks, 6,661 contextual chunks, 3,033 independent scoped citation probes passed. The other 87 candidates remain held with evidence. Final live and planner totals: 3,434 documents / 3,431 indexed / 100,031 chunks / 2,143 covered listing bill keys, zero orphan chunks and null vectors. Actual embedding usage 706,730 tokens / USD 0.01413460; all 90 capacity samples passed, peak CPU 16.12%; 15 isolated slow health samples out of 437, no consecutive slow windows, final health passed. Runtime corpus-wide-20261011/job-wide500-v1/final-completion.json binds the full audit and exact SQL evidence. Manifest stage-01.release.json SHA256 b8a987362724afab31e157f01fae72b7f9cd9dec7667db269b4caed5864c2481 is COMPLETE; NEVER restart it. Supervisor exited 0 and locks released. The pre-write fetch recovery at 40 remains documented and preserved. Broader corpus candidates, nonbill scoping, the 87 held candidates and existing-source repair holds remain open; this is not completion of R7 as a whole.

## Done — 2026-10-21 CI fixture maintenance

- [x] **F236 — RSS test fixtures age out.** Local commit `bd7bc92` uses fresh dates relative to the test clock in four routing-test files. Six baseline failures reproduced;28 focused and6522 full application checks pass. Runtime feed behavior is unchanged. Publication awaits the manual-grace release.

## Done — 2026-10-19 homepage browser fixes

- [x] **Mandatory CI enforcement (2026-10-21).** Policy commit d9595ab and native
  GitHub/Vercel operations activated strict main PR checks (admins included)
  and both CI jobs before Preview/Production domain assignment. Cancelled run
  39508667078 kept Preview unpublished; attempt2 passed both jobs and assigned
  its domains automatically. PR4 contains documentation only and stays unmerged;
  no Production release or credential change by this task. Exact settings,
  gate IDs and evidence:2026-10-21-ci-enforcement.md.

- Homepage form identity and image dimensions released in a82bab8; exact production assets and Chrome checked. CSP report was absent in clean Incognito; no application CSP cause proved and no policy weakened. [Release evidence](2026-10-19-frontend-browser-issues.md).

## Done — 2026-10-19 authenticated browser fixes

- BBC browser CORS and fund-flow/account/admin form semantics fixed in 2593b09 and a19e2a8; release 4a0c981 is Vercel production READY and Chrome verified. [Evidence](2026-10-19-authenticated-browser-fixes.md). No data, schema or Edge deployment. Existing development dependency advisories remain F234.

## Done — 2026-10-12 consolidation

- **Corpus code consolidation (2026-10-12), `d0a8020`:** reviewed corpus code, tests and documentation integrated with the released UI on main; original copies preserved outside Git. [Evidence](../research/2026-10-12-main-consolidation.md). R7 ingestion/repair holds remain open.
- **F94 resolved (2026-10-12):** owner-authorized Git disconnect of only `niyantran-desk-reference-v6` (`prj_hlv83bVVPDlaJht0GP7njfUDhsLA`) verified `link: null`; project/deployment history retained. Actual production project still follows main. [Operations record](../research/2026-10-12-main-consolidation.md).

## Done — 2026-10-20 branch cleanup

- [x] Non-payment documentation consolidated in `e11eae0`, original histories retained in `cef7849`, and local main updated. Removed 18 merged local and 8 merged remote branches after payment-agent coordination. All four payment local branches, both payment remote branches, shared working files and existing frontend checkout files preserved. Main documentation remains local, unpublished. [Execution record](2026-10-20-branch-cleanup.md).

## Done — 2026-10-20 Test billing cycle implementation

- Prorated Test upgrades, free replaceable downgrade preferences, explicit manual renewal and retained10% rollover implemented in71ee2cc. All6434 Vitest/1172 Edge tests,49 SQL fixtures and focused concurrency/vacuity/cleanup checks pass; lint/build/bundle/router pass. Owner-approved additive shared migration applied without replacing existing functions. Named owner's frozen Test purchase graph reset to Free; welcome balance/history preserved. Test Preview READY and authenticated browser review verified. [Plan and release evidence](2026-10-20-billing-cycle-changes.md). O6 stays open for genuine new-flow provider acceptance and remaining Live launch gates.

## Done — 2026-10-20 Test billing design and daily pricing

- Scoped modern billing summary/chooser/topups, unified history with collapsed references, branded in-page invoice and IST daily upgrade quotes landed in `0649524`, `bc3b46c`, `f98203d`. Final6447 Vitest/1172 Deno tests and50 SQL fixtures pass; lint/build/bundle/router pass. Owner-approved additive shared migration applied; original functions and historical purchases unchanged. Test Preview READY; real plan/top-up invoices and daily quote verified in authenticated browser. Production/Live keys untouched. [Plan and evidence](2026-10-20-billing-design-daily-proration.md). O6 remains open for its separate Live launch gates.

## Done — 2026-10-20 contextual plan chooser

- `7ecc2d9`: below-card chooser now shows one contextual state: compact saved unpaid plan, current-plan renewal note, downgrade confirmation, or quote/loading/error. Free action moved to quiet footer; payment/schedule rules unchanged.6452unit tests and focused10cases pass; lint/build/bundle and responsive/dark/keyboard fixture pass. Test Preview READY and authenticated current/saved states verified; balance/schedule unchanged. No backend/Production/Live changes. [Evidence](2026-10-20-plan-chooser-context.md).

## Done — 2026-10-21 Free plan card

- `3c24882`: Free shown alongside Plus/Pro/Max in billing and profile choosers; current Free disabled/marked, no monthly or repeated welcome allowance promised. Paid Free choice hands off to existing zero-charge period-end confirmation; duplicate footer removed.6458unit tests, focused21, lint/build/bundle and responsive/dark fixture pass. Test Preview READY; authenticated profile→Free review verified without saving or paying. No backend/Production/Live changes. [Evidence](2026-10-21-free-plan-card.md).

## Done — 2026-10-21 billing UI clarity

- **Billing UI clarity:** implementation2292928 and closure follow-up: unnecessary .00 removed while genuine paise remain exact; Pay online actions; renewal payment-window/service-date distinction; invoice X/backdrop/Escape dismissal with focus restoration; compact grouped credit table retaining original grants. Free footer no longer implies a subscription. Full416-file/6466-test application run,1172 Edge tests,59 focused checks,lint/build/bundle pass. Causal RED/GREEN evidence and authenticated desktop/mobile/dark browser checks recorded in [plan](2026-10-21-billing-ui-clarity.md). Test-only branch publication; Production deployment and Live credentials unchanged.

## Done — 2026-10-21 billing summary

- **Billing summary allowance/balance separation:** c8d74f5 plus verification closure: Plan price, catalog Monthly allowance and Credits available. Actual period allocation/usage and all credit lots remain in breakdown; proration explained.416 files/6469 application tests,1172 Edge tests,14 focused tests,lint/build/bundle pass. Causal RED/GREEN and actual desktop/mobile Preview image in [plan](2026-10-21-billing-summary.md). Display only, existing Razorpay Test Preview scope; no financial data or Production/Live key changes.

## Done — 2026-10-21 always-open billing chooser

- **Frontend chooser/navigation and rollover-copy preparation:** e1329f8. Always-open cards/current badge,removed toggle/duplicated saved-summary state and dead CSS,repaired current and legacy anchors; history stays after top-ups. Removed rollover benefit promises from billing/pricing/Terms/Refund; preserved historical lot displays.417 files/6472 application tests,1172 Edge tests,56 focused tests,lint/build/bundle pass. Native sidebar and main-account navigation/browser checks pass. [Evidence](2026-10-21-billing-open-chooser.md). Backend rollover still10.00 and tracked separately above; no SQL/data/Production/Live key mutation.

## Done — 2026-10-21 backend rollover retirement

- **a8f040f:** removed rollover creation, fixed compatibility setting at0 with a validated constraint, retained historical refund/ledger provenance. Owner-approved shared NTER migration applied; frozen five-order Test graph for the named owner reset to Free with1186.132 signup credits and no debt. Auth/usage/signup/other-account hashes and invoice sequence unchanged. All51 SQL fixtures with causal/concurrency checks,6472 application tests,1172 Edge tests,lint/build/bundle/router pass; production dependency audit0 findings. Test Preview READY/exact implementation SHA; signed-in Free/empty-history UI verified. [Plan and activation evidence](2026-10-21-rollover-retirement.md). Production web/settings and Live keys unchanged; only the explicitly approved shared no-rollover policy changed globally.

## Done — 2026-10-21 stable billing loading

- **91f540f:** removed temporary legacy mounting/unreachable branch, reused page-owned credits with account guard, supplied existing config to top-ups, kept account/disclosure geometry through config and balance loading, explicit config-error retry, full-width44px accent native disclosure. Full6483 application/1172 Edge tests,focused120,lint/build/bundle/router pass; audit0 vulnerabilities. Test Preview READY/exact SHA; desktop339px/mobile479px account heights unchanged across balance arrival,no legacy DOM,no overflow,keyboard disclosure verified. Production deployment/settings and Live keys unchanged. [Plan and evidence](2026-10-21-billing-loading.md). Existing test-global order-sensitivity observation is tracked separately above.

## Done — 2026-10-21 desk sector flip cards

- [x] Shared eight-desk flip cards, implementation `a51b07d`. Owner reviewed local Global and authorized push/merge. 6293 application and 1172 Edge tests passed; focused final CSS checks, lint/build/bundle and browser interactions passed. Billing untouched. Release status and verification limits: [plan](2026-10-21-desk-sector-flip.md).

## Done — 2026-10-21 State sector grid parity

- [x] `2954800` removes dense-sector layout exceptions; State shares desktop and responsive grids with other desks. All module links preserved. Owner authorized publication; 244 focused tests, lint/build and browser checks passed. [Plan](2026-10-21-state-sector-grid.md).

## Done — 2026-10-22 compact desk cards

- [x] Shared compact fronts, four-module previews and More/Less footer across eight desks. PR #8 merged at `1d64416b3591caf1242147ef57343908f0c277bb`; production deployment successful. Both main CI jobs passed; live eight-desk dimensions and State expansion/collapse verified. See [release evidence](2026-10-22-desk-card-sizing.md).

- [x] **Desk module scrolling (2026-10-22).** *Done: PR #9 (`1af32e0f`); it was left unticked inside a Done section. 2026-11-10 (F299)* Replace More/Less with a fixed-height native scrolling list; local review before deployment. Scope shared desk component/CSS/tests.

## Done — 2026-10-24 Law screener repair

- [x] **F244 — Semantic conflict scan.** PR #13 merged `e651b7f076ba149e62fdb477fb2798fde3904d09`; fix `91254514`, reviewed/up-to-date head `bd4a9060`. Sixteen screener and seven original importer tests passed; independent review, lint/build and both required CI jobs on run40006075188 passed. Schema3 rejects incomplete/ambiguous scans and computes occurrence hashes. [Client explanation](../operations/law-cohort-screen-review-fix.md). No ingestion or corpus writes.

## Done — 2026-10-24 Law listing release

- [x] **F245 — Automatic Law listing publication.** Implemented and released through PR15, merge `2173b95be8dc785ac0c04b7291b6c38c25b45162`, required PR/main CI green. Seeded435 baseline records, linked9 existing orders and created1 distinct Future Consumer order, activated436 listings/10 indexed attachments. All10 documents/527 chunks and ingestion-job fingerprints unchanged; metadata rerun identical. Website retrieval/citation plumbing verified with answer-quality and record-panel follow-ups F247/F248 explicitly open. [Evidence](../operations/law-listing-release.md). No larger batch or re-ingestion.

## Done — 2026-10-24 canonical Law case number

- [x] **F248 — Canonical Law record-panel fields.** PR17, merge `5a8f7a456d29c415cc106dc4bac2c66f90e86439`: structured nonempty string `case_number` takes precedence, with legacy title fallback. Future Consumer visibly shows `C.P. (IB)/914/MB/2025` in Forum and Case details, and Case number “On the row”. Regression tests and signed-in NTER verification passed; no source/title/data mutation. [Receipt](../operations/law-answer-release/README.md).

## Done — 2026-10-24 exact malformed-answer containment

- [x] **F249 — Exact placeholder accepted as research content.** PR23 merge `c07c644cfae6205b2640477a1943a832628e4239`, retained through v84, rejects exact `llm_result` during draft promotion and envelope parsing, holds streaming prefixes, permits one bounded correction and rejects repeated malformed output. Causal tests reproduce the provider-shaped failure and fail without the guard. Live challenges did not publish a bare placeholder, but did not prove that exact provider branch occurred. This is a targeted fix, not a general answer-quality guarantee. [Evidence](../operations/law-answer-validation-release/README.md).

## Done — 2026-10-24 grounded Law synthesis

- [x] **F247 — Grounded Law answers and follow-up verification.** PR33 runtime 7071d33c merged 92a99d4601012af13593a7305f4dfc314480f6a4 after required branch/PR/main CI; research-chat v88 and exact Vercel deployment verified. Final 6,575 app / 1,280 Edge checks, lint/build and independent review pass. All four local and authenticated NTER Globiz cases pass source-reviewed attribution/citation/coverage: original, same-conversation follow-up, date quotation and false costs premise. This closes the documented regression set, not general legal semantic certification. F250 retains 66–161s latency and wider-corpus qualification; bulk/autopilot gates remain separate. Original 110 completed corpus fingerprints unchanged; concurrent external ingestion recorded separately. [Release evidence](../operations/law-grounded-synthesis-release.md).

## Done — 2026-10-24 bounded Law latency optimization

- [x] **F250 — Law answer latency without relaxing source quality.** PR #35/36/37 merged 258c7ad6/663c737f/023bf1dc after required app/SQL CI. Research-chat v91 and exact Vercel deployment verified. Removed discarded draft on eligible one-document attached Law turns; actual-evidence detection covers missing desk hints. Added narrow negative-merits source guard and selector completion allowance while preserving High reasoning, citation validation and bounded correction. Local 6,575 app/1,300 Edge pass; independent review and all four final NTER answers pass. Median 55.618s vs historical 75.5s, with first/date individually slower; no SLA. Original 110 corpus fingerprints unchanged; concurrent ingestion recorded separately. [Release evidence](../operations/law-answer-latency-release.md). Wider qualification remains F251; no larger batches or re-ingestion.

## Done — 2026-10-24 wider Law qualification

- [x] **F251 — Wider Law performance and semantic qualification.** PR #39/#40/#41 merged6f511513/b3d2cad7/17531c94 after required CI; research-chat v94 and exact Vercel deployment verified. Compact pools skip selection without dropping evidence; decimal boundaries and bounded quote/amount/condition/scope guards corrected reproduced failures. Six representative live cases accepted across v93/v94, with final fresh Globiz original/follow-up/date passing independent review and reader navigation. Local6,575 app/1,321 Edge tests pass; corpus fingerprints unchanged. Compact matched median13.5% faster, not an overall latency or semantic guarantee. Provider tails and private uncertainty caveat remain F252. [Spec](../specs/2026-10-24-law-answer-qualification.md), [plan](2026-10-24-law-answer-qualification.md), [release evidence](../operations/law-answer-qualification-release.md). No larger batches or re-ingestion.

## Done — 2026-10-25 National and unindexed-record grounding

- [x] **F254 — National provision grounding.** Released through `af8b0cb7`, retained in `e4a2cf5a`; original Anti-Doping section-12 test passed with clause-9 citations and reader verification.

- [x] **F255 — Unindexed record scope.** Released through `af8b0cb7`, retained in `e4a2cf5a`; State automatic web uses no unrelated document retrieval, with attribution preserved. Indexed Law RAG and original citations passed.

[Release evidence](../operations/cross-desk-answer-grounding-release.md) contains exact message IDs, failures, partial answers, checks and unchanged counts. No ingestion or larger batches.

## Done — 2026-10-25 Economics and cross-desk acceptance

- [x] **F256 — Economics provenance and complete observation answer.** PR #54 / `807fbee7`, research-chat v104, exact-main CI `40136935348` passed. Fresh unchanged GDP question returned supplied value, cited World Bank definition and separately attributed observations in one 139-word answer, 24.742s, with explicit unknown comparability and no omission notice. Independent evidence review approved scoped closure. Search excerpts do not establish universal freshness; BusinessLine original was not independently fetched.

- [x] **F253 — Shared prompt cache and cross-desk audit.** `636efdd0` through `807fbee7`. Actual provider cache hits verified; National, State, Law and Economics acceptance complete. No guarantee every call hits cache or meets a latency bound. F252 remains open.

[Final release evidence](../operations/cross-desk-answer-grounding-release.md#final-acceptance--v104-25-october-2026-ist) records exact message IDs, tests, source checks and unchanged corpus counts. No ingestion.

## Done — 2026-10-22 RAG fallback reliability

- [x] **F242** — Explicit fallback notices, preserved serving-model identity, 300-second chat leases with keepalives, and bounded post-answer telemetry. Independently reviewed; all tests and mandatory CI passed. Commit `9a81cd9b`, PR #10 merge `c0ad4355`; research-chat v71 and nter.pro verified. Billing unchanged. [Evidence](2026-10-22-rag-fallback-reliability.md).

## Done — 2026-10-25 preview discovery and workspace refinement

- [x] **Preview implementation `0ebb0ece`.** Explicit Open citations/individual passage controls, canonical search hierarchy and retained query, bounded fair/partial snapshot search, scoped desk controls and exact-record focus with Return to results.433 files/6625 app tests,1412 Edge tests,lint/build/bundle and isolated browser checks passed. Owner review and any main/production merge remain separate. [Spec](../specs/2026-10-25-discovery-workspace.md), [implementation and release gates](2026-10-25-discovery-workspace.md). Full record indexing remains separate; no data/corpus/production changes.

## Done — 2026-10-25 reviewed preview integration

- [x] **nter.news and discovery integration.** Owner authorized production publication; [PR58](https://github.com/ddllabs/niyantran/pull/58) merged at `a2c69f625cf3e1734a0d1bd83859bc4b0fb2fca1`, preserving reviewed runtime `b7a772a1`. Both required jobs passed on final PR head `cef285c4` (push40175036438 and PR40175040027). News/date/image/logo/heading and citation/search/view-state work is integrated; no Supabase data/schema, corpus, billing or auth-policy changes. [Release gates and recovery](2026-10-25-preview-production-release.md); exact-main CI/deployment and live acceptance receipt is supplied in the delivery report. Full record indexing remains open separately.

F257–F260 released through PR #62 / `8f01b348` after owner authorization and required CI. The reviewed existing mapping repair was applied and replayed without changing OCR, chunks or vectors. See the [release receipt](../operations/2026-10-28-corpus-repair-review/release.md). Larger batches remain held; F261 subsequently closed below with verified display corrections.

## Done — 2026-10-28 record availability and answer presentation

F264 released and accepted 2026-10-28: PR #66 (`c94f3a58`; migration `admin_corpus_readiness`, `admin-ingest` v9, `research-chat` v109) and PR #67 (`3fad9b97`; the public Law listing no longer sends the retired text readiness column, filter, sort or row field). The `c94f3a58` frontend was not promoted because main CI failed only the F263 fixture; `3fad9b97` passed both jobs and serves www.nter.pro. Acceptance: Parliamentary attached document, Law attribution, the public Law listing, and a State Record only row with automatic web all passed; Economic Simulator rows stay unverified (no stored rows), so automatic web stays off for them. [Release evidence](../operations/2026-10-28-f264-release.md).

F261 released through PR #64 / `69922e738d34b0bcfc690656f0c78ef1bc95bee6` (runtime `ace99b73`). Sol implementation independently reviewed; 6,663 app and 1,441 Edge tests, lint/build, required branch/PR/main CI passed. NTER verified all five Parliamentary subjects and Full text states, current record coverage, cached-brief context, saved nested-table rendering, Bill/Law Full text and metadata-only/snapshot web defaults. Fresh FMBAP answer was substantive, accurately attributed and cited, with exact-document trace. Five document/chunk hashes unchanged; no re-ingestion or larger batches. [Release evidence](../operations/2026-10-28-f261-release.md), [client handoff](../operations/2026-10-28-corpus-client-handoff.md).

## Done — 2026-11-15 ingestion close-out, wave 1

- [x] **F295 — Search limit is 4 s in the app, not the 8 s the work measured against.** *Remaining: store `embeddingMs` and `retrievalMs` in the trace; the limit decision is made. 2026-11-10 (F299)* `research-chat` aborts each search at `NETWORK_TIMEOUT_MS` (4,000 ms), so the database's 8 s limit is not what users meet. The hybrid gate, F288 and the F287 note assumed 8 s. On NTER this has cost 1 of 449 searches since 2026-10-01 ([note](../research/2026-11-06-nter-search-timing.md)), on a corpus of 393,000 chunks. In the best quiet local hybrid run, 7 of 58 NCLT searches took over 4 s. Decide a search budget before hybrid. `embeddingMs` and `retrievalMs` are not stored in the trace, so the phase that failed is inferred; store them. **Developer decision 2026-11-06:** leave 4 s as it is for now, since it is not hurting users, and set a separate database budget when hybrid is prepared, so that F288 has a defined trigger. 2026-11-15: the remaining part was already built. `embeddingMs` and `retrievalMs` are measured in `_shared/retrieval.ts` (in a `finally`, so a failed or aborted phase still reports) and stored with each chat message in `messages.activity` since `8d0ba3dd`; the sentence above that they are not stored was stale. `chat_turn_traces` has typed columns and no place for them; no migration is added, because the values can be queried from `messages.activity`. Added four tests proving that a rejected, timed-out or errored retrieval, and the hybrid path with its fallback, still report the timing; built, committed as `65826255`. A mutation that zeroes the measurement fails all four. No deploy is needed. Landed 2026-11-15 in PR #149, merge `291c3b95`.

- [x] **F340 — The load-proof harness defaults to the load copy.** Found 2026-11-13 in the review of the rehearsal proof (read from code): `scripts/load-proof/lib.ts` takes its database from `LOAD_PROOF_DB` and falls back to `niyantran_ingest_load_test`, so a proof run without its wrapper writes to the load copy; and `postgrest.sh up` resets the cluster-wide `lp_authenticator` password on every run, while one PostgREST container is shared by every proof. The rehearsal proof now refuses a database that is not its own and checks which database PostgREST serves; the older proofs do not. Local databases only; NTER is not involved. *Ready to build. 2026-11-13* 2026-11-15: built. There is no default database (an unset `LOAD_PROOF_DB` is an error); the load copy is refused unless `LOAD_PROOF_ALLOW_LOAD_COPY=1` or the script only reads; every writing proof checks which database the shared PostgREST serves, pins the container, and checks again during the run. Two overlapping proofs still share one PostgREST container: the second now makes the first abort; they are not made safe to overlap. Independent review: accept with changes, all eight findings applied. Committed as `455c5b57`; landed 2026-11-15 in PR #149, merge `291c3b95`. The 76 tests in the folder pass; CI does not run them.

- [x] **F342 — Eight script tests are run by nothing.** Found 2026-11-15 in a read of `package.json`, `vitest.config.js` and `.github/workflows/ci.yml` (read, not executed): ten `scripts/corpus-*.test.mjs` files use `node:test`; `npm test` runs Vitest over `src/**` only; CI runs two of them (`corpus-text-import`, `corpus-readiness-export`). The other eight (`corpus-batch-review`, `corpus-capacity`, `corpus-context-preflight`, `corpus-job-preflight`, `corpus-job-supervisor`, `corpus-source-repair`, `corpus-stage-job`, `corpus-version-mapping`) are run by neither. Whether they pass is not known. Remaining: run them, fix or retire any that fail, then add them to CI. *Ready to build. 2026-11-15* 2026-11-15: built. `npm run test:scripts` runs every `scripts/corpus-*.test.mjs` with `node --test` and is one added step in the existing `Build and tests` job (no new required check). All eight files that nothing ran pass unchanged; 141 tests across the ten corpus files; none needs the network or a database; a broken assertion gives exit 1. Committed as `4a4fa6d0`; landed 2026-11-15 in PR #149, merge `291c3b95`, where the new step passed on CI.

## Done — 2026-11-15 plan statuses

- [x] **F343 — Finished plans are still marked Living.** Found 2026-11-15 in a read of the status lines: `docs/agents/coordination.md` says a completed plan becomes Historical (dated), but 96 of 175 files under `docs/plans/` declare Living, among them plans whose work is released (`2026-10-28-f261-record-availability.md`, `2026-10-28-corpus-record-contract.md`, `2026-11-01-chunk-partitions.md`, `2026-11-06-ingestion-load-proof.md`, `2026-10-27-admin-persona-prompts.md`, `2026-10-28-persona-global-rollout.md`, `2026-10-28-public-corpus-capability.md`). Each plan needs a check that its work is finished before its status changes; none was changed. *Ready to build. 2026-11-15* *2026-11-15 (night):* 29 plans whose work is recorded as landed now read Historical (status line only); 67 stay Living because something in them is open or completion could not be shown, 16 of them plans of R7, which closed as superseded rather than done. Commit `626707fe`. The Historical date is each plan's last commit date.

## Done — 2026-11-15 Regulatory screen (PR #150)

- [x] **F339 — The Regulatory screen passes records that prepare then holds.** Found 2026-11-13 in the rehearsal (executed): the search-only screen limits a record by characters (`max_chars` 600,000 in `scripts/bulk-runner/screens/regulatory.json`) and never counts chunks, while prepare holds a record over the collection's `maxChunks` (700 by the spec's D6; the adapter's own ceiling is 800). Of the first 100 screened v1.1 records, 4 are held at 700 as `over_chunk_limit` (728 to 774 chunks); the count over all 2,617 screened records is not measured. Nothing wrong is admitted, and those records wait under F311 as decided. The cost is that the screen's count overstates what a load will admit, and the spec's rule "every screened record admitted, 0 held" cannot be met at 700. Choices: count chunks in the screen and hold there; or keep the screen as it is and state the expected prepare holds in the plan for each load. *Waits on the developer. 2026-11-13* ([spec](../specs/2026-11-12-regulatory-screen.md), build notes) 2026-11-15: measured over all 2,617 screened records with the real chunker and `prepareRecord`: 10 exceed 700 chunks (TRAI 7, SEBI 3, CCI 0, RBI 0), 1 of them exceeds 800 (815), and 1 more is held as `control_codes_excess`; 2,606 would be admitted. Bands: 701 to 800, 9; 801 to 1000, 1. This reproduces the first-100 result (4, at 728 to 774). The screen code under `scripts/bulk-runner` is unchanged since the screen output was produced at `d93325ed`; the screen was not re-run live. The choice above (count chunks in the screen, or state the expected prepare holds) is still open. *2026-11-15 (later):* built on `task/f339-f345-regulatory-screen` (`6d428d18`; rehearsal updated in `0a3f65ea`), independently reviewed, all findings applied. The screen now runs the real prepare step last (`prepare_holds`) with the collection's own prepare block, records that block in its receipt, and the runner refuses a screened set whose block differs (`prepare_mismatch`). Rehearsal on a local database with a locally screened first-100 input at a limit of 700: 15 of 15, 4 held at the screen, 96 admitted, 0 held at prepare. The full live screen at 700 has not been run. Landed 2026-11-15 in PR #150, merge `dc92bb60`. *2026-11-15 (night):* the full live screen at a limit of 700 was run on the pack (read-only on NTER, RBI files fetched): 3,319 in, 2,605 screened, 714 held, as predicted; `over_chunk_limit` 10, `control_codes_excess` 1, `duplicate_title_live` 1. Split into 27 parts of 100; the rehearsal on the first part on a local database passed 15 of 15 (100 admitted, 0 held at prepare, no index miss in 50). Output is outside the repository.

- [x] **F345 — The Regulatory screen passes a record that duplicates a live document under another key.** Found 2026-11-15 in the match against the 474 (executed on the local load copy). One TRAI record (a letter to the Secretary, MIB) is a text-layer extraction of the same file as a live document stored from OCR: the file date is identical, the title differs only in hyphens for spaces, and the content hash and the key differ, so it is not held as `already_live` or `duplicate_text_live` and would be admitted as a second copy. No other pass record matches a live title in any regulator. Fix: hold a pass record whose normalised title and file date match a live document of the same regulator under a different key. *Ready to build, with the F339 screen change. 2026-11-15* *2026-11-15 (later):* built on `task/f339-f345-regulatory-screen` (`6d428d18`; rehearsal updated in `0a3f65ea`), independently reviewed, all findings applied. The screen holds a pass record as `duplicate_title_live` when a live document of the same host (a leading `www.` ignored) has the same file date and normalised title under a different key. Rehearsal on a local database with a locally screened first-100 input at a limit of 700: 15 of 15, 4 held at the screen, 96 admitted, 0 held at prepare. The full live screen at 700 has not been run. Landed 2026-11-15 in PR #150, merge `dc92bb60`. *2026-11-15 (night):* the full live screen held the one record as `duplicate_title_live` (see F339).

## Done — 2026-11-17 Live TV player API (PR #156)

- [x] **F351 — Live TV fact-check: about one check in seven ends as "Check failed" because the reply has no verdict label.** Found 2026-11-17 in three real sessions on the live site (executed): 9 of 48 check calls were stored as `error` with `fail_reason` `no_label`. The split: 6 of 42 in the two 5-minute sessions, and 3 of 6 in the 1-minute session, whose unusable checks had a median of 1.3 s. Read: the check asks `perplexity/sonar` for a two-line reply, a LABEL line and then a reason, because Sonar does not accept a structured-output request through OpenRouter ([F344 spec](../specs/2026-11-15-live-tv-fact-check.md)). `replyFailure` in `supabase/functions/factcheck/check.ts` returns `no_label` when the reply has no LABEL line, and `verdictFor` in the same file stores the error. (A LABEL line that names none of the five labels is `bad_label`, which these sessions did not show.) Temperature is 0 (`supabase/functions/factcheck/modelCall.ts:260`), so "Check again" (100 credits) is likely to repeat the same reply (inference, not tested). Not known: what the rejected replies look like, because the reply text is not kept, by design. Proposed first step: keep a short, clipped prefix of an unusable reply in the log, with no user data beyond the claim, or reproduce offline with the claims that failed; then widen the label parsing or ask once more with a stricter instruction. The owner should not pay 100 credits to retry a formatting failure. Not built. Cause established 2026-11-18 (executed): the log on NTER shows 8 `unusable: no_label` among 78 check calls to date (the 9 of 48 above covered three sessions and counted the F353 call as a ninth), with replies of normal length (30 to 65 tokens), and all 8 re-checks succeeded; replaying the 9 failed claims 5 times each (45 calls, US$0.24) gave 14 rejected replies, every one a well-formed verdict that opens with the bare label ("Supported", "PARTLY TRUE", "Supported: reason") without the word `LABEL:`. So the guess above that a re-check repeats the same reply is wrong: the layout varies between runs. The fix, reading a bare opening label when there is no `LABEL:` line, is in the [plan](2026-11-18-f351-check-reply-label.md); it needs a function deploy and no migration. Open owner decision OD1 there: whether "Check again" stays at 100 credits for a layout failure (the owner took the recommendation on 2026-11-18: decide after the fix, on the remaining count). Built and reviewed 2026-11-18 on branch `task/f351-check-reply-label`: over the 45 saved replies the 14 rejected ones are now accepted and the other 31 are unchanged. That part was merged on 2026-11-18 in pull requests 171 and 170 (`71aca0f9`). Part 2, asked for by the owner the same day: a reply that cannot be read is asked again on our side, up to three model calls within 15 seconds, at no extra charge to the user (a sourceless verdict and an outright provider failure are not re-asked here); built and reviewed on branch `task/f351-reask`. Released 2026-11-18: pull request 172 merged (`286268c3`) and function `factcheck` version 6 deployed from `main` at that commit at about 10:03 UTC, with no session active; no migration. From outside it refuses a GET (405), no token (401), a malformed token (401) and a foreign origin (403). Run the same day without a browser (executed; the owner was away, so no sharing prompt could be accepted): the handler at the deployed commit, with real model calls and an in-memory store, made 61 checks from four recorded clips and 40 earlier live claims; all 61 gave a verdict, none was unusable, and each took one model call, so the re-ask did not fire and rests on its tests. Still owed: a real session on the live site, then a count of `unusable:` rows and of `attempts` above 1 among its check calls; the owner decision OD1 on the price of "Check again" waits for that count. Closed 2026-11-19: the count this entry waited for is done. Evidence 2026-11-19 (executed, read-only on NTER): four real one-minute sessions ran after the feature was opened, three by an account with no earlier session on the old layout and one by an earlier account on the new layout; all four settled and charged 500 credits; the model-call log holds 67 fact-check calls for them (28 transcription, 16 extraction, 23 checks), every one a success, none `unusable`, US$0.17 in all. The owner decided on 2026-11-18 that the price of "Check again" stays 100 credits.

- [x] **F352 — Live TV fact-check: the same claim can get different verdicts on different runs.** Found 2026-11-18 while replaying claims for F351 (executed, 5 runs per claim, same prompt, `perplexity/sonar`, temperature 0): 3 of 9 claims did not get one verdict. "In the 2012 Uttar Pradesh assembly election, the Congress party's vote share was 11%" came back Supported twice, Contradicted twice and Partly true once, all citing 11.6% or 11.63%; a 2022 vote-share claim of 2.5% against a reported 2.3 to 2.4% also got all three; a third claim got Partly true and Supported. The disagreement is about rounding and about claims with several parts, not about the facts found. Effect: "Check again" can flip a verdict, and a single verdict looks more certain than it is. Not known: how often this happens across ordinary claims (these 9 were chosen because their checks had failed). Possible directions, none decided: a rule in the prompt for rounded figures, or showing "Partly true" wording for near-misses; either changes verdicts and needs a measured before-and-after on a fixed claim set. Measured 2026-11-18 (executed; 40 distinct claims that had been checked on the live site, 15 of them not "Supported", 3 runs each, current prompt, 120 calls, US$0.64, no unreadable reply): 13 of 40 claims did not get one verdict across the 3 runs. Two cheap remedies were then tried on the same 40 claims and neither is enough: (a) a prompt with explicit decision rules, including "never mark a claim down for rounding" (120 calls, US$0.65), left 11 of 40 unsteady, which is within the noise of 13; (b) a best-of-three vote, estimated from the two sets of runs, agreed with itself on 29 of 40 (a single run agreed on 32, so no gain; the two sets used different prompts, so this is a rough estimate), and 4 of 40 had no majority at all. Over all 6 runs, only 22 of 40 claims got the same verdict every time. The unsteady claims are mostly figures (vote shares, counts) and claims with several parts; the search step returns different sources on different runs (inference from the reasons given). So this is a property of the checking model, not of our wording. Next step, needing its own plan and the owner's yes on cost: compare checking models (for example a stronger search model) or a two-step design (search once, then judge the found sources with a second model) on a fixed set of claims with a hand-agreed answer for each, measuring both steadiness and correctness. Raw replies are kept outside the repository. Not planned, not built. Compared 2026-11-18 (executed; the same 40 claims, 3 runs each, same sitting, rule fixed before the runs: at most 4 unsteady claims, median at most 6 s, at most US$0.03 a check; about US$7 of model calls): `perplexity/sonar` (control) 12 unsteady, median 2.4 s, US$0.005 a check; `perplexity/sonar-pro` 12, 2.6 s, US$0.008; `perplexity/sonar-reasoning-pro` 9, 5.0 s, US$0.007; two steps (`sonar` gathers evidence, `google/gemini-3.8-flash` judges it with a JSON schema and written rounding rules) 10, 7.4 s, US$0.007; the same with `sonar-pro` 8, 6.3 s, US$0.011; three `sonar` searches pooled and judged once 5 (one of them a provider error), 9.1 s, US$0.019. No design passed the rule. The two single-search two-step runs each lost 4 replies to a token limit in the test script (fixed before the pooled run), so their counts are slightly high. A web-search plugin on `gemini-3.8-flash` was dropped after two calls at US$0.06 and 17 s each. The judge alone, given the same evidence three times, gave one verdict on all 40 claims (0 unsteady, 3.9 s, US$0.002). So the unsteadiness comes from the search step returning different sources, not from judging, and a stronger search model does not remove it. Pooling searches is the only thing that reduced it, at about four times the cost and about 9 s a check, and its majority verdict differs from the control's on 12 of 40 claims (mostly towards Partly true), so correctness must be settled first: the 19 claims on which the designs disagree need an agreed answer from the owner. Not planned, not built; raw replies stay outside the repository. Reference answers 2026-11-18 (executed; two independent researchers, neither shown any model verdict): they agreed on 14 of the 19 disputed claims. Majority verdict right on those 14: current model 7, `sonar-pro` 6, `sonar-reasoning-pro` 5, two steps with `sonar` 8, two steps with `sonar-pro` 6, three searches pooled 8. So the pooled design is steadier but not shown to be more correct, and it stays not built. Four of the five disagreements are one question, whether a fair rounding of a reported figure (11% for 11.63%) is Supported or Partly true; that rule is the owner's decision and is open. On three claims the current model said Supported where both researchers found no evidence, all three marked low confidence by the researchers. The 14 are the hardest claims of the 40, so these counts do not describe ordinary claims. Answers and scoring are kept outside the repository. Rounding rule tried 2026-11-18 (F365, executed; the same 40 claims, 3 runs, old and new prompt in the same sitting, pass rule written before the runs): a "Rounding" paragraph in the check prompt made the four rounding claims Supported by majority on 1 of 4 (3 needed), unsteady claims went from 12 to 15, and one materially wrong claim moved to Supported. Not released; the change is kept on the local branch `task/f365-rounding-rule`. Parked idea, to explore later, not planned: a second step for numeric claims only, in which a small model re-labels the claim from the evidence the search already returned, applying a written rounding rule (the judge alone was steady on fixed evidence: 0 of 40 unsteady, 3.9 s, about US$0.002 a check). It would need the same before-and-after measurement before release. Second step for numeric claims only, analysed 2026-11-19 (executed; no new model calls, the replies of 2026-11-18 recombined; pass rule written before the analysis; 23 of the 40 claims marked numeric before any verdict was read): two-step replies on numeric claims and the current model's on the rest left 10 claims unsteady with `sonar` as the search and 7 with `sonar-pro` (4 allowed; counting a reply lost to the script's token limit as no verdict; 7 and 5 if lost replies are ignored), made 1 of the 4 rounding claims Supported (3 needed), and was right on 8 and 7 of the 14 agreed reference answers (current model 7). It fails the rule and no fresh runs were made. The unsteadiness comes from the search step returning different evidence, which a judge after it cannot repair. This closes the parked idea; the item stays open only as a known limit of the feature. *Closed 2026-11-21 as a known limit (supervisor's recommendation under the owner's overnight authority of 2026-11-21; listed in section 7):* every design measured above fails the rule or costs about four times as much without being shown more correct, so nothing is built. Users are told instead: the panel's caution line now reads "Verdicts are automated, may be wrong, can change if a claim is checked again, and should be checked against the sources shown." (merged 2026-11-21 as `dd6de559`, pull request 210; production serves it). Reopen with a new design and the same measurement.

- [x] **F353 — Live TV fact-check: one check call failed in 3 ms without reaching the provider.** Read 2026-11-18 from the model-call log on NTER (executed, read-only): one `claim_check` row at 2026-11-17 23:36:09 UTC has status `error`, "Provider request failed.", 3 ms, and no provider or tokens. That is the request failing inside the Edge Function before any answer (`callProvider` in `supabase/functions/factcheck/modelCall.ts`); the function then returns 502 and releases the claim (`checkAction` in `check.ts`, read from code). One case in 78 check calls. Not traced: the cause, and what the panel showed for that claim. If it recurs, one immediate retry inside `callProvider` for a failure this fast would cover it. Looked at again 2026-11-18 (executed, read-only): the next check call of that session was logged 1.7 s later (23:36:11) and took 1.5 s, which matches the browser's own retry after 0.5 s (`retriesTransient` in `src/lib/factcheck/session.js`; the two rows cannot be tied to one claim, so this is an inference), and none of that session's five claims was left failed for a provider reason (its two errors were both `no_label`). So the existing retry covered it and nothing needs building; kept open only to see whether it recurs. Closed 2026-11-19: it has not recurred; no fact-check call has failed since (67 calls on 2026-11-19).

- [x] **F359 — Live TV as a page of its own.** Agreed with the owner on 2026-11-17 as the next Live TV step (end of the F350 entry). Today Live TV is a pop-up that closes on Escape, on any click outside it and when the profile menu opens, and closing ends a running paid fact-check session. [Spec and plan](../specs/2026-11-18-live-tv-page.md), written 2026-11-18: a shell page at `#/livetv`, no closing by accident, two columns on wide screens with the fact-check panel at the height of the page, the wire reason `modal_close` kept so the Edge Function is unchanged. Browser-only; no migration and no function deploy. Open question for the owner: a confirmation before leaving the page during a session (default: none). Built and reviewed 2026-11-18 on `task/livetv-page` (build record in the spec): gates reproduced, layout measured on a static page at 1280, 1099 and 390 px. Still owed: the page seen inside the signed-in app, and a real session on it. Merged 2026-11-18, pull request 176, `3ce9999e`. Not yet seen in the signed-in app by the owner. The open question on a confirmation before leaving during a session was answered by the owner on 2026-11-18: none for now.

- [x] **F360 — Live TV: past sessions view.** Agreed with the owner on 2026-11-18 as the next Live TV build. A signed-in user cannot see the verdicts of a finished session anywhere; the tables and their row-level policies already allow reading one's own sessions and claims and deleting one's own live-stream sessions (read, not executed). Planned as a browser-only section on the Live TV page ([spec](../specs/2026-11-18-live-tv-past-sessions.md)). Built and independently reviewed 2026-11-18 on `task/livetv-past-sessions` (build record in the spec): gates reproduced, layout measured on a static page. Merged 2026-11-18, pull request 178, `d8404a42`. Seen signed in on the live site the same day (executed, in the owner's browser): the page opens at `#/livetv`, Escape and a click outside do nothing, Back returns to the desk, the section lists the account's 14 settled sessions and an opened session shows its verdicts read-only; no console errors. Follow-up from that view, on `task/livetv-past-delete-inside`: the Delete control and the recorded-video note now appear only inside an opened session. A real session was then deleted on the owner's authorization (executed 2026-11-18, through the page in the owner's browser, after pull request 179 was released): 14 sessions and 142 claims before, 13 and 140 after, the row left the list and collapsed rows showed no Delete control. Not done: a real session on the new page; an automated attempt was refused by the browser at the tab-sharing step and nothing was charged.

- [x] **F361 — Live TV fact-check: session lengths of 20 and 30 minutes.** Not built. Offered on the owner's decision of 2026-11-18. The database, the function and the browser allow only 1, 2, 5, 10 and 15 minutes today, so a migration is needed first. Plan: [2026-11-18-live-tv-closeout.md](2026-11-18-live-tv-closeout.md) (item W2). Built and independently reviewed 2026-11-18 on `task/f361-session-lengths` (pull request 181): migration `20261120090000_factcheck_session_lengths_20_30.sql` (length CHECK, `factcheck_start`, and the stored-piece cap of `factcheck_piece_store` raised to `greatest(120, 10 x minutes bought)`, because at 120 a 30-minute recorded session stopped storing pieces at about minute 18), the Edge Function and the browser. Executed: the fact-check SQL fixtures with the vacuity proof, 1,882 function tests, 8,245 app tests, lint, build; the reviewer ran the second-run, drift-guard and rollback cases on a disposable database. The owner was told on 2026-11-18 that a 30-minute session holds 15,000 credits and said to proceed. Not merged, not applied, not deployed: the migration must be applied before the merge, then the function deployed. Not verified: a real 20 or 30 minute session. Released 2026-11-18: migration applied on NTER at 21:01 UTC with no active session and recorded in the migration history (after it the CHECK lists 1, 2, 5, 10, 15, 20, 30 and the two function sources have the md5 values the migration names); pull request 181 merged, `7af00298`; function `factcheck` deployed from that commit at 21:26 UTC as version 7 (called from outside it refuses no token with 401, a foreign origin with 403 and a GET with 405). Still owed: a real 20 or 30 minute session. Seen on the live site 2026-11-18 (executed, in the owner's browser): the start screen offers the seven lengths with their prices and fits the panel.

- [x] **F362 — Live TV fact-check: admin screen for reports.** Not built. The three admin actions exist, but no administrator can read the reports; a read function is missing as well as the screen. Must be released before sharing is switched on. Plan: [2026-11-18-live-tv-closeout.md](2026-11-18-live-tv-closeout.md) (item W3). Built and security-reviewed 2026-11-18 on `task/f362-admin-reports` ([spec](../specs/2026-11-18-live-tv-admin-reports.md)): migration `20261121090000_factcheck_reports_admin.sql` adds one administrator-only read function that returns open reports grouped by claim with no user identity, and the admin area gets a "Fact-check reports" page with Hide, Dismiss and Remove, each behind a confirmation. Executed: the SQL fixture with the vacuity proof (administrator gets rows; non-administrator, anonymous, service role and a suspended administrator are refused), 8,301 app tests, 1,882 function tests, lint, build. Review: no critical or high finding; the Remove confirmation now states its real effect. Not merged, migration not applied. Not verified: the page in a browser, and anything on the live database. Released 2026-11-18: migration applied on NTER at 21:02 UTC and recorded in the migration history (function present, SECURITY DEFINER, empty search path, executable by `authenticated` only); pull request 182 merged, `54eb731c`. Still owed: the page seen in a browser. Seen on the live site 2026-11-18 (executed, in the owner's browser, as an administrator): the page loads and shows "No open reports."

- [x] **F363 — Live TV fact-check: re-analyze a block of a recorded video.** Not built and not specified beyond one line in the F344 spec; it needs its own spec first. Plan: [2026-11-18-live-tv-closeout.md](2026-11-18-live-tv-closeout.md) (item W4). Decided by the owner 2026-11-18: built as an ordinary replayed session on the block at the ordinary price, with the newer result shown first and the older one kept; no new price key and no stored text re-used ([spec](../specs/2026-11-18-live-tv-reanalyze-block.md), which finds a browser-only build sufficient: read, not executed). Not built. Built and independently reviewed 2026-11-18 on `task/f363-reanalyze`, browser-only (build record in the spec): a "Re-analyze this block" button on readable stretches moves the player to the block's start and opens the ordinary start screen with the covering length preselected; an older overlapping stretch is marked as an earlier analysis. Executed: 8,416 app tests, lint, build. Not verified, and not verifiable without a person and sharing switched on: the seek on a real YouTube embed, the position recorded after it, and the tab-sharing prompt after the short wait that follows Start. Merged 2026-11-18: pull request 184, `25b799df`. Browser only: no migration and no function deploy. CI on main passed for that commit (executed). The live site's bundle carries the change (executed: the page's script list on the live site was read after the release). The button cannot be seen on the live site until sharing of recorded results is switched on, because it appears only on a recorded video's shared stretches. Still owed, and only possible with a person present and sharing on: the seek on a real YouTube embed, the position recorded after it, and the tab-sharing prompt after Start.

- [x] **F364 — Live TV fact-check: removing a video's shared results does not refund unlocks.** Found 2026-11-18 by the security review of F362 (read, not executed): `factcheck_video_remove` deletes the stored transcript of every session of the video and stops sharing all of them, so a user who paid credits to unlock a stretch loses access and nothing refunds them. The admin page says so in its confirmation. Whether removal should refund the unlock credits is the owner's decision, to be taken before sharing is switched on. Not planned, not built. Decided by the owner 2026-11-18: removal refunds the unlocks. Built and security-audited the same day on `task/f364-refund-on-removal`: migration `20261122090000_factcheck_video_remove_refund.sql` adds `factcheck_unlocks.refunded_at` and replaces `factcheck_video_remove` so that each unrefunded unlock of the video is refunded once, for the amount its ledger charge records, through the adjustment path; the removal takes the credit epoch lock so that an unlock in flight is either waited for and refunded or never charged (the audit reproduced that gap before the lock and its closure after). Executed: the SQL fixture with the vacuity proof and four concurrency races, 8,310 app tests, 1,882 function tests, lint, build. Known and accepted for now: the refund raises the balance but is not a line in the usage history, and credit writes for all users wait while a removal runs (about 0.07 s in the test; a removal that waits more than 10 s fails cleanly). Not merged, not applied. Released 2026-11-18: migration applied on NTER at 21:35 UTC with no active session and recorded in the migration history (column present; function source md5 `c0c4b68359304c0fee94dac89047da6d`, lock timeout 10 s, grants unchanged; no unlock existed, so nothing was refunded); pull request 183 merged. Still owed: the first real removal with an unlock to refund.

- [x] **F365 — Live TV fact-check: rounding rule for figures.** Owner decision 2026-11-18: a fair rounding of the reported figure (11% for 11.63%) counts as Supported, with the exact figure in the reason. A prompt-only version failed its measurement the same day and was not released; the owner then dropped it for now. The result and the parked alternative are in the F352 entry. Parked, not planned. *Closed 2026-11-21, not built (section 7):* the prompt-only rule failed its measurement and the parked second step failed its analysis (F352). A fairly rounded figure can still be shown as Partly true; the reason shows the exact figure. The local branch `task/f365-rounding-rule` is kept, not deleted.

- [x] **F366 — Live TV page: new layout after the client's mockup (UI only).** The client supplied a mockup of the Live TV page, and the owner agreed on 2026-11-19 to rebuild its layout and look after it: the fact-check panel open beside the video, a channel card, and past sessions in a "My sessions" tab. Behaviour, billing, verdict names and channels do not change. Spec: `docs/specs/2026-11-19-live-tv-layout.md`; plan: `docs/plans/2026-11-19-live-tv-layout.md`. Not built. Built and independently reviewed 2026-11-19 on `task/livetv-ui-redesign`, browser only: title row, channel card with tiles and segment counts, video on the left with the fact-check panel open on the right, panel header with status and block line, Claims and Transcript tabs, verdict count tiles that filter, latest-claim strip over the video, sessions in a "My sessions" tab, tablet and phone layouts. The review found that opening the start screen by itself made credit, price and shared-result requests without a click on every channel change; that was removed, and the idle panel shows the start button. Executed: 8,550 app tests, lint, build, bundle check; the page rendered with sample data was looked at in light and dark at 1440 and 375 px wide (no sideways scroll, no control under 40 px high on a phone). Not verified: the page with a real YouTube player, a real session in the new layout, and a screen reader. Not merged. Merged 2026-11-19 on the owner's go: pull request 187, `0119274c`; CI on main passed. Seen on the live site the same day (executed, in the owner's signed-in browser, with a real video playing): the channel card with 13 channels and segment counts, the panel open beside the video in its idle state, the start screen with the seven lengths inside the panel after one click, and past sessions under the "My sessions" tab. Still owed: a real session in the new layout (running and ended states, the latest-claim strip against the player's own controls), a phone, and a screen reader. Polish 2026-11-19, from what was seen live: the title no longer shows a focus box; from 1081 px the panel is kept inside the window and stays beside the video while the page scrolls, so Start and Cancel are visible without scrolling (measured on the page rendered with sample data at a 1459 by 714 page area: video 967 px wide, panel 440 by 450 px ending 39 px above the bottom, Start button visible, panel still in view after scrolling 250 px); a channel tile no longer says RECENT and shows LIVE only when the channel data says live. The server marks every channel recent unless it detects a live stream, and it detects none today; that is not looked into here.

- [x] **F367 — Live TV: no channel is ever shown as live.** Found 2026-11-19 on the live site: all 13 channel tiles and the header badge say recent while live streams play. Cause (executed against the live site's public API): the per-channel lookup detects live streams (DD News, Aaj Tak, WION and CNBC-TV18 came back live), but `/api/livetv/channels` returns the list as written in the code, where every channel is `recent`, and the page reads the status only from that list. Fix agreed with the owner 2026-11-19 and built on `task/f367-live-status`: the list makes one `videos.list` call (1 quota unit) for every enabled channel's curated video, cached 10 minutes, with a 3-second limit and a 1-minute memory of a failure; a channel is `live` only when the video the page plays is live. With no key, an error or a slow answer the list is as before. The independent review found that using the per-channel result could show LIVE over a recorded video; that rule was removed. Known limits: a channel live on another video is not shown as live, Sansad TV's `live_stream` address cannot be looked up, the status can be 10 minutes old. Executed: 8,578 app tests, lint, build, bundle check, router import. Not verified: a real call to YouTube (no key on the build machine). ADR 0009 amended. Merged 2026-11-19 on the owner's go: pull request 193, `e682edc1`; CI on main passed. Seen on the live site the same day, which is the first run against the real YouTube service (executed): `/api/livetv/channels` marks DD News, WION and CNBC-TV18 `live` and the other ten `recent`, the same on three calls; `/api/livetv/live` lists the same three; in the owner's signed-in browser the three tiles say LIVE and the header says LIVE FEED on DD News. The polish of F366 (pull request 189, `106c4ff6`) was seen live the same day: no focus box on the title, no RECENT on tiles, Start visible without scrolling, the panel following the scroll. Not looked into: NDTV 24x7, ET Now, India Today TV and Aaj Tak are 24-hour broadcasters but their curated videos did not come back as live, so those curated video ids may be out of date.

- [x] **F372 — Bill corrigenda have no route.** Counted and read 2026-11-19: v1.1 holds 365, none with a file link, 27 under 200 characters; the pack's type name is `bill_corrigendum`, the Bills screen knows `corrigendum` and holds every corrigendum as unmapped. *2026-11-21: spec [bill-corrigenda-route](../specs/2026-11-21-bill-corrigenda-route.md) written and the route built on `task/f372-corrigenda-route`, uncommitted. No owner mapping is needed for most: each record's own `links` name its bill (356 records; 355 name one). Read-only on NTER, the real screen `national-bill-corrigenda` passes 330 of 365 (listing row found by key, house and name for each), holds 25 as under 200 characters, 9 with no link and 1 that names two bills; the plan is one batch of 2,079 chunks, about US$0.01. The route needs migration `20261125090000_bill_corrigenda_route.sql` (a null `file_url` on errata of type `bill_corrigendum`; a nullable link `source_url` on errata only), **not applied: it needs the developer's yes**, with a fixture proven non-vacuous. Open: decisions 1 to 8 of the spec (developer: the migration, its apply order; owner: the Bills licence class, the 27 short, the 10 with no single bill, the 11 v1.2 corrections as patches). The 34 of the 330 that sit on shared bill keys are F407. *Review fixes 2026-11-21 (uncommitted): the screen's length ceiling is 20,000 characters, so three records of 252,800 to 486,379 characters (whole bills under the label) are held as `too_long`; a corrigendum whose matched listing rows are more than 3 days apart is held as `bill_key_ambiguous`; a link names a bill only when it is the national Bills desk's corrigendum link; the null link `source_url` is allowed only for the Bills desk's errata.* 2026-11-21* **Done 2026-11-22** (route `c73f7b78`, PR 222; migration `20261125090000` applied): 327 corrigenda loaded on NTER in 4 batches (100, 100, 93, 34), 523 chunks, 0 failed, one errata link each; all 4 passed acceptance; analyze run. Each batch stopped once at its spend ceiling (F403) and was resumed at US$0.01.

- [x] **F376 — Live TV: a claim left unchecked at the end of a session shows "Checking…" for ever in past sessions.** Found 2026-11-19 (executed, read-only): the one-minute session of 11:44 UTC has 15 claims, 12 with a verdict and one still `pending` hours after it settled. A one-minute session may check 12 claims (8 times the minutes plus 4), so the thirteenth checkable claim was never sent; the log shows exactly 12 check calls for it. In the session the panel says the limit was reached; the stored row stays `pending`, and the past-sessions view shows it as still being checked. Fix planned in 2026-11-19-live-tv-phase-2.md: a `pending` claim of a settled session is shown as "Not checked". Built on `feature/livetv-phase-2` 2026-11-19: a `pending` claim of a settled session reads "Not checked" only after the server's finishing window (120 seconds after the session ended) plus the check timeout (45 seconds); before that it keeps "Checking…". Released 2026-11-20 in `818ad04a` (pull request 197). Nothing else remains.

- [x] **F377 — Live TV: four 24-hour channels play an old video, not their live stream.** Found 2026-11-19 (executed against the live site's public API): NDTV 24x7, ET Now, India Today TV and Aaj Tak each have a live stream now, but under a different video from the one written in the channel list, and that written video is not live; so the page plays a recording and, since F367, rightly does not say LIVE. DD News, WION and CNBC-TV18 play their live stream. Sansad TV uses the `live_stream` address, which cannot be looked up. Fix planned in 2026-11-19-live-tv-phase-2.md: in live mode play the channel's detected live video. Built on `feature/livetv-phase-2` 2026-11-19: the page plays the channel's detected live video when YouTube reports one and the written video is not live; the channel list sends `liveVideoId`. Released 2026-11-20 in `818ad04a` (pull request 197). Still open: not verified in a browser on the app, and not checked on production for these four channels (the release check covered one channel's live lookup, zee-news). Checked 2026-11-20 on the live site's public API (executed): the lookup of NDTV 24x7, ET Now, India Today TV and Aaj Tak each returns a live video from YouTube data, so the page plays the live stream once the channel is opened. The channel list still shows these four as recent: the list marks a channel live from its hint video only, and their hints are stale (F381). Fixed 2026-11-20: the four channels got a `liveHintVideoId` of their own (their live streams, read from the live site's per-channel answer), and the list's batched check now asks about a channel's hint also when it has a curated video; the curated video keeps priority. A refreshed hint goes stale again when the channel starts a new stream; `scripts/refresh-livetv-hints.mjs` reports these four as kept, since their hints sit in `server/liveTvApi.mjs` and are edited by hand.

- [x] **F378 — Live TV fact-check: the worst-case cost of a hostile user was never accepted.** The fact-check spec's open question OQ5 asks the owner whether a worst case of about twice the price, for a client that sends as much as the limits allow, is acceptable before the feature opens to all plans. The audience was set to everyone on 2026-11-19 without that answer. Measured that day: four real minutes cost US$0.17 in model calls against 2,000 credits charged. Owner decision needed: accept the bound or tighten the per-minute and per-session limits. Owner decision 2026-11-19: the bound is accepted as it is for now.

- [x] **F379 — Live TV lookup budget is per server instance.** The daily budget (3,000 units per instance, env `LIVETV_LOOKUP_UNITS_PER_DAY`) resets on a cold start, so more instances mean more units. A shared counter would make the limit a guarantee. Known limit, ADR 0009 amendment of 2026-11-19. 2026-11-19 2026-11-20: the edge cache of F380 means most page loads no longer reach an instance, which lowers the spend per instance; the per-instance budget itself is unchanged. A shared counter needs a database table, so it waits for a migration decision. *Closed 2026-11-21 as an accepted limit (section 7):* YouTube itself enforces the project's daily quota; when it refuses, the server remembers the refusal for 30 minutes and the page falls back to the channel's written video, so the worst case is a channel shown as not live, not an error or a cost. Since F380 (pull request 209, `c93006d9`) the channel list and the per-channel lookup are answered from Vercel's edge for 60 seconds, so few calls reach an instance. A shared counter would need a new table and a migration for little gain; reopen if quota refusals show up in the logs.

- [x] **F380 — CDN caching of `/api/livetv/channels` and `/api/livetv/videos`.** Not done. Needs a change to the router cache policy of F154, which is the owner's call; the routes stay `no-store` until then. 2026-11-19 Done 2026-11-20 on the owner's go ("let's finish the rest"): `GET`/`HEAD` of `/api/livetv/channels` and `/api/livetv/videos` are kept at Vercel's edge for 60 s with 120 s stale (`API_CACHE.cdnLiveTv`), so a channel's live status may lag by up to about 3 minutes. Kept only when the answer is 2xx, `ok` is not false and `dataOrigin` is `youtube-api`; the channels answer now carries `dataOrigin` (`fallback` when the batched check did not answer), so a degraded answer is not kept. Read from code: neither answer depends on the user. Merged 2026-11-21 as `c93006d9` (pull request 209). Executed on production 2026-11-21: a repeated channel-list request was answered from Vercel's edge (`x-vercel-cache: HIT`, age 21 s).

- [x] **F381 — Hint video ids go stale.** The 47 hint video ids checked first on a lookup go stale when a channel starts a new stream. A refresh routine is needed. 2026-11-19 Merged 2026-11-20 as `cb82c677` (pull request 206; CI on main passed after the test fix `d2b0cc16`, pull request 207): `scripts/refresh-livetv-hints.mjs` looks up each hinted channel with the server's own lookup and rewrites a hint only when YouTube names a different live, embeddable video; a dry run is the default and `--write` applies it. Read from code: a stale hint costs no extra unit at lookup (the remembered, hint and curated ids go in one call), but it leaves the channel shown as not live in the list. Not run against YouTube (needs the key); the first `--write` should be on a clean tree and its diff read. Tests run offline. Run 2026-11-20 without a key: the script's lookup was given the live site's public per-channel answer (`/api/livetv/videos`, the same call the page makes). 47 hints checked: 30 stale and replaced, 12 current, 5 channels not live (hints kept). The diff changes only the 30 hint ids. The four original channels that played a recording (F377) got hints of their own the same day. Hints go stale again as channels start new streams, so the script needs a run now and then.

- [x] **F382 — Panel wording for a pasted video, and no "nothing is playing" line.** Both are panel changes: the wording that puts "on" before a pasted video's title, and the missing "nothing is playing" line. 2026-11-19 Merged 2026-11-20 as `cb82c677` (pull request 206; CI on main passed after the test fix `d2b0cc16`, pull request 207): a pasted video reads "Check what's being said in this video" with its title on its own line; with no channel and no pasted video the panel says "Nothing is playing. Choose a channel or paste a video link to fact-check it." and offers no start button (not while the channel list is still loading). Its signed-in check is listed in F375 (2026-11-20).

- [x] **F383 — A refund amount is stored as it is.** The usage history returns a refund's amount as stored, and `credit_current_amount` does not convert it (B5 on the branch). A future credit redenomination must convert it. 2026-11-19 *Closed 2026-11-21 as an accepted limit (section 7):* there is no redenomination planned, and until there is one the stored amount is the right amount. Any future redenomination plan must convert stored refund amounts and `credit_current_amount` together.

- [x] **F384 — The usage screen builds an added channel's name from its id.** Open on the branch, 2026-11-19. Merged 2026-11-20 as `cb82c677` (pull request 206; CI on main passed after the test fix `d2b0cc16`, pull request 207): the usage rows take the channel's name from the catalogue (`src/lib/liveTvChannelNames.js`; the 83 added channels from `server/liveTvChannels.mjs`, the first 13 repeated there with a test against drift). The first 13 were wrong too ("Ndtv 24x7"). An id outside the catalogue falls back to the stored title, then to the old wording. Not seen on a real usage screen. Its signed-in check is listed in F375 (2026-11-20).

- [x] **F385 — Live TV: 15 channels refuse to play inside another site.** Found 2026-11-19 by a check of all 96 channels on public YouTube: the player refuses these channels' videos (error 150). The channels are wion, sansad-tv, cnbc-tv18, india-today, aaj-tak, zee-news, news18-india, cnn-news18, the-lallantop, cnbc-awaaz, zee-business, moneycontrol, zee-24-taas, news18-bihar-jharkhand and ptc-news. That is the channel owner's setting and cannot be changed from here. Built on `feature/livetv-phase-2` 2026-11-19: the page falls back to the channel's written video or to a link to YouTube. Owner, 2026-11-20: keep them in the list as built; no "opens on YouTube" mark. Released 2026-11-20 in `818ad04a`. Still open: the fallback has not been seen in a signed-in browser on the app. 2026-11-20 *Closed 2026-11-21:* built and released; the signed-in check of the fallback is in F375.

- [x] **F399 — Live TV: two lower tabs were always empty.** Found 2026-11-21 in the closeout review (read from code): "Broadcast Schedule (0)" and "Archived Segments (0)" were shown for every channel, because no channel has a schedule or archive source (`CHANNEL_SCHEDULES` and `CHANNEL_ARCHIVES` are empty since F7). Built 2026-11-21 on `task/livetv-final-gaps`: each tab is listed only when its list has items; the fetches, endpoints and archive playback stay for a future source. Executed: focused tests fail without the change; full suite passes in a shuffled order. Merged 2026-11-21 as `dd6de559` (pull request 210); CI on main passed and production serves it. 2026-11-21

- [x] **F400 — Live TV: the channel list missed channels that started a new live stream.** Found 2026-11-21 on the live site (executed, after F380's release in pull request 209): NDTV 24x7, ET Now and India Today were live on stream ids other than their hard-coded hints, which had been current the day before, so the list showed them without a LIVE mark; opening each channel found and played its live stream. News channels start event streams often, so a hard-coded hint goes stale within a day. Built 2026-11-21 on `task/livetv-list-remembered`: the batched list check also asks YouTube about the live video the per-channel lookup last found on that server instance (`lastLiveId`), in the same de-duplicated batches of 50 (at most one more unit per check); a confirmed live one comes after the curated video and before the hard-coded hint. Executed: the new tests fail without the change; the full suite passes in a shuffled order. Known limit: the remembered video is per server instance and is known only once someone has opened the channel there; the hard-coded hints still need `scripts/refresh-livetv-hints.mjs` from time to time. Merged 2026-11-21 as `a60354d3` (pull request 211); CI on main passed. Executed on production after the deploy: once each of the four channels had been opened, the channel list showed NDTV 24x7, ET Now, India Today and Aaj Tak as live. 2026-11-21

- [x] **F402 — Live TV: a YouTube-style watch page.** Client feedback 2026-11-21, relayed by the owner: a taller 16:9 player with no dark bars, the whole page scrolling with the panel, and a shorter channel bar across the full width. Measured the same day on the rendered page (executed): at 1590 × 840 the player is 467 × 263 in a 916px column (49% dark bars) and the bar is 143px tall; the same at 1440 × 760 and 1920 × 960. Owner decisions 2026-11-21: a one-row bar of about 60px with a segment chooser, the panel as tall as the window and scrolling with the page, the player capped to the window with spare width to the panel, the space under the panel left empty. [Spec](../specs/2026-11-21-live-tv-watch-layout.md), [plan](2026-11-21-live-tv-watch-layout.md). Merged 2026-11-21 as `b61ae69f` (pull request 215) on the owner's yes; CI on main passed and production serves it (executed: the live stylesheet has the new rules). Built by two parallel tasks (the bar, the page grid), reviewed independently; the review's required fixes (the older channel card covered the player while channels load; controls under 40px on touch screens) were made before the merge. Measurements are in the spec. Its signed-in check is in F375. Known limits: the now-playing row's 72px reserve (a row that wraps further ends a little below the window, and the page scrolls); switching segment chips is not announced to screen readers; the layout tests read the stylesheets, the sizes were measured by hand. 2026-11-21

- [x] **F386 — Live lookup still misses a few 24-hour streams.** Measured 2026-11-19 on public YouTube: the live video of dd-news, the-lallantop, niti-aayog, bbc-news-hindi, dw-news, thanthi-tv, sun-news, ntv-telugu and manorama-news is not among the first 50 entries of the channel's live-streams playlist. The remembered-video and uploads steps recover some of them. Executed on the branch's preview deployment with the real key on 2026-11-19: all 96 channels were looked up once; 55 answered live from YouTube data, 40 answered not live, and 1 (drishti-ias) timed out and fell back. Eight of the nine channels the public check feared missing (all but niti-aayog, which may not have been live at that hour) were found live. YouTube reported `embeddable` true for every live video, including the channels whose player refuses with error 150, so only the player's own error catches a refusal. A fix needs a refreshed remembered video per channel (see F381), or paging the playlist at more cost. 2026-11-19 Closed 2026-11-20 without a change (read from code and the entry's own measurement): the remembered-video and uploads steps found 8 of the 9 feared channels; one more playlist page would cost 2 units on every not-live lookup of a channel with more than 50 live streams (5 to 7 units worst case) for no measured miss.

- [x] **F387 — Live TV layout polish and PDF download.** Owner request 2026-11-20, four changes: remove the header strip; the player and the fact-check panel never leave the screen from 1081 px, and only the content below them scrolls; the YouTube link field moves into the panel; a PDF download of a fact-check session. [Spec](../specs/2026-11-20-live-tv-ui-polish.md). Built on `feature/livetv-ui-polish`, not merged. Finding: `pdf-lib` with an embedded Devanagari font places matras wrongly, so lines with non-Latin script are drawn by the browser and placed as images; Latin text and source links stay text. 2026-11-20: built and independently reviewed; the review's findings were fixed (a source address could inject an action into the PDF's link, fixed with a test that failed first; the first layout's sizing broke on short windows and was reworked after measurement in a browser; focus on the PDF button; the report links the session's own video). As built: from 1081 px, and when the window is about 785 px tall or more, the panel is the full-height right column, the player is centred on a dark stage and only the area under the player scrolls (the player is 579 × 326 at 1440 × 900, 819 × 461 at 1920 × 1080); shorter windows keep the scrolling page. The PDF carries the company logo beside the name. Checked on static copies of the real page and with a PDF generated on the development server; the owner approved the merge on 2026-11-20. Remaining, each needing a signed-in person: the real player and fullscreen in the pinned layout, a PDF downloaded through the button, and Hindi in the PDF on Windows and Android. Merged as `49787958` (pull request 198). Its signed-in check is listed in F375 (2026-11-20).

- [x] **F388 — Live TV: the pinned layout did not apply on 13-inch laptops.** Reported from a client demo on 2026-11-20: on scrolling, the fact-check panel moved. Cause, measured in a browser on static copies of the page: the pinned layout of F387 needed a window about 785 px tall, and Chrome on a 13-inch MacBook gives about 715 to 790 px, so the page fell back to the scrolling layout, where the panel travels 143 px and then sticks. Merged as `28b76237` (pull request 199). The change: the pinned layout now applies from a window about 665 px tall (`.ltv-main` 520 px inside its padding); below 640 px the lower area gives way to the player down to 110 px and the stage floor is 120 px. Measured: 1440 × 715 gives a 391 × 220 player, a 449 × 413 panel and a 106 px lower area, with nothing moving on scroll; 1440 × 900 is unchanged (579 × 326). Cost: on such a window the player is much smaller than on the scrolling page (948 × 533 there). Windows under about 665 px tall keep the scrolling page. Also on this branch, at the owner's request the same day: the fact-check panel is wider, `clamp(440px, 40%, 640px)` in place of `clamp(440px, 32%, 520px)` (562 px at 1440 wide, 640 px at 1920); the player is limited by height at these sizes, so its size is unchanged and the width comes out of the dark bars beside it. The owner decided the session transcript stays in the panel and is not shown in the tab under the player. Remaining: a signed-in check with the real player on a 13-inch laptop. Its signed-in check is listed in F375 (2026-11-20).

- [x] **F389 — Live TV: the newest transcript words shown in the fact-check panel.** The owner asked on 2026-11-20 for the transcript to be visible on the right side; the panel keeps opening on Claims. Merged as `3377b24a` (pull request 200). While a session runs and the Transcript tab is not showing, a strip of two text lines (50 px) sits between the block line and the scroll area and shows the last two transcript lines, with the older text clipped at the top. "Full transcript" switches to the Transcript tab and moves focus to it. It is not a live region. Measured on static copies of the page: at 1440 × 715 the strip is 532 × 50 and the panel's scroll area goes from 207 px to 146 px; at 1440 × 900 the scroll area is 332 px; a text of five lines shows its last two. Remaining: a signed-in check that the words move during a real session (channel and pasted link). Its signed-in check is listed in F375 (2026-11-20).

- [x] **F391 — Budget: 116 of 486 v1.1 records are held as control codes.** Found 2026-11-20 at screening: 116 are held as `control_codes_excess`. The extracted text uses control codes in place of the space and of digits (font-mapping fault): 112 in Budget documents and 4 in Economic Survey. The hold is correct; the records need re-extraction, for example by OCR. The other 24 holds, counted from the screen's hold file: 9 too long, 1 too long with a page fault, 1 over the chunk limit, 6 duplicate text, 3 of a text type not allowed (one already live), and 4 that failed a page check. 140 held and 346 eligible make 486. **Route decided 2026-11-21 (developer): OCR on Supabase from the official URL, no PDF stored or served, no OCR or service key on the laptop, text loaded through the five-desk supplied-text route.** Built on `task/f391-ocr-text-route-2`, not applied, deployed or enabled: migration `20261125100000_budget_ocr_queue.sql` (a queue in `private`, a US$2 spend cap in the database, cron job inert until switched on), Edge function `budget-ocr`, `cli.ts ocr-enqueue` and `ocr-collect`, and the Budget screen allowing the text type `ocr_mistral`. Plan over the real screen files: 116 records, 361 pages, US$1.444; first batch of 20 = 71 pages, US$0.284. Spec: `docs/specs/2026-11-21-budget-ocr-text.md` (order to apply, deploy and enable, each with the developer's named yes). *Built, awaiting review and the developer's yes to apply. 2026-11-21* *Independent security review of PR #223 on 2026-11-22: accept with fixes; fixes applied the same day: a link the URL parser rewrites is no longer queued (it would have been paid for and refused as `url_mismatch`), the claim estimate follows the current price, more pages than expected halts the run, a failed `finish` ends the request instead of paying again, the function host is pinned, the database path check matches the screen's, a secret under 32 characters is refused, and the runbook gains the cron, re-queue, 5xx-estimate and vault notes.* 2026-11-22: queue applied (`20261125100000`), secret set, `budget-ocr` deployed, cap US$2. First batch of 20 (71 pages) OCRed twice (F408) and a 4-page trial; US$0.584 committed; **nothing loaded**, switch off. Blocked on F409. **Done 2026-11-23**: all 116 OCRed by Mistral with markdown tables (decision 2026-11-23; PRs 224, 225, 226, 228, 229, 230, last `7e89ee80`); OCR spend US$4.159 committed under a US$10 cap, switch off. Screen: 114 pass, 2 held `thin_page`. Loaded on NTER in 3 batches (49, 50, 15), 1,414 chunks, 0 failed, all accepted (two receipts reconstructed from `ingest_batches` after a missing receipts folder); Budget desk 461 documents, 17,165 chunks; analyze run. Load folder `~/niyantran-eval-cache/budget-ocr-load-2026-11-23/`.

- [x] **F408 — Budget OCR: tables dropped from the stored page text.** Found 2026-11-22 on the first live `budget-ocr` batch (executed): 20 of 20 Budget records (71 pages, US$0.284) came back with every table missing and only a `[tbl-N.md](tbl-N.md)` placeholder in its place. Mistral returns tables apart in `page.tables`; `supabase/functions/budget-ocr/handler.ts` stored `page.markdown` alone. None of the 20 was loaded. *Fixed in the working tree 2026-11-22, not committed or deployed:* each page text is now the ingest worker's `composeDocument` (`supabase/functions/_shared/pageText.ts`) of the same answer, so tables are put back in place, image placeholders are rewritten as the worker writes them, and header and footer lines are restored unless they repeat across pages (the old text dropped them all, as Mistral moves them out of the markdown); a placeholder with no table fails the request as `ocr_table_unresolved` (billed, permanent) and stores no text; `ocr-collect` refuses to build a record whose text still holds a placeholder (`not built: table_placeholder`). New tests in `budget-ocr/handler_test.ts` (tables, headers and footers, images, and page texts equal to the worker's `planIndex` composition of the 12-page bill fixture) and `scripts/bulk-runner/ocr_route_test.ts` fail on the old code. Open: redeploy `budget-ocr`, then re-queue the 20 (an owner update of their `done` rows, spec step 8) and OCR them again, about US$0.284 more, still under the US$2 cap. 2026-11-22 **Done 2026-11-22** (PR 224 `49ffb0af`, deployed): page texts are the worker's `composeDocument`; unresolved tables fail the request; `ocr-collect` refuses placeholders. PR 225 `04424165` sends the worker's exact flags.

- [x] **F401 — The page check judged a compressed body short.** Merged 2026-11-21 as `8ac0d489` (pull request 212). Re-screened from that commit, all 26 held Industry records passed and were loaded and accepted ([record](../operations/2026-11-21-national-loads.md)), so the fix is now seen working against the real site. Reported 2026-11-21 by a load agent (reproduced with curl and Deno fetch; the cause is read from code): `body()` in `scripts/bulk-runner/page_check.ts` compared the decoded length with `Content-Length`, which is the compressed size on the wire, so a 23-byte robots.txt sent gzip-compressed (43 bytes on the wire, www.dpiit.gov.in) was retried four times and its records held as `pdf_unavailable` (26 Industry records). *Fixed on `task/page-check-compressed-length-2`: the check applies only when there is no content-encoding (or `identity`); an identity body shorter than its Content-Length is still retried. Two new tests fail on the old code and pass now. 2026-11-21*

- [x] **F395 — Live TV: the fact-check panel was short on laptops and its tabs scrolled away.** Client feedback on 2026-11-20 ("make this box bigger", and the transcript looked gone because the tabs had scrolled out of view). On a 13-inch laptop the panel was 413 px tall and, after the strip of F389, its scroll area 146 px. Merged as `afe69e33` (pull request 204). (1) In the pinned layout with the panel, a new wrapper `.ltv-grid` is the grid and `.ltv-body` dissolves, so the channel bar is the first row of the left column and the panel runs the full height of the right column, beside the bar. (2) The tabs (Claims, Transcript, Summary) sit above the scroll area, so they stay on screen. (3) On the scrolling page for windows under about 665 px tall the panel's height floor is 440 px where the window allows, in place of 320 px. Measured on static copies of the page: 1440 × 715 gives a 572 px panel with a 255 px scroll area and the player unchanged at 391 × 220; 1920 × 1080 gives a 937 px panel (it was 778 px); 1440 × 660 (scrolling page) gives a 107 px scroll area (it was 21 px). Cost: the channel bar is only as wide as the left column, so fewer channels show before the arrows are needed (three at 1440 wide), and at 1100 wide the bar wraps to 206 px and the player goes from 382 × 215 to 326 × 183. Remaining: a signed-in check on a 13-inch laptop. The 1366 × 768 gap was closed by F396. Its signed-in check is listed in F375 (2026-11-20).

- [x] **F396 — Live TV: short windows, a covered row of buttons, and an empty tab.** Found 2026-11-20 in a review of the page after F395. Merged 2026-11-20 as `cb82c677` (pull request 206; CI on main passed after the test fix `d2b0cc16`, pull request 207). (1) A window under about 665 px tall (a 1366 × 768 laptop gives about 650 px) kept the old scrolling page, where the panel had about 100 px for claims. Now the panel is the right column from the top of the page body and does not move (measured at 1366 × 650: at the same place at every scroll position, 507 px tall with a 190 px scroll area); the left column scrolls and the player is capped so that it and the now-playing row fit the window together (782 × 431). (2) In the pinned layout the now-playing row could get less height than its content when its buttons wrapped, and the lower area covered them (measured at 1440 × 715 with a pasted video: the row needed 123 px and got 80 px). The row now keeps its content's height, the title takes two lines at most, and at 1440 wide the buttons stay on one line (player 356 × 201). At 1280 wide they wrap and the player is 297 × 167. (3) The "Transcript" tab under the player is removed with its code and styles: its only source, `BROADCAST_TRANSCRIPTS` in `server/liveTvApi.mjs`, is empty and nothing writes to it (read from code). The route `/api/livetv/transcript` is left in place, unused by the page. Broadcast Schedule and Archived Segments have the same empty sources and were kept; removing them is the owner's call. Remaining: a signed-in check. Its signed-in check is listed in F375 (2026-11-20).

- [x] **F348 — Live TV restarts a recorded video on mute or reload.** *Remaining: the start position on a recorded video during a real fact-check capture, to be seen in the owner's live session. 2026-11-17* Built and reviewed 2026-11-16 on `task/f348-livetv-player-api`; merged 2026-11-17 in pull request 156 (`e55c9438`) and live with the production deployment. Mute goes through the embedded player's message interface and no longer remounts it; Reload Feed still restarts, by design. The player's position is read the same way and is sent as the start position of a fact-check on a recorded video. Checked in a browser on the development server against the real embed: mute and unmute keep the same player with no reload, and Pause then Play and Reload Feed keep the chosen mute. The start position on a recorded video has not yet been run in a fact-check capture.
