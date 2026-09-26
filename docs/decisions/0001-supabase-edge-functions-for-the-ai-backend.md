# ADR 0001: Supabase Edge Functions host the AI backend

> **Status:** Normative — accepted 2026-09-20. Binds every server-side AI and
> retrieval component until superseded by a later ADR.

## Status

Accepted.

## Context

The application has no backend. In development, `vite.config.js` mounts
thirteen middleware plugins from `server/`; in production, `vercel.json`
ships four Node functions under `api/ai/` and nothing else
(`docs/research/2026-09-20-ai-path-audit.md` §6). There is no database, no
authentication provider and no vector store behind any of them.

The database for the product is the Supabase project `NTER` in `ap-south-1`
(`docs/research/2026-09-20-supabase-baseline.md`). A retrieval turn is many
database round trips — embed, match, load history, write the answer, log the
call — and the agent loop repeats retrieval several times per turn.

The reference implementation being adopted
(`docs/research/2026-09-20-tenderbase-reference-patterns.md`) is written for
the Deno edge runtime: `npm:` and `https:` imports, `Deno.serve`,
`EdgeRuntime.waitUntil`.

## Decision

All new server-side AI code — the chat handler, retrieval, ingestion, the
model gateway, telemetry — is implemented as **Supabase Edge Functions** under
`supabase/functions/`, deployed to the `NTER` project.

Vercel continues to host the static frontend and the existing `api/ai/*`
functions **unchanged** until the new path is verified. The browser selects
the backend with a build-time flag (`VITE_AI_BACKEND`, values `legacy` |
`supabase`, default `legacy`), so nothing that works today stops working
while the new path is built. Retiring the legacy path is a separate,
later task with its own spec.

## Alternatives considered

**Vercel Functions for the AI path.** Same host as the frontend, familiar.
Rejected: the functions would run in a different region from the database
unless pinned, and every RPC in a multi-search turn pays that round trip; the
Supabase JWT would have to be verified by hand rather than by the platform;
the current `maxDuration` of 60 s is tight for a broad multi-search turn; and
the Deno reference code would need a transport rewrite for no functional
gain.

**A separate long-running server (Node or Python).** Full control, no edge
limits. Rejected for now: a fourth deployment surface with its own
operations, for a product that has none today. If tool execution ever needs
a long-lived process (a Python agent runtime was mentioned as a possible
later direction), that is a new ADR.

**Keep the Vite plugins and make them deployable.** Rejected: they are
development conveniences with no auth, no database and no deployment story.

## Consequences

- Server code is Deno: `npm:` specifiers, no `require`, `Deno.env` for
  secrets. Secrets live in Supabase project secrets, never in `VITE_`
  variables and never in the repository.
- Functions verify the caller's Supabase JWT; the caller's `auth.uid()` is
  therefore available to RLS. Every function that touches user data runs
  under the caller's token where possible and under the service role only
  for ingestion and telemetry writes.
- Edge functions are called cross-origin from the Vercel-hosted app, so every
  function must answer CORS preflight. The Supabase URL and anon key are
  public by design and may be `VITE_` variables.
- Local development runs `supabase functions serve` beside `vite`; the
  `supabase` CLI and a project link are prerequisites and must be documented
  in the foundation plan's verified commands.
- Edge functions have wall-clock and CPU limits. Long turns keep generating
  after a client disconnect only through `EdgeRuntime.waitUntil`; the
  handler must never rely on the request staying open.
- Two deployment targets exist. That is accepted for the duration of the
  cutover and reviewed when the legacy `api/ai/*` path is retired.
