# AI backend foundation — Implementation plan

**Date:** 2026-09-21
**Spec:** `docs/specs/2026-09-20-ai-backend-foundation-design.md` (module id
`ai-backend-foundation`)
> **Status:** Normative — the active plan. Becomes Historical (dated) when
> every task below is verified and the supervisor has merged the branch.

**Goal:** After this plan, the Supabase project `NTER` carries the complete
AI schema under RLS with the `vector` extension, three deployed edge
functions (`health`, `refresh-model-pricing`, `admin-models`), a twelve-hour
pricing refresh, a database-held model allowlist that the admin page edits,
and Supabase Auth behind the `VITE_AI_BACKEND` flag. With the flag unset,
nothing visible changes.

**Decisions this plan executes:** ADRs `0001`–`0004`; the spec's Decisions
1–12, including the 2026-09-21 amendments (database allowlist, twelve-hour
cadence, capture-only email folding, Vitest approved, Supabase Auth not
wired anywhere).

**Branch:** `task/ai-backend-foundation`, created from `task/ai-backend-specs`
after that branch is merged to `main` locally. One branch, sequential tasks.
No worktrees.

## Global constraints

- The legacy AI path (`server/`, `api/`, `src/ai/`, `src/lib/aiModelsStore.js`,
  `src/lib/aiClient.js`, `src/lib/aiChatStore.js`) is not edited. Any task
  that finds it must edit one of those files stops and reports.
- Schema changes exist only as files under `supabase/migrations/`, applied
  in filename order. Applying to the live project is authorised by the owner
  (2026-09-21) but each apply is still announced in the return report with
  the migration name.
- Deploying a function to the live project is a production action. The
  supervisor deploys; a task agent never does.
- No secret enters the tree. `OPENROUTER_API_KEY` and `REFRESH_SECRET` live
  in Supabase function secrets, set by the owner or by the supervisor on the
  owner's instruction. `supabase/.env.local` is gitignored before it exists.
- Nothing is pushed; no PR; no remote change. Commits are made by the
  supervisor only, without attribution lines.
- "Build passed" is never reported as "tests passed". Every guard gets a
  vacuity check: restore the defect, watch the named test fail, reapply.
- **Environment facts, verified 2026-09-21:** Node v23.11.0 present. The
  Supabase CLI, Deno and Docker are **absent** on this machine. There is
  therefore no local shadow database; the evidence for each migration is
  the live apply plus the queries named in the task. Installing the CLI and
  Deno is Task 0 and needs the owner's go-ahead because it adds tooling.

## Fixed interfaces

These are fixed before any task starts. A task that needs to change one
stops and reports.

**Backend flag** — `src/lib/aiBackend.js`

```js
export function aiBackend() // 'supabase' | 'legacy' (default)
```

**Supabase client** — `src/lib/supabaseClient.js`

```js
export const supabase            // createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
export async function accessToken()  // current session JWT or null
```

**Registry reader** — `src/lib/aiRegistry.js`

```js
export async function loadRegistry()
// → { models: AiModel[], roles: AiRole[], pricingById: Record<string, Pricing> }
// models: enabled rows only, sorted by sort_order; each { model_id, label, vendor, tier, efforts, params, is_default }
export function subscribeRegistry(fn)  // fn(registry) after any admin save in this tab; returns unsubscribe
```

**Persona map** — `src/lib/personaMap.js` and `_shared/personaMap.ts`

```js
export const PERSONA_MAP = [
  { db: 'policy_analyst',   frontend: 'policy',     prompt: 'policy.md' },
  { db: 'journalist',       frontend: 'journalist', prompt: 'journalist.md' },
  { db: 'upsc_aspirant',    frontend: 'student',    prompt: 'student.md' },
  { db: 'corporate_affairs',frontend: 'analyst',    prompt: 'analyst.md' },
  { db: 'legal_researcher', frontend: 'lawyer',     prompt: 'lawyer.md' },
  { db: 'academic',         frontend: 'academic',   prompt: 'student.md' },
]
export function dbPersona(frontendId)   // → db value or null
export function frontendPersona(db)     // → frontend id or null
```

**Edge shared** — `supabase/functions/_shared/`

```ts
// auth.ts
export async function requireUser(req: Request): Promise<{ userId: string; token: string }>  // throws HttpError(401)
// supabase.ts
export function userClient(token: string): SupabaseClient
export function serviceClient(): SupabaseClient
// cors.ts
export function corsHeaders(req: Request): HeadersInit   // origins from ALLOWED_ORIGINS, comma-separated
export function preflight(req: Request): Response | null
// logging.ts
export function log(event: string, fields?: Record<string, unknown>): void   // JSON line; never logs a key or a token
// models.ts
export async function loadRegistry(): Promise<{ models: AiModel[]; roles: AiRole[] }>  // enabled only; 60 s cache per isolate
export async function resolveModel(id: string): Promise<AiModel | null>
// chatStream.ts — the SSE frame union from the streaming spec §B, TYPES ONLY in this plan; no sender yet
```

**`health`** — `GET /functions/v1/health`, JWT required

```json
{ "ok": true, "version": "<git sha or 'dev'>", "vector": true, "pricing_rows": 0, "models_enabled": 0, "user_id": "<uuid>" }
```

**`refresh-model-pricing`** — `POST`, header `x-refresh-secret` must equal
the `REFRESH_SECRET` function secret; otherwise 401. Response
`{ fetched, upserted, unavailable, disabled_models }`.

**`admin-models`** — JWT required; `is_platform_admin()` must be true,
else 403 `{ error: 'admin only' }`.

```
GET  → { models: AiModelRow[], roles: AiRoleRow[], catalogue: CatalogueRow[] }
       models/roles: every row, including disabled
       catalogue: model_pricing rows where is_available and 'tools' = any(supported_parameters),
                  fields { model_id, context_length, prompt_usd, completion_usd, supported_parameters }
PUT  body { kind: 'model', row: AiModelRow } | { kind: 'role', row: AiRoleRow }
     → 200 { row } | 400 { error }   (400 carries the trigger's message for a lock-out refusal)
```

**Email folding** — `public.normalise_email(text) returns text`, immutable:
lower-case; for `gmail.com` and `googlemail.com`, strip dots in the local
part and everything from `+`; other domains only lower-cased.

## File structure

| Path | Responsibility |
|---|---|
| `supabase/config.toml` | CLI project config (generated by `supabase init`) |
| `supabase/migrations/20260921_0001_vector_and_email.sql` | `vector`; `normalise_email`; `user_profiles.email_normalised`; trigger change; backfill |
| `supabase/migrations/20260921_0002_conversations.sql` | `conversations`, `chat_messages`, `chat_cancellations`, RLS |
| `supabase/migrations/20260921_0003_corpus_and_desk.sql` | `documents`, `document_chunks`, HNSW, `desk_rows`, RLS (tables only; RPCs come with their modules) |
| `supabase/migrations/20260921_0004_telemetry_and_pricing.sql` | `model_call_logs`, `chat_turn_traces`, `model_pricing`, RLS |
| `supabase/migrations/20260921_0005_allowlist.sql` | `ai_models`, `ai_roles`, lock-out trigger, one-default index, RLS |
| `supabase/migrations/20260921_0006_health_rpc.sql` | `ai_health()` — PostgREST cannot read `pg_extension`, so a definer probe reports it plus the counts and `auth.uid()` |
| `supabase/migrations/20260921_0007_pricing_reconcile_and_schedule.sql` | `model_pricing_reconcile(jsonb)` (atomic upsert, unavailable marking, allowlist disable) and the `pg_cron` + `pg_net` job every twelve hours; secret read from Vault |
| `supabase/migrations/20260921_0008_admin_models_rpc.sql` | `admin_models_upsert(text, jsonb)` — transactional merge upsert used by `admin-models` |
| `src/lib/supabaseAuth.js` | `signIn` / `signUp` over Supabase Auth returning the demo store's `{ ok, user | reason }` shape |
| `src/admin/AllowlistEditor.jsx`, `src/admin/allowlistEditor.js` | the flag-on branch of the admin page and its pure helpers (tested in node) |
| `supabase/functions/_shared/*.ts` | as in Fixed interfaces |
| `supabase/functions/health/index.ts` | the verification gate |
| `supabase/functions/refresh-model-pricing/index.ts` | catalogue → `model_pricing`; disables dropped allowlist rows |
| `supabase/functions/admin-models/index.ts` | the only write path to the allowlist |
| `supabase/functions/**/*_test.ts` | Deno tests beside each module |
| `src/lib/{aiBackend,supabaseClient,aiRegistry,personaMap}.js` | as in Fixed interfaces |
| `src/lib/*.test.js` | Vitest |
| `src/lib/userStore.js` | `setSessionUser` accepts a Supabase user + profile (session bridge only) |
| `src/marketing/LoginPage.jsx`, `SignupPage.jsx` | flag-on branch calls Supabase Auth |
| `src/admin/AiModelsPage.jsx` | flag-on branch is the allowlist editor |
| `.env.example`, `.gitignore`, `.claude/launch.json`, `package.json`, lockfile | as named in the tasks |

## Tasks

### Task 0 — Tooling, baseline, branch

**Owner go-ahead needed:** installs Deno and the Supabase CLI with Homebrew.

**Write scope:** `.gitignore`, `.env.example`, `.claude/launch.json`,
`supabase/config.toml`, `supabase/.gitignore` if the CLI generates one.

1. Supervisor merges `task/ai-backend-specs` into `main` locally, creates
   `task/ai-backend-foundation`.
2. Install tooling. Record the versions in the return report.

   ```bash
   brew install deno supabase/tap/supabase
   deno --version && supabase --version
   ```

3. `supabase init` (accepts defaults; no local Docker start), then
   `supabase link --project-ref vfgcppstyzjarlzyqdac` (needs the owner's
   CLI login once; the supervisor runs it with the owner present).
4. `.gitignore` gains `supabase/.env.local`, `supabase/.temp/`, `ingest/`.
   `.env.example` gains the three `VITE_` lines from the spec §D, with the
   comment that these two Supabase values are public by design.
5. Baseline: `npm ci && npm run build` — record the two baseline warnings.
6. Commit: "chore: supabase project scaffold and backend flag defaults".

**Verify:** `git status --short` shows only the listed paths; `npm run build`
passes with the baseline warnings; `supabase migration list` reaches the
project and shows the existing remote history.

### Task 1 — Migration 0001: `vector` and email folding

**Depends on:** Task 0. **Delegable:** yes.

**Write scope:** `supabase/migrations/20260921_0001_vector_and_email.sql`.

Outcome: `vector` installed in `extensions`; `normalise_email` defined;
`user_profiles.email_normalised text` added and backfilled for the nine
rows; `handle_new_user` sets it on insert. No unique index.

**Verify (executions):**

```sql
select extname from pg_extension where extname = 'vector';                       -- 1 row
select normalise_email('First.Last+trial@Gmail.com');                            -- 'firstlast@gmail.com'
select normalise_email('First.Last+trial@Example.org');                          -- 'first.last+trial@example.org'
select count(*) filter (where email_normalised is null) from public.user_profiles; -- 0
select email_normalised, count(*) from public.user_profiles group by 1 having count(*) > 1;
-- expected: the plus-aliased developer accounts collapse to one normalised value; record the count
```

The trigger is exercised in Task 8 by a real signup.

### Task 2 — Migration 0002: conversations

**Depends on:** Task 1. **Delegable:** yes.

**Write scope:** `supabase/migrations/20260921_0002_conversations.sql`.

Outcome: the three tables and indexes from spec §B, RLS enabled, four
policies per user table on `user_id = auth.uid()`, `anon` granted nothing.

**Verify:** RLS with two real user ids, simulated at the SQL level (no test
accounts are created):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<uid A>","role":"authenticated"}', true);
insert into public.conversations (title) values ('A only');
select set_config('request.jwt.claims', '{"sub":"<uid B>","role":"authenticated"}', true);
select count(*) from public.conversations;   -- 0
rollback;
```

**Vacuity:** run the same block with the select policy dropped in the
transaction; the count is 1; the transaction is rolled back either way.

### Task 3 — Migrations 0003–0004: corpus, desk rows, telemetry, pricing

**Depends on:** Task 2. **Delegable:** yes.

**Write scope:** `supabase/migrations/20260921_0003_corpus_and_desk.sql`,
`supabase/migrations/20260921_0004_telemetry_and_pricing.sql`.

Outcome: the tables from spec §B exactly, HNSW index on
`document_chunks.embedding`, GIN on `desk_rows.row`, RLS as in the spec's
table. No RPCs: `match_documents`, `chunk_commit` and `search_desk_rows` are
created by their owning modules.

**Verify:**

```sql
select indexdef from pg_indexes where indexname = 'document_chunks_embedding_hnsw';   -- contains 'hnsw' and 'vector_cosine_ops'
select tablename, rowsecurity from pg_tables where schemaname = 'public'
  and tablename in ('documents','document_chunks','desk_rows','model_call_logs','chat_turn_traces','model_pricing');  -- all true
-- as authenticated (set_config as in Task 2): insert into public.documents … → permission denied
```

### Checkpoint A — schema

- Migrations 0001–0004 applied in order; `supabase migration list` shows all
  four as applied remotely.
- Supervisor re-runs the Task 1–3 queries and records the outputs in this
  plan's verification section.
- Commit: "feat(db): AI schema — vector, conversations, corpus, telemetry".

### Task 4 — Migration 0005: allowlist and roles

**Depends on:** Checkpoint A. **Delegable:** yes.

**Write scope:** `supabase/migrations/20260921_0005_allowlist.sql`.

Outcome: `ai_models`, `ai_roles`, the partial unique index on
`is_default`, RLS (`select using (true)` for `authenticated`; no
`authenticated` write policy), and the lock-out trigger: before insert or
update on `ai_models`, when `new.enabled`, require a `model_pricing` row with
the same id, `is_available`, and `'tools' = any(supported_parameters)`;
otherwise raise `'model % is not in the OpenRouter catalogue with tool
support'`. `vendor` is set from the id prefix by the same trigger when null.
Roles reference `ai_models`; a role may not point at a disabled model
(second trigger, same file). Both tables start empty.

**Verify:**

```sql
insert into public.model_pricing (model_id, supported_parameters, is_available) values ('test/with-tools', '{tools}', true), ('test/no-tools', '{}', true);
insert into public.ai_models (model_id, label, enabled) values ('test/with-tools', 'ok', true);          -- succeeds; vendor = 'test'
insert into public.ai_models (model_id, label, enabled) values ('test/no-tools', 'bad', true);           -- raises
insert into public.ai_models (model_id, label, enabled) values ('openai/gpt-6-astra', 'ghost', true);    -- raises (the frontend placeholder)
insert into public.ai_models (model_id, label, is_default) values ('test/second', 'x', true);            -- raises: not in catalogue
delete from public.ai_models; delete from public.model_pricing where model_id like 'test/%';
```

**Vacuity:** drop the trigger inside a transaction, observe the placeholder
insert succeed, roll back.

### Task 5 — Edge shared modules and `health`

**Depends on:** Task 4. **Delegable:** yes.

**Write scope:** `supabase/functions/_shared/{cors,auth,supabase,logging,models,chatStream,personaMap}.ts`
and their `_test.ts` files, `supabase/functions/health/index.ts`,
`supabase/functions/import_map.json` or `deno.json` as the CLI expects.

Outcome: the Fixed interfaces above. `personaMap.ts` is a hand copy of the
frontend map for now; the streaming module adds the generator and parity
test. `chatStream.ts` exports types only. `health` answers preflight,
requires a user, runs `select 1 from pg_extension where extname='vector'`,
counts `model_pricing` and enabled `ai_models`, and returns the shape above.

**Verify:**

```bash
deno test supabase/functions          # auth: missing header → 401; malformed → 401; cors: preflight 204 with origin echoed only when allowed; models: cache returns the same object within 60 s and refetches after
```

Vacuity for `requireUser`: remove the call from `health`, the "401 without
token" test fails by name, restore.

Deploy and live check (supervisor, owner-authorised):

```bash
supabase functions deploy health
curl -sS -i "$VITE_SUPABASE_URL/functions/v1/health"                                   # 401
curl -sS -H "Authorization: Bearer $JWT" "$VITE_SUPABASE_URL/functions/v1/health"      # 200, vector:true, user_id = the JWT's sub
```

`$JWT` comes from a real sign-in. The owner provides one test account's
credentials or signs in once in the running app after Task 8; until then the
201 check is deferred and recorded as deferred.

### Task 6 — `refresh-model-pricing` and its schedule

**Depends on:** Task 5. **Delegable:** yes, except the secret and the deploy.

**Write scope:** `supabase/functions/refresh-model-pricing/{index.ts,_test.ts}`,
`supabase/migrations/20260921_0006_pricing_schedule.sql`.

Outcome: the function fetches `https://openrouter.ai/api/v1/models`, maps
each entry to a `model_pricing` row (`pricing.prompt`, `pricing.completion`,
`pricing.input_cache_read`, `pricing.input_cache_write`,
`pricing.internal_reasoning`, `context_length`,
`top_provider.max_completion_tokens`, `supported_parameters`), upserts in
batches of 200, marks absent rows `is_available = false`, and in the same
transaction sets `ai_models.enabled = false` for any allowlisted id now
unavailable, logging each. The migration enables `pg_cron` and `pg_net`,
stores nothing secret in SQL (the header value is read from
`vault.decrypted_secrets` by name `refresh_secret`), and schedules
`0 */12 * * *`.

**Source-driven check, recorded in the return report:** the response shape
is confirmed against a live `GET /api/v1/models` call before the mapper is
written; field names above are the expected ones, not verified ones.

**Verify:**

```bash
deno test supabase/functions/refresh-model-pricing    # mapper on a fixture; unknown-field tolerance; wrong secret → 401
supabase secrets set REFRESH_SECRET=…                 # owner-supplied value; supervisor runs it
supabase functions deploy refresh-model-pricing
curl -sS -X POST -H "x-refresh-secret: $REFRESH_SECRET" "$VITE_SUPABASE_URL/functions/v1/refresh-model-pricing"
```

```sql
select count(*) from public.model_pricing;                                          -- > 0
select count(*) from public.model_pricing where 'tools' = any(supported_parameters); -- > 0
select jobname, schedule from cron.job;                                              -- one row, '0 */12 * * *'
```

### Task 7 — `admin-models`, admin promotion, allowlist seed

**Depends on:** Task 6. **Delegable:** the function, yes; the promotion and
the seed, supervisor only.

**Write scope:** `supabase/functions/admin-models/{index.ts,_test.ts}`.

Outcome: the function in Fixed interfaces. The admin check calls the
existing `is_platform_admin()` RPC with the user's client, then switches to
the service client for the write. Lock-out refusals from the trigger are
returned as 400 with the trigger's message.

Then:

1. The owner names one account. Supervisor runs
   `update public.user_profiles set role = 'admin' where email = '<named>'`
   and records it.
2. Supervisor proposes the initial allowlist from
   `select model_id, prompt_usd, completion_usd, context_length from public.model_pricing where is_available and 'tools' = any(supported_parameters)`,
   filtered to the vendors Niyantran's picker already names (Google, OpenAI,
   DeepSeek) plus Anthropic, five to eight rows, one marked default. The
   owner approves id by id. Rows are inserted through `admin-models` PUT,
   not by SQL, so the path is exercised.
3. The four roles are inserted the same way, each pointing at an approved
   model.

**Verify:**

```bash
deno test supabase/functions/admin-models   # no JWT → 401; is_platform_admin false → 403; PUT with a trigger error → 400 with message
curl -sS -H "Authorization: Bearer $USER_JWT"  "$VITE_SUPABASE_URL/functions/v1/admin-models"   # 403
curl -sS -H "Authorization: Bearer $ADMIN_JWT" "$VITE_SUPABASE_URL/functions/v1/admin-models"   # 200, catalogue non-empty
```

```sql
select count(*) from public.ai_models where enabled;          -- the approved count
select model_id from public.ai_models where is_default;       -- exactly one
select role_id, model_id from public.ai_roles order by sort_order;   -- four rows
```

### Checkpoint B — backend

- Three functions deployed; `health` reports `pricing_rows > 0` and
  `models_enabled` equal to the approved count.
- Commits: "feat(functions): shared modules and health gate",
  "feat(functions): pricing refresh on a twelve-hour schedule",
  "feat(functions): admin-models allowlist editor".

### Task 8 — Frontend libraries, Vitest, Supabase Auth

**Depends on:** Checkpoint B. **Delegable:** yes.

**Write scope:** `package.json`, lockfile, `vitest.config.js`,
`src/lib/{aiBackend,supabaseClient,aiRegistry,personaMap}.js` and their
`.test.js`, `src/lib/userStore.js` (only: `setSessionUser` accepts
`{ supabaseUser, profile }` and maps it to the existing public-user shape;
`clearSessionUser` also calls `supabase.auth.signOut()` when the flag is
on), `src/marketing/LoginPage.jsx`, `src/marketing/SignupPage.jsx`.

Outcome: `npm test` runs Vitest. With the flag on, login calls
`signInWithPassword`, fetches the profile through `get_my_profile`, and
populates the session through the bridge; signup calls `signUp` with
`first_name`/`last_name` split from the name field in `options.data`, then
`update_my_onboarding_profile` with `dbPersona(personaId)` and
`p_onboarding_complete = true`. The plan and trial fields keep using the
existing local helpers unchanged (billing is out of scope). Error messages
from Supabase are shown in the same `setError` slot. With the flag off both
pages run the exact code they run today.

**Verify:**

```bash
npm test          # aiBackend: unset → 'legacy', 'supabase' → 'supabase', anything else → 'legacy'
                  # personaMap: every db value maps to one frontend id and back; unknown → null
                  # aiRegistry: sorts by sort_order, keeps enabled only, indexes pricing by id (mocked client)
                  # userStore bridge: a Supabase user + profile becomes a public user with the persona's frontend id
npm run build     # baseline warnings only
```

Browser, flag unset: login with the seeded student account works as today;
signup creates a local user as today. Browser, `VITE_AI_BACKEND=supabase npm run dev`:
signup with a fresh address creates `auth.users` and `user_profiles` rows;
`persona` is set; `email_normalised` is populated; a second signup with a
`+alias` of the same Gmail address succeeds and shares the normalised
value. Login with that account lands on the persona's start tab.

```sql
select email, email_normalised, persona::text, onboarding_complete from public.user_profiles order by created_at desc limit 2;
```

Vacuity: comment out the `update_my_onboarding_profile` call, the signup
test that asserts `persona` fails, restore.

### Task 9 — Admin allowlist editor

**Depends on:** Task 8. **Delegable:** yes.

**Write scope:** `src/admin/AiModelsPage.jsx`, `src/admin/AiModelsPage.test.jsx`.

Outcome: spec §D.1. The flag-on branch is a sibling component in the same
file, `AllowlistEditor`, chosen by `aiBackend()` at the top of
`AiModelsPage`; the legacy body is not re-indented or reformatted. It loads
`admin-models` GET with the session token, renders models (enable toggle,
default radio, label, tier, efforts as a comma field), an "add from
catalogue" select filtered to ids not yet listed, and the four roles as
selects over enabled models. Each save is one PUT; a 400 shows the server's
message beside the row; a 403 renders the list read-only with the message.
After a successful save it calls `subscribeRegistry` listeners.

**Verify:**

```bash
npm test          # renders read-only on 403; a 400 message appears beside the row; the catalogue select excludes listed ids
npm run build
```

Browser, flag on, admin account: enable a model, refresh, it is still
enabled; `select enabled from public.ai_models where model_id = '…'` is
true. Attempt to add a model that lacks tools (pick one from the catalogue
select that the filter should have hidden — if none is offered, the filter
is doing its job; record that). Flag unset: the page is the localStorage
editor, unchanged, verified by a screenshot compared with `main`.

### Checkpoint C — done

- All Task 1–9 verifications executed and recorded below.
- `git diff main --stat` touches only paths in the write scopes above.
- Commits: "feat(web): supabase client, backend flag, persona map, vitest",
  "feat(web): supabase auth behind VITE_AI_BACKEND",
  "feat(admin): allowlist editor behind VITE_AI_BACKEND".
- This plan's status becomes Historical (dated); `docs/agents/coordination.md`
  "Shared repository knowledge" is corrected: the `NTER` bullet now states
  the tables, functions and `vector`; a bullet records `npm test` and
  `deno test supabase/functions` as the two runners.
- Supervisor merges `task/ai-backend-foundation` into `main` locally.

## Owner inputs, in order of need

| When | Input |
|---|---|
| Task 0 | Go-ahead for `brew install deno supabase/tap/supabase`; one-time `supabase login` |
| Task 5 | A test account's credentials, or a sign-in in the running app, to mint a JWT |
| Task 6 | `OPENROUTER_API_KEY` and a `REFRESH_SECRET` value, into function secrets |
| Task 7 | The account to promote to `admin`; approval of each allowlist id and the default |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| No local shadow database (no Docker) | A bad migration lands on the live project | One concern per migration file; each reviewed by the supervisor before apply; each is reversible by a `down` block kept in the file as a comment |
| OpenRouter `/models` shape differs from the expected fields | Mapper writes nulls | Task 6 confirms the shape live before writing the mapper; the test fixture is the real response trimmed |
| `is_platform_admin()` semantics unknown (definer function, body not yet read) | Wrong accounts pass the admin check | Task 7 reads the function body first and records it; if it checks something other than `user_profiles.role`, the plan is amended before the function is written |
| `handle_new_user` is a definer trigger already in production | Editing it can break signup for existing flows | Task 1 replaces the function body with the existing body plus one assignment, keeping the signature; the old body is recorded in the migration comment |
| `signUp` with email confirmation on | Signup appears to fail | Task 8 checks the project's auth settings first; if confirmation is on, the page shows "check your email" and the verification uses the confirmation link |

## Verification record

Filled in by the supervisor as tasks land. Every row below is an execution.

| Task | Evidence | Outcome | Date |
|---|---|---|---|
| 0 | `brew install deno supabase/tap/supabase` → Deno 2.9.7, CLI 2.117.0; `supabase init`; `npm ci && npm run build` | Build passes with the two baseline warnings. `supabase link` refused without `supabase login` (owner action); migrations and deploys went through the Supabase connector instead, which the owner authorised. | 2026-09-21 |
| 1 | Migration applied; `normalise_email('First.Last+trial@Gmail.com')` → `firstlast@gmail.com`; `…@Example.org` keeps dots and plus; 0 null `email_normalised`; trigger present | Pass. Deviation: a `before insert or update of email` trigger on `user_profiles` fills the column, so the production `handle_new_user` definer function was not edited. Observation: 3 auth users and 3 profiles now, not the 9 of the 2026-09-20 baseline — six accounts were deleted outside this repository. | 2026-09-21 |
| 2 | Migration applied; RLS simulated with two real uids (`set role authenticated` + `request.jwt.claims`): A inserts and sees 1, B sees 0, cleanup 1, no residue | Pass. Vacuity substituted: positive/negative control with the same data and different uid, rather than dropping the policy live. | 2026-09-21 |
| 3 | Migrations applied; HNSW `vector_cosine_ops` index present; RLS true on all nine tables; 18 policies; anon holds no privileges; authenticated insert into `documents` refused by RLS | Pass. Note: Supabase default privileges give `authenticated` write privileges on new tables; RLS with no write policy is what refuses, as proven. | 2026-09-21 |
| 4 | Migration applied; enabling a catalogued tool model ok (vendor derived); no-tools, unavailable and the placeholder `openai/gpt-6-astra` refused with the trigger message; default on a disabled row refused; second default refused; role on disabled model refused; role on enabled ok; **vacuity:** trigger disabled inside a rolled-back subtransaction → placeholder insert succeeded; trigger still enabled after; zero residue | Pass. | 2026-09-21 |
| 5 | `deno test supabase/functions` 20 passed; **vacuity:** `requireUser` replaced by a constant → "401 without a token" failed by name, file restored byte-identical (sha256 match); deployed `health` v1 via connector; live: no token → 401 at the gateway, anon key → 401 `invalid or expired token` with CORS headers, preflight 204 | Pass except the live 200, which needs a user JWT (owner input). | 2026-09-21 |
| 6 | Catalogue shape confirmed live (446 models, 378 with tools; pricing keys `prompt, completion, input_cache_read, input_cache_write, internal_reasoning`; `openai/text-embedding-3-small` present on `/api/v1/embeddings/models`); 6 Deno tests; **vacuity:** secret guard removed → "401 without the secret" failed; reconcile exercised live twice — dropped model marked unavailable and disabled, model that lost tools disabled, orphan role reported; `cron.job` row `0 */12 * * *` active; deployed v1; live: 401 no secret, 401 wrong secret, 405 GET | Pass. Two defects caught by the live test before commit and fixed: `now()` → `clock_timestamp()`, and explicit `revoke … from anon, authenticated` (default privileges had granted execute). | 2026-09-21 |
| 7 | 7 Deno tests; **vacuity:** admin gate removed → "403 for a non-admin" failed; `admin_models_upsert` live: merge keeps untouched fields, default swap proven with separate statements, placeholder refused, role on unknown model refused, bad kind refused, privileges anon=false authenticated=false service_role=true; deployed v1; live: no token 401, anon key 401 | Pass except the 403/200 pair, which needs a user JWT and an admin account (owner inputs). Allowlist seed and role rows pending the owner's ids. | 2026-09-21 |
| 8 | `npm test` 17 → 22 passed; **vacuity:** persona RPC removed from `signUp` → the persona test failed, file restored byte-identical; `npm run build` baseline warnings only; browser, flag unset: `student@niyantran` sign-in lands on the National desk as before | Pass except the flag-on signup, which the owner performs (test account creation is the owner's action). Dev server now runs flag-on from `.env.local` (gitignored). | 2026-09-21 |
| 9 | Helper tests 5 passed; browser, flag unset: legacy editor renders the four role cards unchanged; browser, flag on, no session: allowlist editor renders read-only with "Sign in with an admin account", empty table, four seeded roles, catalogue picker empty until pricing is loaded | Pass except the admin save round-trip, which needs the promoted account. Deviation: `AllowlistEditor` lives in its own file beside `AiModelsPage.jsx` so the legacy body has one changed line. | 2026-09-21 |

## Out of scope for this plan

Everything the spec lists under Out of scope, plus: retiring the legacy
model store; migrating `localStorage` chats; any RPC owned by the RAG or
desk-row modules; any change to `AiPanel.jsx`.
