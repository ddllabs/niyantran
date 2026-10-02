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

### T6. Exact marks
- **Acceptance:**
  - the cited passage is marked with `pv-cite` on each page it touches;
  - the dashed "Approximate location" rectangles show for scanned pages, no match, or no
    Highlight API;
  - unit tests on range building, with fakes;
  - the browser check on both documents.
- **Files:** `highlights.js` (new), `PdfDocument.jsx`, `viewer.css`.

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
