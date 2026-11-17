# F349 plan: fact-check fixes after the first live sessions

> **Status: Living (2026-11-17).** Written 2026-11-17 on branch `task/f349-findings`. Tracker: F349 in
> [open-work](open-work.md). Findings are in the
> [research note](../research/2026-11-17-f349-fact-check-first-sessions.md), which says what was executed and what was
> read from code. Owner decisions D1 to D3 were made on 2026-11-17; D4 is still open. Merged 2026-11-17 in
> pull request 162 (`ac4a7726`); migration applied on NTER and function version 4 deployed the same day; proof by a real session still owed.

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
- **D4.** Still open. The owner has not yet said whether two pages or windows had Live TV open at 14:52 UTC on
  2026-11-17.

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
