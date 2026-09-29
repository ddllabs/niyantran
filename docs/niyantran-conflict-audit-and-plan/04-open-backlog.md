# Open backlog: everything not yet done, in one place

Status: **Historical (2026-09-29).** Superseded by `docs/plans/open-work.md`, the one list of open work; every open row moved there (as an `F`, `P`, `O` or `L` item, or an accepted risk) and stale rows were closed.

- This is an index, not a plan. Each item points to the document that holds its detail.
- **Order of work (updated 2026-09-28):** the upstream merge has landed (PR #2, `8849c35`). What remains of the integration plan is the production cutover (Phases 4–6). The most urgent new item is §0: routes deployed on Vercel that write durable data to `/tmp`.

## 0. Found in the 2026-09-28 audit

| Item | Detail | Blocked on |
|---|---|---|
| **Durable data on `/tmp` in production.** Live since 2026-09-28 (merged, deployed, migrations applied): preferences, analytics, app flags and the intro video. Users (T3) and invoices (T5, `19d25e6`, with auth on every billing route) followed on 2026-09-28. nter.news (T6, `7160391`) followed the same day; production needs `NTER_TERMINAL_API_KEY` on Vercel before nter.news can push. Remaining: T7 close-out (the SQLite brief cache and `server/db.mjs`), after the owner checks the local SQLite files | specs/2026-09-28-serverless-state-to-supabase.md; plans/2026-09-28-serverless-state-to-supabase.md | Owner: confirm the Storage global upload limit; do a signed-in smoke test of the preference save, flag toggle and video upload |
| **Wave-1 follow-ups.** Fixed 2026-09-28 (specs/2026-09-28-wave-1-follow-ups.md): the analytics client sends the session bearer and no email; rejected events are dropped; the testing-phase check reads the stored flag; the stale `apiVerification` test is replaced; the admin page says 50 MB. The anonymous-event rate limit followed (`483b3b2`, migration `20260928130000_analytics_rate_limit`, applied live): 60 a minute per HMAC-hashed IP, with a 429 over the limit and windows purged every 15 minutes | specs/2026-09-28-wave-1-follow-ups.md | — |
| ~~**Authorization review of the routes `api/router.js` now exposes**~~ **Done 2026-09-28** (plan task B2): `docs/specs/2026-09-28-authorization-review.md`. It led to `def5f71` (source fetching) and `93f31e6` (`/api/auth/*` removed from production) | Private security note (not published: the repository is public) | — |
| ~~**Migration version drift**~~ **Done 2026-09-28:** the repo file `reasoning_efforts_from_catalogue` was renamed to the live version `20260922121946`, with identical content. The first 24 repo versions equal the live history. | agents/coordination.md, "Supabase audit — 2026-09-28" | — |
| ~~**`desk-brief` Edge Function not deployed**~~ **Done 2026-09-28** (`bcea55d`, specs/2026-09-28-ai-path-fixes.md): `desk-brief` v1 is ACTIVE and the Vercel route forwards to it with the caller's bearer. Vercel holds no OpenRouter key. Confirmed 11:33 UTC: a production desk brief was logged (`desk-brief`, Gemini 3.5 Flash Lite, $0.000775) | flow.md §3; ADR 0008 | — |
| ~~**Signup's persona choice never reaches the profile**~~ **Fixed 2026-09-28 (`e78aa85`, migration `20260928120000_signup_persona`, applied live):** `handle_new_user` maps the signup `personaId` to `app_persona`, and the Google return saves the pick stored before the redirect to a profile with none. A rolled-back live insert mapped `lawyer` to `legal_researcher`. Existing accounts with a null persona keep the Corporate Affairs fallback until they choose one in the app; no signup pick was recorded for them to backfill from | `supabase/tests/signup_persona.sql`; `src/lib/userStore.js` | — |
| **Gemini - Flash is now 3.8 (2026-09-28).** The owner asked for `google/gemini-3.8-flash`, which is available with tools, the same price and the same reasoning levels. It was switched through `admin_models_upsert`: 3.8 is the default model and `VISUAL_RESEARCH`, and 3.7 is kept, disabled. The code fallback was updated in the same change. The admin panel and the picker both read `ai_models`/`ai_roles`; only that fallback is hand-kept | `src/lib/aiRegistry.js`; `supabase/functions/admin-models` | — |
| ~~**Research chat on production: `ALLOWED_ORIGINS` lacks the site**~~ **Done 2026-09-28:** the owner set the secret. At 11:32–11:34 UTC the production browser's preflights were followed by `admin-models` GET 200, `desk-brief` POST 200 and `research-chat` POST 200. The answer cites 15 sources and every marker [1]–[15] resolves | `supabase/functions/_shared/cors.ts` | — |
| **UI regressions from the upstream merge and `5e54af2`. Fixed 2026-09-28 (`80342a3`):** the login layout; light colours on the desk landing page, the home carousel and the NyAI card; missing bar fills; the doubled thinking indicator. The nter.news rail on the public home page was made white in `4d35ef0`. ~~**Differences left for the owner,**~~ each compared against `9c0d432` (24 Sep): the home hero globe is the dimmer animated GIF; signup asks for the plan in a second step; Terminal Home replaced the watchlist and feed-health blocks with the nter.news section; the Live TV modal was not reviewed. **Decided and done 2026-09-28** (plan task C7, `96594d3`, `aee1e8a`): the bright globe is back, the watchlist and feed health sit under Live Latest, Live TV no longer blanks the terminal and is recoloured, and signup keeps its two steps | screenshots in the 2026-09-28 session | — |
| ~~**Dormant direct OpenRouter branch in `server/aiApi.mjs`**~~ **Removed 2026-09-28:** `/api/ai/chat` always forwards to `research-chat`, even when a key is present (test in `src/lib/aiApiLegacyModels.test.js`). No Vercel code calls a model provider | ADR 0008 | — |
| ~~**Paid plans are enforced only in the browser (found 2026-09-28).**~~ **Phase 1 done 2026-09-29** (`f74c8c1`, plan task F2): the plan lives on `user_profiles`, users cannot set it, the browser reads it only from `my_entitlement()`, and `/api/billing/verify` grants the paid period. **Still open (plan task F6):** desk data is public, so desk locks, row caps and export limits are applied in the browser from that server plan; the server must gate them before Razorpay goes live. Original finding: a paid upgrade set `sessionStorage`, not `user_profiles.plan`, and no server route or Edge Function checked the plan | specs/2026-09-29-f2-entitlements.md | Before enabling Razorpay (F6) |
| ~~**Admin persona probe does not apply the persona it tests.**~~ **Fixed 2026-09-28** (`8a21133`, plan task C4; live since `research-chat` v32): `research-chat` honours `persona_probe` for platform admins only, and the probe calls it through `src/lib/personaProbe.js`. Original finding: `AdminPersonaChat` sends `probe`, `userType` and `personaPrompt`, but `research-chat` builds the persona from the caller's own profile and ignores them. Only the removed direct branch used them, and it never ran on Vercel. So a probe answers with the admin's own persona. It needs an admin-only probe option in `research-chat`, or the probe should be relabelled | `src/admin/AdminPersonaChat.jsx`; `supabase/functions/research-chat/handler.ts` | — |
| **`ingest-documents` v9 was built from `a030847`**, one commit before `3a1e565` changed `_shared/chunking.ts` exports. No behaviour difference; redeploy it with the next ingest change | agents/coordination.md, Supabase audit | — |
| ~~**Stale planner statistics**~~ **Done 2026-09-28:** `ANALYZE` ran on `document_chunks`, `desk_rows` and `documents`; `desk_rows` shows `n_live_tup` 34,184. Repeat after any restart (AGENTS.md). | AGENTS.md | — |
| ~~**`npm test` rewrites tracked snapshots:**~~ **Fixed 2026-09-28** (`862c995`, plan task B3; CI now fails if tests modify `public/`). Original finding: `src/lib/{apiVerification,segmentCarousel}.test.js` drive `server/homeApi.mjs`, which writes `public/data/news.json` and `markets.json` (fresh `fetched_at` values). `5e54af2` committed changes to three of these files the same way. The tests should write to a temp directory. | plans/2026-09-28-serverless-state-to-supabase.md, T0 evidence | — |
| ~~**Two writers target the app directory rather than `/tmp`:**~~ **Done 2026-09-28:** the video upload goes to the Supabase Storage bucket `marketing` (T4), and the STAT-1 cache moved to `writablePath('stat1.json')` (`862c995`, plan task B4). Original finding: the marketing video upload (`server/marketingMediaApi.mjs` → `public/marketing/`) and the STAT-1 cache (`server/budgetStat1.mjs` → `public/data/centre_state_fund_flow.json`). On Vercel the video upload fails with a read-only filesystem error and the STAT-1 write fails silently (it is wrapped in a bare `catch`); locally the STAT-1 write rewrites a protected snapshot. | specs/2026-09-28-t0-serverless-durability-guard.md, assumption 4 | — |
| ~~**`server/loadEnv.mjs` still reads `nter/.env`**~~ (the outdated `ddllabs/NTER` layout) **Fixed 2026-09-28** (`3851bc6`) | integration report §10, correction 6 | — |
| ~~**`VITE_AI_BACKEND` on Vercel unconfirmed**~~ **Done 2026-09-28:** set explicitly to `supabase` for production and preview; the production build of `bcea55d` was the first after the change. The code default is still `legacy` (obsolete 2026-09-28: `14b2344` retired the legacy path and nothing reads `VITE_AI_BACKEND`; the owner may delete the variable) | integration report, correction 5 | — |
| **Security advisors (2026-09-28):** `research_turns` has RLS with no policy (intended: service-role only, so confirm and document); six `SECURITY DEFINER` RPCs are executable by `authenticated` (intended for `get_my_profile`, `update_my_onboarding_profile` and the `is_*` helpers; review `ai_health`); leaked-password protection is still off. **Update 2026-09-28:** the definer review and the `research_turns` note are done (plan task B1, `docs/specs/2026-09-28-authorization-review.md`); leaked-password protection is still open (plan task D1) | agents/coordination.md, Supabase audit | Dashboard setting for the last one |
| ~~**Live TV spends YouTube search quota on uncached requests (found 2026-09-28).**~~ **Fixed 2026-09-28 (F4):** the live check uses `videos.list` (1 unit) on the recent uploads plus the curated live video; no `search` call remains. `fetchYouTubeChannelVideos` in `server/liveTvApi.mjs` calls the YouTube `search` endpoint (100 quota units) for the live check whenever its per-instance, ten-minute memory cache misses, so cold Vercel instances repeat it for each channel | `server/liveTvApi.mjs`; plans/2026-09-28-remaining-work.md, F4 | — |

## 1. Integration and deployment (active)

| Item | Detail | Blocked on |
|---|---|---|
| ~~Merge upstream once~~ **Done 2026-09-26** (PR #2, `8849c35`). Remaining: Google sign-in (Phase 4), preview smoke on the DDL Labs Vercel project (Phase 5; a deployment exists at `niyantran-six.vercel.app`), nter.pro cutover and clean-up (Phase 6) | 03-upstream-integration-plan.md | Owner prerequisites 0.3–0.6 |
| E1 launch checks: Vercel env, email delivery, `SITE_URL` (`ALLOWED_ORIGINS` done 2026-09-28, see §0) | supervisor-recovery plan (E1); integration plan Phase 5 | New Vercel project |
| E2 phase 3: five paid live scenarios plus a cross-account denial check | supervisor-recovery plan (~L2527); streaming-research plan, Task 8 | An admin account and a second ordinary account |
| ~~Spec to retire the legacy AI path (`api/ai/*`, `server/aiApi.mjs`, `VITE_AI_BACKEND=legacy`)~~ **Done 2026-09-28** (`14b2344`, plan task D4) | ADR 0001 L38–39; foundation spec | — |
| ~~No rollback script~~ **Done 2026-09-28:** a runbook instead, `docs/agents/rollback-runbook.md` (`fc35729`, plan task D5) | supervisor-recovery (~L1650) | — |
| No lint or type-check gate. (~~No CI~~: an advisory workflow, `.github/workflows/ci.yml`, runs since `a47680e`, 2026-09-28; it blocks nothing) | AGENTS.md; README | — |

## 2. Ingestion and corpus

| Item | Detail | Blocked on |
|---|---|---|
| **Corpus expansion:** 18,071 already-extracted documents (7,966 bills, 6,758 parliamentary questions, 2,813 regulatory documents, and others), never ingested | 2026-09-22-corpus-expansion.md (Phases A → B → C, then 2,748 bills that can't be linked to a desk row) | **Raising the Supabase instance's compute:** the HNSW index is 404 MB against 224 MB of cache. (2026-09-28: compute raised to 2 GB; the gate has not been re-measured, remaining-work F5) |
| New ingest path reading the extracted-text slice of `documents.jsonl.gz` | corpus-expansion L111–123 | same |
| Carry 7 dropped fields into `documents.metadata`: `dataset_key`, `row_ref`, `integrity`, `licence_basis`, `prid`, `posted_on`, `profile_ref` | corpus-expansion L111–123 | same |
| **Current-bill coverage:** 0.5% of 2020–26 bills have documents. This is the cause of "search widened". | scoped-retrieval spec, D5 | Phase A of the expansion |
| **Desk-row loader rewrites all 34,184 rows every run.** Should write only what changed and prune by key difference. Owner asked for this on 2026-09-22; not built. | session transcript 2026-09-22; desk-row plan L439–442 | — (can do now) |
| **The chunker treats OCR lines starting with `|` as tables** (`supabase/functions/_shared/chunking.ts` ~L89) | ai-panel-ui-findings L489–496 | — (can do now; needs a re-chunk plan) |
| 716 documents without `file_url`: re-crawl the six known government hosts. The expansion plan contradicts itself on this (L127–131 rules crawling out; L151–153 proposes it). | corpus-reconciliation L146–151 | Decision |
| 1,288 documents with unknown `integrity` | corpus-reconciliation L326–330 | Not recoverable from the inputs |
| Page-level citations: `page_count` and chunk `page_number` | RAG spec L52–53; ADR 0004 | Page-wise Markdown from the provider |
| Document keys for parliamentary questions and regulators | desk-row spec L37–38 | Measuring the joins |
| Bill-key collision handling (explicit, not first match) | corpus-reconciliation L63–65 | Unverified whether done |
| Affidavits (10,492 documents, 809 M characters) | first-pass plan L155–163 | Compute; owner decision |
| Law-tier ingest (874 Supreme Court and NCLT PDFs) | session transcript 2026-09-21 | Instance upgrade (done 2026-09-28, 2 GB); reassess first, remaining-work F5 |
| Desk-row refresh pipeline, curated views, 41 modules that load no rows ("cut two") | desk-row spec L304–311 | — |
| Reranking and hybrid keyword search | scoped-retrieval L243–247 | After the retrieval fixes |
| Run ANALYZE after every Postgres restart or bulk load | AGENTS.md | Standing rule |

## 3. Research chat and agent

| Item | Detail |
|---|---|
| Model and effort choice do not survive a reload | ai-panel-ui-findings L461–468 |
| Three recorded turn-recovery defects: non-idempotent `reconcileSavedTurn`, a transient identity failure discarding retained turns, an unreachable throw behind a bare catch | supervisor-recovery L1339–1356 |
| No live turn has yet shown the agent choosing document search *and* the browser highlighting a span | research-turn-findings L510–521 |
| Unsettled: whether medium/high reasoning work in production, whether `require_parameters` turns reasoning into a hard routing constraint, how DeepSeek bills | ai-panel-ui-findings L534–545 |
| Real runtime limits; `waitUntil` is not a durable queue | streaming-handover L58–60 |
| Deferred features: web search, compaction, memories, binary attachments. (`desk-brief` on the Supabase path is deployed since 2026-09-28; see §0.) | streaming spec L35, L46–50 |
| Dead code: `reasoningSegments` has no callers outside tests | ai-panel-ui-findings L470–483 |
| Follow-up pills lack list semantics and a label | ai-panel-ui-findings L278–281 |
| Whether a single attachment should be capped at its per-document quota | scoped-retrieval L230–232 |

## 4. Auth, identity and security

| Item | Detail |
|---|---|
| Google sign-in through Supabase. **2026-09-28:** the code is done (`GoogleSignInButton.jsx` calls `signInWithOAuth`); the OAuth client is plan task D2 | integration plan, Phase 4 |
| ~~**Seed accounts and the client-side Terminal gate**~~ **Done by T3 (2026-09-28, merged in `5a2ded0`):** the seed accounts and all local passwords are gone, and the Terminal needs a real session user. The unused `src/Login.jsx` is deleted too | plan Phase 2.3; specs/2026-09-28-t3-retire-local-users.md |
| Leaked-password protection is off (a dashboard setting) | coordination.md |
| Email delivery: Resend domain, `mailer_autoconfirm` back off | foundation plan L549 |
| Unique index on the normalised email; the `app_plan` enum versus the frontend's plan names | foundation spec L111–115, L531–532 |
| Organisations and billing specs | identity-boundaries L57–61 |
| Migrating old email-keyed preference rows and unowned local chats. (The chats part is obsolete: `f05a5b6` deleted the local chat store, and each browser drops its old chat keys at startup.) | identity-boundaries L127–136 |
| `backend/sql/auth_schema.sql` describes a database that doesn't exist: reconcile it or delete it | session transcript 2026-09-21 |
| Legacy key-variable fallback in `supabase/functions/_shared/supabase.ts` | Arch 05 |
| Priority-2 advisor findings: grants, foreign keys, indexes | supervisor-recovery L92 |
| A disabled service-role JWT remains in public git history. **2026-09-28:** the `dev` branch has been deleted, but the commit that held it (`25723f7`) is an ancestor of `main`, so it stays in `main`'s public history (and in any fork). The key is disabled; removing it from history would need a rewrite of `main` | integration plan, Phase 6.5 |

## 5. Home feeds and nter.news (parked)

| Item | Detail | Blocked on |
|---|---|---|
| Database-backed home feeds; the schema must be agreed first | 2026-09-23-home-feeds-plan.md | Schema discussion; market-data vendor |
| ~~Durable nter.news storage.~~ **Correction 2026-09-28:** the ingest route is **enabled** in `api/router.js` and writes `nter-news.json` under `/tmp`. **Done 2026-09-28** (T6, `7160391`): articles live in `nter_news_articles`; production still needs `NTER_TERMINAL_API_KEY` on Vercel (see §0) | integration plan 1c; home-feeds plan; specs/2026-09-28-serverless-state-to-supabase.md | — |
| Conflict pulse shows the static war list on production | home-feeds plan §2 | — |

## 6. Telemetry and cost

| Item | Detail |
|---|---|
| The call log has no effort column | ai-panel-ui-findings L543–544 |
| Metering and credits | ADR 0002 L62–63 |
| Each turn wrote its answer twice | **Done:** e84d842, 7352148 |

## 7. Housekeeping

| Item | Detail |
|---|---|
| Stale `desk-rows-worktree` entry in `.claude/launch.json` | supervisor-recovery L1814–1817 |
| Vite manifest-import warning | desk-row plan L448–450 |
| Dependency audit findings | coordination.md L255–256 |
| Streaming plan and spec to be closed as Historical once E2 phase 3 passes | streaming plan L412–415 |
| Leftover `task/research-answer-once` branch and `.claude/worktrees/` worktree. **2026-09-28:** the branch is gone from `origin` (only `main` remains); any local worktree is outside what the repository shows | integration plan, Phase 6.6 |
