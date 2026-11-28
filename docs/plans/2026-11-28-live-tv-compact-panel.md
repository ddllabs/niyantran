# Plan: Live TV fact-check panel while a session runs (F417)

> **Status: Living.** Spec: [2026-11-28-live-tv-compact-panel.md](../specs/2026-11-28-live-tv-compact-panel.md).

Integration branch `task/livetv-panel-compact` from `main` at `16f6832d`. Two tasks run at the same time
in supervisor-created worktrees; write scopes are disjoint; the interface below is fixed first.

## Fixed interface

- `FactCheckPanel` gets two new props from the page: `linkOpen` (boolean: the paste form is open) and
  `onToggleLink()` (opens or closes it). The page already holds this state (`pasteOpen`); it sets it to
  false after a link loads. While a session runs the panel renders the `linkForm` it is given only when
  `linkOpen` is true, under its top row; otherwise it renders the "Paste a video link" button there.
  Outside a session the panel renders `linkForm` at its top as today and ignores `linkOpen`.
- The panel no longer imports or renders `LiveTranscriptStrip`. The page renders the captions inside
  `.ltv-video-container` (so fullscreen keeps them) while the fact-check session is `running` or
  `ending`, from `factCheck.view.session.transcript`, with `listening` computed as the panel does today
  (`status === 'running' && !isMuted && !(silentFor > SILENT_NOTICE_MS)`).
- The latest-claim strip keeps its place (`bottom: 64px`, 52px on phones); the captions sit above it
  when it shows, at its place when it does not.

## Task P — the panel (Sonnet, worktree `task/livetv-compact-p`)

Spec decisions 1, 3 and 4. Write scope: `src/shell/factcheck/FactCheckPanel.jsx`,
`src/shell/factcheck/factCheck.css` (including removing the `.fc-tstrip` rules),
`src/shell/factcheck/FactCheckTabs.jsx`, and test files under `src/shell/factcheck/` except
`LiveTranscriptStrip.test.jsx` and `LatestClaimStrip.test.jsx`.

## Task V — captions and the page wiring (Sonnet, worktree `task/livetv-compact-v`)

Spec decision 2 and the page side of decision 3. Write scope: `src/shell/LiveTvPage.jsx`,
`src/shell/liveTv.css`, `src/shell/factcheck/LiveTranscriptStrip.jsx` (rename to `LiveCaptions.jsx` and
rewrite as the captions), `src/shell/factcheck/LiveTranscriptStrip.test.jsx` (likewise), and
`src/shell/LiveTvPage*.test.jsx`.

## Verification (each task)

`npx vitest run src/shell/factcheck src/shell/LiveTvPage*.test.jsx src/shell/liveTv
src/shell/liveTvLayout.test.js src/shell/liveTvLayout.mobile.test.js`, `npm run lint`, `npm run build`.
New guards proved to fail without the change. Fake timers and global stubs restored in `afterEach`.

## Supervisor

Review both diffs, merge them, render a running session in the static preview and measure the spec's
acceptance list, independent review (Opus), full suite in a shuffled order, then show the owner before
any merge to `main`.
