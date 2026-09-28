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

### T3 — S3 retire the local users store — **dispatched 2026-09-28 on `task/t3-retire-local-users`**

Task spec: `docs/specs/2026-09-28-t3-retire-local-users.md`. It fixes the
`PATCH /api/users/:userId` interface, the removal of the seed accounts and
local passwords, and the rule that `sessionUser()` returns null.


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

## Wave 1 dispatch (fixed 2026-09-28, before implementation)

- **Integration branch:** `task/serverless-state-to-supabase` (T0 plus this
  prep). Each task has its own branch and a supervisor-created worktree,
  and is merged back here only after review.

  | Task | Branch | Migration | Fixture |
  |---|---|---|---|
  | T1 | `task/t1-user-preferences` | `20260928100000_user_preferences.sql` | `user_preferences.sql` |
  | T2 | `task/t2-analytics-events` | `20260928100100_analytics_events.sql` | `analytics_events.sql` |
  | T4 | `task/t4-app-flags-and-media` | `20260928100200_app_flags_and_marketing_media.sql` | `app_flags_and_marketing_media.sql` (plus `bootstrap_storage.sql`, a stub `storage` schema for plain Postgres) |

- **SQL harness.** `supabase/tests/run.sh` already registers all three
  fixtures. The chain is the least-privilege chain plus
  `20260921115831_research_turn_persistence.sql`, then the task's migration.
  The default fixture list is now discovered from the directory. A new
  migration must not depend on the 2026-09-22 migrations; a task that needs
  one reports it instead.
- **Fixed server interfaces, consumed unchanged:**
  - `authorizeLocalUser` and `localClientForToken` (`server/usersApi.mjs`)
    for caller checks and caller-scoped clients;
  - `getSupabaseAdminClient` (`server/authEmailProvider.mjs`) for
    secret-key writes.
  Handlers take injectable dependencies for tests, as `userPrefsApi.mjs`
  already does with `deps.clientForToken`.
- **Shared file:** `src/lib/serverlessDurability.test.js`. Each task
  deletes only its own `KNOWN_OFFENDERS` lines.
- **Parallel-safe verification:** a task runs `./supabase/tests/run.sh
  <its fixture>`, never the whole harness, because the three worktrees
  share the two containers. The supervisor runs the full harness when
  integrating.

## Wave 1 result (2026-09-28)

T1, T2 and T4 ran in parallel. Each was reviewed and re-verified by the
supervisor, then cherry-picked onto the integration branch in plan order:
T1 `631be0f`, T2 `ae74aca`, T4 `c4b72e9`. The only conflict was the
expected one in the guard's `KNOWN_OFFENDERS`, resolved by keeping both
deletions. The list went from 10 entries to 6.

- **Supervisor changes during review:**
  - T1: the nine preference tests in `src/lib/localUserAuthorization.test.js`
    exercised SQLite mocks. They were ported to an RLS-applying Supabase
    fake, keeping every test and its intent; none was removed. Two
    ownership probes each failed them.
  - T4: the first draft's `storage.objects` read policy let anyone list
    the public bucket. It was removed after the fixture was tightened to
    forbid listing and failed against it.
- **Integration evidence (executed):**
  - `npm test` 743/743 (46 files).
  - The Deno suite 415 passed.
  - `npm run build` passed (295 modules).
  - The router imports.
  - `npm run test:sql`: all 8 fixtures pass, each with vacuity.
- **Follow-ups from wave 1** (also in the backlog):
  - T2:
    - no rate limit on anonymous event POSTs (it needs a design that
      works across Vercel instances);
    - `src/lib/productAnalytics.js` sends no bearer, so `user_id` stays
      null, and it still queues `userEmail` locally;
    - events rejected with 400 are retried forever from the client
      queue;
    - the `pg_cron` branch has not run in any test database.
  - T1: merge-upsert semantics are proven in SQL but not through
    PostgREST itself.
  - T4:
    - `server/aiApi.mjs` reads the testing-phase flag synchronously from
      an in-process copy that starts at the defaults on a cold instance;
      it should await `fetchAppFlags()`;
    - `src/lib/apiVerification.test.js`'s "state persistence" case no
      longer tests persistence;
    - `src/admin/AdminSitePages.jsx` still says 120 MB;
    - upload progress is now reported in steps;
    - the signed-URL flow has not been run against real Storage;
    - the dev server needs `SUPABASE_SECRET_KEY`, or the flag and video
      GETs return 503 (the clients fall back to defaults).

## Wave 1 rollout (2026-09-28, owner-authorised)

- **Merged:** `main` and `dev` point at `8d9ffe2`. Vercel auto-deployed
  `main` to production (`niyantran-six.vercel.app`, deployment `READY`).
- **Migrations applied to `NTER`** through the Supabase MCP tools, in
  order: `20260928100000_user_preferences`, `20260928100100_analytics_events`,
  `20260928100200_app_flags_and_marketing_media`.
  - The tool stamps each migration with the time it was applied, so each
    recorded version was then set to the repo file's version.
  - The live history now has 27 entries and equals `supabase/migrations/`
    exactly, so `supabase db push` has nothing pending.
- **Verified live (read-only queries):**
  - RLS is on for all three tables, and the policies and grants match the
    migrations.
  - `analytics-events-retention` is scheduled at `17 3 * * *`.
  - The `marketing` bucket is public, with a 50 MB limit and four video
    types.
- **Security advisors after the change:** the only new finding is an INFO
  that `analytics_events` has RLS enabled and no policy. That is intended:
  it is server-only, like `research_turns`.
- **Vercel:** `SUPABASE_SECRET_KEY` was already set for production and
  preview.
- **Production smoke test:**
  - `GET /api/app-flags` returns 200 with defaults read from Supabase,
    which also proves the secret key works;
  - `GET /api/marketing/intro-video` returns 200;
  - `GET /api/user-prefs` and `GET /api/analytics/summary` return 401
    without a session;
  - no 5xx responses in the 45 minutes after the deploy.
- **Not verified:**
  - the project's global Storage upload limit against the 50 MB bucket;
  - a real signed-in preference save, an admin flag toggle and a video
    upload (these need an admin session);
  - no analytics event had arrived yet when checked.

## Owner actions between tasks

- **After each migration task is accepted and merged:** apply the migration
  to `NTER` (`supabase db push`), then run `get_advisors` for security.
- **Before the first `db push` (done 2026-09-28):** rename
  `20260922183000_reasoning_efforts_from_catalogue.sql` to the live version
  `20260922121946`. Otherwise the push re-runs that migration and resets
  `ai_models.efforts` (backlog §0).
- **To take wave 1 live, in order (steps 1–3 and 5 done 2026-09-28; see
  "Wave 1 rollout"):**
  1. ~~Merge the migration-version rename below.~~ Done 2026-09-28.
  2. `supabase db push` the three wave-1 migrations.
  3. Run the security advisors.
  4. Confirm the project's global Storage upload limit against the
     bucket's 50 MB.
  5. Set `SUPABASE_SECRET_KEY` on Vercel.
  6. Run a preview smoke test: save preferences, reload after a
     redeploy, toggle a flag as an admin, and upload the video.
- **Before the route changes go live:** set `SUPABASE_SECRET_KEY` (an
  `sb_secret_…` key) in the Vercel environment. `server/` also still reads
  the legacy `SUPABASE_SERVICE_ROLE_KEY` name in two places; T1 should settle
  on one name.
