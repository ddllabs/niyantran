# Spec: the AI Research panel opens in one piece (`panel-loading`)

> **Status: Normative — approved by the owner on 2026-10-02.**
> The owner chose: "all five, A to E", "first open the loading page, or on every open", and "go
> ahead with your recommendation for all open questions".
>
> Evidence: `docs/research/2026-10-02-chat-experience-review.md` (B1–B3, D3, D4). Tracked as
> open-work F46.

## Current state (code and local recordings)

- **Closing unmounts the panel.** The panel is built from nothing on every open:
  - `AiDock.jsx` returns `null` when closed;
  - `useResearchThread` disposes its controller.
- **Opening makes three full account verifications, one after another,** each a user-plus-profile
  round trip:
  1. the controller's `hydrate`;
  2. then `hydrateConversations` (`verifiedScope`);
  3. then `loadMessages` (`verifiedScope`).

  The conversation list and the messages follow, for about 8 round trips before the thread
  shows.
- **The reveal comes in stages.** In order:
  1. "Loading research…" and "No approved models";
  2. the chips;
  3. the conversation list, with an empty active chat;
  4. the whole thread;
  5. the suggestion pills, which shrink the thread;
  6. the model name and author labels;
  7. the coverage badges, from their own query.
- **The desk is laid out twice.** `AiDock` reports its open state from an effect, so the shell
  first renders the dock beside the right rail, then again without it.
- **Every update re-renders the whole panel** and re-parses every message's markdown.

## Expected outcome

**A. Keep the panel alive between opens.**
- The dock mounts on its first open and stays mounted. Closing hides it.
- **Reopening is instant:** the same conversation, the same scroll position, a draft kept, and
  no reload.
- **While hidden, background checks pause:** the coverage re-check and the outside-click
  listener.
- **An account change still clears everything at once,** as today.

**B. One account verification per open.**
- The controller verifies once and passes that identity to `hydrateConversations`, which
  passes it to `loadMessages`.
- **The rule (as in amendment 3 of `answer-streaming`):** a passed identity is used only while
  `localIdentityIsCurrent` holds (same Auth epoch, same session token, unexpired; a local
  check). Otherwise the account is verified again.
- **Effect:** three verification round trips per open become one.
- **Unchanged:**
  - other callers;
  - writes (`persist`);
  - the re-verify-after-every-Auth-event behaviour.

**C. One reveal.**
- **Until the conversation list and the active chat's messages are both loaded,** the thread
  area shows a placeholder of fixed shape, not "Chat is empty".
- **The model button** shows a fixed-width placeholder while models load, not "No approved
  models".
- **The suggestion and follow-up row** keeps a reserved minimum height, so its arrival does not
  shrink the thread.
- **Then the thread appears in one step,** scrolled to its newest message.

**D. The open state is set at the click.** `AiDock` reports open and close from the same event
handler that changes them, so the shell renders the new layout once.

**E. Cheaper redraws.**
- Saved messages render through a memoised row component, so a streaming update or a draft
  keystroke does not re-render or re-parse them.
- Each row's markdown is parsed once per change of its text and sources.
- The handlers each row needs are stable.

## Acceptance evidence

**Tests, each shown red first where behaviour changes:**
- **B:**
  - `hydrateConversations` with a current identity makes no user or profile calls, and its
    `loadMessages` makes none either;
  - a stale identity is verified again;
  - another account, or a suspended one, is still refused.
- **A:** the dock's keep-alive model (mounted after the first open, hidden when closed) and the
  pause of background work while hidden.
- **C:** the placeholder and reserved slots, by static render.
- **D:** open and close are reported once, at the click (the handler, not an effect).
- **E:** a saved row does not re-render when only the draft or the stream changes (a render
  counter).

**Repository checks:** lint, both test suites, build and `check:bundle`.

**A local browser run:**
- the verification calls during open counted (expect 1 user and 1 profile);
- the open sequence recorded with a MutationObserver: no "Chat is empty" before the thread, and
  no composer or thread jump;
- a close and reopen with nothing refetched and the scroll position kept;
- an account switch clears the panel.

**NTER:** a frontend push, with the owner's go-ahead.

## Scope

**Write scope:**
- `src/ai/AiDock.jsx`, `src/ai/AiPanel.jsx`, `src/ai/useResearchThread.js`;
- `src/lib/aiConversations.js` (the passed identity only);
- `src/ai/research.css`;
- a new `src/ai/MessageRow.jsx`, if E needs it;
- their tests.

**Exclusions:**
- the server;
- the agent loop's speed;
- the phone dock height (F47);
- streaming of the answer, already done.

## Local browser run (executed 2026-10-02)

**Setup:**
- a local stack with two seeded accounts, A and B, and a 12-message thread for A;
- the dev server on `task/panel-loading` at `4a5f1ed`;
- 1440 × 900.

| Check | Result |
| --- | --- |
| B: verification on open | **1** `getUser` and **1** `get_my_profile` (was 3 pairs). Then models, roles, pricing and the conversation list load in parallel, and the messages straight after |
| D: one layout | The first recorded state already has `.workspace.ai-open`, no right rail and the dock shown, all in one render |
| C: one reveal | Exactly two states: the placeholder (composer at 776, model placeholder), then the full thread with "Gemini - Flash" (composer at 776), at the newest message |
| A: close, then reopen | Close hides the dock and restores the rail in one render. Reopen makes **0** network calls, keeps the same DOM node, and restores the scroll offset (1,200 px) |
| Account switch while hidden | Signing in as B cleared A's thread at once (0 messages, no A text); B opens to an empty chat |

**Fixed in the run:** messages drew under the placeholder for one frame (about 16 ms). The
thread now waits for `ready` too. The test was shown red first.

**Noted, not changed:**
- **Bundle headroom:** `check:bundle` is at +2,022 of the +2,048 bytes allowed over the
  baseline.
- **The remaining delay:** click to first paint is about 200–370 ms locally. It is the shell
  re-rendering the desk table, which is out of scope.
