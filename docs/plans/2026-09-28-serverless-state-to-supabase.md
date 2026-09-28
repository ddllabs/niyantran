# Plan: move serverless state from `/tmp` to Supabase

> **Status: Living.** Proposed 2026-09-28. Not approved. Nothing here may be
> dispatched until the owner approves the spec and the phase in question.

**Spec:** `docs/specs/2026-09-28-serverless-state-to-supabase.md`

## Global constraints

- **Work sequentially,** one `task/<slug>` branch per task. Each task
  depends on the guard from T0, so there is no concurrency.
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

### T0 — durability guard (no behaviour change)

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
  - `server/db.mjs` (dev-only or removed)
  - the T0 test (`KNOWN_OFFENDERS` must be empty)
  - docs
- **Done when:**
  - the spec's acceptance evidence is complete;
  - the owner-run preview shows values surviving a redeploy;
  - this plan and the spec are marked Historical.

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
