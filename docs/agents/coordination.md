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
Open work is tracked only in `docs/plans/open-work.md` (since 2026-09-29): a
plan or spec may describe a task in detail, but the task is tracked only when
it has a line there.

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
`npm run lint` (ESLint) fails on any error or warning; there is no standalone
type-check. (corrected 2026-10-01: an advisory CI workflow,
`.github/workflows/ci.yml`, runs lint, the build, both suites and
`npm run test:sql` on every push; it blocks nothing.) Run lint, focused checks
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
  (corrected 2026-09-28: this folder does not exist; superseded plans and
  records currently stay where they are, marked Historical.)

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
  (corrected 2026-09-28: `.github/workflows/ci.yml` is an advisory workflow
  running the build, both suites and the SQL fixtures on every push.)
  `.oxlintrc.json` existed, but Oxlint was never a dependency or npm script
  (removed 2026-09-29; `npm run lint` is ESLint).
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
  Resend domain is set (see the plan's launch gates). (corrected 2026-09-28:
  the marketing pages call Supabase Auth directly from the browser
  (`signInWithPassword`, `signUp`, `resetPasswordForEmail`, `updateUser`);
  `server/authApi.mjs` is mounted only by the Vite dev server, and
  `api/router.js` has not served `/api/auth/*` since `93f31e6`. The email
  domain and `SITE_URL` are plan task D2.)
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
  `_shared/{openrouterStream,handles,reasoningSegments,chatStream}.ts` (corrected 2026-09-29: `reasoningSegments` had no callers and was deleted, open-work F16).
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
  local stores, including aiChatStore.js. (corrected 2026-09-28: this is the
  only path now. `14b2344` retired the legacy AI path and `VITE_AI_BACKEND` is
  no longer read; the panel calls `research-chat` through
  `src/lib/aiClient.js`. `f05a5b6` deleted `aiChatStore.js`.) Persona
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
  `main`'s public history too; see the backlog's security section, now
  `docs/plans/open-work.md` §5. Local
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
>
> (corrected 2026-09-28, later: the router no longer mounts auth (`93f31e6`),
> app flags (`9e7a125`) or the legacy AI chat and fetch routes (`14b2344`,
> `def5f71`). Preferences, analytics, users, the marketing video, invoices
> and nter.news articles now persist in Supabase (plan tasks T1–T6).
> `server/db.mjs` (SQLite) is imported only by `server/deskBrief.mjs`, whose
> brief cache is the one remaining `/tmp` store (T7); the home snapshot and
> STAT-1 files under `writablePath()` are caches, not durable state
> (`862c995`). `src/lib/apiMode.js` is unchanged from the description above.)

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
Desk briefs go through the `desk-brief` Edge Function. Later the same day
plan task D4 retired the legacy AI path: `/api/ai/chat` and `/api/ai/fetch`
are gone, `VITE_AI_BACKEND` is no longer read, and the panel and the admin
persona probe call `research-chat` directly. The Vercel project has no such
key.)

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
  (Superseded by the Operations entry below: `desk-brief` v2 is deployed.)
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
  `VISUAL_RESEARCH`) (superseded later on 2026-09-28: the default and
  `VISUAL_RESEARCH` are now `google/gemini-3.8-flash`, with 3.7 kept
  disabled; see `docs/niyantran-conflict-audit-and-plan/04-open-backlog.md`); `google/gemini-3.5-flash-lite` holds `DEFAULT_ANALYST`
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
  (Superseded later on 2026-09-28; see the Operations entry below. The day's
  migrations added
  `user_preferences`, `analytics_events`, `app_flags`, `invoices`,
  `nter_news_articles` and the public `marketing` bucket.)

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
- **`user_preferences.ai_chats` cleared** (owner decision, ~19:00 UTC):
  `update public.user_preferences set ai_chats = null where ai_chats is not
  null` changed 4 rows; afterwards 0 rows hold `ai_chats` and all 4 keep their
  `tours`. Nothing reads the column since `f05a5b6`. Dropping it is planned
  for about a week later.
- **Vercel:** production follows `main` (`niyantran-six.vercel.app`); every
  other branch gets a preview URL. `NTER_TERMINAL_API_KEY` is still unset
  there (plan C2).
- **CI:** `.github/workflows/ci.yml` (advisory) runs on every push from
  `a47680e`.
- The work is tracked in `docs/plans/2026-09-28-remaining-work.md`, with the
  review in `docs/specs/2026-09-28-authorization-review.md`. (Superseded
  2026-09-29: open work is now tracked only in `docs/plans/open-work.md`.)

### Operations — 2026-09-29

- **Migration 32:** `20260929100000_plan_entitlements` (plan task F2) was
  applied to NTER through the MCP tool after `npm run test:sql` passed on the
  disposable databases. Its version was pinned to the file name.
  - Before the apply, all 10 profiles were explorer; afterwards all 10 read
    `explorer`/`free`.
  - A rolled-back probe as a signed-in user read its own entitlement and was
    refused both a direct plan update (`42501`) and `grant_paid_plan`
    (`42501`), and could not read `plan_grants`.
- **Razorpay** is still unconfigured, so checkout says payments aren't
  enabled. A payment grants a plan only once the keys exist on Vercel.
  Server-side gating of desk data, exports and row caps (plan task F6) comes
  first.
- **`ALLOWED_ORIGINS` probe** (through `pg_net`): production and
  `http://localhost:5173` got an `access-control-allow-origin` header; the
  Vercel preview and deployment hostnames and other localhost ports got none.
  The deployed `_shared/cors.ts` (as on `main` at `71292af`) matches exact
  origins only, so every Vercel preview is refused by `research-chat` and
  `desk-brief`. Tracked as open-work F8, then
  owner action O5.
- **Open work** is now tracked only in `docs/plans/open-work.md`, which
  replaces `plans/2026-09-28-remaining-work.md` and
  `niyantran-conflict-audit-and-plan/04-open-backlog.md` as the tracker.
- **Edge Functions redeployed (~12:30 UTC):** all six from `main` at `d1567d1`
  (F8 preview-origin CORS, F9 no legacy keys, F12 chunker version 2), through
  pinned-commit entries: `health` v8, `admin-models` v8,
  `refresh-model-pricing` v9, `ingest-documents` v12, `desk-brief` v3,
  `research-chat` v33. Probed through `pg_net` without credentials:
  `research-chat` and `desk-brief` answered 401 `missing bearer token`,
  `ingest-documents` 401 `service key required` and `refresh-model-pricing`
  401 `refresh secret required`, each with the production origin in
  `access-control-allow-origin`. A preview origin is still refused until the
  owner adds the pattern to `ALLOWED_ORIGINS` (open-work O5). `health` and
  `admin-models` keep `verify_jwt`, so an unauthenticated probe stops at the
  gateway; their boot is confirmed by the next authenticated call.
- **Migration 33:** `20260929110000_email_unique` (open-work F10) applied and
  pinned; `user_profiles_email_normalised_key` is unique and the old
  non-unique index is gone. NTER had no duplicate normalised emails
  (10 profiles) before the apply.
- **Migrations 34 and 35 (F22):** `20260929120000_halfvec_index` built
  `document_chunks_embedding_halfvec_hnsw` (204 MB, valid; Postgres did not
  restart). Measured on 20 queries against an exact scan of 54,219 chunks:
  recall@40 was 0.9875 (worst 0.925) on the new index against 0.990 (worst
  0.950) on the old one, and mean latency 161 ms against 224 ms (exact scan
  782 ms). `20260929120100_match_documents_halfvec` then moved the unscoped
  branch of `match_documents` onto it and dropped the 404 MB index. After
  `analyze`, a live call as `service_role` returned 40 rows unscoped (143 ms)
  and 40 scoped (3 ms), each with the self-match at similarity 1.0.


### Operations — 2026-09-29 (evening, local session on the owner's laptop)

Authorised by the owner for this cleanup: pushes of verified commits to
`main`, the F1 and C3 changes, the `ALLOWED_ORIGINS` secret, the CLI
redeploys and deleting the two merged GitHub branches. Times are UTC.

- **O3:** `task/docs-pass` (`4cfc876`) and `task/f2-server-entitlements`
  (`71292af`) deleted on GitHub after checking both were ancestors of
  `origin/main`. `origin` now has only `main`.
- **O5 (16:44):** `ALLOWED_ORIGINS` set to
  `https://niyantran-six.vercel.app,http://localhost:5173,https://niyantran-*-ddl-labs.vercel.app`
  with `supabase secrets set`. The old value's SHA-256 matched the documented
  two-origin value, and the new digest matches the new value. Probed without
  credentials, `research-chat` and `desk-brief` gave production, a
  deployment host (`niyantran-m58en4lu1-ddl-labs.vercel.app`) and a branch
  host (`niyantran-git-task-foo-ddl-labs.vercel.app`) an
  `access-control-allow-origin` header, and `https://evil.example.com` and
  `http://localhost:5174` none; every body was the handler's own 401.
- **A1 (16:45):** all six Edge Functions redeployed with the standard CLI
  (`supabase functions deploy <name> --use-api`, Supabase CLI 2.117.0) from
  `main` at `b60c0dc`, whose function code differs from `d1567d1` only by
  the deleted, unused `reasoningSegments` module. The dashboard now shows
  the real files (entrypoint `supabase/functions/<name>/index.ts`). Versions:
  `health` v10, `admin-models` v10, `refresh-model-pricing` v11,
  `ingest-documents` v14, `desk-brief` v5, `research-chat` v35; each went up
  by two, because the server-side bundle uploads twice. `verify_jwt` is on
  for `health` and `admin-models` and off for the other four, as in
  `supabase/config.toml`. Probes: `research-chat` and `desk-brief` answered
  401 `missing bearer token`, `ingest-documents` 401 `service key required`,
  `refresh-model-pricing` 401 `refresh secret required`, all with the
  production CORS header. `health` and `admin-models` stopped at the gateway
  without a token; with the public publishable key as bearer they answered
  `malformed token` from `_shared/auth.ts`, so both handlers serve.
- **F1 migration 36 (16:50):** `20260929130000_drop_ai_chats` applied
  through the MCP tool and its version pinned to the file name. Before:
  0 of 4 `user_preferences` rows held `ai_chats`, and its size check was its
  only dependent. After: the columns are `user_id, watchlist, tours,
  updated_at`, the two remaining checks are intact, and all 4 rows keep
  `tours`. `npm run test:sql` passed all 16 fixtures before the apply,
  including the new `drop_ai_chats` fixture with its vacuity check.
- **C3 on Vercel:** production deployed `31c3915` (SQLite and `sql.js`
  removed) as READY. `/api/home/segments` and `/api/marketing/intro-video`
  answered 200, and there were no runtime errors in the following hours'
  window.
- **Not production, recorded for the next session:** the local Supabase
  stack used for F17 was started from a scratch copy of `supabase/` with
  `backend/sql/auth_schema.sql` as migration zero (the migrations don't
  create `user_profiles`) and migration 0007 without its cron job, which
  would otherwise call production's `refresh-model-pricing` from the laptop.
  The stack and the two fixture containers were stopped afterwards; the
  Supabase images (about 3 GB) remain in Docker.
- **Sandbox note for local sessions:** the Supabase CLI, Docker and Node
  `fetch` to local or remote hosts fail inside the Claude Code sandbox (the
  CLI crashes at start, the Docker socket is refused, and Node ignores the
  proxy). They work outside it: the CLI is logged in on this laptop and
  linked to NTER.
- **Auth redirect URLs (owner, ~17:45 UTC):** the owner added
  `http://localhost:5173/**` and `https://niyantran-*-ddl-labs.vercel.app/**`
  in Authentication → URL Configuration; the site URL stays
  `https://niyantran-six.vercel.app`. Checked read-only at 17:47 UTC: a
  PKCE Google authorize request from each origin (never completed) stored
  `auth.flow_state.referrer` equal to that origin for production, the
  `main` alias, a preview deployment and localhost, and the production URL
  for `https://evil.example.com`. `ALLOWED_ORIGINS` was unchanged since
  16:44 UTC (same digest). Leaked-password protection stays off by the
  owner's decision.

### Operations — 2026-10-01 (RAG v2 part 1: eval and retrieval-scope)

Authorised by the owner step by step. Times are UTC.

- **Evaluation assets** (open-work R1, pushed at `50207cc`):
  - `eval/retrieval/questions.v1.jsonl`: 195 questions, frozen, with their vectors;
  - `scripts/eval-retrieval.mjs`;
  - the live baseline in `docs/research/2026-09-30-retrieval-baseline.md`:
    broad doc@10 157/184, focused chunk@10 97.8%.
- **Local replica** for measurement: database `niyantran_retrieval_replica` in
  `niyantran-corpus-test-db` (`scripts/eval-replica/`). It is a read-only copy of NTER's
  documents (without `ocr_text`) and chunks. The container's `shared_buffers` was raised to
  512 MB with `ALTER SYSTEM`. It is only compared with itself.
- **Migration 37** `20261001100000_match_documents_feature`:
  - Applied through the MCP tool; its version is pinned to the file name.
  - The first attempt failed and rolled back in full. NTER refused `SET hnsw.ef_search` in
    a function's SET clause for a non-superuser ("permission denied to set parameter").
    The helper `match_documents_feature_hnsw` now uses
    `set_config('hnsw.ef_search','400', true)` and restores the caller's value before
    returning; the fixture proves the restore.
  - `match_documents` now takes `p_desk_feature`. It uses hybrid X: an exact scan when the
    feature has at most 15,000 chunks, else HNSW at `ef_search` 400
    (`docs/research/2026-10-01-feature-filter-measurements.md`).
  - `document_modules()` was added.
  - Each function has exactly one overload, with no anon or PUBLIC execute.
  - Verified live as `authenticated`: an old-style call returns 40 rows, the PQ, Budget
    and Bills filters return full in-feature results, and `ef_search` is restored to 40.
  - The eval after the migration was "no worse" in every mode.
  - A small wart: `match_documents`' inline comment still says the helper applies N "in
    its SET clause". The helper's own comment is correct. Fix it at the next redefinition.
- **`research-chat` redeployed** from `2d4f9bd` with
  `supabase functions deploy research-chat --use-api` (CLI 2.117.0). This deploys T9a and
  T9b: document chips, one scope from ids and keys with an `indexed_at` check,
  `document_modules()`, desk-focus feature scope, `feature-empty` widening and `scopeSent`.
  An unauthenticated probe gave 401 `missing bearer token` with the production CORS header.
- **Frontend:** `main` pushed at `6f1b94b`, and the Vercel production deploy is READY. T10
  added "Ask about this document", document chips, the switch of focus to Attached, and the
  "Desk" label. The rollback candidate is `50207cc`.
- **Live eval after the deploy,** all four modes: "no worse" against the baseline. With the
  desk filter, doc@10 is 171/184 against broad's 157, with Industry 12/12 and Budget 3/3.
  Every filtered call returned full results. Filtered-search p95 from the laptop is 814 ms,
  mostly the Regulatory exact path (733 ms on the server).
- **Not verified by an agent:** the button and notice in a signed-in browser session. The
  owner is to check them.
- **Found and recorded:** open-work F35. NTER's unscoped HNSW search has a recall@40 of
  0.913 against exact search.

### Operations — 2026-10-01, later (RAG v2 part 1: chunk-contract)

Authorised by the owner as one four-step sequence, stopping at the first failure.

- **Migration 38** `20261001120000_page_contract`:
  - Applied through the MCP tool; its version is pinned to the file name.
  - It adds `documents.storage_path`, `file_sha256`, `extract_hash`, `source_mime`, and
    `document_chunks.block_ids`, `image_ids`, `embed_hash`.
  - It creates `document_pages`, `document_page_blocks` and `document_page_images`, with
    RLS and authenticated SELECT only.
  - `chunk_commit` now refreshes the page columns on a hit, replaces the vector when a row
    carries one, and refuses a changed `embed_hash` that arrives without a new vector.
  - `match_documents` and its helper are recreated with `block_ids`, `image_ids` and
    `section`.
  - Tested as a non-superuser in `npm run test:sql` (the `page_contract` fixture).
  - Verified live as `authenticated`:
    - the old-style call returns 40 rows, with the new columns null for all 2,338
      existing documents;
    - the Bills and Industry filters return full results;
    - `ef_search` is restored;
    - there is exactly one overload of each function;
    - `chunk_commit` is service_role only;
    - the new tables are empty.
  - Note: the function bodies applied live omit some of the repository file's inline
    comments inside the `match_documents` branches. Behaviour is identical; the
    repository file is the reference text.
- **`research-chat` and `ingest-documents` redeployed** from `b9bcb6c` with
  `supabase functions deploy <name> --use-api --project-ref vfgcppstyzjarlzyqdac`.
  - Probes: 401 `missing bearer token` and 401 `service key required`, each with the
    production CORS header.
  - A dry run of `ingest-documents` for an unknown key read the new `extract_hash` column
    without error, returned `dry_run` with a `refused` counter in the totals, and wrote
    nothing: 2,338 documents and 54,219 chunks, unchanged.
- **Frontend:** `main` pushed at `b9bcb6c`, and the Vercel production deploy is READY. It
  adds `sanitizeCitation` and the optional citation fields.
- **Live eval after the deploy,** all four modes: "no worse" against the 2026-09-30
  baseline.
- Nothing is page-aware yet, so users see no change. The contract waits for `ingestion-v2`.

### Operations — 2026-10-01, night (RAG v2 part 2a: ingestion-v2, first document)

Authorised by the owner: "apply the migration … do everything else", with no bulk
ingestion. Code from `task/rag-v2-ingestion-v2` at `3a5655a`. Local end-to-end run first:
`docs/research/2026-10-01-ingestion-v2-local-run.md`.

- **Migration 39** `20261001140000_ingestion_v2`:
  - Applied with `supabase db query --linked` in one transaction, together with its
    `schema_migrations` row, so the version is the file name.
  - It creates the private `corpus` bucket (50,000,000 bytes; PDF, JPEG, PNG, WebP; no
    object policies), `document_files`, `document_ocr_pages` and `ingest_jobs` (RLS on),
    and the six `ingest_*` functions.
  - Verified live: the functions are security definer with only `search_path` set; only
    service_role executes them; service_role can only SELECT `ingest_jobs`; authenticated
    can SELECT `document_files` only.
  - The security advisor adds only an INFO "RLS enabled, no policy" for the two
    service-only tables, which is intended.
  - Before and after: 2,338 documents and 54,219 chunks; no jobs.
- **Worker secret:** run with `scripts/ingest-ops.sh secret` on the owner's instruction.
  `INGEST_WORKER_SECRET` and the Vault copy `ingest_worker_secret` have the same fingerprint,
  `bb474de1`; the value was never printed. `MISTRAL_API_KEY` was set by the owner earlier
  (fingerprint `97aea555`).
  - `ingest-ops.sh` needed `--linked` with `--project-ref`; fixed in `3a5655a`.
- **Deployed** `ingest-worker` (new; `verify_jwt` off) and `ingest-documents` (it now also
  refuses a document with `storage_path` set) with
  `supabase functions deploy <name> --use-api`.
  - Probes: the worker gives 405 on GET, and its own 401 `unauthorized` with no secret or a
    wrong one; `ingest-documents` gives 401 `service key required`.
- **First document:** The Classified Information and Espionage Control Bill, 2025 (Rajya
  Sabha, as introduced).
  - It keeps the corpus record's own key, `9fca8fe3ef9a99ccad71710b9ba7c0a810ac1f4f`,
    so `acquisition` (R7) will find it rather than add it again. Filed under national /
    *Bill Passage Probability Index*.
  - Registered with `scripts/ingest-register.mjs --target nter`, and uploaded to
    `corpus/files/cf4621b3….pdf`.
  - Two manual kicks (`ingest-ops.sh kick`, secret read from Vault in the database):
    - OCR of 12 pages through a signed URL, `mistral-ocr-4-1`, $0.048;
    - then the index step: 40 chunks, 6,964 tokens, $0.000139, activated.
  - Verified: the job succeeded; 12 pages, 176 blocks, 40 chunks all linked to blocks, and
    0 chunk spans differ from `ocr_text`. `model_call_logs` has both calls.
  - Now 2,339 documents and 54,259 chunks, exactly +1 and +40.
  - `match_documents` as authenticated finds it with page, blocks and section in the
    focused, feature (*Bill Passage Probability Index*) and broad modes.
- **The schedule is off:** no `ingest-worker` cron job exists. Nothing else is queued.
- **Still open:** the owner's signed-in citation check. The PDF viewer and page UI are R6.

### Operations — 2026-10-01, early hours (RAG v2 R8: admin upload, B6 steps 1–4)

Authorised by the owner: "Go ahead with B6, do everything except my upload". Code from
`main` at `75eb2cf`. Local end-to-end run first: `docs/research/2026-10-01-admin-upload-local-run.md`.

- **Migration 40** `20261001160000_ingest_discard`:
  - Applied with `supabase db query --linked` in one transaction, together with its
    `schema_migrations` row.
  - `ingest_discard(uuid)` is security definer with only `search_path` set, and only
    service_role may execute it.
  - The partial index `documents_file_sha256` was created.
  - Counts are unchanged: 2,339 documents, 54,259 chunks, 1 job.
- **Deployed `admin-ingest`** (new; `verify_jwt` off; admin check in the handler) with
  `supabase functions deploy admin-ingest --use-api`.
  - Probes from `https://niyantran-six.vercel.app`:
    - preflight 204, with that exact origin allowed;
    - no token: the function's own 401 `missing bearer token`, with production CORS;
    - a malformed bearer: 401.
  - From `https://evil.example.com`: no `access-control-allow-origin`.
  - The admin-only 403 path was proven locally on all seven actions. Agents don't sign in
    to production.
- **Frontend:** `main` pushed at `75eb2cf`, and the Vercel production deploy is READY.
  - The admin panel's new **Documents** tab ships as a lazy chunk,
    `DocumentsPage-HmMf-9M4.js` (34.5 KB). It contains the `admin-ingest` calls.
  - The main bundle contains no pdf-lib or pdfjs code.
- **Schedule ON:** `scripts/ingest-ops.sh schedule on` created cron job 4, `ingest-worker`,
  every 30 s.
  - Its command reads the secret from Vault at run time; no secret is stored in the job.
  - The first three runs succeeded, and the worker answered 202 to each. They were idle
    passes, with no jobs queued.
  - To stop it: `scripts/ingest-ops.sh schedule off`.
- **Remaining (owner):** step 5. Sign in to `/admin`, open Documents, and upload
  `ingest/pilot/budget-at-a-glance.pdf` with "split every 10 pages" (3 parts, about $0.10).
  Then check citations on pages 10 and 11 in the chat. After that, R8 is done.

### Operations — 2026-10-01, morning (R8 go-live fixes)

The owner's first production upload attempt surfaced two problems; investigated and fixed with
the owner's go-ahead ("Go").

- **Data fix:** the 12-page bill registered in I8 had no `document_key`, so its desk row
  (`bill:2025:XLV`) showed "Record only", and a dropped row widened to the whole corpus.
  - `metadata.document_key = 'bill:2025:XLV'` was set on document `7d30c003…` (one row; guarded
    on its id, its source key and an absent key).
  - Verified as `authenticated`: the UI's coverage lookup finds the key, and a search scoped
    to it returns only the bill's pages.
  - The UI caches coverage per session, so a page reload is needed.
- **Admin panel fix, deployed:** `main` pushed at `dcf7034`, and the Vercel production deploy is
  READY.
  - The cause: every window focus (closing the file picker included), and the same-user
    `SIGNED_IN` supabase-js emits on refocus, re-verified the admin by first closing the panel.
    That unmounted the open page, and the Documents tab lost the chosen file and form.
  - NTER logs for 06:41–06:53 show 22 tab mounts and no upload request.
  - Now: same-user re-checks run quietly, and a failed result still closes access at once. An
    account change still clears access synchronously.
  - Evidence:
    - four new tests, each red first, and all 105 admin tests pass;
    - in the browser, the old code lost the plan summary on one focus event; the fix kept it
      through three focus events and a real token refresh;
    - an upload completed with focus events fired during it.
- **Still open:** Amendment A to the admin-upload spec (link an upload to its desk record),
  drafted for the owner. The owner's *Budget at a Glance* run is still to do.

### Operations — 2026-10-01, midday (R8 Amendment A, C6 step 1: migration 41)

Authorised by the owner: "Apply migration 20261001180000_corpus_records to NTER". Code from
`task/admin-records` at `0768d33` (migration last changed in `249bd6e`). Local end-to-end run
first: `docs/research/2026-10-01-admin-records-local-run.md`.

- **Before:** the last migration was `20261001160000`. NTER held 2,339 documents and 54,259
  chunks, one ingestion-v2 document (the bill, `bill:2025:XLV`), no duplicate keys and no
  active jobs. The worker schedule was on.
- **Migration 41** `20261001180000_corpus_records`:
  - Applied with `supabase db query --linked` in one transaction, together with its
    `schema_migrations` row (version, name and the file as its one statement).
  - **New objects:**
    - `corpus_admin_actions` (RLS on, empty);
    - the D2 partial unique index `documents_v2_document_key_unique`;
    - `ingest_jobs_document_created`.
  - **Functions and execute rights:**
    - `ingest_link`, `ingest_unlink`, `ingest_swap`, `ingest_delete` and `ingest_discard(uuid, uuid)`
      are security definer;
    - `ingest_register` is replaced and security definer;
    - `admin_desk_records` and `admin_unlinked_documents` are security invoker;
    - all eight are executable by service_role and by neither anon nor authenticated.
- **After:**
  - counts are unchanged: 2,339 documents and 54,259 chunks;
  - the bill keeps `bill:2025:XLV`, and `admin_desk_records` returns it as `full_text`;
  - coverage reads 9,415 keys, 1,236 with full text and 0 orphaned; the unlinked list is empty;
  - `ingest-worker` cron runs after the migration succeeded.
- **C6 step 2 (owner: "Deploy admin-ingest to NTER"):** `admin-ingest` deployed from
  `task/admin-records` at `a306d5d` with `supabase functions deploy admin-ingest --use-api`. It is
  version 2, ACTIVE, with `verify_jwt` off (the handler checks the admin).
  - **Probes from `https://niyantran-six.vercel.app`:**
    - preflight 204, with that exact origin allowed;
    - no token: the function's own 401 `missing bearer token`, with production CORS;
    - a malformed bearer: 401.
  - **From `https://evil.example.com`:** 204 with no `access-control-allow-origin`.
  - The new actions (records, unlinked, link, unlink, swap, delete) and the admin-only 403 were
    proven locally (C5). Agents don't sign in to production.
- **C6 step 3 (owner: "Push main to origin"):** `main` was fast-forwarded from `8714320` to
  `c9b4644` (19 commits from `task/admin-records`, including the F43 fix) and pushed.
  - **Vercel:** production deploy `dpl_12EbgpkciGMgdVKMYmar3BRHsPrj` is READY and aliased to
    `niyantran-six.vercel.app`. The rollback candidate is the `8714320` deploy.
  - **Served page:** production serves the lazy chunk `DocumentsPage-BYR_OfOP.js` (59.9 KB). It
    contains the records view, "Documents without a record", Swap, the stale-refresh message and
    the keyless-desk upload.
- **Still to do:** step 4, the owner's three signed-in checks. Then R8 is marked done.
- **Safe in between:** the deployed `admin-ingest` works with the new SQL, because
  `ingest_discard`'s `p_actor` has a default.

### Operations — 2026-10-01, evening (R6 citations-pdf, V8 step 1: `document-file`)

Authorised by the owner: "Deploy document-file to NTER". Code from `task/rag-v2-citations-pdf`
at `f28e619`. Local end-to-end run first: `docs/research/2026-10-01-citations-pdf-local-run.md`.

- **Deployed `document-file`** (new; `verify_jwt` off; `requireUser` in the handler) with
  `supabase functions deploy document-file --use-api`. No migration: the tables and grants it
  reads already exist.
- **Probes from `https://niyantran-six.vercel.app`:**
  - preflight 204, with that exact origin allowed;
  - no token: the function's own 401 `sign in to open this document`, with production CORS,
    `cache-control: no-store` and `x-content-type-options: nosniff`;
  - a malformed bearer: 401.
- **From `https://evil.example.com`:** 204 with no `access-control-allow-origin`.
- **Hosted Storage range check.** A 60-second signature was minted for the live Anti-Doping
  part, `files/fadd34c6….pdf` (591,389 bytes), and probed with the production origin; the token
  was not printed.
  - The `Range` preflight returned 200, allowing the `range` header for any origin.
  - Three ranges (start, middle, end) each returned **206** with exactly the requested bytes and
    no content encoding.
  - The signed path matches the client's strict pattern.
- **Nothing else changed.** The deployed frontend does not call this function yet. That is V8
  step 2, the frontend push, which needs its own go-ahead.
- **V8 step 2 (owner: "Push main to origin"):** `main` was fast-forwarded from `c9b4644` to
  `af74493` (15 commits) and pushed. That includes R6 V2–V7, the security-review fixes, and the
  R8 doc commits that were waiting.
  - **Vercel:** production deploy `dpl_DUZ8uFa7Q2DPURCcokpo7KCqSaw7` is READY and aliased to
    `niyantran-six.vercel.app`. The rollback candidate is the `c9b4644` deploy.
  - **What is served:**
    - the main entry, `index-Bi9s6Y2-.js`, is 641,594 bytes gzip, with no `GlobalWorkerOptions`
      (pdf.js stays lazy);
    - the viewer chunk, `PageViewer-ChvJnOpH.js`, contains "Open stored copy", the page bar,
      the `document-file` client, the strict signed-path pattern and the no-location hint;
    - the overlay code is in the main entry.
- **Still to do: the owner's NTER checks.**
  1. Citations from the Espionage and Anti-Doping bills: page, boxes and the Text view.
  2. "Open stored copy" opens the PDF in a new tab.
  3. A legacy citation still opens the old text reader.
  4. After the split test, a citation in part 2 or 3.

  Then R6 is marked done.
- **R6 revision 4, frontend push** (owner: "Push main to origin"). `main` was fast-forwarded
  from `af74493` to `e76a48a` (7 commits: W1 resizable overlay, W2 Fit text, zoom and full view,
  the crop-scroll fix, the bundle re-baseline, docs) and pushed.
  - **Vercel:** production deploy `dpl_BVpFB2QeDineASUDPzxtpf2BXYfz` is READY on
    `niyantran-six.vercel.app`.
  - **Served main entry:** `index-CjMT_cwW.js`, with no `GlobalWorkerOptions` and with the
    resize handles.
  - **Viewer chunk:** `PageViewer-D5_n7szv.js`, containing Fit text, the full view and the
    remembered zoom.
  - No server or database change.
  - **Still to do:** the owner's checks on NTER; then R6 (and R8, after its deferred checks) is
    marked done.
- **R6 revision 5, frontend push (2026-10-02)** (owner: "Push main to origin"). `main` was
  fast-forwarded from `e76a48a` to `3a44ff2` and pushed. The 6 commits:
  - X2 `0181b71`: the full-view backdrop, and F45 per-part signatures;
  - X1 `ee206bb`: click outside, Close citation, and the Ask state;
  - the spec revision 5, the V7c addendum, and the open-work and record docs.
  - **Vercel:** production deploy `dpl_GCXPnvLq22y1NozM5ewKcnVhuiKn` is READY on
    `niyantran-six.vercel.app`.
  - **Served main entry:** `index-eGc8u5yH.js`. It has no `GlobalWorkerOptions`, and carries
    `data-cov-keep`, "Close citation" and both Ask tooltips.
  - **Viewer chunk:** `PageViewer-DyzWAVlJ.js`, with the `data-citation-viewer` marker.
  - No server or database change.
  - **Still to do:** the owner's checks on NTER:
    - click outside with a real mouse;
    - the stored-copy tab;
    - the legacy reader;
    - R8: the split upload and a delete.

    Then R6 and R8 are marked done.
- **F46 chat bug fixes, frontend push (2026-10-02)** (owner: "Push main to origin"). `main` was
  fast-forwarded from `3a44ff2` to `b3b95d0` and pushed. Contents:
  - the R6 close-out records and the chat experience review;
  - fixes `7abd31e` (saved search steps), `a5f84af` (reasoning count on reload), `8dfc571` (one
    model label; the thread opens at its newest message) and `cd6a7ac` (composer pinned).
  - **Vercel:** production deploy `dpl_5WCLM1iyktUjXDBTYiJiADinqrg6` is READY on
    `niyantran-six.vercel.app`.
  - **Served files:** main entry `index-CHscyyjr.js`, with the reasoning-count select and no
    `GlobalWorkerOptions`; stylesheet `index-5HWPu5-g.css`, with
    `.ai-shell.ai-shell-research{display:block}`.
  - No server or database change.
- **thinking-display T4 step 1: `research-chat` deployed (2026-10-02)** (owner: "Deploy
  research-chat to NTER"). Deployed from `main` at `d426bfe` with
  `supabase functions deploy research-chat --use-api --project-ref vfgcppstyzjarlzyqdac`, giving
  version 40 (was 39).
  - **What it adds** (`18343c0`):
    - each stage labelled once: "Reading the question", "Reading the results", "Writing the
      answer";
    - a finished document search carries `found`: at most 3 documents, each with a title and up
      to 5 pages, and no text. It goes on the end frame and the saved activity row.
  - **Also since v39:** `9679937`, a constant in `_shared/pageText.ts`, which research-chat does
    not import.
  - **Probes:**
    - an unauthenticated POST gives 401 `missing bearer token`, with
      `access-control-allow-origin: https://niyantran-six.vercel.app`;
    - the preflight gives 204.
  - **Compatibility:** the live frontend (`b3b95d0`) ignores the new `found` field. It shows the
    new labels in its ticker.
  - No database change.
- **answer-streaming T6 step 1: `research-chat` deployed (2026-10-02)** (owner: "Deploy
  research-chat to NTER"). Deployed from `main` at `4f865d2` with
  `supabase functions deploy research-chat --use-api --project-ref vfgcppstyzjarlzyqdac`, giving
  version 41 (was 40).
  - **What it adds** (`4150197`):
    - research-call answer text streams live;
    - a draft that is not the answer is taken back with `patch` (0, ''), which the live frontend
      already applies;
    - `timing` gains `first_model_ms`, `first_answer_ms` and `rounds`;
    - `session_id` is the conversation id;
    - `research.draft_retracted` is logged.
  - **Unchanged:** Gemini cache breakpoints. That patch is parked for the owner's decision.
  - **Probes:**
    - an unauthenticated POST gives 401 `missing bearer token`, with
      `access-control-allow-origin: https://niyantran-six.vercel.app`;
    - the preflight gives 204.
  - **Compatibility:** the live frontend (`b3b95d0`) shows the streamed text with its existing
    chunk and patch handling. The "first word" field arrives with the frontend push.
  - No database change.
- **Frontend push (2026-10-02)** (owner: "Proceed ahead with all recommendations. Go push.").
  `main` was fast-forwarded from `b3b95d0` to `0aa8077` and pushed. It carried the thinking
  display (`1c882af`, `c234e51`), the answer-streaming client pieces (`6e0e9e7`) and the records.
  - **Vercel:** production deploy `dpl_FBmzyDPE94dWAKKyJA8kTJNJ1qAF` is READY on
    `niyantran-six.vercel.app`.
  - **Served main entry:** `index-XTAx65h7.js`. It carries "Starting…", "Found so far" and
    "first word", has no NyAI card, and has no `GlobalWorkerOptions`.
  - No server or database change.
- **Latency cuts: `research-chat` deployed and frontend pushed (2026-10-02)** (owner: "Deploy
  research-chat to NTER and also push to origin").
  - **The deploy:** from `main` at `8d68035`, giving version 42 (was 41). It carries `9a294a4`:
    Google models get no cache breakpoints, because the owner chose time to first word over
    about 60% more cost per Gemini answer.
  - **Probes:**
    - an unauthenticated POST gives 401 `missing bearer token`, with
      `access-control-allow-origin: https://niyantran-six.vercel.app`;
    - the preflight gives 204.
  - **The push:** `main` was pushed, carrying `9a294a4`. `sendResearchTurn` reuses the
    caller's still-current identity, so a send makes one user-plus-profile round trip instead
    of two.
  - No database change.
  - **Vercel:** production deploy `dpl_o1LCjWANzyNSZYhEdjKrxTmHQ2Tt` (`947dc82`) is READY. It
    serves `index-gJ2dNSaY.js`, with no `GlobalWorkerOptions`.
- **Panel loading, frontend push and bundle re-baseline (2026-10-02)** (owner: "Push main to
  origin and re-baseline the bundle").
  - **The re-baseline:** `a4da602` raises the main-entry baseline from 644,149 to 646,171 bytes
    gzip, for the F46 work's intended growth.
  - **The push:** `main` was pushed from `947dc82` to `a4da602`, carrying panel-loading A–E and
    the records.
  - **Vercel:** production deploy `dpl_HWUzV1H1khHjoDRaDxUkBRotYFPN` is READY.
  - **Served:** main entry `index-DO-4PNkd.js`, with the thread placeholder, the held question
    row and the model placeholder, and no `GlobalWorkerOptions`. The CSS has
    `.ai-dock[hidden]{display:none!important}`.
  - No server or database change.
- **answer-speed: `research-chat` deployed and `main` pushed (2026-10-02)** (owner: "Deploy
  research-chat to NTER and push main to origin").
  - **The deploy:** from `main` at `bea7b8e`, giving version 43 (was 42). It carries `3efcca9`:
    the question is searched before the first model call (not small talk), with
    `presearch: true` in the production wiring.
  - **Probes:**
    - an unauthenticated POST gives 401 `missing bearer token`, with
      `access-control-allow-origin: https://niyantran-six.vercel.app`;
    - the preflight gives 204.
  - **The push:** `main` was pushed, carrying the benchmark harness and results, the
    write-up and the records.
  - The frontend is unchanged. No database change.
- **viewer-toolbar piece 1: `main` pushed (2026-10-02)** (owner: "Push main to origin").
  - **The push:** `main` was pushed from `7e9fb83` to `8dfeddb`. It carries:
    - the viewer-toolbar spec, plan, foundation and chrome (`b8bb499`, `bef4614`, `368abb8`,
      `8dfeddb`), with `lucide-react` 1.49.0;
    - answer-speed amendment 1 and its partial benchmark (`895936a`, `1a46546`, `3568191`).
  - **Vercel:** production deploy `dpl_FozfEShQH8tXBZzYZbiGSEJZhRuz` (`8dfeddb`) is READY,
    aliased to `niyantran-six.vercel.app`.
  - **Served:**
    - main entry `index-D1BA2uLj.js`, with no `lucide` code in it;
    - the lazy viewer chunk `PageViewer-StQgOZ9s.js` (18.8 KB gzip), with the new chrome
      ("Back to p.", "Copy file name", "Exit full view");
    - its CSS, with the page pill's styles.
  - **Not deployed:** `research-chat` still runs v43. Amendment 1's server change waits for the
    benchmark rerun, once OpenRouter credits are restored, and for its own go-ahead.
  - No database change.
- **viewer-whole-page: `main` pushed (2026-10-02)** (owner: "Push main to origin").
  - **The push:** `main` was pushed from `8dfeddb` to `60b49f4`, carrying `4f714f8` (Fit width
    by default, Fit text without vertical crop, the zoom saved only on the reader's choice under
    `niyantranCitationZoomV2`), its spec and the records, including `b11ae33`.
  - **Vercel:** production deploy `dpl_9BYRARuEyeAf3ytSChsFtBkXvJ5x` (`60b49f4`) is READY.
  - **Served:** main entry `index-B2gZKDpV.js`, and the viewer chunk `PageViewer-BEnXgWS5.js`
    with the Fit width default and only the new zoom key.
  - No server or database change.
- **viewer-continuous: migration 42 applied to NTER (2026-10-02)** (owner: "Apply
  search_document_pages to NTER").
  - **The code:** `main` at `cadf50d`, unpushed. The migration was last changed in `297cb00`
    (the start page); its file's SHA-256 begins `d9008f8c`. Every SQL fixture passed locally first,
    applied as a non-superuser; the search fixture fails without the migration and without the
    start-page ordering.
  - **Before:** the last migration was `20261001180000`. There was no `search_document_pages` and
    no `search_text`. NTER held 2,340 documents, 54,340 chunks and 34 page rows (160 kB). No
    ingest job was active (both jobs had succeeded).
  - **Migration 42** `20261002120000_search_document_pages`:
    - Applied with `supabase db query --linked` in one transaction, together with its
      `schema_migrations` row (version, name and the file as its one statement).
    - **New objects:** the stored generated column `document_pages.search_text`, and
      `search_document_pages(uuid, text, text, integer, integer)`.
  - **Verified live:**
    - one overload; security invoker, stable, `search_path=""`;
    - EXECUTE for authenticated and service_role, not for anon, with no PUBLIC grant;
    - `search_text` is stored and generated, filled on all 34 pages;
    - counts unchanged: 2,340 documents and 54,340 chunks;
    - `analyze public.document_pages` was run after the table rewrite (`n_live_tup` 34).
  - **A live search** on the 22-page anti-doping bill found "the" on all 22 pages. From page 9 the
    order is 9–22 then 1–8. The function's execution time was 18.5 ms (`explain analyze`), against
    the 50 ms budget.
  - **The frontend is unchanged:** the viewer that calls this function is not pushed. The function
    and the column are additive, so the deployed app is unaffected.
- **viewer-continuous: `main` pushed (2026-10-02)** (owner: "Push main to origin").
  - **The push:** `main` was pushed from `60b49f4` to `7565408` (16 commits, 55 files). It carries:
    - the viewer-continuous spec and plan, T1–T9 and the search start page;
    - the review fixes (`cadf50d`);
    - the migration 42 record.

    A scan of the outgoing diff found no env files, keys or AI attribution.
  - **Vercel:** production deploy `dpl_GvdNsfQHM8wQwxbLV2SBMt2Zu9FN` (`7565408`) is READY, aliased to
    `niyantran-six.vercel.app`.
  - **Served:** the main entry `index-DdZYujCd.js` holds none of the viewer's code. The lazy viewer
    chunk `PageViewer-C0e8PkwG.js` (93.7 kB) carries `search_document_pages` with `p_from_page`,
    the "Approximate location" fallback, the Thumbnails rail, "Text layout" and the match
    highlights.
  - **No server change.** The database change was migration 42 (above).
  - **Owner checks on production** (agents do not sign in there):
    - search, exact marks and thumbnails on the live bills;
    - Copy file name;
    - a real split document;
    - the continuous Text view in Safari (F50).
- **answer-speed amendment 1: `research-chat` deployed (2026-10-02)** (owner: "Deploy
  research-chat to NTER").
  - **The deploy:** from `main` at `88f269b` with
    `supabase functions deploy research-chat --use-api --project-ref vfgcppstyzjarlzyqdac`. It is
    version 44 (was 43), ACTIVE, with `verify_jwt` off (the handler checks the user).
  - **What changed:** it carries amendment 1 (`1a46546`, `895936a`):
    - the pre-search reply opens with a note asking for a search per part it does not cover;
    - follow-ups (a turn with stored history) are not pre-searched.
  - **Evidence:** benchmark pass 4
    (`docs/research/2026-10-02-answer-speed-depth-benchmark-pass4.md`):
    - briefs meet the depth pass mark;
    - follow-ups run as the baseline does;
    - the Deno suite (828) passed on this commit.
  - **Probes:**
    - an unauthenticated POST gives 401 `missing bearer token`, with
      `access-control-allow-origin: https://niyantran-six.vercel.app`;
    - the preflight gives 204.
  - The frontend is unchanged. No database change.
  - **Owner check:** a signed-in brief and a follow-up on production, where agents do not sign in.
- **viewer-f50: migration 43 applied to NTER (2026-10-02)** (owner: "Apply search_folding to
  NTER").
  - **The code:** `main` at `70a90f1`, unpushed. Migration last changed in `4a0871d`. Every SQL
    fixture passed locally first; the search fixture fails without 43 (vacuity).
  - **Before:**
    - the last migration was `20261002120000`;
    - `search_text` was not normalised;
    - 2,340 documents, 54,340 chunks, 34 page rows;
    - no active ingest job;
    - database ctype `en_US.UTF-8`, the locale the fixture ran under.
  - **Migration 43** `20261002180000_search_folding`:
    - Applied with `supabase db query --linked` in one transaction, together with its
      `schema_migrations` row.
    - The apply file was built with Python: zsh's `echo` interprets `\u` escapes, and the first
      attempt failed before anything ran.
  - **Verified live:**
    - the column expression is `NORMALIZE(text, NFC)` with the full space class;
    - the function's needle is normalised, with the same class;
    - one overload; security invoker, stable, `search_path=""`;
    - authenticated may execute it; anon and PUBLIC may not;
    - `search_text` is filled on 34 of 34 pages;
    - counts unchanged;
    - `analyze public.document_pages` was run (`n_live_tup` 34);
    - a no-break space and an em space fold to a space.
  - **Live search** on the 22-page bill: "the" gives the same pages and counts as after 42, and a
    double-spaced phrase matches. 19.6 ms (`explain analyze`).
  - The frontend is unchanged. Migration 43 changes only what the database matches; the deployed
    viewer already folded this way.
- **viewer-f50: `main` pushed (2026-10-02)** (owner: "Push main to origin").
  - **The push:** `main` was pushed from `7565408` to `55d7595` (9 commits, 22 files). It carries:
    - viewer-f50 T1–T5;
    - answer-speed benchmark pass 4;
    - the records of `research-chat` v44 and migration 43.

    A scan of the outgoing diff found no env files, keys or AI attribution.
  - **Vercel:** production deploy `dpl_CaCMMxNPeJoxYPzUjYUdGvW3Y93z` (`55d7595`) is READY.
  - **Served:** the main entry `index-H0PABj5L.js`, with no viewer code, and the lazy viewer chunk
    `PageViewer-DkOpSlSA.js` (94.9 kB), carrying the manual anchoring (`overflow-anchor` check)
    with the rest of the viewer.
  - No server change in this push. `research-chat` v44 and migration 43 went live separately
    (above).
  - **Owner checks on production:**
    - the continuous Text view in Safari;
    - a signed-in brief and a follow-up;
    - the earlier viewer checks (search, marks, thumbnails, Copy file name, a split document).
- **chat-turn-cost and chat-panel-fixes: `research-chat` deployed (2026-10-02)** (owner: "Deploy
  research-chat to NTER").
  - **The deploy:** from `main` at `3252743`, unpushed, with
    `supabase functions deploy research-chat --use-api --project-ref vfgcppstyzjarlzyqdac`. It is
    version 45 (was 44), ACTIVE, with `verify_jwt` off.
  - **What it carries:**
    - a widened search asks for 15 passages (`0de8178`, `13c050e`), which the owner chose to keep
      after the measurement (`docs/research/2026-10-02-turn-cost-benchmark.md`);
    - the reply cap is present but off by default (`d76a49c`);
    - the `timing` frame carries the turn's reasoning count (`ea0e07c`). The deployed frontend
      ignores the new field until the push.
  - **Checks:** the Deno suite (837) passed on this commit.
  - **Probes:**
    - an unauthenticated POST gives 401 `missing bearer token`, with
      `access-control-allow-origin: https://niyantran-six.vercel.app`;
    - the preflight gives 204.
  - No database change. The frontend is unchanged until the push.
- **chat-panel-fixes, chat-turn-cost records and search lowercasing: `main` pushed (2026-10-02)**
  (owner: "Push main to origin").
  - **The push:** `main` was pushed from `55d7595` to `da32cb3` (17 commits, 28 files). It carries:
    - the search lowercasing parity and the `localSpan` removal;
    - chat-panel-fixes T1–T3: the client half of the timing word, the dimming, the phone dock;
    - the turn-cost benchmark and its records;
    - the F6 parking;
    - the records of `research-chat` v45.

    A scan of the outgoing diff found no env files, no `docs/security`, no keys or local test
    credentials, and no AI attribution.
  - **Vercel:** production deploy `dpl_3MuhU9UEETkXdJh6U66rgjibWZyg` (`da32cb3`) is READY.
  - **Served:** `index-W9LQUcsB.css` carries the history-open dimming
    (`.history-open>.ai-panel-background>.ai-v2-body`) and the phone rule (`.workspace.ai-open`
    rows `0 minmax(0,1fr)`, the desk `visibility:hidden`). The main entry is `index-ytI_2PxM.js`.
  - No server or database change in this push. `research-chat` v45 went live separately (above).
  - **Owner checks on production:**
    - on a phone, the chat dock fills the screen below the header, and history dims the panel;
    - the live "thought"/"waited" word matches the saved answer;
    - the Safari Text view, the signed-in brief and follow-up, and the live-bill viewer checks.
- **chat-panel-fixes T5 and the provider-routing option: `main` pushed (2026-10-02)**
  (owner: "Push main to origin").
  - **The push:** `main` was pushed from `da32cb3` to `c2c3069` (4 commits, 11 files). It carries:
    - chat-panel-fixes T5: on phones the header fits, the history list stays on screen, and the
      account menu is no longer clipped below 900 px, where the bar drops its duplicate Log out;
    - chat-turn-cost amendment 1's `providerSort` option and benchmark variants. The option is not
      wired into the handler, and `research-chat` is unchanged on NTER (v45);
    - the records of the chat-panel-fixes push and of T5's local run.

    A scan of the outgoing diff, run just after the push, found no env files, no `docs/security`,
    no keys or local test credentials, and no AI attribution.
  - **Vercel:** production deploy `dpl_6PMZDcZ2j7Mpn1PDx8HxiJrSckts` (`c2c3069`) is READY.
  - **Served:** `index-BbGAuz4-.css` carries `.top-actions>.logout-btn{display:none}`,
    `.profile-pop{position:fixed;top:54px;right:10px}`, `.ai-v2-history-wrap{position:static}`
    and `.ai-v2-history-pop{right:16px}`. The main entry is `index-B2iS__5J.js`.
  - No server or database change.
  - **Owner checks on production:**
    - on a phone, the avatar shows in full, the account menu opens with Log out, and the history
      list stays on screen;
    - the earlier checks still stand: the phone dock and dimming, the live timing word, the Safari
      Text view, the signed-in brief and follow-up, and the live-bill viewer.
- **source-list (F51) and the routing results: `main` pushed (2026-10-02)** (owner: "Push main to
  origin").
  - **The push:** `main` was pushed from `c2c3069` to `5b49049` (5 commits, 12 files). It carries:
    - the sources list redesign (`2d95bf6`, `2b1bdde`): a compact styled list, with the pages and
      citation numbers per document and the file name only as the tooltip;
    - the provider-routing trial results and their raw file;
    - the T5 push record, the source-list spec, plan and local run, and F51 and F52.

    A scan of the outgoing diff, run before the push, found no env files, no `docs/security`, no
    keys or local test credentials, and no AI attribution.
  - **Vercel:** production deploy `dpl_4K7HfQarfcR3BnY81ByxmRfNGXDv` (`5b49049`) is READY.
  - **Served:** `index-ClDtYTJ9.css` carries `.ai-sources{list-style:none;…}`,
    `.ai-source-chip{…border:0…}` and its `:focus-visible` ring. The main entry
    `index-CWkWLUFK.js` has the "Sources · N documents" label.
  - No server or database change.
  - **Owner check on production:** the sources under a signed-in answer show as the compact list,
    and a row opens the reader.
- **chat-turn-cost: widened searches back to 40 passages, `research-chat` deployed (2026-10-02)**
  (owner: "Switch back to 40 and deploy research-chat to NTER").
  - **The deploy:** from `main` at `2f0c71d`, unpushed, with
    `supabase functions deploy research-chat --use-api --project-ref vfgcppstyzjarlzyqdac`. It is
    version 46 (was 45), ACTIVE, with `verify_jwt` off.
  - **What it carries:**
    - a widened search asks for retrieval's default 40 passages again (`2f0c71d`). A second pass
      found 15 no deeper and slower (`docs/research/2026-10-02-turn-cost-benchmark.md`).
      `WIDENED_TOP_K` stays as an opt-in option;
    - `StreamRequest.providerSort` (`f34f20b`), which the handler never sets, so request bodies are
      unchanged.

    Nothing else in `research-chat/` or `_shared/` changed since v45 (`3252743`).
  - **Checks:** the Deno suite (839) and lint passed on this commit. The three changed default
    tests failed first.
  - **Probes:**
    - an unauthenticated POST gives 401 `missing bearer token`, with
      `access-control-allow-origin: https://niyantran-six.vercel.app`;
    - the preflight gives 204.
  - No database change, and no frontend change.
- **The widened-limit revert and its records: `main` pushed (2026-10-02)** (owner: "Push main to
  origin").
  - **The push:** `main` was pushed from `5b49049` to `e85c20d` (4 commits, 9 files). It carries:
    - the 40-passage default for widened searches (`2f0c71d`), already live as `research-chat`
      v46;
    - the second-pass results and their raw file;
    - the source-list push record and the v46 deploy record.

    A scan of the outgoing diff, run before the push, found no env files, no `docs/security`, no
    keys or local test credentials, and no AI attribution.
  - **Vercel:** production deploy `dpl_E6gd2SrLjLH47uGLJeYNHzoCnTy7` (`e85c20d`) is READY. No
    frontend file changed, and the served bundle is unchanged (`index-CWkWLUFK.js`,
    `index-ClDtYTJ9.css`).
  - No database change.
- **research-coverage (F53): `main` pushed (2026-10-03)** (owner: "Push main to origin").
  - **The push:** `main` was pushed from `e85c20d` to `cf54c58` (12 commits, 24 files). It carries:
    - the research-coverage spec, plan and amendments 1–3;
    - the coverage test set (`eval/agent/coverage.v1.jsonl`), its builder, checker, scorers and
      tests;
    - the independent review and the measurement write-up, with raw results;
    - two off-by-default options in `research-chat`: the dig nudge (`dig.ts`,
      `AgentDeps.digNudge`) and the prompt coverage check (`PromptInput.coverageCheck`). The
      handler sets neither. `research-chat` is not redeployed and stays v46 on NTER;
    - F52's note on two mis-titled records.

    A scan of the outgoing diff, run before the push, found no env files, no `docs/security`, no
    keys or local test credentials, and no AI attribution.
  - **Vercel:** production deploy `dpl_EED5F6X4vMqfZHn68nUZS6AB9y6Z` (`cf54c58`) is READY. No
    frontend file changed, and the served bundle is unchanged (`index-CWkWLUFK.js`,
    `index-ClDtYTJ9.css`).
  - No database change.
