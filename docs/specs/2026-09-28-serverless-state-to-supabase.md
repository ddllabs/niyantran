# Spec: move serverless state from `/tmp` to Supabase

> **Status: Living.** Proposed 2026-09-28 and approved by the owner phase by
> phase the same day (see "Decisions for the owner"). Billing, analytics,
> user data and deployment config are sensitive scopes (AGENTS.md), so each
> phase needed the owner's explicit go-ahead before it was
> dispatched. When a phase lands, record it here; when all phases land, mark
> this spec Historical.
>
> **State on 2026-09-29:** S1–S7 have landed (T1, T2, T4 in wave 1; T3
> `e2aad15`; T5 `19d25e6`; T6 `7160391`). Only T7, the close-out, remains. It
> is tracked as C3 in `docs/plans/open-work.md` (remove the SQLite
> `entry_briefs` tier and `server/db.mjs`, and remove `sql.js` from
> `vercel.json` and `package.json`), blocked on the owner's check of the local
> SQLite files (D5 below; O4 in `open-work.md`).

## Current state (evidence)

Code reading at `ca73200`, plus a read-only query of the live `NTER` project on
2026-09-28:

- `vercel.json` sends every `/api/*` request to one function, `api/router.js`.
  ADR 0010 wired more `server/*.mjs` handlers into it, so these handlers now
  run in production.
- `server/writableRoot.mjs` resolves `writablePath()` to `/tmp/niyantran` on a
  serverless host. On Vercel that directory is per instance and is lost on
  cold starts. `server/db.mjs` keeps a sql.js SQLite file there.
- ADR 0005 (`niyantran-conflict-audit-and-plan/01-decisions-adr-0005.md`)
  says: nothing durable is written to `/tmp`, SQLite or local files on a
  serverless host, and `/tmp` may hold only data that is safe to lose.
- The live project has none of the tables or buckets this state would need.
  `storage.buckets` is empty.

Inventory of every store written under `writablePath()`:

| # | Store | Written by (route) | Client module | Kind | Target |
|---|---|---|---|---|---|
| S1 | SQLite `user_prefs` | `server/userPrefsApi.mjs` (`/api/user-prefs`, caller-authenticated) | `src/lib/userPrefsSync.js` | durable, per user | `public.user_preferences` |
| S2 | SQLite `analytics_events` | `server/analyticsApi.mjs` (`/api/analytics/*`) | `src/lib/productAnalytics.js` | durable, append-only | `public.analytics_events` |
| S3 | SQLite `users` + `issued-users.json` | `server/usersApi.mjs` (`/api/users`, admin) | `src/lib/userStore.js` | durable, duplicates identity | retire; Supabase Auth + `public.user_profiles` |
| S4 | `app-flags.json` | `server/appFlags.mjs` (`/api/app-flags`) | `src/lib/appFlagsStore.js` | durable, global | `public.app_flags`, or retire (decision D2); both files and the route were deleted when the flag was retired (`9e7a125`) |
| S5 | `marketing-intro-video.json` + uploaded file | `server/marketingMediaApi.mjs` (`/api/marketing/intro-video`) | `src/lib/marketingIntroVideo.js` | durable, global, binary | Storage bucket + `public.app_flags` row |
| S6 | SQLite `invoices` | `server/billingApi.mjs` (`/api/billing/*`) | `src/lib/billing.js` | durable, legal record (GST tax invoice) | `public.invoices` + invoice-number allocator |
| S7 | `nter-news.json` | `server/nterNews.mjs` (`/api/news/ingest`) | `src/lib/homeStatic.js` (read) | durable, global | the table agreed in `plans/2026-09-23-home-feeds-plan.md` |
| C1 | SQLite `entry_briefs`, `desk-briefs/*.json` | `server/deskBrief.mjs` | `src/lib/deskBrief.js` | cache | stays a cache (allowed) |
| C2 | `stat1.xlsx` / JSON cache | `server/budgetStat1.mjs` | — | cache | stays a cache (allowed) |

## Problem

On Vercel, every durable store above silently loses data:

- A preference save, an analytics event or an issued invoice is visible
  only to the instance that wrote it, and only until that instance is
  recycled.
- Invoice numbers are derived from a row count in that ephemeral file, so
  they can repeat across instances. That is not acceptable for a tax
  invoice.
- The `users` table duplicates identity that Supabase Auth owns, which
  contradicts ADR 0005's single identity authority.

Several of these routes also need an authorization review before they
handle real data. The findings are kept out of this public document and
shared privately.

## Expected outcome

1. No handler reachable from `api/router.js` writes durable data under
   `writablePath()`. Only C1 and C2 may remain, and they are documented as
   caches.
2. Each durable store has a Supabase table (or Storage bucket) with RLS.
   Its write path runs either as the caller (RLS enforced), or server-side
   with the `sb_secret_…` key behind an explicit authorization check.
3. The public HTTP contracts the browser uses stay the same wherever
   possible, so client changes are minimal. Where a contract must change,
   the phase says so.
4. `server/db.mjs` is no longer imported by any router-reachable handler.
   It may remain as a dev-only convenience until removed. `sql.js` leaves
   the `includeFiles` of `api/router.js` in `vercel.json`.

## Acceptance evidence

- **A regression guard,** a Vitest test that fails if any module statically
  reachable from `api/router.js` imports `server/db.mjs` or calls
  `writablePath()` with a key outside an explicit cache allow-list. It must
  be shown to **fail at `ca73200`** before it is relied on (AGENTS.md
  vacuity rule).
- **One `supabase/tests/` fixture per new migration,** covering owner
  isolation, anonymous denial and admin-only reads as applicable. Each one
  passes `npm run test:sql`, including the VACUITY check.
- **Tests stay green:** `npm test`, the Deno suite (for any `supabase/`
  change) and `npm run build`.
- **The router still loads:** `node -e "import('./api/router.js').then(()=>console.log('ok'))"`.
- **Durability on a preview deployment:** a value written on one request is
  read back after a redeploy, which forces a cold start. This runs only once
  the owner has applied the migrations and deployed.

## Design by store

- **S1, user preferences.**
  - Table: `public.user_preferences (user_id uuid primary key references
    auth.users on delete cascade, watchlist jsonb, ai_chats jsonb, tours
    jsonb, updated_at timestamptz)`. (Corrected 2026-09-28: `ai_chats` is no
    longer used. `/api/user-prefs` has ignored it since `f05a5b6`, its values
    were cleared at the owner's direction (`7f6fb11`), and the column is kept
    for now so an older build can still roll back; preferences sync the
    watchlist and tours only.)
  - RLS: select, insert and update only where `user_id = auth.uid()`; no
    delete, and no `anon` access.
  - The `/api/user-prefs` handler keeps its contract and swaps SQLite for a
    Supabase client built from the caller's bearer, so RLS does the owner
    check a second time.
  - Size bounds on each JSON field. Today there is only a 2.5 MB bound on
    the whole request body; per-field bounds are new.
  - Existing SQLite rows are not migrated: on Vercel they are already gone,
    and locally they are dev data.
- **S2, analytics.**
  - Table: `public.analytics_events (id bigint generated always as identity,
    name text, props jsonb, session_id text, user_id uuid null, created_at
    timestamptz)`.
  - No client-facing RLS policies; inserts go through the server with the
    secret key.
  - The handler stops storing a caller-supplied `userEmail`. It records
    `user_id` only when a verified bearer is present.
  - Reads (`/events`, `/summary`) become internal-admin only, using the
    existing `authorizeLocalUser(..., { admin: true })`.
  - Bounds on `name` and `props` size. Retention is decision D3.
- **S3, users.**
  - `/api/users` stops keeping its own user list.
  - GET (admin) returns rows from `public.user_profiles`, read with the
    secret key after the admin check.
  - PUT is replaced by narrow admin actions (activate or deactivate, plan)
    that update `user_profiles`.
  - No password or seed account is stored anywhere. This closes the
    backlog's "seed accounts" item together with the client-side gate work
    in integration plan Phase 2.3.
  - `userStore.js` changes accordingly; this is the one phase with a
    material client change.
- **S4 and S5, app flags and the marketing video.**
  - Table: `public.app_flags (key text primary key, value jsonb,
    updated_at, updated_by uuid)`.
  - Select is open to `anon` and `authenticated` on the columns `key`,
    `value` and `updated_at` for every row, because both GET routes are
    public by design; `updated_by` stays server-only (corrected
    2026-09-28 to match T4). Writes go through the route after an
    internal-admin check.
  - The intro video moves to a public-read Storage bucket (`marketing`,
    50 MB limit). `storage.objects` has no client policy: public files
    are served by URL, and a read policy would only allow listing.
  - Vercel caps request bodies at about 4.5 MB, so the upload uses a
    server-issued signed upload URL; the route writes only the metadata
    row.
- **S6, invoices.** This scope needs explicit billing authorization.
  - Table: `public.invoices`, owned by `user_id`, with the GST fields
    already in the SQLite schema.
  - Invoices are issued only by a `security definer` RPC that locks a
    per-financial-year counter row and allocates the next number, so
    numbers are unique and gap-free.
  - RLS: a user selects only their own invoices; there are no client
    writes.
  - Issuance happens only after `/api/billing/verify` has checked the
    Razorpay signature.
  - The demo invoice path is disabled in production.
  - Plans and entitlements stay out of scope (identity-boundaries spec,
    "Organisations and billing").
- **S7, nter.news.** This store waits on the schema discussion in the
  home-feeds plan. Until that is agreed, the owner chooses whether the
  production ingest route returns 503 (explicitly unavailable) or keeps
  its current lossy behaviour (decision D4).
- **C1 and C2** stay as caches. Deploying the `desk-brief` Edge Function is
  tracked separately in the backlog and is not part of this spec. (Corrected
  2026-09-28: `desk-brief` is deployed, now v2, and `server/deskBrief.mjs`
  forwards the caller's bearer to it; its SQLite `entry_briefs` tier is what
  T7 removes.)

## Scope

- **May be modified:**
  - `server/{userPrefsApi,analyticsApi,usersApi,appFlags,marketingMediaApi,billingApi,nterNews}.mjs`
  - `server/db.mjs`: dev-only narrowing and removal of the migrated tables
  - `api/router.js` and `vercel.json` (`includeFiles` only)
  - the matching `src/lib/*` client modules listed in the inventory, and
    their tests
  - new files under `supabase/migrations/` and `supabase/tests/`
  - docs
- **Excluded:**
  - applying migrations to `NTER`, deploying, or changing Vercel settings
    (all owner actions)
  - `backup/` and `public/data/`
  - organisations, plans and entitlements
  - the research-chat path
  - the desk-brief Edge Function deployment
  - home-feeds tables other than what S7 needs after D4

## Decisions for the owner

**Status 2026-09-28:** S1, S2, S4 and S5 are implemented on
`task/serverless-state-to-supabase` (T1, T2 and T4). They are merged to
`main` and `dev`, deployed to production, and their migrations have been
applied to `NTER`. S3, S6 and S7 have since landed too: T3 (`e2aad15`), T5
(`19d25e6`) and T6 (`7160391`). Only T7 remains.

**Recorded 2026-09-28 (owner):**

- **D1:** wave 1 approved: T1 (user preferences), T2 (analytics) and T4
  (app flags and marketing video), including their user-data and analytics
  scopes. T3 (users) is approved to follow wave 1. T5 (invoices) is **not**
  yet approved. (Later on 2026-09-28 the owner approved T5 and T6; see
  `specs/2026-09-28-t5-invoices-to-supabase.md` and
  `specs/2026-09-28-t6-nter-news-to-supabase.md`.)
- **D2:** keep the testing-phase flag and move it to Supabase
  (`public.app_flags`) in T4. (Reversed later on 2026-09-28: the owner
  retired the flag, `9e7a125`; `public.app_flags` stays for the marketing
  intro video.)
- **D3:** keep analytics events for 180 days, deleted by a nightly `pg_cron`
  job.
- **D4, D5:** open. (D4 was decided later on 2026-09-28: build a small
  table, which T6 did. D5 remains open and gates T7; it is O4 in
  `plans/open-work.md`.)

The original questions:


- **D1:** approve the phase order in the plan, and each sensitive phase
  (S3 users, S2 analytics, S6 billing) individually.
- **D2:** keep the "testing phase" app flag (ADR 0005 said it was not
  taken, yet it shipped), or retire it and the S4 table with it.
- **D3:** the retention period for analytics events (proposal: 180 days,
  enforced by `pg_cron`).
- **D4:** nter.news in production before the home-feeds schema is agreed:
  return 503, or keep today's lossy behaviour.
- **D5:** confirm that no data needs recovering from any SQLite file. Local
  dev files only; Vercel's are already gone.

## Risks

- **Supabase load.** Analytics inserts add write load to a Nano-tier
  instance that already struggles under bulk loads (coordination.md). Batch
  events on the client and bound their rate on the server.
- **Anonymous analytics.** Anonymous analytics inserts through a public
  route can be abused. The server must bound the name, the payload size and
  the rate.
- **A changed users flow.** The move away from `users` alters admin
  screens. `src/admin/` changes need both test suites (AGENTS.md).
