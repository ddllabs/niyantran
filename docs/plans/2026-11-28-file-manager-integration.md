# Implementation plan: bringing the `file-manager` branch into `main` (F418)

> **Status: Historical (2026-11-28).** Source spec:
> `docs/specs/2026-11-28-file-manager-branch-integration.md` (approved 2026-11-28). The developer approved this plan on
> 2026-11-28. Merged in PR #250 (`f5255529`); at release the developer chose to merge before deploying `research-chat`
> and `ingest-worker` (see Progress). F418 is in `docs/plans/open-work-done.md`; the remaining deploys are F419 in
> `docs/plans/open-work.md`.

## Overview

The contributor's file manager and the website's phone layout come onto `main` through one integration branch,
`task/file-manager-integration`. That branch merges the contributor's commit `a4a09d84` and leaves out:

- the branch's migrations;
- the separate `nter-mobile/` app;
- its screenshots and its mobile-app-only reports.

Conflicts are resolved and the failing tests fixed. The branch's SQL fixtures are re-pointed to `main`'s F410 to F413
migrations. The result goes through one pull request. Nothing reaches `main` or NTER without the developer's yes. The
production steps after it (Edge Function deploys, then indexing) each have their own yes.

## Facts the plan rests on (read 2026-11-28)

- **Nothing gates the file manager.** `TerminalShell.jsx` mounts it at `#/files`, and `AiPanel.jsx` opens its picker for
  any signed-in user. So merging ships it.
- **The UI depends on server code that isn't deployed:** private-file citations (`document-file`), private retrieval and
  attachments (`research-chat`), and indexing (`ingest-worker`). Until those three are deployed, those features fail on
  nter.pro, but upload and browse work.
- **The two failing Deno tests are test errors, not code errors:**
  - `prompt_test.ts` expects the old attachment-safety wording, which the branch widened to cover retrieved personal
    documents.
  - `document-file/handler_test.ts` expects 300 seconds for a private-file link. The handler deliberately signs private
    links for 60 seconds (`SIGN_SECONDS_PRIVATE`, per the branch's ADR 0006).
- **The branch's ADR is numbered `0006`, which `main` already uses.** The next free number is `0016`.
- **The branch's eight SQL fixtures are chained to its own `20261115000001_private_file_manager.sql`.**
  `user_files_quota_complete` also chains `main`'s plan migrations.

## Architecture decisions

- **Merge, don't squash or cherry-pick.** The contributor's commits and authorship stay in history. The merge commit
  itself carries the exclusions and the conflict resolutions. Later fixes are separate small commits.
- **Pin to `a4a09d84`.** Anything the contributor pushes later arrives as its own pull request (spec decision 5).
- **Main wins on the database.** The branch's tests are brought to `main`'s behaviour, never the reverse. Each changed
  expectation is listed in the PR.
- **Release order:** deploy the three Edge Functions from the reviewed PR head first, then merge.
  - The new function code accepts the current client: it only adds a private-file path, used when the new UI sends file
    ids.
  - Deploying first means no window in which nter.pro shows the file manager without its server.
  - Task 9 checks this compatibility before anyone deploys.
  - The alternative, merging first and deploying straight after, leaves a window of minutes where citations fail.
  - Either way, each deploy needs its own yes.

## Task list

### Phase 1: The integration branch (the merge commit)

- [x] **Task 1: Merge with the exclusions.**
  - Create `task/file-manager-integration` from `main`.
  - Run `git merge --no-commit --no-ff a4a09d84`.
  - Remove from the result:
    - `nter-mobile/`;
    - the four branch migrations (`supabase/migrations/20261115000001_*`, `20261118000001_*`, `20261121000001_*`,
      `supabase_dashboard_storage_setup.sql`);
    - `docs/screenshots/`, `docs/qa/screenshots/` and the other image files the branch adds;
    - the mobile-app-only reports (`F346-*`, `VISUAL-REFINEMENT-*`, `RECOMMENDED-PRODUCTION-REMEDIATIONS.md`,
      `MOBILE-*`).
  - Acceptance:
    - `git diff main -- supabase/migrations` is empty;
    - nothing is under `nter-mobile/`;
    - no added file is over 1 MB.
  - Verify: `git diff --stat main`, and a `find` for large files.
  - Files: the merge index only. **Size:** M, mechanical.
- [x] **Task 2: Resolve the code conflicts.**
  - Resolve:
    - `supabase/functions/_shared/retrieval.ts` and `retrieval_test.ts`: keep `main`'s F369 web-text path and add the
      branch's private-file path beside it;
    - `src/ai/AiPanel.jsx`;
    - `src/shell/TerminalShell.jsx`;
    - `src/shell/liveTv.css`;
    - `scripts/build-terminal-styles.mjs`;
    - `src/shell/LiveTvModal.jsx`: `main` deleted it (F359). Port the branch's 13 lines into the Live TV page if they
      are the phone layout's, else drop them, and say which.
  - Acceptance: no conflict markers remain, and each file keeps both sides' intent.
  - Verify:
    - `npm run build`;
    - `npm run lint`;
    - `deno test -A --config supabase/functions/deno.json supabase/functions/_shared`.
  - **Size:** M (6 files).
- [x] **Task 3: Resolve the tracker conflict and renumber the branch's items.**
  - Merge `docs/plans/open-work.md`, keeping `main`'s list.
  - Renumber the branch's items:
    - F341 (the file manager) becomes F419;
    - F342 and its phases (the website's phone layout) become F420;
    - F343 to F346 (the `nter-mobile/` app) are folded into one deferred item, F421, which points at the contributor's
      branch.
  - Close F418's sub-steps as they land. Move the next free number to F422.
  - Acceptance: no duplicate F numbers.
  - Verify: a script that counts each `**F<n> —` heading in `open-work.md` and `open-work-done.md`.
  - **Size:** S (1 file).
- **Commit:** Tasks 1 to 3 land as one merge commit, authored as the developer, with a message listing what was left out
  and why.

### Checkpoint 1

- [x] `npm run build` and `npm run lint` pass. Test failures at this point are expected and listed for Phase 2.

### Phase 2: Tests green

- [x] **Task 4: Fix the two failing Deno tests.**
  - `prompt_test.ts`: expect the widened attachment-safety wording.
  - `document-file/handler_test.ts`: expect 60 seconds for private links, matching `SIGN_SECONDS_PRIVATE`.
  - Acceptance: the code is unchanged, and each test asserts the deliberate behaviour.
  - Verify: Deno for `supabase/functions` gives 0 failures.
  - **Size:** S (2 files).
- [x] **Task 5: Re-point the storage and lifecycle fixtures.**
  - The fixtures: `user_files_isolation`, `user_files_lifecycle`, `user_files_storage_lifecycle`,
    `user_files_priority3_storage_api`.
  - Chain them to `file_manager_credit_fixes`' chain, which ends at F413, instead of the branch migration.
  - Keep `bootstrap_storage.sql`'s 7 added lines only if a fixture needs them, and only if `main`'s fixtures still pass.
  - Acceptance:
    - each fixture passes, and each passes its vacuity check;
    - expectations `main` changed (F410 owner-only storage figures, F412 anon refused) are updated and listed.
  - Verify: `./supabase/tests/run.sh` with those four fixtures and `file_manager_schema`.
  - **Size:** M (`run.sh` and four fixtures).
- [x] **Task 6: Re-point the retrieval and ingestion fixtures.**
  - The fixtures: `user_files_retrieval`, `user_files_ingestion_rag`, `user_files_reliability`.
  - Same rules as Task 5.
  - Expectations `main` changed: one active job per file, settling once per attempt, and a running job not cancellable
    (F413).
  - Verify: `run.sh` with those three fixtures and `file_manager_credit_fixes`.
  - **Size:** M.
- [x] **Task 7: Re-point the quota fixture.**
  - The fixture: `user_files_quota_complete`, with `bootstrap_entitlements.sql`.
  - Chain `main`'s plan migrations (signup persona, plan entitlements, INR plans), then F410 to F413.
  - Acceptance: it passes with its vacuity check, and the chain's runtime is reported (F302 watches the SQL job's
    length).
  - Verify: `run.sh user_files_quota_complete`.
  - **Size:** S to M.

### Checkpoint 2

- [x] Every suite passes locally:
  - `npm ci`, `npm run build`, `npm run lint` (0 warnings), `npm test`, `npm run test:scripts`;
  - the router import and Deno;
  - `./supabase/tests/run.sh`, all fixtures with their vacuity checks.

### Phase 3: Scope fixes

- [x] **Task 8: Drop the dev-only sign-in bypass, and hide Cancel for running jobs.**
  - In `src/App.jsx`, restore `main`'s `setAuthed(false)` path (spec decision 3). Keep the branch's
    forgot-password and reset-password route change.
  - In `src/fileManager/DriveJobsDrawer.jsx`, show Cancel only for queued jobs (F415, part 2). Add a test that a running
    job has no Cancel button.
  - Acceptance: the new test fails before the change and passes after.
  - Verify: `npm test`, `npm run lint`.
  - **Size:** S to M (3 files).
- [x] **Task 9: Check the Edge Functions against the current client.** Read-only, with a test where one is missing.
  - Diff the four touched functions against `main`. Confirm that each existing request shape still gives the same
    response:
    - `research-chat` without private file ids;
    - `document-file` with a corpus `document_id`;
    - `ingest-worker` with no user-file jobs.
  - Add one Deno test per function for the old shape if none covers it.
  - Acceptance: the current client is unaffected by deploying the new code. If not, the release order changes to merge
    first, and the plan is updated.
  - Verify: Deno.
  - **Size:** M.
- [x] **Task 10: Docs.**
  - Rename the branch's ADR to `docs/decisions/0016-private-file-manager-ingestion-rag-integration.md` and fix links to
    it.
  - Give each included branch document a status line (Historical, dated), as AGENTS.md requires.
  - Point the branch's F341 to F346 mentions at the new numbers.
  - Acceptance: every relative link resolves, and every included document declares a status.
  - Verify: the link-check script used in #246; `npm run test:scripts`.
  - **Size:** M (many small edits, docs only).

### Checkpoint 3

- [x] Checkpoint 2's commands pass again.
- [ ] Push `task/file-manager-integration`. Push and PR are covered by this plan's approval.
- [ ] Both required CI jobs pass on the head.

### Phase 4: Review and release (each step needs the developer's yes)

- [x] **Task 11: Check the Vercel preview at runtime** (`niyantran-git-task-file-manager-integration-ddl-labs.vercel.app`).
  - Signed out, at desktop and phone width (390 px): `#/files` and the picker are unreachable. I can do this.
  - Signed in: upload, browse, trash, restore, empty trash, attach a file to a question, and open its citation.
  - This writes to NTER's `user-files` bucket, because previews use the production project. It needs a test account
    and the developer's yes, or the developer runs it.
  - Acceptance: every step works, or each failure is listed. The citation and attachment steps pass only after Task 12.
- [ ] **Task 12: Deploy the three Edge Functions from the PR head**, with a named yes for each:
  - `research-chat`, `document-file`, `ingest-worker`.
  - After each deploy: the function's version goes up, and one existing request works.
- [ ] **Task 13: Merge the PR** (the developer's yes). Then check `main`'s CI on the merge commit, and record the release
  in F418.

### Checkpoint 4 (V1 done)

- [ ] The spec's success criteria 1 to 7 are met.
- [ ] F418 is closed in `open-work-done.md` with the commits.
- [ ] The contributor has been told about the new workflow (the developer's step).

### After V1 (not in this plan; each is its own item)

- Turning indexing on: the `app_flags` row, plus `IS_INDEXING_BILLING_DEPLOYED`.
- F414: the declared file size.
- F415, part 1: the hold lapsing on a long job.
- F421: the `nter-mobile/` app's place.

## Progress (2026-11-28)

- **Phase 1:** the merge commit `7842dd37` (parents: `main`'s line and the contributor's `a4a09d84`) carries the
  exclusions and the 8 conflict resolutions. Also left out: two ingest-worker fixtures that look like a real company's
  documents (a GTPL PRD workbook and feature list), replaced by synthetic ones.
- **Phases 2 and 3** were done by four parallel task agents in separate worktrees (Deno, SQL fixtures, `src/`, docs);
  the supervisor reviewed and committed each. Findings beyond the plan:
  - **Retrieval order (fixed).** With no private files, the branch re-sorted results by similarity, which changed
    hybrid desks' fused order for every user. Main's order is now kept, with a test.
  - **AI panel notice (fixed).** Main's rule is that the switch to Attached announces nothing; the branch's file
    attach did, and now doesn't.
  - **Ask AI from the file manager (fixed).** It attached the file under the file manager's full-page overlay, so the
    user never saw the panel. The shell now closes the overlay without a hashchange, with a test.
- **Checks on the final tree:**
  - `npm ci`, build, lint (0 warnings), Vitest (560 files, 9,486 tests), script tests (141), router import and
    Deno (2,040) pass.
  - SQL: 68 of 107 fixtures pass locally, against `main`'s 60 of 99 on the same machine. The same 39 fail on both, from
    this machine's PostgreSQL 16 and pgvector (`MAINTAIN`, `halfvec`); CI runs 17. No vacuity failure, and all 8
    `user_files_*` fixtures also pass on `main`'s final state through F413.
- **Browser check (Task 11).** Run locally (`vite`, port 5179) against NTER with the developer's test account, since the
  Vercel preview needs team sign-in. Desktop and 390 px:
  - Signed out, `#/files` shows no file manager.
  - Signed in: upload, list, trash, restore and empty trash all worked.
  - Index for AI shows "Indexing Temporarily Unavailable", with no server call.
  - Ask AI attaches the file to the panel.
  - On a phone, the file manager opens from the bottom bar's Files button and fits the width. Cosmetic: the "Upload
    Here" button reaches the right edge.
  - The test file was removed afterwards, and the account's own file is untouched.
  - Not checked: a question about a private file and its citation, which need the new `research-chat` and
    `document-file` deployed (Task 12).
- **2026-11-28, renumbered.** `main` took F416 (a web-text queue item, #251) and F417 (the Live TV compact panel, #252)
  the same day, so this work's items became F418 (the integration), F419 (the file manager), F420 (the phone layout)
  and F421 (`nter-mobile/`). Commits before the renumbering use the old numbers.
- **2026-11-28, release.**
  - `ingest-worker` imported SheetJS from `node_modules/`, which a deployed function does not have. It now loads
    SheetJS's own build of the same version, and `_shared/imports_test.ts` fails on any import that leaves
    `supabase/functions/`.
  - `document-file` v11 was deployed through the Supabase MCP tool. The deployed source was read back and matches the
    repository. Two calls without a valid sign-in both got its 401 reply.
  - The developer chose to merge first. `research-chat` (v118) and `ingest-worker` (v20) are deployed later with the
    CLI. Until then, attaching a private file to a question and citing it do not work; the drive itself does.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A function change breaks the corpus path, for example `ingest-worker`'s handler or `retrieval.ts` shared by all chat | High | Task 9 tests the old request shapes before any deploy. Deno runs in CI. Deploy one function at a time, with a check after each. |
| The branch's fixtures fail on `main`'s chain in ways that aren't just changed expectations | Medium | Tasks 5 to 7 report each failure. A real defect in the contributor's code is fixed in its own commit and listed, or raised with the developer. It is never hidden by changing the test. |
| The quota fixture's plan chain makes the SQL job slower (F302) | Low | Report the time. Use stand-ins, as `bootstrap_file_manager_deps.sql` does, if it adds more than about a minute. |
| The contributor pushes to `file-manager` during the work | Low | The integration is pinned to `a4a09d84`. New commits are listed, and come in later as a pull request. |
| The preview check writes test files to NTER | Low | A dedicated test account, with the files removed afterwards through the UI's empty trash. This needs the developer's yes. |
| Dropping mobile-app-only docs loses context | Low | They stay on `origin/file-manager`, which the plan never changes. F421 points at them. |

## Open questions

1. **The preview check (Task 11):** will you run the signed-in part yourself, or give me a test account to use? I can't
   sign in as a real user from here.
2. **Release order:** deploy the functions first, then merge (recommended), or merge first and deploy straight after?
   This depends on Task 9's result.
