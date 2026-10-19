# Authenticated browser diagnostics fixes

Status: Normative.

Owner approved fixing the BBC CORS and remaining form/admin accessibility warnings, required checks and Chrome verification before deployment.

Chrome audit observed a redundant browser BBC football RSS request blocked by CORS while the same-origin feature feed serves rows. Fund-flow/account/admin controls have missing names and some admin controls lack labels.

Outcome: Football Wire continues using the existing server feature-feed; the static archive never fetches BBC RSS directly and reports its live-host requirement honestly. All controls in the observed fund-flow, account Usage/Activity and admin views have names and accessible labels. Preserve handlers, radio grouping, validation, account/credit/model behavior and source provenance.

Scope: src/lib/archiveFeed.js and focused regression tests; src/desks/FundFlowDesk.jsx; src/shell/usage/{UsageAnalytics,ActivityTable}.jsx; src/admin form markup, KPI caption semantics and matching CSS, and related tests; task documentation. No schema, Edge deployment, CSP relaxation, dataset, corpus, billing logic or unrelated feed changes.

Acceptance: defect-specific regression fails before fix, passes after; full application and Edge tests, lint, build and bundle gate pass; Chrome local runtime checks show no direct BBC fetch and no scoped form diagnostics, existing rows render. SQL fixtures only if SQL changes (none planned). No production mutations during browser checks.
