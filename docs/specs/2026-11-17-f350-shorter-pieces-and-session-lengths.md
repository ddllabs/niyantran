# Live TV fact-check: session lengths of 1, 2, 5, 10 and 15 minutes and a listening line (F350, proposed)

> **Status: Living.** Written 2026-11-17 from the owner's request of the same day and from code read at `main`
> `7034e9f7`. Gate G1 executed 2026-11-17: both shorter settings failed; piece length unchanged. Reduced scope not yet
> built. Tracker: F350 in [open-work](../plans/open-work.md). Plan:
> [F350 plan](../plans/2026-11-17-f350-shorter-pieces-and-session-lengths.md). Builds on the
> [F344 spec](2026-11-15-live-tv-fact-check.md) and the [F349 fixes](../plans/2026-11-17-f349-fact-check-fixes.md).
> Accepted risk for audio capture: [ADR 0015](../decisions/0015-live-tv-fact-check-audio-capture.md).

Evidence marks: **read** = seen in this checkout (file:line); **executed** = run, with the date; **vendor** = a provider's
own claim, not measured by us; **unverified** = neither. Nothing in this scope has been built or run against a real
session. Gate G1 was run on 2026-11-17 (see "Gates").

## Summary

- The owner asked for transcript text closer to real time. Gate G1 showed that shorter pieces (7 s and 5 s) lose too
  much accuracy to be adopted, so **piece length stays at 10 seconds**. The transcript will not get faster from this change.
- Session lengths become 1, 2, 5, 10 and 15 minutes. Lengths 20 and 30 minutes stay held until the F349 fixes are
  proven by a real session.
- While the session is running, the panel shows a "Listening…" line at the foot of the transcript. It is not read aloud
  to screen readers.
- The panel's delay figure becomes 14 seconds, the measured median at the current piece length (G1).
- The server change is a migration that widens the allowed lengths, released first, then the browser.

## What the owner asked for and what this delivers

The owner asked for transcript text to arrive closer to real time. **This change does not do that.** Gate G1 found that
the faster option (pieces of about 5 seconds) makes the transcript less accurate in ways that matter for claim
extraction. The current piece length is kept. What the owner does get: the lengths, and a line that shows the panel is
still listening.

Options that remain for lower delay. None is built or tested.

- **(a) Streaming transcription.** A provider that accepts audio as it is spoken. It is already the next item in the agreed
  order and needs a provider key. It is the only route found to words appearing as they are spoken.
- **(b) A better join for 5 s pieces.** G1 suggests that the damage at 5 s comes from the join: phrases doubled where two
  pieces spelled the repeated words differently, so overlap removal did not match them. A longer overlap, or matching
  repeated words by sound-alike spelling, might fix this. It is unproven.
- **(c) Provisional text.** Show the 5 s text at once and replace it with the 10 s text. This would double the
  transcription cost. It is not tested.

## Review (2026-11-17)

An independent reviewer read the code for this spec. Nothing was executed. The verdict was **approve with changes**.
The review's changes were then reduced after G1 (see "Not built after G1" for the changes that no longer apply).

Still applying:
- **R2.** `supabase/tests/factcheck.sql` is not edited. The new assertions go in `supabase/tests/factcheck_lengths.sql`,
  registered as a chain on `factcheck_fail_reason`.
- **R3 (reduced).** The migration changes `factcheck_start` only. It carries a drift guard on that function, the CHECK
  name is confirmed before the drop, and the release checks for active sessions first.
- **R5.** `awaitingText` is not used. The listening line is driven by the session status (S7).
- **R7 (reduced).** The panel and start test locations are on the lists. The piece and capture test locations moved to
  "Not built after G1".
- **R9.** The G1 delay definition, including the cutter's hold, and the limit that pieces were sent one at a time.
- **R10 (reduced).** The rollback order stays: browser, then function, then migration. The transcribe-limit parts are removed.
- **R11.** The release order is unchanged. The controller needs no change.

Moved to "Not built after G1": R1 (earlier context), R4 (turn rule), R6 (failure limit), R8 (transcription worst case),
and the piece and capture test locations.

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
  352 kB as 16 kHz mono 16-bit WAV. **This is unchanged after G1.**
- `src/lib/factcheck/capture.js:136` calls `createPieceCutter()` with no options, so these are the production values.

**Transcription and text (read).**
- At most two transcribe calls run at once (`src/lib/factcheck/session.js:48`). Results are applied in strict piece
  order (`session.js:320-330`).
- Each piece adds one transcript line as it is applied (`session.js:331-341`). The speed of transcript text is set by
  the piece length.

**Turns and claim extraction (read).** Unchanged by this scope.
- `createTurnBuilder` (`pieces.js:297-330`) closes a turn at two pieces, or after a piece that ended at a pause of
  700 ms or more.
- The browser waits at least `extractGapMs` 10000 between extract calls (`session.js:50`).

**Server limits (read).**
- `public.factcheck_touch` (`supabase/migrations/20261116090000_factcheck.sql:369`) allows, per user per calendar
  minute, 10 transcribe calls, 6 extract and 20 check (`:423`). A refused call returns 429 `rate_limited`. **Unchanged.**
- Per session, the budget is 3m + 2 extracts and 8m + 4 checks, where m is the charged minutes (`:411-413`). A refused
  call returns 429 `budget`. **Unchanged.** A one-minute session therefore allows 5 extract calls and 12 checks.
- Piece validation (`supabase/functions/factcheck/wav.ts`): at least 0.5 s (`:9`), at most 15 s (`:7`) and 600,000
  bytes (`:6`).

**Session lengths: four places enforce 5, 10 and 15 (read).**
1. Table CHECK `minutes_bought IN (5, 10, 15)`: `20261116090000_factcheck.sql:81`. The CHECK has no name in the
   migration.
2. SQL function `public.factcheck_start`: the test at `:309` returns `bad_minutes` (`:310`).
3. Edge Function `supabase/functions/factcheck/start.ts:101`, with the message at `:154`.
4. Browser `MINUTE_CHOICES = [5, 10, 15]` at `src/shell/factcheck/factCheckText.js:5`.

**Charging (read).** Charging is by whole started minutes, with a floor of one minute and a cap at the minutes bought
(`private.factcheck_charge_minutes`, `20261116090000_factcheck.sql:207-211`). A one-minute session holds and, stopped at
once, is charged 500 credits at 500 credits a minute.

**Panel (read).**
- The text "Listening… Text appears about 13 seconds behind the speaker." is at `src/shell/factcheck/FactCheckPanel.jsx:466`.
  It is shown only when the transcript is empty. The test at `FactCheckPanel.test.jsx:173-177` pins the wording.
- The length buttons read "N minutes" at `FactCheckPanel.jsx:91` and the Start button at `:117`. With 1 minute
  that would read "1 minutes".
- The default selected length is the first affordable option (`FactCheckPanel.jsx:67`).
- The "Start a new session · from …" button uses the first option's price (`:509`).
- The status "ending" shows "Finishing…" in the clock (`FactCheckPanel.jsx:410`).
- The autoscroll trigger is `tail` (`FactCheckPanel.jsx:155`). The silence notice starts at `SILENT_NOTICE_MS` 30000
  (`FactCheckPanel.jsx:14`).

**Loading.** The whole feature is behind the lazy import at `src/shell/TerminalShell.jsx:44` (read). The first-load
JavaScript limit is 182,446 bytes gzip (`scripts/check-bundle.mjs` reads the limit; the figure is recorded in
[the 2026-10-25 release record](../plans/2026-10-25-preview-production-release.md)). That record shows 181,765 bytes,
so 681 bytes of headroom; the build of 2026-11-17 measured 181,763 bytes (executed), so 683. No new code may be imported
statically from the shell.

**Measured before this scope (executed, 2026-11-15).** Gate G2a in the
[F344 spec](2026-11-15-live-tv-fact-check.md#g2a-chunked-transcription-through-openrouter-executed-2026-11-15) tested
consecutive pieces of 10 s and 20 s, without overlap, on four 90-second clips captured by tab sharing.

## Decisions

Labelled S5 to S9 for reference. S1 (piece length) is decided by G1 and is in "Gates". S2, S3, S4 and S10 are not built
and are in "Not built after G1".

- **S1. Piece length: unchanged.** Gate G1 executed 2026-11-17 and both shorter settings failed the pass rule (see
  "Gates"). The piece length stays at `targetMs` 10000, `minMs` 8000, `maxMs` 12000, with 1 s overlap. The 7 s
  fallback also failed, so it is not built.
- **S5. Lengths.** Allowed lengths become 1, 2, 5, 10 and 15 in all four places listed under "Current state". The
  charging rules are unchanged. The database rule is replaced in the same transaction (OD4).
- **S6. Browser choices.** `MINUTE_CHOICES = [1, 2, 5, 10, 15]`. The label is "1 minute" in the singular, and "N minutes"
  otherwise. The default selected length stays 5 minutes when it is affordable (OD3). Otherwise it is the longest
  affordable length below 5. The "Start a new session · from …" button keeps using the lowest price, which becomes 500
  credits.
- **S7. Listening line.** No snapshot field is added. The controller needs no change. While the session status is
  `running`, and no silence notice is showing, the transcript ends with a line "Listening…". It is not shown in `ending`,
  `ended` or any other status. It is not shown while the silence notice is showing.

  The line has its own React key, which cannot collide with a piece number. It is included in the autoscroll trigger
  (`FactCheckPanel.jsx:155`) so that it stays in view. The transcript region stays `aria-live="off"`, so the line is not
  announced. Its animation is off under reduced motion.

  Before the first line, the existing empty text stays, with the delay figure from S8.

  **Reason.** A count of pieces waiting for text would switch the line on and off with every piece (publishes at
  `session.js:289` and `:322`). A steady line while the session is running is simpler and does not blink.
- **S8. Delay figure: 14 seconds.** The delay in the text becomes a constant `DELAY_SECONDS = 14` in `factCheckText.js`.
  It is the median delay measured by G1 at the current piece length (13.2 s, rounded up to a whole second). The panel
  text reads "about 14 seconds", and its test at `FactCheckPanel.test.jsx:173-177` changes from 13 to 14. The G1
  estimate is not a measurement of the owner's real session; that is the final check.
- **S9. Scope of the change.** No new flag keys, no new dependency and no new provider. No change to the price, the hold,
  settlement, checks, re-checks, or the turn, extract and transcribe limits. All new browser code stays inside the lazily
  loaded chunk.

## Open decisions for the owner

All answered on 2026-11-17 by the owner.

- **OD1. Recorded clips for gate G1.** Answered: **route B** approved. The tools were installed and the clips recorded by
  the supervisor.
- **OD2. Cost of short sessions.** Answered: **accepted** ("don't worry about it"). It covers the higher worst-case cost
  per charged minute of 1- and 2-minute sessions. The transcription worst case of the not-built S3 is not part of this
  answer, because S3 is not built.
- **OD3. Default length.** Answered: **yes**. The default selected length stays 5 minutes (S6).
- **OD4. Widening the database rule.** Answered: **accepted**. The database rule may be replaced. Rollback is possible only
  while no session row has 1 or 2 minutes. After that the wide rule must stay.
- **OD5. Longer lengths.** Unchanged. 20 and 30 minutes remain held until the F349 fixes are proven by a real session.

## Gates

### G1: accuracy and delay of shorter pieces (executed 2026-11-17; both shorter settings failed)

**Method, as run.**
- Four clips at 16 kHz mono WAV, recorded the same evening. The method was fixed before the run; the clips were not the
  exact kinds the method named, as the list below records:
  - Aaj Tak live, Hindi news, **85 s** (not 90 s);
  - DD News live, a **Hindi news bulletin**, not the debate the method named (no debate clip was available);
  - an explainer in Hindi with English;
  - WION live, English news.
- Each clip is cut with the repository's own cutter (`createPieceCutter` with options) at three settings: 10 s (8 to 12 s),
  the current setting; 7 s (5.5 to 8.5 s), the fallback; 5 s (4 to 6 s), the first choice. Each has 1 s overlap.
- Each piece is transcribed with `elevenlabs/scribe-v2` through OpenRouter. No request failed and none was retried.
  The pieces are joined with the repository's own overlap removal (`mergeOverlap`) and compared word by word with Scribe
  v2's transcript of the whole file.
- **Pass rule (fixed before the run).** A setting's average agreement must be no more than 3 percentage points below the
  10 s setting, and no more than 5 points below on any one clip. No request may fail.
- **Delay.** For each piece, delay is the sum of: the length of its new audio; the audio already captured past the cut
  when the piece is emitted (the cutter cuts in the middle of a pause found after the target length, `pieces.js:143`,
  `:163`; this is `heldMs`); and the reply time. The figure for a setting is the median over all pieces, rounded up to a
  whole second. It leaves out the time from the browser to the Edge Function.
- **Spend.** US$0.0958 in total: pieces US$0.0741, whole-file references US$0.0217. Raw output is outside the repository.

**Limits of the method.**
- There is no human reference transcript. Agreement with Scribe v2's whole-file transcript favours longer pieces, because
  the reference was made with more context.
- Four clips is a small sample, and one clip is a news bulletin, not a debate.
- Only transcription was tested. Capture was not.
- The browser sends up to two pieces at once. G1 sent them one at a time, so queueing is not measured.

**Results.**

| Measure | 10 s (8 to 12) | 7 s (5.5 to 8.5) | 5 s (4 to 6) |
|---|---|---|---|
| Average agreement, four clips | 93.1% | 87.6% | 85.8% |
| Worst clip agreement | 84.8% | 75.5% | 71.2% |
| Average drop from 10 s (limit 3.0) | - | 5.5 points: **fail** | 7.3 points: **fail** |
| Worst single-clip drop (limit 5.0) | - | 9.2 points as reported (**fail**)¹ | 13.6 points (**fail**) |
| Pieces, total for four clips | 38 | 52 | 69 |
| Mean posted seconds per piece | 10.2 | 7.8 | 6.1 |
| Median reply | 1.5 s | 1.1 s | 1.0 s |
| Worst reply | 4.4 s | 1.9 s | 2.0 s |
| Cost of the piece calls, four clips | US$0.0238 | US$0.0246 | US$0.0257 |
| Cuts at a pause / at a quiet window / hard | 14 / 15 / 5 | 20 / 22 / 6 | 17 / 32 / 16 |
| Median audio held past the cut | 0.7 s | 0.5 s | 0.3 s |
| Estimated text delay, median | 13.2 s | 9.4 s | 6.9 s |
| Delay figure, rounded up | 14 s | 10 s | 7 s |
| Result | **current setting** | **fail** | **fail** |

¹ The per-clip figures in the table below give 9.3 points for DD News (84.8 less 75.5). The reported figure is 9.2. The
outcome is the same either way.

**Per-clip agreement.**

| Clip | 10 s | 7 s | 5 s |
|---|---|---|---|
| Aaj Tak live (Hindi news, 85 s) | 95.6% | 91.5% | 88.3% |
| DD News live (Hindi news bulletin) | 84.8% | 75.5% | 71.2% |
| Explainer (Hindi with English) | 95.5% | 89.9% | 88.3% |
| WION live (English news) | 96.4% | 93.4% | 95.4% |

**Reading of the transcripts (supervisor's judgement, from reading the DD News clip).** Part of the gap is not error.
The whole-file transcript writes names and numbers in Latin script and digits ("Donald Trump", "2027"), while the piece
transcripts often write them in Devanagari and as words. The metric counts those as differences, so it overstates the
loss. But real damage is visible at 5 s, and much less at 10 s: wrong words (a common adjective replaced by a different
word), a wrong proper name, and phrases doubled at the joins where two pieces spelled the repeated words differently, so
overlap removal did not match them. Claims are extracted from this text, so wrong names and doubled phrases matter.

**Conclusion.** The pass rule was fixed before the run and is not revisited. Piece length stays at 10 s (S1).

**Other things G1 showed.**
- Shorter pieces were not more expensive in any way that matters: US$0.0257 at 5 s against US$0.0238 at 10 s, for about
  six minutes of audio.
- Replies were fast enough: the worst was 2.0 s at 5 s.
- Hard cuts rose from 5 of 34 cuts at 10 s to 16 of 65 at 5 s.
- The measured delay at the current setting is about 13.2 s median. That agrees with the "about 13 seconds" in the panel.
  The rounded figure is 14, used in S8.

## Acceptance evidence

The reduced scope is accepted when each of these is shown, with the command and its outcome recorded.

- Unit tests, each seen failing before the code is written:
  - the listening line (S7): shown while the status is `running`; hidden when `ending`, `ended` or any other status;
    hidden while the silence notice shows; the region keeps `aria-live="off"`;
  - the singular label "1 minute";
  - the default selection under S6, including the case where 5 minutes is not affordable;
  - the five length buttons at `FactCheckPanel.test.jsx:75-96` and `:120`, updated from three to five;
  - the delay text "about 14 seconds" at `FactCheckPanel.test.jsx:173-177`;
  - all five lengths accepted by `start.ts`, and 0, 3, 4, 7, 20 and 30 refused (`start_test.ts:144-161`).
- SQL fixture `supabase/tests/factcheck_lengths.sql`, proven non-vacuous by `npm run test:sql`. The run rebuilds without the
  new migration and requires the fixture to fail (`run.sh:412-430`):
  - lengths 1 and 2 accepted, and 3 and 20 refused, by both the CHECK and `factcheck_start`;
  - a one-minute session holds one minute's credits (500 at 500 a minute);
  - a one-minute session stopped at once is charged exactly one minute;
  - the one-minute budget allows 5 extract calls and refuses the 6th with `budget`.
- Gates, each run on the branch and recorded with its result:
  - `npm run lint`
  - `npm run build`
  - `npm run check:bundle` (the first-load limit is unchanged)
  - `npm test`
  - `deno test -A --config supabase/functions/deno.json supabase/functions`
  - `npm run test:sql`
  - `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`
- After release, on the owner's real session: no 429 `rate_limited` or `budget` on a 1- or 2-minute session that should be
  within its budget, and the 1-minute session's charge matches the rule above.

## Tests that change

- `src/shell/factcheck/FactCheckPanel.test.jsx:173-177`: the delay text changes from 13 to 14 seconds. The test still
  refuses "10 seconds".
- `src/shell/factcheck/FactCheckPanel.test.jsx:75-96` and `:120`: three length buttons become five. The default
  "Start 5 minutes · 2,500" is unchanged.
- `supabase/functions/factcheck/start_test.ts:144-161`: the accepted and refused block sizes.

The SQL tests in `supabase/tests/factcheck.sql` are **not** changed. Its chain applies only the first migration
(`supabase/tests/run.sh:178-181`), so the new migration never reaches it. Its existing assertions stay true: the CHECK case
at `:221-222` uses 7, and the text there is only a test label; `bad_minutes` at `:279-281` tests 0, 4, 20 and NULL; the rate
case at `:730-738` refuses the 11th transcribe in a minute.

The piece and capture tests (`pieces.test.js`, `capture.test.js`, `session.test.js`) are **not** changed, because piece
length and turns are not changed.

## Scope and exclusions

**In scope.**
- `supabase/migrations/20261119090000_factcheck_session_lengths.sql` (one new migration).
- `supabase/tests/factcheck_lengths.sql` (one new fixture), registered in `supabase/tests/run.sh`.
- `supabase/functions/factcheck/start.ts` and `start_test.ts`.
- `src/shell/factcheck/factCheckText.js`, `FactCheckPanel.jsx`, `factCheck.css`, their tests and `fixtures/`.

**Excluded.**
- Any change to piece length, turns, extract, the transcribe limit, the stored-piece cap or the failure limit (see
  "Not built after G1").
- `supabase/tests/factcheck.sql` and the piece and session tests.
- Live TV as its own page (the next item after this one, with its own spec).
- Switching sharing on.
- A streaming transcription test (option (a) above).
- 20 and 30 minute lengths.
- Any change to the price.
- Re-analysing a block.
- A past-sessions view.
- Any change to checks or re-checks.

## Not built after G1

These parts were built only for shorter pieces. Gate G1 failed for shorter pieces, so they are not built. Their text and
the review findings are kept so that a later attempt (for example option (b) above) can start from them.

- **S1 fallback (7 s).** Failed in G1. Not built.
- **S2. Turns in seconds, not pieces.** A turn's length is the span from the start of its first piece to the end of its last
  piece. After a piece that has text is added, the turn closes when:
  - the span is `TURN_MAX_MS` (20000) or more; or
  - that piece ended at a pause of 700 ms or more and the span is `TURN_MIN_MS` (10000) or more; or
  - the turn holds 12 pieces.

  A piece with no text (silent, only sound tags, or emptied by overlap removal) is never added. It closes the open turn
  only if the span to the **end** of that empty piece is `TURN_MIN_MS` or more. Otherwise the turn stays open.

  With 5 s pieces, a turn would be about 10 to 26 s long (a ceiling of 20 s plus one piece of up to 6 s), and a turn of a
  single 5 s piece would be produced only by the final flush. The reviewer's reasoning is that this keeps the number of
  turns the same or lower, which is not measured. The accepted limit: a turn open at the end of a session can be up to
  about 20 s, and is lost if the 100 s drain expires (`session.js:57`) or the session ends without draining. Today the
  same loss is about 12 s.

  **Today.** A turn is 8 to 24 s (one piece of 8 to 12 s ending at a pause, or two pieces). The review's correction to the
  earlier "10 to 20 s" statement applies.
- **S3. Transcribe limit 24 per minute.** Would allow 15 pieces at the 4 s minimum, plus room for retries. Not built.
  **Review finding R8.** Every transcribe call that passes the limiter counts, and the server accepts pieces of up to 15 s
  (`wav.ts:7`). So a client that is not our browser could send 24 × 15 s = 360 s of audio a minute, against 150 s today.
  Before the audience becomes "all", the maximum piece length the server accepts would be lowered to about 8 s, after
  the browser change is fully out, because old pages still send pieces of up to 13 s.
- **S4. Stored-piece cap 240, and the earlier context.** Would raise the cap from 120 to 240 per session (15 minutes at 4 s
  is 225 pieces). Not built. **Review finding R1.** The earlier-context read cannot be raised with the constant alone. The
  context read uses the same SQL function, `public.factcheck_turn_pieces`, which refuses any range over 12
  (`20261117090000_factcheck_sharing.sql:299`). `storedPieces` cuts every answer to 12 (`extract.ts:98`). A refusal comes
  back as an empty context with no error (`extract.ts:95-96`, `:151`). So raising only the TypeScript constant would
  silently remove the context. A later change would have to change the SQL rule too. With sharing off, the reviewer
  accepted the earlier context at about one minute of 5 s pieces, against about two today. A merged ranged turn would
  reach the 12-piece cap at about 60 s instead of about 120 s, and then fall back to a text turn that is not shared.
- **S10. Failure limit 5.** `LIMITS.failureLimit` (`session.js:54`) would rise from 3 to 5. It counts consecutive failed
  calls, not time. With pieces arriving about twice as often, three failures fit in about 15 s of provider trouble instead
  of about 30 s, and the session would end with an error while still charged. **Review finding R6.** It would have to
  accompany any change to the piece length, with a test in `session.test.js` (five consecutive failures end the session;
  four do not).
- **Review findings on the piece and capture tests (R7, part).** `pieces.test.js:32-75`, `:92-101`, `:120-139` and `:126-152`,
  `capture.test.js:189-196`, and `session.test.js:20`, `:991-1003`, `:1134`, `:1198`, `:1259` and `:1360` assume 10 s pieces.
  They would change only with a piece-length change.
- **Repeated words at joins when sharing is on (R10, part).** Shared stretches show raw piece text without overlap removal
  (`20261117090000_factcheck_sharing.sql:366`). Repeated words at joins would appear about twice as often. This is a
  follow-up before sharing is switched on, and is unaffected by G1's result, but it belongs with the sharing item.

## Relation to earlier decisions

- ADR 0015 accepts the browser-side audio capture. This change does not alter capture.
- The credit rules of ADR 0011 are unchanged. The charge per started minute, the floor of one minute and the cap at the
  minutes bought are the same as today.
- No new provider or key is introduced (ADR 0002 applies to the existing OpenRouter route).
