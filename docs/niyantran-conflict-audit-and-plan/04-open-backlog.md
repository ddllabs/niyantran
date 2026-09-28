# Open backlog: everything not yet done, in one place

Status: **Living.** Compiled 2026-09-24 from all plans, specs, ADRs and research docs, and both session transcripts; updated 2026-09-28. Update it in place as items close.

- This is an index, not a plan. Each item points to the document that holds its detail.
- **Order of work (updated 2026-09-28):** the upstream merge has landed (PR #2, `8849c35`). What remains of the integration plan is the production cutover (Phases 4–6). The most urgent new item is §0: routes deployed on Vercel that write durable data to `/tmp`.

## 0. Found in the 2026-09-28 audit

| Item | Detail | Blocked on |
|---|---|---|
| **Durable data on `/tmp` in production.** Live since 2026-09-28 (merged, deployed, migrations applied): preferences, analytics, app flags and the intro video. Remaining: users (T3, approved after wave 1), invoices (T5, needs billing approval), nter.news (T6, needs D4) | specs/2026-09-28-serverless-state-to-supabase.md; plans/2026-09-28-serverless-state-to-supabase.md | Owner: confirm the Storage global upload limit; do a signed-in smoke test of the preference save, flag toggle and video upload |
| **Wave-1 follow-ups:** no rate limit on anonymous analytics; the analytics client sends no bearer and queues `userEmail`; rejected events retry forever; the testing-phase flag is read synchronously from a cold-start copy in `server/aiApi.mjs`; the `apiVerification` "state persistence" test is stale; the admin page still says 120 MB | plans/2026-09-28-serverless-state-to-supabase.md, "Wave 1 result" | — |
| **Authorization review of the routes `api/router.js` now exposes**, done before or alongside the move | Private security note (not published: the repository is public) | — |
| ~~**Migration version drift**~~ **Done 2026-09-28:** the repo file `reasoning_efforts_from_catalogue` was renamed to the live version `20260922121946`, with identical content. The first 24 repo versions equal the live history. | agents/coordination.md, "Supabase audit — 2026-09-28" | — |
| **`desk-brief` Edge Function is in the repo but not deployed**, so every desk brief falls back to `/api/ai/desk-brief`, which needs `OPENROUTER_API_KEY` on Vercel (ADR 0010 says that key is not there). Desk briefs in production are therefore likely failing. This is inferred from code and deploy state, not observed. | flow.md §3; ADR 0008 | Owner deploy authorization |
| **`ingest-documents` v9 was built from `a030847`**, one commit before `3a1e565` changed `_shared/chunking.ts` exports. No behaviour difference; redeploy it with the next ingest change | agents/coordination.md, Supabase audit | — |
| **Stale planner statistics:** `desk_rows` shows `n_live_tup` 0 against 34,184 real rows and has never been analysed since the 2026-09-22 restart. Run the standing `ANALYZE` from AGENTS.md. | AGENTS.md | Owner go-ahead (production write) |
| **`npm test` rewrites tracked snapshots:** `src/lib/{apiVerification,segmentCarousel}.test.js` drive `server/homeApi.mjs`, which writes `public/data/news.json` and `markets.json` (fresh `fetched_at` values). `5e54af2` committed changes to three of these files the same way. The tests should write to a temp directory. | plans/2026-09-28-serverless-state-to-supabase.md, T0 evidence | — (needs a task; `public/data/` is a protected collection) |
| **Two writers target the app directory rather than `/tmp`:** the marketing video upload (`server/marketingMediaApi.mjs` → `public/marketing/`) and the STAT-1 cache (`server/budgetStat1.mjs` → `public/data/centre_state_fund_flow.json`). On Vercel the video upload fails with a read-only filesystem error and the STAT-1 write fails silently (it is wrapped in a bare `catch`); locally the STAT-1 write rewrites a protected snapshot. | specs/2026-09-28-t0-serverless-durability-guard.md, assumption 4 | T4 covers the video; the STAT-1 writer needs its own task |
| **`server/loadEnv.mjs` still reads `nter/.env`** (the outdated `ddllabs/NTER` layout) | integration report §10, correction 6 | — |
| **`VITE_AI_BACKEND` defaults to `legacy`**, contrary to the integration report. Confirm the value on the Vercel deployment. | integration report, correction 5 | Vercel access |
| **Security advisors (2026-09-28):** `research_turns` has RLS with no policy (intended: service-role only, so confirm and document); six `SECURITY DEFINER` RPCs are executable by `authenticated` (intended for `get_my_profile`, `update_my_onboarding_profile` and the `is_*` helpers; review `ai_health`); leaked-password protection is still off | agents/coordination.md, Supabase audit | Dashboard setting for the last one |

## 1. Integration and deployment (active)

| Item | Detail | Blocked on |
|---|---|---|
| ~~Merge upstream once~~ **Done 2026-09-26** (PR #2, `8849c35`). Remaining: Google sign-in (Phase 4), preview smoke on the DDL Labs Vercel project (Phase 5; a deployment exists at `niyantran-six.vercel.app`), nter.pro cutover and clean-up (Phase 6) | 03-upstream-integration-plan.md | Owner prerequisites 0.3–0.6 |
| E1 launch checks: Vercel env, email delivery, `SITE_URL`, `ALLOWED_ORIGINS` | supervisor-recovery plan (E1); integration plan Phase 5 | New Vercel project |
| E2 phase 3: five paid live scenarios plus a cross-account denial check | supervisor-recovery plan (~L2527); streaming-research plan, Task 8 | An admin account and a second ordinary account |
| Spec to retire the legacy AI path (`api/ai/*`, `server/aiApi.mjs`, `VITE_AI_BACKEND=legacy`) | ADR 0001 L38–39; foundation spec | After integration |
| No rollback script | supervisor-recovery (~L1650) | — |
| No CI, lint or type-check gate | AGENTS.md; README | — |

## 2. Ingestion and corpus

| Item | Detail | Blocked on |
|---|---|---|
| **Corpus expansion:** 18,071 already-extracted documents (7,966 bills, 6,758 parliamentary questions, 2,813 regulatory documents, and others), never ingested | 2026-09-22-corpus-expansion.md (Phases A → B → C, then 2,748 bills that can't be linked to a desk row) | **Raising the Supabase instance's compute:** the HNSW index is 404 MB against 224 MB of cache |
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
| Law-tier ingest (874 Supreme Court and NCLT PDFs) | session transcript 2026-09-21 | Instance upgrade |
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
| Deferred features: web search, compaction, memories, binary attachments. (`desk-brief` on the Supabase path is written, `supabase/functions/desk-brief/`, but not deployed; see §0.) | streaming spec L35, L46–50 |
| Dead code: `reasoningSegments` has no callers outside tests | ai-panel-ui-findings L470–483 |
| Follow-up pills lack list semantics and a label | ai-panel-ui-findings L278–281 |
| Whether a single attachment should be capped at its per-document quota | scoped-retrieval L230–232 |

## 4. Auth, identity and security

| Item | Detail |
|---|---|
| Google sign-in through Supabase | integration plan, Phase 4 |
| **Seed accounts and the client-side Terminal gate** (`userStore.js`, `App.jsx`) | plan Phase 2.3; private security note |
| Leaked-password protection is off (a dashboard setting) | coordination.md |
| Email delivery: Resend domain, `mailer_autoconfirm` back off | foundation plan L549 |
| Unique index on the normalised email; the `app_plan` enum versus the frontend's plan names | foundation spec L111–115, L531–532 |
| Organisations and billing specs | identity-boundaries L57–61 |
| Migrating old email-keyed preference rows and unowned local chats | identity-boundaries L127–136 |
| `backend/sql/auth_schema.sql` describes a database that doesn't exist: reconcile it or delete it | session transcript 2026-09-21 |
| Legacy key-variable fallback in `supabase/functions/_shared/supabase.ts` | Arch 05 |
| Priority-2 advisor findings: grants, foreign keys, indexes | supervisor-recovery L92 |
| The public `origin/dev` history holds a disabled service-role JWT. **2026-09-28:** that commit (`25723f7`) is now also an ancestor of `main`, so rewriting `dev` alone no longer removes it | integration plan, Phase 6.5 |

## 5. Home feeds and nter.news (parked)

| Item | Detail | Blocked on |
|---|---|---|
| Database-backed home feeds; the schema must be agreed first | 2026-09-23-home-feeds-plan.md | Schema discussion; market-data vendor |
| Durable nter.news storage. **Correction 2026-09-28:** the ingest route is **enabled** in `api/router.js` and writes `nter-news.json` under `/tmp`. | integration plan 1c; home-feeds plan; specs/2026-09-28-serverless-state-to-supabase.md | Same schema discussion |
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
| Leftover `task/research-answer-once` branch and `.claude/worktrees/` worktree | integration plan, Phase 6.6 |
