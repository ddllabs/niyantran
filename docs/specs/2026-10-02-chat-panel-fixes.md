# Spec: research chat panel fixes (`chat-panel-fixes`): F47, and F46's end-of-turn shift

> **Status: Living.** Approved by the owner on 2026-10-02: the history-open dimming is restored, not
> removed. It covers open-work F47's three findings,
> and the part of review item D4 (`research/2026-10-02-chat-experience-review.md`) that the panel
> loading work did not cover.

## Problems, verified in code (2026-10-02)

1. **Phone width.** At 375 × 812 the AI dock gets 268 px under the desk: the composer is clipped
   71 px below the screen and the thread is 18 px tall. This is recorded in F47 from a browser
   run, and it happens with the pre-fix CSS too. The layout rule responsible is not yet known.
2. **The history-open dimming never applies.** The rules are
   `.ai-shell.ai-shell-v2.history-open > .ai-v2-chrome / .ai-v2-body / .ai-v2-foot`
   (`index.css:3535-3541`), but those regions sit inside `.ai-panel-background`
   (`AiPanel.jsx:652-1008`). So `>` matches nothing: the panel behind the open history list is
   neither dimmed nor made inert.
   - The same applies to `.ai-shell-v2 > .ai-v2-head` and its `z-index` rules
     (`index.css:3526-3534`). The head's stacking therefore depends on other rules.
3. **The live timing word.** While a turn finishes, the summary reads "waited N s" even when the
   saved row will say "thought N s". The live `timing` frame (`research-chat/handler.ts:501`)
   carries no reasoning count, and `timingLine` (`ActivityTicker.jsx:97-106`) says "thought" only
   when `usage.reasoning_tokens` is above 0.
4. **The end-of-turn shift (D4).** When a turn ends:
   - the "•" citation placeholders become numbered bubbles, and unmatched ones are removed;
   - the sources list mounts;

   so the text above the composer reflows. The follow-up row no longer shifts: its space is
   reserved.

## Expected outcome

1. **Phone:** the dock gets a usable height at 375 × 812 (composer fully visible, thread at least
   40% of the screen). The rule is found in a browser run first and fixed at its cause.
2. **Dimming:** the selectors match the real structure (`.history-open .ai-panel-background >
   …`), so while history is open the panel behind it is dimmed and does not take pointer events,
   as originally designed. The head's stacking rule is corrected the same way.
3. **Timing word:** the live `timing` frame also carries `reasoning_tokens` (from the turn's
   usage), and the client passes it to `timingLine`. The live word then matches the saved one.
   This is a `research-chat` change, so it is deployed with a go-ahead.
4. **Shift:**
   - a citation placeholder takes the same width as a bubble;
   - the sources list's space is reserved from the turn's first source;

   so the end of a turn does not move the text. This is measured in the browser before and after.

## Acceptance evidence

- **Tests, failing first:**
  - the selector fix (a static render with `history-open`, checking that the dimmed regions are
    matched; or a CSS test on the computed opacity in the browser run);
  - the live timing word with a reasoning count;
  - the placeholder and bubble widths.
- **A browser run at 375 × 812 and at desktop**, recorded in `docs/research/`:
  - composer and thread sizes on the phone;
  - dimming while history is open;
  - the live and saved timing words;
  - the layout shift at the end of a turn (positions before and after).
- **Checks:** lint, both suites, Deno and the build pass.

## Scope

`src/index.css` (dock and research shell rules), `src/ai/AiPanel.jsx`, `src/ai/ActivityTicker.jsx`,
the thread store that keeps the live usage, `supabase/functions/research-chat/handler.ts` (the
`timing` frame), tests, docs.

## Exclusions

- New features.
- Other desks' phone layouts.
- The answer text's own streaming.
