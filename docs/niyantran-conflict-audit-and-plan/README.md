# Niyantran conflict audit and integration plan

Status: **Living.** Written 2026-09-24 for the engineering team doing the upstream integration; corrected 2026-09-28 and 2026-09-29.

> **Update 2026-09-29.** The integration this folder plans is finished: upstream `528dfb4` reached `main` through PR #2 (`8849c35`, 2026-09-26). `main` is the only long-lived branch and `origin` the only remote; for its latest commit see `git log`. The merged task branches `task/docs-pass` and `task/f2-server-entitlements` still exist on GitHub, pending deletion (owner action O3). None of the integration rules or roles below apply any more; they are kept as the record. Since `f828ef5` (2026-09-27) the whole of `docs/` is published, not only this folder; only `docs/security/` stays local. For the current state start at [../START-HERE.md](../START-HERE.md). **The one list of open work is [../plans/open-work.md](../plans/open-work.md).**

- ~~This folder is the only part of `docs/` published to GitHub.~~ (Superseded 2026-09-27: all of `docs/` except `docs/security/` is published.)
- The "full docs package" referred to below is now simply the rest of `docs/` in this repository.

## The situation in five lines (2026-09-24, before the merge)

1. `ddllabs/niyantran` `main` is the product and the only codebase: Supabase Auth and Postgres, Edge Functions, RAG, streaming research.
2. `ItsCloudDev/niyantran` `main` (upstream) has 27 unmerged commits of UI work plus a different backend: Vercel router, SQLite in `/tmp`, local-seat and Google login, Gemini-only AI. Its author has left.
3. www.nter.pro runs the upstream build on a Vercel project we cannot access. Production has no durable accounts to migrate.
4. We merge upstream **once**, keeping our architecture and their UI, then deploy from a Vercel project owned by DDL Labs.
5. The private `ddllabs/NTER` repo is outdated. Do not use it or its `nter/` layout.

## Read in this order

| # | Document | What it gives you | Read when |
|---|---|---|---|
| 1 | [01-decisions-adr-0005.md](01-decisions-adr-0005.md) | The binding decisions: Supabase is the record, OpenRouter only, Supabase Google sign-in, Vercel relink | First, 5 min |
| 2 | [02-merge-audit-reconciliation.md](02-merge-audit-reconciliation.md) | The team audit and Claude's, checked line by line against the repo: what is agreed, what is wrong in each, what was missed | Before touching git |
| 3 | [03-upstream-integration-plan.md](03-upstream-integration-plan.md) | **The work.** Phases 0–6, a resolution for every conflicted file, gates, the Vercel env inventory, the smoke list | The integrator, fully |
| 4 | [04-open-backlog.md](04-open-backlog.md) | Historical: the backlog as it stood after the integration. Open work is now in [../plans/open-work.md](../plans/open-work.md) | For history only |
| 5 | [AGENTS.md](../../AGENTS.md) | Repository rules: authority, git, verification, safety | Before your first commit |

References in these documents to other files (for example `supervisor-recovery`, `corpus-expansion`, `home-feeds-plan`, `Architectures/0N-*`) point into the full docs package.

**Security specifics are deliberately not published here.** The repository is public. Reproductions of the open security findings are in a private security note in the full docs package.

## Rules for the integration

> Historical (2026-09-29): the integration is finished, so none of rules 1–7 binds new work. Rules 1–3 lapsed with the merge. The lasting parts of rules 4–7 (Supabase is the record, verification gates, no secrets, owner authorisation) are in [AGENTS.md](../../AGENTS.md) and ADR 0005, which govern instead.

1. **Start from a fresh clone** of `https://github.com/ddllabs/niyantran.git`. Do not use the `PI Terminal` checkout: it is 113 commits behind, with its tree moved into `nter/`.
2. Add upstream read-only: `git remote add upstream https://github.com/ItsCloudDev/niyantran.git && git fetch upstream`. Never push to it.
3. **One integrator** works on `task/upstream-integration`. Others freeze changes to `main` until Phase 3 of the plan lands.
4. **Our side wins** for auth, data, AI and anything durable; **upstream wins** for visual UI; upstream's Google, app-flags/testing-phase and `/tmp` persistence are not taken. The per-file table is in the plan, §1a–1c.
5. **Green tests are not enough.** A trial merge passed the build and 1,020 tests while the Vercel router could not load. Run every gate in the plan, including importing the router and the preview smoke list.
6. **Never commit secrets** (`.env*`, keys). Never delete or regenerate `backup/` or `public/data/`. Pushes, merges to `main`, and any Vercel, DNS or Supabase dashboard change need the owner's explicit go-ahead.
7. **Verification commands:**
   - `npm ci`
   - `npm run build`: needs the Supabase and auth env vars, or plan Phase 2.5 applied.
   - `npm test`
   - `deno test -A --config supabase/functions/deno.json supabase/functions`
   - `npm run test:sql`: only if you touch SQL. Needs Docker and never runs against the live project.

## Who does what

> Historical (2026-09-29): these were the integration roles. Current roles are in [AGENTS.md](../../AGENTS.md) ("Authority") and [../agents/coordination.md](../agents/coordination.md); the owner's remaining actions are listed in [../plans/open-work.md](../plans/open-work.md) §3.

- **Owner (DDL Labs):**
  - Phase 0: domain control of nter.pro, the new Vercel project, the Google OAuth client, Supabase Auth URLs, email provider.
  - Every push, merge and production action.
- **Integrator:** Phases 1–3 on the branch, with evidence per gate; then Phase 4 once the OAuth client exists; then the Phase 5 preview.
- **Reviewer:** checks each phase's evidence against the plan before the owner authorises the next step.
