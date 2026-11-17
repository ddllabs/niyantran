# F350 plan: shorter audio pieces, a listening line, and session lengths of 1, 2, 5, 10 and 15 minutes

> **Status: Living.** Written 2026-11-17 on branch `task/f350-plan`. Revised the same day after an independent review
> (approve with changes; see the spec's "Review" section). Not built. Gate G1 not run.
> Tracker: F350 in [open-work](open-work.md). Spec: [F350 spec](../specs/2026-11-17-f350-shorter-pieces-and-session-lengths.md),
> which holds the reasons, the decisions S1 to S10, the open decisions OD1 to OD5, the gate method and the acceptance
> evidence. Code references are in the spec (read at `main` `7034e9f7`).

## What it delivers

- Transcript text closer to real time, from pieces of about 5 seconds (S1), if gate G1 passes. Otherwise the fallback of
  about 7 seconds, or no change to the pieces.
- A "Listening…" line at the foot of the transcript while the session is running. It is not announced to screen readers.
- Session lengths of 1, 2, 5, 10 and 15 minutes, in all four places that enforce them.
- Claim extraction unchanged in seconds of audio, so verdict timing, extract cost and session budgets stay as they are.

## Not in this plan

- Lengths 20 and 30 minutes (held until the F349 fixes are proven by a real session).
- Live TV as its own page, sharing switched on, and streaming transcription (later items, each with its own spec).
- Any change to price, hold, settlement, checks or re-checks.
- Any change to the earlier-context read, which stays at 12 pieces (S4).

## Dependencies and gate

- **OD1** (recorded clips for G1) must be answered before T0 can run. The owner's choice is between route A and route B
  (see the spec). The recommendation is B.
- **Gate G1** decides the piece setting (S1) and the delay figure (S8). It blocks only the values in T3 and T5. T1, T2
  and the structure of T3 to T5 can be built before it.
- **Owner's real session on the F349 fixes** must happen before any release (release step 1).

## Fixed interfaces

These are fixed before any build starts, so that the server and browser pull requests agree.

- **Turn rules** (`src/lib/factcheck/pieces.js`): exported constants `TURN_MAX_MS = 20000` and `TURN_MIN_MS = 10000`.
  The span of a turn is from the start of its first piece to the end of its last piece. After a piece that has text is
  added, the turn closes when the span is `TURN_MAX_MS` or more; or when that piece ended at `LONG_PAUSE_MS` (700) or
  more and the span is `TURN_MIN_MS` or more; or when it holds 12 pieces. A piece with no text is never added. It closes
  the open turn only if the span to the end of that empty piece is `TURN_MIN_MS` or more; otherwise the turn stays open.
- **Piece defaults** (`PIECE_DEFAULTS`): `targetMs`, `minMs` and `maxMs` take the G1 values (5000, 4000, 6000 under S1, or
  the fallback 7000, 5500, 8500). `overlapMs` stays 1000.
- **Listening line** (`src/shell/factcheck/FactCheckPanel.jsx`): no snapshot field and no controller change. The line
  is shown while the session status is `running` and no silence notice is showing. It has its own React key. The
  autoscroll trigger (`FactCheckPanel.jsx:155`) includes it.
- **Browser lengths** (`src/shell/factcheck/factCheckText.js:5`): `MINUTE_CHOICES = [1, 2, 5, 10, 15]`. A constant
  `DELAY_SECONDS` replaces the literal "13" (value from G1, S8).
- **Server limits** (`supabase/migrations/20261119090000_factcheck_lengths_and_piece_limits.sql`):
  - transcribe limit 24 per user per calendar minute in `public.factcheck_touch` (S3);
  - stored-piece cap 240 per session in `public.factcheck_piece_store` (S4);
  - `minutes_bought IN (1, 2, 5, 10, 15)` in the table CHECK and `p_minutes IN (1, 2, 5, 10, 15)` in
    `public.factcheck_start` (S5).
- **Refusal code** `bad_minutes` is unchanged. The Edge Function message in `start.ts` becomes "minutes must be 1, 2, 5, 10
  or 15." (the status and reason stay as they are).
- **Earlier context** stays at 12 pieces in `extract.ts` (S4). No constant is added.
- **Failure limit** `LIMITS.failureLimit` (`session.js:54`) rises from 3 to 5, only if the piece length changes (S10).

## Write scopes

| Task | Owner | Write scope (exclusive) |
|---|---|---|
| T0 | supervisor with a builder | none in the repository; the spec table and the constants in T3 and T5 |
| T1 | builder | `supabase/migrations/20261119090000_factcheck_lengths_and_piece_limits.sql`, `supabase/tests/factcheck_lengths.sql`, `supabase/tests/run.sh` |
| T2 | builder | `supabase/functions/factcheck/start.ts`, `start_test.ts`, a comment in `wav.ts` |
| T3 | builder | `src/lib/factcheck/pieces.js`, `pieces.test.js`, `capture.test.js` |
| T4 | builder, after T3 | `src/lib/factcheck/session.js`, `session.test.js` |
| T5 | builder, parallel with T3 and T4 once the interfaces are fixed | `src/shell/factcheck/factCheckText.js`, `FactCheckPanel.jsx`, `factCheck.css`, `FactCheckPanel.test.jsx`, `fixtures/` |
| T6 | reviewer (not the builder of the pull request) | none; comments only |

`src/shell/factcheck/factCheckController.js` is not in any write scope, because the controller needs no change.
`supabase/tests/factcheck.sql` is not in any write scope (see the spec, "Tests that pin the current behaviour").

Two pull requests keep the server and browser apart so that the server can be released first:

- **Pull request A** on branch `task/f350-server`: T1 and T2.
- **Pull request B** on branch `task/f350-browser`: T3, T4 and T5. It may be built in parallel with A, but it is merged
  only after A is released.

Builders leave their work uncommitted. The supervisor reproduces the evidence and makes the commits.

## Tasks

Run in the order below except where stated. Each task starts with a failing test that shows what it fixes, except T0.

**T0. Gate G1 (supervisor with a builder; outside the repository).** Depends on OD1.
- Record the four clips (route A or B). Raw output stays outside the repository.
- Run G1 as the spec defines it, including the delay definition (the cutter's hold is included). Record the table under
  "Gate results" in the spec.
- Choose the piece setting (S1 or the fallback, or no change). Fix the delay constant (S8).
- Acceptance: the table is complete, and the choice follows the pass rule in the spec. If no setting passes, S1 says
  the piece length stays. Then the turn rules of T3 are not released (they only make sense with shorter pieces), and
  T4, T5 and the server tasks ship without the piece change. The failure limit (S10) is not changed.
- Verification: the spec table and the measurement log. No repository command.

**T1. Server: lengths, transcribe limit and stored-piece cap (builder; pull request A).** Depends on nothing.
- Write `supabase/tests/factcheck_lengths.sql` first. Its checks are those listed under "SQL fixture" in the spec, and each
  must fail against the current migrations.
- Register it in `supabase/tests/run.sh` as a chain on `factcheck_fail_reason` plus the new migration, the same pattern as
  `factcheck_fail_reason` at `run.sh:200-202`. The vacuity check drops the chain's last file (`run.sh:412-430`).
- Write the migration `20261119090000_factcheck_lengths_and_piece_limits.sql`. Its header comment states the new reason for
  the transcribe limit of 24 (S3) and for the stored-piece cap of 240 (S4).
  - The table CHECK on `minutes_bought` is anonymous in `20261116090000_factcheck.sql:81`. Its name is expected to be
    `factcheck_sessions_minutes_bought_check`. The builder confirms the name in `pg_constraint` on the local database
    before writing the drop. The drop and the re-add run in one transaction, with `IN (1, 2, 5, 10, 15)`.
  - `CREATE OR REPLACE` for each of three functions. Each is defined once:
    - `public.factcheck_start` (`20261116090000_factcheck.sql:277`), with `p_expected_cpm numeric DEFAULT NULL`;
    - `public.factcheck_touch` (`20261116090000_factcheck.sql:369`);
    - `public.factcheck_piece_store(uuid, uuid, integer, numeric, numeric, text)` (`20261117090000_factcheck_sharing.sql:243`).
    Each is `LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC'` (read by the reviewer; the builder
    confirms it). Every one of these must be repeated exactly in the `CREATE OR REPLACE`. Grants survive a replace.
  - Copy each body from the latest migration that defines it. Change only the stated values: `p_minutes IN (1, 2, 5, 10, 15)`;
    the transcribe limit `24` in place of `10` (`:423`); the stored-piece cap `240` in place of `120`
    (`factcheck_sharing.sql:271`). Check the F349 migration `20261118090000_factcheck_fail_reason.sql` for changes to these
    bodies first.
  - **Drift guard.** Before replacing each function, the migration compares the md5 of its `prosrc` with the md5 of the
    body the repository was written against, or with the md5 of the new body (so re-applying is a no-op). Anything else
    stops the migration with `55000` before it changes a thing. The pattern is `20261116100000_factcheck_usage_reports.sql:39-62`.
- Edit `supabase/tests/run.sh` only. `supabase/tests/factcheck.sql` is not edited (see the spec).
- Acceptance: the fixture passes on the new migrations, and fails when the new migration is removed (the run proves it is
  not vacuous).
- Verification: `npm run test:sql`, which runs on disposable containers and includes the vacuity proof.

**T2. Server: Edge Function (builder; pull request A).** Depends on nothing; parallel with T1.
- `start.ts:101` accepts `[1, 2, 5, 10, 15]`; the message at `:154` changes to "minutes must be 1, 2, 5, 10 or 15.".
  Test first in `start_test.ts` (`:144-161`): lengths 1, 2, 5, 10, 15 accepted; 0, 3, 4, 7, 20, 30 refused.
- `wav.ts`: a comment only, noting the piece length of 4 to 6 s (no change to limits: 0.5 s to 15 s, 600,000 bytes).
- `extract.ts` is not changed (S4). The earlier-context read stays at 12 pieces, because the SQL function refuses any
  range over 12 (`20261117090000_factcheck_sharing.sql:299`).
- Acceptance: the deno test command passes; the new tests fail first.
- Verification: `deno test -A --config supabase/functions/deno.json supabase/functions`.

**T3. Browser: piece cutting and turns (builder; pull request B).** Depends on T0 for the values.
- `pieces.js`: `PIECE_DEFAULTS` takes the G1 values. Add `TURN_MAX_MS` and `TURN_MIN_MS`. Replace the two-piece rule in
  `createTurnBuilder` (`pieces.js:297-330`) with the span rule in the spec (S2). Update the comments at `pieces.js:4` and
  `:296`, which describe "about 10 s" and "at most two pieces".
- Tests to rewrite first (each fails against the current values): the boundary tests at `pieces.test.js:32-75`,
  `:92-101` and `:120-139`, and the quiet-window tests at `:126-152`.
- `capture.test.js:189-196` is updated to the new piece values (the expected pieces and the WAV length).
- New tests first, each seen failing:
  - a pause before 10 s does not close a turn;
  - a span of 20 s closes a turn;
  - 12 pieces close a turn;
  - an empty piece before 10 s does not close the turn;
  - an empty piece after 10 s does close it;
  - a single 5 s piece is not produced as a turn, except by the final flush.
- Acceptance: all `pieces.test.js` and `capture.test.js` tests pass with the new values; the new tests fail before the change.
- Verification: `npm test -- src/lib/factcheck/pieces.test.js src/lib/factcheck/capture.test.js` (focused), then the full
  gates at the end.

**T4. Browser: session (builder, after T3; pull request B).**
- `session.js`: the comments at `:36-37`, which describe "about 10 s" pieces, are updated.
- `LIMITS.failureLimit` (`session.js:54`) rises from 3 to 5, only if the piece length changes (S10). Test first in
  `session.test.js`: five consecutive failed calls end the session; four do not.
- `session.test.js`: test helpers take the new piece length. Failing tests first at `:20`, `:991-1003`, `:1134`, `:1198`,
  `:1259` and `:1360` (check each; they assume 10 s pieces).
- No `awaitingText` field is added (S7).
- Acceptance and verification as T3.

**T5. Browser: lengths, listening line and copy (builder, parallel with T3 and T4 once the interfaces are fixed;
pull request B).**
- `factCheckText.js:5`: `MINUTE_CHOICES = [1, 2, 5, 10, 15]`. Add `DELAY_SECONDS` (from G1). Replace the literal in the
  "Listening…" text at `FactCheckPanel.jsx:466` and the test at `FactCheckPanel.test.jsx:173-177`.
- `FactCheckPanel.jsx:91` and `:117`: singular "1 minute" through a helper. Test first.
- `FactCheckPanel.jsx:67`: default selection per S6. Test: 5 minutes when affordable; the longest affordable length below
  5 otherwise. Test first.
- `FactCheckPanel.jsx:509`: "Start a new session · from …" uses the lowest price (500 credits). Test first.
- `FactCheckPanel.test.jsx:75-96` and `:120`: the choice now lists five buttons. The default "Start 5 minutes · 2,500"
  is unchanged. Update the expectations first.
- Listening line (S7): add a last transcript line "Listening…" after the existing lines while the status is `running`
  and no silence notice is showing (the notice starts at `SILENT_NOTICE_MS` 30000, `FactCheckPanel.jsx:14`). Give it its own
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
- Review pull request B (browser) second, against the turn rules and the listening line.
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
7. The owner's real session on the new code: transcript delay measured, no 429 `rate_limited` on transcribe in the
   function log, extract calls per minute no higher than before.

**Why this order.** The migration only widens what is allowed, so the old function and the old browser keep working after
steps 3 and 4. With S4 as revised, the new function with the old browser has no known defect. A new browser before the new
server would have 1-minute starts refused and transcribe calls rate-limited. The order is kept as written.

## Rollback

Roll back in this order, so that no browser is left without the limit it needs:

1. **Browser:** revert pull request B first.
2. **Function:** redeploy the previous version.
3. **Migration function bodies:** re-apply the previous bodies from `20261116090000_factcheck.sql`,
   `20261117090000_factcheck_sharing.sql` and `20261118090000_factcheck_fail_reason.sql` (whichever defines each body).
   Restoring the transcribe limit of 10 while the new browser is live would rate-limit every session.
4. **Table CHECK:** restore `IN (5, 10, 15)` only while no session row has 1 or 2 minutes (OD4). After that the wide rule
   must stay.

## Risks

| Risk | Effect | Mitigation |
|---|---|---|
| G1 fails at 5 s | Piece length does not change | Fallback 7 s under S1, tested by the same gate; then no change |
| More requests per minute | About 12 instead of 6 a minute per session in Edge Function invocations and log rows | Transcribe limit 24 (S3); monitored in the first real session |
| Worst-case audio per minute rises | A client that is not our browser could send 24 × 15 s = 360 s of audio a minute, against 150 s today | OD2; server maximum to be lowered to about 8 s before the audience becomes "all" |
| Transcription cost rises a little | The 1 s overlap is a larger share of each piece, about 20% of posted audio instead of about 9% | Measured in G1 (the cost column) |
| Fewer pauses found in a 2 s window | More hard cuts, which may split words | Measured in G1 (the pause share column) |
| The browser cannot keep up | Two calls at once: reply time must stay under about twice the piece length | Reply time measured in G1; observed in the real session |
| Earlier context halves | About one minute of earlier context instead of about two | Accepted (S4); sharing is off, so no live effect yet |
| Merged ranged turns shorter | A merged ranged turn reaches 12 pieces at about 60 s instead of about 120 s, then falls back to a text turn that is not shared | Accepted while sharing is off |
| Turn left open at session end | Up to about 20 s of audio is lost if the drain expires or the session ends without draining (today about 12 s) | Accepted (S2) |
| Storage cap reached | Stored pieces stop for long sessions | Cap 240 (S4); sharing is off today, so no live effect yet |
| Repeated words at joins when sharing is on | Shared stretches show raw piece text without overlap removal (`20261117090000_factcheck_sharing.sql:366`), so repeated words at joins appear about twice as often | Follow-up before sharing is switched on |
| First verdict is late in a one-minute session | The first verdict may arrive about 25 to 35 s in (inferred, not measured), and about half the verdicts arrive during "Finishing…" (`FactCheckPanel.jsx:410`) | Accepted: a one-minute session is a cheap trial |
| Short sessions cost more per charged minute | Worst-case spend per minute rises for 1- and 2-minute sessions | OD2; accepted while the audience is "admin" |
| Database object replaced | A constraint is dropped and re-added | OD4, in one transaction, with the rollback limit stated; apply only when no session is active |

## Checkpoints

- **After T0:** the spec's gate table is complete and the piece setting is chosen. Stop if G1 cannot be run (OD1 not
  answered).
- **After pull request A's tasks (T1, T2):** both test suites pass, the SQL fixture proves itself non-vacuous, the drift
  guard refuses a changed body in a test, the build is unchanged, and `router import ok` is printed.
- **After pull request B's tasks (T3 to T5):** lint, build, bundle check and unit tests pass; the reviewer's findings are
  resolved; the first-load limit is unchanged.
