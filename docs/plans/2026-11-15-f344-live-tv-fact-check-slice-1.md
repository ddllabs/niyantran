# F344 slice 1 plan: live transcript, verdicts, credits, per-user results

> **Status: Living.** Plan for slice 1 of the [Live TV fact-check spec](../specs/2026-11-15-live-tv-fact-check.md)
> (L20). Written 2026-11-15 at `main` `c1ebb102`, branch `task/f344-livetv-fact-check`. Tracker: F344 in
> [open-work](open-work.md). Slices 2 and 3 get their own plans.

**State on 2026-11-15:** T3, T4, T5 and T6 are built, reviewed and committed on the branch (`ca1ea764`, `18898b26`,
`9149f8df`, `239b77bc`, `47fb973b`, `41ad60c6`). A last database round adding the spend bounds, the off switch for
running sessions and the price check is in progress. T7 has not started, and every step of it needs the owner's yes.

Baseline on the branch, executed 2026-11-15 before any change: `npm ci`, `npm run build`, `npm run lint` (no
warnings), `npm test` (7,254 passed in 457 files), router import ok. Deno tests (1,633 passed) and `npm run test:sql` (78 fixtures passed, each non-vacuous) were run unchanged by the T3
builder the same day.

## What slice 1 delivers

An admin account, on Chromium desktop, presses "Fact-check" on the Live TV player, buys 5, 10 or 15 minutes, shares
the tab, and sees a transcript and verdict cards in a right-hand panel. Credits are held at the start and charged for
the minutes used. Sessions and claims are saved and readable only by their owner. Nothing is visible to other
accounts. Sharing, unlock, re-check, re-analyze and the history view are not in this slice.

## Roles

- **Supervisor:** this plan, dispatch, review of every diff, reproduction of evidence, commits, pushes and pull
  requests (L22). Asks the owner before any merge to `main`, any migration on NTER, any function deploy.
- **Builders (Sonnet):** one task each, the write scope below and nothing else, uncommitted diff plus evidence.
- **Reviewers (Opus):** a code review after each task; a security review after T4 covering T3 and T4 together.
- **Documentation (Haiku):** spec, plan and open-work updates on the supervisor's instruction.

Tasks run one at a time in the order given. A builder that finds its interface below does not fit the code stops
and reports; it does not change the interface on its own.

## Deviation from the spec

The spec names four Edge Functions. This plan builds **one**, `factcheck`, with four actions, so there is one
deploy, one `config.toml` entry and one place for the session check. The spec is corrected when this plan is
committed.

## Fixed interfaces

### Flag and price

One `app_flags` row, key `livetv_factcheck`, written only by the server:

```json
{ "enabled": true, "audience": "admin", "credits_per_minute": 0 }
```

- No row, or `enabled` not `true`: the feature is off everywhere. This is the state until the owner approves a price.
- `audience` is `"admin"` or `"all"`. With `"admin"`, only accounts for which `is_platform_admin()` is true may
  start a session. The server enforces it; the client only hides the button.
- `credits_per_minute` is a positive number set from the owner's approved price (L21). SQL reads it from the row;
  it is never taken from a request.
- The browser sends the price it displayed as `expected_credits_per_minute`; `factcheck_start` refuses a different
  price with `price_changed`. `factcheck_touch` returns `off` when the flag is off, so the flag also stops running
  sessions.

### Tables (migration `<timestamp>_factcheck.sql`)

`public.factcheck_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | |
| `user_id` | uuid, not null | references `auth.users`, cascade |
| `video_id` | text, not null | YouTube video id, 1 to 32 characters |
| `channel_id` | text, not null | Live TV channel id |
| `video_kind` | text, not null | `live` or `recorded` |
| `start_position_s` | numeric, null | position in a recorded video at start |
| `minutes_bought` | int, not null | 5, 10 or 15 |
| `credits_per_minute` | numeric, not null | copied from the flag at start |
| `credits_held` | numeric, not null | |
| `credits_charged` | numeric, null | set at settlement |
| `minutes_used` | int, null | set at settlement; null while active |
| `started_at` | timestamptz, not null | |
| `last_activity_at` | timestamptz, not null | moved by every accepted piece |
| `ended_at` | timestamptz, null | |
| `status` | text, not null | `active`, `settled` |

`public.factcheck_claims`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | |
| `session_id` | uuid, not null | references sessions, cascade |
| `user_id` | uuid, not null | |
| `video_id`, `video_kind` | text, not null | copied from the session, for slice 2 |
| `position_s` | numeric, null | recorded videos |
| `spoken_at` | timestamptz, not null | |
| `quote` | text, not null | at most 300 characters, original language |
| `claim_en` | text, not null | standalone claim, at most 500 characters |
| `claimant`, `reported_by` | text, null | |
| `kind` | text, not null | `claim`, `opinion`, `prediction`, `question` |
| `status` | text, not null | `pending`, `checked`, `needs_context`, `not_checkable`, `error` |
| `verdict` | text, null | `supported`, `contradicted`, `partly_true`, `no_evidence`, `opinion` |
| `reason` | text, null | at most 400 characters |
| `sources` | jsonb, not null, default `[]` | array of `{url, title}`, at most 8 |
| `checked_at` | timestamptz, null | |
| `supersedes` | uuid, null | for slice 3 |

Rules: row-level security on both tables. `authenticated` may `SELECT` rows where `user_id = (SELECT auth.uid())`.
`authenticated` may `DELETE` a session where it owns the row and `video_kind = 'live'` and `status = 'settled'`
(L23). No insert or update policy: all writes go through the functions below with the service role. Indexes on
`(user_id, started_at desc)` and on claims `(session_id, spoken_at)` and `(video_id, position_s)`.

The hold for a block is a `credit_holds` row under a random key (`fc:` plus a UUID) kept in
`private.factcheck_hold_keys` and never returned to any caller. A guessable key would let a research-chat turn sent
with the same key release the hold early. The ledger entry keeps the key `factcheck:<session id>`; settlement is
idempotent from the session row under lock, not from the ledger. Grants: `service_role` may select, insert and update
`factcheck_claims` and only select `factcheck_sessions`; every session write goes through the functions.

### SQL functions (all `SECURITY DEFINER`, `search_path = ''`, executable by `service_role` only)

- `public.factcheck_start(p_user uuid, p_video_id text, p_channel_id text, p_video_kind text,
  p_start_position_s numeric, p_minutes int, p_is_admin boolean) returns jsonb`
  Reads the flag. Refuses with a `reason` when: the flag is off (`off`); audience is admin and `p_is_admin` is
  false (`not_allowed`); minutes is not 5, 10 or 15 (`bad_minutes`); the user already has an active session
  (`already_active`); available credits are below `minutes × credits_per_minute` (`insufficient`, with `needed`
  and `available`). Otherwise creates the session and a hold for the full block, and returns
  `{ok: true, session_id, credits_per_minute, credits_held, ends_at}`. First settles any of this user's sessions
  that have run out. Malformed arguments raise SQLSTATE 22023, which the Edge Function maps to `400`. It takes a last argument,
  `p_expected_cpm numeric` (nullable), and `already_active` also returns the running session's id.
- `public.factcheck_touch(p_user uuid, p_session uuid, p_action text) returns jsonb`
  `p_action` is `transcribe`, `extract` or `check`. It is the session check and the rate limiter for every piece and
  every model call. Limits per user and minute, fixed in SQL: 10 transcribe, 6 extract, 20 check; and per session over its life: at most
  3·m + 2 extracts and 8·m + 4 checks, where m is the minutes settlement would charge; over a budget returns
  `{ok: false, reason: "budget"}`. `transcribe` is allowed while the session is active and no later than
  `started_at + minutes_bought` plus 15 seconds; it moves `last_activity_at` and returns `{ok: true, seconds_left}`.
  `extract` and `check` are allowed until 120 seconds after the last charged moment (the earlier of the block's end and
  15 seconds after the last accepted piece), even once the session is settled; they never move `last_activity_at`.
  Other refusals: `off`, `budget`, `not_found` (also for another user's session), `settled`, `ended`.
- `public.factcheck_settle(p_user uuid, p_session uuid) returns jsonb`
  Idempotent. Minutes used = the whole minutes, rounded up, between `started_at` and the earlier of now and
  `last_activity_at + 15 s`, at least 1 and at most `minutes_bought`. Charges `minutes used × credits_per_minute`
  through the existing ledger (a `charge` entry whose key is `factcheck:<session id>`), releases the hold, sets
  `credits_charged`, `ended_at` and `status = 'settled'`. Returns `{ok, minutes_used, credits_charged, balance}`.
- `public.factcheck_settle_expired() returns int`
  Settles every active session past its end plus one minute, and every active session with no accepted piece for 3
  minutes. Scheduled with `pg_cron` every 5 minutes, so a closed
  tab cannot leave a block uncharged or a hold stuck.

The design was reviewed on 2026-11-15 before any SQL was written. No existing credit function changes. The hold counts
against research chat's available credits because it is an ordinary unsettled hold that lasts until 30 minutes after
the block; the existing sweep cannot reach it while the session runs. The charge is a normal ledger `charge` drawn
from lots as chat charges are, with any shortfall going to debt. Fact-check charges appear in balance and usage
totals but not in the usage activity list; that is recorded as F345.

### Edge Function `factcheck` (`verify_jwt = false`; it checks the user itself, as `transcribe-audio` does)

`POST /functions/v1/factcheck` with the user's bearer token. Every action runs the origin check, `requireUser` and
the active-account check first. JSON actions carry `{"action": ...}`; `transcribe` is `multipart/form-data` with
fields `action`, `session_id`, `seq` and `file`.

| Action | Request | Response |
|---|---|---|
| `start` | `video_id`, `channel_id`, `video_kind`, `start_position_s`, `minutes`, `expected_credits_per_minute` | `200 {session_id, credits_per_minute, credits_held, ends_at}`; `402 {reason: "insufficient", needed, available}`; `403`/`409` with `reason`; `409 {reason: "price_changed", credits_per_minute}`; `409 {reason: "already_active", session_id}` |
| `transcribe` | `session_id`, `seq`, `file` (WAV, 16 kHz mono 16-bit, at most 15 s and 600 kB) | `200 {seq, text, seconds_left}`; `409 {reason}` when the session is over |
| `extract` | `session_id`, `turn: {text, spoken_at, position_s}`, `recent: [text]` (at most 3), `ledger` (at most 4 kB), `seed: {channel, title}` | `200 {claims: [{id, quote, claim_en, claimant, reported_by, kind, status}], ledger}` |
| `check` | `session_id`, `claim_id` | `200 {id, status, verdict, reason, sources, checked_at}`; a claim that is not pending returns `200` with its stored state |
| `stop` | `session_id` | `200 {minutes_used, credits_charged, balance}` |

- `transcribe` calls OpenRouter `/audio/transcriptions` with `elevenlabs/scribe-v2`. The audio is never written
  anywhere.
- `extract` uses `google/gemini-3.8-flash` with strict JSON-schema output, low reasoning effort and data collection
  denied; `check` uses `perplexity/sonar` with a two-line plain reply, because Sonar rejects structured output through
  OpenRouter; both ids are constants in one file.
- `extract` saves each claim before returning it. A claim whose normalised text is already saved in this session
  is not saved again. `check` reads the claim text from the database, never from the request, and checks a claim
  once.
- The claim text holds the content only ("X"), never "A said X"; who said it and who reported it go in `claimant` and
  `reported_by` (L6). A claim that needs context is saved with `status = 'needs_context'`, is not checked, and is
  returned so the browser can offer it again with the next turn. The ledger is capped at its 30 most recent entries.
- Transcript text is passed to models as data, with instructions fixed in the system prompt. A verdict that is not
  one of the five labels is saved as `status = 'error'`.
- Every model call writes a `model_call_logs` row (`caller` `factcheck`, `message_id` null) with its cost, by the
  `transcribe-audio` pattern. These rows are not charged by the chat path.
- Every action calls `factcheck_touch` with its action name before any provider call; `rate_limited` is `429` with
  `Retry-After`, `budget` is `429` without it (the browser does not retry), `off` is `403`, `not_found` is `404`,
  `settled` and `ended` are `409`. A piece that is silent or shorter than half a second is not sent to the provider
  and returns empty text, but still counts as activity.

### Browser modules

- `src/lib/factcheck/pieces.js` (pure): `cutPieces`, `dedupeOverlap(prevText, nextText)`, `stripSoundTags(text)`,
  `groupTurns`.
- `src/lib/factcheck/capture.js`: `isSupported()`, `startCapture({onPiece, onEnded})` returning `{stop}`; asks for
  the current tab with audio, processing off, 16 kHz mono; emits WAV pieces of about 10 s cut at a pause where one
  is near, with a short overlap.
- `src/lib/factcheck/transcriber.js`: `createTranscriber(client)` with `transcribe(piece) -> {text}`; the one seam
  a streaming provider would replace.
- `src/lib/factcheck/client.js`: one function per action, built on `accessToken` and `functionsUrl` from
  `src/lib/supabaseClient.js`.
- `src/lib/factcheck/session.js`: the session state machine (`idle`, `choosing`, `sharing`, `starting`, `running`, `ending`,
  `ended`, `error`) tying capture, transcription, extraction and checks together; no React. Claims that the run never
  checked end as `unchecked`; the session ends itself after 90 seconds without speech.
- `src/shell/factcheck/FactCheckPanel.jsx` and `factCheck.css` (class prefix `fc-`): the panel and its states.

## Tasks

### T2. Cost measurement and price (done)

Done 2026-11-15 (spec G2b). Typical cost US$0.0375 a minute, densest US$0.0483, with Sonar. The owner approved
500 credits (Rs 5) a minute the same day (L21). The flag row carries `credits_per_minute: 500` and is written at
release.

### T3. Database: tables, credit functions, fixtures

- **Write scope:** `supabase/migrations/<timestamp>_factcheck.sql`, `supabase/tests/factcheck.sql`,
  `supabase/tests/factcheck_concurrency.sh`, `supabase/tests/run.sh` (the new chain entry and the concurrency hook
  only).
- **Baseline (executed 2026-11-15, unchanged tree):** Deno tests 1,633 passed, 0 failed; `npm run test:sql` all 78
  fixtures passed, each with "vacuity ok". **Design note:** returned and reviewed 2026-11-15; its outcome is in
  "Fixed interfaces" above.
- **Fixtures, each seen failing first:** start refuses in each listed case; the hold reduces chat's available
  credits; settle charges the minutes used and is idempotent; an abandoned session is settled by
  `factcheck_settle_expired`; the existing sweep does not free a fact-check hold; a second user cannot read
  another's session or claim; a user can delete only their own settled live session; `authenticated` cannot call
  the functions or write the tables. `run.sh` proves the fixture non-vacuous. Also: a research-chat reserve and settle sent with the key
  `factcheck:<session id>` does not release the hold; each rate limit; `extract` and `check` allowed after settlement
  for 120 seconds and refused after; two settles at once; start racing start; settle racing touch (the concurrency
  script).
- **Verify:** `npm run test:sql` (all fixtures, including the existing credit ones), `npm run lint`.

### T4. Edge Function `factcheck`

- **Depends on:** T3 merged into the branch.
- **Write scope:** `supabase/functions/factcheck/**`, the `[functions.factcheck]` entry in `supabase/config.toml`.
- **Tests (Deno, written first):** every action's refusals (origin, no token, inactive account, wrong session,
  ended session, over limit); `transcribe` rejects oversize and non-WAV input; `extract` never sends a
  needs-context claim to a check and does not save duplicates; a reported claim is sent to the check as its content only; `check` rejects a verdict outside the five labels;
  a transcript containing an instruction does not change the labels; every model call logs a row; no audio or
  key appears in logs.
- **Verify:** `deno test -A --config supabase/functions/deno.json supabase/functions`, `npm run lint`,
  `npm run build`, router import.

### T5. Browser capture and session logic

- **Write scope:** `src/lib/factcheck/**`.
- **Tests (Vitest, written first):** piece cutting at a pause and at the limit; overlap de-duplication on the
  three boundary cases recorded in the spec's G2a; sound-tag removal; turn grouping; the state machine's
  transitions, including capture ended by the browser, a `409` from the server and credits exhausted; the support
  check.
- **Verify:** `npm test`, `npm run lint`, `npm run build`.

### T6. Panel and wiring into Live TV

- **Depends on:** T5.
- **Write scope:** `src/shell/factcheck/**`, `src/shell/LiveTvModal.jsx`, `src/shell/liveTv.css`, and new test
  files beside them. `server/liveTvApi.mjs` is not touched.
- **Behaviour:** the button shows only when the flag allows this account and the browser is supported; the panel
  sits to the right of the player inside `ltv-body`; the session stops when the channel, video or modal changes;
  the existing tabs, hook order and tests are unchanged; the panel says verdicts are automated.
- **Tests:** panel states; button hidden when unsupported, flag off or not allowed; stop on channel change;
  `liveTv.test.js`, `liveTvHonest.test.js`, `liveTvQuota.test.js`, `LiveTvModal.hooks.test.js` and
  `liveTvTabs.test.jsx` pass unchanged.
- **Verify:** `npm test`, `npm run lint`, `npm run build`, and a run in the browser preview against local
  functions with a test account.

### T7. Release to admin accounts

Supervisor, with the owner's yes for each step: pull request and both CI jobs; merge; migration on NTER by `psql`
(never `supabase db push`); `analyze` on the new tables; function deploy; the flag row with `audience: "admin"`
and the approved price; a live session on the production site by an admin, including the real Chrome sharing
prompt that G1 still owes; cost per minute compared with the measurement.

Live checks in addition to the above:

- where Sonar's source links arrive in a real reply;
- the scheduled settlement job running under `pg_cron`;
- the real Chrome sharing prompt and the panel's focus handling in a browser (no test in the repository can run those);
- cost per session from `model_call_logs` (each row carries the session id) against the measured US$0.0375 to 0.0483
  a minute.

## Definition of done for slice 1

Every task's tests were seen failing and now pass; both CI jobs pass on the pull request; the Opus reviews and the
security review have no open findings above low; an admin has completed a live session on production and was
charged the stated price; open-work F344 records what remains for slices 2 and 3. The owner has answered OQ5 before the audience is set to
`"all"`.
