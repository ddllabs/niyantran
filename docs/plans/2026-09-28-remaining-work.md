# Plan: remaining work after 2026-09-28

> **Status: Living.** Written 2026-09-28 by the supervising agent using the
> agent-skills `planning-and-task-breakdown` workflow. Tasks move to Done
> here as they land. The open backlog stays in
> `niyantran-conflict-audit-and-plan/04-open-backlog.md`; this plan orders
> the part of it we intend to do next.

## Overview

On 2026-09-28 the product is on one branch (`main`), and production matches
it:

- Vercel `niyantran-six.vercel.app` runs `93684e7`.
- Supabase NTER has 29 migrations and runs on the 2 GB compute.

Research chat with citations, desk briefs, the model registry, per-account
personas, the Supabase-backed state stores and the analytics rate limit all
work on production. This plan covers what is left: close today's loose
ends, harden what shipped, finish the serverless-state move (T5–T7), settle
the open product questions, and prepare the nter.pro launch.

## Architecture decisions already in force

- Supabase is the only durable store (ADR 0005). Nothing durable lives
  under `/tmp` on Vercel. `src/lib/serverlessDurability.test.js` enforces
  this, with a known-offender list that may only shrink.
- Every model call goes through Supabase Edge Functions to OpenRouter
  (ADR 0008). Vercel holds no provider key.
- `main` is the only long-lived branch. Work happens on `task/<slug>`
  branches. Production deploys from `main`; every pushed branch gets a
  Vercel preview.
- The persona is read per turn from `user_profiles.persona`, with
  `analyst.md` as the fallback. Signup now saves the pick.

## Task list

Sizes: S = 1–2 files, M = 3–5 files. Each task gets its own `task/`
branch and short spec, and each behaviour change gets a test that fails
first. Every task runs `npm test` and `npm run build`. Tasks touching
`src/lib/`, `src/admin/` or `supabase/` also run the Deno suite, and SQL
changes run `npm run test:sql`.

### Phase A: close today's loose ends (no decisions needed)

- [ ] **A1. Standard redeploy of `research-chat` (S, owner's local session).**
  *Update 2026-09-28 17:34 UTC:* v32 serves `main` at `93f31e6` (probe
  included) through the pinned-commit entry, verified by a 401 probe. Left:
  the CLI deploy, so the dashboard shows the real files.
  - Version 30 was deployed through a one-line entry that imports
    `supabase/functions/research-chat/index.ts` from GitHub at the pinned
    commit `93684e7`. The bytes are verified identical to the repo, but it
    is non-standard, and its startup was not confirmed in the logs.
  - Redeploy with `supabase functions deploy research-chat --no-verify-jwt`
    from `main`.
  - *Accept:* a new version is ACTIVE, `verify_jwt` is off, the dashboard
    shows the real files, and one chat turn succeeds.
- [ ] **A2. Academic end-to-end (XS, owner).**
  - The owner switches their own account to Academic from the profile
    menu's "Change persona" and asks one question.
  - *Accept:* the answer opens with RESEARCH QUESTION / EVIDENCE /
    CHRONOLOGY, and the `model_call_logs` row is `success`.
- [x] **A3. Record the day in the docs (S).** Done 2026-09-28 (`agents/coordination.md`, "Operations — 2026-09-28").
  - The research-chat deploy, the five test-account personas, the
    compute upgrade, and this plan's links.

**Checkpoint A:** chat works on the standard deploy; the docs match
production.

### Phase B: hardening (no product decision needed)

- [x] **B1. Security review of the six `SECURITY DEFINER` RPCs that
  `authenticated` can execute (S).** Done 2026-09-28: all six are safe;
  see `docs/specs/2026-09-28-authorization-review.md`.
  - Confirm each one checks `auth.uid()` or is harmless.
  - Document `research_turns` as service-role only.
  - *Accept:* a SQL fixture for any fix; the advisor list is explained
    line by line.
- [x] **B2. Authorization review of the routes `api/router.js` exposes (M).**
  Done 2026-09-28. The billing reads were fixed in T5. The review found and
  fixed unauthenticated source fetching that could reach internal addresses.
  One open hardening item (the unused `/api/auth/*` group) went to the owner.
  - The private security note already exists. Known finding:
    `GET /api/billing/invoices?email=` and `GET /api/billing/invoice/:id`
    have no authentication, so anyone can read an invoice (GSTIN, address)
    by guessing an email. `POST /api/billing/invoice` (the demo record) is
    also open.
  - *Accept:* every route is listed with its check; the billing reads
    require the owner's bearer or an admin (folded into C1 if T5 is
    approved first).
- [x] **B3. Stop `npm test` rewriting `public/data/news.json` and
  `markets.json` (S).** Done 2026-09-28.
  - The home snapshot cache moved to `writablePath('home-snapshots')` (a
    gitignored `tmp/` locally), so the dev server no longer dirties the
    seeds either. `conflict.json` was also being rewritten.
  - *Accept:* `git status` is clean after `npm test`.
- [x] **B4. The STAT-1 cache stops writing into the app directory (S).** Done 2026-09-28 (`writablePath('stat1.json')`, the committed file stays as the seed).
  - `server/budgetStat1.mjs` writes `public/data/…` and swallows the
    failure on Vercel. It moves to a `writablePath` cache key (it is a
    cache) and the guard's allow-list gains that key.
  - *Accept:* the guard test covers it; no write under `public/`.
- [x] **B5. `server/loadEnv.mjs` stops reading `nter/.env` (XS).** Done 2026-09-28.
- [x] **B6. A CI gate on GitHub Actions (M).** Added 2026-09-28 (`.github/workflows/ci.yml`); it also fails if tests modify `public/`.
  - It runs `npm ci`, `npm test`, `npm run build`, the router import and
    the Deno suite on every push and pull request, plus a job that starts
    the two Postgres containers and runs `npm run test:sql`.
  - *Accept:* a red run blocks nothing yet (advisory) but is visible on
    every commit.

**Checkpoint B:** CI is green on `main`; the security review is written
down.

### Phase C: needs owner decisions (see Open questions)

- [x] **C1. T5, invoices to Supabase (M).** Done 2026-09-28 (`19d25e6`, migration `20260928140000_invoices` applied live); spec `specs/2026-09-28-t5-invoices-to-supabase.md`.
  - A table with RLS: the owner can read their own invoices; the
    service role writes.
  - GST invoice numbers come from a sequence, so they are unique and
    gapless per financial year.
  - The billing reads require authentication.
  - The demo `POST /api/billing/invoice` is refused in production.
  - *Accept:* a SQL fixture covering own-row reads and the numbering, the
    route tests, and one guard offender removed.
- [x] **C2. T6, nter.news to Supabase (M).** Done 2026-09-28 (`7160391`, migration `20260928150000_nter_news_articles` applied live). Waiting on the owner: `NTER_TERMINAL_API_KEY` on Vercel, and nter.news pointed at production.
  - A small `nter_news_articles` table (upsert by article id, keep the
    latest 200) fed by `POST /api/news/ingest`.
  - `NTER_TERMINAL_API_KEY` is added to Vercel, and nter.news pushes to
    the production URL. Today the key is missing on Vercel, so every
    push is refused.
  - *Accept:* an ingested article appears on the Home "Latest" rail after
    a cold start; one guard offender removed.
- [ ] **C3. T7, close out the serverless move (M).** After C1 and C2:
  - remove the SQLite `entry_briefs` cache tier from `server/deskBrief.mjs`;
  - delete `server/db.mjs`;
  - empty `KNOWN_OFFENDERS`;
  - mark the serverless-state spec and plan Historical.
- [x] **C4. The admin persona probe tests the persona it names (S–M).** Code done 2026-09-28 (`8a21133`, Deno tests green). Live only after the A1 redeploy: version 30 predates it.
  - `research-chat` accepts a `persona_probe` field only when the caller
    is a platform admin (checked server-side) and otherwise ignores it.
  - `AdminPersonaChat` sends it.
  - *Accept:* a Deno test where an admin probe gets the named prompt and a
    non-admin's probe is ignored.
- [x] **C5. Ask accounts with no persona to choose one (S).** Done 2026-09-28.
  - On sign-in, a profile with a null persona sees the persona chooser
    once. The chooser already saves to the profile.
  - The chooser had never been rendered anywhere, so it was also added to
    the profile menu ("Change persona", with "Keep my current persona" to
    back out) and recoloured to the light theme.
- [x] **C6. The testing-phase flag (S).** Retired 2026-09-28.
  - Live had no `testing_phase` row, so the flag had always been off and
    retiring it changes nothing users see.
  - Removed: the admin toggle, `/api/app-flags`, the Vite plugin, the
    browser store and every branch reading it (desk locks, export, row
    caps, the single-tier pricing and signup pages, the model picker).
  - The `app_flags` table stays: it also holds the marketing intro video.
  - A free testing period, if wanted later, belongs in the server-side plan
    checks required before payments, not in a browser-read flag.
- [x] **C7. UI decisions (S each).** Done 2026-09-28.
  - The hero shows the bright spinning `globe.png` again (the walkthrough
    poster keeps the GIF).
  - The Watchlist and Feed health were never removed; they sat at the
    bottom of the right rail, below the first screen. They now sit right
    under Live Latest.
  - Live TV crashed the whole terminal on open (a hook after an early
    return in `LiveTvModal`). Fixed, with a hook-count test. Its chrome is
    recoloured to the light tokens, and the player stays dark.
  - The signup question was not answered, so signup is unchanged.
  - Home hero globe: bright globe vs the dimmer animated GIF.
  - Signup: plan on the first page vs a second step.
  - Terminal Home: restore the watchlist and feed health vs keep the
    nter.news section.
  - Live TV window: review and recolour if it is dark.

**Checkpoint C:** the guard's offender list is empty; the open product
questions are closed.

### Phase D: launch (owner prerequisites)

- [ ] **D1. Supabase dashboard settings (owner, XS each).**
  - Turn on leaked-password protection.
  - Authentication URL configuration: add `https://niyantran-six.vercel.app`
    now, and nter.pro later.
  - Confirm the Storage global upload limit is at least 50 MB.
- [ ] **D2. nter.pro cutover** (integration plan Phases 4–6):
  - point DNS at this Vercel project;
  - set up the Google OAuth client for the production domain;
  - check email delivery (E1);
  - add nter.pro to `ALLOWED_ORIGINS`;
  - clean up the old upstream setup.
- [ ] **D3. E2 live round.**
  - Five paid-model scenarios plus a cross-account denial check.
  - Needs an admin account and a second ordinary account.
- [ ] **D4. Retire the legacy AI path (M).**
  - `VITE_AI_BACKEND=legacy`, the legacy panel branch, `/api/ai/chat` once
    C4 moves the admin probe to `research-chat`, and the unused
    `server/personas.mjs`.
- [x] **D5. A rollback runbook for Vercel and Supabase (S).** Done 2026-09-28: `docs/agents/rollback-runbook.md`.

**Checkpoint D:** nter.pro serves this build; the live round passes.

## Order and parallelism

- A comes first.
- The B tasks are independent and could run in parallel. The default is
  sequential: B2 before C1, then B3, B4 and B5, then B6.
- C1 and C2 are independent once decided; C3 needs both.
- C4 before D4.
- D2 depends on the owner's domain and OAuth prerequisites.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Invoice numbering must be legally sequential (GST) | High | Postgres sequence per financial year, tested in a fixture; never derive the number from a row count |
| Billing reads are open today | High | B2/C1 put auth on them first; Razorpay is not configured on Vercel, so no live invoices exist yet |
| Previews share the live Supabase project | Medium | Test writes only on test accounts; document it for every preview |
| Deploying an Edge Function by hand drifts from the repo | Medium | Standard CLI deploys (A1); pinned-commit deploys only in an emergency |
| No CI | Medium | B6 |

## Owner decisions (2026-09-28)

1. **T5:** approved. Invoices move to Supabase, with auth on the billing
   reads (C1).
2. **T6:** build the small `nter_news_articles` table (C2). The owner
   adds `NTER_TERMINAL_API_KEY` on Vercel and points nter.news at
   production.
3. **D5:** check the local SQLite files before deleting SQLite (C3).
   - This cloud checkout's `tmp/niyantran.sqlite` holds only test data
     (0 users, invoices, analytics and preferences; 10 cached briefs).
   - The owner's machine and the other worker's machine still need
     checking.
4. **Admin persona probe:** fix it (C4).
5. **Testing-phase flag:** retire it, with its table and admin toggle
   (C6).
6. **Accounts with no persona:** prompt once at sign-in (C5).
7. **UI (C7):**
   - bring back the bright globe;
   - restore the watchlist and feed health below nter.news on Terminal
     Home;
   - review Live TV;
   - keep the two-step signup.
8. **CI (B6):** approved, advisory at first.
