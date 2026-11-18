# F362: Live TV fact-check — admin screen for reports

> **Status: Living.** Written 2026-11-18 from code read on branch `task/f362-admin-reports`. Not built. Builds on the
> [F344 spec](2026-11-15-live-tv-fact-check.md) (sharing and reports, migration `20261117090000`). Tracked as F362 in
> `docs/plans/open-work.md` once the supervisor adds the line (not yet present).

Evidence marks: **read** = seen in this checkout (file:line); **executed** = run, with the date; **not established** = neither
read nor run. No SQL was run and no request was made against the live project for this spec.

## Summary

- Users can report a shared fact-check claim. The reports are saved, but no screen shows them to an administrator.
- The database already has three administrator-only functions that act on reports: hide a claim, dismiss its reports, and
  remove a video's shared results. Nothing in the browser, the server, the API or the Edge functions calls them (read: a
  search of `src/`, `server/`, `api/` and `supabase/functions/` found no caller).
- This spec adds one read-only administrator function that lists open reports, grouped by claim, and one page in the admin
  area that lists them and runs the three existing actions after a confirmation.
- No table policy is widened. No existing function changes unless the reading below shows it must.

## Problem

- An administrator has no place to see reported claims. A report can be saved and then nothing happens to it.
- The three actions exist but are reachable only by calling the database directly.
- Reports are the only way the owner learns that a shared claim is wrong or abusive. Without a list, the actions cannot be
  taken on purpose.

## Current state (read)

### Tables and columns

- `public.factcheck_sessions`, `supabase/migrations/20261116090000_factcheck.sql:74-96`. Columns used here: `id`, `user_id`,
  `video_id` (text, 1–32), `channel_id` (text, 1–64), `video_kind` (`live` or `recorded`), `status` (`active` or `settled`),
  `started_at`, `ended_at`. The channel id exists only on sessions, not on claims.
- `public.factcheck_claims`, `supabase/migrations/20261116090000_factcheck.sql:99-119`. Columns used here: `id`, `session_id`,
  `user_id`, `video_id`, `video_kind`, `position_s`, `spoken_at`, `quote` (1–300), `claim_en` (1–500), `claimant` (≤200),
  `reported_by` (≤200), `kind`, `status` (`pending`, `checked`, `needs_context`, `not_checkable`, `error`), `verdict`
  (`supported`, `contradicted`, `partly_true`, `no_evidence`, `opinion`, or null), `reason` (≤400), `sources` (jsonb array,
  at most 8 items), `checked_at`, `supersedes`. A claim has a composite foreign key to its session and user, with cascade.
- Columns added by `supabase/migrations/20261117090000_factcheck_sharing.sql`: `factcheck_sessions.shareable` (boolean,
  default false, line 70); `factcheck_claims.shared` (boolean, default false, line 71); `factcheck_claims.hidden_at`
  (timestamptz, line 72).
- `public.factcheck_claims.fail_reason` added by `supabase/migrations/20261118090000_factcheck_fail_reason.sql:29`. Not used
  by this screen.
- `sources` items are `{ url, title }` (read: `supabase/functions/factcheck/types.ts:19-22`). The Edge function accepts only
  `http:` and `https:` URLs when it writes them (read: `supabase/functions/factcheck/check.ts:89`). Stored rows made before
  that check, if any, are not established.
- `public.factcheck_reports`, `supabase/migrations/20261117090000_factcheck_sharing.sql:101-110`:
  - `id` uuid primary key; `claim_id` uuid, foreign key to `factcheck_claims(id)`, cascade;
  - `user_id` uuid, foreign key to `auth.users(id)`, cascade;
  - `reason` text, default `''`, at most 300 characters (check);
  - `created_at` timestamptz, default now(); `handled_at` timestamptz, nullable;
  - unique `(claim_id, user_id)` (`factcheck_reports_once`); index `(user_id, created_at desc)` (line 110).

### Row-level security and grants

- `factcheck_reports` has row-level security on (line 131). One policy: `factcheck_reports_select`, for select, to
  `authenticated`, `using (user_id = (select auth.uid()))` (lines 134-135). So a signed-in user reads only their own reports.
- Grants on `factcheck_reports` (lines 136-138): revoke all from public, anon, authenticated and service_role; then select
  to `authenticated` and to `service_role`. No insert, update or delete grant to any API role.
- Sessions and claims (`supabase/migrations/20261116090000_factcheck.sql:153-163`): sessions select and delete for the owner
  (delete only for a settled live session); claims select for the owner. Grants: sessions select and delete to
  `authenticated`; claims select to `authenticated`; service_role has select on sessions and select, insert, update on claims.
- Other rows are not readable by an administrator through the API. Administrators have no table policy that reads other
  users' reports, sessions or claims (read: no such policy in the two migrations).

### How a report is made (`factcheck_report`)

- `public.factcheck_report(p_user uuid, p_claim uuid, p_reason text)`, `20261117090000_factcheck_sharing.sql:474-505`.
  Grant: service_role only (line 565-572). Not callable by `authenticated`.
- Refused with `reason: 'off'` when `private.factcheck_share_flag()` is null (line 480 region), so reports can exist only while
  sharing has been on at the time of the call.
- The claim lookup (lines 478-486) allows a claim when either:
  - (a) the claim belongs to the reporter (`x.user_id = p_user`), with no check on `shared`, `hidden_at` or the session; or
  - (b) the claim is shared, not hidden, not superseded, not pending, of a settled shareable recorded session, and the
    reporter has unlocked that session.
- Duplicate report by the same user on the same claim: `reason: 'already'` (line 496). More than 10 reports by the user in
  24 hours: `reason: 'rate_limited'` (line 499). Otherwise one row is inserted with `reason` set to the text given (line 502).

### The three administrator functions

All three are `SECURITY DEFINER`, `SET search_path = ''`, `SET TimeZone = 'UTC'`, `LANGUAGE plpgsql`, and return `jsonb`.
Each starts with `IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'Platform administrators only' USING ERRCODE = '42501';`.
Grants (lines 551-574): revoke all from public, anon, authenticated and service_role; then execute to `authenticated` only.
No anon or service_role execute grant.

1. `public.factcheck_claim_hide(p_claim uuid) returns jsonb` (lines 507-520).
   - Sets `factcheck_claims.hidden_at = coalesce(hidden_at, now())` for the claim. Idempotent: a second call keeps the first time.
   - If no claim matched: returns `{ "ok": false, "reason": "not_found" }`. Note: this is a return value, not an error. The
     caller must read `ok`.
   - Otherwise sets `handled_at = now()` on every report of that claim whose `handled_at` is null, then returns `{ "ok": true }`.
   - Effect on shared results: the claim is left out of every other user's view, because the view filters
     `hidden_at IS NULL` (read: `20261118090000_factcheck_fail_reason.sql:88-104`, the view's filter at line 104). It is not
     deleted. The claim's `shared` flag stays as it was. Unlocks are not changed.
   - Reversal: no function in the reading un-hides a claim. Not established whether any other path clears `hidden_at`.

2. `public.factcheck_report_dismiss(p_claim uuid) returns jsonb` (lines 522-534).
   - If the claim does not exist: `{ "ok": false, "reason": "not_found" }`.
   - Otherwise sets `handled_at = now()` on the claim's open reports and returns `{ "ok": true }`. It does not change
     `hidden_at`, `shared` or any claim column.
   - Effect on shared results: none. The claim stays visible to others. The reports are marked handled, which also clears the
     `reported` flag the view shows to viewers (read: `20261118090000_factcheck_fail_reason.sql:99`, which counts only reports
     with `handled_at IS NULL`).
   - Dismissing a claim with no open reports returns `{ "ok": true }`. Not an error.

3. `public.factcheck_video_remove(p_video_id text) returns jsonb` (lines 536-549).
   - Deletes every row of `private.factcheck_pieces` for the video (the stored transcript pieces). Counts them.
   - Sets `factcheck_sessions.shareable = false` on every session of that video that was shareable. Counts them.
   - Returns `{ "ok": true, "pieces_deleted": n, "sessions": m }`. It returns ok even when both counts are 0.
   - Effect on shared results: the video's stretches drop out of the shared listing, because the view requires `shareable`
     (read: `20261118090000_factcheck_fail_reason.sql:74`). The claims keep `shared = true`, unlocks are not deleted, and
     reports are not handled. Reports on the video's claims stay open after the removal.
   - Reversal: no function in the reading sets `shareable` back to true except `factcheck_mark_shareable`, which works only
     on an active recorded session (read: `20261117090000_factcheck_sharing.sql:221-236`). A settled session cannot be
     made shareable again by any function in the reading. The deleted pieces are not recoverable from the database.
   - The removal is not limited to one user. It applies to every user's sessions of that video id.

### The administrator check in the database

- `public.is_platform_admin()`, defined in `backend/sql/auth_schema.sql:441-455`: `SQL`, `STABLE`, `SECURITY DEFINER`,
  `search_path = public`. Returns true when `public.user_profiles` has a row with `user_id = auth.uid()`, `role = 'admin'`
  and `status = 'active'`. A null `auth.uid()` gives false.
- The search path was later set to `''` by `supabase/migrations/20260921000012_profile_authority.sql:111`.
- The function is not defined in `supabase/migrations`; the test bootstrap loads `backend/sql/auth_schema.sql`
  (`supabase/tests/run.sh`, chain for `factcheck`, and `supabase/tests/factcheck_sharing.sql` header).
- EXECUTE grants on `is_platform_admin()`: not established.

### Existing admin read functions (patterns to follow)

- `public.admin_corpus_readiness(p jsonb)`, `supabase/migrations/20261027231901_admin_corpus_readiness.sql:43-49`:
  `language plpgsql stable security definer set search_path=''`. First statement checks
  `auth.uid() is null or not coalesce(public.is_platform_admin(),false)` and raises `42501` ("platform admins only").
  Revoke from public, anon, authenticated, service_role at line 130. Limit is checked to 1–100. Paging is by cursor, not offset.
- `public.feed_admin_status()`, `supabase/migrations/20261015160000_feed_admin.sql`: `language plpgsql stable security definer
  set search_path = ''`. Raises `42501` at line 70 when the caller is not an admin. Execute granted to `authenticated` at
  line 102. Its fixture `supabase/tests/feed_admin.sql` asserts the grants (lines 46-49, anon cannot execute).
- `public.admin_unlinked_documents(p_tier, p_feature, p_query, p_limit int, p_offset int) returns jsonb`,
  `supabase/migrations/20261001180000_corpus_records.sql:927-935`. Limit is clamped to 1–50 with default 50
  (`least(greatest(coalesce(p_limit, 50), 1), 50)`), offset to 0 or more. This function's header shows no
  `SECURITY DEFINER` and `set search_path = public, extensions`. Its return shape beyond the declarations: not established.
- Paging with a total count: the admin users list is paged (read: `src/admin/AdminPages.jsx:140` and `src/admin/AdminApp.jsx:199`,
  ). The exact total field name returned by `admin_unlinked_documents`: not established.

### Browser side

- The admin shell is `src/admin/AdminApp.jsx`.
  - `NAV` array: lines 18-25 (`overview`, `apis`, `users`, `ai`, `personas`, `documents`, `site`).
  - Hash routing: `viewFromHash` at lines 28-35 returns the id if it is in `NAV`, otherwise `overview`. `go(id)` sets
    `location.hash` (lines 126-131).
  - Render list: lines 202-212, one `view === '<id>' && <Page />` line per page. `DocumentsPage` is loaded with `React.lazy`
    (line 16).
  - Supabase client: `import { supabase } from '../lib/supabaseClient.js'` (line 3).
  - The shell's authenticated state is `authed` (line 41). The exact rule that hides pages from a signed-out visitor was not
    read in full (lines 140-160 not opened): not established.
- The admin session gate is `verifyAdminSession` in `src/admin/adminSession.js:12-56`. It calls `client.rpc('is_platform_admin')`
  and `client.rpc('get_my_profile')`. Its own comment says it is a UI gate only and that every protected backend operation
  must authorize independently (`adminSession.js:11`).
- Admin pages that call database functions directly: `src/admin/feedAdmin.js:179-200`, `loadFeedStore(client)`, calls
  `client.rpc('feed_admin_status')` and `client.rpc('db_size')`, catches a thrown error, and returns
  `{ status: 'error' | 'notSetUp' | 'ready', ... }`. On an error it passes the server's `message` text through (line 191).
- Admin pages that call a server route instead: `src/admin/userCredits.js` posts to `/api/users/:id/credits` with the
  verified token. This is not the pattern for database reads.
- Tests for admin modules: vitest, `npm test` = `vitest run` (`package.json:16`). Pattern: pure functions in a `.js` module
  with a `*.test.js` beside it (`src/admin/feedAdmin.test.js`, `src/admin/userCredits.test.js`).
- Lint: `npm run lint` is ESLint over `src`, `server`, `api`, `scripts`, with `--max-warnings 0` (`package.json:19`).
  Bundle check: `npm run check:bundle` (`package.json:12`, `scripts/check-bundle.mjs`). The rules in `scripts/check-bundle.mjs`
  were not read: not established.

### SQL fixtures and their registration

- `supabase/tests/run.sh`. Each fixture has a `chain()` case that lists its bootstrap files in order, the last being the
  migration under test applied as a non-superuser (`as_non_superuser`).
- The newest fact-check chain is `factcheck_lengths` (run.sh:203-207), which chains `factcheck_fail_reason`, then
  `20261119090000_factcheck_session_lengths.sql`. Earlier: `factcheck_fail_reason` (lines 199-202), `factcheck_sharing`
  (lines 194-197).
- Default run: every `supabase/tests/*.sql` file except `bootstrap_*`, `credit_paise_seed` and `credit_paise_atomic`
  (run.sh, end of file). A new fixture with no `chain()` case fails as an unknown fixture (run.sh:1368-1374).
- Vacuity check: `vacuity_check()` (run.sh:417-432) runs the chain without the last file in `FILES` and requires the fixture
  to fail. A fixture that still passes is reported as `VACUITY FAIL`. It runs by default; `VACUITY=0` skips it.
- The existing sharing fixture is `supabase/tests/factcheck_sharing.sql` (887 lines). Its users are numbered 01 to 11; 09 is an
  administrator and 10 is a non-administrator (header line 10; `user_profiles` update lines 744-745). It checks the three
  administrator functions' grants (lines 162-168). Whether it tests their behaviour (refusal, the `ok` values, the effects
  above): not established.
- Concurrency companion: `supabase/tests/factcheck_sharing_concurrency.sh` is run for `factcheck_sharing` (run.sh:1415).

### Who may run the three administrator functions today

- `authenticated`, if `is_platform_admin()` is true. Any other signed-in user gets `42501`. Anonymous callers have no execute grant.

### Callers

- No caller of `factcheck_claim_hide`, `factcheck_report_dismiss` or `factcheck_video_remove` exists in `src/`, `server/`,
  `api/` or `supabase/functions/` (read: search by name).
- The browser reads its own sessions and claims through the Live TV page (F359 and F360 specs). It does not read reports.

### Facts the screen depends on

- A report is visible to its reporter only (RLS, lines 134-135). It is never returned to the claim's owner or to others.
- A report on a claim that is not shared can exist. The owner branch of `factcheck_report` (lines 478-481) does not check
  `shared` or `hidden_at`. So a user can report their own private claim, while sharing is on. See Open questions, Q1.
- A report on a hidden claim can exist with `handled_at` null, for the same reason. See Open questions, Q2.

### Not established

- Whether any of these migrations, or the database fixtures, have been applied to the live database. No live query was run.
- Whether sharing is on in the live flag row, and whether any report exists in the live database.
- EXECUTE grants on `public.is_platform_admin()`.
- Whether the sharing fixture tests the behaviour of the three administrator functions (only their grants were read).
- The return shape of `admin_unlinked_documents` beyond its declarations.
- The rule that hides admin pages from a signed-out visitor (`AdminApp.jsx` lines 140-160).
- Whether any stored source URL predates the Edge function's http/https check.
- Whether `scripts/check-bundle.mjs` would flag a new admin page.
- Whether `supabase/migrations/20261119090000_factcheck_session_lengths.sql` changes any function this spec uses. Its definitions were grepped: only `public.factcheck_start` is redefined. Its full body was not read.

## Decisions

These are recorded as decided. They are not changed here.

- **D1.** One new migration adds one read function for administrators, e.g. `public.factcheck_reports_admin(p_offset integer,
  p_limit integer)` returning `jsonb`. `SECURITY DEFINER`, empty `search_path`, the administrator check done inside the function
  the same way the existing hide and dismiss functions do it (read: `RAISE EXCEPTION ... USING ERRCODE = '42501'` when
  `public.is_platform_admin()` is false, `20261117090000_factcheck_sharing.sql:510-512`). Executable by `authenticated` only.
  A non-administrator gets the `42501` exception and no rows. No table policy is widened.
  - Note: the existing admin functions refuse by raising. A refusal here is the same raise, not a `jsonb` value.
  - Note: the function name is an example. The migration name must sort after `20261119090000` (see Open questions, Q6).
- **D2.** Returns open reports grouped by claim, newest report first. Fields: claim id, video id, channel id, video kind, claim
  text, verdict, status, reason, sources, shared, hidden_at, number of reports, time of the newest report, and the reporters'
  reason texts (at most 10 per claim, each as stored). It does NOT return reporter or session-owner identities (no user ids,
  no emails).
  - Source of each field: claim id, video id, video kind, claim text (`claim_en`), verdict, status, reason, sources, shared,
    hidden_at from `factcheck_claims`; channel id from `factcheck_sessions.channel_id` (joined on `session_id`).
  - Reporter reason texts from `factcheck_reports.reason`.
  - The name `reason` is used twice (claim reason, reporter reason). The JSON keys must be distinct (Open questions, Q4).
- **D3.** "Open" means not dismissed and claim not hidden, as the existing functions define those states.
  - A report is open when `factcheck_reports.handled_at IS NULL`. Dismiss and hide both set `handled_at` (read:
    `20261117090000_factcheck_sharing.sql:517` and `:531`).
  - A claim is not hidden when `factcheck_claims.hidden_at IS NULL` (read: `:517`, set by hide).
  - So open = `handled_at IS NULL` AND the claim's `hidden_at IS NULL`. The second condition excludes an open report on a hidden
    claim, which the screen could then not reach (Open questions, Q2).
- **D4.** Paging: limit capped at 50; returns a total count.
- **D5.** Screen: a new page in the admin area (`src/admin/`), registered like the other admin pages, named "Fact-check
  reports". A list with the fields of D2. Per claim three actions using the EXISTING functions: Hide claim
  (`factcheck_claim_hide`), Dismiss reports (`factcheck_report_dismiss`), Remove this video's shared results
  (`factcheck_video_remove`). Each action has a two-step inline confirmation. "Remove" names the video id and says it cannot
  be undone. After an action the list reloads.
- **D6.** States: loading, empty ("No open reports."), error with Try again, action error. No raw server text on screen. Source
  links only `http:` and `https:`.
  - Note: `src/admin/feedAdmin.js:191` shows the server message as it is. This screen does not follow that.
  - Each of the three functions returns `ok` as a value. The screen must read `ok` and show the action error when it is false.
- **D7.** Report reason texts are user-written and untrusted: rendered as text only.
- **D8.** Works whether or not sharing is switched on (reports can only exist once sharing is on, so the list is normally empty
  until then). The function does not check `private.factcheck_share_flag()`.
- **D9.** No change to the existing functions unless the reading shows the screen cannot work without one; if so, say exactly
  what and why under Open questions. The reading found no such need. See Open questions, Q7 for the cases the screen cannot
  fully reach.

## Decisions on the points found while reading (2026-11-18)

These settle the open questions below where the supervisor can; the rest stay open for the owner.

- **D10. A user's report on their own unshared claim is listed with its claim text.** Reporting a claim asks for a
  review of it, and the list is visible to administrators only.
- **D11. "Open" means `handled_at IS NULL` only.** This replaces the "claim not hidden" half of D3: a report on a claim
  that is already hidden is still listed, marked as hidden, so that it can be dismissed. "Hide claim" is not offered
  on a claim that is already hidden.
- **D12. Channel id comes from the claim's session** (a join), because the claims table has no channel column.
- **D13. Two different keys:** `verdict_reason` for the claim's reason and `report_reasons` for the reporters' texts.
- **D14. "Remove this video's shared results" leaves its reports open**, as the existing function does. The
  confirmation says so, and the reports stay in the list until dismissed.
- **D15. A caller who is not an administrator gets error 42501**, as the existing hide, dismiss and remove functions
  do. The browser shows its fixed error text.
- **D16. Migration file name:** `20261121090000_factcheck_reports_admin.sql`. It must sort after every existing
  migration and after F361's `20261120090000`.
- **D17. Tracker.** The F362 entry is added by the close-out plan change; this branch does not edit the tracker.

## Open questions

- **Q1. Reports on claims that are not shared.** The owner branch of `factcheck_report` (`20261117090000_factcheck_sharing.sql:478-481`)
  lets a user report their own claim whether or not it is shared. Sharing needs to be on at the time, and the claim must
  belong to the reporter. D2 would then show that claim's text to administrators. Decide: (a) show it, (b) exclude
  claims with `shared = false` from the list, or (c) change `factcheck_report` (a change to an existing function, which D9
  forbids unless needed). Owner's decision.
- **Q2. Open reports on hidden claims.** D3 excludes them (claim hidden). Q1 and the owner branch can produce them. Decide
  whether they stay out of the list (as D3 says) or appear with a hidden marker so an administrator can dismiss them.
- **Q3. Removed videos.** After "Remove this video's shared results", reports on that video's claims stay open (the function
  does not handle them), so they stay in the list. Decide whether the list should hide reports for videos whose sessions are
  no longer shareable, or keep them until dismissed.
- **Q4. Reason key names.** D2 has two texts called "reason": the claim's reason (`factcheck_claims.reason`, at most 400
  characters, model-written) and the reporters' reasons (`factcheck_reports.reason`, at most 300 characters, user-written).
  Confirm the JSON key names, for example `verdict_reason` and `report_reasons`.
- **Q5. Claim text of other users.** The list shows `claim_en` and the video id. `claimant` and `reported_by` are not in D2. Confirm
  they stay out. The claim `quote` is not in D2 either; confirm.
- **Q6. Migration name and fixture chain.** The newest migration in `supabase/migrations` is `20261119090000_factcheck_session_lengths.sql`,
  dated after today (2026-11-18). The new migration must sort after it. The new fixture chains `factcheck_lengths` (run.sh:203-207).
  Confirm the timestamp. Also confirm the function name.
- **Q7. Actions the screen cannot fully reach.** `factcheck_claim_hide` and `factcheck_report_dismiss` affect only reports with
  `handled_at IS NULL`. `factcheck_video_remove` does not touch reports at all. So after Remove, the list still shows the
  video's open reports until each is dismissed. Confirm this is acceptable (D5 says the list reloads after each action).
- **Q8. Admin identity for the three actions.** The existing functions take no actor argument; they check `auth.uid()` through
  `is_platform_admin()`. The screen will not pass an admin id. Confirm no audit log is required (Out of scope says none beyond
  what exists; the existing functions write none).
- **Q9. F-number.** `docs/plans/open-work.md:183` says "F361 is next". This spec is F362, from the request. No line for F361 or
  F362 is in `open-work.md` (searched). The supervisor must add the F362 line, and confirm the number. Not changed here.
- **Q10. Repository commit state.** The session's initial status named branch `task/f361-session-lengths`, while the checkout
  is `task/f362-admin-reports`. The checkout is the one used here.

## Out of scope

- UI and UX polish beyond what D5 and D6 name.
- Notifications to reporters, or to the claim's owner.
- An audit log beyond what exists. The existing hide, dismiss and remove functions write no audit row (read).
- Any change to who is an administrator (`is_platform_admin()`, `user_profiles`).
- Any change to the three existing functions, unless Q1 or Q2 requires it (then D9 applies).
- Any change to sharing, flags, prices, unlocks, the fact-check Edge function, or the Live TV page.
- Any push, deployment, pull request, or change to `docs/plans/open-work.md` (the supervisor's step).

## Acceptance evidence

Each item needs a command and its result, recorded in the completion report.

1. **SQL fixture** `supabase/tests/factcheck_reports_admin.sql` (name to be confirmed), registered in `run.sh` with a `chain()`
   case that chains `factcheck_lengths` and then the new migration as a non-superuser. Shows:
   - an administrator gets rows, grouped by claim, newest report first;
   - a signed-in non-administrator is refused with `42501` and gets no rows;
   - an anonymous caller (no `auth.uid()`) is refused and gets no rows;
   - no user id or email appears in the output (checked by searching the jsonb text for the test users' ids and emails);
   - a dismissed report (`handled_at` set) and a report on a hidden claim are excluded (per D3, and Q2 as decided);
   - paging: offset and limit work, limit is capped at 50, and the total count is right;
   - grants: `authenticated` may execute, `anon` and `service_role` may not, `public` may not; no table grant or policy is added.
2. **Non-vacuity**: `./supabase/tests/run.sh factcheck_reports_admin` runs the vacuity check by default. The fixture must fail
   without the new migration, at a behavioural assertion. Record the output line.
3. **Data module and page tests** in `src/admin/` (vitest): the module shapes the rows, drops reporter identities, caps the reason
   list at 10, renders reason text as text only, and rejects non-http(s) source links. The page test shows: loading, empty
   ("No open reports."), error with Try again, action error, two-step confirmation for each action, the remove confirmation
   naming the video id, the list reloading after an action, and that the action calls the correct function name. Each test
   that guards a defect must be shown to fail without its fix.
4. `npm run lint` (must pass with zero warnings).
5. `npm run build`.
6. `npm run check:bundle`.
7. `npm test` (vitest).
8. `deno test -A --config supabase/functions/deno.json supabase/functions` (no Edge change expected; run anyway).
9. `./supabase/tests/run.sh factcheck_reports_admin` (the fixture only), and, before merge, the full `npm run test:sql` if the
   runner's time allows.
10. `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`. Not triggered by this scope (no change under
    `api/` or `server/`), but the user listed it; run it.

## Risks

- **Exposing other users' data to a non-administrator.** The function must refuse non-administrators. The fixture (item 1) is
  the guard. Q1 is a second route to private text, and must be decided before the build.
- **The page calls a destructive function by mistake.** Each action has a two-step confirmation. Tests check the function name
  each button calls. Remove is the only action that deletes data (pieces) and cannot be reversed by the database.
- **Reason texts with markup.** Rendered as text only (D7). Test with a value containing HTML.
- **Silent failures.** The three functions return `ok: false` without raising for "not found". The page must show an action error
  when `ok` is false, or a missed claim looks like success.
- **Stale list.** Two administrators can act on the same claim. The second action returns `ok` (idempotent for hide, for dismiss
  with no open reports), so no error is shown. Acceptable; say so in the page copy only if needed.

## Release

- The migration is applied on the live database by the supervisor, only after the owner's named approval, by the method the
  team uses for migrations. Not established in this checkout which method that is.
- The migration must be applied before the merge is used by the screen. Until then the screen shows its error state (the
  function does not exist).
- The browser build ships with the merge. No Edge Function change.
- No push, merge, deployment or pull request is authorized by this spec.

**Rollback.** Drop the new function (`drop function public.factcheck_reports_admin(integer, integer)`, or the final signature).
Revert the merge. The three existing functions and all data are unchanged by this work, so nothing else is rolled back.

## Plan

Each task has an exact write scope, a dependency, and a verification command. Tasks run in order.

- **T1. Migration and fixture.** Depends on: nothing.
  - Write scope: one new file in `supabase/migrations/` (name to be confirmed, sorted after `20261119090000`); one new file
    `supabase/tests/factcheck_reports_admin.sql`; one `chain()` case added to `supabase/tests/run.sh`.
  - Verify: `./supabase/tests/run.sh factcheck_reports_admin`, with the vacuity line.
- **T2. Data module and tests.** Depends on: T1 (the field names).
  - Write scope: `src/admin/factcheckReports.js` and `src/admin/factcheckReports.test.js`.
  - Verify: `npx vitest run src/admin/factcheckReports.test.js`; `npm run lint`.
- **T3. Page, registration and tests.** Depends on: T2.
  - Write scope: `src/admin/FactcheckReportsPage.jsx` (name to be confirmed) and its test; `src/admin/AdminApp.jsx` (one `NAV`
    entry and one render line only).
  - Verify: `npx vitest run src/admin`; `npm run lint`; `npm run build`.
- **T4. Gates.** Depends on: T1 to T3.
  - Write scope: none (checks only).
  - Verify: the full list in Acceptance evidence, items 4 to 10.

Task agents leave their changes uncommitted. The supervisor verifies, commits and merges. No task pushes.

Dependencies that must be decided before T1 starts: Q1 (reports on unshared claims), Q2 (open reports on hidden claims), Q4
(JSON key names), Q6 (migration name). Q3, Q5, Q7 and Q8 may be decided during T1 and recorded here.

## Report contract for the supervisor

Each task reports: changed paths, verification commands with their outcomes, the working-tree state, known warnings, and the
open questions it touched. The reviewer gets the code and this spec, not the writer's conclusions.
