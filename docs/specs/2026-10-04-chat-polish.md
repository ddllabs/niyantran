# F63: AI Research chat presentation

> **Status: Normative.** Product scope approved in the owner's chat discussion,
> 2026-10-04. Local implementation; publication requires separate authorization.

## Current state and objective

The existing hovering SidePanel owns Desk, Record, AI Research and citation
surfaces. AI Research nests bordered messages, ticker and sources, uses 13px
answer text, repeats attachment entry and leaves attachment context above the
thread. Saved messages have `at` timestamps but render no time or Copy action.
Make this chat easier to read and operate without changing the Terminal shell.

## Acceptance

- Preserve panel tabs, dimensions, evidence viewer and the name/behavior of
  **Work mode**. Keep retrieval, accounts, billing and server contracts unchanged.
- Open reading surface for assistant answers, subtle question bubbles, Inter
  at 15px or larger for prose, coherent light/dark chat tokens and focus states.
- Attachment tray immediately above composer, collapsed beyond one visible file with
  a named disclosure; preserve every coverage badge and disabled remove state.
  Keep one attachment entry in the composer. Large drop instructions only for
  an empty thread or during dragging.
- Model name and selected reasoning effort visible in the composer. Up-arrow
  Send and square Stop share one position, immediate pressed feedback and a
  restrained state transition, disabled while cancellation is pending.
- Completed answers have Copy and stored time; questions have stored time.
  Copy retains references and appends source titles/available safe URLs. Report
  clipboard rejection without claiming success; do not invent timestamps.
- Selected citations have a clear accessible state. Source rows remain one
  button opening their first citation, with compact citation count and an
  optional disclosure showing citation numbers (no nested buttons).
- Readable follow-ups show the first two and a More disclosure. Selection
  still prepares a draft rather than sends it. Held rows preserve layout.
- One compact collapsed activity disclosure from Send; retain search terms,
  finds, errors and model substitution. Residual time is Other processing,
  never a claimed measured thinking duration. Citation count is labeled as
  citations. Existing server events are the limit of reported progress.
- Composer grows up to its existing height limit. Preserve reader-controlled
  scrolling and offer Jump to latest away from the bottom. No token animation.
- Narrow and expanded panels, light/dark, keyboard, clipboard rejection,
  running/stopping and reduced motion are verified offline in a browser.

## Boundaries and implementation conventions

React/Vite; components and colocated Vitest tests under `src/ai/`. No new
dependencies. Use native buttons/disclosures, existing state and citation
validation; treat source text/URLs as untrusted. CSS stays scoped to the chat.
Changes allowed in `src/ai/{AiPanel,MessageRow,AiMarkdown,CitationBubble,
SourceList,SuggestionPills,ModelPicker,ActivityTicker,stickToBottom}` and their
tests; new focused presentation components/CSS/tests in `src/ai/`; these docs,
the thinking/source-list spec amendments and `docs/plans/open-work.md`.
No editing data collections, authentication, APIs, PDF rendering or deployment.
Keep the draft locked during execution as today; drafting during generation
would change controller behavior and is not required for this presentation.

## Evidence commands

`npm test -- src/ai`, `npm test`, `npm run lint`, `npm run build`;
offline Vite fixture using real panel components and fake research data,
loopback only, no production writes or paid model calls. Meaningful new guards
must fail before their implementation. No standalone typecheck exists.
