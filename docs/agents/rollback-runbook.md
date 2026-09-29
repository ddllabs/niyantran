# Rollback runbook: Vercel and Supabase

> **Status: Living.** Written 2026-09-28 (plan task D5). Correct it whenever a
> step is found wrong in practice. Every rollback is a production action and
> needs the owner's go-ahead (AGENTS.md, "Authority").

Project facts: Vercel team `team_QFu1p3ObeXmlMQczPBcZb582`, project
`prj_6UiaDz2rkTOmqIOaXnCAs92V7d86` (production follows `main`,
`niyantran-six.vercel.app`). Supabase project `NTER`
(`vfgcppstyzjarlzyqdac`).

## 1. Decide what broke

| Symptom | Likely layer | Go to |
|---|---|---|
| Pages or `/api/*` routes fail after a push to `main` | Vercel build | §2 |
| Chat hangs, returns CORS errors, or 5xx from `functions/v1/research-chat` | Edge Function | §3 |
| Errors naming a table, column, policy or RPC | Migration | §4 |
| Chat refused from one origin only | `ALLOWED_ORIGINS` secret | §5 |

## 2. Vercel: go back to the last good deployment

1. List production deployments (dashboard → Deployments, or the Vercel MCP
   `list_deployments` with `target: production`). Pick the newest `READY`
   one before the bad commit.
2. Promote it: dashboard → the deployment → **Instant Rollback** (or
   **Promote to Production**). This does not touch git.
3. Fix forward on a `task/` branch, merge to `main`, and let production follow
   `main` again. While rolled back, a new push to `main` redeploys over the
   rollback, so hold pushes until the fix is ready.
4. Verify: the home page, `/#login`, and `GET /api/home/segments` answer 200.

## 3. Edge Functions: redeploy a known-good commit

Standard path, from a clean checkout on the owner's machine:

```bash
git checkout <good-sha>
supabase functions deploy research-chat --project-ref vfgcppstyzjarlzyqdac --no-verify-jwt
git checkout main
```

`verify_jwt` is off by design for `research-chat`, `ingest-documents`,
`refresh-model-pricing` and `desk-brief` (their handlers check the bearer).
`health` and `admin-models` keep it on.

Emergency path when no CLI is available (the MCP `deploy_edge_function`
tool): deploy a single `index.ts` entry that imports the function from this
public repository at a pinned commit. Supabase bundles the pinned files at
deploy time.

```ts
import { createResearchHandler } from 'https://raw.githubusercontent.com/ddllabs/niyantran/<full-sha>/supabase/functions/research-chat/index.ts';

Deno.serve(createResearchHandler());
```

The entry differs by function, because only some modules serve on import
(all forms were deployed and verified on 2026-09-29 at `d1567d1`):

| Function | Entry | `verify_jwt` |
|---|---|---|
| `health`, `admin-models` | `import '…/<name>/index.ts';` (their index calls `Deno.serve` at top level) | on |
| `research-chat` | `import { createResearchHandler } from '…/research-chat/index.ts'; Deno.serve(createResearchHandler());` | off |
| `desk-brief` | import `createDependencies` from `index.ts` and `handleDeskBrief` from `handler.ts`; `Deno.serve((req) => handleDeskBrief(req, createDependencies()));`. Its deploy must include a `deno.json` (`{}`) with `import_map_path: deno.json`, because the function was first deployed with an import map | off |
| `refresh-model-pricing` | `import { createRefreshHandler } from '…/index.ts'; Deno.serve(createRefreshHandler((n) => Deno.env.get(n)));` | off |
| `ingest-documents` | import `supabaseDb` (`index.ts`), `handleIngest` (`handler.ts`), `embedTexts` (`_shared/embed.ts`), `secretKey` and `serviceClient` (`_shared/supabase.ts`), and repeat the guarded `Deno.serve` block of its `index.ts` | off |

Use static `import` statements only: the deploy bundles what it can see, and
a dynamic `import()` of a template string is not bundled.

**The entry must call `Deno.serve` itself.** `research-chat/index.ts` only
serves when it is the entry module (`if (import.meta.main)`), so a bare
`import '…/index.ts'` boots and then never answers a request. That is exactly
what happened on 2026-09-28: versions 30 and 31 hung every request from 16:26
to 17:34 UTC until version 32 added the explicit `Deno.serve`.

Verify every Edge Function deploy, whatever the path:

- the function logs show `booted`;
- an unauthenticated POST answers **401** `{"error":"missing bearer token"}`
  with `access-control-allow-origin` set to the production origin. From a
  machine that can reach `supabase.co`, use `curl`. From the SQL editor, use
  `select net.http_post(url := 'https://vfgcppstyzjarlzyqdac.supabase.co/functions/v1/research-chat', body := '{}'::jsonb, headers := '{"Origin":"https://niyantran-six.vercel.app"}'::jsonb, timeout_milliseconds := 30000);`
  and read `net._http_response` for that id. A timeout means the function is
  not serving;
- one signed-in chat turn writes a `success` row to `model_call_logs`.

## 4. Migrations: forward only

Applied migrations are never edited or deleted.

1. Write a new migration that reverts the change (drop the new policy or
   function, restore the previous definition from the earlier migration
   file).
2. Prove it on the disposable local databases: add or adjust the fixture in
   `supabase/tests/` and run `npm run test:sql`.
3. Apply it to NTER with the owner's go-ahead, then pin its version to the
   file name (the tool stamps the apply time):
   `update supabase_migrations.schema_migrations set version = '<file-version>' where version = '<stamped>';`
4. After any restart or bulk load, run the `analyze` statements in AGENTS.md.

A data-destroying revert (dropping a table with rows) needs an exact
inventory and the owner's explicit approval first.

## 5. Secrets

`ALLOWED_ORIGINS` (Edge Function secret, read by `_shared/cors.ts`) must list
every origin that calls the functions: today
`https://niyantran-six.vercel.app,http://localhost:5173`, and nter.pro after
the cutover. It is changed in the dashboard (Edge Functions → Secrets), and
functions pick it up on their next cold start.

## 6. After any rollback

Record what happened, the versions involved and the verification in
`agents/coordination.md` under that day's "Operations" entry.
