# Heavy PDF scrolling measurements (F58)

> **Status: Historical (2026-10-03).** Local supervisor observations; not production RUM.

## Outcome
The retained F57 viewer fixes passed far-page citation return on real PDFs. Repeated scrolling was steady in these local runs. No production performance change is justified by these measurements; isolated first-traversal stalls still need attribution (F59). This does not establish that every reported heavy-PDF stutter is resolved.

## Documents and conditions
Budget at a Glance: 2,744,811 bytes, 25 pages, local public-government copy. Economic Survey 2025–26: 24,855,069 bytes, 740 pages, downloaded temporarily from the [Ministry of Finance](https://www.indiabudget.gov.in/economicsurvey/doc/echapter.pdf). Neither was ingested, uploaded or committed. The authorized corpus has one 13MB electoral-roll PDF; ten-smallest contains OCR output, not PDFs. Automatic approval review rejected the roll's text-returning harness route; it was never served. The public Survey provided a complete-renderer alternative without extracting electoral identities.

Codex in-app browser on macOS; browser engine/version was not recorded. Viewport 1280×720, split width 600px, usable pane 574×504, Fit width. Budget reported DPR 1; Survey reported DPR 2, so cross-document timings are not a controlled comparison. Within each repeated series settings were constant. Loopback PDF bytes and offline table responses replace signed storage/database network calls. Production source is unchanged from F57.

The harness resets to the selected page, excludes one second of settling, then advances linearly across 15 pages over twelve seconds. Frame gaps use requestAnimationFrame; long tasks use PerformanceObserver; canvas, text-span and loading counts are sampled every 250ms. This instrumentation adds overhead. It does not measure worker CPU, render concurrency, per-page readiness latency, native wheel input latency or field INP. Browser first cited-canvas time starts before metadata fetch, excludes server extraction/startup and is not a cold-cache SLA.

## Results

| Series | p95 frame gap (ms) | p99 (ms) | Largest gap (ms) | Long tasks | Visible loading samples | Max live page canvases |
|---|---|---|---|---|---|---|
| Budget first traversal, p1–15 | 17.4 | 33.3 | 650.7 | 1 (105ms) | 0/49 | 3 |
| Budget repeat 2, p1–15 | 17.4 | 17.6 | 17.7 | 0 | 0/49 | 3 |
| Budget repeat 3, p1–15 | 17.3 | 17.6 | 17.8 | 0 | 0/49 | 3 |
| Survey exploratory first traversal, p1–15 | 17.6 | 17.7 | 132.7 | 2 (55,111ms) | 0/49 | 3 |
| Survey repeat 1, p200–214 | 17.3 | 17.6 | 17.7 | 0 | 0/49 | 3 |
| Survey repeat 2, p200–214 | 17.4 | 17.7 | 19.7 | 0 | 0/50 | 3 |
| Survey repeat 3, p200–214 | 17.4 | 17.6 | 17.7 | 0 | 0/50 | 3 |

Budget initial cited canvas was observed at 1104.4ms; Survey at 1709.8ms, then 1471ms after a harness reload. These are single observations, not repeated cold-start estimates. All retained traversals reached their requested final page. Raw timing-only evidence: [metrics JSON](2026-10-03-heavy-pdf-profile.metrics.json).

An exploratory Survey run overlapping lint/tests/build was deliberately excluded. A second front-matter run was interrupted by harness development and not retained. No CPU-intensive verification commands overlapped the retained repeat series. The first-traversal frame maxima are not explained by long-task entries alone; no CPU trace capability was available. Changing production scheduling from this evidence would be guessing.

## Correctness and verification
After far scrolling, repeated citation opening restored page 1 and a connected nonempty citation range for both documents. A fresh Survey tab navigated to 214 and the cited-passage button returned to 1; the exact highlight painted visibly, with ascending live pages 1,2. Its fresh console had no warning/error entries. During harness hot reload an earlier tab reported duplicate createRoot; this was absent in the fresh tab and is not a production viewer error.

Supervisor executed:
- `npm run lint`: passed, zero warnings.
- `npm test -- --run src/ai/page-viewer/PdfDocument.hooks.test.jsx src/ai/page-viewer/PageViewer.hooks.test.jsx src/ai/page-viewer/pdfPool.test.js src/ai/page-viewer/chrome.test.jsx`: 62 tests in 4 files passed.
- `npm run build`: passed; existing deskBrief mixed-import and >500kB chunk warnings.
- `node ./node_modules/eslint/bin/eslint.js --max-warnings 0 scripts/viewer-regression`: passed after the selected-start extension.
- `node ./node_modules/vite/bin/vite.js build --config scripts/viewer-regression/vite.config.mjs`: passed.

Independent read-only review found no required harness blockers after correcting the start-page README wording. No production code or regression guard was added, so no new defect-restoration claim applies. The author additionally ran 70 focused tests and verified the local PDF 206 range route; the supervisor's62-test selection above is separate evidence.

## Limits and next action
F59 tracks first-traversal CPU/render attribution, full-view/thumbnail performance and signed-storage network timing if real stutter remains reproducible. F50 retains Safari acceptance. No production monitoring was installed, no before/after optimization claim is made, and all 740 pages were not exhaustively scrolled. The available repeat evidence supports keeping the current bounded viewer rather than adding unmeasured complexity.

The default synthetic fixture was also checked in a fresh tab after the final harness edits: page 12, ascending live pages 11–13, one connected citation range, no console warnings/errors.
