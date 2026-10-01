# Spec: stream the answer token by token, cut time to first token, and cache (`answer-streaming`)

> **Status: Normative — approved by the owner on 2026-10-02.**
>
> **Owner direction, 2026-10-02:**
> - receive OpenRouter's response as it streams and show each answer token as it arrives,
>   with no holding;
> - focus on time to first token (TTFT);
> - include the caching work.
>
> **Evidence:**
> - `docs/research/2026-10-02-chat-experience-review.md` (D1, D2);
> - the code trace and NTER cache measurement recorded below.
>
> Tracked as open-work F46.

## Current state (measured or traced, 2026-10-02)

### Upstream streaming already works

`_shared/openrouterStream.ts` sends `stream: true` and turns each SSE `delta.content` into a
`text` event as it arrives.

### Our agent holds the answer back

Every research call carries the answer JSON schema, so the call that stops searching writes the
whole answer.
- **During that call** (`research-chat/agent.ts:584-591`), its text goes out only as
  `researchText`, and the handler drops it.
- **After the call finishes,** if it called no tool and `acceptedDraft` passes
  (`agent.ts:627-638`), the whole reply is emitted as one `text` event.
- **On screen,** that becomes one `chunk` frame: the whole answer at once (`writing_ms` ≈ 0).

Token-by-token streaming happens only in the fallback answer phase with tools off
(`agent.ts:587-590`), which rarely runs since "promotion" was added to save that call.

### At the end, a jump

The citation ladder or a repair call can rewrite the answer. A `patch` frame then replaces text
from its first difference; a prepended note gives `from = 0`, which repaints everything.

### TTFT in the local recording (12-page bill, Gemini 3.8 Flash, Low)

| Stage | Time |
| --- | --- |
| Send → "Reading the question" | about 2.5 s (client identity re-check, server setup, first model call opening) |
| First model call (search decision) | about 6.5 s |
| One search | about 0.9 s |
| Final model call (writing the whole answer, held) | about 14 s |
| **First answer token on screen** | **about 22 s, all at once** |

The final call's text started arriving within a few seconds of that call opening, but was held
until it finished.

### Caching (NTER, 14 days, `model_call_logs`)

| Model | Prompt tokens read from cache |
| --- | --- |
| Gemini 3.8 Flash | 75% |
| Gemini 3.7 Flash | 66% |
| Gemini 3.5 Flash-Lite | 65% |
| Claude Sonnet 5 | 24% (15 calls cost $1.06) |
| DeepSeek V4 Flash | 27% |

- **The request sends:**
  - Anthropic-style `cache_control` breakpoints on the system message and the last user
    message, for every provider;
  - a top-level `cache_control` for Anthropic only.
- **It does not send:**
  - a `session_id`. Sticky routing falls back to OpenRouter's hash of the opening messages.
- **Open question:** OpenRouter documents that per-block breakpoints routed to Google become
  explicit (billed) caching. Gemini's implicit caching is free, so the breakpoints we send may
  cost Gemini turns money. This is unmeasured.

## Expected outcome

### 1. Stream the answer as it is written

In every model call, the answer decoder runs on the call's text as it arrives, and each decoded
answer character is sent at once as a `chunk`. This includes research calls, not only the
fallback answer phase.

**Retraction:**
- A research call's streamed text is provisional until its call finishes. If the call then turns
  out not to be the answer, the server sends a new frame, `{ reset: { reason } }`, and the
  client clears the streamed answer:
  - it ends in tool calls (`reason: 'searching'`);
  - `acceptedDraft` fails (`reason: 'rewriting'`);
  - the stream breaks.
- The thinking display carries on with the next stage. The decoder and the server's streamed
  text are reset too.
- Retraction is expected to be rare: with the JSON schema, a call either asks for tools or
  writes the answer.

**What does not change:**
- The rule that a promoted reply must pass `acceptedDraft` before it is saved as the answer.
- What is saved.
- The citation ladder, repair and the `patch` frame at the end.
- **Safety:** the decoder still emits only the envelope's `answer` string, never `sources`,
  `follow_up_questions`, or text outside the root object.

### 2. Measure TTFT

`timing` gains three fields, each measured server-side from the request's arrival, for every
turn:
- `first_model_ms`: the first model call opens;
- `first_answer_ms`: the first answer character is sent;
- `rounds`: the number of model calls in the turn.

They are saved with the message.

- **Expanded thinking display:** the timing line adds "first word 3.1s".
- **Visible-text TTFT:** the local run records the time from Send to the first answer text on
  screen.

### 3. Cut client-side waiting before Send reaches the server

- **Today:** the browser re-verifies the account (`verifiedLocalIdentity` is two sequential
  network calls) before the request goes out.
- **Change:** reuse the identity verified for the current auth epoch, as long as its access
  token is valid for at least 60 more seconds. This is the same rule the server re-checks on
  every request (`requireUser`), so authorisation does not weaken; only a redundant
  browser-side round trip goes.
- **Measured before and after,** in the local run.

### 4. Caching

- **Send `session_id` = the conversation id** on every model call of a turn, so OpenRouter's
  sticky routing keeps a conversation on the provider that holds its cache.
- **Measure, then decide, Gemini breakpoints:**
  - **The test:** the same two-turn conversation on the local stack, with and without the
    per-block `cache_control` on Gemini.
  - **Compare:** cached tokens, cache-write tokens and cost from `usage`.
  - **The rule:** drop the breakpoints for Google models only if the measurement shows they
    cost more or cache less. The result is recorded either way.
- **Claude:** the measurement run also explains the 24%, for example whether the moving
  last-user breakpoint is placed so that each round re-reads the previous one.
  - A fix is in scope only if it is a request-shape change (breakpoint placement) shown by the
    measurement.
  - Anything larger is reported.

## Acceptance evidence

**Tests, each shown red first:**
- **Agent:**
  - research-call text reaches the decoder live;
  - a research call that ends in tool calls, or fails `acceptedDraft`, emits `reset`, and
    nothing from it is saved;
  - a promoted answer is not emitted a second time.
- **Handler:**
  - `chunk` frames arrive before the call's finish;
  - `reset` clears the decoder;
  - the `timing` fields;
  - `session_id` is in the request body.
- **Client:**
  - `reset` clears `streamingText`;
  - the identity check is reused within an epoch, and re-run after an auth event.

**Repository checks:** lint, both test suites, build, `check:bundle`, and the router import.

**A local browser run with the bill:**
- tokens appear while the final call is still running, with many `chunk` frames rather than
  one;
- the first answer text on screen well before the call ends;
- a forced retraction (a test hook on the local stack only) clears cleanly;
- `timing` is saved;
- the caching A/B, recorded with its cost.

**On NTER,** each step with its own go-ahead:
1. deploy `research-chat`;
2. push the frontend.

## Scope

**Write scope:**
- `supabase/functions/research-chat/{agent,handler}.ts` and their tests;
- `supabase/functions/_shared/{openrouterStream,chatStream}.ts` and their tests;
- `src/lib/researchChat.js`;
- `src/lib/userStore.js` (the reuse of the identity check) and its tests;
- `src/ai/ActivityTicker.jsx` (the "first word" field).

**Exclusions:**
- fewer research rounds, smaller prompts, or a faster model for search rounds (the total-time
  and cost work, still to be discussed);
- streaming the model's reasoning;
- the loading-in-stages work;
- the end-of-turn `patch` jump, beyond keeping it working.

## Amendment 1 (2026-10-02, during the build)

**How a draft is taken back.** The draft is cleared with the existing
`{ patch: { from: 0, text: '' } }` frame, not with a new `reset` frame.
- **Why:** the live frontend ignores frame names it does not know. With a new frame, a server
  deployed before the frontend would have left a withdrawn draft on screen, joined to the final
  answer. Every client already applies `patch`, so either side can ship first.
- **The reason is logged instead.** `research.draft_retracted` records `reason` and `chars` in
  the Edge logs.
- **Behaviour:** the same as the approved outcome.

## Amendment 2 (2026-10-02, during the build): §3 is withdrawn from this change

**What was tried.** Reusing a successful ordinary identity check, within the same epoch and
token, with at least 60 s of token left and a check no more than 5 minutes old.
- **Result:** 13 existing tests failed (`userStore.identityFailure`, the reconciliation and
  preference-race tests, and the Stop-race test).
- **What they encode:** every protected request in the browser re-verifies the account from
  scratch. So a suspended or switched account, or a transient failure, is acted on at the next
  request, not up to 5 minutes later.
- **Why that matters:** the server would still refuse a bad request. But this is the
  sign-in path, a sensitive scope, and weakening that invariant was not what the owner approved.

**The change was reverted.** The send path is unchanged.

**Next:**
- the local run measures what the pre-send check actually costs;
- a narrower option goes to the owner if it is material.

## Amendment 3 (2026-10-02): owner direction "Optimize latency as much as possible. Save those 0.5 seconds"

1. **One account verification per send, not two.**
   - **The cause** (a stack trace in the browser): `researchChat.run()` verified the account and
     passed that identity to `aiClient.sendResearchTurn`, which ignored it and verified again,
     two sequential user-plus-profile round trips before the request left.
   - **The change:** `sendResearchTurn` now uses the caller's identity while
     `localIdentityIsCurrent` holds (same Auth epoch, same session token, unexpired; a local
     check). Otherwise it verifies again as before.
   - **What still holds:**
     - every send still rests on one fresh verification;
     - an Auth event in between still forces re-verification;
     - a suspended account is still refused (tests).
   - This replaces the withdrawn §3 approach (amendment 2).
2. **No cache breakpoints on Google models.**
   - **The owner chose latency:** time to first word goes from 9–25 s to about 5–6 s, for about
     60% more cost per Gemini answer.
   - **Anthropic** keeps its breakpoints.
   - The measurements are in `research/2026-10-02-answer-streaming-local-run.md`.

