# Plan: RAG v2 — page-wise citation viewer (`citations-pdf`, R6)

> **Status: Living (2026-10-01).** Implements `docs/specs/2026-10-01-rag-v2-citations-pdf.md`
> (revision 3, approved). Tracked as open-work R6. Historical when V9 lands.

## Ground rules

- Every task's tests are shown red first.
- Task agents leave their work uncommitted, and the supervisor verifies and commits it.
- Worktrees are fast-forwarded to the branch tip first.
- **Branch:** `task/rag-v2-citations-pdf`.
- **Production:** each step has its own go-ahead, and an agent never signs in.

## Fixed interfaces

- **`document-file`**
  - **Request:** `POST {document_id, page}`.
  - **Response:** `{ok:true, signed_path, part_index, page_offset, page_count, byte_size,
    expires_in}`.
  - **Refusals:** `{ok:false, code, error}`, with:
    - 400 `bad_request`;
    - 401 `unauthorized`;
    - 404 `not_found` (missing, legacy, not live, no part);
    - 422 `bad_page`.
    - **Added in V2 (accepted):**
      - 503 `unavailable`, for a database, storage or Auth outage;
      - `cache-control: no-store` on every reply;
      - a method other than POST, after authentication, is 400;
      - a body over 1 KB is 400.
- **`src/lib/documentFile.js`**
  - `createDocumentFileClient({request, baseUrl, now})` (`request` is an injected POST; `defaultDocumentFileClient()` wires the app's Supabase session) returns `{partFor(documentId, page)}`.
  - `partFor` resolves to `{url, partIndex, pageOffset, pageCount, byteSize}`. The url is
    absolute (`baseUrl + '/storage/v1/' + signed_path`).
  - It caches per `(documentId, partIndex)` until `expires_in` runs out, minus 30 seconds.
  - It also exposes `invalidate(documentId, partIndex)`.
- **`src/lib/pdfjs.js`:** `loadPdfjs()` loads the legacy build; it is memoised, and the worker
  comes in via `?url`.
- **`src/ai/page-viewer/pageModel.js`**, pure functions:
  - `partForPage(parts, page)`;
  - `localSpan(citation, pageRow)`, giving `{from, to} | null`;
  - `viewerState({doc, citation, pageRow})`, giving one row of the spec's state table;
  - `pageBoxes(citation, page)`;
  - `boxStyle(box)`;
  - `aspectOk(pageRow, viewport)`.
- **`src/ai/page-viewer/rangeTransport.js`:**
  `createRangeReader({getUrl, invalidate, fetch})` returns `read(begin, end)`, which gives an
  `ArrayBuffer`. It renews the URL and retries once on 400/401/403.

## Tasks

**V0. Spec revision 3 and this plan** (supervisor, done).

**V1. Transport gate** (supervisor, S). This is a measurement before any build.
- On the local stack, from a browser page on the dev-server origin:
  - `fetch(signedUrl, {headers: {Range: 'bytes=0-1023'}})` returns `206` with 1,024 bytes;
  - the CORS preflight allows `Range`.
- Record the response headers.
- **If it fails,** stop and revise the spec (fallback: proxy ranges through the function).
- **Result (2026-10-01, local, executed): passed.**
  - **curl:** `Range: bytes=0-1023` gave `206 Partial Content`, with `content-range: bytes
    0-1023/2744811` and `accept-ranges: bytes`. The preflight answered 200 with
    `Access-Control-Allow-Headers: range`.
  - **Browser** (a page on `http://localhost:5173`, fetching `127.0.0.1:54321`): both the first
    1,024 bytes (`%PDF-1.7`) and the last 44,811 bytes came back as `206` with exact lengths.
  - `Content-Range` is not readable from the page, as the review predicted. The transport
    relies on `document_files.byte_size` and checks each body's length instead.
  - **Hosted Storage still needs the same check.** It is measured in V8 step 1, with the
    owner's go-ahead.

**V2. `document-file`** (agent, M). In parallel with V3 and V4.
- **Files:**
  - `supabase/functions/document-file/{handler,index}.ts` and its tests;
  - the `supabase/config.toml` entry.
- **Acceptance:**
  - every check, in the spec's order;
  - the caller's client (RLS) for reads, and the service role only to sign;
  - a relative `signed_path`, locally and as hosted;
  - logging limited to `user_id`, `document_id`, `part_index` and the outcome;
  - CORS;
  - each Deno test red first.

**V3. The shared pdf.js loader and the bundle check** (agent, S). In parallel with V2 and V4.
- **Files:**
  - `src/lib/pdfjs.js` and its test;
  - `src/lib/corpusUpload.js` (its import only);
  - `scripts/check-bundle.mjs`;
  - `package.json` (pin `pdfjs-dist` to `4.10.38` and add a `check:bundle` script).
- **Acceptance:**
  - the admin uploader's tests still pass;
  - the bundle check fails first against a static import;
  - the main bundle has no `GlobalWorkerOptions`.

**V4. Pure model, range reader and file client** (agent, M). In parallel with V2 and V3.
- **Files:**
  - `src/ai/page-viewer/pageModel.js`;
  - `src/ai/page-viewer/rangeTransport.js`;
  - `src/lib/documentFile.js`;
  - their tests.
- **Acceptance:**
  - every state-table row;
  - part boundaries;
  - a span outside the page counts as `changed`;
  - the aspect guard and current-page boxes;
  - renew-and-retry once, and a second failure gives a fixed error;
  - cache expiry.

**V5. The viewer components** (agent, L). After V3 and V4.
- **Files:**
  - `src/ai/page-viewer/{PageViewer,PdfPage,TextPage,PageBar}.jsx`;
  - `src/ai/page-viewer/viewer.css`;
  - their tests;
  - `src/ai/WorkSurface.jsx` (the single sanitising point and the branch to the page viewer).
- **Acceptance:**
  - PDF and Text share one page, with PDF as the default and the choice remembered
    (try/catch);
  - render cancellation, part switching and destroy on unmount;
  - fixed error messages, with no URL in the DOM;
  - "Open stored copy" opens a blank tab first;
  - keys scoped to the viewer's controls, `aria-live`, and `role="img"`;
  - legacy citations still open `SourceReader`;
  - the main-bundle bound holds.

**V6. The overlay host** (agent, M). After V5.
- **Files:**
  - `src/ai/AiPanel.jsx` (where the viewer mounts);
  - `src/ai/CitationOverlay.jsx` (a portal), with its CSS and tests;
  - `src/ai/research.css` if needed.
- **Acceptance:**
  - closed, the chat is unchanged;
  - open, the overlay widens from the middle of the screen, with the chat on the left half and
    the viewer on the right;
  - the desk underneath is not reflowed;
  - reduced motion is honoured;
  - `Esc` closes it;
  - it works from both the dock and a desk's "AI research" tab;
  - phones get a full-screen viewer with a back control.

**Checkpoint J.** Lint, build, the bundle check, both test suites, `npm run test:sql`, and a
review of every diff. A **security-auditor** reviews `document-file`.

**V7. Local end to end** (supervisor, in the built-in browser). Run the spec's local list,
including:
- the rotated-page and CropBox fixtures and a 3-part split;
- a stay longer than 5 minutes followed by Next;
- a deleted document;
- a legacy citation;
- phone width.

Write it up as `docs/research/<date>-citations-pdf-local-run.md`.

- **Box-alignment measurement (2026-10-01, executed ahead of V7):** three generated one-page
  fixtures in `ingest/r6/`: plain, `/Rotate 90`, and a CropBox of 540×640 inside a 612×792
  MediaBox. Each page carries three text markers at known positions.
  - **Method:** each page was OCR'd directly by `mistral-ocr-4-1`, with the worker's flags and a
    base64 document. It cost 3 pages, about $0.012. Each marker's pdf.js text origin was then
    compared with Mistral's normalised block box.
  - **Result:** all 9 markers lie inside their Mistral box.
    - Mistral rasterises the CropBox with `/Rotate` applied, exactly as pdf.js renders it: the
      rotated page is reported as 1023×791.
    - The aspect ratios agree to within 0.1% (0.773/0.773, 1.293/1.294, 0.844/0.844), so the 2%
      guard does not trip on these pages.

**Checkpoint K.** The owner reads the report.

**V8. NTER**, each step with its own go-ahead:
1. deploy `document-file`, then probe its CORS and refusals and the hosted range behaviour;
2. push the frontend.

**V9. The record**, and R6 is marked done.

## Order

```
V0 ─ V1 (gate) ─┬─ V2 (document-file) ──────────────┐
                ├─ V3 (pdf.js loader) ─┐            │
                └─ V4 (model, transport)┴─ V5 ─ V6 ─┴─ J ─ V7 ─ K ─ V8 ─ V9
```

## Risks

| Risk | Mitigation |
| --- | --- |
| Storage refuses a cross-origin `Range` request, or doesn't answer it with `206` | The V1 gate runs before any build; the fallback proxies ranges through the function |
| Boxes misalign on rotated or cropped pages | The aspect guard, plus fixtures in V7 |
| The overlay fights the desk's own layout | A portal to the body, fixed position, and tested from both mount points |
| The lazy chunk leaks into the main bundle | The bundle check fails the build |

## Revision 4 tasks (approved 2026-10-01)

- **W1. Resizable overlay** (agent, M; in parallel with W2).
  - **Files:** `src/ai/CitationOverlay.jsx`, `src/ai/citationOverlayModel.js`,
    `src/ai/citation-overlay.css` and their tests.
  - **Acceptance:** spec revision 4, point 1.
- **W2. Readable pages and full view** (agent, L; in parallel with W1).
  - **Files:**
    - `src/ai/page-viewer/*`, covering:
      - the zoom and fit model;
      - block reads in `viewerData.js`;
      - the crop render in `PdfPage.jsx` / `pdfController.js`;
      - the header controls;
      - the full-view dialog;
      - `viewer.css`;
    - their tests.
  - **Acceptance:** spec revision 4, points 2 and 3.
- **Checkpoint J2:** lint, build, the bundle check, both test suites, and a review of the diffs.
- **V7b. Local browser run**, with an addendum written into the V7 report.
- **V8b. NTER:** the frontend push, with its own go-ahead; then the owner's checks.

## Revision 5 tasks (approved 2026-10-01)

- **X1. Click outside** (agent; in parallel with X2).
  - **Files:** `src/ai/CitationOverlay.jsx`, `src/ai/citationOverlayModel.js`, `src/ai/AiPanel.jsx`,
    `src/ai/AiDock.jsx`, `src/ai/WorkSurface.jsx` (labels only) and their tests.
  - **Acceptance:** spec revision 5, points 1 and 2.
- **X2. Full-view backdrop and F45** (agent; in parallel with X1).
  - **Files:** `src/ai/page-viewer/*` and `src/lib/documentFile.js`, with their tests.
  - **Acceptance:** spec revision 5, points 3 and 4.
  - The Ask-button state reaches `WorkSurface` through a callback prop that X1 wires.
- **J3:** the checks; **V7c:** a local browser run; **V8c:** the frontend push, with its own
  go-ahead.
- **Owner checks on NTER:**
  - R6: the stored-copy tab and the legacy reader;
  - R8: the split upload and a delete.
- **Close-out:** R6 and R8 are marked done, the plan is made Historical, and the records are
  pushed.
