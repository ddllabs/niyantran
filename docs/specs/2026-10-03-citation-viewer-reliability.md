# Citation viewer reliability (F57)

> **Status: Normative.** Approved scope: owner authorizes local implementation on 2026-10-03.

## Current state and problem

Production browser observations on the existing anti-doping bill conversation: page 12 highlights vanish after nearby scrolling and returning; reopening the same chat citation while page 13 is visible does not return to page 12. Full view or unmounting and redrawing the page temporarily restores the mark. Code inspection finds page slots rendered in changing priority order, which moves ancestors of live DOM ranges. Toolbar return uses stored boxes rather than the exact text range, and the cited chip is inert on the cited page.

## Expected outcome and acceptance

- Keep mounted PDF pages in document order while scheduling draws nearest the viewport first; preserve the existing eight-page window, two concurrent draws and three-part cache.
- Citation highlights survive nearby scrolling and are rebuilt on remount and zoom.
- Clicking the same chat citation issues a fresh navigation request without resetting zoom, search or the PDF pool.
- The cited-page control stays actionable on that page. It and Home reveal the exact passage after drawing when available, falling back to stored boxes or page top.
- Opening full view preserves the current page; when that page is the cited page it centres the citation, matching the existing opening contract. A previous toolbar request never overrides that opening page.
- Navigation never replays an old citation request when its page is redrawn later; subsequent page/search navigation cancels pending citation reveal.
- Verify split and full view, fit width/page/text, manual zoom, thumbnails, search and resizing in a local browser. Treat stutter as an observation to measure, not permission for speculative optimization.
- Regression guards must fail on the original defects. Run focused tests, full Vitest, lint and production build; record warnings and browser evidence.

## Scope and exclusions

Write scope: src/ai/WorkSurface.jsx and its tests; src/ai/page-viewer/ viewer components, highlighting helpers and focused tests; a local browser fixture under scripts/viewer-regression/; this spec, its plan, existing continuous/toolbar specs only for changed contracts, and docs/plans/open-work.md. No dependencies, APIs, ingestion, payments, entitlements, authentication, production writes, push or deploy.

## Risks

Effects can complete after navigation, resizing replaces text nodes, and CSS highlights share global names. Use one navigation request identity per event and consume/cancel it explicitly. Existing pending F56 documentation is preserved in the original checkout.
