# State sector grid parity

> **Status: Historical (2026-10-21).**

Problem: the shared flip implementation forced dense sectors into two outer columns, unlike the other desks. Owner requests the normal sector-count layout.

Scope: deskLandingV6.css and scoped docs only. Remove the dense outer and inner two-column overrides, apply the common tablet breakpoint to State. Preserve all module logic, full lists, shared hover/flip and page scrolling. No billing or production changes.

Verification: `npm test -- src/desks/landing` 244 tests passed; `npm run lint`, `npm run build`, `git diff --check` passed. Browser checked State at 859px (three columns, five cards), and desktop 1440px iframe renders the normal narrow card row. All 41 module entries remain in the accessibility tree; long reverse content determines taller cards. No SQL/Edge code changes; those suites not rerun for CSS-only correction.

Local branch task/state-sector-grid in the existing isolated desk checkout; preview harnesses preserved and excluded. Implementation committed as `2954800`. Owner authorized push and merge; normal protected PR publication follows passing required CI. Production activation is tracked separately.
