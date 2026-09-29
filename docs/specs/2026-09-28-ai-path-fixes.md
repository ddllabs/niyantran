# Spec: AI path fixes (desk briefs, legacy chat models, backend flag)

> **Status: Historical (2026-09-28).** Approved and landed on 2026-09-28
> (`a311cda`, `3602559`, `6391fd7`, merged in `bcea55d`); a production desk
> brief and research-chat turn were confirmed at 11:33 UTC (`c23efe1`).
> Superseded later that day: the legacy chat path it patched (`proxyResearchChat`,
> `aiModelsStore.js`, `VITE_AI_BACKEND`, the persona probe's model picker) was
> retired in `14b2344`, `/api/app-flags` in `9e7a125`, and `desk-brief` is now v2.
> Open remainders are tracked in `plans/open-work.md` (ids D3). Of the three owner checks at the end, two were evidenced on 2026-09-28 (`c23efe1`: a desk brief logged at $0.000775, and citations [1]–[15] resolve); the admin persona chat is part of D3.

## Current state (evidence from 2026-09-28)

- **The research chat works.** Over 7 days, `research-chat` recorded 170
  successful answer calls and no model errors since 22 Sep. All 102
  citation markers from the last 2 days resolve to a source. The research
  panel's model picker reads the live `ai_models` table: 8 enabled models,
  all available on OpenRouter and all supporting tool calls.
- **Desk briefs fail in production** for any row with no cached brief:
  1. `src/lib/deskBrief.js` first calls the `desk-brief` Edge Function,
     which is **not deployed**.
  2. It then falls back to `POST /api/ai/desk-brief` on Vercel.
  3. That route (`server/deskBrief.mjs`) calls OpenRouter directly with
     `OPENROUTER_API_KEY`, which Vercel does not have. By ADR 0008 it
     never should: the key lives only in Supabase secrets.
  - `supabase/functions/desk-brief/index.ts` does check the caller
    (`requireUser`). But its default model, `google/gemini-2.0-flash-001`,
    is no longer in the OpenRouter catalogue. It writes no
    `model_call_logs` row, and it does not bound the row it sends.
- **The legacy chat route fails for three model choices.** `POST
  /api/ai/chat` → `proxyResearchChat` (`server/aiApi.mjs`) maps
  `gemini-lite`, `gemini-flash`, `gpt-astra` and `google/gemini-2.5-flash`
  to `google/gemini-2.0-flash-001`, `google/gemini-flash-1.5` and
  `openai/gpt-4o-mini`. None of these is an enabled model, and the first
  two are retired. `research-chat` answers 400 "unknown or disabled
  model".
  - This hits `src/admin/AdminPersonaChat.jsx`, whose model list comes
    from the static roles in `src/lib/aiModelsStore.js` (retired IDs). It
    also hits `AiPanel`'s legacy path, when the build is not set to the
    Supabase backend.
- **`VITE_AI_BACKEND` in Vercel is a "sensitive" variable,** so its value
  cannot be read back. `src/lib/aiBackend.js` defaults to `legacy` unless
  the value is exactly `supabase`. The legacy path drops citations.

## Objective

Every model call goes through Supabase and uses a live, enabled model.
Desk briefs work in production. No route on Vercel needs an OpenRouter key.

## Tasks and decisions

### A — desk briefs through Supabase only (branch `task/ai-desk-brief`)

1. **Restructure the function** in the pattern of the other functions: a
   `handler.ts` with injected dependencies and unit tests, and a thin
   `index.ts`.
2. **Model choice.** It uses the registry (`_shared/models.ts`): the
   model of role `DEFAULT_ANALYST`, currently
   `google/gemini-3.5-flash-lite`. An `OPENROUTER_DESK_MODEL` secret is
   honoured only when it names an enabled model; otherwise it is ignored.
   A missing role or model returns 503 with no provider detail. There is
   no hard-coded model ID.
3. **Bounds.** `feature` and `tier` up to 64 characters; the serialised
   `row` up to 32 KB, else 413 (raised from 12 KB during review: the
   largest row the client sends, 40 fields of 220 Devanagari characters, is
   about 27 KB); `sourceExtract` truncated to 12,000
   characters, matching the client.
4. **Telemetry.** One `model_call_logs` row per provider attempt:
   - caller `desk-brief`, purpose `desk_brief`, status
     `success`/`error`;
   - the requested and served model, latency, tokens, and cost when
     OpenRouter returns usage (request `usage: { include: true }`);
   - written with the service client. Logging failures never fail the
     brief.
5. **Response.** The shape stays `{ ok, headline, summary, findings,
   kpis, confidence, hash, model, generatedAt }`. Malformed model JSON
   returns 502.
6. **Vercel route.** `POST /api/ai/desk-brief` (`server/deskBrief.mjs`
   generation path) **no longer calls OpenRouter.** It forwards to the
   `desk-brief` function with the caller's bearer, following
   `proxyResearchChat`. Without a bearer it returns 401. `GET` (cache
   read) is unchanged.
7. **Client.** `src/lib/deskBrief.js`'s fallback POST sends the verified
   bearer.

### B — legacy chat uses live models (branch `task/ai-legacy-models`)

1. **Server-side resolution.** `proxyResearchChat` resolves the requested
   model against the live registry, read through the caller's own client
   (`ai_models` and `ai_roles` are readable by `authenticated`):
   - an enabled model ID passes through;
   - a role ID (`DEFAULT_ANALYST`, `EXPERT_ESCALATION`, `PDF_PARSER`,
     `VISUAL_RESEARCH`) or a legacy alias (`gemini-lite` →
     `DEFAULT_ANALYST`, `gemini-flash` → `VISUAL_RESEARCH`, `gpt-astra` →
     `EXPERT_ESCALATION`) becomes that role's live model;
   - anything else is omitted, so `research-chat` uses its default.
   - `MODEL_MAP` and every retired ID are removed.
2. **Static lists.** The fallback role list in `src/lib/aiModelsStore.js`
   (used for labels) carries the live role models. Remove the retired IDs
   from the direct-OpenRouter fallback lists in `server/aiApi.mjs`; that
   path is dev-only when a key is present.

### C — backend flag (supervisor)

- Set `VITE_AI_BACKEND=supabase` for production and preview in the
  Vercel project `niyantran`, as an upsert, so the citation path no
  longer depends on an unreadable value. It takes effect on the next
  deploy.
- The code default in `aiBackend.js` stays as it is (out of scope,
  noted).

## Boundaries

- **No OpenRouter key on Vercel;** no new secret except the optional
  `OPENROUTER_DESK_MODEL`. No migration (`model_call_logs.caller` and
  `purpose` are free text).
- **Write scopes are disjoint.** A owns `supabase/functions/desk-brief/**`,
  `server/deskBrief.mjs`, the `/api/ai/desk-brief` block of
  `api/router.js`, `src/lib/deskBrief.js` and their tests. B owns
  `server/aiApi.mjs`, `src/lib/aiModelsStore.js` and their tests.
  `src/lib/apiVerification.test.js` is shared: each task adds only its own
  cases.
- **Deploying the Edge Function** is done by the supervisor after
  review. The owner authorised it on 2026-09-28.

## Acceptance evidence

- **Tests first.** Handler tests fail against the current code, covering:
  model from role, secret override only when enabled, bounds, a telemetry
  row per attempt, the Vercel route forwarding with the bearer and
  returning 401 without one, and legacy alias and role resolution with
  unknown models omitted.
- **No retired IDs remain** in app or function code:
  `grep -rn "gemini-2.0-flash\|gemini-flash-1.5" server api src supabase/functions`
  finds nothing.
- **Checks pass:** `npm test`, the Deno suite, `npm run build` and the
  router import.
- **After deploy:** `desk-brief` is listed as `ACTIVE`, and a production
  desk brief for an uncached row succeeds with a `model_call_logs` row.
  The last check needs a signed-in browser session, done by the owner.

## Rollout (2026-09-28)

- **Merged:** `main` and `dev` at `bcea55d`. On that tree `npm test` passed
  873/873, the Deno suite 439, and the build and router import succeeded.
- **Supabase:** `desk-brief` v1 is ACTIVE with `verify_jwt` false (the
  handler checks the bearer itself). All 10 deployed files match the repo.
- **Vercel:** `VITE_AI_BACKEND=supabase` is set for production and preview
  (updated 10:01 UTC). Production deployment `dpl_BHr1SDsVx8rUtfFQY5yVUaWPd2kt`
  (`main` @ `bcea55d`, created 10:27 UTC) is READY. `dev` now deploys only to
  preview. The project has no `OPENROUTER_API_KEY` or `NIYANTRAN_AI_KEY`, so
  no request reaches OpenRouter from Vercel.
- **Smoke:** `GET /api/app-flags` returns 200. In the hour after the deploy,
  production logged 18 responses with status 200, 7 with 401, and none with
  5xx.
- **Owner checks outstanding:**
  - an uncached desk brief, then a `model_call_logs` row with caller
    `desk-brief`;
  - admin persona chat with Gemini Lite, Gemini Flash and GPT Astra;
  - the citation UI and model picker on production.
