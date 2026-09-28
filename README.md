# Niyantran Terminal (NTER)

> **Status: Living.** Local implementation and deployment status are separate.

Niyantran Terminal is a React/Vite intelligence workbench with desk datasets,
external feeds, Supabase authentication, document retrieval and citation UI,
local API plugins, hosted API functions, administration and billing integrations.

## Local setup

Use the project-approved Node/npm environment and Deno for Edge Function tests.
Install dependencies with `npm ci`. Configure an ignored `.env.local` using
`.env.example` as a variable-name reference; placeholder values are not working
credentials. A production build needs no environment variables (checked on
2026-09-28 by building with none set; CI builds the same way). The dev server's
local API plugins read `.env.local` for the routes they serve.

```bash
npm run dev -- --host 127.0.0.1
npm run build
npm test
deno test -A --config supabase/functions/deno.json supabase/functions
```

The development server uses port 5173 with strict-port behavior. Its configured
host is network-visible unless overridden as above. `npm run preview` previews
the built application; it does not establish that development API plugins are
available in a production host.

There is no declared lint or standalone type-check. `.github/workflows/ci.yml`
runs the build, both test suites and the SQL fixtures on every push; it is
advisory, and nothing is blocked on it. `npm run test:sql` runs the fixtures in
`supabase/tests/` against two disposable local Docker Postgres containers with the
required Auth stubs and migrations; never run them against production.
Build warnings about a large bundle and mixed static/dynamic imports remain.

## Application structure

| Path | Responsibility |
| --- | --- |
| `src/` | Browser application, marketing, internal administration and AI UI |
| `server/` | Vite API plugins and server-only integration helpers |
| `api/` | Hosted API entry points; verify their actual host configuration |
| `supabase/functions/` | Edge Functions and shared AI/retrieval code |
| `supabase/migrations/` | Versioned database changes; presence does not mean applied |
| `supabase/tests/` | Database authorization and integrity regression checks |
| `scripts/` | Explicit maintenance, source-mapping and ingestion tools |
| `public/data/` | Tracked data collections; preserve their provenance |

Project specs, plans and architecture notes live under `docs/`, tracked in git
since 2026-09-27 (`f828ef5`); `docs/security/` stays local only. Start with
`docs/START-HERE.md`. `AGENTS.md` defines the coordination and verification
requirements.

## Authentication and configuration

Ordinary accounts use verified Supabase identity and active profile state.
Personas are preferences. Internal administrator access belongs to the operating
team and must be independently verified; browser flags and cached directory
entries are not authorization. Profile/security migrations must be deployed
before relying on the repaired policies in a live environment.

Browser configuration uses `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`; the latter accepts the project's publishable key despite
its historical variable name. Server configuration uses `SUPABASE_URL`,
`SUPABASE_ANON_KEY` where a public client is needed, and `SUPABASE_SECRET_KEY`
for explicitly privileged operations. The project disabled legacy JWT API keys;
do not restore one as a fallback. Never expose a secret through `VITE_` variables.

The browser signs up, signs in, resends verification and resets passwords
through Supabase Auth directly, so account email in production is whatever
Supabase's configured email service and templates send. Configure the Supabase
redirect allowlist for the actual host. `/api/auth/*` is not served in production
(removed 2026-09-28, `93f31e6`). `server/authApi.mjs` is still mounted by the Vite
dev and preview servers only; there, `AUTH_EMAIL_PROVIDER` selects
`SUPABASE_NATIVE` (the code default) or `RESEND_API`, which uses server-side link
generation, `RESEND_API_KEY`/`RESEND_FROM_EMAIL` and `APP_URL`/`SITE_URL`. Do not
infer successful email delivery from a successful build; real delivery remains a
launch check.

## AI, corpus and citations

Research chat goes from the browser to the `research-chat` Edge Function, the
only AI path since the legacy `/api/ai/chat` path and its `VITE_AI_BACKEND`
switch were retired on 2026-09-28. Provider credentials stay server-side. The owner-selected
citation-repair model is applied only during an authorized rollout.

Document OCR and embeddings live in Supabase, while the source export remains
outside the repository. `scripts/ingest-national-desk.mjs` and
`scripts/build-corpus-links.mjs` are maintenance entry points, not startup steps.
Never start a bulk ingestion merely to run or test the UI. The approved first
pass excludes affidavits and the recorded oversized document.

Text citations identify stored chunks by document/chunk ID, text hash and
character offsets. A missing original URL or page boundary must remain unknown;
do not invent a PDF link or page number. A successful embedding does not prove
OCR quality or answer relevance. Source coverage and end-to-end citation behavior
are separate acceptance checks.

## Deployment status and verification

**Updated 2026-09-28.** The live Supabase project has all 31 repository
migrations applied (latest `20260928150000_nter_news_articles`) and six Edge
Functions deployed: `health`, `admin-models`, `refresh-model-pricing`,
`ingest-documents`, `desk-brief` and `research-chat`. Production on Vercel
(`niyantran-six.vercel.app`) follows `main`. Versions, the day's production
changes and open owner actions are recorded in `docs/agents/coordination.md`,
"Operations — 2026-09-28"; the remaining work is in
`docs/plans/2026-09-28-remaining-work.md`. Local tests are not production
verification.

Do not push, deploy, apply migrations, retry ingestion or publish data without
the owner's exact authorization. Billing/provider tests can incur costs; use
fakes and disposable local targets for development verification.
