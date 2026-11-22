# Plan: Live TV watch layout (F402)

> **Status: Historical (dated 2026-11-21).** Done; released in `b61ae69f` (pull request 215). Spec: [2026-11-21-live-tv-watch-layout.md](../specs/2026-11-21-live-tv-watch-layout.md).

Integration branch: `task/livetv-watch-layout`, from `main` at `9dd11518`. Two tasks run at the same
time in supervisor-created worktrees; their write scopes are disjoint and their one shared value is
fixed below.

## Fixed interface

- `.ltv-barwrap` is the bar's box in the page grid. From 1081px its height is `var(--ltv-bar-h)`, set to
  `60px` on `.ltv-page` in `liveTv.css` (task B owns the variable). Task A makes the bar (`.ltv-channelbar`,
  border and padding included) fit exactly in 60px from 1081px, one row, no wrapping.
- Task A does not change the page grid; task B does not change the bar's inside, the channel tiles or the
  overlay (`.ltv-pop`) except its stacking, if needed.
- Class names stay: `.ltv-barwrap`, `.ltv-channelbar`, `.ltv-strip`, `.ltv-channel-chip`, `.ltv-pop`,
  `.ltv-find`.

## Task A — the bar (Sonnet, worktree `task/livetv-watch-strip`)

One row from 1081px: list buttons, the strip of channel tiles (smaller: about 40px tall, 28px tag) with its
arrows, a segment chooser that replaces the row of segment pills (choosing one opens the same overlay the
pill opened, for "All" too; it can be chosen again), the search box. The "TOP CHANNELS" and "SEGMENTS"
labels go (their names stay for screen readers). Between 601 and 1080px the bar may wrap. Phones keep the
sheet. Write scope: `src/shell/liveTv/ChannelBar.jsx`, `src/shell/liveTv/channelBar.css`,
`src/shell/liveTv/ChannelBar.test.jsx`, new test files under `src/shell/liveTv/`. Tile overrides go under
`.ltv-channelbar` in `channelBar.css`, not in `liveTv.css`.

## Task B — the page grid (Sonnet, worktree `task/livetv-watch-grid`)

Replace the two container-query layouts from 1081px (pinned and short-window) with the one layout of the
spec: the bar across the full width, the player at 16:9 by width with the height cap that moves spare
width to the panel, the panel's height from the window, `.ltv-main` the one scroll container, the lower
tabs at natural height. The no-panel case and below 1081px as in the spec. Write scope:
`src/shell/liveTv.css` (layout rules; not the tile or bar rules at the top of the file),
`src/shell/factcheck/factCheck.css` (panel sizing rules only), `src/shell/LiveTvPage.jsx` (wrappers and
comments only), `src/shell/liveTvLayout.test.js`, `src/shell/liveTvLayout.mobile.test.js`,
`src/shell/factcheck/LiveTvPage.layout.test.jsx`.

Assertions in task B's test files that are about the bar's inside (segment pills, row labels) are left
for the supervisor to rewrite at integration; task B reports them.

## Verification (each task)

`npx vitest run src/shell/liveTv src/shell/liveTvLayout.test.js src/shell/liveTvLayout.mobile.test.js
src/shell/factcheck src/shell/LiveTvPage*.test.jsx src/shell/liveTvTabs.test.jsx`, `npm run lint`,
`npm run build`. New guards proved to fail without the change.

## Supervisor

Review each diff (Opus review of the grid change), merge both into the integration branch, fix the
cross-file assertions, measure the acceptance table of the spec on the rendered page, run the full suite
in a shuffled order, then show the owner before any merge to `main`.
