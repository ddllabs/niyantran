# Start here: guide for engineers joining the upstream integration

Status: **Living.** Written 2026-09-24; current-state section corrected 2026-09-28. Update it when a listed document changes status.

## Current state (2026-09-28)

The upstream merge described below **has landed**. Read this section first; the rest of the page is the guide that got us here and is kept because the plan and audit it points to are still the record of why the code looks the way it does.

1. Upstream `528dfb4` was merged into `dev` and then into `main` through PR #2 (`8849c35`, 2026-09-26). `origin/main` and `origin/dev` both point at `ca73200` (2026-09-28). Upstream is retired; there is no `upstream` remote to fetch in a fresh clone and none is needed.
2. Since the merge `main` gained Live TV, desk landing pages, the segment carousel, the nter.news rail and the NyAI thinking indicator (`5e54af2`, ADRs 0006–0009), then Vercel router fixes (`ca73200`, ADR 0010).
3. A DDL Labs Vercel deployment exists at `niyantran-six.vercel.app` (ADR 0010). The nter.pro cutover (integration plan Phases 4–6) is not recorded as done.
4. `docs/` is tracked in git since 2026-09-27 (`f828ef5`). `docs/security/` stays local only.
5. **Known gap:** several `api/router.js` routes still write to SQLite or JSON files under `/tmp` on Vercel, which ADR 0005 forbids for durable data. The move to Supabase is specified in `specs/2026-09-28-serverless-state-to-supabase.md`.
6. The Supabase state as of 2026-09-28 (deployed function versions, migration history, row counts) is recorded in `agents/coordination.md` under "Supabase audit — 2026-09-28".
7. The open work is indexed in `niyantran-conflict-audit-and-plan/04-open-backlog.md`.

## The situation in five lines (2026-09-24, before the merge)

1. `ddllabs/niyantran` `main` is the product and the only codebase: Supabase Auth and Postgres, Edge Functions, RAG, streaming research.
2. `ItsCloudDev/niyantran` `main` (upstream) had 27 unmerged commits of UI work plus a different backend: Vercel router, SQLite in `/tmp`, local-seat and Google login, Gemini-only AI. Its author has left. (Merged 2026-09-26; see above.)
3. www.nter.pro runs the upstream build on a Vercel project we cannot access. Production has no durable accounts to migrate.
4. We merge upstream **once**, keeping our architecture and their UI, then deploy from a Vercel project owned by DDL Labs.
5. The private `ddllabs/NTER` repo is outdated. Do not use it or its `nter/` layout.

## Read in this order

| # | Document | What it gives you | Read when |
|---|---|---|---|
| 1 | `niyantran-conflict-audit-and-plan/01-decisions-adr-0005.md` | The binding decisions: Supabase is the record, OpenRouter only, Supabase Google sign-in, Vercel relink | First, 5 min |
| 2 | `niyantran-conflict-audit-and-plan/02-merge-audit-reconciliation.md` | Your audit and Claude's, checked line by line against the repo: what is agreed, what is wrong in each, what was missed | Before touching git |
| 3 | `niyantran-conflict-audit-and-plan/03-upstream-integration-plan.md` | **The work.** Phases 0–6, a resolution for every conflicted file, gates, the Vercel env inventory, the smoke list | The integrator, fully |
| 4 | `niyantran-conflict-audit-and-plan/04-open-backlog.md` | Everything else still open, by theme, each with a pointer to its detail | After the integration |
| 5 | `../AGENTS.md` and `agents/coordination.md` | Repository rules: authority, git, verification, safety | Before your first commit |

## Background: how the system is built

| Document | Covers |
|---|---|
| `Architectures/README.md` | Index of the six architecture docs; corrected 2026-09-24 |
| `Architectures/01-ingestion-pipeline.md` | Document and desk-row ingestion |
| `Architectures/02-database-schema-and-tables.md` | Tables, ER diagram, RLS matrix |
| `Architectures/03-rag-and-sql-retrieval.md` | `match_documents`, `search_desk_rows`, citations |
| `Architectures/04-prompt-sandwich-and-agent-engine.md` | Agent loop, prompt blocks, SSE, turn persistence |
| `Architectures/05-supabase-edge-functions.md` | The five deployed functions and the shared library (a sixth, `desk-brief`, is in the repo but not deployed as of 2026-09-28) |
| `Architectures/06-stored-procedures-and-rpcs.md` | RPC catalogue and grants |
| `decisions/0001`–`0004` | Edge Functions for AI, OpenRouter plus embeddings, the corpus/conversation model, chunk identity |

The architecture docs were corrected on 2026-09-24 against the code. Some small inaccuracies remain and are listed in the backlog. **When a doc and the code disagree, the code and migrations win**, and the doc gets fixed.

## History, for context only

- `specs/2026-09-2*`: designs for each module, most now Historical (executed).
- `plans/2026-09-21-*` and `plans/2026-09-22-*`: execution records.
  - `supervisor-recovery.md` holds the E1/E2 launch checklists.
  - `corpus-expansion.md` is the parked ingestion plan.
  - `2026-09-23-home-feeds-plan.md` is the parked home-feeds plan; its schema must be agreed before any build.
- `research/2026-09-2*`: baseline audits and corpus measurements.
- `2026-09-21-deleted-branch-tips.txt` and `.bundle`: an archive of deleted task branches. Do not unbundle unless asked.

## Rules for the integration (historical: the merge landed 2026-09-26)

Rules 1–3 described the one-time merge and no longer apply: there is no freeze on `main`, and no `upstream` remote is needed. Rules 4–7 still hold for all work.

1. **Start from a fresh clone** of `https://github.com/ddllabs/niyantran.git`. Do not use the `PI Terminal` checkout: it is 113 commits behind, with its tree moved into `nter/`.
2. Add upstream read-only: `git remote add upstream https://github.com/ItsCloudDev/niyantran.git && git fetch upstream`. Never push to it.
3. **One integrator** works on `task/upstream-integration`. Others freeze changes to `main` until Phase 3 of the plan lands.
4. **Our side wins** for auth, data, AI and anything durable; **upstream wins** for visual UI; upstream's Google, app-flags/testing-phase and `/tmp` persistence are not taken. The per-file table is in the plan, §1a–1c.
5. **Green tests are not enough.** A trial merge passed the build and 1,020 tests while the Vercel router could not load. Run every gate in the plan, including importing the router and the preview smoke list.
6. **Never commit secrets** (`.env*`, keys). Never delete or regenerate `backup/` or `public/data/`. Pushes, merges to `main`, and any Vercel, DNS or Supabase dashboard change need the owner's explicit go-ahead.
7. **Verification commands** (AGENTS.md):
   - `npm ci`
   - `npm run build`: needs the Supabase and auth env vars, or Phase 2.5 applied.
   - `npm test`
   - `deno test -A --config supabase/functions/deno.json supabase/functions`
   - `npm run test:sql`: only if you touch SQL. Needs Docker and never runs against the live project.

## Who does what

- **Owner (DDL Labs):**
  - Phase 0: domain control of nter.pro, the new Vercel project, the Google OAuth client, Supabase Auth URLs, email provider.
  - Every push, merge and production action.
- **Integrator:** Phases 1–3 on the branch, with evidence per gate; then Phase 4 once the OAuth client exists; then the Phase 5 preview.
- **Reviewer:** checks each phase's evidence against the plan before the owner authorises the next step.
