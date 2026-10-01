# Plan: stream the answer, cut TTFT, cache

> **Status: Living (2026-10-02).** Implements `docs/specs/2026-10-02-answer-streaming.md`
> (approved). Branch: `task/answer-streaming`. Tracked as open-work F46.

## Fixed interfaces

**Agent events** (`research-chat/agent.ts`):
- `{ draftText }` replaces `{ researchText }`: a research call's text, sent live.
- `{ retract: 'searching' | 'rewriting' | 'error' }`: that call's draft is not the answer. It
  is sent only when the call sent any draft text.
- `{ promoted }` no longer follows with one `{ text }`. The draft already reached the handler.

**SSE frame:** `{ reset: { reason } }`.

**Timing** gains:
- `first_model_ms`
- `first_answer_ms`
- `rounds`

**`StreamRequest.session_id`** becomes `body.session_id`.

## Tasks

1. **T1. Agent.** Draft text goes out live; the call sends `retract` when it ends in tools,
   fails `acceptedDraft`, is pushed to search, or errors. Tests are written first.
2. **T2. Handler.**
   - `draftText` goes to the decoder like `text`;
   - `retract` resets the decoder, `streamed`, `visible` and the writing clock, checkpoints
     empty content, and sends `reset` if anything was shown;
   - the timing fields;
   - `session_id = conversation.id`.

   Also `openrouterStream` (`session_id`) and `chatStream` (the frame type). Tests are written
   first.
3. **T3. Client.**
   - `reset` clears `streamingText` (`researchChat.js`);
   - the identity check is reused within an epoch while the token has 60 s or more left
     (`userStore.js`);
   - the timing line shows "first word".

   Tests are written first.
4. **T4. Checks.**
   - lint;
   - Vitest;
   - Deno;
   - build;
   - `check:bundle`;
   - the router import.
5. **T5. Local run** (executed 2026-10-02; see `research/2026-10-02-answer-streaming-local-run.md`).
   - visible TTFT and the number of chunk frames;
   - a forced retraction;
   - the cache A/B on Gemini, with and without breakpoints, plus Claude, recorded with costs.
6. **T6. NTER**, each step with its own go-ahead: deploy `research-chat`, then push the frontend.
