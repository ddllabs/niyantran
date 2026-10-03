# Heavy PDF scrolling profile (F58)

> **Status: Living.** Authorized October 3, 2026; supervisor owns technical planning.

## Current state and objective
F57 fixes citation range loss and repeated navigation. Its synthetic 18-page checks prove correctness but do not establish performance on heavy real PDFs. Measure rendering and scrolling in the existing reader using local corpus PDFs; retain a change only if a repeatable bottleneck and improvement exceed run-to-run noise.

## Scope and boundaries
Read only the NTER Compressed Data and 10 Smallest Files collections and public government PDFs, including a temporary Ministry of Finance Economic Survey download outside the corpus. Serve selected bytes on loopback only; never commit corpus bytes. No ingestion, uploads, Supabase writes, production changes, dependencies, payment or entitlement work. Production viewer code changes require a measured hypothesis recorded here first.

## Interfaces and style
Use the real PageViewer/PdfDocument/pdfPool with an offline client, matching scripts/viewer-regression conventions. Local instrumentation belongs in the harness, not production. Record browser, viewport, document size/page count and cache conditions. Existing style uses small ES modules and React hooks, for example `const elapsed = performance.now() - started;`.

## Acceptance and verification
Inventory at least two representative documents with metadata only. Measure at least three equivalent scrolling runs per document; separate first-load and warm behavior. Record frame gaps, long tasks when supported, readiness and live canvas/render bounds. Verify citation return and highlights remain correct. A local profile cannot claim field INP or Safari acceptance.

Commands: `npm run lint`, `npm run build`, focused viewer Vitest checks and `git diff --check` for harness/code changes. No code suite required for a documentation-only outcome. Before retaining a fix run relevant regression tests, prove new guards fail for the defect, and independently review before integration. Results and limitations live in docs/research; F58 is tracked only in open-work.

## Fixture selection refinement
Automatic approval review rejected serving the electoral roll because profile metadata returns extracted page text. That document was not served. Use the public Economic Survey instead; suppressing its text layer would change the rendering workload and weaken the measurement. Corpus collections remain untouched.
