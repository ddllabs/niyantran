# AI Research chat: experience review (thinking, loading, layout, speed)

> **Status: Historical (dated 2026-10-02).** A review requested by the owner after testing R6 on
> NTER. Nothing was changed.
>
> **Method:**
> - two read-only code reviews;
> - a headless layout render of the built CSS;
> - three recorded sessions in the built-in browser on a local stack, at `3a44ff2` (the code live
>   on NTER), with real OCR and a real chat model.
>
> **Evidence labels:** **[run]** means observed in an execution; **[code]** means read from the
> code only.

## What the owner reported

1. A "robotic" thinking animation appears first, then the real thinking module stutters in.
2. Live, the thinking module shows detailed steps, including the real search terms. When the answer
   arrives, they collapse to fewer, generic steps.
3. Chat feels slow and stuttery overall.
4. Opening the AI panel loads in stages, and the composer sits near the top instead of pinned to
   the bottom.
5. Loading the last conversation appears in pieces.

## Findings

### A. Layout: the composer floats, and the thread opens at the top

**A1. The composer is not pinned. [run]**
- **Observed:** the panel is 684 px tall. On open, the composer's top is at 312 px, then 418, then
  560 as content arrives. Its bottom never reaches the panel's bottom (94 px are left empty).
- **Cause:** `research.css:78` sets `.ai-shell-research { display: block }`. It loses to
  `index.css` `.ai-shell-v2` and `.ai-shell` (`display: grid`), which have the same specificity
  but come later:
  - `main.jsx` imports `App` before `index.css`;
  - the production CSS has research.css at byte 116k and index.css at 219k and 232k.
- **Result:** the shell becomes a four-row grid with one child, `.ai-panel-background`. That child
  lands in an `auto` row, and its `height: 100%` resolves to its content.
- **Since:** 2026-09-21 (`189c31e`), on NTER too. The history-open dimming selectors
  (`index.css:3535-3541`) also stopped matching.
- **Fix:** make the wrapper fill the shell, with a selector that wins or `grid-row: 1 / -1`. Check
  in a real browser.

**A2. The last conversation opens scrolled to the top. [run]**
- **Observed:** `.ai-v2-body` was at `scrollTop 0` of 2,208 px.
- **Cause:** the scroll ref sits on `.ai-v2-history`, which cannot scroll (`AiPanel.jsx:907`); the
  element that scrolls is `.ai-v2-body`. The effect (`AiPanel.jsx:420-422`) also runs after paint,
  and only when the message count changes or `busy` flips.
- **Fix:**
  - scroll `.ai-v2-body` in a layout effect, keyed on the chat id and message count;
  - stay pinned while the reader is at the bottom (a ResizeObserver);
  - never pull a reader who has scrolled up.

### B. Opening and loading in pieces

**B1. Every open starts from zero. [code, run]**
- **Cause:**
  - `AiDock.jsx:47` unmounts the panel when it is closed, and the controller is disposed
    (`useResearchThread.js:319`).
  - The identity check (`userStore.js:130-170`) makes two requests in sequence: `auth/v1/user`,
    then `get_my_profile`.
  - It runs three times in sequence on open, with no cache or sharing: the controller,
    `hydrateConversations`, then `loadMessages`.
  - That is about 8 round trips before the thread shows.
- **Fix:** keep the controller alive across opens and show the cached thread at once. Cache the
  verified identity per auth epoch, share the in-flight check, and pass the verified scope down.

**B2. The reveal comes in five or more stages. [run, code]**
- **Observed [run]** (local, so faster than NTER):

  | Time | What appears | Composer top |
  | --- | --- | --- |
  | 114 ms | Empty panel | 312 |
  | 294 ms | Chips | 418 |
  | 382 ms | The whole thread | 560 |
  | 423 ms | Suggestion pills | 560 (the scroller shrinks) |

- **Also swapping in [code]:**
  - "No approved models" changes to the model name;
  - the author labels change;
  - the coverage badges arrive after their own query.
- There is no skeleton.
- **Fix:** a fixed-size skeleton, with one reveal once the list and messages are in. Reserve space
  for the pills and the model button.

**B3. The desk lays out twice on open. [code]**
- **Cause:** `onOpenChange` runs in an effect (`AiDock.jsx:8-10`), so the shell first renders the
  dock in a third grid row with the right rail, then re-renders without it.
- **Fix:** set the open state from the event handler.

### C. Thinking display

**C1. The finished steps lose every search. [run, code]**
- **Observed:**
  - Live: "Searching documents for “sanction prosecution…”", then "Searched · 40 passages" (six
    searches).
  - Finished: seven lines, "Reviewing the question." six times plus "Searching relevant sources.".
    The same happens after a reload.
- **Cause:** saved tool steps have no `phase` (`handler.ts:784-792`), and the ticker keeps tool
  entries only with `phase` start or end (`ActivityTicker.jsx:47-50`). The test fixture uses a
  shape the server never writes (`AgentComponents.test.jsx:44-46`).
- **Fix:** one step shape for live and saved, plus a test on the real saved row.

**C2. "Reviewing the question." repeats every model round. [run]**
- **Observed:** six times in one turn, and it is also the final summary of a finished answer.
- **Cause:** "Writing the answer." never appeared in the run.
- **Fix:** labels that describe progress (the round number, what is being read), and a finished
  summary such as "Searched 6 times · 40 passages each".

**C3. The "robot" card, then a hard cut. [run, code]**
- **Observed:**
  - the card shows from 633 ms to 2,202 ms (about 1.6 s locally);
  - then the ticker appears collapsed, then opens a frame later;
  - card 137 px, then ticker 93 px, then 105 px;
  - at 7.21 s the card flashed back for about 20 ms, then the ticker returned. The cause of that
    flash is not established.
- **Cause [code]:**
  - the card covers the client's identity re-check before the request is sent (`researchChat.js`
    `run()`), not server work;
  - the two components have different styles and heights, and there is no transition;
  - the ticker's `useState(active)` starts closed.
- **Fix:** one indicator from Send onward, in a fixed slot, with the user's message rendered first.

**C4. The finished message remounts. [code]**
- On completion the live block unmounts and the saved row mounts (`AiPanel.jsx:909-926`). The
  ticker loses the reader's open or closed choice, and the layout jumps.

**C5. "thought" never shows. [code, run]**
- **Cause:** `usage` never reaches the client: no stream frame carries it, and `loadMessages` does
  not select it. So the line always says "waited".
- **Observed:** "searched 4.4s · waited 48.5s", with no "wrote".

### D. Speed: most of the wait is the server's agent loop

**D1. One question took 53 s and cost $0.105. [run]**
- **The turn:** at Low reasoning on Gemini 3.8 Flash, it made 11 attempts and 6 logged model
  calls, with 5 searches.
- **Prompt tokens:** 170,367 in total. Each round re-sends the growing context (6.9k, 41k, 50k,
  24k, 33k, 15k).
- **Reasoning tokens:** 0.
- **The slowest call:** 21.6 s, for 22 output tokens.
- **Earlier comparison:** the V7c answers cost about $0.01 each.

**D2. The answer is not streamed in practice. [run]**
- **Observed:** the saved `writing_ms` is 0. In the browser the text went from 327 to 3,136
  characters in one update at 60 s, after about 40 s of "Reviewing the question.".
- **Context:** the server can stream the `answer` field of the JSON envelope incrementally
  (`answerStream.ts`), but in this run the whole answer arrived as one burst.
- **Caveat:** the browser pane was hidden, which pauses animation frames. The server-side
  `writing_ms` of 0 corroborates the burst independently.

**D3. Everything re-renders on every update. [code]**
- **Cause:**
  - nothing in `src/ai` is memoised;
  - every controller emit re-renders the whole panel and re-parses every message's markdown;
  - `AiMarkdown` keys blocks by end index, so the growing block remounts;
  - `retryRequest` deep-copies the request on each emit;
  - every auth event (tab refocus, token refresh) re-runs full verifications in four places.
- **Fix:**
  - memoised message rows;
  - parse markdown once per change;
  - stable keys;
  - share one identity check.

**D4. The end of a turn shifts the layout. [run, code]**
- **What shifts:**
  - the "•" citation placeholders become 15–16 bubbles at once, and unmatched ones are removed,
    so the text reflows;
  - the sources list mounts;
  - follow-up pills grow the footer, which shrinks the thread.

### E. Labels and selector (from the earlier mapping)

- **E1. Two names for one model. [run]** A live answer shows the admin label; a saved one shows
  the raw id (`google/gemini-3.8-flash`). Only `model_served` and `model_requested` are saved.
- **E2. Admin text is false.** It says "Ask AI picks the role from the question". Research chat
  never reads roles.
- **E3. Duplicated definitions.** The effort ladder is defined three times. Persona files exist in
  two copies, and the admin page names the wrong one as shipped.
- **E4. Cost dots are a manual tier.** Real prices are loaded but unused.
- **E5. The choice is per browser.** It is not stored on the account.

## Cost of this review

About $0.15 on the local stack: $0.048 OCR and $0.105 for one chat answer. Nothing touched NTER
except read-only copies of the model configuration.
