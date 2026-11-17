# F349 plan: fact-check fixes after the first live sessions

> **Status: Living (2026-11-17).** Written 2026-11-17 on branch `task/f349-findings`. Tracker: F349 in
> [open-work](open-work.md). Findings are in the
> [research note](../research/2026-11-17-f349-fact-check-first-sessions.md), which says what was executed and what was
> read from code. Owner decisions D1 to D3 were made on 2026-11-17; D4 was answered the same day (see below). Merged 2026-11-17 in
> pull request 162 (`ac4a7726`); migration applied on NTER and function version 4 deployed the same day. Proof by two real sessions on 2026-11-17 is recorded below; the "No sources found" state and reopening the panel during a session are still unseen.

## What it delivers

- The panel says truthfully why a check failed or a session ended.
- No paid retry is offered where a retry cannot help.
- Failures become visible in the logs, with a reason code.

## Not in this plan

- Longer time limits. No timeout was found in the data.
- Session lengths. This is F350, a separate owner decision.
- Re-analyzing a block.
- A past-sessions view.

## Owner decisions

- **D1.** Decided 2026-11-17: a verdict that has one of the five labels but no citation shows under a new state,
  "No sources found", with a neutral look and no "Check again".
- **D2.** Decided 2026-11-17: keep "End that session". The other page says "This session was ended from another tab or
  window."
- **D3.** Decided 2026-11-17: no paid replay. The reason code will be read from the log after the next normal session.
- **D4.** Answered 2026-11-17: the owner confirmed that Live TV was open in two tabs or windows at about 14:52 UTC, so the
  cause of the 409 responses is confirmed.

Note: on 2026-11-17 the owner agreed to this order of later work, each item its own plan:

1. these fixes;
2. shorter audio pieces (about 5 seconds, after an accuracy test on recorded clips), a "listening" line, and session
   lengths of 1, 2, 5, 10 and 15 minutes, with 20 and 30 minutes held until the fixes are proven (tracker F350);
3. Live TV as a page of its own instead of a pop-up;
4. sharing switched on, then a streaming transcription test when a key is available.

Longer time limits are not planned, because no timeout was found.

## Fixed interfaces

- **Claim JSON** gains `fail_reason`: `null`, `no_label`, `bad_label`, `label_conflict` or `no_sources`. `status` stays
  `error` for those. It is stored in a new nullable column, `public.factcheck_claims.fail_reason`, in migration
  `20261118090000_factcheck_fail_reason.sql` (additive).
- **`stop`** may carry `end_reason`: `user_stop`, `modal_close`, `channel_change`, `sharing_stopped`, `time_up`, `silence`,
  `server`, `error` or `other`. Unknown values are ignored. It is logged, not stored.
- **409 reasons** keep their existing names.
- **Write scopes:** server work in `supabase/functions/factcheck/**`, the migration and its fixture; browser work in
  `src/lib/factcheck/**`, `src/shell/factcheck/**`, `src/shell/LiveTvModal.jsx`, `src/shell/liveTv/**` and the panel's
  stylesheets. The two are built at the same time because the scopes do not overlap.

## Tasks

Run in order. Each task lists its write scope and its verification. Each task starts with a failing test that shows the
defect. The checks are `npm run lint`, `npm run build`, `npm test`, and
`deno test -A --config supabase/functions/deno.json supabase/functions`.

**T1. Server: reason codes.** Scope: `supabase/functions/factcheck/check.ts`, `recheck.ts`, `modelCall.ts` and their tests.
A failed verdict logs one of `no_label`, `bad_label`, `label_conflict` or `no_sources`, and the citation count. It never
logs the reply text. `model_call_logs` records such a call as not usable.

**T2. Server and panel: the no-sources state (after D1).** Scope: `check.ts`, `types.ts`, `src/shell/factcheck/factCheckText.js`,
`FactCheckPanel.jsx`. The status set is constrained in SQL, so the state is kept as `error` plus the new `fail_reason`
column. No "Check again" on a state that repeats.

**T3. Browser: a session ends with a reason.** Scope: `src/lib/factcheck/session.js`, `src/shell/factcheck/factCheckText.js`,
the controller and its tests. A 409 with `settled` shows "This session was ended from another tab or window." Other 409s
show their own reason. The client sends an end reason with `stop`: `user_stop`, `modal_close`, `channel_change`,
`sharing_stopped`, `time_up` or `silence`. The server logs it (`stop.ts`, `validate.ts`).

**T4. Panel wording.** Rename the session-level "Run again" so it says that it starts a new paid session, and show the
price. The capture errors say what to do, that the feature needs Chrome on a computer, and that nothing was charged.
First verify in code that `start` cannot hold credits before capture succeeds. If it can, that is a defect, and this
task fixes it. Tell a browser refusal apart from the user declining, where the browser's error allows it.

**T5. Panel layout.** Scope: `src/shell/factcheck/*.css` or the Live TV stylesheet. The panel is visible when it stacks
below the video at about 812 px (scroll into view, or add a marker). Cancel is reachable at 700 px height. The player
does not jump on error. Verify in a browser at 812 px, at 1024 by 700, and at 375 px, in the light and dark themes.

**T6. Optional, after T1 to T5.** When Live TV is reopened in the same page, re-read the session's stored claims, so the
list always matches the server. This needs a read action on the function. Decide after T3 shows how often the lists
differ.

## Release

One pull request. A migration is needed (`20261118090000`), applied on NTER before the function is redeployed, each on
the owner's yes. The function is redeployed only on the owner's yes. The feature flag is unchanged.

## Proof still owed

A real session by the owner, after the fixes. The browser test runs cannot start a capture. The reason codes are read
from the log for that session.

## Proof by real session (2026-11-17)

Run by the supervisor in the owner's Chrome on the live site, the owner accepting Chrome's sharing prompt. Each session
used 5 minutes and charged 2,500 credits. Both settled, and no session or hold was left open (0 active sessions after
each). Executed.

| | Session 1 | Session 2 |
|---|---|---|
| Time (UTC) | 22:25:31 to 22:30:48 | 22:32:28 to 22:37:53 |
| Page | stale copy, loaded before these browser fixes (still showed "Run again"); function version 4 | after a reload; the Live TV chunk carried the new texts and not "Run again" |
| Claims | 25: 11 checked (all supported), 10 not checkable, 2 needs context, 2 `error` (`no_label`) | 36: 25 checked (16 supported, 6 contradicted, 3 partly true), 5 not checkable, 2 needs context, 4 `error` (`no_label`) |
| Transcriptions | 32, median 1.1 s, worst 2.3 s | 27, median 1.2 s, worst 2.4 s |
| Extractions | 17, median 3.3 s, worst 7.1 s | 17, median 3.3 s, worst 5.3 s |
| Checks | 13 (11 usable, median 2.9 s, worst 3.7 s; 2 unusable) | 29 (25 usable, median 2.4 s, worst 3.6 s; 4 unusable) |

**Seen in the real pop-up (session 2):** the muted video is unmuted by the start button ("Unmute and start 5 minutes ·
2,500 credits"); the panel keeps a fixed height (603 to 640 px) beside the player, during and after the session; the end
screen shows "Time is up.", the 5 minutes used, the 2,500 credits charged, the new balance, and the buttons "Start a new
session · from 2,500 credits" and "Close", the latter kept in view; failed checks show "Check failed".

**Not seen:** the "No sources found" card in either session, so that state is still unseen with real data. Closing and
reopening the panel during a session was not tested (closing Live TV ends the session).

**Cause of the failed checks.** Six of 42 check calls in the two sessions were stored as `error`, each with
`fail_reason` `no_label`: the reply had no LABEL line. No call failed at the provider, and there was no 409 and no
timeout in session 1. The timeout and provider-failure hypotheses stay refuted. The cause is tracked as F351 in the
[tracker](open-work.md).

**Status.** F349 stays open in the tracker for the two items not seen (the "No sources found" state and reopening during
a session). The failed checks move to F351.
