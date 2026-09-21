# Niyantran Terminal (NTER)

> **Status: Living.** Local implementation and deployment status are separate.

Niyantran Terminal is a React/Vite intelligence workbench with desk datasets,
external feeds, Supabase authentication, document retrieval and citation UI,
local API plugins, hosted API functions, administration and billing integrations.

## Local setup

Use the project-approved Node/npm environment and Deno for Edge Function tests.
Install dependencies with `npm ci`. Configure an ignored `.env.local` using
`.env.example` as a variable-name reference; placeholder values are not working
credentials. Vite loads local server plugins during configuration, so even a
build needs the authentication configuration expected by those plugins.

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

There is no declared lint, standalone type-check or CI command. SQL regression
files under `supabase/tests/` are for disposable local databases with the required
Auth stubs and migrations; do not execute write fixtures against production.
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

Project specs and plans live under `docs/` in the owner's checkout. They are
intentionally ignored and are not included in developer clones. `AGENTS.md`
defines the coordination and verification requirements.

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

`AUTH_EMAIL_PROVIDER` selects `SUPABASE_NATIVE` (the code default) or `RESEND_API`.
Native delivery depends on Supabase's configured email service/templates. Resend
uses server-side link generation and `RESEND_API_KEY`/`RESEND_FROM_EMAIL` with a
verified sender. Administrative helpers accept the modern secret-key variable;
some startup diagnostics still refer to the legacy variable name and require
review before changing modes. Configure `APP_URL`/`SITE_URL` and the Supabase
redirect allowlist for the actual host. Do not infer successful email delivery
from the selected mode or a successful build; real delivery remains a launch
check. No production provider mode is asserted by this README.

## AI, corpus and citations

`VITE_AI_BACKEND` selects the legacy or Supabase AI path. Recovery work for the
streaming research path is still under review; setting a flag does not deploy
an Edge Function. Provider credentials stay server-side. The owner-selected
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

Local recovery contains security and corpus-integrity changes that have not yet
been applied to the live Supabase project. At the 2026-09-21 audit, live migration
history ended at 0011. Streaming recovery, authenticated browser acceptance,
email delivery and Vercel configuration remain release checks. Consult the
owner's recovery plan for current evidence rather than treating local tests as
production verification.

Do not push, deploy, apply migrations, retry ingestion or publish data without
the owner's exact authorization. Billing/provider tests can incur costs; use
fakes and disposable local targets for development verification.
