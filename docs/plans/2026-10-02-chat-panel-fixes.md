# Plan: research chat panel fixes (`chat-panel-fixes`)

> **Status: Living.** Implements `docs/specs/2026-10-02-chat-panel-fixes.md` (F47, F46 D4).
> - The tasks run test-first, and each is committed once verified.
> - Deploying `research-chat` and pushing each wait for their own go-ahead.

### T1. The live timing word
- **Acceptance:** the `timing` frame carries `usage.reasoning_tokens` (the saved row's figure),
  and the client keeps it with the timing. Handler and client tests failed first.
- **Files:** `research-chat/handler.ts`, `_shared/chatStream.ts`, `src/lib/researchChat.js`,
  tests.

**T1, recorded 2026-10-02.**
- The frame carries the same figure the saved row's word reads: `usage.reasoning_tokens`, which is
  null, sent as 0, unless every call reported it.
- **The handler test** asserts the frame equals the saved row's figure (768 over three calls). It
  fails with the server change reverted.
- **The client test** failed first.
- **Checks:** Deno research-chat 310, and Vitest `src/ai` plus `researchChat` 799, pass.

### T2. The history-open dimming
- **Acceptance:** the rules match the real structure, `.history-open .ai-panel-background >
  .ai-v2-…`, and the head's stacking rule is corrected the same way. Checked in the browser run
  by computed opacity and pointer events while history is open.
- **Files:** `src/index.css`.

### T3. Phone width (375 × 812)
- **Acceptance:** the cause is found in a browser run, and fixed there: the composer is fully
  visible and the thread is at least 40% of the screen.
- **Files:** `src/index.css` (and the shell, if the cause is there).

### T4. The end-of-turn shift
- **Acceptance:** citation placeholders take a bubble's width, and the sources list's space is
  reserved from the first source. The shift is measured before and after in the browser.
- **Files:** `src/ai/AiMarkdown.jsx` (or wherever the placeholder renders), `src/ai/AiPanel.jsx`,
  CSS, tests.

### Checkpoint
- Lint, both suites and the build pass.
- **The browser run** is recorded in `docs/research/`.
- **Go-aheads:** deploying `research-chat` (T1's frame), then the push.
