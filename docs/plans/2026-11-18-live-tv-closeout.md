# Live TV fact-check: close-out plan

> **Status: Living (2026-11-18).** Orders the work that closes the remaining functional gaps of the Live TV fact-check
> (F344 and its family). It follows the [spec](../specs/2026-11-15-live-tv-fact-check.md), the
> [past sessions spec](../specs/2026-11-18-live-tv-past-sessions.md) and the [page spec](../specs/2026-11-18-live-tv-page.md).
> The only list of open work is [open-work.md](open-work.md). Nothing here changes production without the owner's named
> approval at the time.

## Purpose

Close every remaining functional gap of the Live TV fact-check before a separate UI and UX pass. That pass is out of
scope here. Sharing of results on recorded videos stays off until the last step of this plan.

## Roles and approvals

- The supervisor coordinates the items, reviews each change against its spec and reproduces the checks.
- Task agents build inside their write scope and leave their work uncommitted.
- An independent reviewer checks each change. The reviewer gets the code, the data and the rules, not the writer's
  conclusions.
- The owner approves each merge to `main`, each migration on the live database and each function deploy, by name, at
  the time it is needed. Each production step also needs the owner's exact prior authorization under `AGENTS.md`.

## Decisions of 2026-11-18

Recorded verbatim from the owner:

1. Offer 20 and 30 minute sessions.
2. Switch sharing of results on recorded videos on, as the last step, after everything else in this plan is merged and passes.
3. The price of "Check again" stays (100 credits).
4. One past session of the admin test account may be deleted to prove delete on real data.
5. Unsteady verdicts (F352): the owner asked for a recommendation before deciding.
6. Build the unbuilt pieces and close the leftovers; UI/UX of the Live TV page is a separate later discussion.

Not decided, so unchanged: the audience stays admin-only.

## Current state

Read from the repository, not executed, unless a line says otherwise.

- **Sharing.** Migration `20261117090000_factcheck_sharing.sql` added the sharing tables and functions. Sharing reads
  the flag row `livetv_factcheck` through `private.factcheck_share_flag()`. It is on only when the key `share_recorded`
  is exactly `true` and `unlock_credits_per_minute` is a number above 0 and at most 1000. Both keys are unset today,
  so sharing is off (F344 entry in open-work).
- **Admin functions that exist.** `factcheck_claim_hide`, `factcheck_report_dismiss` and `factcheck_video_remove` refuse
  any caller who is not `public.is_platform_admin()` (migration lines 507 to 549). `factcheck_report` lets a signed-in
  user report a claim.
- **No admin read of reports.** `public.factcheck_reports` has one select policy, for the reporting user's own rows
  (migration line 134). `public.factcheck_claims` has a select policy for the owner only
  (`20261116090000_factcheck.sql` line 157). No function or policy found lets an administrator list reports, counts or
  claim text. This is a gap, not a hidden feature. "Not established" whether another path exists outside the
  repository.
- **Session lengths.** Migration `20261119090000_factcheck_session_lengths.sql` widened the rule to 1, 2, 5, 10 and 15
  minutes. It has a drift guard, a rollback note and a release order. Its fixture is `supabase/tests/factcheck_lengths.sql`.
- **Where the minute lists live.** Today the allowed list is 1, 2, 5, 10 and 15 in four places: the table CHECK
  `factcheck_sessions_minutes_bought_check` (set by the 2026-11-19 migration), the test in `public.factcheck_start`
  (`p_minutes NOT IN (1, 2, 5, 10, 15)`), `SESSION_MINUTES` in `supabase/functions/factcheck/start.ts` line 8, and
  `MINUTE_CHOICES` in `src/shell/factcheck/factCheckText.js` line 5. The function also has two error messages with the
  list as text (`start.ts` lines 104 and 158). The 2026-11-19 migration says the list in the database is 1, 2, 5, 10 and 15.
- **The 20 and 30 minute lengths are not allowed today.** The database refuses them, the function refuses them and the
  browser does not offer them.
- **Per-user and per-session limits.** Per user and calendar minute: transcribe 10, extract 6, check 20 (migration
  `20261116090000_factcheck.sql`, header lines 47 to 48). Per session, the budget is extract at most 3 times the
  minutes plus 2 and check at most 8 times the minutes plus 4 (same header, lines 49 to 50; spec line 208). The
  per-minute limits do not grow with the session length.
- **The hold.** `public.factcheck_start` holds minutes times the price per minute, and refuses when the balance less
  the open holds is short. At 500 credits a minute: 1 minute 500, 5 minutes 2,500, 15 minutes 7,500, 20 minutes 10,000,
  30 minutes 15,000 credits.
- **Re-check.** The re-check of one verdict is built (F344 entry, pull request 154). Re-analysis of a block is not built
  (F344 entry; spec line 97 and line 501).
- **Unsteady verdicts.** F352 measured 13 of 40 claims unsteady over three runs. Two cheap remedies and five other
  designs were tested and none passed the rule (F352 entry). Results are recorded in open-work; raw replies are kept
  outside the repository.
- **Live TV page and past sessions.** The page is merged (pull request 176). Past sessions are merged (pull request 178,
  `d8404a42`). Deleting a settled live-stream session has an interface. A recorded session has no delete control. The
  database policy `factcheck_sessions_delete` allows only `video_kind = 'live'` and `status = 'settled'` (past sessions
  spec, lines 19 and 48). Claims leave only through the cascade (past sessions spec, line 50).
- **Streaming transcription.** Blocked on a provider key. The Edge secrets hold OpenRouter and Mistral keys only
  (spec line 56). The spec defers the streaming test until a key exists (spec line 88).
- **Unit of the credit hold.** The spec says 1 credit is 1 paisa (spec line 203). Another decision record gives 1 credit
  as 10 paise. That record is not in this repository. "Not established" which one applies; the hold in rupees depends on it.

## Order and dependencies

Work runs one item at a time, in this order. Items W5 and W7 do not block the others.

1. **W1** Delete proof on real data. No code. The owner or the owner's signed-in browser runs it.
2. **W2** Session lengths 20 and 30 (F361). Migration first, then the function, then the browser.
3. **W3** Admin screen for reports (F362). Must be merged and released before W8.
4. **W4** Re-analyze a block (F363). Starts with its own spec. Not built in this plan.
5. **W5** Unsteady verdicts (F352). Step 1 is reference answers, which needs no model calls. No build until the owner decides.
6. **W6** Owner-only checks. Each needs the owner present. The browser refuses tab sharing without a person.
7. **W7** Streaming transcription. Waits for the owner to supply a key.
8. **W8** Switch sharing on. Last. See the precondition below.

The sharing switch is the last step by the owner's decision 2. Read literally, "everything else in this plan" includes
W4, W5 and W7. Two of those depend on the owner or on a key, so W8 may wait a long time. This is recorded in "Points to
settle" and not resolved here.

## Work items

### W1. Prove delete on real data (existing entry F360)

- **Goal.** Show that one settled live-stream session can be deleted through the page, with its claims.
- **Current state.** The delete is built (past sessions spec). The owner has not yet run it on a real session (F360
  entry). Decision 4 allows one session of the admin test account.
- **What changes.** Nothing in code. A read-only count before and after, and one delete through the page.
- **Write scope.** None.
- **Acceptance evidence.** Session count before and after (one fewer). The session row is gone. Its claims are gone
  (cascade). The page shows the row leaving the list. Record the session id and the times in the F360 entry.
- **Owner approval.** The owner names the session before the delete. Decision 4 is the general permission. The
  delete is permanent. "Not established" whether a backup can restore a deleted row.
- **Rollback.** None for the deleted row. A deleted session cannot be restored by this plan.

### W2. Session lengths of 20 and 30 minutes (new finding F361)

- **Goal.** Offer 20 and 30 minute sessions, as decision 1 asks.
- **Current state.** Not allowed in the database, the function or the browser (see Current state).
- **What changes.**
  - Database: a new migration written like `20261119090000_factcheck_session_lengths.sql`. It replaces the CHECK on
    `factcheck_sessions.minutes_bought` with 1, 2, 5, 10, 15, 20 and 30, and replaces `public.factcheck_start` with the
    same signature, defaults, grants and settings. Its drift guard accepts the current function text
    (md5 `99e26d189732eaa59fca231db435bbfa`) and refuses anything else with code 55000. A second run is a no-op. It
    carries a rollback note. The rollback can narrow the CHECK again only while no 20 or 30 minute row exists.
  - Server function: `SESSION_MINUTES` and the two error messages in `supabase/functions/factcheck/start.ts`.
  - Browser: `MINUTE_CHOICES` in `src/shell/factcheck/factCheckText.js`. The panel must still show the price and the
    affordability of each choice.
- **Write scope.** The new migration file, `supabase/tests/` (a new fixture next to `factcheck_lengths.sql`),
  `supabase/functions/factcheck/start.ts` and its test, `src/shell/factcheck/factCheckText.js` and its test.
  Nothing else.
- **Release order.** Migration first, then the function, then the browser. The 2026-11-19 migration gives the same
  order and the reason for it.
- **Acceptance evidence.**
  - SQL fixture: 20 and 30 accepted; 25 refused; the drift guard refuses an unknown function text; a second run is a
    no-op. The fixture must fail when the migration is left out (the vacuity check in `npm run test:sql`).
  - Function tests (Deno): 20 and 30 accepted; 25 refused with `bad_minutes` and the new message text.
  - Browser tests: seven choices shown; the start button text names the new lengths and the price.
  - Hold check on the live path: a 30 minute start holds 15,000 credits; a balance below that is refused as
    `insufficient`.
  - Gates: `npm run build`, `npm test`, `npm run lint`, the Deno suite and `npm run test:sql`, as `AGENTS.md` requires for
    `supabase/` and `src/lib/`. Record each command and its outcome.
- **Spend and limits (read, not executed).** The per-minute limits do not change with length. The per-session budgets
  rise with the length: extract and check allowances are 62 and 164 for 20 minutes, and 92 and 244 for 30 minutes
  (today 15 minutes gives 47 and 124). The hold is 10,000 credits for 20 minutes and 15,000 for 30. The F350 entry
  asked for the owner's acceptance of the larger hold and worst-case spend. Decision 1 may or may not include that
  acceptance. "Not established" from the decision text.
- **Owner approvals needed.** Merge to `main`. The migration on the live database, named. The function deploy, named.
  The acceptance of the larger hold and worst-case spend, if the owner does not regard decision 1 as covering it.
- **Rollback.** Function: redeploy the previous version (version 5 from `bdad3eef`). Browser: revert the list. Database:
  the CHECK can be narrowed back to 1, 2, 5, 10 and 15 only while no row has 20 or 30 minutes. Once such a row exists,
  the wider CHECK stays, as the 2026-11-19 migration does (settled sessions are never deleted).

### W3. Admin screen for reports (new finding F362)

- **Goal.** An administrator can list reported claims with the reason and the count, hide a claim, dismiss a report and
  remove a video's shared results.
- **Current state.** The three admin write functions exist and are admin-only. There is no way for an administrator to
  read the reports. Reads of `factcheck_reports` and `factcheck_claims` are limited to the owner's own rows (see
  Current state). A browser screen alone is not enough. A read function is missing.
- **What changes.**
  - Database: one new admin-only read function (`SECURITY DEFINER`, `search_path` empty, refuses with 42501 unless
    `public.is_platform_admin()`), returning unhandled reports grouped by claim, with reason, count and the claim's
    video id. Grants as the existing admin functions have them. A SQL fixture that proves a non-admin is refused.
  - Browser: an admin screen that calls the new read function and the existing `factcheck_claim_hide`,
    `factcheck_report_dismiss` and `factcheck_video_remove`. Admin only.
- **Write scope.** One new migration, one fixture under `supabase/tests/`, and the admin area under `src/admin/`
  (`AdminApp.jsx` and its pages). "Not established" which admin page is the right home; the supervisor decides at dispatch.
- **Acceptance evidence.** A non-admin is refused (42501) by the new read function. An admin sees the seeded reports
  with counts. Hide, dismiss and remove each change the rows they should and nothing else. The fixture fails without
  the migration.
- **Owner approvals needed.** Merge. The migration on the live database, named. The release of the screen to the
  admin account.
- **Rollback.** Drop the new read function and the screen's route. The three existing functions are unchanged.

### W4. Re-analyze a block (new finding F363)

- **Goal.** Re-analyze a block of a recorded video at full price, so the newer result shows first and the older is kept.
- **Current state.** The spec describes it in one line: "re-analyze a block of a recorded video by replaying it at full
  price" (spec line 97), and as part of slice 3 (spec line 501). Not built (F344 entry). Build order puts it after the
  first live admin session (spec line 107).
- **What changes.** Nothing yet. This item starts with its own spec.
- **Facts read.** Re-analysis of a recorded block needs the stored transcript pieces. The database stores pieces only
  for a shareable session (the sharing migration header; `factcheck_piece_store` refuses `not_shareable`). So a
  re-analysis depends on sharing and on W8, unless the spec decides otherwise. "Not established" whether the spec
  allows a re-analysis of a live session.
- **Open questions for the spec.** The price (full block price is the spec's word; the exact figure is not set). How
  it counts against the per-session budget. What an unlock of a stretch becomes after a re-analysis. Whether the
  owner's "Check again" price (100 credits, decision 3) applies to it.
- **Write scope.** A spec file only, until approved.
- **Acceptance evidence.** An approved spec with the questions answered, then a plan.
- **Owner approvals needed.** The spec decisions, including any charge.
- **Rollback.** Not applicable until built.

### W5. Unsteady verdicts (existing entry F352)

- **Goal.** Choose a design for verdicts that vary between runs, as decision 5 requires.
- **Current state.** Measured and compared (F352 entry). No design passed the rule of at most 4 unsteady claims out of
  40. Nineteen claims are disputed between the designs (F352 entry), and the owner has to say which answer is right.
- **Step 1 (no build).** Two independent researchers write a reference answer for each of the 19 disputed claims. Where
  they disagree, the disagreements go to the owner. No model calls.
- **Step 2 (decision).** The supervisor writes a recommendation after step 1, as decision 5 asks. The owner then
  chooses: a stronger search model, a two-step design, pooled searches, or accepting the current behavior. Each has a
  measured cost and a measured failure (F352 entry).
- **What changes.** Nothing until the owner decides.
- **Write scope.** None for step 1. Step 2 is a separate plan.
- **Acceptance evidence.** Step 1: the reference answers, with each disagreement listed. Step 2: the owner's written
  choice.
- **Owner approvals needed.** The choice in step 2, and any cost it adds.
- **Rollback.** Not applicable.

### W6. Owner-only checks (existing entries F344, F347, F349, F350, F351, F359, F360)

These cannot be automated. The browser refuses tab sharing without a person, and each session charges credits at
500 a minute.

- A real session on the new Live TV page (F359, F360).
- A real 2-minute session (F350).
- The "No sources found" state, which no real session has shown (F349).
- Closing and reopening the panel during a session (F349, not tested).
- The usage screens with a real fact-check charge (F347).
- A manual run of audio-capture gate G1 (F344 entry: "a manual run is still owed").
- Afterwards, the supervisor reads the server log for `unusable` rows and for checks with more than one attempt (F351).
  The owner's decision on the price of "Check again" waits for that count, and decision 3 says the price stays.

Each run needs the owner. The results go into the entry each one belongs to, with the time and the session id.

### W7. Streaming transcription (existing entry F350 and spec L7 and L8)

- **Goal.** A streaming transcription test with a provider that can stream.
- **Current state.** Blocked. No streaming provider key is set (spec line 56).
- **What changes.** Nothing until the owner supplies a key. The key goes into the Edge secrets by the owner, never in a
  file, a `VITE_` variable or a log.
- **Write scope.** None until a key exists.
- **Acceptance evidence.** To be written when the key exists.
- **Owner approvals needed.** Supply of the key and the cost of the test.
- **Rollback.** Not applicable.

### W8. Switch sharing of recorded results on (last)

- **Goal.** Share results of recorded videos, as the spec describes (spec L11, L12, L25).
- **Exact change.** In the `livetv_factcheck` row of `app_flags`, set `share_recorded` to `true` and
  `unlock_credits_per_minute` to `100`. The price is the one the owner agreed on 2026-11-15 (spec line 105: 100 credits
  a minute; F344 entry). Nothing else in the row changes.
- **Effect (read).** The audience stays admin-only, so only admin accounts see the sharing. The share function
  returns off for anyone outside the audience.
- **Preconditions.** W3 merged and released. W6's real session done, or waived by the owner in writing. Decision 2's
  "everything else in this plan" (see Order and dependencies).
- **Acceptance evidence.** The flag read returns sharing on for an admin account and off for another. A recorded session
  can be marked shareable, and the listing shows its stretch to the admin. Recorded in the F344 entry.
- **Owner approvals needed.** The named approval at the time. The flag row is production; `AGENTS.md` requires the
  owner's exact prior authorization.
- **Rollback.** Remove both keys. The sharing check then returns off (the function reads `share_recorded` as exactly
  `true`). "Not established" what the owner sees for rows already shared while the flag is off, beyond the reads
  refusing them.

## Out of scope

- The UI and UX pass of the Live TV page. A separate discussion, after this plan (decision 6).
- Any audience beyond admin accounts. Unchanged (see Decisions).
- The price of "Check again" (100 credits), which stays (decision 3).
- Building the design chosen for W5. A separate plan once the owner decides.
- A streaming provider until a key exists (W7).
- Any change under `backup/`, `public/data/` or other data collections.

## Points to settle

These are conflicts or gaps found while writing. They are recorded, not resolved.

1. **Decision 2 and the rest of the plan.** "Everything else in this plan" includes W4, W5 and W7, which depend on other
   decisions or on a key (Order and dependencies). The supervisor's proposed reading, for the owner to confirm: W8
   waits for W1, W2, W3 and W6 only; W4, W5 and W7 do not hold it.
2. **Decision 1 and the F350 hold.** F350 holds 20 and 30 minutes "until the F349 fixes are proven". The F349 entry
   records two real sessions that were checked on 2026-11-17. Decision 1 now offers the lengths. Whether the hold is
   lifted is recorded as the owner's decision, not as a proof.
3. **Whether decision 1 includes the spend acceptance** that F350 asks for (W2).
4. **F360 box.** The F360 entry in `open-work.md` is unchecked, but pull request 178 is merged (`d8404a42`).
5. **F344 entry, re-check.** The F344 entry says the re-check of one verdict was "merged 2026-11-16" (pull request 154)
   and, later in the same entry, "built on `task/f344-recheck`, not merged".
6. **F344 entry, "not built" list.** It still lists the past-sessions view as not built. That view is built (F360).
7. **Credit unit.** The fact-check spec says 1 credit = 1 paisa (line 203). The tracker's credits decision says
   1 credit = 10 paise of AI cost (`open-work.md`, credits section). The tracker is the later record, so the spec line
   is out of date: a 30-minute hold of 15,000 credits is 1,500 rupees.
8. **Spec build order.** Spec line 107 says sharing, unlock and re-analyze are built after the first live admin
   session. Sharing and unlock are already built (F344 entry). The spec and the entry describe the same thing in
   different words; no decision follows from it here.
9. **Stale spec lines.** The spec says "5, 10 or 15 minutes" at lines 26, 70 and 93 (L13). The release of the five
   lengths (F350) changed the list, so these lines are out of date.
10. **Error text in the function.** The function's message "minutes must be 1, 2, 5, 10 or 15." (`start.ts` lines 104
    and 158) is a fourth place the list appears (W2 covers it).

## Findings used

- F344 (family): the Live TV fact-check. Open items as above.
- F347, F349, F350, F351, F352, F359, F360: existing entries, see W1 to W8.
- F361: session lengths of 20 and 30 minutes (W2).
- F362: admin screen for reports (W3).
- F363: re-analyze a block (W4).
