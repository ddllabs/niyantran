# Terminal header controls

> **Status: Living.** Owner-approved specification, 2026-10-12.
> Approved capability: terminal-header-controls. Implementation authorized on task/terminal-follow-up.

## Objective and evidence

Show meaningful header controls. TerminalShell renders a disabled notification
bell with no handler, a refresh control that changes reload, and an info icon
that toggles light/dark theme. Reload is consumed by HomeDesk and DeskView,
but not by the landing summary hooks. Theme currently initializes to light in
component state; persistence was not found and is not promised by this task.

The frontend contains no desk Supabase Realtime subscription. Landing summaries
load through HTTP on mount and supported retry paths. The shell separately
checks Home freshness every 60 seconds; that is not a live update channel for
landing counters. This scope adds neither realtime nor new refresh plumbing.

## Expected behavior

- Remove the disabled notification button from the shell header. Remove its
  icon implementation only if a full reference search establishes no remaining
  use; do not remove a shared icon based only on this header usage.
- Hide Refresh feed on the eight v6 landing routes. Preserve it on Home and
  module routes and preserve its existing reload handler and loading state.
  Do not claim every specialized module refetches without exercising that path.
- Replace the theme info glyph with moon when the action switches to dark,
  and sun when the action switches to light. Give tooltip and accessible name
  the same explicit next-action text, localized for the current language.
- Preserve theme scope and lifetime, Live TV, language, search, directory,
  profile and logout. Adding theme persistence is outside this task.

## Implementation boundaries

Use TerminalShell.jsx, Icons.jsx only if needed, and TerminalShell.test.jsx.
Prefer existing lucide-react Sun/Moon icons or the existing Icon convention;
do not introduce another icon library. Controls remain native buttons, with
the current focus and sizing conventions. Example accessible label:

```jsx
aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
```

## Acceptance evidence

1. No notification placeholder exists on landing, Home or module headers.
2. Refresh is absent on each of eight landing routes and present on Home and
   canonical module routes. A working ordinary feed refresh still requests
   updated data and renders the resulting state; test a representative
   specialized workspace and record any pre-existing refresh limitation.
3. Theme toggles in both directions; glyph, label and displayed theme agree.
4. Header retains usable keyboard controls at 320/390px, desktop and 200% zoom;
   menus remain visible and usable. No console errors introduced.

Run `npm test -- src/shell/TerminalShell.test.jsx`, `npm run lint` and
`npm run build`. Browser checks must exercise the actual clicks and reload
consumer, not only assert icon markup. Relevant regression guards must fail
against the previous ineffective header behavior before being accepted.

No auth, billing, feed backend, realtime, corpus, AI or deployment changes.
