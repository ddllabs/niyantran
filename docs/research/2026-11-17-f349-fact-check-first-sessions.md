# Live TV fact-check: the first live sessions (F349)

> **Status: Living (2026-11-17).** Tracker: [F349](../plans/open-work.md). Fix plan:
> [2026-11-17-f349-fact-check-fixes](../plans/2026-11-17-f349-fact-check-fixes.md). Findings are read-only. Nothing was
> built, changed or deployed. Each fact below says whether it was executed (measured or queried) or read from code.

## 1. Why

The owner ran the first live admin sessions on 2026-11-17, from 14:29 to 14:55 UTC. The owner reported three things:

- a. A check sometimes "times out" and shows failed until "Run again" is pressed.
- b. Closing and reopening the pop-up shows different states for the same content (failed or not searched, and later
  Supported).
- c. A connection drop happened during checking. The open question is whether the provider fails or the HTTP request
  times out. The owner proposed waiting longer.

## 2. Method

- Two independent browser test runs: one in desktop Chrome, one in an embedded browser pane.
- A read-only trace of NTER: SELECT on `factcheck_sessions`, `factcheck_claims` and `model_call_logs`, and the function's
  request and console logs.
- Reading the code.
- No session was started by the test runs. The test runs spent 0 credits.

## 3. What the browser runs found (executed)

Neither test run could start a capture. None of the three reports was reproduced in a browser.

- Desktop Chrome showed "Capturing the tab's audio failed." within about 4 seconds. No share prompt appeared.
- The embedded pane showed "Sharing was declined. Fact-check needs this tab's audio." at once.
- Likely cause: a scripted click is not accepted as a user gesture for tab capture. Not established.

Flow seen in the browser:

- The button reads "Fact-check · 500 credits a minute".
- Blocks of 5, 10 and 15 minutes cost 2,500, 5,000 and 7,500 credits.
- Six consent bullets are shown. There is no separate consent step.

Rough edges seen in the browser:

- The two capture error messages do not say what to do. They do not say whether credits were held.
- A refusal by the browser reads the same as the user declining. "Try again" repeats the refusal without end.
- The player area jumps after the error.
- At about 812 px wide, the panel drops below the video. Nothing signals that it opened.
- At 700 px height, the Cancel button is cut off until the panel is scrolled.
- The consent text does not say that the feature needs Chrome.
- The dark theme was not tested.

## 4. What NTER shows (executed)

Read-only trace of NTER, covering 14:20 to 14:55 UTC on 2026-11-17.

| Measure | Result |
|---|---|
| Sessions | 7. Each was bought as 5 minutes. |
| Minutes used | 3, 3, 2, 3, 1, 1, 2. |
| Settlement | All 7 settled. Each was charged for the minutes used. |
| Requests to the function | 133 answered 200, slowest 7.5 s. 4 answered 409 in 0.2 to 0.3 s. No 5xx. No 429. |
| `claim_check` provider calls | 22 calls, 1.7 to 6.0 s. All succeeded. |
| `claim_recheck` provider calls | 4 calls, 2.1 to 4.1 s. All succeeded. |
| Extraction provider calls | 27 calls, at most 5.3 s. All succeeded. |
| Transcription provider calls | 53 calls, at most 2.9 s. All succeeded. |
| Claims at the time of the trace | 43 in all. 18 were `not_checkable` or `needs_context` by design. |

Provider calls come from `model_call_logs` with caller `factcheck`.

### Findings

**F349-1. A check that the provider answered is stored as `error`.**

- What happens: `verdictFor` in `supabase/functions/factcheck/check.ts` stores `error` in two cases. The first is when the
  reply's LABEL line is not exactly one of the five labels (`parseVerdict`). The second is when a verdict other than
  `no_evidence` comes back with no citation. The reply text and the branch that fired are not kept. The call is logged
  as `success`.
- Evidence (executed): all 4 `error` rows are one claim. The claim says that Trump praised Modi at a Quad leaders'
  meeting on the sidelines of the ASEAN summit in Manila. The rows are the original check and three "Check again"
  presses. Each provider call returned the same shape: 259 prompt tokens, 41 completion tokens, 3.7 to 4.1 s. The check
  runs at temperature 0 (read from code), so a repeat gives the same answer.
- Confidence: the code path is confirmed (read from code). Which branch fired is not established.
- Effect: the panel shows "Check failed" on a claim that was searched and answered. Pressing again cannot help.
- Which rule (added 2026-11-17, executed in two real sessions and read from code): the rule was the one in `replyFailure`
  that returns `no_label` when the reply has no LABEL line at all. All six `no_label` calls in the two sessions were of
  this kind, and no other reason code appeared. The reply text is not kept, so the exact reply is not known. A LABEL line
  that names none of the five labels is `bad_label`, which these sessions did not show. The cause is tracked as F351.

**F349-2. The four 409 responses.**

- What happens: three `start` calls were refused as `already_active` (14:52:29, 14:52:58, 14:53:17). One `transcribe`
  call was refused as `settled` (14:52:43) (executed).
- Sequence (the owner confirmed on 2026-11-17 that Live TV was open in two tabs or windows at about 14:52 UTC, so the cause of the 409 responses is confirmed). Page A started a
  session at 14:52:06. Page B's start was refused. Page B pressed "End that session", which stopped A's session at
  14:52:33. A's next `transcribe` got 409. `session.js` turns any 409 into an end with the text "The server ended the
  session." Page B then started a new session.
- This is the only session the server ended. It is the "connection drop" the owner reported. It is not a network failure or a
  provider failure.

**F349-3. Why sessions ended early.**

- No session reached the failure limit of 3 consecutive failed calls (executed).
- Six sessions ended from the browser side. Their last piece was a short flushed partial. Per the code, a short flushed
  partial only happens on: Stop, closing Live TV, a channel change, the browser's "Stop sharing", time up, or the 90 s
  silence limit (read from code).
- Two of these sessions had silence before the end: about 40 s, and about 77 to 87 s (executed).
- The server cannot tell these causes apart. "Not a failure" is confirmed. The cause for each session is not
  established.

**F349-4. Different state after reopening (read from code).**

- The claim list lives in the page. It survives closing and reopening Live TV.
- Closing Live TV stops a running session. Checks in flight finish while the panel is hidden.
- Nothing is re-read from the server on reopen.
- So the following can happen:
  - A claim that showed "Checking…" when Live TV closed shows its verdict when it reopens.
  - A second page shows a different list.
  - The session-level "Run again" button clears the list and starts a new paid session.
  - A claim that already shows "Check failed" does not become Supported by itself.
- Labels that can read as "not searched": "Not checkable", "Needs context, not checked", "Not checked".
- Which path the owner saw is not established.

**F349-5. No timeout exists in the data.**

- Limits read from code: the browser allows 45 s per call with two retries. The server allows 25 s for a check.
- The slowest request in the trace was 7.5 s (executed).
- A longer limit would change none of the three reports.

**F349-6. Other things seen.**

- (a) `model_call_logs` records an unusable check reply as `success`. This hides F349-1 (executed and read from code).
- (b) The panel offers a paid "Check again" on a failure that repeats. The three presses on the failed claim were not
  charged (`credits_charged` is null, executed). The third press reached the 3-failure lock. One re-check was charged
  100 credits. It ran on a claim that was already Supported and returned Supported again (executed).
- (c) Any 409 on transcribe, extract or check ends the session with no reason shown (read from code).
- (d) A 27-second session that the admin's other page ended was charged one minute (500 credits). This matches the
  pricing rule (executed).

## 5. Corrected hypothesis

An early reading said that the provider was slower than the browser's 45 s limit. That reading was wrong. The provider
latencies in section 4 refute it.

## 6. Not established, and what would settle each

- What the provider returned for the failed claim. Settled by a reason code in the log, or by one deliberate paid replay
  that the owner approves.
- Which action ended each session. Settled by an end reason sent with `stop`, or by a network trace from a real session.
- Whether two pages were open at 14:52 UTC. Settled: the owner confirmed on 2026-11-17 that Live TV was open in two tabs or windows at about 14:52 UTC.
- Whether a failed capture can leave credits held. Settled by reading the order of `start` in code and by a test.
