# F63 implementation plan

> **Status: Historical (2026-10-04).** Local branch `task/f63-chat-polish`, based on `f974ece`.
> Spec: [chat presentation](../specs/2026-10-04-chat-polish.md).
> Open item: F63 in `open-work.md`. Supervisor implements sequentially.

1. Message reuse: `MessageRow.jsx`, new `MessageActions.jsx`, their tests.
   Stored timestamps, safe citation-aware copy and clipboard failure evidence.
2. Evidence presentation: `CitationBubble.jsx`, `AiMarkdown.jsx`,
   `SourceList.jsx`, related tests. Fixed selected-source prop passed from panel;
   no viewer contract change. Compact rows and native citation details.
3. Input presentation: `AiPanel.jsx`, new `AttachmentTray.jsx`,
   `SuggestionPills.jsx`, `ModelPicker.jsx`, related tests. Preserve current
   attachment payload and locked state; selected source is `viewer.source`.
4. Activity/scroll: `ActivityTicker.jsx`, `stickToBottom.js`, their tests,
   panel wiring. Collapsed activity, accurate labels, Jump to latest.
5. Visual integration: new `chat-presentation.css`, imported from panel.
   Chat-only semantic tokens, readable type, answer surfaces, input action
   state motion and reduced-motion override. No global shell CSS modifications.
6. Verify focused guards red/green, full Vitest, lint/build; offline browser
   at narrow/tablet/desktop and expanded widths with light/dark, keyboard,
   running/stopping and clipboard failure. Independent read-only agent review
   is permitted after implementation, no delegation from that reviewer.
7. Supervisor commits verified local slices and records evidence. Retain task
   branch for owner review; do not push/deploy. Record unfinished work in F63.

## Risks

Footer height must not crowd narrow panels: show one visible attachment and
two suggestions, disclose the remainder. Citation selection must compare source
identity, not citation number alone. Saved/live activity remain separate React
mounts; do not promise persistence of manual disclosure state across that swap.
Server stage accuracy/true phase instrumentation are excluded; no fake progress.

## Verification record

Implementation complete locally in `3be5117`; awaiting owner review and landing. No push or
deployment performed.

- New copy, selected-citation, disclosure, activity-label and follow-scroll
  guards were observed failing before their implementation, then passing.
- `npm test -- src/ai`: 50 files, 713 tests passed.
- Final `npm test`: 128 files, 2,076 tests passed (30.50 seconds).
- Final `npm run lint`: passed without errors or warnings.
- Final `npm run build`: passed (3.68 seconds). Existing mixed static/dynamic
  `deskBrief` import and chunks over 500 kB warnings remain.
- `git diff --check`: passed. No standalone type-check exists. No server,
  library, admin or Supabase changes; router, Deno and SQL checks not applicable.
- Independent read-only review caught a global CSS specificity collision and
  Hindi citation label; both corrected. Final review found no blocking findings.
- Offline browser exercised the real panel with mocked thread data and no
  production queries. At widths 320, 375, 768, 1024 and 1440 (height 900), no
  chat horizontal overflow; reading heights were 402, 418, 165, 414 and 429 px.
  The tablet footer improved from 333 to 240 px. Long drafts capped at 120 px
  with internal scrolling. Model name and effort remained visible.
- Browser checked light/dark surfaces, attachment disclosure, More questions
  draft preparation and Escape focus restoration, selected citations/Work mode,
  expanded activity metadata, Jump to latest, pending Stop disabling, and Copy
  success/rejection feedback. Copy content is covered by unit tests; browser
  clipboard contents were not independently confirmed. Actual server
  cancellation and PDF loading were outside this offline fixture.
- Reduced-motion override was source-reviewed; OS preference was not changed.
  Fixture hot reload emitted repeated `createRoot` warnings from its temporary
  entry point. This is not a production runtime validation.
- Actual-panel screenshots: `/private/tmp/f63-chat-expanded.jpg` and
  `/private/tmp/f63-chat-dark.jpg` (temporary review artifacts, not repository
  documentation assets).

Changed application paths are under `src/ai/`: panel/markdown/message wiring,
activity, model picker, citations, sources, suggestions, follow-scroll helper,
new attachment tray, message actions, submit control and scoped stylesheet,
with focused tests. Documentation includes this plan, the F63 spec/tracker and
explicit amendments to the earlier source-list and thinking-display specs.

## Integration

Owner authorized main integration/publication on 2026-10-04. Combined code
through `0638dbd` passed 2,088 frontend and 856 Edge Function tests plus
lint/build/router import. Earlier local-only statements describe verification
at the time. See [main consolidation](2026-10-04-main-consolidation.md).
Supabase function deployment remains a separate action (open-work F69).
