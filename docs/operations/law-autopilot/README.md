# Law ingestion autopilot (batches 7–11)

> **Status: Living.** This file records the owner's standing approval, how the autopilot runs, and when it stops. Each
> batch's receipt is written to `law-batch-<n>-release/` once that batch is verified.

## Authorization

- **Owner request** (Tamanesh Kauri, 2026-10-26 20:59–21:07 IST): keep running 1,000-document batches one after another
  without pasting a token for each tranche.
- **Option chosen:** a dedicated ingestion account that signs itself in.
- **Standing approval:** **5 batches** of up to 1,000 IBBI_NCLT orders each (batches 7–11). The approver is **Tamanesh
  Kauri**, recorded as the approver on every decision row. Decision IDs:
  `owner-authorized-20261026-law-auto-b<nn>-<tranche>-<year>p<member>-<i>`.
- **After batch 11** the autopilot stops. A further run needs a new approval.

## Credentials (no human token handling)

- **Account:** a separate ingestion account made admin by the owner (`user_profiles.role = 'admin'`). It is used for
  nothing else.
- **Where the sign-in lives:** Colab Secrets (`NTER_INGEST_EMAIL`, `NTER_INGEST_PASSWORD`,
  `SUPABASE_PUBLISHABLE_KEY`), with notebook access turned on. Nothing is typed, printed, saved to Drive or committed.
  The secrets are read once at start (the tab must be open then) and kept only in the process's memory. The key must be
  the publishable or anon key.
- **Tokens:** the driver signs in by password for each tranche and for each indexing poll. The 60-minute access token
  lives only in this process's environment for that step and is then removed. The refresh token is discarded.
- **Service keys:** a service-role or secret key is refused.
- **Owner follow-up:** rotate or disable the account after the run.

## Each batch

1. **Live read.** Read the Law documents already in the database (key, URL, index state).
2. **Duplicate registry.** Build or extend a cached registry of their text (MinHash over 5-word shingles) and
   citations, read from `documents.ocr_text`. Each stored text hash is re-checked on read.
3. **Screen.** Run the schema-3 screen with complete subtree scans over the next pack members (2024 p00001 onward, then
   2023, 2022 and so on). Every completed manifest is excluded, including earlier autopilot batches. Then run the existing
   estimator.
4. **Offline holds:**
   - no case number;
   - not an official IBBI order PDF URL;
   - estimate not chunked;
   - more than 256 chunks or 300,000 characters;
   - already in the database by key or URL;
   - same normalized case number and order date as an existing document or an earlier candidate (the first copy is
     kept and later ones are held);
   - **contained in a same-date order**: when the two texts differ in size by more than 3× (pairs the near-duplicate
     rule skips) and the order date is the same, at least 80% of the smaller text's shingles must not appear in the
     larger, compared exactly. MinHash pre-filters, and the smaller side needs at least 50 shingles. Added before
     batch 11 after one such pair appeared in each of batches 7, 9 and 10: Master Weaver, Dharti Dredging and MSA
     Developers;
   - **near-duplicate text**, measured as exact shingle containment, checked against ingested documents and earlier
     eligible candidates in the same window. A document is held at ≥ 0.90 together with the same case number, order
     date or PDF hash tail, or at ≥ 0.97 on its own when both texts have at least 300 shingles. MinHash is used only to
     pre-filter pairs; pairs whose sizes differ by more than 3× are not compared.
5. **Selection and tranches.** Take the first 1,000 eligible documents in screen order and split them into tranches of
   about 205. Stop if the conservative ceiling exceeds US$2.50 for the batch.
6. **Finalize and dry run.** Finalize each tranche with `--keys` and run the offline dry run. The dry run must show every
   key ready, 0 held, the exact chunk total and a cost within bound.
7. **Reconcile, then submit.** For each tranche: sign in → read-only reconcile → sign in again → submit, only if every
   key is ready with a ready mapping and no existing document, the summary binds the same manifest, and the fresh token
   covers the tranche. A `link-existing` action is accepted only for a single visible NCLT order
   listing with the same URL and no linked document. Submission must report every key submitted, with 0 uncertain and
   0 held.
8. **Wait for indexing.** Poll every 5 minutes, for up to 300 minutes.
9. **Verify each document** (read-only REST):
   - indexed;
   - stored text hash equals the plan;
   - chunk count equals the plan, with no null vectors;
   - exactly one listing link;
   - URL equals the order URL;
   - fingerprint over sorted `source_key|chunks|text_sha256` equals the plan.

   A listing that has not appeared yet is retried for 25 minutes.

## Stops

Any of the following ends the run with the reason written to `autopilot-status.json` in
`Data Handover/Legal/v1.1/staging/autopilot-20261026/`:
- a screen that is not finalizable;
- a dry-run, reconcile or submit deviation;
- the cost bound being exceeded;
- a sign-in or read failure;
- an indexing timeout;
- a verification failure;
- the pack running out.

**Pre-write importer failures are retried.** The importer completes every read-only check (source scan, live
`law-reconcile` mapping for each document, chunk and cost bounds) before it opens its report, and it registers nothing
until the report exists. An exit 1 with no report file therefore proves nothing was written. The driver retries that
case alone, up to 3 times, after 90, 180 and 270 seconds, each time with a fresh sign-in. Batch 7 T1 first stopped this way on
2026-10-26 16:45 UTC: one mapping request took about 40 seconds on the server (edge logs), past the importer's 30-second
client timeout, and the database was unchanged.

**Incomplete submissions are resumed by reconciliation, never treated as done.** The importer stops sending at the first
uncertain outcome. Batch 7 T1's second attempt registered 185 of 205 documents. A 503 on the read-only
publication-status check after document 185 then counted as uncertain, and the last 20 were not sent. The driver then
pauses 120 seconds so any request still in flight can finish, signs in again and runs a fresh read-only reconcile of
the same approved manifest. Every key must be accounted for, in one of two ways:
- **already registered:** the live document exists, its stored text hash equals the plan, and the mapping names that
  document;
- **cleanly ready:** the key is ready with no document, as on a first submission.

A registered document that the API cannot show yet is waited for, not accepted unchecked. Supplied-text NCLT
documents are readable only once published (after indexing). Batch 9 T1 first stopped on this: 13 documents registered
seconds before the uncertain response were not yet published. The driver waits 5 minutes and re-reconciles, up to 18
times (90 minutes), until every registered document is readable and its text hash can be compared. Only then does it
submit the same manifest again. Registration is idempotent and the database is the ledger, so the
resume registers only the remainder. The tranche counts as submitted when the new report shows submitted plus already
registered equal to the tranche size, with 0 uncertain and 0 held. The resume stops on any held document, any
mismatch, or more than 5 submission reports for one tranche.

A stop never deletes or unpublishes anything. Every step is resumable: reports are never overwritten, and re-running
the cell continues from the recorded state. Each tranche's dry run must also match the estimate for every document's
chunk count.

Offline test: `python3 -I test_autopilot_offline.py`. It uses a fake screener, importer and REST, and covers:
- two clean batches and the holds;
- a reconcile-mismatch stop followed by a resume;
- a crash mid-submission, resumed;
- a pre-write retry, and no immediate retry once a report exists;
- a part-way submission resumed (12 already registered plus the rest);
- a resume refused when a registered document's text differs;
- the 5-report bound;
- a resume that waits for registered documents to become visible;
- the same-date containment hold, both end to end and as a unit test;
- the size guard.

With retries or resumes turned off, the corresponding scenarios stop, as batch 7 T1 did.
An independent review of the first draft found 9 defects (premature resume, one token covering both reconcile and
submit, browser-bound secret reads, narrow network retries, unordered or short-page paging, unequal-size MinHash, and
non-atomic caches); all are fixed here.

Not done by the autopilot: the SQL receipt, the embedding-cost accounting and the Drive ledger refresh. Claude adds
these after each verified batch, from read-only SQL.
