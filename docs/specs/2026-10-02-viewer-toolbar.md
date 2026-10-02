# Spec: a compact citation viewer header (`viewer-toolbar`), piece 1 of 2

> **Status: Normative — approved by the owner on 2026-10-02.** The owner chose:
> - **the A + B hybrid:** two rows in the side pane; one header row and a floating page pill in the
>   full view;
> - **`lucide-react`** for the icons;
> - **the file name** moves into the ⋯ menu.
>
> **Applied:**
> - Apple's design guidance (`apple-design`);
> - Emil Kowalski's design engineering (`emil-design-eng`, `review-animations` standards);
> - `ui-ux-pro-max` accessibility and touch rules;
> - `frontend-ui-engineering`.
>
> **Piece 2** (a page thumbnail rail and search in the document) is a separate spec. This one
> leaves room for it and builds none of it.
>
> Tracked as open-work F48.

## Current state

**The viewer.** The page viewer (`src/ai/page-viewer/`, a lazy chunk loaded by `WorkSurface`) draws
four blocks above the page:
1. **The header** (`ViewerHeader`): the title, the full machine file name with "Open file ↗", and ×.
2. **The controls** (`ViewerControls`): PDF | Text, a Fit select, − readout +, ⤢, and "Open stored
   copy".
3. **The section line** ("Bill › Amendment of section 10."), inside `PageBar`.
4. **The page bar** (`PageBar`): "‹ Previous", "Page 4 of 22 · cited on page 4", "Next ›", and
   "Back to citation".

**Size.** In the side pane (about 480 px) they take about 190 px, or more where they wrap.

**Style.** Every control is a bordered text button, in the same visual weight. The full view repeats
the same blocks at the same density.

## Problem

- **Height.** The chrome takes about 40% of the pane's height before the page starts. On a laptop
  screen the cited passage is often below the fold.
- **Hierarchy.** Nothing marks the page as the subject. Document actions, view settings and paging
  all look alike.
- **Noise.** The machine file name (`_BillsTexts_LSBillTexts_Asintroduced_doping…PM.pdf`) wraps over
  two lines and tells a reader nothing.
- **Disabled controls.** "Back to citation" sits greyed out whenever the reader is on the cited
  page, which is most of the time.

## Expected outcome

### Side pane: two rows, nothing floats over the page

**Above the viewer.** In the side pane the viewer sits under `WorkSurface`'s bar, which already
shows "← Back", the title, "Ask about this document" and ✕. The viewer therefore repeats neither
the title nor a close control there (the approved mockup did; this was found while writing this
spec).

**Row 1, the document row:**
- the section on the left, muted, on one line, truncated with an ellipsis and shown in full in its
  tooltip; left empty when the citation has none;
- on the right:
  - the PDF | Text switch;
  - open the original file ↗ (a link, opens in a new tab), when the document has a public URL;
  - More ⋯.

**Row 2, the page toolbar:**
- **Paging:**
  - Previous ‹;
  - a page box showing the current page, which takes a typed page, next to "/ 22";
  - Next ›.
- **The cited chip.** It reads "Cited p. 4" as a status on the cited page. Elsewhere it becomes the
  button "Back to p. 4" (the Home key).
- **Zoom**, on the right: −, a "62% ▾" readout that opens the fit menu (Fit text, Fit width, Fit
  page, with a check on the current fit), and +.
- **Full view ⤢.**

**The same split in both layouts.** Document-level controls (view, file, More) sit with the
document; page-level controls (paging, citation, zoom) sit next to the page. In the full view the
document row becomes the header and the page toolbar becomes the pill.

### Full view: one header row and a floating pill

**The header row** (the full view has no `WorkSurface` bar, so it carries the title):
- the title and the section on one line;
- PDF | Text;
- open the original file;
- More ⋯;
- Exit full view.

**The pill.** Paging, the cited chip and zoom float in a frosted pill centred at the foot of the page
area.
- **It never hides text.** The page area gets bottom padding the height of the pill plus its margin,
  so the last lines of a page can always scroll clear of it.
- **Scrolling to the citation** keeps the passage clear of the pill.

### The More ⋯ menu

- **Open stored copy:** with its part label when the document is split, as today.
- **Copy file name:** it announces "File name copied" or "Couldn't copy the file name".
- **The file name itself:** as muted, wrapping text at the foot of the menu.
- **When the toolbar is narrow** (below 420 px of pane width, for example a phone), zoom leaves the
  toolbar and its items join the menu: Zoom in, Zoom out and the three fits.

### Nothing new is disabled for show

- Previous and Next disable only at the first and last page.
- The page rail and search buttons are not rendered until piece 2 makes them work.

### Interaction and motion

**Paging is never animated.** It repeats dozens of times a day, often from the keyboard. The page
changes at once, as today.

**Press feedback:** icon buttons scale to 0.97 on `:active` over 100 ms, ease-out.

**Menus:**
- **Appearing:** they grow from their trigger (`transform-origin` at the trigger's edge), from
  scale 0.97 and opacity 0, over 150 ms on `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Closing:** 100 ms, opacity only.
- **Built with** CSS transitions with `@starting-style`, so they can be interrupted.

**Tooltips:**
- **Hover:** they show after 450 ms. Once one has shown, the rest of the toolbar's tooltips show at
  once with no animation, until the pointer has been away for 400 ms.
- **Keyboard:** they show at once on keyboard focus.
- **Touch:** none under `(hover: none)`.
- **Content:** each tooltip carries the control's name and its key, for example "Next page →".

**Reduced motion:** opacity only, and no scale.

**The pill's material:**
- translucent, `backdrop-filter: blur(16px) saturate(160%)` over the panel colour at 82%;
- **solid** under `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, or a browser
  without `backdrop-filter`;
- the pill itself is static: it does not hide on scroll.

### Keyboard, unchanged and extended

**Unchanged:** ← and [, → and ], and Home page the viewer from its controls, as today.

**The page box:**
- Enter or blur commits a valid page;
- Escape restores the current page;
- a value that isn't a page in range is not applied, and the box shows the current page again.

**Menus** follow the menu button pattern:
- **Opening:** Enter, Space or ↓ opens with the first item focused; ↑ opens with the last.
- **Moving:** ↑ and ↓ move and wrap; Home and End jump.
- **Choosing and leaving:** Enter or Space chooses; Escape closes and returns focus to the trigger;
  Tab closes.
- **Pointer:** a pointer press outside closes.
- **Escape in an open menu closes only the menu.** It must not reach the full view's or the reader's
  own Escape handlers, which close the full view and the reader. The menu therefore handles Escape
  with a native listener on its own node and stops it there.

### Accessibility

- **Every icon-only control** has an `aria-label`. Tooltips duplicate it visually and are
  `aria-hidden`.
- **Keys:** `aria-keyshortcuts` keeps the keys, as today.
- **Live region:** the polite "Page X of N" announcement stays.
- **The cited chip** is never colour alone: an icon and words in both states.
- **Focus** rings stay visible (2 px, the accent colour).
- **Hit targets:**
  - icon buttons are 28 px for a fine pointer;
  - under `(pointer: coarse)` the hit area grows to 44 px without moving the layout (an expanded
    `::before`), with at least 8 px between targets.
- **Contrast:** at least 4.5:1 for text and 3:1 for icons, in light and dark.

### Design system

- **Colour.** The viewer keeps using the app's tokens (`--panel`, `--text`, `--muted`, `--line`,
  `--accent`, `--accent-soft`) and follows `.theme-dark` through them. The cited chip gets two tokens
  of its own, `--pv-cite-bg` and `--pv-cite-ink`, defined for light and dark. They come from the
  amber of the cited box already on the page, so chip and box read as one.
- **Icons.** They are drawn at 16 px with `strokeWidth` 1.75, close to the app's own icon set
  (`src/shell/Icons.jsx`, 1.7), so the viewer does not look foreign beside the shell. They are
  imported one by one from `lucide-react` through a single module (`icons.js`), so they are
  tree-shaken.
- **Shared chrome.** The new chrome is a set of small parts that both layouts compose: `IconButton`,
  `Menu`, `CitedChip`, `PageField`, `ZoomControls`, `ViewSwitch`. Neither layout has its own copy of
  any control.

### Speed and hardening

- **Main bundle:** unchanged. The icons and every new module are imported only from the lazy
  page-viewer chunk. `npm run check:bundle` stays within tolerance.
- **The viewer chunk** may grow by at most 6 KB gzip, measured and recorded.
- **Re-renders:** no more than today. Menus and tooltips keep their own state, so opening a menu
  never re-renders the PDF page. A page change re-renders the toolbar and the page only.
- **No layout shift:**
  - the toolbar and the pill have a fixed height;
  - numbers use tabular figures;
  - the readout and the page box have a minimum width, so "9%" to "300%" and "9" to "999" do not
    move their neighbours.
- **Listeners:**
  - a menu's document and keyboard listeners exist only while it is open and are removed on close
    and on unmount;
  - the width observer is one `ResizeObserver` per viewer, debounced, and disconnected on unmount.
- **No inline styles,** except the page geometry that already exists (`cropStyles`) and the
  observed width class. Every visual value lives in `viewer.css` on the existing scale.
- **Safety:**
  - the file URL still goes through `safeSourceUrl`;
  - the link carries `rel="noreferrer noopener"`;
  - the file name and the section are rendered as text only;
  - a clipboard failure is caught and announced, never thrown.
- **Pure decisions** live in plain modules, testable in node without a DOM, as in the rest of this
  folder:
  - the page box's parsing;
  - the chip's state;
  - the menu's next focus;
  - the toolbar's compact layout by width;
  - the tooltip warm-up timing.

## Acceptance evidence

### Unit tests, red first (Vitest, node)

- **`parsePageInput`:**
  - accepts "7" within 1..total;
  - rejects "", "0", "23" of 22, "3.5", "abc" and "  " (null);
  - trims surrounding spaces.
- **`citedChip`:** a status on the cited page, and a "Back to p. N" action elsewhere.
- **`menuFocus`:**
  - ↓ and ↑ wrap;
  - Home and End jump;
  - opening with ↑ starts at the last item;
  - an unknown key leaves focus alone.
- **`toolbarLayout`:** compact below 420 px, full at 420 px and above; an unknown width (0) counts as
  full.
- **`createMenuDom`** (fake elements):
  - Escape closes and is stopped;
  - Tab closes without stopping;
  - a press outside closes, and one inside does not;
  - every listener is removed on close.
- **Markup (`renderToStaticMarkup`):**
  - the side pane's document row: section, view switch, link and More, with labels and `rel`, and
    no title, no close and no file name;
  - the full view's header: title, section, view switch, link, More and Exit full view;
  - the page toolbar: its order;
  - the pill: its order;
  - the ⋯ menu: its items, the narrow variant with zoom, and an escaped file name;
  - the fit menu: a check on the current fit, and no check under manual zoom;
  - every icon-only control has an `aria-label`;
  - no disabled "back" control on the cited page.
- **Existing tests** for the viewer are updated where the markup changed, never deleted. Behaviour
  tests (paging keys, stored copy, document state, full view focus) keep passing unchanged.

### Repository checks

`npm test`, `npm run lint`, `npm run build` and `npm run check:bundle` (main unchanged), plus
the viewer chunk's gzip size before and after.

### The browser, on the local stack, with a real split and an unsplit document

- **Widths:** side pane at about 480 px, the full view at 1440 × 900, and a phone at 375 × 812.
- **Themes:** light and dark.
- **Height:** the viewer's own chrome above the page in the side pane (below `WorkSurface`'s bar)
  is at most 84 px at 480 px, against about 190 px today, measured with `getBoundingClientRect`
  before and after.
- **Keyboard:**
  - Tab through every control;
  - page with the keys;
  - type a page;
  - open and close each menu with the keyboard;
  - Escape in a menu inside the full view closes only the menu.
- **The pill:** in the full view it does not cover the last line of a page scrolled to the end.
- **Console:** no errors or warnings.
- **Screenshots** for the owner.

### Production

The owner's go-ahead to push `main`, which deploys the app on Vercel. Then a check that the deployed
viewer loads.

## Scope

**Write scope:**
- `src/ai/page-viewer/`:
  - `PageViewer.jsx`, `PageBar.jsx` (removed or replaced), `viewer.css`, `viewerModel.js`;
  - new `icons.js`, `IconButton.jsx`, `Menu.jsx`, `menuModel.js`, `menuDom.js`, `ViewerChrome.jsx`
    (header, toolbar, pill, cited chip, page field, zoom, view switch), `chromeModel.js`;
  - their tests;
- `src/ai/research.css`, only the `.ai-reader-head` rules the viewer header used;
- `package.json` and `package-lock.json` (`lucide-react`);
- `scripts/bundle-baseline.json`, only if the main entry moves and the owner asks to re-baseline.

**Exclusions:**
- the page rail and search (piece 2);
- `SourceReader.jsx` (the non-PDF reader keeps its own header);
- the PDF rendering, zoom model, data loading and stored-copy logic;
- `WorkSurface`'s "Ask about this document" bar;
- any server code.
