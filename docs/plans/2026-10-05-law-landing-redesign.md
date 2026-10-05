# Law landing implementation plan

> **Status: Living.** Local scope authorized 2026-10-05; no delegation or publication.

[Spec](../specs/2026-10-05-law-landing-redesign.md). Branch task/law-landing-redesign based on verified shared National/Global checkpoint9eb4637, retaining their prerequisite work without merging main.

## Ordered work and write scopes
1. Audit existing12 judiciary feeds and reference; document actual table/reporting identity and shared resources. Documents in this plan/spec and open-work.md.
2. Projection and API: src/lib/lawLandingSummary.js/.test.js, server/lawLandingSummary.mjs, src/lib/lawLandingApi.test.js, server/featureFeed.mjs and api/router.js. Fixed version1 interface from spec; canonical GET only, shared resource dedup and unknown/error guards. Red proof before relying on guards.
3. Client loading: src/desks/useLawLanding.js/.test.js. Three workers, timeout, cancellation and retry using Law endpoint; no National/Global behavior changes.
4. Reference UI: src/desks/LawLandingView.jsx/.test.jsx, LawLandingArtwork.jsx, lawLanding.css, DeskLandingView.jsx. Shared National row/filter/motion contracts unchanged; optional row count-unit prop only if needed to expose news identity. Use four existing groups and real tier chart, no mock counts.
5. Verify material flows and visual fidelity in actual browser; focused/full Vitest, Deno, lint/build/router import. Record evidence in docs/plans/2026-10-05-law-landing-verification.md. Review diff and create coherent local checkpoint. Native limitations/owner acceptance stay open in tracker.

## Current evidence
Local feed GET audit completed all12; raw220 shared Supreme Court views,434 NCLT/IBBI entries and nine news-search modules. No State code changed. Fetch succeeded after transient approval-review capacity failure. Provider query relevance is outside UI scope and must not be described as verified docket coverage.

## Local verification checkpoint
All five implementation stages executed locally.2152 Vitest/862 Deno tests, lint/build/router import pass. All12 signed-in canonical routes/Back, search/source filters, keyboard disclosures, responsive widths, dark/light, Hindi label and pause/offscreen motion verified. [Evidence](2026-10-05-law-landing-verification.md). Native environmental/touch execution and owner visual acceptance remain F83; provider query relevance is F84. No publication.
