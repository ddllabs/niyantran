# Plan: move serverless state from `/tmp` to Supabase

> **Status: Living.** Proposed 2026-09-28. Not approved. Nothing here may be
> dispatched until the owner approves the spec and the phase in question.

**Spec:** `docs/specs/2026-09-28-serverless-state-to-supabase.md`

## Global constraints

- **One `task/<slug>` branch per task,** named after the task (for example
  `task/t0-durability-guard`). Concurrent tasks each get a
  supervisor-created worktree. Commits carry the project identity and no
  attribution lines. T0 lands first, because every later task edits its
  list; after that, the "Execution strategy" section below decides what may
  run in parallel.
- **Nothing reaches production from a task.** Migrations are written and
  tested only against the disposable local databases of `npm run test:sql`.
  Applying them to `NTER`, deploying functions and changing Vercel
  environment settings are owner actions after review.
- **Keep secrets on the server.** The `sb_secret_…` key is read from the
  server environment only. No `VITE_` variable gains a secret.
- **Keep the browser contracts.** Every task keeps its route's request and
  response shape unless the task says otherwise.
- **Leave `backup/` and `public/data/` untouched.**

## Verification, every task

```bash
npm test
npm run build
node -e "import('./api/router.js').then(()=>console.log('ok'))"
deno test -A --config supabase/functions/deno.json supabase/functions   # when supabase/ changes
npm run test:sql                                                          # when a migration is added
```

## Tasks

### T0 — durability guard (no behaviour change) — **implemented 2026-09-28 on `task/t0-durability-guard`, awaiting owner review**

Task spec: `docs/specs/2026-09-28-t0-serverless-durability-guard.md`.


- **Write scope:** a new `src/lib/serverlessDurability.test.js`.
- **Check:** statically walk the imports reachable from `api/router.js`.
  Fail when a reachable module imports `server/db.mjs`, or calls
  `writablePath()` with a key outside the cache allow-list (`desk-briefs`,
  `stat1.xlsx`, the STAT-1 JSON cache and `entry_briefs` while it remains).
- **Expected at `ca73200`:** it fails for S1–S7. Record the failure output.
  Mark the known offenders as an explicit, shrinking `KNOWN_OFFENDERS` list
  so the suite stays green, and so a new offender still fails it.
- **Done when:** removing an entry from `KNOWN_OFFENDERS` makes the test
  fail for that store (the vacuity evidence).
- **Evidence (executed 2026-09-28 on `task/t0-durability-guard`, base `ca73200`):**
  - Baseline before the change: `npm test` 644/644; the Deno suite 415
    passed; `npm run build` passed with the known chunk-size warning; the
    router imports.
  - With `KNOWN_OFFENDERS` empty, the guard failed and named exactly 10
    offences: S1–S7, plus `server/deskBrief.mjs` importing `server/db.mjs`
    (the C1 `entry_briefs` tier) and `server/db.mjs` writing
    `niyantran.sqlite`.
  - With the list filled in, each vacuity probe failed for the expected
    reason:
    - V1, removing the S1 entry;
    - V2, appending `writablePath('probe.json')` to `server/appFlags.mjs`;
    - V3, adding a stale entry;
    - V4, changing `desk-briefs` to `desk-briefs.json` in
      `server/deskBrief.mjs`.
    All probes were reverted.
  - An independent review then found five bypasses: aliased imports,
    indirect references, raw `/tmp` or `os.tmpdir()` paths, `..` escapes
    from a cache key, and functions under `api/` other than the router.
    It also found spurious failures from commented-out imports. Each got a
    unit test that failed before the fix and passes after it. The review
    also confirmed that the walk reaches exactly the 50 modules in
    esbuild's bundle metafile for `api/router.js`.
  - Extra probes, all reverted:
    - V5, aliasing the import in `server/budgetStat1.mjs`;
    - V6, adding `os.tmpdir()` to `server/homeApi.mjs`;
    - V7, adding a probe file `api/probe.js`.
    Each failed the suite.
  - After the change: `npm test` 656/656 (41 files); the Deno suite 415
    passed; `npm run build` passed (295 modules); the router imports.
  - Side effect seen: `npm test` rewrites `public/data/news.json` and
    `markets.json` (timestamps only), through
    `src/lib/{apiVerification,segmentCarousel}.test.js` →
    `server/homeApi.mjs`. The files were restored with `git checkout` after
    each run. This is out of T0's scope; see backlog §0.

### T1 — S1 user preferences

- **Depends on:** T0.
- **Write scope:**
  - a new migration, `supabase/migrations/<ts>_user_preferences.sql`
  - a new fixture, `supabase/tests/user_preferences.sql`
  - `server/userPrefsApi.mjs`
  - its tests
  - `src/lib/userPrefsSync.js` (only if needed)
- **Interface:** `/api/user-prefs` GET and PUT, unchanged.
- **Done when:**
  - the fixture proves owner-only access and `anon` denial, and passes
    VACUITY;
  - the handler uses a caller-scoped client;
  - S1 leaves `KNOWN_OFFENDERS`.

### T2 — S2 analytics

- **Depends on:** T0 and owner decision D3.
- **Write scope:**
  - a new migration, `<ts>_analytics_events.sql`
  - a new fixture
  - `server/analyticsApi.mjs`
  - `src/lib/productAnalytics.js` (batching)
  - tests
- **Interface:** POST `/api/analytics/event`, unchanged. GET `/events` and
  GET `/summary` become internal-admin only.
- **Done when:**
  - inserts are bounded;
  - reads are rejected without an admin bearer (tested);
  - no email is stored;
  - S2 leaves `KNOWN_OFFENDERS`.

### T3 — S3 retire the local users store

- **Depends on:** T0 and the owner's sensitive-scope approval.
- **Write scope:**
  - `server/usersApi.mjs`
  - `src/lib/userStore.js`
  - `src/admin/*` where they consume `/api/users`
  - tests
- **Interface change:** `/api/users` GET returns profile rows. PUT is
  replaced by narrow admin actions, specified in the task dispatch.
- **Done when:**
  - no password or seed user exists in code or storage;
  - the admin screens work against `user_profiles`;
  - both test suites pass;
  - S3 leaves `KNOWN_OFFENDERS`.

### T4 — S4 and S5 app flags and marketing video

- **Depends on:** T0 and owner decision D2.
- **Write scope:**
  - a new migration, `<ts>_app_flags_and_marketing_bucket.sql`
  - a new fixture
  - `server/appFlags.mjs`
  - `server/marketingMediaApi.mjs`
  - `src/lib/{appFlagsStore,marketingIntroVideo}.js`
  - tests
- **Interface:** GET is unchanged. Writes require an internal-admin
  bearer. Upload becomes two steps: first request a signed URL, then PUT
  the file straight to Storage.
- **Done when:**
  - writes without an admin bearer are rejected (tested);
  - S4 and S5 leave `KNOWN_OFFENDERS`.

### T5 — S6 invoices

- **Depends on:** T0 and the owner's explicit billing authorization.
- **Write scope:**
  - a new migration, `<ts>_invoices.sql` (table, per-year counter,
    `issue_invoice` RPC)
  - a new fixture (it must prove unique, gap-free numbering under
    concurrent calls, and owner-only reads)
  - `server/billingApi.mjs`
  - `src/lib/billing.js`
  - tests
- **Done when:**
  - issuance requires a verified payment;
  - the demo path is off in production;
  - S6 leaves `KNOWN_OFFENDERS`.

### T6 — S7 nter.news

- **Depends on:** owner decision D4 and, if the table is built, the agreed
  home-feeds schema.
- **Write scope:** `server/nterNews.mjs`, its tests, and a migration and
  fixture if the table is built.

### T7 — close-out

- **Depends on:** T1–T6.
- **Write scope:**
  - `api/router.js`
  - `vercel.json` (drop `node_modules/sql.js/dist/**` from `includeFiles`)
  - `server/deskBrief.mjs` (drop the SQLite `entry_briefs` tier; the file
    and memory caches remain)
  - `server/db.mjs` (dev-only or removed)
  - the T0 test (`KNOWN_OFFENDERS` must be empty)
  - docs
- **Done when:**
  - the spec's acceptance evidence is complete;
  - the owner-run preview shows values surviving a redeploy;
  - this plan and the spec are marked Historical.

## Execution strategy: sequential, then parallel waves

- **T0 runs alone.** Every later task shrinks its list, so it has to land
  first.
- **Wave 1, parallel in separate worktrees:** T1 (preferences), T2
  (analytics) and T4 (flags and media). Their server files, client modules,
  migrations and fixtures are disjoint.
  - The only shared file is the T0 test. Each task deletes only its own
    `KNOWN_OFFENDERS` lines, so the supervisor resolves any merge by
    keeping both deletions.
  - Fixed interface: `authorizeLocalUser` in `server/usersApi.mjs` is
    consumed unchanged by T1, T2 and T4.
  - Owner gates: T2 needs D3 and T4 needs D2; T1 needs approval for its
    user-data scope.
- **Wave 2, sequential:** T3 (users) after wave 1. It modifies
  `server/usersApi.mjs`, which defines the `authorizeLocalUser` that wave 1
  consumes, and it touches `src/admin/`.
- **Independent, when authorised:** T5 (invoices) needs explicit billing
  authorization; T6 (nter.news) needs D4 and possibly the home-feeds schema.
  Neither overlaps waves 1–2, so either can run beside them.
- **Last:** T7.
- **Integration:** every task lands on the integration branch after the
  supervisor's review. `main` and `dev` are fast-forwarded together once a
  wave is verified and the owner approves the merge.

## Owner actions between tasks

- **After each migration task is accepted and merged:** apply the migration
  to `NTER` (`supabase db push`), then run `get_advisors` for security.
- **Before the first `db push`:** rename
  `20260922183000_reasoning_efforts_from_catalogue.sql` to the live version
  `20260922121946`. Otherwise the push re-runs that migration and resets
  `ai_models.efforts` (backlog §0).
- **Before the route changes go live:** set `SUPABASE_SECRET_KEY` (an
  `sb_secret_…` key) in the Vercel environment. `server/` also still reads
  the legacy `SUPABASE_SERVICE_ROLE_KEY` name in two places; T1 should settle
  on one name.
