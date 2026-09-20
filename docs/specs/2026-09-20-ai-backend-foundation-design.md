# AI backend foundation — Design

**Date:** 2026-09-20
**Module id:** `ai-backend-foundation`
> **Status:** Normative — an open design, binding on its implementation plan.
> Becomes Historical (dated) when the plan is executed and verified.

**Origin:** The application is a frontend shell. Its AI path has no database,
no authentication provider, no vector store and no configured key
(`docs/research/2026-09-20-ai-path-audit.md`). The Supabase project `NTER`
exists with six tables, no edge functions and no `vector` extension
(`docs/research/2026-09-20-supabase-baseline.md`). The owner has decided that
Supabase is the backend and that OpenRouter is the model gateway
(`docs/decisions/0001`, `0002`). This module lays the ground that the three
capability modules stand on. It ships no user-visible AI behaviour.

## Capability map

The initiative bundles four independently testable capabilities. Each gets
its own spec under `docs/specs/`, its own plan under `docs/plans/`, and a
write scope disjoint from the others.

| Module id | Responsibility | Depends on |
|---|---|---|
| `ai-backend-foundation` | schema, `vector`, auth boundary, edge-function skeleton, model registry and pricing refresh, telemetry tables, secrets, backend flag | — |
| `document-rag-and-citations` | ingestion, `chunk_commit`, `match_documents`, the `search_documents` tool, `text` citations and the reader pane | foundation |
| `desk-row-grounding` | the `search_desk_rows` tool and its JSON-backed implementation, `row` citations, selected-row injection kept | foundation |
| `streaming-research-agent` | the agent loop, OpenRouter streaming, SSE, reasoning ticker, the `AiPanel` send path, model picker, failover, repair | foundation, and both tool contracts |

Build order: `ai-backend-foundation` → `document-rag-and-citations` and
`desk-row-grounding` (concurrent; disjoint scopes) → `streaming-research-agent`.

## Decisions

Recorded from the owner's answers, 2026-09-20:

1. **Supabase Edge Functions host all new server code.** Vercel keeps the
   static site and the existing `api/ai/*` functions unchanged until a
   separate retirement task. (`docs/decisions/0001`)
2. **One gateway, one key.** OpenRouter for chat and embeddings;
   `OPENROUTER_API_KEY` in Supabase secrets only. (`docs/decisions/0002`)
3. **Corpus global, conversations per user, no organisation columns.**
   (`docs/decisions/0003`)
4. **Conversations and messages are two tables**, as in the owner's other
   product, without its entity/agent columns.
5. **Chat history moves server-side.** The `localStorage` store remains for
   the legacy path only.
6. **Nothing that works today breaks.** A build-time flag,
   `VITE_AI_BACKEND` (`legacy` | `supabase`, default `legacy`), selects the
   path. The legacy path is not edited by any module of this initiative.
7. **Credits and metering are deferred**, but `cost_usd` and token usage are
   logged on every model call from the first deploy, so metering can be
   switched on later without backfill.
8. **Model pricing is refreshed from OpenRouter on a schedule**, ported
   from the owner's other project; the registry of offered models lives in
   code with a client mirror.

## What the owner receives

After this module: a Supabase project with the `vector` extension, the
complete AI schema under RLS, a deployed `health` function that proves
authentication and the database from end to end, a `refresh-model-pricing`
function on a schedule, the application able to obtain a Supabase session,
and a flag that keeps the legacy AI path as the default. Ask AI behaves
exactly as it does today.

**Named limitation:** with the flag on `legacy` — the default — nothing is
visibly different. The value of this module is that the three capability
modules can be built and verified against real infrastructure without
touching what exists.

## Design

### A. Auth boundary

The edge functions authenticate callers by Supabase JWT. Today no user has
one (`ai-path-audit` §7). This module adds the client:

- `@supabase/supabase-js` as a dependency; `src/lib/supabaseClient.js`
  exporting one client built from `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` (both public by design).
- When `VITE_AI_BACKEND=supabase`, the marketing `LoginPage` and `SignupPage`
  call `supabase.auth.signInWithPassword` / `signUp` and, on success, populate
  the existing `sessionUser()` shape so every consumer of `userStore.js`
  keeps working. The existing `handle_new_user` trigger already creates the
  `user_profiles` row. Persona chosen at signup is written through the
  existing `update_my_onboarding_profile` RPC using the canonical mapping in
  §E.
- When the flag is `legacy`, login is unchanged.
- Signup normalises the email for uniqueness: a `email_normalised` column on
  `user_profiles` (lower-cased, Gmail `+suffix` and dots stripped) with a
  unique index, set by the `handle_new_user` trigger. A collision raises,
  which aborts the `auth.users` insert. **Ask first** — see Open questions.

**Open question, decision-gating for the plan:** the nine Supabase users
were created outside this repository. If Supabase Auth is already wired in a
branch or a Lovable build the supervisor has not seen, that wiring is adopted
and this section shrinks to the session bridge. If not, this section stands.

### B. Schema

One migration per concern under `supabase/migrations/`, applied with
`supabase db push`. Sketches below fix names and shapes; the plan carries the
exact DDL, grants and indexes. `extensions.vector` is the type's real
schema on Supabase; migrations set `search_path` accordingly.

```sql
create extension if not exists vector with schema extensions;

-- Corpus (owned by document-rag-and-citations; created here so RLS is complete)
create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  source_key       text not null unique,      -- Niyantran's stable file identity
  title            text not null,
  file_name        text,
  file_url         text,
  desk_tier        text,                      -- 'national' | 'law' | …
  desk_feature     text,                      -- module name when known
  content_sha256   text not null,             -- of ocr_text
  ocr_text         text not null,             -- the text itself lives here (owner decision)
  page_count       int,                       -- null until page-wise Markdown
  chunker_version  int,
  indexed_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.document_chunks (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.documents(id) on delete cascade,
  chunk_hash       text not null,
  chunk_index      int  not null,
  source_kind      text not null default 'document',   -- 'document' | 'pdf_page'
  page_number      int,                                -- nullable anchor
  char_from        int  not null,
  char_to          int  not null,
  content          text not null,                      -- exactly ocr_text[char_from:char_to]
  token_count      int,
  embedding        extensions.vector(1536),
  chunker_version  int  not null,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  unique (document_id, chunk_hash)
);
create index document_chunks_embedding_hnsw
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index document_chunks_document_order on public.document_chunks (document_id, chunk_index);

-- Desk snapshot (owned by desk-row-grounding)
create table public.desk_rows (
  tier         text not null,
  feature      text not null,
  row_key      text not null,
  row          jsonb not null,
  record_text  text not null,           -- flattened columns for text search
  snapshot_at  timestamptz not null,
  loaded_at    timestamptz not null default now(),
  primary key (tier, feature, row_key)
);
create index desk_rows_row_gin on public.desk_rows using gin (row jsonb_path_ops);

-- Conversations (owned here)
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title            text not null default 'New research',
  desk_tier        text,
  desk_feature     text,
  model_id         text,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.chat_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null default auth.uid(),
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  sources          jsonb not null default '[]',   -- CitationSource[]
  follow_ups       jsonb not null default '[]',
  activity         jsonb not null default '[]',   -- persisted ticker trace
  model_requested  text,
  model_served     text,
  reasoning_effort text,
  status           text not null default 'complete'
                   check (status in ('complete', 'error', 'cancelled', 'truncated')),
  error_message    text,
  turn_key         text,                          -- idempotency claim, user turns only
  usage            jsonb,                         -- tokens and cost_usd
  timing           jsonb,                         -- search_ms, reasoning_ms, writing_ms, total_ms
  created_at       timestamptz not null default now(),
  unique (conversation_id, turn_key)
);
create index chat_messages_conversation_order on public.chat_messages (conversation_id, created_at);

create table public.chat_cancellations (
  conversation_id      uuid primary key references public.conversations(id) on delete cascade,
  user_id              uuid not null default auth.uid(),
  cancel_requested_at  timestamptz not null default now()
);

-- Telemetry (owned here; written by the service role)
create table public.model_call_logs (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  user_id                   uuid,
  conversation_id           uuid,
  message_id                uuid,
  caller                    text not null,     -- 'research-chat' | 'ingest-documents' | 'repair'
  purpose                   text not null,     -- 'chat_answer' | 'embedding' | 'citation_repair'
  model_requested           text,
  model_served              text,
  provider                  text,
  status                    text not null check (status in ('success', 'error', 'aborted')),
  error_message             text,
  latency_ms                int,
  prompt_tokens             int,
  completion_tokens         int,
  total_tokens              int,
  cached_prompt_tokens      int,
  reasoning_tokens          int,
  cost_usd                  numeric(12, 6),
  openrouter_generation_id  text,
  raw_usage                 jsonb
);

create table public.chat_turn_traces (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  user_id            uuid,
  conversation_id    uuid,
  message_id         uuid not null,
  step_index         int  not null,
  step_type          text not null
                     check (step_type in ('search_documents', 'search_desk_rows', 'reasoning', 'answer')),
  input              text,
  result_count       int,
  top_similarity     numeric,
  latency_ms         int,
  chunk_ids          uuid[],
  row_keys           text[],
  model_call_log_id  uuid references public.model_call_logs(id) on delete set null,
  aborted            boolean not null default false,
  error_message      text
);

-- Pricing (ported shape)
create table public.model_pricing (
  model_id                text primary key,
  context_length          int,
  max_completion_tokens   int,
  prompt_usd              numeric,
  completion_usd          numeric,
  cache_read_usd          numeric,
  cache_write_usd         numeric,
  internal_reasoning_usd  numeric,
  supported_parameters    text[],
  is_available            boolean not null default true,
  fetched_at              timestamptz not null default now()
);
```

**Row-level security**, all tables enabled:

| Table | `authenticated` | writes |
|---|---|---|
| `documents`, `document_chunks`, `desk_rows`, `model_pricing` | `select using (true)` | service role only |
| `conversations`, `chat_messages`, `chat_cancellations` | select / insert / update / delete where `user_id = auth.uid()` | same |
| `model_call_logs`, `chat_turn_traces` | `select using (user_id = auth.uid())` | service role only |

`anon` is granted nothing.

Two RPCs are **declared** here so the capability modules can be dispatched
against a fixed signature, and **defined** in their owning module:
`match_documents(query_embedding, match_count, p_document_ids, p_desk_tier)`
and `chunk_commit(p_document_id, p_rows, p_keep_hashes)` in
`document-rag-and-citations`; `search_desk_rows(p_tier, p_feature, p_query,
p_filters, p_limit)` in `desk-row-grounding`.

### C. Edge-function skeleton

```
supabase/
  config.toml
  migrations/
  functions/
    _shared/
      cors.ts          # preflight + headers, allowed origins from env
      auth.ts          # requireUser(req) → { userId, token } or 401
      supabase.ts      # userClient(token) and serviceClient()
      logging.ts       # structured log lines; never a secret, never a key
      models.ts        # the registry (contents fixed by streaming-research-agent)
      chatStream.ts    # the SSE frame union and sender (used by research-chat)
    health/index.ts
    refresh-model-pricing/index.ts
```

`health` (GET, JWT required) returns
`{ ok, version, vector: boolean, registry_sha, pricing_rows, user_id }`. It
is the verification gate for the whole module: it proves the JWT is
verified, the caller's `auth.uid()` reaches the database, `vector` is
installed, and the registry deployed matches the client mirror (`registry_sha`
is compared by the frontend at startup and logged if different).

`refresh-model-pricing` (POST, service role or a shared header secret,
never the browser) fetches OpenRouter's model catalogue, upserts
`model_pricing`, and marks rows absent from the catalogue `is_available =
false`. Scheduled by `pg_cron` calling it through `pg_net` every six hours;
the schedule is a migration.

The registry (`_shared/models.ts`) is the authority (`docs/decisions/0002`).
`src/lib/aiModels.js` is its mirror, generated by
`scripts/sync-ai-registry.mjs` and checked by a test that fails when the two
diverge.

### D. Backend flag and client wiring

- `src/lib/aiBackend.js`: `export function aiBackend()` returns `'supabase'`
  only when `import.meta.env.VITE_AI_BACKEND === 'supabase'`; otherwise
  `'legacy'`.
- The flag is read in exactly two places: the auth pages (§A) and
  `AiPanel.jsx`'s send path (owned by `streaming-research-agent`). Nothing
  else branches on it.
- `.env.example` gains `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_AI_BACKEND=legacy`. `supabase/.env.local` (gitignored) holds
  `OPENROUTER_API_KEY` for `supabase functions serve`.
- `.gitignore` gains `supabase/.env.local`, `supabase/.temp/` and `ingest/`
  — the last is the corpus staging folder `document-rag-and-citations`
  reads from, ignored here so that module never touches `.gitignore`.

### E. Persona mapping

One canonical map, `src/lib/personaMap.js`, mirrored into
`supabase/functions/_shared/personaMap.ts` by the sync script:

| `app_persona` (database) | frontend id | prompt file |
|---|---|---|
| `policy_analyst` | `policy` | `policy.md` |
| `journalist` | `journalist` | `journalist.md` |
| `upsc_aspirant` | `student` | `student.md` |
| `corporate_affairs` | `analyst` | `analyst.md` |
| `legal_researcher` | `lawyer` | `lawyer.md` |
| `academic` | `academic` | `student.md` (until `academic.md` exists) |

`personas.js` and `userTypes.js` are not edited; the map is a lookup beside
them.

### F. Testing and verification

The repository has no test runner (`docs/agents/coordination.md`). This
module introduces two, deliberately:

- **Deno's built-in runner** for edge functions: `deno test supabase/functions`.
  No dependency.
- **Vitest** for `src/`: `npm test`. One devDependency. **Ask first** — see
  Open questions. Every later module pins frontend behaviour here.

Verification, each an execution:

1. `supabase db reset` against a shadow database applies every migration
   from empty; `select extname from pg_extension where extname = 'vector'`
   returns one row.
2. `health` returns 200 with a valid JWT and 401 without. **Vacuity:**
   remove the `requireUser` call, observe the 401 test fail by name, restore.
3. RLS: with two test users, user A's `select` on `conversations` returns
   only A's rows after B has inserted one. Executed with two real sessions.
4. `refresh-model-pricing` populates `model_pricing` (`count(*) > 0`), and
   the cron job appears in `cron.job`.
5. Registry parity: the mirror test passes; edit one label in the mirror,
   observe it fail, restore.
6. With `VITE_AI_BACKEND` unset: `npm run build` passes with the same two
   baseline warnings, and the legacy login and Ask AI placeholder behave as
   today in a real browser.
7. With `VITE_AI_BACKEND=supabase`: signup creates an `auth.users` row and a
   `user_profiles` row with the chosen persona; a plus-aliased duplicate is
   refused (if Open question 2 is approved).

### G. Commands

```bash
npm ci && npm run build                                   # existing baseline
npm test                                                  # vitest (new)
deno test supabase/functions                              # edge-function tests (new)
supabase link --project-ref vfgcppstyzjarlzyqdac
supabase db push                                          # apply migrations
supabase functions serve --env-file supabase/.env.local   # local functions beside `vite`
supabase functions deploy health refresh-model-pricing    # owner authorises each deploy
curl -sS -H "Authorization: Bearer $JWT" "$VITE_SUPABASE_URL/functions/v1/health"
```

## Write scope

`supabase/` (new tree), `docs/`, `package.json` and lockfile
(`@supabase/supabase-js`, `vitest`), `.env.example`, `.gitignore`,
`src/lib/supabaseClient.js`, `src/lib/aiBackend.js`, `src/lib/personaMap.js`,
`src/lib/aiModels.js` (generated), `scripts/sync-ai-registry.mjs`,
`src/marketing/LoginPage.jsx`, `src/marketing/SignupPage.jsx`,
`src/lib/userStore.js` (session bridge only).

**Not touched:** `server/`, `api/`, `src/ai/`, `src/desks/`, `src/shell/`,
`src/admin/`, billing, `backup/`, `public/data/`, `public/legacy/`.

## Boundaries

- **Always:** run `npm run build`; apply schema only through files in
  `supabase/migrations/`; keep every secret out of the tree; answer CORS
  preflight in every function.
- **Ask first:** adding any dependency; any change to an enum or to
  `user_profiles`; any `supabase functions deploy` or `db push` against the
  live project — each is a production action the owner authorises.
- **Never:** edit the legacy AI path; commit `.env` or `supabase/.env.local`;
  push, open a pull request, or change remotes.

## Accepted consequences

- Two runtimes (Node for Vite, Deno for functions) and two test runners.
- The corpus, desk snapshot and telemetry tables exist before anything
  writes to them; they are empty until their modules run.
- Registry contents are code; adding a model is a deploy. That is the price
  of the server being the authority.
- Email normalisation, if approved, is a behaviour change at signup for a
  product with nine test accounts.

## Out of scope

- Any user-visible AI behaviour (the three capability modules).
- Retiring `api/ai/*` and `server/aiApi.mjs`; reconciling `README.md`.
- Credits, quotas, caps. Organisations. Plan enum reconciliation (`gov`,
  `professional`): recorded as Open question 3, decided by the owner
  separately.
- Migrating existing `localStorage` chats to the server.

## Open questions

1. **Is Supabase Auth already wired somewhere?** Decides the size of §A.
2. **Email normalisation at signup** (§A) — approve, defer, or drop.
3. **`app_plan` enum vs the frontend's `gov` and `pro`** — out of scope here,
   but the owner should decide before billing moves server-side.
4. **Vitest** as the frontend test runner — approve the dependency.
5. **`refresh-model-pricing` cadence** — six hours proposed.
