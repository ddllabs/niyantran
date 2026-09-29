# ADR 0005 — One codebase: ddllabs/niyantran on Supabase, upstream integrated once

Status: **Normative.** Accepted 2026-09-24 by the owner. Extends ADR 0001 and ADR 0002.

## Context

- The product was built in two streams that forked at `570c3f1` (2026-09-19):
  - `ddllabs/niyantran` `main`: 152 commits. Supabase Auth, Postgres, Edge Functions, RAG, streaming research.
  - `ItsCloudDev/niyantran` `main` (upstream): 27 commits, all on 2026-09-21. UI work, a Vercel catch-all API router, Google sign-in on local SQLite, a Gemini-only testing phase.
- www.nter.pro is deployed from upstream by a Vercel project that DDL Labs cannot access.
- ItsCloudDev has left, so upstream will receive no further commits.
- Upstream stores durable data (accounts, app flags, nter.news articles) in SQLite and files under `/tmp` on Vercel. That storage is lost on cold starts and is not shared between instances. Production therefore has no durable user store.

## Decision

1. **`ddllabs/niyantran` `main` is the only codebase.**
   - `upstream/main` is integrated **once**, by a reviewed merge (03-upstream-integration-plan.md).
   - After that the `upstream` remote is kept read-only for reference and is never synced again.
   - The private `ddllabs/NTER` repository and its `nter/` layout are **not** adopted.
2. **Supabase is the system of record** for identity, profiles, conversations, corpus and telemetry.
   - Nothing durable is written to `/tmp`, SQLite or local files on a serverless host.
   - `/tmp` may hold caches only: data that is safe to lose.
   - The local SQLite (`server/db.mjs`) remains a dev-server convenience until each of its uses is retired or moved to Supabase.
3. **OpenRouter is the only gateway for every LLM call.**
   - This includes the legacy server paths (`server/aiApi.mjs`, `server/deskBrief.mjs`), which today call Gemini and DeepSeek directly.
   - Upstream's Gemini-only testing phase is not adopted.
4. **Authentication is Supabase Auth only.**
   - Google sign-in uses Supabase's native Google provider, with a Google OAuth client owned by DDL Labs.
   - Upstream's server-side ID-token exchange (`server/googleAuth.mjs`, `google-auth-library`) and its local-seat accounts are not adopted.
5. **Hosting:**
   - Vercel serves the static app and the non-AI API routes through a single catch-all function (`api/router.js`, taken from upstream). This keeps within the Hobby plan's function-count limit.
   - The research agent and ingestion stay on Supabase Edge Functions (ADR 0001).
   - Production moves to a Vercel project owned by DDL Labs, built from `ddllabs/niyantran` `main`.

## Consequences

- **No production accounts carry over.** Upstream's password accounts lived only in each visitor's browser, and its Google accounts in ephemeral `/tmp`. Users re-register on Supabase Auth.
- **The new Vercel project's environment variables must be rebuilt from code,** because the old project's settings are unrecoverable. The inventory is in the integration plan.
- **nter.news keeps working from the committed seed file.** Its write path (`POST /api/news/ingest`) needs a Supabase table before it can be durable. That schema is part of the Home-feeds schema discussion (docs/plans/2026-09-23-home-feeds-plan.md).
- **ADR 0001's "two deployment targets during the cutover" continues,** but the legacy AI routes must route through OpenRouter.
- **Retiring the legacy AI path still needs its own spec** (ADR 0001).

## Amendment (2026-09-29)

Checked against the code on 2026-09-29. The decision and consequences above
are kept as written; these statements in them are no longer true.

- **"Production therefore has no durable user store"** (Context). Production
  now keeps its durable stores in Supabase: preferences, analytics, the
  intro video and app flags (T1, T2, T4), accounts (T3, local users store
  retired in `e2aad15`), invoices (T5, `19d25e6`) and nter.news articles
  (T6, `7160391`).
- **"The legacy server paths ... today call Gemini and DeepSeek directly"**
  (Decision 3). The legacy AI path was retired in `14b2344` (D4). No code
  under `server/`, `api/` or `src/` calls Gemini or DeepSeek directly; every
  model call goes through OpenRouter from an Edge Function.
- **"nter.news keeps working from the committed seed file ... needs a
  Supabase table"** (Consequences). It has one: `public.nter_news_articles`
  (`7160391`). The seed file is only a fallback when the table is empty or
  unreachable.
- **"ADR 0001's two deployment targets ... legacy AI routes"** and
  **"Retiring the legacy AI path still needs its own spec"**
  (Consequences). The legacy AI retirement is done (D4, `14b2344`).
- **"The `upstream` remote is kept read-only"** (Decision 1). It was removed
  after the 2026-09-26 merge; `origin` is the only remote (`AGENTS.md`).

Still true: SQLite remains in one place, the `entry_briefs` cache tier of
`server/deskBrief.mjs` (through `server/db.mjs`). Removing it is C3 in
`docs/plans/open-work.md`.
