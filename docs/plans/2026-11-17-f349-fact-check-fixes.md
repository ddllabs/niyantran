# F349 plan: fact-check fixes after the first live sessions

> **Status: Living (2026-11-17).** Written 2026-11-17 on branch `task/f349-findings`. Tracker: F349 in
> [open-work](open-work.md). Findings are in the
> [research note](../research/2026-11-17-f349-fact-check-first-sessions.md), which says what was executed and what was
> read from code. Nothing is built. The owner's decisions below are needed before building.

## What it delivers

- The panel says truthfully why a check failed or a session ended.
- No paid retry is offered where a retry cannot help.
- Failures become visible in the logs, with a reason code.

## Not in this plan

- Longer time limits. No timeout was found in the data.
- Session lengths. This is F350, a separate owner decision.
- Re-analyzing a block.
- A past-sessions view.

## Owner decisions needed

- **D1.** A verdict has one of the five labels but no citation. Keep it hidden as a failure, or show it under a new state
  "No sources found"? Recommended: the new state, with no verdict colour and no "Check again".
- **D2.** A second page starts while a session runs. Keep "End that session" and explain it on the other page, or refuse
  the second page outright? Recommended: keep it, and explain it.
- **D3.** Approve one paid replay of the failed claim to capture the reason (about 100 credits). Or wait for the reason
  code to appear in normal use.
- **D4.** Confirm whether two pages or windows had Live TV open at 14:52 UTC on 2026-11-17.

## Tasks

Run in order. Each task lists its write scope and its verification. Each task starts with a failing test that shows the
defect. The checks are `npm run lint`, `npm run build`, `npm test`, and
`deno test -A --config supabase/functions/deno.json supabase/functions`.

**T1. Server: reason codes.** Scope: `supabase/functions/factcheck/check.ts`, `recheck.ts`, `modelCall.ts` and their tests.
A failed verdict logs one of `no_label`, `bad_label`, `label_conflict` or `no_sources`, and the citation count. It never
logs the reply text. `model_call_logs` records such a call as not usable.

**T2. Server and panel: the no-sources state (after D1).** Scope: `check.ts`, `types.ts`, a migration only if the status
set is constrained in SQL (check first), `src/shell/factcheck/factCheckText.js`, `FactCheckPanel.jsx`. No "Check again"
on a state that repeats.

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

One pull request. The function is redeployed only on the owner's yes. No migration is expected unless T2 finds a
constraint. The feature flag is unchanged.

## Proof still owed

A real session by the owner, after the fixes. The browser test runs cannot start a capture. The reason codes are read
from the log for that session.
