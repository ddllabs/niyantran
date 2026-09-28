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

The repository has one working remote, `origin` (`ddllabs/niyantran`).
`upstream` (`ItsCloudDev/niyantran`) was retired after the 2026-09-26 merge. A
fresh clone does not need it; the rules below apply only if the owner
reinstates it.

`main` is the only long-lived branch, locally and on `origin`. Before a new
task, the supervisor runs:

```bash
git status --short --branch
git fetch origin --prune
git rev-list --left-right --count main...origin/main
```

### Branches and deployments (owner decision, 2026-09-28)

- **No `dev` branch.** It was retired on 2026-09-28, when it was identical
  to `main`. Two writers pushing to it caused a rejected push and a
  production deploy race.
- **Every change starts on a short-lived branch** created from `main`,
  named `task/<slug>` or `feature/<slug>`. Never use a tool or agent name.
- **Every pushed branch gets a Vercel preview** at
  `https://niyantran-git-<branch>-ddl-labs.vercel.app`, with `/` in the
  branch name replaced by `-`. For example, `task/foo` becomes
  `niyantran-git-task-foo-ddl-labs.vercel.app`. The owner can check a change
  there before it merges.
- **Production** is `https://niyantran-six.vercel.app` and deploys only from
  `main`.
- **Vercel Authentication protects all of these URLs.**
- **Previews and production share the one live Supabase project (NTER).**
  A preview that writes data writes real data.
- **After verification,** and with the owner's authorization for the push,
  the supervisor merges the branch into `main`, pushes `main`, and deletes
  the branch.

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

The current recovery checkout defines `npm test` (Vitest) and Edge Function
checks via `deno test -A --config supabase/functions/deno.json supabase/functions`.
There is no declared lint, standalone type-check or CI gate. Run focused checks
and the production build for code changes, and both suites for src/lib/,
src/admin/ or supabase/ changes. Use disposable local SQL targets for database
write tests. Exercise rejection paths, report missing gates, and never translate
“build passed” into “tests passed.”

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
- The recovery checkout README.md and AGENTS.md were reconciled locally in
  22ef26b. The original checkout retains its prior versions until integration;
  final E3 status and cross-link reconciliation remain pending.
- The repository has Vitest and Deno suites but no tracked GitHub workflow.
  `.oxlintrc.json` exists, but Oxlint is not declared as a package dependency
  or npm script.
- The 2026-09-20 clean build transformed 204 modules and emitted chunk-size
  and mixed-import warnings. Dependency installation also reported known audit
  findings; dependency remediation requires its own reviewed task.
- The repository is public and has a Vercel homepage. Public visibility is not
  permission to push, deploy, republish data, or assume tracked data is safe to
  redistribute elsewhere.
- The legacy Ask AI path was audited as a single non-streaming call without
  tool calling and with an eight-row desk context. The Supabase streaming path
  is a separate recovery implementation; do not apply that legacy finding to
  it. Read
  `docs/research/2026-09-20-ai-path-audit.md` before touching `src/ai/` or
  `server/aiApi.mjs`.
- The Supabase project `NTER` carries, as of 2026-09-21, the developer's six
  auth tables plus eleven AI tables under RLS, the `vector`, `pg_cron` and
  `pg_net` extensions, four deployed edge functions (`health`,
  `refresh-model-pricing`, `admin-models`, `ingest-documents`) and a twelve-hour pricing refresh.
  The AI backend is designed in
  `docs/specs/2026-09-20-ai-backend-foundation-design.md` and its three
  sibling specs; the executed foundation plan is
  `docs/plans/2026-09-21-ai-backend-foundation.md`.
- Schema changes are recorded under `supabase/migrations/`. **Updated
  2026-09-21:** live NTER migration history now ends at `20260921115831`;
  migrations 0012–0015 and the research-turn persistence migration were applied
  by the owner via `supabase db push`. (Superseded: they were local-only pending
  authorization.)
  `supabase link` is configured from the original checkout; function deployment
  is a separate production action, never implied by a local test or commit.
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
  module mounts it. (corrected 2026-09-24: it is now mounted —
  `src/ai/AiPanel.jsx` renders `WorkSurface`, which imports `SourceReader`
  and `RowSource` in `src/ai/WorkSurface.jsx`.) Plan: `docs/plans/2026-09-21-document-rag-and-citations.md`.
- The owner's complete corpus snapshot lives at
  `~/Downloads/NTER-Complete-Processed-Data` (10 GB, outside the repo). The
  OCR index is `04_indexes/OCR_FILES.csv`; the file-name → URL map is built
  from the corpus's own dataset records by `scripts/build-corpus-links.mjs`
  into `ingest/national-desk/links.json`, and `scripts/ingest-national-desk.mjs
  --corpus <dir> --feature "<feature>"` loads one feature at a time.
  Affidavits (95 percent of the OCR text) are deliberately not loaded; see
  `docs/research/2026-09-21-corpus-mapping-study.md` and
  `docs/plans/2026-09-21-corpus-ingest-first-pass.md`.
- The research agent is `supabase/functions/research-chat/` (handler, agent,
  prompt, answer decoder, citation ladder, repair, telemetry) with
  `_shared/{openrouterStream,handles,reasoningSegments,chatStream}.ts`.
  **Updated 2026-09-21: it is now DEPLOYED**, version 1, `verify_jwt = false`
  (the handler verifies the caller itself). A credential-free probe returns
  `401 {"error":"missing bearer token"}` and CORS preflight returns 204.
  (Superseded: it was under local recovery review and not deployed; D6
  reconciled index.ts and registration locally in 81e562e.) `AI_REPAIR_MODEL`
  is `google/gemini-3.5-flash-lite`, confirmed available in `model_pricing`.
  The existing browser recovery input is
  `src/lib/{researchChat,aiConversations,aiThreads}.js` and
  `src/ai/{ActivityTicker,CitationBubble,ModelPicker,WorkSurface}.jsx`,
  reached when `VITE_AI_BACKEND=supabase`. The legacy feature path is retained,
  with B4's reviewed account-ownership and login repairs also applying to its
  local stores, including aiChatStore.js. Persona
  prompts are copied into the function bundle by
  `node scripts/sync-personas.mjs` and a Vitest test fails when a copy
  drifts. Plan: `docs/plans/2026-09-21-streaming-research-agent.md`.
- Only evidence the server issued a handle for may be cited. A selection the
  browser sends is looked up in `desk_rows` before it becomes citable, and
  attachments never receive a handle, so text inside one cannot pose as a
  source. Markers that resolve to nothing are stripped.
- Desk rows live in `NTER`'s `desk_rows` as a snapshot of what the desks
  show (34,184 rows over 34 of the 75 navigation modules on 2026-09-21),
  loaded by `npx vite-node --config vitest.config.js scripts/load-desk-rows.mjs`
  (secret key from the environment; re-runnable; prunes rows a run did not
  touch). The loader drives the desk's own feed pipeline offline
  (`src/lib/deskRowsFeed.js`), because the desk re-keys and rebuilds rows
  for most packed modules; row identity is `src/lib/deskRows.js`
  `deskRowKey` (`rowPinKey` over the flattened row), mirrored in
  `_shared/deskRows.ts`. `search_desk_rows` (migration 0011) is the RPC;
  the tool is `_shared/tools/searchDeskRows.ts`; the module catalogue is
  `_shared/deskCatalog.json`, regenerated with `npx vite-node --config
  vitest.config.js scripts/build-desk-catalog.mjs` and guarded by a Vitest
  staleness test. Bill rows carry `document_key = bill:<year>:<number>`.
  Plan: `docs/plans/2026-09-21-desk-row-grounding.md`.
- `vite-node` strips the script path from `process.argv`; scripts that run
  under it are plain runners with their logic in an importable module. Use
  `--config vitest.config.js` so the dev server's auth plugin (which
  requires `.env.local`) does not start.
- A second checkout of the repo (a worktree) needs `.env.local` copied in
  for `vite build` and a `node_modules` symlink; the Vite dev server can
  run there on another port through `.claude/launch.json`.
- Do not run a bulk PostgREST load and the embedding ingest at the same
  time on `NTER`: on 2026-09-21 PostgREST answered 503 / "Could not query
  the database for the schema cache" for several minutes while both ran.
- `docs/` is tracked and published since 2026-09-27 (`f828ef5`, owner
  decision reversing the 2026-09-21 one); every clone has the specs, plans,
  research and this protocol. `docs/security/` stays local only because it
  describes unfixed vulnerabilities; never commit it. (Superseded: `docs/`
  was untracked and gitignored from 2026-09-21 to 2026-09-27.)
- `NTER` is a shared live project. Dashboard actions on it, especially
  under Authentication → Users, are announced before they happen; on
  2026-09-21 every user was deleted from the dashboard while another team
  member was verifying against them. **Correction (2026-09-21 supervisor
  audit, verified by live query):** the project now has 2 users, both
  created 2026-09-21 ~10:12 UTC — `niyantranai@gmail.com` and
  `nter-auth-test+1789985534982@gmail.com`. Both are `role=user`,
  `plan=explorer`, `status=active`, no persona, onboarding incomplete.
  There is no internal-admin account live. `user_profiles` has its own
  `id` primary key plus a `user_id` foreign key to `auth.users`; joining
  on `id` is wrong.
- 2026-09-21 supervisor audit of `NTER` (verified by live query): 2,337
  documents, 2,335 indexed, 2 unindexed, 51,057 chunks, latest
  `indexed_at` 2026-09-21T10:25:26.051Z. The two unindexed are
  `1f7ffc739c73a91f3fb346698a07b8bd618c20fa` (2006-93-Synop.pdf, 5,306
  chars) and `4dc99a9ba57d09577a0e7b0ac37651ed1bc3f0c8` (2006-16-gaz.pdf,
  "The Finance Bill, 2006", 969,286 chars); both have zero chunks,
  `chunker_version` null, and correct title/`file_url`/`document_key`/
  `content_sha256` matching the source OCR index. The oversized exclusion
  `ae6b11152a923ed75a90ab94312db82eab0b984d` (2003-6-gaz.pdf, 5,387,224
  chars) remains out under the 2,000,000-character cap.
- **Correction to the corpus-ingest plan's severity claim** (recorded here
  only; that plan is Historical and out of this scope to edit): its
  statement that "The Finance Bill, 2006" is "simply too heavy for this
  instance" is contradicted by execution evidence — `2011-8-gaz.pdf` at
  959,238 characters produced 741 chunks and indexed successfully at
  09:36:36 UTC during the single-process `--batch 2` pass. A
  ~970k-character document is a demonstrated-feasible single-process
  workload; the Finance Bill's repeated 503s are not explained by size
  alone.
- **By design, not a defect — do not "fix" these:** `document_chunks.metadata`
  is `{}` on all 51,057 rows because `supabase/functions/ingest-documents/
  handler.ts`'s `toCommitRow()` hardcodes `metadata: {}`; nothing reads it,
  it is a forward-compatibility slot. `document_chunks.page_number` is null
  on all rows because `chunkDocument()` builds one unit per document
  (`{unitKey:'document', sourceKind:'document'}`) with no page number; the
  field is plumbed end-to-end awaiting page-wise Markdown, and the reader UI
  never reads it — a chunk is a character span, not a page, so do not
  fabricate page numbers from a page count. `documents.page_count` is null
  on all 2,337 documents while `metadata.n_pages` is populated on all 2,337
  and is a verified total PDF page count (1–210), not a chunk-to-page map.
  Supervisor decision: leave `page_count` null; changing it needs an
  explicit ADR amendment and buys nothing today.
- Live `match_documents` has no `indexed_at` guard (verified 2026-09-21 by
  reading the deployed function definition). This is harmless only because
  both unindexed documents above currently have zero chunks. Migration 0014
  is a hard prerequisite before any re-ingest touches those two documents.
- `document_chunks` and `desk_rows` have never been ANALYZEd (`last_analyze`
  and `last_autoanalyze` both null as of the 2026-09-21 audit); repeated
  Postgres restarts reset the stats counters, so `n_live_tup` reads 31 for
  the 51,057-row `document_chunks` table and 0 for the 34,184-row
  `desk_rows` table. The planner is operating on stale statistics for both
  retrieval tables; do not use `n_live_tup` as a row-count proxy.
- Postgres restarted again at 2026-09-21 10:24:55 UTC, one minute before the
  final successful index — a third restart beyond the two already recorded.
  Same-audit sizes: `document_chunks_embedding_hnsw` is 380 MB, the total
  `document_chunks` relation is 853 MB, the database is 995 MB,
  `shared_buffers` is 224 MB (still Nano tier), `work_mem` ~2 MB,
  `maintenance_work_mem` 32 MB.
- Live security-advisor findings, unmitigated in production as of
  2026-09-21: `create_organisation` is executable by the `anon` role via
  `/rest/v1/rpc/create_organisation` and self-assigns owner and enterprise
  plan; also anon-executable: `is_platform_admin`, `get_my_profile`,
  `update_my_onboarding_profile`, `handle_new_user`, `is_org_member`,
  `is_org_owner`. `update_updated_at_column` and `debug_timeout` have
  mutable `search_path`. Supabase Auth leaked-password protection is
  disabled. **Supervisor correction 2026-09-21:** most of these ARE closed
  by the local recovery branch and are live only because it is undeployed.
  **Second correction, 2026-09-21: these are now CLOSED on the live database** —
  0012 and 0015 were applied, `anon` holds no table privileges at all, and
  anon-executable RPCs fell from 12 to 5. The text below describes what the
  migrations do and now reads as history.
  Migration `20260921000012_profile_authority.sql` revokes
  `create_organisation` from PUBLIC/anon/authenticated outright, revokes the
  other five RPCs from `anon` while granting them to `authenticated` and
  `service_role`, revokes `handle_new_user`, and fixes `search_path` on all
  six; `20260921000015_least_privilege.sql` revokes anon table and column
  access. Residual, not covered by any local migration:
  `update_updated_at_column` still has a mutable `search_path` (it is defined
  in migrations 0002/0003 and never altered), and Supabase Auth
  leaked-password protection is a dashboard setting with no SQL fix.
- `public.debug_timeout()` exists on the live database but appears in **no
  migration** in the repository — untracked production schema drift, created
  directly against `NTER`. It is one of the two mutable-`search_path`
  advisor findings. Decide deliberately whether to adopt it into a migration
  or drop it; do not silently remove it.
- (Superseded 2026-09-28 by "Supabase audit — 2026-09-28" at the end of this
  document; the versions and row counts in this entry are historical.)
  **Updated 2026-09-21 after E2**: deployed Edge Function versions are `health`
  v5, `refresh-model-pricing` v5, `admin-models` v5, `ingest-documents` v4 and
  `research-chat` **v1**. `research_turns` and `lookup/claim/finalize_research_turn`
  all exist live. `health` and `admin-models` rebuilt to byte-identical bundles,
  proving their earlier deploy already carried the modern-key code.
  (Superseded: v4/v4/v4/v3 with `research-chat` absent.) From the earlier audit:
  17 public tables, all RLS-enabled; `model_pricing` 446 rows, `ai_models`
  7 enabled, `ai_roles` 4, `desk_rows` 34,184, `conversations` 0,
  `chat_messages` 0, `model_call_logs` 2,383 rows totalling $0.2886
  (embeddings only — no chat spend yet).
- As of the 2026-09-21 audit: 21 worktrees registered, 26 local branches, 5
  remote-tracking refs. `main` is checked out in its own worktree under the
  session scratchpad (`…/7ffd58b0-…/scratchpad/wt-desk-rows`), clean. An
  earlier revision of this entry claimed that worktree was missing and needed
  `git worktree prune`; that was a supervisor misreading of a truncated
  directory listing, corrected the same day. No prune was performed. Local `main` @
  `7afd3ab` is 20 commits ahead of `origin/main` @ `63ef6a1`; nothing has
  been pushed. `origin/dev` @ `25723f7` is deliberately out of scope for
  current work. Two worktrees hold uncommitted, unaccepted work:
  `task/stream-reconcile` (D7 follow-up, `reconcileSavedTurn`, at
  `/private/tmp/niyantran-stream-reconcile`) and `task/research-panel` (D10
  panel integration, at `/private/tmp/niyantran-research-panel`).
  (corrected 2026-09-24: this entry is stale. `main` @ `7352148` equals
  `origin/main` — `git rev-list --left-right --count main...origin/main`
  returned `0 0`, and `git ls-remote origin refs/heads/main` returned the same
  hash — so `main` has been pushed. On 2026-09-24 there are 2 worktrees
  registered (the main checkout and one under `.claude/worktrees/`) and 2 local
  branches (`main`, `task/research-answer-once`).)
  (corrected 2026-09-28: the remote has exactly two branches, `main` and
  `dev`, and both point at `ca73200`; `git ls-remote --heads origin` returned
  the same hash for each. Upstream `528dfb4` is an ancestor of `main` (merged
  via PR #2, `8849c35`). The old `origin/dev` tip `25723f7` is also an
  ancestor of `main`, so the disabled service-role JWT it carried is now in
  `main`'s public history too; see the backlog's security section. Local
  worktree state of the owner's machine was not observable from this audit.)
- The review harness `review.config.mjs`/`review.probes.test.jsx` that the
  recovery plan cites as defining D7–D10 acceptance no longer exists in any
  worktree and is not tracked in git, as of the 2026-09-21 audit. D7/D10
  follow-on acceptance must rest on the slices' own tests plus fresh
  browser verification; do not imply the original ten probes were re-run
  when they were not.
- A new supervisor agent took over this project on 2026-09-21. The prior
  session ended on a usage limit with D7 and D10 written but unaccepted;
  treat their diffs as unreviewed pending the current supervisor's
  independent verification.


### Recovery status on 2026-09-21

The owner confirmed no competing developer/IDE worker remains active. Preserve
existing changes and review recovered commits; this does not grant deployment
or publication authority. The local recovery plan is the current status source.
**Updated 2026-09-21:** live migrations now end at `20260921115831` and all five
Edge Functions are deployed; the security and corpus repairs are live.
(Superseded: migrations ended at 0011 and the repairs were undeployed.) No matching local ingestion
worker was observed; remote worker state is unverified. There are 2,335 of
2,337 eligible records indexed; the two unindexed documents and the one
oversized exclusion are itemized with document keys and character counts in
the shared knowledge above, along with a correction to the corpus-ingest
plan's Finance Bill feasibility claim. No automatic restart or retry is
authorized.

A new supervisor agent took over this project on 2026-09-21, after the prior
session ended on a usage limit with D7 and D10 written but unaccepted; both
remain pending this supervisor's independent verification (see shared
knowledge above).

### Deployment architecture — established 2026-09-21 (E1 groundwork, E3 record)

> **Corrected 2026-09-28 (by reading the code at `ca73200`).** The table and
> the "three things" list below describe the pre-merge tree and are stale.
> Production now has one Vercel function, `api/router.js`, and `vercel.json`
> rewrites every `/api/*` path to it. The router imports handlers from
> `server/*.mjs` (auth, users, app flags, home, Live TV, nter.news ingest,
> marketing video, analytics, user prefs, billing, transit, diplomacy,
> assets, desk brief, legacy AI), so most of `server/` now **does** run in
> production. `src/lib/apiMode.js` also gained `homeLiveApiEnabled()` and
> `featureFeedApiEnabled()`, which default to **on** in production; only
> `liveApiEnabled()` keeps the old closed-by-default gate. Several routed
> handlers persist through `server/db.mjs` (SQLite) or JSON files under
> `writablePath()`, which is `/tmp/niyantran` on Vercel and is lost on cold
> starts. That breaks ADR 0005's rule that nothing durable is written to
> `/tmp`; the remedy is `docs/specs/2026-09-28-serverless-state-to-supabase.md`.

No document previously recorded how this application is actually served, which
made "why is Vercel needed" unanswerable from the repository. Established by
reading `vercel.json`, `vite.config.js`, `src/lib/apiMode.js` and the call sites.

**There are two different runtimes, and most of `server/` exists only in one.**

| | Development | Production (Vercel) |
| --- | --- | --- |
| App | Vite dev server | static SPA from `dist/` |
| `server/*.mjs` | **13 plugins serve `/api/*` live** (corrected 2026-09-24 from 14: `vite.config.js` lists 13 besides `react()`) | **do not exist** |
| `api/ai/*.js` | via `aiApiPlugin()` | 4 serverless functions |
| Desk data | live `/api/*` calls | `public/data/*.json` snapshots |

The switch is `liveApiEnabled()` in `src/lib/apiMode.js`:

```js
if (import.meta.env.VITE_LIVE_API === '1') return true;
if (import.meta.env.VITE_LIVE_API === '0') return false;
return Boolean(import.meta.env.DEV);
```

`import.meta.env.DEV` is **false** in a production build, so the deployed app
does not call the live feed APIs at all. It reads the committed snapshots under
`public/data/`. **This is why those files are production data, not fixtures**,
and why `AGENTS.md` forbids regenerating or relocating them without an approved
data-migration task. Routes such as `/api/rss`, `/api/portwatch`,
`/api/opensanctions`, `/api/fts`, `/api/user-prefs` and `/api/marketing/*` have
no Vercel handler; nothing calls them in production because the gate is closed.

**So Vercel is needed for three things, and only three:**

1. **Hosting the built SPA** with the history-fallback rewrite in `vercel.json`
   (any static host could do this).
2. **`api/ai/desk-brief.js`** — desk briefs are fetched from `/api/ai/desk-brief`
   in `src/lib/deskBrief.js` and have **no Supabase equivalent**. This is the one
   hard dependency: it survives `VITE_AI_BACKEND=supabase`.
3. **`api/ai/{chat,fetch,source-extract}.js`** — the legacy AI backend, used only
   when `VITE_AI_BACKEND` is not `supabase`. With the Supabase backend selected,
   chat goes to the `research-chat` Edge Function and these are dormant, but they
   remain the fallback path.

(Correction 2026-09-28: Vercel no longer needs `OPENROUTER_API_KEY`.
Desk briefs go through the `desk-brief` Edge Function, and `/api/ai/chat`
always forwards to `research-chat`. The Vercel project has no such key.)

**What E1 therefore has to confirm** is narrower than it sounds: that the Vercel
project builds from the intended repository and branch; that `OPENROUTER_API_KEY`
and the `VITE_*` variables are present in Vercel's environment under the names in
`.env.example`; that the four function routes resolve with their declared
`maxDuration`; and that the signup/email provider path (`AUTH_EMAIL_PROVIDER`,
Supabase native versus Resend) delivers. It is evidence-gathering with no code
write scope, and lacking access blocks only deployment verification.

### Owner decisions — 2026-09-24

2026-09-24 — Owner decisions: ItsCloudDev (upstream author) has left;
`upstream/main` (`528dfb4`) is frozen and will be integrated once, then
retired. OpenRouter is the only gateway for every LLM call, including legacy
server paths. Production will be relinked to a DDL Labs–owned Vercel project
building `ddllabs/niyantran` `main`; the current nter.pro Vercel project and
its settings are not accessible. Google sign-in will use Supabase Auth's
native Google provider with a DDL Labs–owned OAuth client. See
`docs/niyantran-conflict-audit-and-plan/01-decisions-adr-0005.md` and `docs/niyantran-conflict-audit-and-plan/03-upstream-integration-plan.md`.

### Supabase audit — 2026-09-28 (read-only, through the Supabase MCP tools)

Every figure here was observed by a live read-only query or tool call on
2026-09-28, unless it is marked as an inference. Nothing was deployed, applied
or changed.

- **Project:** `NTER` (`vfgcppstyzjarlzyqdac`), `ap-south-1`, Postgres 17.6,
  `ACTIVE_HEALTHY`. It is the only project on the account and has no Supabase
  branches. Postgres last started at 2026-09-22 08:49:34 UTC.
- **Deployed Edge Functions** (5), compared file by file with the repo at
  `ca73200`:

  | Function | Version | `verify_jwt` | Last deployed (UTC) | Against `ca73200` |
  | --- | --- | --- | --- | --- |
  | `health` | v6 | true | 2026-09-21 17:56 | identical |
  | `admin-models` | v6 | true | 2026-09-21 17:56 | identical |
  | `refresh-model-pricing` | v7 | false | 2026-09-22 12:20 | identical |
  | `ingest-documents` | v9 | false | 2026-09-22 09:25 | differs only in `_shared/chunking.ts` exports (built from `a030847`, one commit before `3a1e565`); same logic |
  | `research-chat` | v28 | false | 2026-09-23 02:12 | identical (32 files) |

  `supabase/functions/desk-brief/` (added in `5e54af2`) is **not deployed**.
  The `false` settings are by design: those handlers verify the bearer
  themselves.
- **Migrations:** the live history has 24 entries, the same set as
  `supabase/migrations/`, with one version mismatch. The live history records
  `20260922121946_reasoning_efforts_from_catalogue`; the repo file is
  `20260922183000_reasoning_efforts_from_catalogue.sql`. The statements are
  the same: live 6,484 characters against 6,472 for the repo file with
  comments and blank lines stripped. Until the repo file is renamed, `supabase
  db push` will see it as pending and re-run it, and its final statements
  reset `ai_models.efforts`. **Resolved 2026-09-28:** the repo file was
  renamed to `20260922121946_reasoning_efforts_from_catalogue.sql`, with
  identical content. The first 24 repo versions now equal the live history
  exactly, so a push applies only newer migrations.
- **Row counts** (`count(*)`, not planner estimates):

  | Table | Rows |
  | --- | --- |
  | `documents` | 2,338 |
  | `document_chunks` | 54,219 |
  | `desk_rows` | 34,184 |
  | `ai_models` (all enabled) | 8 |
  | `ai_roles` | 4 |
  | `auth.users` | 8 |
  | `user_profiles` | 8 |
  | `research_turns` | 61 |

  `list_tables` reports `desk_rows` 0, `ai_models` 1 and `ai_roles` 0, because
  it reads `n_live_tup`. `desk_rows` has never been analysed since the restart
  (`last_analyze` and `last_autoanalyze` are both null). Run the AGENTS.md
  `ANALYZE` set; that is a production action and needs the owner's go-ahead.
- **Models:** the default is `google/gemini-3.7-flash` (role
  `VISUAL_RESEARCH`); `google/gemini-3.5-flash-lite` holds `DEFAULT_ANALYST`
  and `PDF_PARSER`; `openai/gpt-6-astra` holds `EXPERT_ESCALATION`. Also
  enabled: `anthropic/claude-sonnet-5`, `deepseek/deepseek-v4-flash`,
  `deepseek/deepseek-v4-pro`, `google/gemini-2.5-flash-lite` and
  `google/gemma-4-31b-it`.
- **Security advisors:**
  - INFO: `research_turns` has RLS enabled with no policy. It is service-role
    only; confirm that this is intended.
  - WARN: six `SECURITY DEFINER` RPCs are executable by `authenticated`
    (`ai_health`, `get_my_profile`, `is_org_member`, `is_org_owner`,
    `is_platform_admin`, `update_my_onboarding_profile`). This is the
    intended residue of migration 0012; review `ai_health`.
  - WARN: leaked-password protection is disabled.
  - None are `anon`-executable. The earlier `debug_timeout` and `search_path`
    findings are gone.
- **Not in Supabase at all:** there are no tables for application
  preferences, analytics events, invoices, app flags, nter.news articles or
  the marketing video, and there are no Storage buckets
  (`storage.buckets` is empty). Those stores live
  under `/tmp` on Vercel (see the deployment-architecture correction above).

### Operations — 2026-09-28 (later the same day)

Observed through the Supabase and Vercel tools at about 17:05 UTC unless
marked otherwise. This supersedes the function table above.

- **Compute:** the owner upgraded NTER to a 2 GB instance.
- **Edge Functions:** `health` v7, `admin-models` v7, `refresh-model-pricing`
  v8, `ingest-documents` v10, `desk-brief` v2 (now deployed) and
  `research-chat` **v32** (corrected 17:40 UTC; this line first said v30).
- **Chat outage, 16:26–17:34 UTC.** `research-chat` v30 (16:26) and v31
  (17:29) were deployed through a one-line entry that only imported
  `research-chat/index.ts` from GitHub at a pinned commit. That module serves
  only when it is the entry (`if (import.meta.main)`), so both versions
  booted and never answered: a probe through `pg_net` timed out after 30 s.
  v32 (17:34) imports `createResearchHandler` from `main` at `93f31e6` and
  calls `Deno.serve` itself. The same probe then got **401**
  `missing bearer token` with the production origin in
  `access-control-allow-origin`. No chat turn was attempted in the window
  (the last `model_call_logs` row is 15:31). v32 includes the admin persona
  probe. The emergency deploy form and its checks are now in
  `agents/rollback-runbook.md`. A CLI deploy would still make the dashboard
  show the real files (plan A1).
- **Edge Function secret:** `ALLOWED_ORIGINS` now includes the production
  site and `http://localhost:5173` (set by the owner).
- **Migrations:** 31 applied, the last four today: `signup_persona`,
  `analytics_rate_limit`, `invoices`, `nter_news_articles`. Each version was
  pinned to its repository file name after the tool stamped the apply time.
- **Test personas:** five profiles that had no persona were given one each
  for persona-injection testing, and a sixth account uses Academic. The
  count is now one per persona and three profiles without one; those three
  see the persona chooser once at their next sign-in (`c24d379`).
- **Vercel:** production follows `main` (`niyantran-six.vercel.app`); every
  other branch gets a preview URL. `NTER_TERMINAL_API_KEY` is still unset
  there (plan C2).
- **CI:** `.github/workflows/ci.yml` (advisory) runs on every push from
  `a47680e`.
- The work is tracked in `docs/plans/2026-09-28-remaining-work.md`, with the
  review in `docs/specs/2026-09-28-authorization-review.md`.
