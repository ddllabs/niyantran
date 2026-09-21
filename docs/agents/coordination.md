# Agent coordination

> **Status: Living.** Keep this protocol aligned with actual repository and
> team behavior. `AGENTS.md` is the concise normative contract; this document
> explains its mechanics.

This project is developed by a user-directed team that may include multiple
coding agents. Current assignments live in the active implementation plan,
not in this document. Read this protocol before starting or resuming work.

## Roles and decision authority

### User

The user owns product scope, priority, release decisions, production actions,
publication, destructive operations, and anything that leaves the machine.

### Supervisor

The primary coordinating agent:

- investigates current state and surfaces assumptions;
- writes or approves specs and implementation plans;
- assigns exclusive write scopes and decides sequencing;
- creates local task branches and concurrent worktrees;
- reviews returned diffs and reproduces material evidence;
- commits and merges verified work locally;
- maintains this protocol.

Standing local commit and merge authority is not permission to push, deploy,
publish, change remotes, or open a pull request.

### Task agent

A task agent implements one dispatched scope. It does not choose a different
task, widen its scope, edit this coordination protocol, commit, merge, push, or
deploy. It returns an uncommitted diff and an evidence report.

## Agent-skills methodology

Every task starts with `using-agent-skills`. Apply only the workflows that fit
the task rather than performing the entire suite ceremonially.

Typical routing:

| Need | Workflow |
| --- | --- |
| Clarify an incomplete request | `interview-me` or `idea-refine` |
| Define a non-trivial change | `spec-driven-development` |
| Establish the quality contract | `constraint-driven-development` |
| Decompose accepted scope | `planning-and-task-breakdown` |
| Load focused context or hand off | `context-engineering` |
| Verify an approach against primary sources | `source-driven-development` |
| Implement more than one small change | `incremental-implementation` |
| Change behavior or fix a defect | `test-driven-development` |
| Diagnose a failure | `debugging-and-error-recovery` |
| Review before integration | `code-review-and-quality` |
| Reduce accidental complexity | `code-simplification` |
| Create commits or integrate branches | `git-workflow-and-versioning` |
| Record durable rationale | `documentation-and-adrs` |

Specialist work also activates its matching skill. Repository instructions and
the user's explicit request resolve any conflict with a generic workflow.

## Work lifecycle

### 1. Establish current state

Read the applicable instructions and inspect the real checkout. Confirm the
branch, working tree, remotes, relevant implementation, existing checks, and
runtime behavior. Separate observed executions from claims inferred by reading.

### 2. Specify

Every non-trivial change gets a short spec under `docs/specs/` with:

- current state and evidence;
- problem and why it matters;
- expected outcome and observable acceptance criteria;
- scope, exclusions, risks, and unresolved decisions;
- the files or modules that may be modified.

The user approves product scope. The supervisor resolves technical detail
inside that scope and stops for choices that materially change the outcome.

### 3. Plan

Implementation plans live under `docs/plans/` and reference their spec. A plan
records ordered tasks, exact write scopes, dependencies, fixed interfaces,
verification commands, and whether delegation or concurrency is permitted.

Plans describe outcomes and boundaries, not speculative line-by-line edits.
When code contradicts a plan, stop and report the conflict rather than silently
changing either source of truth.

### 4. Dispatch

Each dispatch names the exact task, plan, checkout, branch, write scope, and
verification. A task that lacks any of these is not ready to start. New agents
receive `docs/agents/onboarding.md` first.

### 5. Execute

The task agent follows the relevant skills, edits only its scope, and verifies
each meaningful increment. Out-of-scope findings are reported, not repaired.
Task agents leave their changes uncommitted.

### 6. Review and land

The supervisor inspects every changed path, reviews the diff against the spec,
re-runs the material checks, checks for secrets, and evaluates interactions
between independently completed tasks. Only then does the supervisor create
small coherent commits and merge locally.

The completed plan becomes **Historical (dated)** and records verification,
known limitations, and follow-up work. A merge does not authorize a push or
deployment.

## Sequential and parallel work

Default to sequential work. Parallelism is useful only when it reduces elapsed
time without multiplying integration ambiguity.

Tasks may run concurrently only when:

1. Their write scopes are disjoint.
2. Any shared interface is fixed in both tasks before dispatch.
3. Each task can be verified independently.
4. The supervisor has capacity to review the returned work promptly.

Use a plain `task/<slug>` branch for sequential work. For concurrency, the
supervisor creates and assigns one worktree per task. Agents never choose or
create an alternative checkout. A dependency that has not landed makes its
consumer blocked unless both tasks share an agreed contract.

Delegation follows the same rule: it must be permitted by the dispatch, fit
inside the parent task, and use strict subset scopes. Fan out wide independent
work; keep one invariant or policy sequential. The parent verifies and owns
all delegated output.

## Repository synchronization

The repository has two remotes:

- `origin` — `ddllabs/niyantran`, the DDL Labs fork.
- `upstream` — `ItsCloudDev/niyantran`, the source repository.

`main` is the only long-lived local branch. Before a new task, the supervisor:

```bash
git status --short --branch
git fetch origin --prune
git fetch upstream --prune
git rev-list --left-right --count main...origin/main
git rev-list --left-right --count main...upstream/main
```

Fetch updates references without changing working files. Fast-forward a clean
local `main` when it is only behind `origin/main`. Review upstream changes as a
separate integration decision; never merge them automatically. If history has
diverged or local work exists, inspect both sides and choose an explicit merge,
rebase, or follow-up task. Do not solve divergence with a blind pull, force
push, hard reset, or by discarding another worker's changes.

## Starting a task

Before editing:

1. Confirm the dispatch is complete and the write scope is exclusive.
2. Confirm `pwd`, branch, worktree, and `git status`.
3. Fetch and compare remotes when starting from shared history.
4. Verify the exact spec and plan exist in this checkout.
5. Read the files to be changed, adjacent interfaces, existing checks, and one
   relevant implementation pattern.
6. Run the applicable baseline before changing behavior when practical.
7. State assumptions and the short execution plan.

If the working tree contains changes you do not own, stop before touching
overlapping paths and report them to the supervisor.

## Verification and reporting

As of 2026-09-20, the verified install and build baseline is:

```bash
npm ci
npm run build
```

The build succeeds but reports a large JavaScript chunk and a module that is
both statically and dynamically imported. Those warnings are baseline
observations, not evidence that future warnings are harmless.

There is currently no repository-defined automated test, lint, type-check, or
CI command. Until those gates are deliberately added:

- run the production build for code changes;
- add behavior-specific runtime verification for the affected path;
- exercise security and validation guards with the payloads they must reject;
- report precisely which checks do not exist;
- never translate “build passed” into “tests passed.”

For each new regression guard, restore the protected defect, observe the guard
fail for the expected reason, then reapply the fix. For user-facing work,
verify in a real browser at relevant viewport sizes and inspect console and
network failures.

Every return report includes:

- changed paths and their relation to the write scope;
- exact commands, outcomes, warnings, and runtime observations;
- vacuity evidence for new guards;
- final branch and working-tree state;
- uncertainty, skipped checks, and out-of-scope findings.

The task agent provides evidence. The supervisor decides whether the task is
accepted.

## Documentation organization

- Root: `README.md`, `AGENTS.md`, and tool-specific instruction files.
- `docs/agents/`: onboarding and coordination protocol.
- `docs/specs/`: normative product and feature specifications.
- `docs/plans/`: implementation plans; mark completed plans Historical.
- `docs/decisions/`: architecture decision records for expensive-to-reverse
  choices.
- `docs/research/`: dated audits, measurements, and external research.
- `docs/archive/`: superseded operational material retained for provenance.

Do not move colocated subsystem instructions merely to satisfy a folder rule.
Do not place transient agent scratchpads, generated output, dependency state,
or tool runtime state in `docs/`.

## Shared repository knowledge

Correct this section when observations become stale.

- The application uses React 19 and Vite 5. Vite mounts local server plugins
  from `server/`; deployable functions also exist under `api/`.
- `vite.config.js` uses port 5173 with a strict port and network-visible host.
  Do not expose a development instance beyond the intended environment.
- The code consumes embedded JSON and spreadsheet-derived data as well as many
  external feeds. Preserve source and provenance fields; do not fabricate
  freshness, citations, or live status.
- AI keys, Razorpay secrets, and GST supplier settings are server-side values.
  Never move secrets into `VITE_` variables or browser code.
- `backup/` and `public/data/` are tracked collections with product and
  provenance implications. They are not disposable build output.
- `README.md` currently describes an older static, backend-free architecture
  and outdated extraction workflow. Verify commands and architecture against
  current code until the README is reconciled in a separate task.
- The repository currently has no tracked GitHub workflow or automated test
  suite. `.oxlintrc.json` exists, but Oxlint is not declared as a package
  dependency or npm script.
- The 2026-09-20 clean build transformed 204 modules and emitted chunk-size
  and mixed-import warnings. Dependency installation also reported known audit
  findings; dependency remediation requires its own reviewed task.
- The repository is public and has a Vercel homepage. Public visibility is not
  permission to push, deploy, republish data, or assume tracked data is safe to
  redistribute elsewhere.
- The Ask AI path is a single non-streaming call with no tool calling, no
  configured key and no Supabase client; desk questions see at most eight rows
  of modules that hold thousands. Read
  `docs/research/2026-09-20-ai-path-audit.md` before touching `src/ai/` or
  `server/aiApi.mjs`.
- The Supabase project `NTER` carries, as of 2026-09-21, the developer's six
  auth tables plus eleven AI tables under RLS, the `vector`, `pg_cron` and
  `pg_net` extensions, three deployed edge functions (`health`,
  `refresh-model-pricing`, `admin-models`) and a twelve-hour pricing refresh.
  The AI backend is designed in
  `docs/specs/2026-09-20-ai-backend-foundation-design.md` and its three
  sibling specs; the executed foundation plan is
  `docs/plans/2026-09-21-ai-backend-foundation.md`.
- Schema changes exist only as files under `supabase/migrations/`, applied
  to `NTER` and recorded in its migration history. `supabase link` is done
  from this checkout; deploys go through `supabase functions deploy`.
- Two test runners exist: `npm test` (Vitest, `src/**/*.test.js`) and
  `deno test -A --config supabase/functions/deno.json supabase/functions`.
  Run both for changes under `src/lib/`, `src/admin/` or `supabase/`.
- `NTER`'s legacy `anon` and `service_role` API keys were disabled on
  2026-09-21 after a `service_role` JWT was committed to the public `dev`
  branch. Use the `sb_publishable_…` key in the browser and an `sb_secret_…`
  key on servers, from the environment only. Never hard-code a key, not
  even as a fallback; the publishable key is the one exception because it
  is public by design.
- Supabase Auth is wired by the developer's module: `server/authApi.mjs`
  and `server/authEmailProvider.mjs` (switchable email provider),
  `src/marketing/{Login,Signup,ForgotPassword,ResetPassword}Page.jsx`, and
  `backend/sql/auth_schema.sql` as the auth schema's source. Email
  confirmation is on; the project's SMTP is misconfigured until a verified
  Resend domain is set (see the plan's launch gates).
- The National Desk corpus lives in `NTER` (`documents`, `document_chunks`),
  never in this repository: `ingest/` is gitignored and holds the owner's
  OCR export locally. It is loaded by `scripts/ingest-national-desk.mjs`
  through the `ingest-documents` function (service key only, `verify_jwt`
  off, the handler checks the bearer itself). Chunks are exact character
  spans of `documents.ocr_text`; embeddings are `openai/text-embedding-3-small`
  through OpenRouter, which echoes the model name without its vendor
  prefix. Retrieval is `match_documents` (any signed-in user) via
  `_shared/retrieval.ts`; the citation ladder is `_shared/citations.ts`
  mirrored by `src/lib/citationMarkers.js`; the reader is
  `src/ai/SourceReader.jsx`, not yet mounted anywhere — the streaming agent
  module mounts it. Plan: `docs/plans/2026-09-21-document-rag-and-citations.md`.
- `NTER` is a shared live project. Dashboard actions on it, especially
  under Authentication → Users, are announced before they happen; on
  2026-09-21 every user was deleted from the dashboard while another team
  member was verifying against them.
