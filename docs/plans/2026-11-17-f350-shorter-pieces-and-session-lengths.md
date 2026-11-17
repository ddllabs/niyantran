# F350 plan: session lengths of 1, 2, 5, 10 and 15 minutes and a listening line

> **Status: Living.** Written 2026-11-17 on branch `task/f350-plan`. Gate G1 executed 2026-11-17: both shorter settings
> failed; piece length unchanged. Reduced scope built and reviewed on 2026-11-17: server in pull request 167, browser in pull request 168; every gate run on the combined change (executed). Released 2026-11-17; see the release record below. Revised after the independent review and again after G1.
> Tracker: F350 in [open-work](open-work.md). Spec: [F350 spec](../specs/2026-11-17-f350-shorter-pieces-and-session-lengths.md),
> which holds the reasons, the decisions, the G1 results, the owner's answers and the list of what is not built.
> Code references are in the spec (read at `main` `7034e9f7`).

## What it delivers

- Session lengths of 1, 2, 5, 10 and 15 minutes, in all four places that enforce them (S5).
- Browser choices with the singular label, the default of 5 minutes and the lowest price for "Start a new session" (S6).
- A "Listening…" line at the foot of the transcript while the session is running. It is not announced to screen readers (S7).
- A delay figure of 14 seconds in the panel text, the median measured by G1 at the current piece length (S8).

## Not in this plan

- **Transcript speed.** This plan does not make the transcript faster. Piece length stays at 10 seconds (S1, G1). See the
  spec's "What the owner asked for" for the options that remain (streaming, a better join, provisional text). None is built.
- Everything in the spec's "Not built after G1": the 5 s and 7 s pieces, the turn rule (S2), the transcribe limit of 24
  (S3), the stored-piece cap of 240 and the earlier context (S4), and the failure limit of 5 (S10).
- Lengths 20 and 30 minutes (held until the F349 fixes are proven by a real session).
- Live TV as its own page, sharing switched on, and streaming transcription (later items, each with its own spec).
- Any change to price, hold, settlement, checks or re-checks.

## Dependencies and gate

- **Gate G1** was executed on 2026-11-17. Both shorter settings failed the pass rule, so piece length is unchanged. The
  delay figure (S8) is taken from its result. Nothing in this plan depends on a further run.
- **OD1** (recorded clips) was answered: route B, approved and done.
- **Owner's real session on the F349 fixes** must happen before any release (release step 1).

## Fixed interfaces

These are fixed before any build starts, so that the server and browser pull requests agree.

- **Browser lengths** (`src/shell/factcheck/factCheckText.js:5`): `MINUTE_CHOICES = [1, 2, 5, 10, 15]`.
- **Delay figure** (`src/shell/factcheck/factCheckText.js`): `DELAY_SECONDS = 14`, replacing the literal "13" in the
  "Listening…" text at `FactCheckPanel.jsx:466` and its test.
- **Listening line** (`src/shell/factcheck/FactCheckPanel.jsx`): no snapshot field and no controller change. The line is
  shown while the session status is `running` and no silence notice is showing. It has its own React key. The autoscroll
  trigger (`FactCheckPanel.jsx:155`) includes it.
- **Server limits** (`supabase/migrations/20261119090000_factcheck_session_lengths.sql`):
  - `minutes_bought IN (1, 2, 5, 10, 15)` in the table CHECK (name to be confirmed, see T1);
  - `p_minutes IN (1, 2, 5, 10, 15)` in `public.factcheck_start`, with nothing else changed in its body.
  - `public.factcheck_touch` and `public.factcheck_piece_store` are **not** touched.
- **Refusal code** `bad_minutes` is unchanged. The Edge Function message in `start.ts` becomes "minutes must be 1, 2, 5, 10
  or 15." (the status and reason stay as they are).
- **No change** to `pieces.js`, `session.js`, `extract.ts`, the transcribe limit, the stored-piece cap or the failure limit.

## Write scopes

| Task | Owner | Write scope (exclusive) |
|---|---|---|
| T0 | supervisor | done (G1 executed 2026-11-17; raw output outside the repository) |
| T1 | builder | `supabase/migrations/20261119090000_factcheck_session_lengths.sql`, `supabase/tests/factcheck_lengths.sql`, `supabase/tests/run.sh` |
| T2 | builder | `supabase/functions/factcheck/start.ts`, `start_test.ts` |
| T5 | builder | `src/shell/factcheck/factCheckText.js`, `FactCheckPanel.jsx`, `factCheck.css`, `FactCheckPanel.test.jsx`, `fixtures/` |
| T6 | reviewer (not the builder of the pull request) | none; comments only |

`src/shell/factcheck/factCheckController.js` is not in any write scope, because the controller needs no change.
`supabase/tests/factcheck.sql`, `pieces.js`, `pieces.test.js`, `capture.test.js`, `session.js` and `session.test.js` are not in
any write scope, because they are not changed.

Two pull requests keep the server and browser apart so that the server can be released first:

- **Pull request A** on branch `task/f350-server`: T1 and T2.
- **Pull request B** on branch `task/f350-browser`: T5 only. It may be built in parallel with A, but it is merged only after A
  is released.

Builders leave their work uncommitted. The supervisor reproduces the evidence and makes the commits.

## Tasks

Each task starts with a failing test that shows what it fixes.

**T0. Gate G1 (done 2026-11-17).** Executed. Both shorter settings failed. Results are in the spec ("Gates"). Piece length
stays at 10 s, and no piece-length task is built.

**T1. Server: lengths (builder; pull request A).** Depends on nothing.
- Write `supabase/tests/factcheck_lengths.sql` first. Its checks are those listed under "Acceptance evidence" in the spec,
  and each must fail against the current migrations.
- Register it in `supabase/tests/run.sh` as a chain on `factcheck_fail_reason` plus the new migration, the same pattern as
  `factcheck_fail_reason` at `run.sh:200-202`. The vacuity check drops the chain's last file (`run.sh:412-430`).
- Write the migration `20261119090000_factcheck_session_lengths.sql`. Its header comment states the reason for the new
  lengths.
  - **Table CHECK.** The CHECK on `minutes_bought` is anonymous in `20261116090000_factcheck.sql:81`. Its name is expected to
    be `factcheck_sessions_minutes_bought_check`. The builder confirms the name in `pg_constraint` on the local database
    before writing the drop. The drop and the re-add run in one transaction, with `IN (1, 2, 5, 10, 15)`. The owner accepted
    replacing it (OD4).
  - **`public.factcheck_start`.** It is defined once, at `20261116090000_factcheck.sql:277`, with `p_expected_cpm numeric
    DEFAULT NULL`. Copy its current body from that migration (check first that no later migration replaces it;
    `20261118090000_factcheck_fail_reason.sql` is checked). Change only the list at `:309`, to `p_minutes NOT IN (1, 2, 5, 10,
    15)`. The body is `LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC'` (the reviewer read this;
    the builder confirms it). Repeat every clause exactly in the `CREATE OR REPLACE`. Grants survive a replace.
  - **Drift guard on `public.factcheck_start` only.** Before replacing it, the migration compares the md5 of its `prosrc` with
    the md5 of the body the repository was written against, or with the md5 of the new body (so re-applying is a no-op).
    Anything else stops the migration with `55000` before it changes a thing. The pattern is
    `20261116100000_factcheck_usage_reports.sql:39-62`.
  - `public.factcheck_touch` and `public.factcheck_piece_store` are not touched, and the migration does not mention them.
- Edit `supabase/tests/run.sh` only. `supabase/tests/factcheck.sql` is not edited.
- Acceptance: the fixture passes on the new migration, and fails when it is removed (the run proves it is not vacuous).
- Verification: `npm run test:sql`, which runs on disposable containers and includes the vacuity proof.

**T2. Server: Edge Function (builder; pull request A).** Depends on nothing; parallel with T1.
- `start.ts:101` accepts `[1, 2, 5, 10, 15]`; the message at `:154` changes to "minutes must be 1, 2, 5, 10 or 15.".
  Test first in `start_test.ts` (`:144-161`): lengths 1, 2, 5, 10, 15 accepted; 0, 3, 4, 7, 20, 30 refused.
- `extract.ts` is not changed.
- Acceptance: the deno test command passes; the new tests fail first.
- Verification: `deno test -A --config supabase/functions/deno.json supabase/functions`.

**T5. Browser: lengths, listening line and copy (builder; pull request B).** Depends on nothing; may be built in parallel
with A, but merged only after A is released.
- `factCheckText.js:5`: `MINUTE_CHOICES = [1, 2, 5, 10, 15]`. Add `DELAY_SECONDS = 14`. Replace the literal in the "Listening…"
  text at `FactCheckPanel.jsx:466`. Test first: the panel text reads "about 14 seconds", at `FactCheckPanel.test.jsx:173-177`,
  and still refuses "10 seconds".
- `FactCheckPanel.jsx:91` and `:117`: singular "1 minute" through a helper. Test first.
- `FactCheckPanel.jsx:67`: default selection per S6. Test: 5 minutes when affordable; the longest affordable length below 5
  otherwise. Test first.
- `FactCheckPanel.jsx:509`: "Start a new session · from …" uses the lowest price (500 credits). Test first.
- `FactCheckPanel.test.jsx:75-96` and `:120`: the choice now lists five buttons. The default "Start 5 minutes · 2,500" is
  unchanged. Update the expectations first.
- Listening line (S7): add a last transcript line "Listening…" after the existing lines while the status is `running` and
  no silence notice is showing (the notice starts at `SILENT_NOTICE_MS` 30000, `FactCheckPanel.jsx:14`). Give it its own
  React key. Include it in the autoscroll trigger (`FactCheckPanel.jsx:155`). The region stays `aria-live="off"`. Its
  animation is off under reduced motion. Tests first:
  - shown while the status is `running`;
  - hidden when `ending`, `ended` or any other status;
  - hidden while the silence notice is showing;
  - the region keeps `aria-live="off"`.
- The browser code stays in the lazily loaded chunk (no static import from `TerminalShell.jsx`).
- Acceptance: the new tests fail first, then pass; `check:bundle` shows no change to the first-load limit.
- Verification: `npm run lint`, `npm run build`, `npm run check:bundle`, `npm test`.

**T6. Review (reviewer who did not build the pull request).** Depends on each pull request being complete.
- Review pull request A (server) first, against the migration, the drift guard and the function tests.
- Review pull request B (browser) second, against the listening line, the labels and the defaults.
- The reviewer reports findings; the supervisor runs every gate and decides.

## Release

Each step needs the owner's explicit yes naming it.

1. The owner's real session on the F349 fixes (proof still owed by F349).
2. Merge pull request A.
3. Apply the migration on the live database by the documented route (`psql` or `supabase db query --linked -f`), with a
   hand-written history row, and never by `supabase db push`. **Apply only when no session is running.** Check first
   that no row in `public.factcheck_sessions` has `status = 'active'` (`20261116090000_factcheck.sql:89`). The constraint
   change locks the sessions table briefly.
4. Deploy the Edge Function `factcheck`.
5. Outside checks, as in the F349 release, using only refusals that cost nothing: a GET is refused (405), no token is
   refused (401), a malformed token is refused (401), and a foreign origin is refused (403). No paid start is made as a
   check; the first paid start is the owner's real session in step 7.
6. Merge pull request B. This publishes the browser change.
7. The owner's real session on the new code: the 1- and 2-minute lengths start and charge as the rule says, the listening
   line shows while running and not after the session ends, no 429 `rate_limited` or `budget` appears in a session that
   should be within its budget, and the delay text is compared with what the owner sees.

**Why this order.** The migration only widens what is allowed, so the old function and the old browser keep working after
steps 3 and 4. A new browser before the new server would have 1-minute and 2-minute starts refused, so the server goes
first. The order is kept as written.

## Release record (2026-11-17)

Done in the order above, each step on the owner's yes given the same day (executed unless marked).

- **Step 1 (real session on the F349 fixes):** the supervisor ran two 5-minute sessions in the owner's Chrome on
  2026-11-17 (22:25 to 22:30 and 22:32 to 22:37 UTC). This record uses them for step 1. They were run by the supervisor
  at the owner's request, with the owner accepting Chrome's sharing prompt, and both ended before pull request 167 was
  merged.
- **Steps 2 and 3:** pull request 167 merged (`bdad3eef`). The live rule (`IN (5, 10, 15)`) and the active-session count
  were read first; no session was active. Migration `20261119090000_factcheck_session_lengths.sql` applied by
  `supabase db query --linked -f` with its header; verified afterwards (rule lists 1, 2, 5, 10 and 15; settings and
  SECURITY DEFINER unchanged; service role may execute, anon and authenticated may not). History row written by hand.
- **Step 4:** function `factcheck` version 5 deployed from `bdad3eef`.
- **Step 5:** outside checks as in the F349 release: GET 405, no token 401, bad token 401, foreign origin 403. No paid start.
- **Step 6:** pull request 168 merged (`c76e0b58`); main CI passed and the production deployment completed. Pull request 166
  (spec and plan) merged as `246e934e`.
- **Step 7 (not done):** no real 1-minute or 2-minute session yet. Chrome's sharing prompt was not accepted on two
  attempts (nobody was at the browser). The panel showed "Your browser did not allow tab sharing" and "Nothing was
  charged", then offered only "Close". The server has no session row for these attempts (checked). The "Listening…"
  line has not been seen in a real session.

**Observed on the live site (executed):** five length options, 5 minutes selected by default; 1 minute changes the start
button to "Start 1 minute · 500 credits".

**Open question: the "failed twice in a row" count.** The F349 plan has no wording on this count. The design is in code:
`captureFailures` counts `blocked` and `failed` and not `denied` ([factCheckController.js](../../src/shell/factcheck/factCheckController.js)
lines 55 to 56). The browser's `NotAllowedError` (the user dismissing or declining the prompt) maps to `denied` and does
not count ([capture.js](../../src/lib/factcheck/capture.js) lines 37 to 43). The text the panel showed is the `blocked`
text ([factCheckText.js](../../src/shell/factcheck/factCheckText.js) line 169), so by the code's own mapping these
attempts were `blocked`, not `denied`. What the browser reported is not established, and this record does not guess it.
A real session on the new code is the way to settle it.

**Not released or changed by this record:** 20 and 30 minutes stay held; the transcript is not faster (G1 failed; the
three untested routes are in the spec, "Not built after G1" and the options list).

## Rollback

Roll back in this order:

1. **Browser:** revert pull request B first.
2. **Function:** redeploy the previous version.
3. **`public.factcheck_start`:** re-apply the previous body from `20261116090000_factcheck.sql` (the list `IN (5, 10, 15)`).
4. **Table CHECK:** restore `IN (5, 10, 15)` only while no session row has 1 or 2 minutes (OD4). After that the wide rule
   must stay. The wide rule is harmless to code that offers only 5, 10 and 15.

## Risks

| Risk | Effect | Mitigation |
|---|---|---|
| The transcript is not faster | The owner's original request is not met by this plan | Stated in the spec; options (a) to (c) are recorded and not built |
| 1- and 2-minute sessions cost more per charged minute | Worst-case provider cost per charged minute rises | OD2 accepted by the owner |
| Database object replaced | A constraint is dropped and re-added | OD4 accepted; one transaction; applied only when no session is active; rollback limit stated |
| First verdict is late in a one-minute session | The first verdict may arrive about 25 to 35 s in (inferred, not measured), and about half the verdicts arrive during "Finishing…" (`FactCheckPanel.jsx:410`) | Accepted: a one-minute session is a cheap trial |
| The delay figure is an estimate | The 14 s in the panel is G1's estimate, not a measurement of a real session | The owner's real session is the final check (release step 7) |
| Browser change released before the server | 1- and 2-minute starts refused | Release order (server first) |

## Checkpoints

- **After T1 and T2 (pull request A):** both test suites pass, the SQL fixture proves itself non-vacuous, the drift guard
  refuses a changed body in a test, the build is unchanged, and `router import ok` is printed.
- **After T5 (pull request B):** lint, build, bundle check and unit tests pass; the reviewer's findings are resolved; the
  first-load limit is unchanged.
