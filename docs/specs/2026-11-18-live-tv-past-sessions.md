# F360: Live TV past sessions

> **Status: Living.** Written 2026-11-18 from code read on branch `task/livetv-past-sessions` (based on `main` `3ce9999e`).
> Tracked as F360 in `docs/plans/open-work.md`. Builds on the [F344 spec](2026-11-15-live-tv-fact-check.md) and the
> [F359 spec](2026-11-18-live-tv-page.md). Not built.

Evidence marks: **read** = seen in this checkout (file:line); **executed** = run, with the date; **unverified** = neither.
Every code and migration reference below was opened and read on 2026-11-18. No SQL was run and no request was made
against the live project for this spec.

## Summary

- A signed-in user cannot see the verdicts of a finished fact-check session anywhere in the app. The panel shows only
  what the page holds in memory, and the page loses it when the user leaves.
- The database already lets a signed-in user read their own sessions and claims, and delete their own settled
  live-stream sessions. No new table, policy, grant or function is needed.
- A "Past sessions" section is added to the Live TV page (`#/livetv`), below the player and the fact-check panel.
- The section lists the user's settled sessions, newest first. Opening a row shows its claims in spoken order, read-only.
- A user can delete a live-stream session after a two-step confirmation. Recorded-video sessions cannot be deleted here.
- Browser-only. No migration, no Edge Function change, no change to prices, flags or the fact-check logic.

## Problem

- **Results disappear.** A finished session's verdicts are kept on the server (F344 L10, L23: "Saved results are kept until
  removed"). The browser has no way to show them again except, for a recorded video, the shared-results view. A user
  who wants to look back at a live session has no place to do it.
- **The owner asked for the history.** The F344 success item 6 says "a live session appears in the user's history"
  (`docs/specs/2026-11-15-live-tv-fact-check.md:75`, read). No history screen was built for it.
- **Deletion has no interface.** L23 says a user can delete their own live-stream sessions. The delete policy exists
  (below) but nothing in the browser calls it.

## Current state (read)

Read from code. Nothing here was executed. Every point is a reading, not a run.

**Database (read, not executed).**

- Table `public.factcheck_sessions` (`supabase/migrations/20261116090000_factcheck.sql`, table block from line 74). Columns
  used by this feature: `id`, `user_id`, `video_id`, `channel_id`, `video_kind` (`live` or `recorded`), `start_position_s`,
  `minutes_bought`, `credits_charged`, `minutes_used`, `started_at`, `ended_at`, `status` (`active` or `settled`).
  The channel is stored as `channel_id` only. No channel name column exists (`:78`).
- Table `public.factcheck_claims`: `id`, `session_id`, `user_id`, `video_id`, `video_kind`, `position_s`, `spoken_at`,
  `quote`, `claim_en`, `claimant`, `reported_by`, `kind`, `status`, `verdict`, `reason`, `sources` (jsonb, at most 8),
  `checked_at`, `supersedes` (uuid, the row this one re-checks). The foreign key `factcheck_claims_session_user` cascades
  from the session on delete.
- Row-level policies (`20261116090000_factcheck.sql`, section 2):
  - `factcheck_sessions_select`: `user_id = auth.uid()`.
  - `factcheck_sessions_delete`: `user_id = auth.uid() AND video_kind = 'live' AND status = 'settled'`.
  - `factcheck_claims_select`: `user_id = auth.uid()`.
  - There is no claims delete policy and no claims delete grant. A claim leaves only through its session's cascade.
- Grants: `GRANT SELECT, DELETE ON public.factcheck_sessions TO authenticated` and `GRANT SELECT ON
  public.factcheck_claims TO authenticated` (same file, section 2).
- The later migrations (`20261116110000_factcheck_recheck.sql`, `20261117090000_factcheck_sharing.sql`,
  `20261118090000_factcheck_fail_reason.sql`) add columns with `ALTER TABLE` and change no policy on these two tables.
  Searched for `DROP POLICY` on the factcheck tables: none found (**read**).
- Columns added later to `factcheck_claims`: `recheck_credits` (`20261116110000_factcheck_recheck.sql:65-66`), `shared`
  and `hidden_at` (`20261117090000_factcheck_sharing.sql:71-72`), `fail_reason` (`20261118090000_factcheck_fail_reason.sql:29`).
  Sessions gained `shareable` (`20261117090000_factcheck_sharing.sql:70`).
- `hidden_at` is set only by `public.factcheck_claim_hide`, which is limited to platform administrators
  (`20261117090000_factcheck_sharing.sql:505-513`). The shared-results view and its counts read `hidden_at`
  (`:361`, `:377`, `:489`). The owner's own row policy does not read `hidden_at`, so an owner's direct read returns hidden
  rows too.
- `supersedes` is read by the shared-results view (`:377`, `:489`). The owner's own row policy does not filter it, so a
  direct read returns the old rows of a re-checked claim too.

**Browser: Supabase client (read).**

- The one browser client is created in `src/lib/supabaseClient.js`, with the public URL and publishable key (env values
  first, then built-in fallbacks), `persistSession` on in the window, and `autoRefreshToken` on. The file exports
  `supabase` and `accessToken()`.
- Fact-check server calls do not read tables. `src/lib/factcheck/client.js:4` imports `accessToken` and `functionsUrl`,
  and sends the session token to the `factcheck` Edge Function.
- The feature flag is read with the same client: `readFactCheckFlag` in `src/shell/factcheck/factCheckFlag.js:47` reads the
  public `app_flags` row `livetv_factcheck` with `client.from('app_flags')`. The result `available` is the gate the
  fact-check button uses. D3 uses the same value.
- No file under `src/` other than tests names `factcheck_claims` or `factcheck_sessions` (**read**). The past-sessions view
  would be the first browser code to read these two tables directly.

**Browser: the panel and the claim card (read).**

- Live TV page: `src/shell/LiveTvPage.jsx`. It imports `FactCheckEntry` and `FactCheckPanel` from
  `src/shell/factcheck/FactCheckPanel.jsx` (`:9`) and `useFactCheck` (`:11`). The panel is mounted at `:558` in the
  page body.
- One claim is drawn by `function Card` in `src/shell/factcheck/FactCheckPanel.jsx:288`. The card is not exported.
  The list is drawn by `function Claims` (`:324`), which is also not exported. The list is reversed, so the newest claim
  is first (`:327-333`). Reuse for D5 means exporting these two functions or moving them to `FactCheckParts.jsx`. Which
  one is the better choice is not decided here.
- In a live session the claims come from `src/lib/factcheck/session.js` (a `Map` keyed by claim id, `:146`, copied out
  at `:178`). The browser does not filter `supersedes` or `hidden_at` on that list.
- Re-checks: the controller keeps them in memory per page (`src/shell/factcheck/factCheckController.js:61`, copied at
  `:84`). The card shows the chain as the newest result with the older ones under "Earlier" (`FactCheckPanel.jsx:288-300`
  and the `Earlier` component). The chain is built in the browser during the session. Nothing reads it back from the
  server.
- Hidden claims: the browser has no concept of `hidden_at` for the owner's own claims (**read**; no reference in
  `src/`, excluding tests). The `reported` and `shared` flags are shown by the card (`FactCheckPanel.jsx:~305`), not
  `hidden_at`.
- Panel height (F359 layout, read): the base panel has `max-height: min(600px, 75vh)` (`src/shell/factcheck/factCheck.css:12`).
  From 1100 px the page overrides it (`src/shell/liveTv.css:33`), and the page body is a size container
  (`src/shell/liveTv.css:40-43`). The panel's height is `calc(100cqh - 32px)` (`src/shell/liveTv.css:55`). The F359
  spec and the F349 record name a `min(640px, calc(90vh - 152px))` rule in `factCheck.css`; that rule is not in this
  checkout (searched 2026-11-18), so it is not used here.
- Text: `src/shell/factcheck/factCheckText.js` holds the user-facing strings (`END_REASONS`, verdict labels, status labels).
  `VERDICTS` (`:13`) has the five labels used on the card. `claimBadge` (`:39`) turns a claim into its badge, and treats
  a checked claim with an unknown verdict as a failed check.
- The end reason for `modal_close` is "You left Live TV." (`factCheckText.js:106`), per F359.

**Not established.**

- Whether a settled session with no claims can exist. The schema allows it (`factcheck_claims` rows are optional).
- How a superseded row and its replacement are ordered when they have the same `spoken_at`. The schema has no
  unique key that orders them.
- Which channel names the page knows for a `channel_id`. The page has `activeChannel?.id` (`LiveTvPage.jsx:288`), but the
  full name mapping was not traced.

## Decisions

These are the decisions for this change. Each one is final unless the owner changes it.

- **D1. Browser-only.** No migration and no server function change. The existing policies already let a signed-in user
  read their own sessions and claims and delete their own settled live-stream sessions.
- **D2. Place.** A "Past sessions" section on the Live TV page (`#/livetv`), below the player and the fact-check panel.
  No new route.
- **D3. Gate.** The section is shown only to users for whom the fact-check flag is on (`available` from
  `readFactCheckFlag`), the same gate as the fact-check button.
- **D4. List.** The user's settled sessions, newest first, 20 at a time with a "Show more" control. Running (active)
  sessions are not listed. Each row shows: start date and time in the viewer's local time, channel name, "Live" or
  "Recorded", minutes used, and credits charged.
- **D5. Detail.** Opening a row loads that session's claims in spoken order and shows each with its verdict, quote, claim,
  reason and sources, using the same drawing as the panel where practical. Read-only: no "Check again", no share and no
  report controls in version 1.
- **D6. Newest result only.** For a re-checked claim only the newest result is shown (the claim that no other claim in
  the same session supersedes). Hidden claims (`hidden_at` set) are not shown.
- **D7. Delete.** Only on live-stream sessions; the policy refuses recorded ones and the row for a recorded session
  has no delete control. A two-step inline confirmation: "Delete this session and its verdicts? This cannot be
  undone." with Delete and Keep. On success the row leaves the list. For recorded sessions the row says that results
  on recorded videos are kept. Deleting does not refund credits.
- **D8. States.** Loading, empty ("No past sessions yet."), load error with a "Try again" control, and delete error. No
  raw error text from the server is shown.
- **D9. Reload.** The list reloads when a session ends on the page.
- **D10. No transcript.** Live-stream sessions have no stored transcript (F344 L24: "Live-stream transcripts are held only
  while the session runs"). Only claims are shown. This is said once in the section.
- **D11. Code layout.** New code lives in new files under `src/shell/factcheck/`: a data module, a hook, a component, their
  tests, and CSS in `factCheck.css`. `LiveTvPage.jsx` only mounts the section. All user-facing strings go in
  `factCheckText.js`.

- **D12. Channel name.** The session row stores only `channel_id`. The row shows the name from the Live TV channel
  list the page has already loaded when the id is found there, and the id itself otherwise.
- **D13. Which result is shown.** Rows of one claim form a chain through `supersedes`; the first row is the original
  check and the others are re-checks. One row is shown per chain: the newest re-check whose status is `checked`
  (by `checked_at`, then `id`), or the original when no re-check succeeded. A failed or unfinished re-check never
  replaces a verdict. This is the rule the server uses for shared results. When the original is hidden the whole chain
  is hidden. The order of the list is the original's `spoken_at`, then `checked_at`, then `id`.
- **D14. Quote.** The card is drawn as the panel draws it, which shows the claim and not the quote. This replaces the
  word "quote" in D5.

## Open questions

- **OQ1. "Check again" on past claims.** Should a past claim offer "Check again"? Default: no, not in version 1. The
  re-check costs credits and uses the live-session price rules, which were not designed for a finished session.
- **OQ2. Admin view of other users' sessions.** Should an administrator see other users' sessions here? Default: no.
  That belongs to the admin screen for reports, not to this section.
- **OQ3. Hidden claims for the owner of the session.** D6 hides claims an administrator hid, also from the user whose
  session produced them. Default: hidden, because a claim is hidden when its result should not be shown. The owner can
  change this.

## Out of scope

- Re-analysing a block, the admin screen for reports, export, search and filter.
- Transcripts for live-stream sessions (D10).
- Any database, policy, grant or Edge Function change, and any deploy.
- Changes to prices, session lengths, sharing, the fact-check logic and the Live TV server API.

## Acceptance evidence

Each item must be shown before this change counts as done. Record the command and the result.

- **Data module tests** (query shape, paging, error mapping, delete). Each test seen failing first, then passing:
  - the session list query selects only the user's own settled sessions, orders by start time, and pages 20 at a time;
  - the claims query is for one session and is capped at 500 rows, and the cap is reported when reached;
  - superseded rows and hidden rows are removed, and the newest result of a chain is kept (D6);
  - a database error maps to the load-error state and shows no raw text;
  - the delete call targets one session id and reports success or failure; a recorded session is never sent.
- **Hook tests**: loading, empty, error, retry, the reload when a session ends (D9), and no state change after unmount.
- **Component tests**: rows show the fields in D4; a row opens and shows claims in spoken order; no "Check again",
  share or report control is drawn (D5); the delete confirmation has two steps and Keep leaves the row; a recorded
  session has no delete control and shows the kept-results text; with the gate off, nothing is rendered (D3).
- **A test that superseded and hidden claims are filtered** (D6), and a test that proves it fails when the filter is
  removed.
- **Gates, all passing:** `npm run lint`, `npm run build`, `npm run check:bundle`, `npm test`.
- **Layout measured in a browser** at 1280 px, 1099 px and 390 px, on a static page built from the real stylesheets, as
  F359 did. The section must not change the fact-check panel's height. No sideways page scroll at 390 px.
- **Not verifiable by automation:** a signed-in view against real sessions, including the row policy behaviour. The row
  policies are read, not executed, until a signed-in user sees them work. The owner or the supervisor must check this
  against a real settled session, and against a recorded one, after release.

## Risks

- **Layout.** The page body is a size container (`src/shell/liveTv.css:40-43`). The new section must sit outside the
  panel's height, or the panel's height changes. The layout measurement above guards this.
- **Many claims.** A long session can hold many claims. The claims fetch is capped at 500 and the cap is said in the
  section if reached. A session with more than 500 claims shows the first 500 in spoken order and says so.
- **Access.** The claims fetch relies on the user's own row-level access. Nothing may be requested for another user's id.
  Every query filters by the signed-in user's id and by the policy.
- **Direct table reads are new in the browser.** This is the first browser code that reads `factcheck_sessions` and
  `factcheck_claims`. Errors must map to the error state and must not leak server text.
- **Deletion is permanent.** The confirmation text must say so. Deleting does not refund credits.
- **Shared-results rules are not shown here.** A recorded session's shared results are a separate view and are not
  changed by this section.

## Release

- Browser-only. Merging to `main` deploys it.
- No migration, no Edge Function deploy, no change to prices or flags.
- The merge needs the owner's approval (AGENTS.md; F344 L22).
- Rollback is a revert of the merge. No server rollback is needed.

## Plan

One branch, `task/livetv-past-sessions`, tasks in order. Each task agent leaves its work uncommitted. The supervisor
reproduces the gates and makes the commits. File names below are proposed; the build may adjust them within its scope.

1. **T1 Data module and tests.** Queries for the session list (settled, own, paged 20) and for one session's claims
   (cap 500); the newest-result filter (D6); error mapping; delete of a live-stream session. Write scope:
   `src/shell/factcheck/pastSessions.js`, `src/shell/factcheck/pastSessions.test.js`. Verify:
   `npx vitest run src/shell/factcheck/pastSessions.test.js`.
2. **T2 Hook and tests.** Loading, empty, error and retry states; reload when a session ends (D9); paging and opening
   a row. Depends on T1. Write scope: `src/shell/factcheck/usePastSessions.js`,
   `src/shell/factcheck/usePastSessions.test.js`. Verify: `npx vitest run src/shell/factcheck/usePastSessions.test.js`.
3. **T3 Component, text and CSS, with tests.** The section, rows, detail (drawing the claim card by exporting or moving
   the existing card, see Current state), the delete confirmation, states and the recorded-session text. All strings in
   `factCheckText.js`. Depends on T2. Write scope: `src/shell/factcheck/PastSessions.jsx`,
   `src/shell/factcheck/PastSessions.test.jsx`, `src/shell/factcheck/factCheckText.js` (new keys only), and
   `src/shell/factcheck/factCheck.css` (new rules only). If the card is moved or exported, `FactCheckPanel.jsx` and
   `FactCheckParts.jsx` are added to the scope. Verify:
   `npx vitest run src/shell/factcheck`.
4. **T4 Mount and wiring.** Mount the section on the Live TV page below the panel, gated by D3, and wire the reload on
   session end. Depends on T3. Write scope: `src/shell/LiveTvPage.jsx`, and a wiring test under
   `src/shell/factcheck/` (for example `LiveTvPage.past.wiring.test.jsx`). Verify: the wiring test and the existing
   `src/shell/factcheck/LiveTvPage.wiring.test.jsx`.
5. **T5 Gates and layout.** Run `npm run lint`, `npm run build`, `npm run check:bundle` and `npm test`. Measure the layout
   at 1280, 1099 and 390 px as in F359. Record every command and result. No source edits in this task, except a fix
   that the supervisor approves. Verify: the four gates above.

Each task's verification is run by the task agent for its own files and again by the supervisor for the whole change.

## Build record (2026-11-18)

Built on `task/livetv-past-sessions` by a task agent, reviewed independently, fixed, and reproduced by the supervisor.

- **Files.** New in `src/shell/factcheck/`: `pastSessions.js`, `usePastSessions.js`, `PastSessions.jsx`, their tests,
  `pastSessionsFake.js` (test support) and `LiveTvPage.past.wiring.test.jsx`. Edited: `factCheckText.js` (new
  `PAST_TEXT`), `FactCheckPanel.jsx` (the claim card is exported, no behaviour change), `factCheck.css`,
  `LiveTvPage.jsx`.
- **One addition to the plan.** `LiveTvPage.jsx` wraps the body and the new section in `.ltv-main`. With the section
  present the wrapper scrolls; with the flag off the wrapper changes nothing.
- **Review.** Accept with fixes, nothing critical. Fixed: the result rule (D13; a failed or unfinished re-check
  replaced the verdict, and a hidden original could come back through its re-check), "Show more" staying disabled
  after a reload, a repeated row across pages, a second delete started while one was running, kept results not
  refreshed after a reload, the section not reset when the account changes, errors not announced, and the layout with
  the panel closed.
- **Executed.** `npm run lint` clean; `npm run build` passes; `npm run check:bundle` ok (121,676 bytes gzip);
  `npm test` 490 files, 8,245 tests pass. The task agent reported each rule's test failing with the rule removed;
  the supervisor did not repeat those runs.
- **Layout, measured on a static copy of the page (800 px high).** At 1280 px with the panel open, the player
  (900 by 558) and the panel (350 by 657) are the same with and without the section, and the section is reached by
  scrolling the page. With the panel closed, and at 1099 and 390 px, the body flows and the section follows it. No
  sideways scroll at any width.
- **Not verified.** The section inside the signed-in app, the row-level policies against the live database, and a
  delete of a real session. Edge Function tests were not run because nothing under `supabase/` changed.
- **After release (2026-11-18).** Seen signed in on the live site: 14 settled sessions listed, an opened session showed
  its results, no console errors. Every collapsed row showed its own Delete button, so D7 is amended: the Delete
  control and the recorded-video note appear only inside an opened session, below its results, in every detail state;
  closing the row drops an unanswered confirmation. `npm test` 8,249 pass, lint, build and bundle check pass.
