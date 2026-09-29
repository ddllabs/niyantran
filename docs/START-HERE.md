# Start here

Status: **Living.** Rewritten 2026-09-29 as the entry point for any new agent
or session, cloud or local. Update it when a listed document changes status
or when the setup below changes.

**Looking for what to do next? Open `plans/open-work.md`.** It is the one list
of open work: agent tasks, local-session tasks, owner actions, parked items,
accepted risks and a Done log with commit hashes.

## Read in this order

| # | Document | What it gives you |
|---|---|---|
| 1 | `../AGENTS.md` | The binding rules: authority, git, verification, safety |
| 2 | `agents/coordination.md` | Roles, the work lifecycle, "Branches and deployments", and the production record by day ("Operations — 2026-09-29" is the latest) |
| 3 | `plans/open-work.md` | What is open, what is blocked and on whom, the current baseline, and what landed |
| 4 | `agents/rollback-runbook.md` | How Edge Functions and migrations are deployed, verified and rolled back |
| 5 | `plans/2026-09-29-corpus-ingestion.md` | Parked: the old L1/L2 runbook, kept for its measurements until the new ingestion pipeline is designed |
| 6 | `agents/onboarding.md` | Only when dispatching subagents: the onboarding text and dispatch template |
| 7 | `Architectures/README.md`, `decisions/` | How the system is built and why; read the part you are changing |

When a document and the code disagree, the code and migrations win, and the
document gets fixed.

## How the setup works

These are the facts new sessions most often get wrong.

- **One Supabase project, no Supabase branching.** NTER
  (`vfgcppstyzjarlzyqdac`) serves production, every Vercel preview and local
  development. Which git branch is checked out never changes which database
  is used, and a write from anywhere is a real write.
- **Supabase changes are explicit.** A push deploys nothing to Supabase.
  Migrations are applied one by one (Supabase MCP `apply_migration` or the
  CLI) and their version pinned to the file name; Edge Functions are
  deployed from a pinned commit. Both procedures are in
  `agents/rollback-runbook.md`, and each production change is recorded in
  an "Operations" entry in `agents/coordination.md`.
- **Vercel follows git.** A push to `main` deploys production
  (`niyantran-six.vercel.app`); any other pushed branch gets a preview. Edge
  Functions refuse preview origins until owner action O5 is done.
- **Local secrets.** `.env.local` beside `package.json` holds
  `SUPABASE_URL` and `SUPABASE_SECRET_KEY` for the dev server and the
  maintenance scripts. Never commit or print it. A production build needs no
  variables.
- **Cloud containers may not reach Supabase.** Their network policy can
  refuse `*.supabase.co`, so scripts and the dev server's Supabase calls fail
  there while the Supabase MCP tools still work. A local session has no such
  limit.
- **The corpus is only on the owner's laptop**, at
  `~/Downloads/NTER-Complete-Processed-Data` (open-work L1, L2).
- **SQL fixtures need Docker** with the two containers named in the header
  of `supabase/tests/run.sh`. They never run against NTER.

## Owner conventions

- Commits are authored as `Vighnesh Shukla <hello@ddllabs.ai>`, with no AI
  or tool attribution in the message or trailers.
- Branches are `task/<slug>` or `feature/<slug>`, never a tool or agent name.
- Pushing, merging to `main`, deploying, applying migrations, ingesting and
  changing any dashboard need the owner's authorization for that action
  (`AGENTS.md`, "Authority").
- The owner has said that user data may be cleared while the system is in
  development. Destructive operations still name their exact target and are
  confirmed first.

## Where things stand (2026-09-29, evening)

- `main` is the only long-lived branch; CI passes on it and production
  follows it. The upstream merge landed on 2026-09-26 and upstream is
  retired.
- Supabase NTER: 36 migrations; six Edge Functions deployed with the
  standard CLI from `b60c0dc`, so the dashboard shows the real files; 2 GB
  compute. `ALLOWED_ORIGINS` admits Vercel previews. Counts and the
  half-precision search index are in the open-work baseline.
- The evening cleanup of 2026-09-29 closed F1, F17, F29, C3, A1, O3, O4 and
  O5 (see open-work "Done" and coordination "Operations — 2026-09-29
  (evening)"). SQLite is gone from the serverless routes.
- What remains is sorted in `plans/open-work.md`:
  - three decisions for the owner: F13 (approve the spec), P12
    (dependencies and the advisor migration) and P16 (carousel numbers);
  - four later phases: Ingestion pipeline (parked for a new design),
    Payments, Launch (including the owner's dashboard and smoke-test steps)
    and Waiting on owner assets;
  - accepted risks.
- **Local sessions:** the Supabase CLI, Docker and Node network calls fail
  inside the Claude Code sandbox and work outside it. The CLI on the
  owner's laptop is logged in and linked to NTER.

## A new session's first steps

1. Confirm `pwd`, the branch, `git status` and the remote; `git fetch origin`
   and fast-forward a clean `main`.
2. Read the documents above, in order, up to what the task needs.
3. Run the baseline: `npm ci`, `npm run build`, `npm test`, `npm run lint`,
   and the Deno suite (commands in `AGENTS.md`).
4. Confirm the current state against the open-work baseline before relying
   on it, and report any drift.
5. Take a task from `plans/open-work.md`, or wait for the owner's
   instruction.

---

# Historical: the upstream integration guide (written 2026-09-24)

Kept as the record of why the code looks the way it does. Its reading order
and rules were for the merge that landed on 2026-09-26; for current work use
the sections above.

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
| 4 | `plans/open-work.md` | Everything still open, in one list (replaced the backlog on 2026-09-29) | After the integration |
| 5 | `../AGENTS.md` and `agents/coordination.md` | Repository rules: authority, git, verification, safety | Before your first commit |

## Background: how the system is built

| Document | Covers |
|---|---|
| `Architectures/README.md` | Index of the six architecture docs; corrected 2026-09-24 and 2026-09-28 |
| `Architectures/01-ingestion-pipeline.md` | Document and desk-row ingestion |
| `Architectures/02-database-schema-and-tables.md` | Tables, ER diagram, RLS matrix |
| `Architectures/03-rag-and-sql-retrieval.md` | `match_documents`, `search_desk_rows`, citations |
| `Architectures/04-prompt-sandwich-and-agent-engine.md` | Agent loop, prompt blocks, SSE, turn persistence |
| `Architectures/05-supabase-edge-functions.md` | The six deployed functions (including `desk-brief`) and the shared library |
| `Architectures/06-stored-procedures-and-rpcs.md` | RPC catalogue and grants |
| `decisions/0001`–`0004` | Edge Functions for AI, OpenRouter plus embeddings, the corpus/conversation model, chunk identity |

The architecture docs were corrected on 2026-09-24 and again on 2026-09-28 against the code. Any inaccuracy found is fixed in place, or listed in `plans/open-work.md`. **When a doc and the code disagree, the code and migrations win**, and the doc gets fixed.

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
   - `npm run build`: needs no environment variables (checked 2026-09-28).
   - `npm test`
   - `deno test -A --config supabase/functions/deno.json supabase/functions`
   - `npm run test:sql`: only if you touch SQL. Needs Docker and never runs against the live project.
   - `.github/workflows/ci.yml` runs all of these on every push (advisory).

## Who does what

- **Owner (DDL Labs):**
  - Phase 0: domain control of nter.pro, the new Vercel project, the Google OAuth client, Supabase Auth URLs, email provider.
  - Every push, merge and production action.
- **Integrator:** Phases 1–3 on the branch, with evidence per gate; then Phase 4 once the OAuth client exists; then the Phase 5 preview.
- **Reviewer:** checks each phase's evidence against the plan before the owner authorises the next step.
