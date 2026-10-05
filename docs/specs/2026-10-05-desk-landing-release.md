# Desk landing final polish and release

> **Status: Normative.** Owner authorized completion, cleanup, merge and push on 2026-10-05.

## Outcome and scope
Finish F81–F83 and F85 for National, Global and Law: correct singular module wording, reconcile tour guidance with the desk rail/cards and existing dropdowns, review layout against the supplied HTML, verify motion lifecycle and responsive flows, then integrate the stacked desk branches into main and push origin/main. This authorization supersedes the earlier local-only release boundaries. State and the unmerged Earth work remain separate.

The reference uses an aligned row grid, not masonry. Preserve that composition and its deliberate space beneath shorter cards; do not introduce reordered visual/tab navigation to fill it. Verify there are no persistently blank visible cards or page-width overflow. Keep actual source counts, coverage disclaimers and reporting identity; F84 provider relevance is a separate scope.

## Evidence and release gates
Use existing route evidence for all40 routes plus final runtime checks on the integrated checkout. Run full Vitest, Deno, lint/build and router import. Verify actual reduced-motion/hidden-tab/touch if supported; explicitly record environment limitations rather than claiming execution. Review outgoing paths and bounded endpoint behavior. Clean only branches proven merged; preserve unmerged work. Confirm origin/main matches the merged commit and inspect the resulting deployment. Rollback is reverting the release merge and pushing, without any database rollback or data edits.

## Write scopes
src/desks/{NationalLandingView,GlobalLandingView,LawLandingView}.jsx and their relevant presentation expectations; src/lib/onboarding.js; task records under docs/specs and docs/plans. No provider, credentials, billing, ingestion or dataset changes.
