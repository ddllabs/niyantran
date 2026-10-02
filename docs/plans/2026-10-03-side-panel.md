# Plan: one side panel for Desk, Record and AI research (`side-panel`)

> **Status: Living.** Implements `docs/specs/2026-10-03-side-panel.md` (F54).
> - The tasks run in order and test-first, each committed once verified, on `task/side-panel`.
> - The branch merges to `main` after the browser run. The push waits for its own go-ahead.

### T1. The panel's state and width models
- **Acceptance:**
  - `sidePanelModel.js` decides which tabs exist (Desk and Record only where the rail shows
    today), and the active tab on row select, row clear, `niy-ai-open`, a tab click, Collapse and
    reopen.
  - The mounted set only grows.
  - The shared width maths is extracted from `citationOverlayModel.js`: the default 36%, the
    340 px to 60% clamp, keys, reset and storage. The citation overlay uses the same functions.
  - Vitest fails first.
- **Files:** `src/shell/sidePanelModel.js` and its test, `src/ai/citationOverlayModel.js` and its
  test.

### T2. SidePanel and the shell
- **Acceptance:**
  - `SidePanel.jsx` renders a real tablist and a tab panel for each mounted tab, hidden when not
    active. The header holds the active tab's actions, Expand and Collapse; the collapsed handle
    is built.
  - `RightRail` becomes the Desk and Record content, without its own tab strip.
  - `AiDock` folds into the panel.
  - `TerminalShell` mounts SidePanel in place of the rail-or-dock swap. `niy-ai-open` keeps its
    contract.
  - Static-markup tests cover the ARIA and the hidden-not-removed panels.
- **Files:** `src/shell/SidePanel.jsx`, `RightRail.jsx`, `TerminalShell.jsx`, `src/ai/AiDock.jsx`
  and `AiPanel.jsx` (the header split), with their tests.

### T3. One docked width
- **Acceptance:** the panel's left edge drags, with keys and a reset, and is remembered. The grid
  uses one `--panel-width` in place of the 33, 35 and 38% rules. CSS tests fail first.
- **Files:** `SidePanel.jsx`, `index.css`, `panelLayout.test.js`.

### T4. One expand mode
- **Acceptance:**
  - Expand works on every tab, using the citation overlay's fixed, in-place mechanism, now owned
    by the panel.
  - AI with a citation open keeps the split, the click-outside behaviour and the stored split.
  - Desk and Record collapse back on Esc, Collapse or a click outside.
  - Tests fail first.
- **Files:** `SidePanel.jsx`, `src/ai/CitationOverlay.jsx`, `citation-overlay.css`, tests.

### T5. The CSS migration and phones
- **Acceptance:**
  - Each of the rules naming `.right-rail` (85), `.workspace.ai-open` (36) and `.rail-` (15) is
    classified and moved.
  - A CSS test fails if a rule names a removed container class.
  - Phones: stacked below 900 px, AI takes the workspace at 640 px, and the tab bar stays.
  - The onboarding tour and `BillAiDropDemo` are checked.
- **Files:** `index.css`, `panelLayout.test.js`, `OnboardingTour.jsx` and
  `marketing/BillAiDropDemo.jsx` if they name the classes.

### T6. Local browser run
- **Acceptance:** the spec's browser evidence at 1440 × 900, 768 × 1024 and 375 × 812, recorded in
  `docs/research/`.

### Checkpoint
- Lint, Vitest and the build pass.
- **Go-ahead:** the push.

**T1, recorded 2026-10-03.**
- **`shell/sidePanelModel.js`:**
  - the tabs (Desk and Record where the rail was, Record only with a selection, AI everywhere);
  - the active tab across select, clear, `ai-open`, a tab click, collapse, reopen, close-AI and a
    desk change;
  - a mounted set that only grows;
  - the collapsed memory;
  - the docked width: 36% by default, 340 px to 60%, with drag, keys, Home and End, and storage.
- **Two behaviours set here:**
  - selecting a row while on AI keeps AI, and Record just becomes available;
  - selecting a row while collapsed does not reopen the panel.
- **`shell/resizeModel.js`** holds the clamp, key steps and storage that `citationOverlayModel.js`
  now imports. The overlay's 79 tests pass unchanged.
- **Tests:** 19 new. The suite failed first, with the module missing.
