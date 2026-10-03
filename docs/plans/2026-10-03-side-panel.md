# Plan: one side panel for Desk, Record and AI research (`side-panel`)

> **Status: Historical (2026-10-03).** Owner-closed; implementation and evaluation record. Implements `docs/specs/2026-10-03-side-panel.md` (F54).
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

**T2, recorded 2026-10-03.**
- **`shell/SidePanel.jsx`:**
  - `useSidePanel` holds the state in the shell, so the layout classes come from the same render;
  - one tablist, with the arrow keys, Home and End;
  - mounted tabs are hidden, never removed;
  - "Ask AI" opens the AI tab with its seed, as `AiDock` did;
  - Esc on AI goes back to Desk or Record;
  - Collapse leaves a handle; Close appears on desks without a rail.
- **`RightRail.jsx` is now `RailContent.jsx`,** with a Desk or Record `view` and no tab strip.
  **`AiDock.jsx` is removed;** its keep-mounted rule is now the model's.
- **`AiPanel` takes `embedded`** (spec amendment 1).
- **`TerminalShell`** mounts the panel in place of the rail-or-dock swap.
- **Minimal CSS:** the panel, its bar, handle and body. The two `> .ai-dock` rules and the
  stacked phone rule now target `.side-panel`.
- **Tests:** 5 SidePanel tests. Rendering only the active tab, or breaking `aria-selected`, each
  fails one.
- **Checks:** lint, Vitest (1,992) and the build pass.
- **A smoke run in the browser at 1440 × 900:**
  - a row opens Record;
  - the AI shell is the same DOM node across Desk, Record and AI, and across collapse and reopen;
  - Esc on AI returns to Record;
  - collapsed, the panel is a 32 px handle;
  - home shows AI only, and closing it gives the desk the full width.

  The width still changes between tabs (504 and 547 px), which is T3's job.

**T3, recorded 2026-10-03.**
- **One grid rule:** `minmax(0, 1fr) clamp(340px, var(--panel-chosen, 36%), 60%)` replaces the
  33, 35 and 38% rules and the two 1180 px variants. The AI rule keeps `!important` over the
  full-width desks.
- **SidePanel's left edge** is a focusable separator. A drag writes `--panel-chosen` directly, with
  no re-render per move, and keeps the width on release. The arrow keys step 16 px (×4 with
  Shift), Home and End go to the bounds, and a double-click resets. The width is remembered per
  browser and hidden when stacked below 900 px.
- **Tests:** 2 CSS tests and 1 SidePanel test, each failing first.
- **Checked in the browser at 1440 × 900:**
  - 518 px (36%) on Desk, Record and AI alike;
  - a 120 px drag gives 638 px on all three, and is stored;
  - → gives 622 px; End gives 864 px (60%); a double-click resets to 518 px and clears storage;
  - a stored 700 px survives a reload.

**T4, recorded 2026-10-03.**
- **The citation overlay becomes the panel's expand mode:** `ai/CitationOverlay.jsx` is now
  `shell/PanelOverlay.jsx`, with `panel-overlay.css`. It keeps the fixed in-place design, the
  slide, the outer width edge, storage and click-outside. It adds a one-column `is-solo` mode and a
  `split` viewer pane handed out by `viewerRef`.
- **SidePanel wraps its whole content in it,** the tab bar included:
  - Expand works on every tab and persists across tab switches;
  - a citation open in AI expands the panel with the split and locks Expand meanwhile;
  - Esc first restores, then closes AI as before;
  - a click outside restores the panel, or, with a citation open, closes the citation and the
    chat (revision 5).
- **AiPanel no longer wraps itself.** It reports a citation in a layout effect, so the panel
  expands in the same frame, and portals its viewer into the panel's pane. Standalone, with no
  `viewerSlot`, the viewer follows the chat. The chat never moves.
- **Tests:**
  - the overlay's 24 tests moved with it, plus 3 new;
  - 3 new SidePanel tests, which fail when expansion or the split is switched off;
  - AiPanel's overlay-mock test now tests `closeCitationAndChat` directly.
- **Checked in the browser,** with the pane about 1,471 px wide:
  - docked at 529 px (36%);
  - Expand on Desk gives a fixed 961 px panel with the workspace grid unchanged, and it stays
    expanded on AI;
  - a click outside and Esc restore it;
  - a citation gives a 961 px split with the viewer's 480 px pane (WorkSurface portalled), the
    chat is the same node, and Expand is locked;
  - Close citation restores AI docked;
  - a click outside with a citation open closes it and AI, back to Desk.

**T5, recorded 2026-10-03.**
- **The inventory:** every container class is still rendered (`.right-rail` on the Desk and Record
  panels; `.ai-dock` on AI; `ai-open` and `bill-record` on the workspace) except `.rail-tabs`.
- **Its 5 rules are deleted,** two of them inside selector lists.
- **`.right-rail` and `.ai-dock` lose their own left border,** shadow and the 36 px tab-strip row
  at the source. The `.side-panel` overrides that compensated are removed, and the panel draws
  the border.
- **Stacked (900 px and below):** Expand is hidden, and the collapsed panel is a slim bar of tab
  names under the desk.
  - **The browser run caught a specificity loss:** `.side-panel-expand` lost to
    `.side-panel-actions button`. It is fixed, and the test now names the selector that wins.
- **The onboarding tour and the marketing demo** name none of these classes (the demo has its own
  `mkt-ai-dock`).
- **Tests:** 4 CSS tests, each failing first.
- **Checks:** lint, Vitest and the build pass.

**T6, recorded 2026-10-03** (`research/2026-10-03-side-panel-local-run.md`).
- **Checked:** tabs and state, one width, one expand mode, and the stacked layouts at 1440, 768
  and 375 px.
- **Not exercised:** a live streaming answer, since `research-chat` was not served. AI's state is
  shown by DOM node identity across switches.
- **The local stack is torn down.**
- **Waiting:** the push.

**Amendment 2, recorded 2026-10-03** (`task/side-panel-fixes`).
- **Model:** a row click opens the panel on Record unless AI is in use. A load or a module change
  opens it. The collapse memory is removed.
- **AI's actions** are portalled into a tab-bar slot (`actionsSlot`). The history list anchors to
  the bar. A narrow bar shows "AI".
- **The docked shadow** is restored. The minimum width is 400 px.
- **Tests:** model, SidePanel, AiPanel and CSS, each failing first.
- **Checked in the browser:**
  - **1440 px:** the slot shows 4 actions on AI and hides on Desk; the shadow is present; a row
    click while collapsed opens Record; a row click on AI stays on AI; a module change reopens a
    collapsed panel.
  - **At 340 px (before the change):** "AI research" was clipped and the history list ran past
    the panel's left edge.
  - **At 400 px:** with three tabs nothing is clipped, and the history list is inside the panel.
  - **375 px:** one bar row reading "Desk Record AI", then the icons and Collapse. The history
    list is at x 67–367, and nothing crosses the edges.
  - **The dimming behind the history list** measured 0.42 once frames ran. A first reading of 1
    was a paused fade in the hidden pane.
