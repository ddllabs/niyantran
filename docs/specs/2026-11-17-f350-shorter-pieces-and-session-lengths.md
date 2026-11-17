# Live TV fact-check: shorter audio pieces, a listening line, and session lengths of 1, 2, 5, 10 and 15 minutes (F350, proposed)

> **Status: Living.** Written 2026-11-17 from the owner's request of the same day and from code read at `main`
> `7034e9f7`. Not built. Gate G1 not run. Tracker: F350 in [open-work](../plans/open-work.md). Plan:
> [F350 plan](../plans/2026-11-17-f350-shorter-pieces-and-session-lengths.md). Builds on the
> [F344 spec](2026-11-15-live-tv-fact-check.md) and the [F349 fixes](../plans/2026-11-17-f349-fact-check-fixes.md).
> Accepted risk for audio capture: [ADR 0015](../decisions/0015-live-tv-fact-check-audio-capture.md).

Evidence marks: **read** = seen in this checkout (file:line); **executed** = run, with the date; **vendor** = a provider's
own claim, not measured by us; **unverified** = neither. Nothing in this spec has been built or run against a real
session. The only measurement planned here is gate G1, and it has not been run.

## Summary

- Transcript text should appear closer to real time. Today a piece of audio is about 10 seconds long and text for it
  appears about 13 seconds behind the speaker (the wording in the panel). Shorter pieces of about 5 seconds should
  cut that delay. Whether they do, and whether they still transcribe accurately, is to be measured first (gate G1).
- While the session is running, the panel shows a "Listening…" line at the foot of the transcript. It is not read
  aloud to screen readers.
- Session lengths become 1, 2, 5, 10 and 15 minutes. Lengths 20 and 30 minutes stay held until the F349 fixes are
  proven by a real session.
- Claim extraction is kept at the same rate in seconds of audio, so verdict timing and the cost per minute of checking
  do not change. Only the transcript gets faster.
- The change needs more transcription requests per minute, a larger stored-piece cap, and a wider database rule for
  lengths. The server side is released first, then the browser, each on the owner's yes.

## Review (2026-11-17)

An independent reviewer read the code for this spec. Nothing was executed. The verdict was **approve with changes**. The
changes below were made in this spec and in the [plan](../plans/2026-11-17-f350-shorter-pieces-and-session-lengths.md).

- **R1.** The earlier-context change is dropped. The stored-piece cap rises from 120 to 240 only (S4).
- **R2.** `supabase/tests/factcheck.sql` is not edited. All new assertions go in `supabase/tests/factcheck_lengths.sql`.
- **R3.** Migration details, drift guard and release check on live sessions are added to the plan (T1, release step 3).
- **R4.** The turn rule is stated precisely, with today's turn length corrected (S2).
- **R5.** `awaitingText` is removed. The listening line is driven by the session status (S7).
- **R6.** The failure limit rises from 3 to 5 if the piece length changes (S10).
- **R7.** Test and comment locations are added to the lists.
- **R8.** Worst-case transcription per minute is added to OD2.
- **R9.** The G1 delay definition includes the cutter's hold, and the method limit about sending one piece at a time is added.
- **R10.** Rollback order is stated. Two risks are added.
- **R11.** The release order is unchanged. The controller needs no change.

## Why

On 2026-11-17 the owner reported that transcript text arrives in blocks some seconds behind the speaker and asked for
it to feel closer to real time. The owner also asked for more session lengths. The owner agreed on the same day to
lengths of 1, 2, 5, 10 and 15 minutes now, and to hold 20 and 30 minutes until the F349 fixes are proven by a real
session.

Nothing in this work is released before the owner has run a real session on the F349 fixes, which are live already.
That order means a fault seen in a later session can be traced to one change.

## Current state

**Piece cutting (read).**
- `PIECE_DEFAULTS` at `src/lib/factcheck/pieces.js:14-24`: `targetMs` 10000, `minMs` 8000, `maxMs` 12000, `overlapMs`
  1000, `pauseMs` 300, `pauseRms` 0.01. A posted piece is the new audio plus 1 s of overlap, so about 11 s, about
  352 kB as 16 kHz mono 16-bit WAV.
- `src/lib/factcheck/capture.js:136` calls `createPieceCutter()` with no options, so these are the production values.
- `LONG_PAUSE_MS` is 700 at `pieces.js:293`.

**Transcription and text (read).**
- At most two transcribe calls run at once (`src/lib/factcheck/session.js:48`). Results are applied in strict piece
  order (`session.js:320-330`). The queue is unbounded and nothing is dropped.
- Each piece adds one transcript line as it is applied (`session.js:331-341`). So the speed of transcript text is set
  by the piece length, not by the turn length.

**Turns and claim extraction (read).**
- `createTurnBuilder` (`pieces.js:297-330`) closes a turn at two pieces, or after any piece that ended at a pause of
  700 ms or more. An empty piece closes the turn before it and is not added.
- A turn is therefore 8 to 24 s of audio today: one piece of 8 to 12 s that ends at a pause, or two pieces.
- The browser waits at least `extractGapMs` 10000 between extract calls (`session.js:50`) and merges queued turns into
  one call.
- A shareable ranged turn may hold at most 12 pieces: `session.js:377`, the SQL rule in
  `supabase/migrations/20261117090000_factcheck_sharing.sql:299` (`p_to - p_from + 1 > 12` is refused), and
  `supabase/functions/factcheck/extract.ts:72`.
- The earlier-context read in `extract.ts:148` uses the same constant (`MAX_RANGE_PIECES`) and the same SQL function,
  `public.factcheck_turn_pieces`. That function refuses any range over 12. `storedPieces` cuts every answer to 12
  (`extract.ts:98`). A refused answer gives an empty context with no error (`extract.ts:95-96`, `:151`). So raising only
  the TypeScript constant would silently remove the context. This is why the earlier-context read is not changed.

**Server limits (read).**
- `public.factcheck_touch` (`supabase/migrations/20261116090000_factcheck.sql:369`) allows, per user per calendar
  minute, 10 transcribe calls, 6 extract and 20 check (`:423`). A refused call returns 429 `rate_limited`.
- Per session, the budget is 3m + 2 extracts and 8m + 4 checks, where m is the charged minutes (`:411-413`). A refused
  call returns 429 `budget`. There is no per-session cap on transcribe calls.
- Stored pieces (shareable sessions only; sharing is switched off today): at most 120 per session
  (`20261117090000_factcheck_sharing.sql:265-271`).
- Piece validation (`supabase/functions/factcheck/wav.ts`): at least 0.5 s (`:9`), at most 15 s (`:7`) and 600,000
  bytes (`:6`).

**Session lengths: four places enforce 5, 10 and 15 (read).**
1. Table CHECK `minutes_bought IN (5, 10, 15)`: `20261116090000_factcheck.sql:81`. The CHECK has no name in the
   migration.
2. SQL function `public.factcheck_start`: the test at `:309` returns `bad_minutes` (`:310`).
3. Edge Function `supabase/functions/factcheck/start.ts:101`, with the message at `:154`.
4. Browser `MINUTE_CHOICES = [5, 10, 15]` at `src/shell/factcheck/factCheckText.js:5`.

**Charging (read).** Charging is by whole started minutes, with a floor of one minute and a cap at the minutes bought
(`private.factcheck_charge_minutes`, `20261116090000_factcheck.sql:207-211`). A one-minute session therefore holds and
charges 500 credits at 500 credits a minute.

**Panel (read).**
- The text "Listening… Text appears about 13 seconds behind the speaker." is at `src/shell/factcheck/FactCheckPanel.jsx:466`.
  It is shown only when the transcript is empty. The test at `FactCheckPanel.test.jsx:173-177` pins the wording.
- The session snapshot (`session.js:174-181`) has no count of pieces still waiting for text. No count is added (S7).
- The length buttons read "N minutes" at `FactCheckPanel.jsx:91` and the Start button at `:117`. With 1 minute
  that would read "1 minutes".
- The default selected length is the first affordable option (`FactCheckPanel.jsx:67`).
- The "Start a new session · from …" button uses the first option's price (`:509`).
- The status "ending" shows "Finishing…" in the clock (`FactCheckPanel.jsx:410`, read).

**Loading.** The whole feature is behind the lazy import at `src/shell/TerminalShell.jsx:44` (read). The first-load
JavaScript limit is 182,446 bytes gzip (`scripts/check-bundle.mjs` reads the limit; the figure is recorded in
[the 2026-10-25 release record](../plans/2026-10-25-preview-production-release.md)). That record shows 181,765 bytes,
so 681 bytes of headroom; the build of 2026-11-17 measured 181,763 bytes (executed), so 683. No new code may be imported statically from the shell.

**Measured before this spec (executed, 2026-11-15).** Gate G2a in the
[F344 spec](2026-11-15-live-tv-fact-check.md#g2a-chunked-transcription-through-openrouter-executed-2026-11-15) tested
consecutive pieces of 10 s and 20 s, without overlap, on four 90-second clips captured by tab sharing. Nothing has yet
been measured at 5, 7 or 10 seconds with the 1 s overlap this change uses.

## Problems the change must solve

Each problem follows from shorter pieces or shorter sessions, and each was found by reading the code.

- **P1. Request rate.** Pieces of 4 to 6 s mean 10 to 15 transcribe calls a minute, plus retries. The limit of 10 a
  minute would refuse calls in every minute.
- **P2. Stored pieces.** A 15-minute session at 4 to 6 s makes 150 to 225 pieces. The cap of 120 would stop storing at
  about 10 minutes (at 5 s pieces).
- **P3. Turns and extraction.** If a turn still held two pieces, a turn would be about 10 s (8 to 12 s), and a pause could
  close it sooner. Extract calls would rise towards 6 a minute, against a session budget of about 3 a minute. Extraction would
  end early (429 `budget`), and cost would rise.
- **P4. Ranged turns and context.** The 12-piece cap on a ranged turn covers about half the seconds it covers today. The
  earlier-context read covers about one minute instead of about two. This is accepted (S4).
- **P5. Tests and wording.** Several tests and the "13 seconds" text assume 10 s pieces. They are listed under "Tests".
- **P6. Lengths 1 and 2.** These are refused by the database CHECK, by `factcheck_start`, by the Edge Function, and are
  absent from the browser list.

## Decisions

The supervisor made these decisions as the design. They are labelled S1 to S10 so that later documents can refer to
them. Owner decisions that remain are under "Open decisions for the owner".

- **S1. Piece length.** Piece cutting becomes `targetMs` 5000, `minMs` 4000, `maxMs` 6000. The overlap stays at 1000 ms.
  This applies **only if gate G1 passes at 5 s**. If G1 fails at 5 s, the fallback is `targetMs` 7000, `minMs` 5500 and
  `maxMs` 8500, tested by the same gate. If that also fails, the piece length stays as it is, and only the listening
  line and the lengths ship.
- **S2. Turns stay about the same length in seconds.** The length of a turn is the span from the start of its first piece
  to the end of its last piece. After a piece that has text is added, the turn closes when:
  - the span is `TURN_MAX_MS` (20000) or more; or
  - that piece ended at a pause of 700 ms or more and the span is `TURN_MIN_MS` (10000) or more; or
  - the turn holds 12 pieces.

  A piece with no text (silent, only sound tags, or emptied by overlap removal) is never added. It closes the open turn
  only if the span from the turn's first piece to the **end** of that empty piece is `TURN_MIN_MS` or more. Otherwise the
  turn stays open.

  Under this rule a turn is about 10 to 26 s long (the ceiling is 20 s plus one piece of up to 6 s). A turn of a single
  5 s piece is never produced, except by the final flush. Extract calls are limited by the 10 s gap (6 a minute) in both
  the current and the new design. S2 keeps the number of turns the same or lower than today, including when pieces come
  back empty, which is more common with short pieces (`pieces.js:283`, `:315`). This is the reviewer's reasoning and has
  not been measured. Verdicts will not arrive sooner. Only transcript text will.

  **Accepted limit.** The turn left open at the end of a session can be up to about 20 s. It is lost if the 100 s drain
  expires (`session.js:57`) or the session ends without draining. Today the same loss is about 12 s.
- **S3. Transcribe limit.** The `factcheck_touch` limit for transcribe rises from 10 to 24 per user per calendar minute.
  This is 15 pieces at the 4 s minimum, plus room for retries. The limits for extract (6) and check (20), and both
  session budgets, are unchanged.
- **S4. Stored-piece cap.** The stored-piece cap rises from 120 to 240 per session. 15 minutes at 4 s is 225 pieces.
  **Nothing else changes.** The 12-piece cap on a ranged turn stays. The earlier-context read stays at 12 pieces, which
  is about one minute at 5 s pieces instead of about two. This is accepted while sharing is off.

  The reason the context is not raised: the context read uses the same SQL function, `public.factcheck_turn_pieces`,
  which refuses any range over 12 (`20261117090000_factcheck_sharing.sql:299`). `storedPieces` cuts every answer to 12
  (`extract.ts:98`). A refusal comes back as an empty context with no error (`extract.ts:95-96`, `:151`). Raising only
  the TypeScript constant would silently remove the context.

  **Accepted limit (sharing off).** A merged ranged turn reaches the 12-piece cap (`session.js:377`) at about 60 s instead
  of about 120 s. It then falls back to a text turn, which is not shared.
- **S5. Lengths.** Allowed lengths become 1, 2, 5, 10 and 15 in all four places listed under "Current state". The
  charging rules are unchanged.
- **S6. Browser choices.** `MINUTE_CHOICES = [1, 2, 5, 10, 15]`. The label is "1 minute" in the singular, and "N minutes"
  otherwise. The default selected length stays 5 minutes when it is affordable. Otherwise it is the longest affordable
  length below 5. The "Start a new session · from …" button keeps using the lowest price, which becomes 500 credits.
- **S7. Listening line (replaces the earlier design).** No snapshot field is added. The controller needs no change.
  While the session status is `running`, and no silence notice is showing, the transcript ends with a line "Listening…".
  It is not shown in `ending`, `ended` or any other status. It is not shown while the silence notice is showing (the
  notice appears after `SILENT_NOTICE_MS` 30000, `FactCheckPanel.jsx:14`).

  The line has its own React key, which cannot collide with a piece number. It is included in the autoscroll trigger
  (`FactCheckPanel.jsx:155`) so that it stays in view. The transcript region stays `aria-live="off"`, so the line is not
  announced. Its animation is off under reduced motion.

  Before the first line, the existing empty text stays, with the delay figure from S8.

  **Reason.** A count of pieces waiting for text would switch the line on and off with every piece (publishes at
  `session.js:289` and `:322`). It would also need a new counter, decremented on every discard path. A steady line while
  the session is running is simpler and does not blink.
- **S8. Delay figure.** The delay in the text becomes a constant in `factCheckText.js`, set from the G1 measurement (see
  "G1" for the definition): the median seconds from speech to text, rounded up to a whole second. It is not a guess.
- **S9. Scope of the change.** No new flag keys, no new dependency and no new provider. No change to the price, the hold,
  settlement, checks or re-checks. All new browser code stays inside the lazily loaded chunk.
- **S10. Failure limit (only if the piece length changes).** `LIMITS.failureLimit` rises from 3 to 5 (`session.js:54`).
  It counts consecutive failed calls, not time. With pieces arriving about twice as often, three failures fit in about
  15 s of provider trouble instead of about 30 s. Then the session would end with an error while still charged. A test
  is added in `session.test.js`.

## Open decisions for the owner

- **OD1. Recorded clips for gate G1 (blocker).** Scripted tab capture is refused by the browsers, so G1 needs recorded
  clips. Two routes:
  - (A) The owner records four 90-second clips with a small local recorder page the supervisor prepares. About five
    minutes of the owner's time.
  - (B) The owner allows two command-line tools (yt-dlp and ffmpeg, installed through Homebrew) on the test machine. The
    supervisor then records the clips.
  - **Recommendation: B**, because the test can then be repeated without the owner. Route B fetches video from YouTube,
    which its terms may not allow. The owner should confirm that this use is acceptable before it starts.
- **OD2. Cost of short sessions and of transcription.** A one-minute or two-minute session has a higher worst-case
  provider cost per charged minute, because the fixed allowance in the budgets weighs more. A one-minute session may run
  12 checks and 5 extractions for 500 credits. A 15-minute session averages about 8.3 checks a minute (124 checks in 15
  minutes).

  Worst-case transcription per minute also rises. Every transcribe call that passes the limiter counts. The server
  accepts pieces of up to 15 s (`wav.ts:7`). So a client that is not our browser could send 24 × 15 s = 360 s of audio a
  minute, against 150 s today. **Recommendation:** accept this while the audience is "admin". Before the audience becomes
  "all", lower the maximum piece length the server accepts to about 8 s. That is a later change, made after the browser
  change is fully out, because old pages still send pieces of up to 13 s. Settle this together with the existing open
  question on worst-case spend.
- **OD3. Default length.** The default selected length stays 5 minutes (S6). **Recommendation:** yes.
- **OD4. Widening the database rule.** Widening the table CHECK means dropping the constraint and adding the wider one in
  the same transaction. That replaces an existing database object, which the developer asked us not to do without
  saying so. Rollback is possible only while no session row has 1 or 2 minutes. After that the wide rule must stay. It
  is harmless to code that offers only 5, 10 and 15. **Recommendation:** accept.
- **OD5. Longer lengths.** 20 and 30 minutes remain held until the F349 fixes are proven by a real session. A 30-minute
  block holds 15,000 credits at 500 a minute, so those lengths also need the owner's acceptance of the larger hold and
  worst-case spend.

## Gates

### G1: accuracy and delay of shorter pieces (not run)

**Method, fixed before running.**
- Four clips of 90 seconds, 16 kHz mono WAV: one each of Hindi news, English news, Hindi with English, and a Hindi
  debate with several speakers. These are the same kinds as gate G2a in the [F344 spec](2026-11-15-live-tv-fact-check.md).
  Those clips were kept in a temporary folder that no longer exists, so new clips are needed (OD1).
- Each clip is cut with the repository's own cutter (`createPieceCutter` with options) at three settings:
  - 10 s (8 to 12 s), the current setting;
  - 7 s (5.5 to 8.5 s), the fallback;
  - 5 s (4 to 6 s), the first choice;
  - each with 1 s overlap.
- Each piece is transcribed with `elevenlabs/scribe-v2` through OpenRouter. The pieces are sent one at a time. The pieces
  are joined with the repository's own overlap removal (`mergeOverlap`) and compared word by word with Scribe v2's
  transcript of the whole 90-second file.
- For each setting and clip, record:
  - word agreement;
  - the number of pieces;
  - the median and worst reply time;
  - the cost from `usage.cost`;
  - the share of cuts that landed on a pause.
- **Pass rule for a setting.** Its agreement is no more than 3 percentage points below the 10 s setting on the average of
  the four clips, and no more than 5 points below on any one clip. No request may fail.
- **Delay.** For each piece, delay is the sum of three parts:
  1. the length of its new audio (from the previous cut to this cut);
  2. the audio already captured past the cut when the piece is emitted. The cutter looks for a pause only after the
     target length and cuts in the middle of the pause (`pieces.js:143`, `:163`). The piece's `heldMs` records this hold;
  3. the reply time for that piece.

  This is how far behind the speaker the first word of the piece appears. The figure for a setting is the median over
  all pieces of the four clips, rounded up to a whole second. It leaves out the time from the browser to the Edge
  Function, so the owner's real session is the final check. S8 uses this figure at the chosen setting.
- **Expected spend.** Under US$1.
- **Raw output** stays outside the repository. The summary table goes into "Gate results" below.

**Limits of the method.**
- There is no human reference transcript. Agreement with Scribe v2's whole-file transcript favours longer pieces, because
  the reference was made with more context.
- Four clips is a small sample.
- Only Chromium desktop capture is used in the product, and G1 does not test capture. It tests transcription only.
- The browser sends up to two pieces at once. G1 sends them one at a time, so queueing is not measured.

### Gate results

Not run. The table below is filled in after G1.

| Setting | Average agreement (4 clips) | Worst clip agreement | Pieces (median per clip) | Median reply | Worst reply | Cost (US$) | Cuts on a pause | Result |
|---|---|---|---|---|---|---|---|---|
| 10 s (8 to 12) | not run | not run | not run | not run | not run | not run | not run | not run |
| 7 s (5.5 to 8.5) | not run | not run | not run | not run | not run | not run | not run | not run |
| 5 s (4 to 6) | not run | not run | not run | not run | not run | not run | not run | not run |

**Chosen piece setting:** not yet chosen. It will be S1 at 5 s, or the fallback at 7 s, or no change.

## Acceptance evidence

The change is accepted when each of these is shown, with the command and its outcome recorded.

- G1 table recorded, and the chosen piece setting stated (S1 or its fallback).
- Unit tests, each seen failing before the code is written:
  - the cutter at the new setting, with the existing test shapes in `pieces.test.js`, and `capture.test.js:189-196`;
  - the turn builder rules of S2:
    - a pause before 10 s does not close a turn;
    - a span of 20 s closes a turn;
    - 12 pieces close a turn;
    - an empty piece before 10 s does not close the turn;
    - an empty piece after 10 s does close it;
    - a turn of a single 5 s piece is not produced except by the final flush;
  - the listening line (S7): shown while the status is `running`; hidden when `ending`, `ended` or when the silence
    notice shows; the region keeps `aria-live="off"`;
  - the singular label "1 minute";
  - the default selection under S6, including the case where 5 minutes is not affordable;
  - the three-button choice at `FactCheckPanel.test.jsx:75-96` and `:120`, updated to five buttons;
  - all five lengths accepted by `start.ts`, and 0, 3, 4, 7, 20 and 30 refused (`start_test.ts:144-161`);
  - the failure limit of S10, if the piece length changes.
- SQL fixture `supabase/tests/factcheck_lengths.sql`, proven non-vacuous by `npm run test:sql`. The run rebuilds without the
  new migration and requires the fixture to fail (`run.sh:412-430`):
  - lengths 1 and 2 accepted, and 3 and 20 refused, by both the CHECK and `factcheck_start`;
  - the 24th transcribe in a minute accepted and the 25th refused;
  - the 240th stored piece accepted and the 241st refused;
  - a one-minute session stopped at once is charged exactly one minute.
- Gates, each run on the branch and recorded with its result:
  - `npm run lint`
  - `npm run build`
  - `npm run check:bundle` (the first-load limit is unchanged)
  - `npm test`
  - `deno test -A --config supabase/functions/deno.json supabase/functions`
  - `npm run test:sql`
  - `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`
- After release, on the owner's real session:
  - transcript text measured behind the speaker, and compared with the 13-second figure;
  - no 429 `rate_limited` on transcribe in the function log;
  - extract calls per minute no higher than before.

## Tests that pin the current behaviour

These tests assume 10 s pieces or the 5-to-15 lengths and must change with the code. Each is listed so that the builder
knows it is expected to change, not to be deleted.

- `src/lib/factcheck/pieces.test.js:32-75`, `:92-101` and `:120-139`: piece boundaries at 8, 10 and 12 s, and the
  quiet-window tests at `:126-152`.
- `src/lib/factcheck/capture.test.js:189-196`: expects pieces `[0,0,12000,0]` and `[1,11000,24000,1000]` and a WAV of
  `44 + 12*16000*2` bytes.
- `src/lib/factcheck/session.test.js:20`, `:991-1003`, `:1134`, `:1198`, `:1259` and `:1360`.
- `src/shell/factcheck/FactCheckPanel.test.jsx:173-177`: the "13 seconds" wording and the absence of "10 seconds".
- `src/shell/factcheck/FactCheckPanel.test.jsx:75-96` and `:120`: three length buttons, and the default "Start 5 minutes · 2,500".
- `supabase/functions/factcheck/start_test.ts:144-161`: the accepted and refused block sizes.

The SQL tests in `supabase/tests/factcheck.sql` are **not** changed. Its chain applies only the first migration
(`supabase/tests/run.sh:178-181`), so the new migration never reaches it. Its existing assertions stay true: the CHECK case
at `:221-222` uses 7, and the text there is only a test label; `bad_minutes` at `:279-281` tests 0, 4, 20 and NULL; the rate
case at `:730-738` refuses the 11th transcribe in a minute.

## Scope and exclusions

**In scope.**
- Files under `src/lib/factcheck/`, `src/shell/factcheck/` and `supabase/functions/factcheck/`.
- One new migration, `supabase/migrations/20261119090000_factcheck_lengths_and_piece_limits.sql`.
- One new SQL fixture, `supabase/tests/factcheck_lengths.sql`, registered in `supabase/tests/run.sh`.

**Excluded.**
- `supabase/tests/factcheck.sql` (see above).
- Live TV as its own page (the next item after this one, with its own spec).
- Switching sharing on, and the earlier-context change (R1).
- A streaming transcription test.
- 20 and 30 minute lengths.
- Any change to the price.
- Re-analysing a block.
- A past-sessions view.
- Any change to checks or re-checks.

## Relation to earlier decisions

- ADR 0015 accepts the browser-side audio capture. This change does not alter capture.
- The credit rules of ADR 0011 are unchanged. The charge per started minute, the floor of one minute and the cap at the
  minutes bought are the same as today.
- No new provider or key is introduced (ADR 0002 applies to the existing OpenRouter route).
