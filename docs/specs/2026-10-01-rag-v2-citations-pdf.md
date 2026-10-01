# Spec: page-wise citation viewer (`citations-pdf`)

> **Status: Normative — draft, revision 2 (2026-10-01), awaiting the owner's approval.**
> Module `citations-pdf` of `docs/specs/2026-09-30-rag-v2-capability-map.md` (open-work R6).
> It depends on `chunk-contract` (R3) and `ingestion-v2` (R4), both live on NTER.
> - **Design source:** the owner's direction of 2026-10-01 (open-work R6). The reference
>   implementation is the TenderBase viewer (`DDL Labs codebase/tenderbase-onboard`,
>   `ChunkViewerPanel` and `PdfCitationView`); this spec keeps its proven parts and avoids its
>   defects (see "From TenderBase").
> - **Revision 2** folds in a fresh-context adversarial review of revision 1: 1 critical, 11
>   required and 7 optional findings, all accepted (see "Review record").

## Objective

A reader clicks a citation in AI Research. For a document ingested through the new pipeline
(an **ingestion-v2** document), the viewer opens **on the cited page** and offers two views of
it:

- **PDF:** the original page, with the cited passage outlined by its block boxes.
- **Text:** the OCR text of that page, with the cited passage highlighted.

Both views share one page. A **page switcher** moves through the document, and the reader can
always return to the cited page. **Legacy documents** (the 2,338 with no stored PDF) keep
today's text reader, unchanged.

**Who:** any signed-in user. This matches the existing `authenticated` read grants on the
corpus tables and the RAG v2 decision that "any signed-in user reads through a server-minted
signed URL" (capability map; ADR 0003). There is no plan gating. **In plain words: any
subscriber could script-download every uploaded PDF.** That is the accepted decision, restated
here for the owner's confirmation (open question 2).

## Current state (read 2026-10-01; the NTER facts were executed read-only)

- **Citations carry what the viewer needs.** Checked on NTER with the Anti-Doping bill
  (`bill:2025:77`): all 10 of its stored citations have `page_number`, `boxes`, the global
  `char_from`/`char_to`, `chunk_id`, `section`, `extract_hash` and `file_url`.
  - `boxes` are fractions of the page (0–1, top-left origin, at most 20). They are normalised
    at ingest (`_shared/pageText.ts:112-131`).
  - `sanitizeCitation` (`src/ai/CitationBubble.jsx:45-64`) validates `boxes`, `images` and
    `section`.
  - `extract_hash`, `boxes` and `images` are present only when the evidence read succeeded
    (`_shared/citations.ts:246-249`). A failed read is tolerated, and the citation then carries
    only `page_number` (`research-chat/handler.ts:1073-1081`).
- **The viewer ignores them.** `SourceReader.jsx` reads `documents.ocr_text` and the chunk, and
  marks the span with `resolveSpan` (exact, moved or changed). It shows no page and draws no
  box.
- **Two paths skip validation.** `SourceList.jsx:28` passes `c.first` raw, and `WorkSurface`'s
  source list only checks `isReadableCitation`. The chunk-contract spec requires
  `sanitizeCitation` before boxes are drawn.
- **Pages and file parts are readable.**
  - Signed-in users can read:
    - `document_pages`: per-page `text`, global `char_from`/`char_to`, `width_px`, `height_px`;
    - `document_page_blocks`;
    - `document_files`: every part, with `page_offset`, `page_count`, `byte_size` and
      `storage_path`. It exists for single-part documents too.
  - The `corpus` bucket is private and has no object policies. Paths are readable, but useless
    without a signature, and nothing issues one to a user today.
- **Page text and offsets agree.**
  - `ocr_text.slice(page.char_from, page.char_to) === page.text`.
  - A page chunk's global span lies inside one page. Its `text_hash` is
    `sha256(normalise(content))`, and its content is the page slice.
  - Headers and footers sit in neither the page text nor `ocr_text`, so they do not shift the
    offsets (`pageText.ts:274-297`; `chunking.ts:500-506`).
- **Mistral OCRs exactly the part file the viewer will render.** The worker signs
  `document_files.storage_path` for each part (`ingest-worker/ocr.ts:95-96`).
- **`extract_hash` is write-once today.** Re-extraction is refused (`ingestion_v2.sql:346`,
  `:702`). A replacement is a new document, swapped in by `ingest_swap`. Deleting a document
  cascades its rows away.
- **pdf.js 4.10.38 is installed.** Its loader is private to the admin-only
  `src/lib/corpusUpload.js:220-256`, which uses the modern build. The chat panel loads eagerly
  (`TerminalShell` → `AiDock` → `AiPanel` → `WorkSurface`).
- **Page-aware detection:** the citation has `source_kind === 'pdf_page'` (legacy chunks are
  `'document'`, `chunking.ts:242`), and the document has `storage_path`.
- **Images:** the worker stores page images when Mistral returns them. None of the three NTER
  ingestion-v2 documents has any.
- **Not verified yet** (the plan's first task measures these, locally and on NTER, as
  separate checks):
  - Storage's CORS for a browser `Range` request;
  - whether Storage answers `206` to a `Range` request;
  - which page box Mistral rasterises.

## Owner decisions (recommendations in bold)

1. **Layout:** **a PDF | Text switch in the viewer header**, as in TenderBase, with both views
   following one shared page. The alternative is side by side, but the chat's work surface is
   too narrow for two readable pages.
2. **Default view:** **PDF when available; the reader's last choice is remembered** in that
   browser. TenderBase defaults to Text, which hides its PDF view from most users.
3. **Highlight on the PDF:** **block boxes only**, filled translucent amber, plus pdf.js's
   selectable text layer for copying. There is no word-level highlight: TenderBase's injects
   unescaped PDF text as HTML (an XSS risk) and lights up words on other pages.
4. **Text view:** **page by page** for ingestion-v2 documents. There is no continuous mode in
   v1.
5. **The file:** **a new Edge Function, `document-file`, for any signed-in user.** It returns
   a signature for the part holding the requested page, valid for **5 minutes**. The viewer
   fetches that part **by byte range**, renewing the signature whenever it expires, so neither
   a long stay on a page nor a 50 MB part breaks the view.
6. **Out of v1:**
   - the image strip and figure boxes;
   - zoom beyond fit-width plus one step in each direction;
   - a full-file download button.

   The existing "Open file" link to the public source stays.

## Design

### The flow

1. **One sanitising point.** `WorkSurface` runs `sanitizeCitation` where it reads
   `viewer.source`, and on every entry of its source list. The bubble, chip and list paths all
   reach the viewer through `useResearchThread.openSource`, so one point covers them.
2. **Choosing the reader.**
   - A citation with `source_kind === 'pdf_page'` and a `page_number` opens the **page
     viewer** (a lazy chunk).
   - Anything else opens today's `SourceReader`, unchanged.
   - A `pdf_page` citation whose document has no `storage_path` opens Text only. This is
     defensive.
3. **Reads** through the browser's Supabase client (the existing grants):
   - `documents`: `id, title, file_url, storage_path, extract_hash, page_count, indexed_at`.
   - `document_files`: `part_index, page_offset, page_count, byte_size`.
   - `document_pages`: `page_number, text, char_from, char_to, width_px, height_px`, for the
     document's `extract_hash`, one page at a time. Stale fetches are aborted, and a small
     cache keeps the neighbouring pages.
4. **States.** Each has its own fixed notice:

   | Case | Behaviour |
   | --- | --- |
   | Document gone (deleted) | Both views: "This document is no longer available" (as `SourceReader`) |
   | Document not live (`indexed_at` null) | Text view says the document is still processing; no PDF |
   | Citation has no `extract_hash` | Freshness unknown: page shown, **no boxes**, no banner |
   | Citation's `extract_hash` ≠ document's | "The document was updated since this was cited"; page shown, no boxes, no span (unreachable today; kept for re-OCR) |
   | No `document_pages` row for the page | Text: "This page's text is not available"; PDF still works |
   | No boxes, or the aspect guard trips | Page shown, with the hint "Cited on this page; passage location not available" |
   | A swapped-out document | Readable as before, with no notice ("superseded" is a follow-up) |

5. **PDF view.**
   - **Loading.** `src/lib/pdfjs.js` loads pdf.js's **legacy build**, which polyfills
     `Promise.withResolvers` for Safari before 17.4 and older browsers. The worker is bundled
     (`?url`), and `pdf_viewer.css` is imported inside the lazy chunk only. If the loader
     fails, the viewer falls back to Text with a fixed message.
   - **Fetching.** The part is opened with a `PDFDataRangeTransport` of length
     `document_files.byte_size`.
     - Its range reader fetches `Range: bytes=a-b` from the signed URL. The URL comes from a
       provider that calls `document-file` and caches the signature for its part until
       `expires_in` runs out.
     - On a 400, 401 or 403, or on expiry, it renews the signature and retries once.
     - Options: `isEvalSupported: false`, no annotation layer, no forms, no scripting.
   - **Rendering.** It renders local page `page − page_offset` on a canvas:
     - at the container width (debounced `ResizeObserver`), times `devicePixelRatio`, with
       the canvas area capped on iOS;
     - with pdf.js's text layer on top.
     - An in-flight `RenderTask` is cancelled on any page or size change, and held-down paging
       keys are debounced.
     - The `PDFDocumentProxy` is destroyed on a part switch and on unmount.
   - **Boxes.**
     - Only boxes whose `box.page` is the current page are drawn, each as a `pointer-events:
       none` overlay sized to the canvas's CSS box, at `x0`, `y0`, `(x1−x0)` and `(y1−y0)` as
       percentages.
     - **Aspect guard:** if the stored `width_px / height_px` differs from the pdf.js
       viewport's aspect by more than 2%, no boxes are drawn and the hint shows. A misplaced
       box would break the rule that a citation never silently shows the wrong passage
       (`sourceReader.js:7`).
     - The first box is scrolled into view.
   - **Moving across parts.** Leaving a part's last page opens the next part.
   - **Failure.** A fixed notice chosen by error class, with Retry, and the Text view shown.
     **A pdf.js error message is never rendered, logged or sent to analytics:** it contains
     the signed URL.
6. **Text view.**
   - It shows the page's `document_pages.text`.
   - The local span is the citation's `char_from − page.char_from` to `char_to −
     page.char_from`.
     - **It is not clamped.** A span outside the page is `changed`.
     - It is verified with `resolveSpan` on the page text: `exact` marks and scrolls to it,
       and `changed` shows the page with the notice "The cited passage could not be located on
       this page".
     - `moved` is not used for pages, because `ocr_text` is immutable once activated, so the
       chunk content is not read.
   - The mark is today's `RichText` mark.
7. **The page bar**, shared by both views:
   - "Page X of N · cited on page Y", with Previous, Next and "Back to citation";
   - the `section` heading and note when present (this closes F42 for ingestion-v2
     documents);
   - keys: ←/→ and `[`/`]` page, and `Home` returns to the cited page. These are bound only
     while focus is on the viewer's own controls, never in text selection or an input;
   - announced through an `aria-live` region.
   - The canvas has `role="img"` and the label "Page X of N, <title>".
   - The remembered view is stored in `localStorage`, wrapped in try/catch.

### `document-file` (Edge Function, `verify_jwt` off, auth in code)

- **Input:** `POST {document_id: uuid, page: int ≥ 1}`. A malformed body gets **400**.
- **Checks**, in this order:
  1. `requireUser`: a valid Supabase JWT, as research-chat requires.
  2. The document exists and has `storage_path`, `indexed_at` and `extract_hash`.
  3. `1 ≤ page ≤ page_count`.
  4. A `document_files` part covers the page.

  Each failure gets 404 with a fixed message, except the page range (422).
- **Least privilege:** the document and its part are read with the **caller's** client (RLS).
  The service role is used only for `createSignedUrl` on that part's `storage_path`, for 300
  seconds.
- **Output:**
  `{ok, signed_path, part_index, page_offset, page_count, byte_size, expires_in}`.
  - `signed_path` is relative to `/storage/v1`, and the client prefixes its own Supabase URL.
  - This works locally, where the function sees `http://kong:8000`. It also means the server
    never tells the browser to fetch an arbitrary origin.
- **Logging:** `user_id`, `document_id`, `part_index` and the outcome only. Never the path,
  the signature or the URL.
- **CORS:** the `_shared/cors.ts` allowlist.
- **No per-user cap in v1.** The client caches each part's signature until it expires; a cap
  is a follow-up if logs show abuse.

### Code layout

- `src/lib/pdfjs.js`: the memoised, lazy legacy-build loader. `corpusUpload.js` is changed to
  import it.
- `src/ai/page-viewer/`:
  - `PageViewer.jsx` (the lazy host), `PdfPage.jsx`, `TextPage.jsx`, `PageBar.jsx`;
  - `rangeTransport.js`: signature renewal and retry;
  - `pageModel.js`: pure functions for the part of a page, the local span, the state table,
    box styles and the aspect guard;
  - tests for each.
- `src/lib/documentFile.js`: the `document-file` client, with the signature cache.
- `supabase/functions/document-file/{handler,index}.ts` and tests; the config entry
  `verify_jwt = false`.
- `WorkSurface.jsx`: the sanitising point and the branch to the page viewer.
- `package.json`: `pdfjs-dist` is pinned to exactly `4.10.38`.
- No migration.

### Layout

The viewer fills the existing work surface. The page renders at fit-width, with zoom − and +
one step each way. On phones it uses the panel's full-width mode.

## From TenderBase

| Kept | Changed or avoided |
| --- | --- |
| A PDF and Text switch with one shared page | Defaults to PDF, not Text |
| Normalised boxes as percentage overlays | Draws only the current page's boxes, adds the aspect guard, and scrolls to the first box |
| The page bar: "cited on page Y", Back to citation, keyboard paging, `aria-live` | Paging works in both views, with keys bound to the viewer's controls only |
| A PDF failure falls back to the text view | Uses fixed messages, never the error text, which can carry the URL |
| Downloads the whole file into an unbounded cache | Fetches by byte range, renews the signature, and caches only neighbouring pages |
| A banner when the file changes | A full state table: deleted, not live, no hash, changed hash, no page row |
| Unescaped PDF text injected as HTML | Not done: pdf.js's own text layer only |
| The worker loaded from cdnjs, on the modern build | Worker bundled, on the legacy build |
| Zero-size boxes drawn; the "no location" hint specced but not built | Zero-size boxes skipped; the hint implemented |

## Security

- **Paths.** Paths are readable by signed-in users, but useless without a signature. The
  client never supplies a path. The function signs only the path that `document_files` names
  for that live document and page.
- **Signatures** last 5 minutes and are never stored, rendered or logged. pdf.js error text is
  suppressed because it embeds the URL.
- **Not-yet-live and failed uploads** cannot be fetched (the `indexed_at` and `extract_hash`
  check).
- **No HTML from PDF text.** Citation fields go through `sanitizeCitation` at the single
  entry point.
- **Untrusted input:** `document_id` must be a uuid and `page` an integer. Every refusal has a
  fixed message.
- **A `security-auditor` review of `document-file`** is part of the plan, before it deploys.

## Testing strategy

Each test is shown red first.

- **Vitest:**
  - **`pageModel`:**
    - the part for a page at boundaries;
    - the local span and an out-of-page span counting as `changed`;
    - every row of the state table;
    - box styles, and only the current page's boxes;
    - zero-size boxes skipped;
    - the aspect guard.
  - **`rangeTransport`:** an expired signature is renewed and the read retried once; a second
    failure surfaces as a fixed error.
  - **Error text:** a pdf.js error containing a URL is never rendered.
  - **Sanitising:** sanitised once in `WorkSurface`, covering the bubble, chip and list
    (stale-review cases).
  - **Legacy:** citations still open `SourceReader`.
  - **The page bar:**
    - key binding scope;
    - rapid paging cancels earlier renders;
    - unmount mid-render.
  - **Storage:** the remembered view survives `localStorage` throwing.
- **Bundle check** (a script run after `npm run build`, failing first by statically importing
  the loader):
  - `dist/assets/index-*.js` contains no `GlobalWorkerOptions`;
  - the main bundle grows by at most 2 KB gzip.
- **Deno:** `document-file`:
  - 400 for a malformed body, 401, 404 (missing, legacy, not live, no part), 422;
  - the part lookup at boundaries;
  - the relative `signed_path`, locally and as hosted;
  - nothing secret logged;
  - CORS.
- **Local end to end** (built-in browser, local stack):
  - **Transport, measured first:** a browser `Range` fetch of a signed URL gets `206`, and its
    CORS preflight allows `Range`.
  - **Documents:** the bill, the 25-page *Budget at a Glance*, a 3-part split document, and
    fixtures with a `/Rotate 90` page and a page whose CropBox differs from its MediaBox.
  - **Checks:**
    - a citation opens on its page, and its boxes sit on the passage (by eye, at three
      widths), or the guard hides them;
    - paging across a part boundary;
    - a stay longer than 5 minutes followed by Next still renders;
    - a deleted document;
    - a legacy citation, unchanged;
    - phone width.
- **NTER:**
  - repeat the transport measurement against hosted Storage (it may differ from local Kong);
  - the owner opens citations from the two live bills and the split *Budget at a Glance*.

## Acceptance evidence

- **Checks:** lint, build, the bundle check, Vitest, Deno, and the SQL fixtures (unchanged).
- **Local run:** written up in `docs/research/<date>-citations-pdf-local-run.md`.
- **Production, each step with its own go-ahead:**
  - deploy `document-file` and probe its CORS and refusals from the production origin;
  - push the frontend;
  - the owner's checks.

## Exclusions

- Changes to legacy documents or their reader.
- Re-OCR of legacy documents.
- The image strip and figure boxes.
- Word-level highlight.
- Continuous text mode.
- Annotations, forms, scripting, printing and page links.
- Search inside the viewer.

## Follow-ups for open-work

- **F42** shrinks to legacy documents.
- **Stale storage-path wording.** `<document_id>/…` appears in `20261001120000_page_contract.sql`
  (lines 73 and 138) and in `2026-09-30-rag-v2-chunk-contract.md:290`. The live keys are
  content-addressed, and for a split document `documents.storage_path` is part 0, not the
  whole file.
- **More views:**
  - a "superseded" notice for documents swapped out by Amendment A;
  - the image strip, once documents have images.
- **A per-user signing cap**, if the logs show abuse.

## Open questions for the owner

1. Approve the six decisions above (recommendations in bold)?
2. Confirm that **any signed-in user may open, and therefore download, every uploaded PDF**.
   This is the existing RAG v2 decision, stated plainly.

## Review record

Revision 1 was reviewed on 2026-10-01 by a fresh-context reviewer, who read the code,
migrations, specs and pdf.js 4.10.38 sources. All findings were accepted.

- **The reviewer verified as correct:**
  - the data-model claims and grants;
  - `document_files` for single-part documents;
  - the part-lookup rule;
  - that Mistral OCRs the same part file;
  - the text-span maths (headers and footers do not shift offsets);
  - that legacy chunks are never `pdf_page`;
  - that "any signed-in user" matches earlier decisions;
  - the eager import chain.
- **Critical:** C1, a 5-minute URL with lazy loading breaks the viewer. Now the range
  transport with signature renewal.
- **Required:**
  - R1: the pdf.js options contradicted the range goal. Now the transport, plus header checks.
  - R2: the local `kong:8000` URL. Now `signed_path` is relative.
  - R3: unlive documents could be signed. Now the `indexed_at`, `extract_hash` and part
    checks.
  - R4: pdf.js errors leak the URL. Now fixed messages only.
  - R5: "the path never reaches the client" was false. Reworded.
  - R6: missing states. Now the state table.
  - R7: unverified box alignment. Now the aspect guard, current-page boxes, DPR and fixtures.
  - R8: page notices, and clamping caused false mismatches. Now no clamp, and exact/changed
    only.
  - R9: untestable bundle claims. Now a build-output check with a bound.
  - R10: Safari before 17.4. Now the legacy build.
  - R11: render lifecycle and fetch rate. Now specified and tested.
- **Optional:**
  - O1: one sanitising point;
  - O2: least privilege and logging; no cap in v1;
  - O3: `expires_in`;
  - O4: accessibility, key scope, try/catch storage and the iOS cap;
  - O5: no annotations or scripting;
  - O6: the stale wording follow-up;
  - O7: the missing tests;
  - the nits: zoom wording, 400 for malformed, an exact pdf.js pin.
