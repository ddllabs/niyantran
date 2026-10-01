# admin-records: the local end-to-end run (plan C5)

> **Status: Historical (dated 2026-10-01).** The local end-to-end run that Amendment A
> (revision 3) of `docs/specs/2026-10-01-rag-v2-admin-upload.md` requires before anything
> touches NTER (plan `docs/plans/2026-10-01-rag-v2-admin-records.md`, C5; checkpoint I is the
> owner reading this). Every result was **executed** in the built-in browser against a full
> local Supabase stack loaded with NTER's real bill rows. Real OCR and embeddings cost
> **$0.197** (three documents, 49 pages). Nothing touched NTER.

## Set-up

- **Code:** branch `task/admin-records`, final commit `cc695ca`. Checkpoint H passed before
  the run and again after its fixes:
  - lint is clean and the build succeeds; the main bundle is unchanged at 438.22 kB, and the
    Documents chunk is 59.8 kB;
  - Vitest: 1,353 tests pass;
  - Deno: 767 tests pass;
  - all 21 SQL fixtures pass `npm run test:sql`, including corpus_records' vacuity check,
    duplicate pre-check and executed Down section.
- **Local stack:** a fresh scratch copy of `supabase/` with its own project id. All 42
  migrations are applied, including `20261001180000_corpus_records`.
- **Desk rows:** `scripts/load-desk-rows.mjs`, pointed at the local stack only, loaded both bill
  features. Each has 9,817 rows and 9,415 keys, as on NTER.
- **Functions:** `supabase functions serve` with a mode-600 env file, deleted afterwards.
  - It held the Mistral and OpenRouter keys and a generated worker secret.
  - It also held localhost-only URL overrides, so Mistral fetched the public PDFs.
  - The schedule is off locally, so each index step was one manual POST to the local worker.
- **Accounts and pages:**
  - **Test admin:** created and promoted on the local stack only. Its generated credentials
    were in a mode-600 file, deleted afterwards.
  - **Two tabs:** the admin Documents tab, and the terminal's bill desk with the chat panel.
  - **Feeding files:** each PDF was assigned to the page's real file input, as in B5.
- **Documents** (copies of the owner-approved pilot PDFs):
  - the 12-page bill;
  - the same bill with one trailing comment line, so it has a new SHA-256 (the replacement);
  - *Budget at a Glance 2026-27* (25 pages).

## The spec's checklist

| # | Check | Result |
| --- | --- | --- |
| 1 | Attach the bill to its record: processing, then full text | **Pass** |
| 2 | Drag the bill row into the chat without a reload: "Full text", computed key = linked key | **Pass** |
| 3 | Unlink, then re-link, each showing in the badge within a minute | **Pass, after a fix** (finding 1) |
| 4 | Replace and swap | **Pass** |
| 5 | Delete | **Pass** |
| 6 | A standalone upload on a keyless desk | **Pass** |
| 7 | An orphaned link shows in both lists | **Pass** |
| 8 | Two tabs acting on one record: `stale` | **Pass** |
| 9 | The audit rows | **Pass** |

**1. Attach.**
- *bill:2025:XLV* ("Record only") was found by searching "Classified Information", and Attach
  PDF was clicked.
- The upload panel:
  - pre-filled the title from the record and fixed the desk and record;
  - planned "12 pages · 1 part · estimated $0.0480";
  - showed the desk's hub page only as a hint (D6).
- **Source-URL rule:** the hub URL was refused in the form ("That is the desk's source page,
  not this document"), and Upload stayed disabled. The PDF's own address was accepted.
- **Registration:** `metadata.document_key = bill:2025:XLV` was set at registration, with an
  `attach` audit row.
- **Result:**
  - the record went PROCESSING → FULL TEXT, without a reload;
  - coverage read "1 of 9,415 bills have full text";
  - the job row showed Record *bill:2025:XLV* and a cost of $0.0481.

**2. The chat panel.**
- The bill row was dragged from the desk table into AI Research. The page's own dragstart and
  drop handlers ran, with synthetic events.
- The chip showed **Full text**.
- `billDocumentKey(row)` on the dropped row is `bill:2025:XLV`, the linked key.

**3. Unlink and re-link.**
- The first unlink, from the Documents page, showed in the open chat in **34 s**.
- A later re-link showed only after **more than 90 s**. This was a real defect, now fixed and
  shown red first (finding 1).
- After the fix, unlink showed in **55 s** and re-link in **55 s**.
- These timed runs called the page's own `createAdminIngestApi()` from the chat tab, and that
  tab's visibility event was blocked. This kept finding 2 out of the measurement.

**4. Replace and swap.**
- **Replace on the live record:**
  - the panel said the new PDF "registers without a record; when it is live, swap it in";
  - it registered unlinked with `link_target = bill:2025:XLV` and `replaces = <old id>`.
- **While it ran:**
  - the record listed the live holder (Replace, Unlink, Re-link, Delete) and the pending
    replacement (Delete only);
  - "Documents without a record" showed "replacement for bill:2025:XLV".
- **Swap:** once live, Swap → "Confirm swap" moved the key to the new document. The old one was
  unlinked, not deleted, and appeared under "Documents without a record". The swap's audit row
  names both documents.

**5. Delete.**
- The old, unlinked upload was deleted after the in-page confirmation.
- Its document, chunks, jobs and file rows are gone.
- Both stored PDFs remain in `corpus/files/` for the sweeper (F38).
- The `delete` audit row records its source key and hash.

**6. Standalone upload.**
- The desk picker on *national · Budget Utilisation & Schemes* reads "This desk has no record
  keys yet… Standalone uploads only".
- "Upload to this desk" pre-selected the desk.
- *Budget at a Glance 2026-2027* was uploaded with its indiabudget.gov.in URL. It produced 25
  pages, 78 chunks, no key and $0.10.

**7. Orphaned link.**
- Renaming the key in the local `desk_rows` gave:
  - coverage: "1 orphaned link";
  - the unlinked list: "orphaned link: bill:2025:XLV".
- Link → the record picker → *bill:2025:XLV-c5* re-linked it with `expected_key` = the orphaned
  key. The rows were then restored.

**8. Two tabs.**
- The Documents tab loaded the record, and another tab unlinked its document.
- The Documents tab's Unlink → Confirm was refused **`stale`** (409), with no audit row.
- The page showed "This record changed since you loaded it — refreshed." and redrew the current
  state.

**9. Audit.**
- `corpus_admin_actions` holds 16 rows, one per successful action: attach, link, unlink, swap
  and delete.
- Every row carries the admin's id, and none was written for a refusal.
- The standalone upload writes none: an attach row is written only when a key or link target is
  set.

**Further checks.**
- `records` round trips through the Edge Function:
  - unfiltered, 1.7 s on the first (cold) call;
  - by status at offset 100, 0.37 s;
  - a search on the Policy Intelligence Graph alias, 0.5 s.
- `serve.log` holds no bearer token, JWT or secret key.

## Findings

1. **Fixed: the badge's periodic re-check could skip a whole minute.**
   - **Cause:** `watchCoverage` ticked every `COVERAGE_TTL_MS`, but its re-check asked only about
     answers past that same lifetime. Real timers drift, so a tick often found the last answer a
     few ms short of expiring and skipped the query. A change then showed after up to two
     minutes, not one (D9).
   - **Fix:** a new `recheckCoverage` asks about every attached key on each tick and keeps the
     last answer if the lookup fails.
   - **Tests, red first:** a unit test (an answer 10 ms short of its lifetime), and a watcher
     test that steps the clock back 10 ms between ticks (2 queries where 3 were due). Commit
     `cc695ca`.

2. **Not fixed, outside this change: the chat panel drops its attachments whenever its tab
   regains focus.**
   - **Cause:**
     - supabase-js emits a same-user `SIGNED_IN` on every visibility change.
     - `useResearchThread` subscribes through `subscribeLocalIdentity` and treats every auth
       event as an account change. It resets the store to an empty one and rehydrates, so an
       unsent chat's attachments are lost.
   - **Reproduced on code this branch never touched:** attach a row, switch to the admin tab and
     back, and the chip is gone. The event log shows `SIGNED_IN` on each return.
   - **Effect on NTER check 1:** it passes as written, because the drag happens after the
     attach. But an owner who drags first and then visits the admin tab loses the chip. This
     is likely part of this morning's report ("dragging … did not attach").
   - A "Loading research…" panel that needed Reload after a resize looked like the same cause.
   - **Fix:** the same one the admin panel got in `dcf7034`: re-check quietly on a same-user
     event, and reset only on a different user or a sign-out.
   - Recorded as **F43**.

3. **Fixed before the run: two contract mismatches between C1 and C4** (`0c7ca07`, `04466a1`,
   each red first).
   - **The page could pick a pending replacement as the record's holder.** Record documents now
     carry `link_target`, and the holder is the non-legacy document without one. A pending
     replacement offers Delete only.
   - **Swap sent `expected_old = null` once the old document was gone.** `ingest_swap` compares
     the recorded `replaces`, so that call would always have been refused `stale`. Swap now
     always sends `replaces`, and the unused record lookup is removed.

4. **Fixed: the independent review's three Low findings** (`249bd6e`, each red first; the
   review approved the migration).
   - **Delete and activation could deadlock.** `ingest_delete` now locks the active job before
     the document, the same order as `ingest_activate`. A two-session fixture proves it: a
     delete waiting on the job holds no document lock.
   - **`ingest_discard` could delete a legacy document** with an `upload:` key. It now refuses
     one (D3).
   - **A swap of a document linked meanwhile was refused `not_replacement`.** It is now `stale`,
     so the page reloads instead of keeping an outdated row.
   - **Left as documented:** swap writes one audit row (the old document appears in its
     detail), and swap does not re-check the desk, which the spec does not ask for.

5. **Observations, not defects:**
   - The upload panel keeps its "registered; processing will start shortly" line after the job
     succeeds.
   - The unlinked list shows the replaced document's id, not its title.
   - The source-URL input has no programmatic label.
   - Desk dates show a time ("2025-12-04 19:00:00").
   - Logs redact `document_key`, `expected_key` and `key_holder`, because their names contain
     "key". This widens F36.

## Deployment order for C6

The migration goes first, then `admin-ingest`, then the frontend.
- Against the old `ingest_register`, the new handler's `document_key`, `key_check` and
  `replaces` would be ignored, so an attach would succeed unlinked.
- The reverse order is safe: the old handler works with the new SQL.

## State after the run

- The dev server, functions and local stack are stopped.
- The env file, the test-admin credentials, the worker-kick script and the test PDF copies
  (`ingest/c5/`) are deleted.
- The temporary launch entry is removed.
- Nothing touched NTER.
