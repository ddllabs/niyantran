# Consistent desk cards and module expansion

> **Status: Living.**

## Specification
Hidden full module lists currently determine front height, while variable descriptions shift image boundaries. Owner approved consistent Global-inspired default dimensions across all eight desks, unchanged four/five-column layouts, four modules initially and explicit expansion of only the selected card. Preserve navigation, filters, counts, focus, reduced motion and all modules. Closing resets expansion.

## Plan and scope
1. Add causal expansion/reset tests in SectorCard.test.jsx.
2. Update DeskLandingFrame.jsx with local expansion and accessible Show more/fewer controls. Keep extra links hidden until requested.
3. Update deskLandingV6.css with shared image/text regions and non-stretching sibling cards. Expanded reverse can grow without stretching front images.
4. Run focused/full application tests, lint/build/bundle; inspect Global/State and responsive sizes locally. No deployment.

Only shared desk files, related tests and task docs/open-work are writable. Billing, data and API logic excluded. Isolated task/desk-card-sizing from d74798be; preview harnesses remain untracked.

## Local verification — 2026-10-22

Implemented locally, uncommitted and not deployed. Shared default height is 640px with a 360px image region. Four reverse links are initially visible; expansion reveals the remaining links, collapse/close resets the preview. Full accessible names and hover titles retain truncated display text.

- Causal regression failed before implementation (extra links were not hidden), then passed.
- `npm test`: 421 files, 6,548 tests passed.
- Final `npm test -- src/desks/landing`: 15 files, 245 tests passed.
- Final `npm run lint`, `npm run build`, `npm run check:bundle`, `git diff --check`: passed.
- In-app browser at 1440px: all eight desks retain four/five columns; all 35 cards measure 640px with 360px image regions, no title/description overflow observed.
- State checked at 320/768/1024px: consistent default heights and no card-body overflow. Expanding eleven modules grew only the selected card to 1102px; siblings stayed 640px. Show fewer restored all cards to 640px. Escape restored the front and focus.
- Local preview captured no console warnings/errors. Preview uses actual presentation/components with unavailable summaries and no production connection; live backend/count verification is outside this local UI check.
- Edge Function and SQL fixture suites not run: no backend, SQL, lib/admin or Supabase changes. No production, billing, data or module-route changes.
- Preview harness files remain untracked and excluded from integration.

## Owner refinement
The initial 640px baseline was too tall versus production Global (492–509px at 859px viewport). Revise to 520px/280px image, compact bottom copy and shared Back/More footer. Preserve expansion and navigation; verify locally before publication.

Refinement verified: focused 245 tests, lint, production build and diff whitespace check passed. All eight desk variants inspected at desktop width; State tablet overflow corrected and all five cards measure 520px at 768px. State also checked at 320/1024/1440px. More/Less expansion exercised; siblings retain baseline. No captured local console errors/warnings. Prior 640px evidence above describes the superseded first draft. Still uncommitted/local only.

## Front-only image emphasis refinement
Owner approved compact front copy while preserving overall/reverse dimensions. Image now 326px, front body 192px, overall 520px. Removed front dividers; metadata shares one row and coverage-count label is shortened to measured. Reverse CSS/interaction unchanged in this refinement. All eight desks checked at 320/768/1024/1440px with no title/description/metadata overflow detected. Final focused 245 tests, lint/build and diff check passed; local console captured no warnings/errors. Uncommitted, no deployment.

## Release authorization
Owner approved push, merge to main and deployment on nter.pro. Final scope reviewed: shared presentation only, no dependencies, secrets, billing, API or data changes. Local preview harnesses excluded. Protected PR and both required CI jobs must pass before production. Rollback is a reviewed revert of this UI change.
