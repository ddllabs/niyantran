# F218 implementation and release plan

> **Status: Living.** Created 2026-10-17. Sequential work, no delegation.

Spec: [F218 contract](../specs/2026-10-17-f218-stored-summary.md).
Tracking: [open-work](open-work.md), F218. Branch `task/f218-stored-summary`.

1. Record the live-first/store-first mismatch and add failing router-level
   regression tests in `src/lib/globalLandingApi.test.js`. Mock only external
   fetch with synthetic service configuration and stored RPC envelopes. Run
   real routers, store reader and summary projection. No real service calls.
2. Route only the Satellite summary through `serveFeatureFeedStoredFirst` in
   `api/router.js` and `server/featureFeed.mjs`; preserve store provenance in
   `server/globalLandingSummary.mjs`. No interface removals or new dependencies.
   Re-run the new guard separately with each router restored to prove coverage.
3. Run `npm test -- src/lib/globalLandingApi.test.js src/lib/feedServe.test.js
   src/lib/feedStoreRows.test.js src/lib/globalLandingSummary.test.js`, complete
   `npm test`, `deno test -A --config supabase/functions/deno.json supabase/functions`,
   `npm run lint`, `npm run build`, `npm run check:bundle`, router import and
   `git diff --check`. Node commands use the existing no-dotenv preload, which
   prevents local environment file reads. No local SQL change/container needed.
4. Review every diff for scope, security, count/provenance and fallback behavior.
   Commit and push the task branch; require green CI (including disposable SQL)
   before merging main. Push main to the verified DDL Labs Vercel project
   `prj_6UiaDz2rkTOmqIOaXnCAs92V7d86`, production target. Check READY and exact
   commit, public GETs, browser summary rendering and bounded runtime errors.
5. Record execution/release evidence in
   `docs/research/2026-10-17-f218-stored-summary-evidence.md`; compare the attached
   orientation list in `docs/research/2026-10-17-orientation-closure-comparison.md`.
   Move F218 to Done with its verified code hash. Retain T15 until real scheduled
   windows pass; report before any payment work. Do not touch corpus ingestion.
