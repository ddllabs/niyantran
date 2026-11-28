# Plan: Live TV — show that the session is hearing the video (F423)

> **Status: Living.** Spec: [2026-11-28-live-tv-live-transcript.md](../specs/2026-11-28-live-tv-live-transcript.md).

Integration branch `task/livetv-live-transcript` from `main` at `f5255529`. Two tasks run at the same time
in supervisor-created worktrees; write scopes are disjoint.

## Fixed interface

- `SILENT_NOTICE_MS` stays exported from `src/shell/factcheck/panelStatus.js`; the page imports it.
- The page computes `notHearing = live && (isMuted || session.silentFor > SILENT_NOTICE_MS)` for the pill
  only; the panel keeps its own muted warning and silence notice.
- Nothing new passes between page and panel.

## Task P — the panel (Sonnet, worktree `task/livetv-lt-p`)

Spec items 1, 2, 3, 6, 7, 8. Write scope: `src/shell/factcheck/FactCheckPanel.jsx`, `factCheck.css`,
`FactCheckTabs.jsx`, `panelStatus.js`, `factCheckText.js`, and tests under `src/shell/factcheck/` except
`LiveCaptions.test.jsx`.

## Task V — the page (Sonnet, worktree `task/livetv-lt-v`)

Spec items 4 and 5. Write scope: `src/shell/LiveTvPage.jsx`, `src/shell/liveTv.css`,
`src/shell/factcheck/LiveCaptions.jsx` and `LiveCaptions.test.jsx` (both removed with `git rm`), and
`src/shell/LiveTvPage*.test.jsx`.

## Verification (each task)

`npx vitest run src/shell/factcheck src/shell/LiveTvPage src/shell/liveTv src/shell/liveTvLayout`,
`npm run lint`, `npm run build`. New guards proved to fail without the change. Fake timers and global stubs
restored in `afterEach`.

## Supervisor

Review both diffs, merge them, render running sessions (no claims, claims, muted) in the static preview and
measure the acceptance list, independent review, full suite in a shuffled order, then show the owner before
any merge to `main`.
