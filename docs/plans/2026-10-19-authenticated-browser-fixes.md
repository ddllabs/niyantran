# Authenticated browser fixes plan

Status: Living.

Spec: ../specs/2026-10-19-authenticated-browser-fixes.md.
Branch task/authenticated-browser-fixes; isolated /private/tmp/nter-authenticated-browser-fixes preserves shared Razorpay files. Sequential, no delegation.

1. Reproduce BBC archive fetch in Vitest; remove only blocked browser BBC request, retain server ingestion/serving.
2. Add meaningful names and missing accessible labels to audited form controls. Preserve existing handlers and radio names. Review exact markup diffs.
3. Run focused regressions, npm test, deno test -A --config supabase/functions/deno.json supabase/functions, npm run lint, npm run build, npm run check:bundle. No SQL source changes; no SQL fixture dependency.
4. Verify local built frontend in Chrome against read-only data, account/admin views without saving or paid actions. Record limitations.
5. Review and commit scoped changes; deploy only after successful required checks and browser verification under owner authorization. Record hashes, deployment and production smoke check.

## Verification — 2026-10-19

- Reviewed the complete scoped diff: only BBC archive fetch behavior and form names/accessibility semantics changed. No handler, radio-group, validation, permission, billing, model configuration, source mapping, dependency or data changes.
- `npm ci`: passed; existing install-script policy warning for esbuild/fsevents. No dependency changes.
- BBC regression first failed against the original direct RSS fetch, then passed after removal.
- `npm test`: 402 files, 6,296 tests passed after final changes. Initial focused run identified a checkbox assertion tied to attribute order; relaxed only the intervening-attribute pattern, preserving checked/disabled behavior assertions.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: 1,172 passed, zero failed. No Edge source changes.
- `npm run lint`, `npm run build`, `npm run check:bundle`: passed. Bundle initial gzip 180,762 bytes across two assets.
- Router import and `git diff --check`: passed. Public data unchanged.
- SQL fixtures not applicable: no SQL/auth/backend behavior changes. No standalone type-check exists.
- `npm audit --audit-level=high`: existing dev-tool advisories (2 moderate, 2 high, 2 critical) in Vite/Vitest dependencies. `npm audit --omit=dev --audit-level=high`: zero vulnerabilities. Toolchain remediation is a separate open item; no force-upgrade in this scoped fix.

## Chrome execution evidence

Tested the built frontend on the already-supported localhost:5173 origin, with same-origin API preview forwarding to existing production reads. An initial temporary port was rejected by existing Edge CORS; moved to the supported origin without changing CORS settings.

Football Wire rendered 216 stories; feature-feed returned HTTP 200; Network showed zero direct feeds.bbci.co.uk requests, zero non-200/304 requests among 35 fresh-load requests, and Console zero messages. Usage, Activity and Fund Flow rendered without console/form diagnostics. Admin Overview, API status, Users, AI Models, Documents, Website and AI Personas checked without the reported form warnings; model controls expose descriptive accessible names and persona composer exposes Message as UPSC. Chrome identified four decorative KPI labels during verification; changed them to styled div captions and repeated build/lint/tests/browser checks.

No admin save, refresh, upload, paid chat, permission or user-data mutation was performed. This is a focused diagnostic verification, not a full WCAG/screen-reader certification or all possible form-state test. Local Chrome evidence is stored outside Git in the browser-audit-20261019 artifact directory (fixed-football-chrome.png, fixed-admin-chrome.png).

## Release and rollback

Release only these scoped commits from a82bab875521d17712a9cbb72313ce177d755946 after Chrome verification. No migration or Supabase function deployment required. Rollback target is the preceding Vercel production deployment dpl_CQLJLMk6xsmCD9WzHLMGZ7qWCnDY, or revert the scoped frontend commits; no data rollback needed. Verify exact commit and production Chrome smoke after release. Shared task/razorpay-plan files remain untouched.

Verified code commits: 2593b09 (BBC) and a19e2a8 (form/admin semantics).

## Production verification

Published release commit 4a0c98109da97caba1fe312c8e9db056dfde7df5. Vercel deployment dpl_CmCWdRkJMWcskCJqPpABbCdqx7UY reports READY, production, exact commit, and www.nter.pro/nter.pro aliases with no alias error.

Chrome signed-in production smoke passed: Football Wire 216 stories, zero direct BBC RSS requests and zero console messages; Usage, Activity, Fund Flow and all seven admin views inspected. Admin AI model controls expose descriptive labels; persona composer exposes Message as UPSC. Documents rendered Records, Documents without a record, Upload and Ingest jobs. The remaining entries under the non-200/304 Network filter are successful 204 No Content preflights, not failures. No paid request, admin save or production data mutation performed. Screenshots production-fixed-football.png and production-fixed-admin.png are in the same external evidence directory.

CI run 39299397746 was still executing at the production smoke check; local full suites already passed. The explicit-team deployment-list connector returned 403 and the Vercel CLI was absent; project/deployment reads by exact IDs succeeded and verified the deployment. No credentials or access settings changed.
