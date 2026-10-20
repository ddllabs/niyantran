# Desk sector flip cards

> **Status: Living.**

All eight desk wrappers use DeskLandingFrame. Selecting a sector currently changes a separate lower module panel, obscuring the next action. Replace that presentation with taller cards: explicit Explore modules front action, reverse module list and Back action. Only one card opens; all start closed. Preserve all 120 module destinations, modified clicks, counts, source filters and fetching. Hidden faces are inert; focus moves to the reverse and returns on close. Escape closes. Reduced motion disables the rotation transition. Responsive content must fit without clipping or internal scrolling.

Scope: src/desks/landing shared frame, styles, motion focus helper and related tests; this spec, plan and open-work entry. No billing, data, API or deployment changes. Separate task/desk-sector-flip checkout; show Global locally before production approval.

Acceptance: causal regression before implementation, all eight desks/120 links verified, responsive/keyboard/local browser checks, full application tests, lint and build. No production modifications.

Owner refinement: images fill available front-face space above bottom-anchored title/description/counts/CTA; shared front/back CTA styling; highlighted module hover/focus states; reverse non-module background closes the card while module links retain independent activation. Explicit Back and Escape remain keyboard controls.

Second owner refinement: remove arrows from all sector front/back CTAs and module rows; remove the hover leading stripe; add balanced module-row padding with full-row accent highlight and existing shadow/font tokens. Hero/data actions are outside the card-arrow scope.

Retain existing interaction language explicitly: slight outer hover lift with ink border; selected/open face deep-blue border; inner module hover follows the same restrained lift/border/type styling. Pause/reduced motion disable positional movement without losing state feedback.

State layout correction: use the same sector-count desktop columns and responsive breakpoints as every other desk. Long reverse lists remain single-column and fully visible with page scrolling; no dense-sector grid exception.
