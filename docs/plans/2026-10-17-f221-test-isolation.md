# F221 test isolation implementation plan

> **Status: Historical (2026-10-17).** Executed sequentially under owner authorization.

Spec: `docs/specs/2026-10-17-f221-test-isolation.md`.

1. Add a causal regression in `src/lib/featureFeedTimeLimit.test.js`: launch the
   real Cabinet loader under a hanging source, return archive, perform teardown,
   install a replacement fetch, cross the 12-second boundary. Demonstrate failure
   under the original teardown for both zero-call and one-call consumer patterns.
2. In that same file, dispose pending source requests, reject subsequent fallback
   requests under the same stub, await captured live promises, settle custom
   deferred loaders, then restore globals/timers and reset caches. No production
   interfaces change. Re-run the guard and unchanged preferences checks.
3. Verify with guarded Node/npm: focused timeout/preferences tests, `npm test`,
   `deno test -A --config supabase/functions/deno.json supabase/functions`,
   `npm run lint`, `npm run build`, `npm run check:bundle`, and router import.
   Review exact diff and secret boundaries; record actual outcomes.
4. Commit/push task branch under owner authorization. Require original CI app
   and SQL jobs green before fast-forwarding main and pushing. Verify exact
   production READY commit and CI; record evidence and F221 Done with hash.
   Keep hourly closure monitoring active and remaining daily gates open.

Only step 2 depends on step 1; verification precedes publication. No delegation,
forced refresh, SQL fixture against production, function deploy or payment work.

Implementation `389dbed`; local verification passed. Final release evidence is
recorded in `docs/research/2026-10-17-f221-test-isolation-evidence.md`. Remaining
M1/M2 source-observation gates remain in the sole open-work tracker.
