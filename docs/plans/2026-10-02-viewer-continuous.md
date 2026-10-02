# Plan: a standard PDF viewer for citations (`viewer-continuous`), piece 2

> **Status: Living.** Implements `docs/specs/2026-10-02-viewer-continuous.md`. Tracked as open-work
> F48.
> - The tasks run in order, riskiest first.
> - Each task is test-first, and the supervisor commits it once verified.
> - Production steps (the migration, the push) each wait for their own go-ahead.

## Architecture decisions

**Pure models first,** as in piece 1. Each is tested in node:
- `layoutModel.js`: page slots, the current page and the render window;
- `passageMatch.js`: normalisation, anchors and coverage;
- `searchModel.js`: debounce, stepping and counts.

**The pool replaces the single-part controller.**
- `pdfPool.js` keeps today's part opening (byte ranges, URL renewal, failure classification) and
  adds:
  - an LRU of 3 open parts;
  - a prioritised render queue: 2 at a time, pages before thumbnails, cancellable.
- `pdfController.js`'s tests are carried over to it.

**The page view is virtualised by arithmetic, not observers.**
- Slots come from stored page sizes, and the scroll position gives the visible range.
- One scroll listener (passive, read in `requestAnimationFrame`) drives the render window and the
  current page.

**Marks use the CSS Custom Highlight API.**
- Named highlights: `pv-cite`, `pv-match` and `pv-match-current`.
- No DOM changes in pdf.js's text layer.
- Ranges are rebuilt only when a page's text layer finishes or the query changes.

**Search is one SQL function,** `security invoker`, behind a thin client in `viewerData.js`.

## Tasks

### T1. The passage matcher and its evaluation (risk first)
- **Acceptance:**
  - `passageMatch.js` normalises Markdown, quotes, dashes, hyphenation, case and spacing;
  - it locates a passage by 5-word (then 3-word) anchors and accepts at 80% ordered coverage;
  - it returns the layer's word range for the mark, or null;
  - unit tests, red first;
  - `scripts/eval-passage-match/` runs every chunk of the two live documents against their
    PDFs, with pdf.js's text content, and reports the exact-match share. The target is at least
    90% on pages with a text layer.
- **Data:**
  - the page text and chunk offsets, read-only from NTER;
  - the PDFs: `ingest/pilot/bill-rs-371-2025.pdf`, and the anti-doping bill from sansad.in
    (approved download).
- **Files:** `src/ai/page-viewer/passageMatch.js` and its test; `scripts/eval-passage-match/`.

### T2. `search_document_pages` (migration and SQL fixture)
- **Acceptance:**
  - the function as specified;
  - a fixture under `supabase/tests/` that is non-vacuous and run as `authenticated`;
  - `npm run test:sql` passes;
  - its time on a generated 1,000-page document stays under 50 ms locally.
- **Files:** `supabase/migrations/<ts>_search_document_pages.sql`, `supabase/tests/search_document_pages.sql`.

### T3. The layout and render-window models
- **Acceptance:**
  - the slot positions from page sizes, the zoom and the 12 px gap;
  - the current page at a scroll position;
  - the pages to draw, nearest-first, capped at 8;
  - scrolling to a page or a box;
  - unit tests, red first.
- **Files:** `layoutModel.js` and its test.

### T4. The part pool and render queue
- **Acceptance:**
  - 3 parts at most, least recently used closed first;
  - 2 renders at a time;
  - priority by distance from the centre, with thumbnails last;
  - cancellation;
  - URL renewal and failure classification as today;
  - tests with fakes, red first, including today's controller cases.
- **Files:** `pdfPool.js` and its test. `pdfController.js` is retired once T5 uses the pool.

### T5. The continuous PDF view
- **Acceptance:**
  - `PdfDocument.jsx` lays out every slot, draws the render window through the pool, and
    releases pages that leave it;
  - it opens centred on the citation;
  - the toolbar's page box follows the scroll, and paging scrolls;
  - zoom applies to all pages:
    - Fit text from the cited page's column;
    - the wheel and pinch keep the point under the pointer still;
  - the full view's pill and padding still hold;
  - the markup and hook tests are updated.
- **Files:** `PdfDocument.jsx` (new), `PageViewer.jsx`, `PdfPage.jsx` (becomes one page's
  drawing), `viewer.css`, tests.

### Checkpoint A
- Lint, both suites, build and bundle check.
- **The harness:** the bill, the 3-part budget, and a generated 1,000-page document in 100 parts.
- **Checked:** opening at the citation, scrolling, parts opening and closing, the long-task log,
  and the canvas count.

**Checkpoint A, recorded 2026-10-02.**
- **T1–T5 are committed.** Lint, both suites (1,859 tests) and the build pass. The main bundle is
  −4 B; the viewer chunk is 20,895 B gzip (+2.1 KB of piece 2's 14 KB budget).
- **On the harness:**
  - **The 1,000-page document** (100 parts) opens on page 503 having fetched only its own part. The
    citation is centred (314 px against a view centre of 314).
  - **A scripted scroll** through 30 pages across three parts gave no long tasks over 50 ms, at most
    4 canvases at once, and each part fetched as it was reached.
  - **The toolbar:** Next scrolls the next page to the top; a typed page 10 draws only pages 9–11;
    Back to the citation recentres it; zoom keeps the page in view (56% to 67%); Fit page fits the
    page to the view's height.
  - **The full view:** the citation centred above the pill (299 against 306); the last page ends
    14 px clear of the pill.
  - **The 3-part budget:** opens on page 14 from part 2; switching to the Text view and back keeps
    the reader's page.
  - **The console** is clean.
- **Defects found and fixed during the check:**
  - the first window was drawn from the document's top before the open scroll, fetching part 0;
  - a job cancelled while its part was located could still open it;
  - the page-size read could run forever against a server that ignored ranges;
  - returning to the PDF view re-opened on the citation instead of the reader's page.

  Each has a test or a guard.
- **Not measured on the harness:** the browser pane pauses pdf.js's drawing while hidden. Timings
  were taken with the pane painting.

### T6. Exact marks
- **Acceptance:**
  - the cited passage is marked with `pv-cite` on each page it touches;
  - the dashed "Approximate location" rectangles show for scanned pages, no match, or no
    Highlight API;
  - unit tests on range building, with fakes;
  - the browser check on both documents.
- **Files:** `highlights.js` (new), `PdfDocument.jsx`, `viewer.css`.

**T6, recorded 2026-10-02.**
- **How it works.** Each page's piece of the passage comes from `citedPieces` over the cited row and,
  when the citation runs past it, the next page's row. A drawn page marks its piece after every draw
  and whenever the piece changes, and clears it when it leaves the window. Each result is kept with
  the text it was made for, so a result for an earlier passage is never taken for the current one.
- **The fallback.** The dashed boxes labelled "Approximate location" show only when there is no
  stored text to mark with, or the page reports no match or no Highlight API (`needsFallback`).
- **Checks.** Lint, both suites (1,872 tests) and the build pass. The viewer chunk is 22.93 kB gzip,
  +2.0 kB for T6, mostly the matcher now in the bundle. The label test was shown to fail without
  the label.
- **On the harness:**
  - **The bill:** one exact range on page 4, from "such intent if" to "foreign powers". The passage's
    cut-off words at either end are dropped. No boxes.
  - **A passage across pages 4 and 5:** one exact range on each page.
  - **The 1,000-page document:** marked on page 503, in the dark theme.
  - **Without the Highlight API:** one dashed, labelled box.
  - **The console:** no errors after a reload.
- **Noted.** The harness's page text is pdf.js's, which includes the margin line numbers. A range
  that starts or ends at a line number therefore covers it, as the stored passage does. The OCR
  page text in the app is expected to leave margin numbers out; check this on the live bill at
  Checkpoint B.

### T7. Search
- **Acceptance:**
  - the client: debounce at 250 ms, from 2 characters, cancellation;
  - "n of N" stepping across pages;
  - the side pane's third row and the full view's header field;
  - ⌘/Ctrl+F inside the viewer only;
  - Escape closes;
  - the highlights;
  - the scanned-page note with its switch to the Text view;
  - the Results tab;
  - tests, red first.
- **Files:** `searchModel.js`, `SearchBar.jsx`, `viewerData.js`, chrome components, tests.

### T8. Thumbnails
- **Acceptance:**
  - the drawer (side pane) and column (full view);
  - Pages and Results tabs;
  - a virtualised list;
  - thumbnails drawn by the pool behind pages, cached as WebP (least recently used, 300);
  - the current, cited and match-count markers;
  - click to scroll;
  - motion with reduced-motion handling;
  - tests.
- **Files:** `PageRail.jsx`, `thumbnailCache.js`, `viewer.css`, tests.

### T9. The Text view's two layouts
- **Acceptance:**
  - Continuous by default, with One page as before;
  - "Text layout" in the More menu while the Text view shows, saved only on choice;
  - pages read in batches near the view;
  - the cited span and matches marked;
  - tests.
- **Files:** `TextPage.jsx` → `TextDocument.jsx`, `viewerData.js`, `DocumentChrome.jsx`, tests.

### Checkpoint B (complete)
- The budgets in the spec are measured and recorded.
- An independent code review, with its findings fixed.
- The docs are updated.
- **Go-aheads, asked separately:** applying the migration to NTER, then pushing `main`.
