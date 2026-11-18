# F363: Live TV fact-check — re-analyze a block

> **Status: Living.** Written 2026-11-18 and rewritten the same day after the owner's decision. Not built.
> Builds on the [F344 spec](2026-11-15-live-tv-fact-check.md) and the [sharing plan](../plans/2026-11-16-f344-sharing.md).
> Tracked as F363 in [open-work](../plans/open-work.md) (line 3735). Plan item: W4 in [the closeout plan](../plans/2026-11-18-live-tv-closeout.md).

Evidence marks: **read** = seen in this checkout (file:line). **not established** = neither read nor run. Nothing was
run against the live project, no SQL was run, and no audio was processed for this spec. Code paths are from the branch
after merging `origin/main` (migrations to `20261121090000`).

## Summary

- Re-analyzing a block is an ordinary fact-check session on the same recorded video. It starts at the block's start for
  the block's length, is transcribed and checked from the audio, and is priced and limited like any session.
- The newer result is shown first. The older one stays visible, marked as an earlier analysis with its date.
- The owner's decisions are in the Decisions section. This spec shows that the browser can do the work without a new
  database object, so the first release is browser-only. Two browser gaps must be closed: the player cannot seek today,
  and the start screen cannot take a preferred length from outside.

## Problem

- A wrong verdict on a recorded video reaches every user who unlocked it. Today the only fix is to re-check one claim
  (100 credits). A whole block cannot be checked again, for example after a better check method exists.
- Verdicts on the same claim can differ between runs (open-work F352: 13 of 40 claims were unsteady over three runs).
  A second full run lets the owner and users see that and keep the better result.
- Without a rule, a new run would either hide the old result (users who paid for it would lose what they bought) or leave
  two results with no order. The Decisions set the rule.

## Current state (read)

### What the server returns per stretch

The newest definition of `public.factcheck_video_view(uuid, text, boolean)` is in
`supabase/migrations/20261118090000_factcheck_fail_reason.sql:36` to `:75`. It replaces the sharing version
(`20261117090000_factcheck_sharing.sql:309`) with the same signature and grants.

- **Session id:** `stretch_id` is the session id (`fail_reason.sql:51`).
- **Start and end:** `from_s` is the minimum `pos_start_s` and `to_s` the maximum `pos_end_s` of the session's stored
  pieces (`fail_reason.sql:34` to `:35`, `:51`). Pieces exist only for a shareable recorded session.
- **Minutes:** `minutes` comes from `private.factcheck_stretch_minutes` (`fail_reason.sql:47`;
  `20261117090000_factcheck_sharing.sql:191` to `:197`). It is the ceiling of the covered audio time, with a minimum of 1.
  It is not `minutes_bought`. A block bought as 10 minutes can show fewer minutes if less audio was stored.
- **Time:** only `checked_on`, a date (`fail_reason.sql:52`). No `ended_at` or timestamp is returned. The browser cannot
  order two stretches from the same day by time.
- **Access:** `access` is `own`, `unlocked` or `locked` (`fail_reason.sql:48` to `:50`). Only `own` and `unlocked`
  stretches carry `lines` and `claims` (`fail_reason.sql:56` to `:70`).
- **Own results:** for an `own` stretch each claim shows its newest result (`fail_reason.sql:68`).
- **Off and not allowed:** the view returns `reason` `off` when the sharing flag is missing (`fail_reason.sql:16` to `:19`)
  and `not_allowed` for a non-admin when the audience is admin (`:20` to `:22`).

### Order and visibility

- Order: `ORDER BY q.ended_at DESC, q.id` (`fail_reason.sql:44`), so the array is newest first. The server returns at most
  50 (`:45`).
- Visibility: a settled, shareable, recorded session with pieces is listed when it is the caller's own, or the user's
  three newest sessions for that video, or unlocked by the caller (`fail_reason.sql:38` to `:43`). Another user's
  session is listed only two minutes after it ended (`:40`).
- Rate: 30 listings a minute per user (`fail_reason.sql:24` to `:30`).

### How the browser chooses and draws a stretch

- `src/shell/factcheck/factCheckShare.js:42` to `:60` (`partModel`): `readable` is true for `own` or `unlocked`
  (`:43`). `reportable` is true only for `unlocked` (`:54`). `range`, `minutes` and `date` are formatted here.
- `src/shell/factcheck/factCheckShare.js:63` to `:66` (`coveringPart`): returns the first stretch in the array whose
  range holds the position, ends included. The first match is the newest because of the server order.
- `src/shell/factcheck/factCheckController.js:372` to `:398` (`loadShared`): the covering stretch is computed once per
  load, from the playhead at load time (`:394`, `:398`). It is not recomputed when the playhead moves.
- `src/shell/factcheck/FactCheckPanel.jsx:391` to `:394`: parts are shown only in states `choosing`, `ended` or `error`.
  The covering stretch becomes `covered`.
- `src/shell/factcheck/FactCheckPanel.jsx:76` to `:77`: when `covered` is set and the user has not chosen "Check anyway",
  the start screen shows `CoveredBanner` instead of the length options.
- `src/shell/factcheck/FactCheckParts.jsx:90` to `:98` (`Part`): each part shows its range, minutes, date and claims
  count. An `own` part gets the label "Your check" (`:97`), an `unlocked` part "Unlocked" (`:98`). Otherwise the part
  looks the same. `Parts` starts at `:130`.
- No "earlier analysis" marking exists for stretches. The existing "Earlier result" disclosure (`FactCheckPanel.jsx:211`)
  is for claim re-checks, not stretches.

### The start screen and its preselected length

- `src/shell/factcheck/factCheckText.js:5`: `MINUTE_CHOICES = [1, 2, 5, 10, 15, 20, 30]`.
- `factCheckText.js:21` to `:33` (`defaultBlock`): picks 5 minutes when affordable, else the longest affordable one below
  5, else the first affordable one. It takes no preferred length.
- `FactCheckPanel.jsx:63`: `Choose` keeps the user's choice in local state, `preferred`, which starts as `null`.
  `FactCheckPanel.jsx:67` uses it, else `defaultBlock(options)`. No prop feeds it, so a preselect needs a new input.
- The 20 and 30 minute lengths are allowed by the database too. `supabase/migrations/20261120090000_factcheck_session_lengths_20_30.sql`
  (header lines 1 to 10) widens the check on `minutes_bought` and the length test in `factcheck_start`. Whether that
  migration is applied on production is **not established**.

### Seeking the player

- No seek exists. `src/shell/liveTv/useYoutubePlayer.js:14` to `:52` returns `iframeRef`, `requestMute`, `getPositionS`
  and `getPosition` (`:51`). There is no seek function.
- `src/shell/liveTv/youtubePlayerBridge.js:33` sends only `mute` and `unMute` commands. `:59` sends `listening`. The
  bridge reads `onReady` and `infoDelivery` (`:6`).
- The embed URL for a video is built in `src/shell/LiveTvPage.jsx:259` with no `start` parameter. `embed.js:14` adds
  `enablejsapi=1` for YouTube URLs, which is the setting the IFrame API's `seekTo` command needs. The `seekTo` command
  itself is not in the code.
- Playback position reads: `LiveTvPage.jsx:294` (`getPosition`) and `:299` to `:301` (`startPositionS: null`,
  `getStartPositionS`). `src/shell/factcheck/useFactCheck.js:15` to `:18` reads `getStartPositionS()` at confirm time and
  passes the integer result as `startPositionS`.
- Stored piece positions come from the playhead: `src/lib/factcheck/session.js:267` to `:271` sets the end as the position
  minus the held time, and the start as the end minus the piece's duration. So a stored `from_s` is the playhead reading,
  not a copied `start_position_s`.
- Tests: `src/shell/factcheck/factCheckStartPosition.test.js:8` (uses the position read at confirm), `:16` (null when
  unknown), `:21` (passes params without a getter through).
- Server side: `supabase/functions/factcheck/start.ts:106` reads `start_position_s`. A session stores it
  (`session.js:556`).

### Gates that already exist

- Flag: `src/shell/factcheck/factCheckFlag.js:22` (`parseFactCheckFlag`). Needs `enabled` true, `audience` admin or all,
  a valid `credits_per_minute`. Sharing needs `share_recorded` true and a valid unlock price (`:30` to `:32`).
- Per-session limits and settlement: `factcheck_touch`, `factcheck_settle` and `factcheck_charge_minutes` as in the F344
  spec. A session is one active run per user (existing rule).

### Production state

- The admin-only flag row `livetv_factcheck` exists with `credits_per_minute` 500 (open-work F344 entry). Sharing keys are
  not set, so no recorded session has stored pieces unless sharing was on for it. **Not established** by a query on the
  live project for this spec.
- No real session has run on the live site (open-work F344 entry).

## Decisions

Owner decisions, 2026-11-18. D1 replaces the earlier D1 about a new price key. No decision below needs a new price key.

- **D1 Ordinary session.** Re-analysis is an ordinary fact-check session on the same recorded video. It starts at the
  block's start position for the block's length. It is transcribed, extracted and checked again from the video's audio,
  exactly like any session. No stored text is re-used.
- **D2 Price.** The ordinary session price (flag `credits_per_minute`, 500 a minute today), held and charged by the
  existing rules. No new price key and no new charging code.
- **D3 Control.** On a stretch the viewer can see in the recorded video's fact-check results, a "Re-analyze this block"
  button. It moves the player to the stretch's start (`from_s`) and opens the normal start screen with the length
  preselected: the shortest offered length that covers the stretch's minutes, or the longest offered length when the
  stretch is longer. Offered lengths are whatever `MINUTE_CHOICES` holds. The user confirms the usual way, and the browser
  asks for tab audio as usual. Nothing is charged until the user starts.
- **D4 Who.** Any user who can start a session and can see that stretch: its runner, or a user who unlocked it. Same
  audience rule as fact-check.
- **D5 Results.** The new run is a new session with its own stretch. Where two stretches cover the same position, the
  newer one is shown first and the older one stays available, marked as an earlier analysis with its date.
- **D6 Unlocks.** Unchanged. A user who unlocked the earlier stretch keeps it. The new stretch is unlocked separately at
  the usual unlock price. The runner sees their own.
- **D7 Limits.** The existing ones: one active session per user, per-user rate limits, session budgets. No new limits.
- **D8 Smallest build.** Browser-only. A database or function change is allowed only if the facts above show that the
  browser cannot order stretches newest first or cannot find a stretch's start and length.
  **Consequence (established):** the browser can do both. Order comes from the array (`fail_reason.sql:44`), and
  `from_s`, `to_s` and `minutes` are returned per stretch (`fail_reason.sql:51`). The browser's `coveringPart` already
  relies on this order (`factCheckShare.js:65`). The gaps are in the browser, not the database: no seek (see Current
  state), and no preferred length input (`FactCheckPanel.jsx:63`). The one weak point is that the order is not a stated
  field; the browser relies on it, and a same-day tie is decided only by the array order.
- **D9 Audience.** Admin-only until the owner opens fact-check. The button needs sharing to be on, because stretches exist
  only then. It rides the existing audience gate in the flag; no new flag key.

## Decisions on the open points (2026-11-18)

- **D10. Covered banner.** When the start screen is opened from "Re-analyze this block", the "already covered" banner
  is not shown, because the user has just asked for a second analysis of covered video.
- **D11. Length the user cannot afford.** The preselected length is still shown as chosen, with the existing "Needs ..."
  line, and Start stays disabled until the user picks a length they can afford. Nothing is charged.
- **D12. Seeking.** The player is moved with the YouTube player's `seekTo` command through the existing bridge. If the
  player does not report the new position within 3 seconds, the start screen says the video could not be moved and
  asks the user to move it to the shown time; Start stays available, because the session records the position the
  player actually reports.
- **D13. Order.** The list order the server already returns (newest first) decides which stretch shows first. No
  timestamp is added to the view.
- **D14. Tracker and plan text.** The supervisor updates the tracker; this branch's task agents do not.

## Open points

Only points the owner has not decided. Each has a default that the build uses unless the owner changes it.

- **OP1 Covered banner on the re-analysis start screen.** Today a start screen opened over a covered position shows
  `CoveredBanner` first (`FactCheckPanel.jsx:76` to `:77`). D3 says the "normal start screen" opens with the length
  preselected, so the banner would be an extra step. **Default:** when the start screen opens from the button, skip the
  banner and show the length options. **Owner to confirm.**
- **OP2 Covering length that the user cannot afford.** The preselected length may cost more than the balance. **Default:**
  preselect it anyway. Its option is disabled with the existing "Needs ..." text, and Start stays disabled. The
  alternative is to fall back to `defaultBlock` (`factCheckText.js:27`), which would not match D3's rule. **Owner to
  confirm.**

## Out of scope

- A block-level database link between a new result set and an old one. Sessions are linked only by their stretches.
- Re-use of stored text or pieces for a new run.
- New prices, new limits or a new flag key.
- Re-analysis of a live session (live sessions are not recorded and are never shared, open-work F344 entry).
- UI polish beyond the button, its label and the earlier-analysis mark.
- Changes to the view's fields or order, unless the Decisions D8 test fails (see Risks).
- Editing `docs/plans/open-work.md` or the closeout plan. The supervisor updates them when this spec is accepted.

## Acceptance evidence

Each item is a unit test unless it says otherwise. Each new test must fail before the change it guards (red first), as
`AGENTS.md` requires. Record the failing run and the passing run.

- **Length preselection:** the shortest offered length that covers the stretch's minutes is chosen; a stretch of 3
  minutes picks 5; a stretch longer than the longest (30) picks 30; a stretch exactly on a choice picks that choice.
  Tests go in `src/shell/factcheck/factCheckText.test.js` and `FactCheckPanel.test.jsx`.
- **Newest first, older reachable:** with two overlapping stretches in server order, `coveringPart` returns the first (the
  newer). The older one is still in the parts list and carries the earlier-analysis mark with its date. Tests go in
  `factCheckShare.test.js`.
- **Button only on visible stretches:** the button renders only for `own` and `unlocked` parts, only in states where the
  parts list shows, and only with sharing on and the flag available. Tests go in `FactCheckShare.test.js` and
  `FactCheckPanel.test.jsx`.
- **Nothing charged before start:** pressing the button calls neither `start` nor any charge function; the start is called
  only on the confirm control. Test in `factCheckController.test.js`.
- **Flag off renders nothing new:** with the flag off or sharing off, the panel and parts render exactly as before (a
  snapshot or markup-equality test against the current output). Test in `FactCheckPanel.test.jsx` and
  `LiveTvPage.wiring.test.jsx`.
- **Seek lands before confirm:** the start reads a position within a set tolerance of `from_s` before Start is enabled, or
  the start uses the stretch's `from_s` and the test proves the playhead was there. Test in
  `factCheckStartPosition.test.js` (new cases).
- **Existing tests:** `factCheckStartPosition.test.js`, `LiveTvPage.wiring.test.jsx`, `factCheckShare.test.js` and the
  rest of `src/shell/factcheck` keep passing.
- **Commands:** `npm run lint` (must pass with zero warnings), `npm run build`, `npm run check:bundle`, `npm test`. The
  change is under `src/shell`, so the SQL fixtures and Deno tests are not required. If a migration were added (it is not
  planned), also run `npm run test:sql` and `deno test -A --config supabase/functions/deno.json supabase/functions`, and
  prove the fixture non-vacuous.
- **No type check is claimed.** The repository has no standalone type-check (`AGENTS.md`).

## Risks

- **Seek lands late or not at all.** The start reads the playhead at confirm time (`useFactCheck.js:15` to `:18`). A
  stale read would label pieces with the wrong positions. Mitigation: the acceptance test above; Start stays disabled until
  the playhead is within tolerance of `from_s`.
- **Seek command untested in this environment.** `seekTo` is not in the code. Whether the embed accepts it through this
  bridge is **not established**. Mitigation: a manual check in the browser by the owner before release.
- **Order relied on, not stated.** The browser depends on array order (`factCheckShare.js:65`). A later change to the view
  could break newest-first silently. Mitigation: a browser test that pins the order it expects. If the owner wants a
  stated field, add `ended_at` to the view in a migration (CREATE OR REPLACE, same signature and grants), which then
  needs the full SQL checks above.
- **Minutes shown can differ from minutes bought.** `minutes` is audio coverage (`factcheck_stretch_minutes`). The
  preselect follows the stretch's minutes (D3), so a 10-minute block with less stored audio preselects a shorter length.
- **Cost and repeat runs.** A user can pay for many full runs of one block. D7's existing limits apply. This is the owner's
  decision (D2, D7).
- **Visibility limit.** For other users the view lists only their three newest sessions per video
  (`fail_reason.sql:42`). Older runs by other users are not visible to a viewer, even when shareable.
- **Verdict instability.** A new run can disagree with the old one (F352). Both are shown, which is the intent (D5).

## Release

- **Browser-only, if D8 holds.** No migration, no function change, no flag row change. The button needs the existing
  `livetv_factcheck` flag, `share_recorded`, and admin audience.
- Rollback is a revert of the browser commit. No database rollback is needed.
- No push, pull request, merge or deploy without the owner's exact authorization (`AGENTS.md`). Task agents leave work
  uncommitted; the supervisor commits after verification.
- If D8 ever fails (the browser needs `ended_at` or a start field), the migration goes first, then the function, then the
  browser, with the SQL fixture and vacuity proof.

## Plan

Tasks run in order. Write scopes are disjoint, but shared interfaces (the preselect input and the seek API) are fixed in
T1 and T3 before T2, T4 and T5 start, so the work stays sequential.

1. **T1 Pure helpers.** Newest-first order check, earlier-analysis mark (a stretch is earlier when a newer stretch covers
   one of its positions), and length choice (`reanalyzeLength(minutes, choices)`). Write scope:
   `src/shell/factcheck/factCheckShare.js`, `src/shell/factcheck/factCheckText.js`, and their tests
   (`factCheckShare.test.js`, `factCheckText.test.js`). Red tests first.
2. **T2 Seek API.** `seekTo` command in the bridge, `seekS(s)` in the player hook, wiring in the page, and the tolerance
   check. Write scope: `src/shell/liveTv/youtubePlayerBridge.js`, `src/shell/liveTv/useYoutubePlayer.js`,
   `src/shell/LiveTvPage.jsx`, and the matching tests under `src/shell/liveTv` and `src/shell/factcheck`.
3. **T3 Start screen input.** `Choose` takes `initialMinutes` and `skipCovered` (OP1 default), and passes the preselect
   rule from T1 (OP2 default). Write scope: `src/shell/factcheck/FactCheckPanel.jsx`, `FactCheckPanel.test.jsx`.
4. **T4 Controller action.** `reanalyze(stretch)`: refuses while a session is running, starting, sharing or ending; seeks;
   opens the start screen with the preselect; never calls `start` before confirm. Write scope:
   `src/shell/factcheck/factCheckController.js`, `factCheckController.test.js`.
5. **T5 Button and mark.** Button on readable parts, earlier-analysis mark on overlapped older stretches. Write scope:
   `src/shell/factcheck/FactCheckParts.jsx`, `FactCheckShare.test.js`, and the stylesheet that holds the `fc-` classes
   (name the file in the task; no new CSS unless needed).
6. **T6 Verification.** Run the commands in Acceptance evidence. Record exact commands, outcomes and warnings. No writes.
7. **T7 Report.** Changed paths, verification, working-tree state, and the open points still undecided. Left uncommitted.

## Not established

- Whether any recorded session on production has stored pieces (no query run).
- Whether the 20 and 30 minute migration is applied on production (only the checkout was read).
- Whether the YouTube embed accepts an IFrame API `seekTo` through this bridge (not run).
- Whether the bridge's playhead snapshot updates quickly enough after a seek for the confirm-time read.
- Whether `from_s` equals the session's `start_position_s` exactly. It is the playhead reading (`session.js:267` to `:271`).
- Whether the SQL fixtures pin the order of `factcheck_video_view` (not checked).
- Whether the open-work F363 line and the closeout W4 text describe the old design (they were not read in full; they are outside this write scope).
