# Open backlog: everything not yet done, in one place

Status: **Living.** Compiled 2026-09-24 from all plans, specs, ADRs and research docs, and both session transcripts. Update it in place as items close.

- This is an index, not a plan. Each item points to the document that holds its detail.
- **Order of work:** the upstream integration (03-upstream-integration-plan.md) comes first, because nothing else reaches production until it lands.

## 1. Integration and deployment (active)

| Item | Detail | Blocked on |
|---|---|---|
| Merge upstream once, rewire, OpenRouter-only, relink Vercel | 03-upstream-integration-plan.md | Owner prerequisites 0.1–0.6 |
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
| Deferred features: web search, compaction, memories, binary attachments; `desk-brief` on the Supabase path | streaming spec L35, L46–50 |
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
| The public `origin/dev` history holds a disabled service-role JWT | integration plan, Phase 6.5 |

## 5. Home feeds and nter.news (parked)

| Item | Detail | Blocked on |
|---|---|---|
| Database-backed home feeds; the schema must be agreed first | 2026-09-23-home-feeds-plan.md | Schema discussion; market-data vendor |
| Durable nter.news storage (the ingest route is disabled in the integration) | integration plan 1c; home-feeds plan | Same schema discussion |
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
