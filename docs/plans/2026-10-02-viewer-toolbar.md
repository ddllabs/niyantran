# Plan: a compact citation viewer header (`viewer-toolbar`), piece 1

> **Status: Living.** Implements `docs/specs/2026-10-02-viewer-toolbar.md`. Tracked as open-work
> F48. Sequential; the supervisor commits each verified task.

## Architecture decisions

- **Pure decisions** live in plain modules (`chromeModel.js`, `menuModel.js`), tested in node, like
  `viewerModel.js` and `zoomModel.js`. Components only render what those return.
- **DOM wiring** lives in small functions over injected elements (`menuDom.js`), tested with fakes,
  like `viewerDom.js`. Vitest runs in node with no DOM, so this is the folder's existing testing
  style rather than a new one.
- **One set of controls, two layouts.** `ViewerChrome.jsx` composes the shared parts into the side
  pane's document row and page toolbar, and into the full view's header and pill. No control is
  written twice.
- **Menus** are their own component with local open state, so opening one never re-renders the
  page. The menu's Escape is a native listener on the menu node that stops the event before the
  full view's and `WorkSurface`'s Escape handlers.
- **Tooltips** are CSS on `IconButton` (`data-tip`, `aria-hidden` text), so no extra React state.
  The warm-up ("instant after the first") is one attribute on the toolbar, set and cleared by
  `createTipWarmth` in `menuDom.js`.
- **Icons** come through `icons.js`, which imports named `lucide-react` icons. Only the lazy viewer
  chunk imports it.
- **Compact layout** comes from the viewer's measured width (one debounced `ResizeObserver`), not
  the viewport, because the side pane's width does not follow the window.

## Tasks

### Task 1: `lucide-react` and the icon module (S)
- **Acceptance:**
  - `lucide-react` is in `dependencies`;
  - `icons.js` exports the icons used, at 16 px and stroke 1.75;
  - nothing outside `page-viewer/` imports it.
- **Verify:** `npm run build`, then `npm run check:bundle` (main entry unchanged).
- **Files:** `package.json`, `package-lock.json`, `src/ai/page-viewer/icons.js`.

### Task 2: chrome decisions (S)
- **Acceptance:** `parsePageInput`, `citedChip`, `toolbarLayout` and `tipDelay`, each tested red
  first.
- **Verify:** `npx vitest run src/ai/page-viewer/chromeModel.test.js`.
- **Files:** `chromeModel.js`, `chromeModel.test.js`.

### Task 3: the menu's model and DOM wiring (S)
- **Acceptance:**
  - `menuFocus` handles the keys;
  - `createMenuDom` handles Escape (stopped), Tab, an outside press, and listener removal;
  - `createTipWarmth` warms and cools on a timer;
  - all with fakes, red first.
- **Verify:** `npx vitest run src/ai/page-viewer/menu*.test.js`.
- **Files:** `menuModel.js`, `menuDom.js`, and their tests.

### Checkpoint: foundation
- Tests, lint and build pass.
- **The owner confirms the corrected side-pane layout** (the document row in place of a title row).

### Task 4: `IconButton` and `Menu` (M)
- **Acceptance:**
  - icon-only buttons with an `aria-label`, an `aria-hidden` tooltip and `aria-keyshortcuts`;
  - `Menu` follows the menu button pattern, with `aria-haspopup`, `aria-expanded`, `role="menu"`,
    `menuitem` and `menuitemradio`, and a checked state;
  - its styles cover press, tooltip and menu motion, reduced motion and coarse pointers;
  - markup tests.
- **Verify:** focused Vitest.
- **Files:** `IconButton.jsx`, `Menu.jsx`, `viewer.css`, and their tests.

### Task 5: `ViewerChrome` (M)
- **Acceptance:**
  - the shared parts: `CitedChip`, `PageField`, `ZoomControls`, `ViewSwitch` and `MoreMenu`;
  - composed as `DocumentRow` and `PageToolbar` (side pane) and as `FullHeader` and `PagePill`
    (full view);
  - markup tests for the order, the labels, `rel`, the escaping, the narrow variant and the checked
    fit.
- **Verify:** focused Vitest.
- **Files:** `ViewerChrome.jsx`, `ViewerChrome.test.jsx`, `viewer.css`.

### Task 6: wire the viewer (M)
- **Acceptance:**
  - `PageViewer` renders the new chrome;
  - `PageBar`, `ViewerControls` and the old `ViewerHeader` markup are gone;
  - the width observer drives the compact layout;
  - the pill padding is in place;
  - existing behaviour tests pass, with the markup tests updated.
- **Verify:** `npm test`, `npm run lint`, `npm run build`, `npm run check:bundle`.
- **Files:** `PageViewer.jsx`, `PageBar.jsx` (deleted), `PageViewer.test.jsx`, `viewer.css`,
  `research.css` (the `.ai-reader-head` rules).

### Checkpoint: complete
- The viewer chunk's gzip size is recorded before and after (at most +6 KB).
- **The browser, on the local stack:**
  - the side pane at 480 px, the full view at 1440 × 900, and a phone at 375 × 812;
  - light and dark;
  - a keyboard pass;
  - Escape in a menu inside the full view closes only the menu;
  - the pill clears the last line;
  - the chrome height before and after;
  - no console errors;
  - screenshots.
- **open-work F48** is updated.
- The owner's go-ahead to push `main`.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A menu's Escape also closes the full view or `WorkSurface` | High | A native listener on the menu node stops it; a test with fake elements, and the browser check |
| A tooltip is clipped by an `overflow: hidden` ancestor (`.pv-full`, `.ai-work-surface`) | Medium | Tooltips sit below the top rows and above the pill, inside the clip; checked at each width |
| `backdrop-filter` is slow on a large page in Safari | Low | 16 px blur on a small pill only; solid under reduced transparency |
| The toolbar wraps at an in-between width | Medium | Compact below 420 px from the measured width; fixed control widths; checked at 420 and 480 |
| `lucide-react` grows the main bundle | Low | Imported only from the lazy chunk; `check:bundle` |
