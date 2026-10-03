# Spec: a standard PDF viewer for citations (`viewer-continuous`), piece 2

> **Status: Normative — approved by the owner on 2026-10-02:** "go ahead with all your
> recommendations for the text view … For the rest of the changes, go ahead". It re-scopes
> piece 2 of the citation viewer (open-work F48), as the owner asked:
> - "the PDF viewer that we are building will practically be looking similar to this in terms of
>   features, because users already know how a PDF viewer works with the thumbnails on the left";
> - "the citations being shown on the PDF pages should be the exact citations and not some random
>   boxes".
>
> It builds on `2026-10-02-viewer-toolbar.md` (the chrome, live) and
> `2026-10-02-viewer-whole-page.md` (whole pages, live). The owner's decisions are recorded at the
> end.

## Current state

**The viewer.** The citation viewer (`src/ai/page-viewer/`, a lazy chunk) shows one page at a time,
whole, from the stored PDF, drawn with pdf.js 4.10 and its text layer. It opens on the cited page.

**The PDF loader** (`pdfController.js`):
- it keeps one stored part open, opened through byte ranges;
- paging past a part closes it and opens the next;
- it renders one page at a time.

**The citation mark** is up to six rectangles, one per layout block linked to the cited chunk
(`citations.ts`, `pageEvidenceMaps`). A rectangle covers a whole paragraph, so it marks more than
was cited whenever a passage starts or ends mid-paragraph.

**The data for every page:**
- `document_pages`, one row per page: `text` (OCR Markdown), `char_from`/`char_to` into the
  document's text, `width_px`/`height_px`;
- `document_page_blocks`: typed layout boxes.

The page sizes are known for every page before any is drawn.

**The stored text is not the PDF's own text.** On the anti-doping bill:
- page 1's text is `AS INTRODUCED IN LOK SABHA\n\n**Bill No. 77 of 2025**\n\n# THE NATIONAL…`;
- page 4 is a Markdown table whose first cell is the margin note "Amendment of section 11.".

The PDF's text layer has the same words without the Markdown, in its own order.

**Scale:**
- **Today:** two documents use this viewer in production (12 and 22 pages).
- **What uploads accept:** very large PDFs, split into 10-page parts. The load test used 1,200
  pages.
- **Unaffected:** the 2,338 earlier documents, which use the plain text reader.

## Problem

- **Paging is unfamiliar.** Readers expect a PDF to scroll continuously, with thumbnails on the
  left. One page at a time feels like a slideshow.
- **The mark is imprecise.** It covers whole paragraphs, so a reader can't see where the cited
  passage starts and ends.
- **No search.** A reader can't find a term in a document without leaving for the stored copy.

## Expected outcome

### 1. Continuous scrolling (PDF view)

**Layout:**
- the pages are a single scrolling column, in both the side pane and the full view;
- every page's slot is laid out at its true size from `width_px`/`height_px` before anything is
  drawn, so the scrollbar is right from the start and nothing jumps as pages arrive;
- a 12 px gap separates pages.

**Opening:**
- the viewer opens scrolled to the cited page, with the cited passage centred;
- the cited page is drawn first.

**What is drawn:**
- only pages in or near view: the visible ones, then one screen above and below;
- at most 8 page canvases exist at once;
- a page that leaves that window releases its canvas and text layer;
- a page not yet drawn shows its number on a blank slot of its true size.

**The toolbar** (as built in piece 1):
- the page box shows the page nearest the centre of the view, and typing a page scrolls to it;
- ‹ and › scroll to the previous or next page's top;
- the cited chip, Home and the paging keys keep working.

**Zoom applies to all pages:**
- Fit width and Fit page fit each page as today;
- Fit text takes its scale from the cited page's text column, draws every page whole at that
  scale, and starts scrolled horizontally to that column;
- ⌘/Ctrl + wheel and pinch zoom keep the point under the pointer still.

**The full view** keeps its floating pill. The pill and the toolbar control the same view.

### 2. The PDF loader becomes a small pool

- **Open parts:** up to 3 stored parts at once, least recently used closed first. Each is opened
  through byte ranges, as today.
- **A render queue:**
  - at most 2 renders at a time;
  - the page nearest the centre is scheduled first, then the rest by distance;
  - mounted page elements remain in document order so changing scheduling priority never
    moves ancestors of live citation or search ranges;
  - a page that leaves the window is cancelled.
- **One pool serves the pages and the thumbnails.** Thumbnails always queue behind pages.
- **Failures:** they keep today's classification and fixed notices. No error text or signed URL
  is rendered or logged.

### 3. The exact cited passage

**The mark is the cited passage's own words, on the PDF's text layer:**
- marked with the CSS Custom Highlight API (`CSS.highlights`) over ranges in the text layer, so
  no element is added and a passage running across lines and spans is one mark;
- in the citation amber;
- for a passage spanning two pages, its part on each.

**Matching** (pure, tested):
1. **The passage:** the cited span, read from the stored page text with the citation's offsets
   (`localSpan`).
2. **Normalised words:** both the passage and the text layer are reduced to words, with these
   removed or folded:
   - Markdown syntax: `#`, `*`, `_`, table pipes and rules;
   - case;
   - curly against straight quotes, and dashes;
   - line-end hyphenation, and spacing.
3. **Locating it:** the passage is found in the layer's words by its first and last 5-word
   anchors, shrinking to 3 words if needed. The mark runs from the first anchor's first word to
   the last anchor's last word.
4. **Checking it:** the match is accepted when the marked words cover at least 80% of the
   passage's words in order. This tolerates margin notes that OCR placed elsewhere.

**Falling back:**
- **When:** no text layer (a scanned page), no match, or a browser without `CSS.highlights`.
- **What:** the layout rectangles, drawn dashed and labelled "Approximate location", so they
  never pass for an exact mark.

**The Text view** marks the exact span, as it does today.

### 4. Search in the document

**Opening it:**
- a search control at the left of the page toolbar (side pane) and in the header (full view);
- ⌘/Ctrl+F while focus is inside the viewer, and only then.

**The side pane** opens a third row:
- the field;
- "3 of 9";
- ↑ and ↓;
- ×.

**Finding matches:**
- a database function `search_document_pages(document_id, extract_hash, query)` searches the
  stored page text of one document's current extraction;
- **it returns,** for each page with a match, up to 200 pages:
  - the page number;
  - the match count;
  - up to 3 snippets of about 60 characters either side;
- **matching rules:**
  - case-insensitive;
  - spacing and line breaks are treated as one space;
  - Markdown syntax is ignored;
  - the query is matched literally (no wildcards or patterns);
  - Hindi works like English;
- **the function itself:**
  - `security invoker`, so the existing read grant and policy on `document_pages` still decide
    what it can see;
  - `stable`, with a bounded result;
- **the client:**
  - searches 250 ms after typing stops, from 2 characters;
  - cancels a superseded search.

**Showing matches:**
- matches are highlighted on drawn pages with the Highlight API: the current match orange, the
  others yellow;
- the counter and ↑/↓ follow the database's counts:
  - Enter and Shift+Enter move between them;
  - a move to another page scrolls it into view, centred above the full view's pill;
- **a page whose text layer lacks the match** (a scanned page, or OCR and the PDF disagreeing) says
  so: "This page's matches are in its recognised text", with a button to switch to the Text view,
  where the matches are marked.

**A Results tab** in the side panel lists each page with its count and snippets. A click scrolls to
the match.

**Closing:** Escape or × closes search and clears the highlights.

### 5. Thumbnails

**Where:**
- **side pane:** a drawer that slides over the pages from the left, 132 px wide, opened by the
  pages button (left of the page toolbar);
- **full view:** a 160 px column, open by default, toggled by the same button.

**Two tabs:** Pages and Results.

**Pages:**
- a virtualised list, laid out from the stored page sizes;
- each thumbnail is drawn by the pool at about 120 px wide, behind every page render, only while
  visible;
- drawn thumbnails are cached as small WebP images, up to 300 (least recently used dropped);
- **each shows:**
  - the page number;
  - a ring on the current page;
  - an amber dot on the cited page;
  - a count badge while searching;
- a click scrolls the main view to that page;
- the list follows the current page, without animation.

**Motion:** the drawer slides in from the left and out to the left, about 200 ms, interruptible.
Under reduced motion it only fades.

### 6. The Text view

**Documents with pages** (the new OCR pipeline) offer two layouts of the stored page text:
- **Continuous**, the default: the pages in order under page headings, read in batches as they
  near the view;
- **One page:** a page at a time, as today.

In both, the cited span and the search matches are marked.

**The choice:**
- it sits in the More menu as "Text layout", with Continuous and One page as radio items, while
  the Text view shows;
- it is saved in this browser only when the reader chooses it.

**The PDF view always scrolls continuously.**

**The earlier documents** (no pages; `SourceReader`) are unchanged. They already show the whole
text in one continuous scroll.

## Budgets

**Opening the cited page:** no slower than today's single page, measured on the harness at Fit
width.

**Scrolling:**
- no main-thread task over 50 ms during a 1,000-page scroll on the harness (`PerformanceObserver`,
  longtask);
- scroll position never jumps as pages arrive.

**Memory:** at most 8 page canvases. Thumbnails are images, not canvases.

**Network:**
- only the byte ranges of pages and thumbnails drawn;
- at most 3 parts open;
- one search request per settled query.

**Size:**
- main bundle unchanged;
- the viewer chunk grows by at most 14 KB gzip.

**Database:** the search function stays under 50 ms for a 1,000-page document on the local test
database.

## Acceptance evidence

**Unit tests, shown red first:**
- **the slot layout:** positions from page sizes and the gap, and the current page from a scroll
  position;
- **the render window:** which pages draw, their order, cancellation, and the 8-canvas cap;
- **the pool:** 3 parts least recently used, 2 renders, priorities, and thumbnails behind pages;
- **the Text view's layout choice:** Continuous by default, and saved only on choice;
- **the passage matcher:**
  - normalisation of Markdown, quotes, dashes, hyphenation and case;
  - anchors and the 80% rule;
  - a passage over two pages;
  - fallbacks;
- **search:** the client's debounce, cancellation and the "3 of 9" stepping across pages.

**SQL fixture** (`npm run test:sql`, a local database, as a non-superuser `authenticated` role):
- case, spacing and Markdown handling;
- literal matching of `%`, `_` and regex characters;
- the bound;
- the extraction filter;
- the grants;
- shown non-vacuous by the runner.

**Matcher evaluation:** every cited chunk of the two live documents, matched against their PDFs,
reporting the share marked exactly. The target is at least 90% of chunks on pages with a text
layer.

**Repository checks:** lint, both test suites, the build and the bundle check.

**The browser,** on the harness:
- **documents:** the 12-page bill, the 25-page budget in 3 parts, and a generated 1,000-page
  document in 100 parts;
- **widths:** the side pane at 480 px, the full view, a 400 px pane, and a phone;
- **themes:** light and dark;
- **keyboard only;**
- **what is checked:**
  - opening at the citation;
  - scrolling;
  - parts opening and closing;
  - thumbnails;
  - search with the counter and Results;
  - the exact mark and the fallback;
  - the long-task and canvas budgets;
- **console:** clean.

**Production:**
- the migration applied with its own go-ahead;
- the push with its own;
- then a check on the live documents.

## Scope

**Write scope:**
- `src/ai/page-viewer/` (the viewer, the pool, new models, components and their tests);
- one migration adding `search_document_pages`, and its SQL fixture;
- `scripts/` for the matcher evaluation;
- this spec, its plan, and open-work.

**Exclusions:**
- rotate, print, annotations and download inside the viewer ("Open stored copy" gives the original
  to the browser's own viewer);
- the PDF's outline/bookmarks;
- a citation narrower than its retrieved passage. Marking only the sentence a claim relies on
  would need the model to quote it; that is a separate decision.
- changes to ingestion, retrieval or the answer format;
- the plain text reader for the earlier documents.

## The owner's decisions (2026-10-02)

1. **The Text view:** both layouts for documents with pages, Continuous by default (section 6).
   The earlier documents keep their continuous reader.
2. **Fit text in a scrolling document:** its scale comes from the cited page's text column, and
   every page is drawn whole at that scale.
3. **Downloads:** the two live documents' public source PDFs may be downloaded from sansad.in for
   the matcher evaluation.
4. **The migration:** `search_document_pages` is tested locally first. Applying it to NTER is a
   separate go-ahead, asked for when the fixture passes.
5. **The browser floor:** the exact mark uses the Highlight API. Older browsers get the dashed
   approximate rectangles.

## Implementation notes

**T1, the matcher (`588c9ac`).** Every live chunk was marked exactly: 121 of 121, with 0 matches in
237 wrong-page trials (`docs/research/2026-10-02-passage-match-eval.md`). Anchors are collected
across the whole slack, because a margin note that OCR folded into the body misled the first
anchor found.

**T2, search.** The migration also adds `document_pages.search_text`, a stored generated column:
the page text folded as a reader sees it, kept by PostgreSQL, written by nothing.
- **Why:** folding inside the search cost 286 ms on a generated 1,000-page document, against the
  50 ms budget.
- **Matching:** literal and case-insensitive, with `strpos` and `replace` on lower-cased text, so
  no character in a query is special.
- **Snippets:** cut at the match positions.
- **Timings,** on the local test database at about 2,500 characters a page:
  - 1,000 pages: 24 ms with 142 matching pages, 25 ms with 200, and 15 ms with no match;
  - **production:** the column is computed once for the 34 live pages when the migration runs.
- **Defects caught during the build:**
  - `regexp_instr` past the end of the text;
  - `greatest()` ignoring a NULL, which cut a snippet from the page's start;
  - the planner repeating `lower()` five times on each matching page.

  The fixture now pins the first two by their effect.
