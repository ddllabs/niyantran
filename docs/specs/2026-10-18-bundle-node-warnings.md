# Bundle loading and deprecated URL-parser cleanup

> **Status: Normative.** Owner approved local specification, implementation and verification2026-10-18. No publication authorized.

## Current state and problem

Main79c0799 is clean and synchronized. Vite5.4.21 / React19 / Node24.
Last verified build: entry611.93kB (180.38kB gzip), TerminalShell938.35kB
(292.60kB gzip), shared AiMarkdown699.08kB (147.30kB gzip). The latter
contains catalogue/reference data, not just markdown. Initial gzip passes its
180,398-byte baseline plus2,048-byte tolerance. Large deferred chunks still
make first desk/panel use costly. Static imports bring unrelated views along.
Production logs have DEP0169 url.parse warnings. No direct deprecated call
found in application source; direct local router import/unmatched GET has no
warning. Caller must be demonstrated before changing runtime behavior.

## Independent capabilities and order

1. url-parser: establish a causal local reproduction using the responsible
   request/dependency boundary, then fix owned code or supported local build
   configuration. Preserve routing, duplicate query values, encodings, bodies,
   cookies, authentication and error/cache behavior. Do not suppress warnings,
   downgrade Node, patch vendor directories or claim a live fix from local proof.
2. bundle-loading: introduce demand-based view loading and isolate heavy
   shared modules at actual consumer boundaries. Preserve session restoration,
   desk catalogue/search/navigation, selected records, streaming chat state,
   citations/PDFs, credit/account actions, loading/errors and CSS cascade.

## Acceptance and exclusions

Trace the deprecated call locally and prove the protected failure before/after;
no DEP0169 for the exercised adapter/router path after the fix. If the remaining
caller belongs to a platform component inaccessible locally, retain an explicit
open production-validation limitation rather than silently calling it fixed.

Measure baseline/result with identical builds. Reduce the JavaScript loaded for
an initial terminal route or optional interaction by at least10% (gzip), without
increasing the aggregate public initial closure beyond its existing budget.
Keep the500kB warning threshold; no warning filters. Use explicit bounded chunks
where justified, but do not count chunk renaming or vendor extraction alone as
a loading improvement. If an indivisible vendor chunk remains, report it.
No new dependencies unless a demonstrated caller requires a narrowly scoped
supported update. No visual/product behavior change, data rewrite, timers,
Supabase settings/functions, production calls/writes, payments or corpus work.

Commands: focused `npm test -- <affected tests>` with causal failure evidence;
`npm test`; `npm run lint`; `npm run build`; `npm run check:bundle`;
`node -e "import('./api/router.js').then(() => console.log('router import ok'))"`
for API/server changes; Deno suite for src/lib changes per AGENTS.md. Build,
test and probe commands use the existing local no-dotenv guard. Browser checks
use synthetic fixtures and blocked external requests; no paid/model calls.
