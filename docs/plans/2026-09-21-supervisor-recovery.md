# Supervisor recovery and integration plan

> **Status: Living — implementation authorized by owner on 2026-09-21.**
> **Updated 2026-09-21:** publication is done (`main` is pushed to `origin`) and
> E2 phases 1 and 2 are executed — all five migrations applied and all five Edge
> Functions deployed. The remaining gates are E2 phase 3 (bounded paid browser
> acceptance), C4 (the two-document corpus retry) and E1 (Vercel/email access).

## Goal and module order

Recover partially committed work, close verified authorization defects, account
for the ongoing corpus pass, and finish the streaming research milestone before
integrating verified work into main. The workbook's wider source architecture
is a subsequent programme; it is not silently bundled into this milestone.

| Module | Specification | Prerequisite |
| --- | --- | --- |
| identity-boundaries | ../specs/2026-09-21-identity-boundaries.md | Reconciled checkout |
| corpus-reconciliation | ../specs/2026-09-21-corpus-reconciliation.md | Existing worker finishes before DB changes |
| streaming-research-agent | ../specs/2026-09-21-streaming-handover.md plus original spec | Identity and corpus integrity gates for live use |

The user authorized proceeding with this plan and agents. The confirmed one-user-class, internal-admin,
retained-persona and preserve-other-developer constraints govern the proposal.
Each dispatch still requires its stated dependencies and verification.

## Current recovery checkpoint — 2026-09-21

The accepted local recovery branch is task/supervisor-recovery at 81e562e.
A1–A3, B1–B5, C1–C3/C3b, D1–D4 and D8 have local verification evidence.
D5 accounting (61a4fcc) and D7 stream client (35822cc) are accepted locally.
The D3 chronology follow-up (0b63fd1) and D9 components (355ff0f) are accepted.
D6 function wiring (81e562e) is accepted locally. D10 panel/browser acceptance remains. E3 documentation
is being reconciled throughout; C4 and E1/E2/E4 retain their stated production,
access and final integration/publication gates.

Live corpus: 2,335/2,337 eligible indexed; 51,057 chunks; two unfinished, one
additional oversized exclusion. Live migrations end at 0011. Local commits and
tests do not establish production completion. The four-field provenance backfill
has a proposed inventory only. Original checkout changes remain preserved.

The baseline and dated evidence below retain the initial observations; where
later evidence supersedes them, this checkpoint and the task checkboxes govern.

## Initial read-only handover baseline (historical observation)

Read-only review covered the docs folder, source and migration definitions,
the IDE handoff, Git histories and GitHub metadata, all deployed Edge Function
source, public database functions/policies/grants, storage/realtime/cron
configuration, source workbook structure and relevant architecture rows, and
the OCR index and ten-file sample. Source-file readings establish code claims;
live catalog SELECTs establish deployed definitions. No write exploit was tried,
no build/test was run and no deployment route absence was established.

| Area | Observed state |
| --- | --- |
| Current checkout | task/corpus-ingest at fb7821a |
| Local main | 2630696; six commits ahead of origin/main 63ef6a1 at review |
| Divergence | Corpus has four commits absent main; main has seven absent corpus |
| Other local task branches | ai-backend-foundation, ai-backend-specs, document-rag, desk-row-grounding, streaming-research-agent |
| Streaming worktree | 6fef2e9; Task 3 prompt/decoder files untracked |
| Main/corpus migrations | Main has 0011 but lacks 0010; corpus has 0010 but lacks 0011 |
| Live migrations | 0001 through 0011 applied; verify ordering/content during reconciliation |
| Supabase | NTER vfgcppstyzjarlzyqdac; 17 public tables with RLS; 19 public functions |
| Edge Functions | health, admin-models, refresh-model-pricing, ingest-documents; no research-chat |
| Desk snapshot | 34,184 rows in 34 modules; catalogue lists 75 modules |
| Storage/realtime | No storage buckets; no published realtime tables at review |
| Pricing | 446 catalogue entries; seven enabled models; twelve-hour refresh observed |
| Auth data | No users/profiles at earlier snapshot; recheck before future tests, never delete users |
| GitHub | No workflow runs/deployments/status checks observed; other developer's branch preserved |

All branch counts are time-bound. There are seven local branches, rather than
the earlier recollection of four. Ancestor branches may be redundant, but no
branch is deleted in this task. Another developer's work is not merged blindly.

Existing changes in .claude/launch.json and public/data/{conflict,markets,news}.json
are not owned by this task. Do not stash, restore, discard or commit them.
docs/ is intentionally ignored and local-only. The three new specs and this
plan remain local; publication requires a separate owner decision.

## Priority and release blockers

| Priority | Finding / requirement | Evidence class | Handling |
| --- | --- | --- | --- |
| P0 | Self-editable privileged profile fields feed admin authorization | Live policy/grant/function definitions | Identity tasks before real-user release |
| P0 | Static admin credential/browser flag and unguarded local user routes | Source review | Server authorization and route containment |
| P0 | Legacy-key acceptance in refresh function needs rotation audit | Deployed source accepts legacy bearer fallback | Verify disabled legacy secret cannot remain an accepted application secret; no credential disclosure |
| P1 | Message/cancellation parent ownership and assistant integrity | RLS/FK definitions | Two-user negative tests and server-owned assistant writes |
| P1 | Chunk content/offset mismatch on normalized-hash reuse | RPC and chunker source | Exact-span regression and atomic readiness contract |
| P1 | Ingest completeness/provenance not established by count | Source index and worker behavior | Source-ID reconciliation and metadata preservation |
| P1 | Streaming Task 3 unverified; loop/handler/client unfinished | Worktree inspection | Recover, verify and continue bounded tasks |
| P1 | Vercel deployment and real signup/email path not verified | Access unavailable and local architecture mismatch | Launch gate, not claimed missing production functions |
| P2 | Broad grants; mutable search paths; FK/index/RLS advisor findings | Catalog/advisors | Narrow privileges; performance changes only after measurement |
| P2 | Broader source integration and freshness gaps | Workbook and snapshot architecture | Separate source programme after milestone |

RLS does not constrain TRUNCATE, but broad SQL grants alone do not prove a
browser can issue it through REST. Advisor definer/unused-index warnings are
triage inputs, not automatic instructions to remove functions or indexes.

## Fixed boundaries before dispatch

The supervisor provides onboarding.md, active spec, exact branch/worktree,
exclusive file scope and acceptance evidence to every agent. Agents leave
uncommitted diffs; only the supervisor verifies, commits and integrates.
Implementation agents are dispatched only within the exact scopes recorded below.

One ordinary role; personas are preferences. User clients cannot persist trusted
assistant results. Tools accept server-validated source references. Citation
content matches document text offsets. Provider attempts are logged individually.
SSE additions cannot silently rename existing frames. Migration numbering is
allocated by the supervisor after baseline reconciliation, never independently
by concurrent agents. The supervisor performs no live writes. The ingestion worker is now idle; any
restart, retry or backfill requires its separately reviewed production action.

## Ordered tasks

Unchecked tasks are pending. Proposed new paths are exact scopes for review;
the supervisor confirms paths against the integrated checkout before dispatch.
Tasks do not gain permission to widen their scope when they discover defects.

### A. Preserve and reconcile history

- [x] A1 — Supervisor inventories both checkout diffs and unique commit sets.
  Write scope: this plan's evidence section only. Verify with `git status
  --short --branch`, `git worktree list --porcelain`, `git log --oneline
  --left-right main...task/corpus-ingest` and `git diff --stat`. Record owners
  and hashes without copying credentials. No dependency.
- [x] A2 — After implementation approval, integrate the
  corpus commits into an isolated supervisor task branch based on main.
  Write scope: only reviewed conflicting paths from that merge, enumerated
  before resolving; otherwise stop for a narrower task. Acceptance: migrations
  0010/0011 both present, source history retained, original dirty work untouched.
  Verify migration content against applied history, then run the baseline
  commands below. Depends A1. Do not run blind pull or force push. The isolated
  local merge does not change the active ingestion checkout; only live database
  operations must wait for worker quiescence.
- [x] A3 — Recover the streaming worktree on its existing branch; inspect
  untracked files before staging anything. Write scope: no implementation yet;
  evidence here only. Acceptance: committed Tasks 1/2 and untracked Task 3
  distinguished, required base commits available, focused baseline reproduced.
  Depends A1; integrating branches remains supervisor-owned.

Checkpoint A: owner constraints and branch ownership intact; reproducible
combined baseline; no missing migrations; no unrelated file in a proposed commit.

### B. Close authorization boundaries

- [x] B1 — Protect profile fields and disable public self-provisioned privileged
  entitlements. Scope: backend/sql/auth_schema.sql, one supervisor-numbered
  migration, supabase/tests/profile_authority.sql. Depends A2. Acceptance:
  ordinary persona updates succeed; role/plan/status escalation through all
  write forms fails; internal provisioning succeeds. Verify `supabase test db`
  in the disposable target and demonstrate original-defect failure.
- [x] B2 — Enforce database parent ownership and client message integrity. Scope:
  one new migration, supabase/tests/conversation_ownership.sql. Depends B1.
  Acceptance: cross-user child writes fail; forged assistant/telemetry writes
  fail; server-validated assistant writes succeed. Same SQL verification with
  two users and a negative-control regression.
- [x] B3 — Replace internal admin browser trust. Scope:
  src/admin/AdminLogin.jsx, src/admin/AdminApp.jsx,
  src/admin/adminSession.js, src/admin/adminSession.test.js. Depends B1.
  Acceptance: verified internal admin enters; ordinary/expired/suspended
  sessions and forged browser flags fail. Focused `npm test --
  src/admin/adminSession.test.js`, real-browser direct URL and flag tampering.
- [x] B4 — Contain local user endpoints and login fallback (local implementation verified; live Auth/deployment acceptance remains E2). This uses bounded server and browser slices: server/usersApi.mjs, server/userPrefsApi.mjs and
  src/lib/localUserAuthorization.test.js; then the caller adapter slice
  src/lib/userStore.js, userStore.bridge.test.js, userPrefsSync.js,
  userPrefsSync.test.js, watchlistStore.js, aiChatStore.js, onboarding.js and
  accountPreferenceStores.test.js; then src/marketing/LoginPage.jsx
  and src/marketing/loginAuthorization.test.js, plus src/admin/adminSession.js
  and src/admin/adminSession.test.js for deliberate-sign-in adapter wiring. Depends B1/B3. Acceptance:
  no unauthenticated user export/replacement, no password response, no network
  failure yielding a real authenticated session. Verify focused Vitest tests
  and local browser flows without invoking destructive existing routes.
  Adapter acceptance: authorized requests carry the verified session JWT;
  hydration never automatically PUTs a union of browser/server user lists;
  absent/expired identity fails closed and preferences cannot target another
  supplied email. B3 discovered these caller dependencies during source review.
- [x] B5 — Audit accepted server secrets and reduce unnecessary grants.
  First dispatch scope: refresh-model-pricing/index.ts,
  refresh-model-pricing/handler_test.ts. Second dispatch if required: one new
  migration and supabase/tests/least_privilege.sql. Depends B1/B2. Acceptance:
  revoked legacy credentials rejected, intended refresh path retained, normal
  app privileges work and unnecessary SQL powers removed. No live secret
  rotation by an agent; supervisor presents concrete secret/deploy operations
  separately. Verify fake-secret tests and shadow DB grants.

Checkpoint B: supervisor reproduces escalation, cross-user and internal-admin
negative tests. Production rollout still requires its own explicit action.

### C. Account for and harden corpus completion

- [x] C1 — Read-only source-ID reconciliation after worker finishes. Scope:
  this plan's durable completion evidence only. Depends on worker quiescence,
  not on coding tasks. Acceptance: every eligible ID classified, oversized
  exclusion named, final timestamps/worker result checked, no false count-based
  completion. Use bounded SELECTs and read OCR_FILES.csv; do not start a retry.
- [x] C2 — Correct exact content on hash reuse and readiness gating. Scope:
  one new migration, supabase/tests/corpus_revision_integrity.sql. Depends A2
  and C1 for any live step. Acceptance: stable chunk UUID and correct current
  content/offsets; unfinished document absent from retrieval; failed revision
  never exposed as current. Verify shadow SQL tests with old-defect failure.
- [x] C3 — Preserve provenance and validate source input. Scope:
  scripts/ingest-national-desk.mjs, src/lib/ingestNationalDesk.test.js,
  supabase/functions/ingest-documents/handler.ts and handler_test.ts. Depends
  C2. Acceptance: metadata-only retries preserve owned provenance; hash/size
  mismatch detected; ambiguous links/oversize skips remain explicit. Focused
  JS/Deno tests with fakes; no paid embedding during local verification.
- [x] C4 (done — see corpus-reconciliation entries 2026-09-22 in
  `docs/specs/2026-09-21-corpus-reconciliation.md`; ticked 2026-09-24) —
  Supervisor proposes only reconciled failed/missing retries and
  checks source coverage. No write scope until exact IDs and deployment delta
  are reviewed. Depends C1-C3. Acceptance: expected set closed or each exception
  explicitly deferred, sample citations match source text, no duplicate corpus.

- [x] C3b — Validate link-map bill identity fields. Scope:
  scripts/build-corpus-links.mjs and src/lib/corpusLinks.test.js. Depends A2;
  separate from C3's metadata changes. Independent baseline review reproduced
  blank billNumber consuming the next billYear line because the parser uses
  cross-line whitespace. Acceptance: blank identities never invent a key,
  complete valid identities retain existing matching behavior. Focused Vitest
  regression must fail against the original parser before the fix.

Checkpoint C: indexed set is accounted for; citation integrity guards proven;
worker idle before migrations, deployments or paid tests.

### D. Finish streaming in small recoverable slices

- [x] D1 — Review/recover answer decoder and prompt. Scope: the four existing
  untracked research-chat/{answerStream,prompt}{,_test}.ts files. Depends A3.
  Acceptance: top-level JSON decoding under arbitrary chunk splits and precise
  source/attachment rules; greeting behavior agrees with reviewed spec. Verify
  focused Deno tests. Do not assume existing tests passed.
- [x] D2 — Complete retrieval scoping and bounded tool loop. Scope:
  research-chat/agent.ts, agent_test.ts, _shared/retrieval.ts, retrieval_test.ts.
  Depends D1. Acceptance: shared handles, scoped fallback counted against budget,
  no endless continuation. Verify scripted streams and cap-removal regression.
- [x] D3 — Turn persistence and idempotency. Scope: research-chat/persistence.ts,
  persistence_test.ts, handler.ts, handler_test.ts, one additive turn-claim
  migration and supabase/tests/research_turn_persistence.sql. Depends B2/D2. Acceptance:
  exactly one logical turn under retries, verified conversation ownership,
  terminal errors/cancellations persisted. Fake DB plus disposable two-user test.
- [x] D4 — Streaming transport lifecycle. Scope: _shared/chatStream.ts and
  chatStream_test.ts, research-chat/handler.ts and handler_test.ts. Depends D3.
  Acceptance: ordered frames, no model swap after text, bounded cancellation
  and disconnect handling. Verify provider-error and abort scripted streams.
- [x] D5 — Citation repair and telemetry. Scope: research-chat/repair.ts,
  repair_test.ts, telemetry.ts, telemetry_test.ts, handler.ts. Depends D4.
  Acceptance: repaired UI text equals persistence, source handles validated,
  every provider attempt logged. Test patch/removal and failover usage cases.
- [x] D6 — Wire the function locally. Scope: research-chat/index.ts,
  supabase/config.toml, research-chat/index_test.ts. Depends D5/B5/C2.
  Acceptance: authenticates even with gateway JWT verification disabled,
  trusted service writes bounded by prior ownership checks, secrets server-only.
  Local fake/env wiring tests; no deployment in this dispatch.
- [x] D7 — Browser stream client. Scope: src/lib/researchChat.js and test,
  src/lib/aiClient.js and test. Depends fixed D4 frame contract. Acceptance:
  fragmented SSE, patches, Stop and silence timeout behave deterministically.
  Focused Vitest tests; no server writes during tests.
- [x] D8 — Conversation cache/store. Scope: src/lib/aiConversations.js and test,
  src/lib/aiThreads.js. Depends D3/B2. Acceptance: optimistic rows reconcile,
  account switch clears private cache/pins, reload distinguishes running from
  failed/completed. Fake-client Vitest tests.
- [x] D9 — Components in two sequential slices: first
  src/ai/{ActivityTicker,ModelPicker}.jsx and their tests; second
  src/ai/{CitationBubble,WorkSurface}.jsx and their tests. Depends fixed D7
  contract. Acceptance: public activity only, allowed efforts only, validated
  citations open correct reader, unresolved markers never become trusted links.
  Focused component tests and browser inspection.
- [x] D10 — Panel integration. Scope: src/ai/AiPanel.jsx, AiMarkdown.jsx and
  their focused tests. Depends D6-D9. Acceptance: real signed-in stream flow,
  citations/Stop/reload work, legacy feature-flag path preserved except reviewed
  security fixes. Full test/build plus browser scenarios from amended spec.

Checkpoint D: supervisor reviews each slice, reproduces meaningful guards and
the end-to-end path locally. No task agent commits or deploys.

### E. Launch verification and final integration

- [ ] E1 — Confirm Vercel project, repository/branch mapping, environment names,
  function routes and signup/email provider delivery with authorized access.
  No code write scope; gather evidence and split any fixes into new tasks.
  Depends B/D. Lack of Vercel access blocks deployment verification only.
- [ ] E2 — Supervisor presents exact migrations, functions, secret-name changes,
  test identities and bounded paid scenarios for production authorization.
  Depends B/C/D/E1. Preserve existing data; never delete all users. Verify
  greeting, row count, document citation, Stop and close-tab recovery once each,
  recording transcripts and DB traces without credentials.
- [ ] E3 — Reconcile documentation in a separate documentation dispatch.
  Scope: AGENTS.md, README.md, docs/agents/coordination.md and this plan.
  Acceptance: actual tests/functions/statuses documented, stale baseline claims
  resolved, completed plans dated without rewriting history. Publication of
  ignored docs remains an owner choice.
- [x] E4 — Supervisor reviews exact final diff, small verified commits and
  ancestry; merges to local main. Fetch both remotes again and review other
  developer divergence without overwriting it. Push main only in the later
  expressly authorized publication step; no force push. Acceptance: intended
  commits reachable remotely, working changes preserved, build/test evidence
  attached. Delete redundant local branches only under a separate decision.

## Verification commands and evidence rules

After an approved implementation slice, from its assigned checkout:

```bash
npm test
deno test -A --config supabase/functions/deno.json supabase/functions
npm run build
```

Use focused file arguments during development, then the applicable full gates
at integration. SQL tests use `supabase test db` only on an identified disposable
local instance. Check installed CLI/test support before dispatch; never point
write tests at NTER. No lint, typecheck or CI pass is claimed without an actual
repository command. Test counts from the old IDE are not new execution evidence.

Vitest currently discovers only src/**/*.test.{js,jsx}. Proposed JS tests are
placed there even when exercising an importable server/script module. React
tests must use capabilities present in the checkout; no undeclared DOM test
dependency is assumed. If a new harness is needed, propose that bounded change
before dispatch rather than reporting undiscovered tests as passing.

## Delegation proposal

### Proposed model and reasoning assignments

Added during the owner's model-allocation review. These are explicit dispatch
defaults, not evidence that agents have started. The supervisor remains in
this task with its configured model; no silent model change is implied.

| Work | Task IDs | Agent model | Reasoning effort |
| --- | --- | --- | --- |
| Authorization and privilege boundaries | B1-B5 | gpt-6-astra | high |
| Corpus revision/SQL integrity | C2-C3 | gpt-6-astra | high |
| Read-only corpus reconciliation | C1 | gpt-5.6-sol | high |
| Unfinished prompt/decoder recovery | D1 | gpt-5.6-sol | high |
| Tool loop, persistence, transport, repair and wiring | D2-D6 | gpt-6-astra | high |
| Browser stream and conversation store | D7-D8 | gpt-5.6-sol | high |
| Bounded UI components | D9 | gpt-5.6-terra | medium |
| Panel integration | D10 | gpt-5.6-sol | high |
| Independent security/integration review | Checkpoints B-D | gpt-6-astra | xhigh |
| Documentation reconciliation | E3 | gpt-5.6-terra | medium |

A1-A3, C4 and E1/E2/E4 remain supervisor-owned; bounded read-only assistance
may be separately dispatched. Independent review uses a fresh agent that did
not implement the reviewed slice. No more than three child agents run at once;
normally one implements and one reviews. Escalation from a lighter model is
driven by a concrete unresolved defect, not automatic duplication of all work.
The Gemini citation-repair model is an application runtime setting, separate
from these development-agent models.

### Previous-plan closure mapping

| Previous plan/task | Recovery task | Closure condition |
| --- | --- | --- |
| Streaming 0-2: baseline and committed helpers/client | A3 | Preserve commits and reproduce relevant baseline; do not redo blindly |
| Streaming 3: untracked decoder/prompt | D1 | Review existing four files, verify and integrate |
| Streaming 4: tool loop | D2 | Bounded loop/scoping acceptance passes |
| Streaming 5: handler/function/deploy | D3-D6, E2 | Local behavior verified and separately authorized live deployment verified |
| Streaming 6: browser libraries | D7-D8 | Client/store acceptance passes |
| Streaming 7: components/panel | D9-D10 | UI integration and legacy parity verified |
| Streaming 8: live verification | E1-E2 | Vercel/access gates resolved and actual live evidence recorded |
| Streaming 9: close | E3-E4 | Records updated and verified integration complete; publication only when authorized |
| Corpus 0-2: mapping/script work | A2, C3 | Existing work preserved, provenance defects covered and verification reproduced |
| Corpus 3: active first-pass ingest | C1-C4 | Expected IDs reconciled; each failure/exclusion explicitly accounted for |
| Corpus 4: close | E3-E4 | Final evidence and integration recorded |
| Historical foundation/RAG/desk plans | A2, B, C, E3 | Retain prior completion records; track newly found defects as dated follow-ups |

At closeout, audit every open acceptance item in the original plans/specs.
Mark it completed only with evidence, superseded only with a reviewed replacement
and a link, or deferred/blocked with its reason and successor task. Do not mark
an entire old plan complete merely because the recovery implementation is done.
Vercel/email access, unperformed live tests, publication and deferred product
milestones remain open until their own conditions are met. Broader source
integrations, billing and affidavit ingestion are not closed by this milestone.

Default sequential. Once scopes/contracts are reviewed, a bounded pure helper
or browser component may use a lighter available model; authorization, database
integrity and integration require the strongest review. Model capability and
evidence matter more than using Astra for every task. The current native agent
tool exposes GPT models; a non-GPT agent needs a separately available tool/IDE
handoff, not an invented capability. Supervisor retains final review authority.

Potential parallel work: D7 after its frame contract is fixed, D8 after its
ownership contract lands, and D9 once browser props are fixed. These do not
write the same files. All handler edits and migrations remain sequential.
No task may compete with the ingestion worker for live database writes.

## Outstanding owner inputs and deliberate deferrals

- Repair model approved during review: `google/gemini-3.5-flash-lite`.
  Live configuration remains unchanged until the deployment step.
- Vercel access/project mapping and production email-provider configuration are
  needed for launch verification, not for local specification and coding.
- Identify the other developer's active branch before final integration;
  remote dev is observed, but do not assume it is their current assignment.
- Broader workbook integrations need source-by-source refresh, licensing,
  credential and coverage acceptance. Preserve the workbook's partial-snapshot
  labels; do not claim the 75-module catalogue equals 69 integrated functions.
- Full billing, invoices, subscriptions, source scrapers, affidavit ingestion,
  deployment automation and general performance tuning are separate milestones.

## Planning-task verification

## Implementation evidence — 2026-09-21

- Owner authorized implementation and proposed agent allocation with "yes go".
- Isolated checkout /private/tmp/niyantran-supervisor-recovery on
  task/supervisor-recovery; original ingestion and streaming checkouts retained.
- A2 merge c09194f independently reviewed: exact union of both branch trees,
  no overlapping changed paths, migrations 0001-0011 retained. Combined tests:
  54 Vitest and 88 Deno passed; production build passed with existing large
  bundle and mixed-import warnings. Initial build without local env failed
  at SUPABASE_URL validation; ignored environment copy restored the expected
  build setup without printing credentials.
- D1 implementation returned 14 focused/113 full Deno tests passing, with
  five failing regressions before repairs. Independent review is still pending.
- B1 committed d39677e after 43 local SQL assertions, five intended failing
  negative controls, source-schema parity, 54 Vitest/88 Deno/build checks.
  Supervisor reproduced 43 assertions; independent reviewer reproduced those
  plus nine additional probes under deliberately broad legacy grants. Runtime:
  disposable postgres:17-alpine with Auth stubs, network disabled, no ports.
  This does not verify hosted Auth/PostgREST. Nothing deployed.
- B2 assigned sequentially after B1; migration number 0013 reserved.
- B2 committed 6b57a9d: 59 SQL assertions reproduced by supervisor and reviewer,
  plus six independent probes, four original-defect failures and six restored
  defect failures. Existing mismatches abort without data rewrite. Elevated
  HTTP assistant persistence remains D3/D6, not closed by these SQL checks.
- C3b committed 2a01bed and integrated as 0c96ed3; eight focused regression
  tests passed, original bug failed before repair. No link map regenerated.
- D1 committed 1886708 after independent review corrections; supervisor and
  reviewer each reproduced 20 focused tests plus 11 independent probes. Prior
  streaming foundations merged as 3915fdf. Combined baseline: 68 Vitest,
  119 Deno, production build passed with known warnings.
- C1 final worker log: DONE 2026-09-21T09:46:07Z; process-name inventory confirms
  no ingestion worker remains. Exact source-ID comparison: 2,337 eligible,
  2,334 present, 2,332 indexed, no unexpected IDs. Monitoring paused after
  worker completion; corpus success is incomplete and C4 remains open.

| C1 unresolved source ID | File | State |
| --- | --- | --- |
| cf43b3b332eb838857ad569b8c8f8ef809ed9fb5 | 2006-73-Synop.pdf | Absent |
| 988660aa5286fdfefbff4b013f6a664a64de8797 | 2006-76-Synop.pdf | Absent |
| 1f7ffc739c73a91f3fb346698a07b8bd618c20fa | 2006-93-Synop.pdf | Absent |
| 4dc99a9ba57d09577a0e7b0ac37651ed1bc3f0c8 | 2006-16-gaz.pdf | Present, not indexed |
| 4c7419fa2d5e44debcafe66900825581a2102bd5 | 2006-61-Synop.pdf | Present, not indexed |

Oversized exclusion remains ae6b11152a923ed75a90ab94312db82eab0b984d /
2003-6-gaz.pdf. The worker's exit 0 does not prove all document results succeeded;
its bill rerun reported 14 errors, including read failures for already-indexed
records. Database reconciliation, not that error count, defines the five gaps.
- C3b assigned separately on task/corpus-link-validation with Sol/high; bounded
  source-parser work, no live corpus regeneration. D1 corrections remain under
  review after independent probes found malformed-envelope, trust and buffer
  defects despite its original green suite.

### Original planning-task record

Four documentation files added only; no application code, database data,
functions, settings, source workbooks or corpus files modified. A read-only
ingestion heartbeat was created at the user's request. Existing plans and
uncommitted work were preserved. This draft has not been independently accepted
or executed; the next step is owner review of the concrete specs and sequence.

### Subsequent local implementation evidence

- C2 integrated as 8e2d6ab after supervisor source review and 22 SQL assertions on the disposable local pgvector database. No live migration or backfill.
- B3 integrated as 9695e5f after independent review (38 tests), supervisor rerun (33 tests), and localhost browser verification: anonymous direct /admin displays only sign-in, labeled controls, zero captured warnings/errors. Browser flag rejection is covered by SSR/unit negative controls; real authenticated browser checks remain a release gate.
- C3 dispatch scope explicitly includes ingest-documents/index.ts alongside the previously named mapper/handler/tests, to load existing metadata for a preserving merge. Hash validation uses exact UTF-8; declared n_chars uses Unicode codepoints while the existing operational UTF-16 size cap remains unchanged.

- Integrated 9695e5f validation: npm test 101 passed; Deno full suite 119 passed; npm run build passed (259 modules). Existing large bundle and deskBrief mixed import warnings remain. Local Vite also warned about existing public/data/embedded_csv/_manifest.json imports in src/lib/deskRowsFeed.js and archiveFeed.js; B3 browser console itself was clean. This unrelated feed warning is recorded, not repaired in the admin scope.

- D2 independent review passed 36 focused checks; supervisor reran 27. Integration paused after detecting external commit ee3f232 (15:44:29 IST) and ongoing unassigned chatStream/sources/repair/telemetry/validate edits in the original streaming worktree. Supervisor commit attempt made no commit (nothing staged). No external edits discarded; writer ownership question pending. Existing reviewed D2 commit can be integrated only after provenance/coordination is resolved.

- B4 server slice committed as 9283fc8 and integrated as ca9a23b: supervisor reviewed both route boundaries and reran 92 focused tests; author full suite passed: 193 Vitest, 119 Deno, and the build with existing warnings. Caller adapters and marketing fallback remain pending, so B4 stays open.
- C3 independent review found explicit ambiguity must invalidate previously link-derived metadata (document_key/bill identity/file_url_source); generic preservation alone is insufficient. C3 remains unaccepted pending revision and re-review.

- B5 entry-point slice committed as e83ff3f and integrated as ece3443 after supervisor source review and 11 focused Deno tests. Author full gates passed: 101 Vitest, 124 Deno, and the build. Accepted bearer selection excludes disabled legacy JWTs; no deployed credentials changed. Live grant inventory timed out; local broad-default bootstrap confirms a least-privilege migration is still needed for corpus/catalogue and retained organisation/consent tables. Apply B1/B2 first in its fixture and prove forbidden SQL powers fail while required user operations remain.

- B5 live read-only retry succeeded at 10:29 UTC: all 17 application tables have broad client-role grants (23 role/table grant entries including six anon entries), including TRUNCATE. No forbidden operation was attempted. The second slice will use 20260921000015_least_privilege.sql and supabase/tests/least_privilege.sql. It must preserve B1/B2 restrictions, make corpus/catalogue tables client-read-only, remove anonymous table access and unnecessary structural powers, and retain only RLS-supported operations for preserved organisation/consent tables. Clear historical column grants too. No global default-privilege change or unrelated schema rewrite is part of this slice.

- C3 revision accepted after independent 40-check review and supervisor rerun of 14 source plus 17 handler tests. Committed b3d1dda, integrated 1b71635. Author full gates: 82 Vitest, 130 Deno and build passed. Explicit link changes invalidate stale identity while sparse unrelated provenance survives. This changes future ingestion behavior only; no existing corpus records were modified or retried.

### C4 local source preflight (no retry executed)

All five unresolved current source files were read and their exact UTF-8 SHA-256
and Unicode character counts matched OCR_FILES.csv. A future retry must use
these exact IDs/revisions in an explicit manifest, not rerun the whole feature.
The large gazette should be sent alone; the four small synopses can form a
separate bounded batch. Recheck the live five-ID state immediately before any
requested retry and omit records already completed. Deploy the reviewed
ingestion handler and C2 migration only after separate production authorization.

| File | Unicode characters | Exact text SHA-256 |
| --- | ---: | --- |
| 2006-16-gaz.pdf | 969,286 | 69ae6a69a9b05fdccb7c3fb1e650c79ee183d9c6c6c362d98e131fd4f9dbcd52 |
| 2006-61-Synop.pdf | 5,519 | b599819886b13c53d9e8249239112559a7f7c2bbc11e43822c8a917f550a2984 |
| 2006-73-Synop.pdf | 8,777 | 59abf3b881954a01b369d9959486ee2b742c1d27050b1dab9fbe355625bc15c0 |
| 2006-76-Synop.pdf | 6,053 | 5ec93bfef3210b4500cd196f9eeff8db77d704ed4aa5ced5f3f91b25af2fb4a4 |
| 2006-93-Synop.pdf | 5,306 | e10b3cf1b227f4a1f247171a4c6a4c69e024ad8c75e4b7c047b38e29aeb53522 |

- B4 adapter scope expands to eight files to preserve legacy data while fixing
  account isolation. The three underlying preference stores expose an owner
  binding, defaulting to no verified owner; persistent writes use user-ID keys.
  Original unowned keys remain byte-for-byte untouched, with no automatic
  migration/upload. Unknown identity must not render old local chats. Tests
  cover first render, ownership, failed hydration, logout, expiry and switching
  back to an account. This narrowly supersedes the original streaming plan's
  untouched-aiChatStore boundary; legacy AI transport behavior is retained.

- B4 server runtime verification on integrated localhost: anonymous GET and
  PUT to both /api/users and /api/user-prefs returned 401 with only
  "Authentication required". No credentials were supplied; denied requests
  do not reach storage. The temporary development server was stopped.
- B4 includes a final internal preference-row identity correction in
  server/userPrefsApi.mjs and src/lib/localUserAuthorization.test.js, assigned
  in a separate checkout. New rows use a namespaced verified Supabase user ID
  in the existing key column, not a recyclable email address. Legacy email
  rows remain unchanged and are not automatically adopted. Public request and
  response contracts remain unchanged, so this may run alongside the browser
  adapter slice with disjoint writes. Tests cover email change/reuse and legacy
  row preservation; no production or existing local DB migration is run.

- Expanded B4 adapter implementation is frozen for independent review: 61
  focused checks, 251 full Vitest tests, 119 Deno tests and build passed in
  the author checkout; 19 restored-defect controls failed as intended. Legacy
  keys are preserved, new caches use verified user-ID keys, and unbound demo
  edits are ephemeral. These are fake-client/storage executions, not live
  account browser acceptance. Existing synchronous admin mutation callers
  cannot yet display asynchronous server failures; record this UI limitation
  separately rather than claiming it is repaired by endpoint authorization.

- B4 stable server preference ownership committed 9d8a6e8 and integrated
  5a25aef after source review and supervisor rerun of 96 endpoint checks.
  Same user ID retains its rows across email changes; a different user ID
  cannot inherit those rows through email reuse. Legacy email rows remain
  untouched. Author full gates: 211 Vitest, 135 Deno, build passed.
- B5 SQL independent review passed the 2,015 assertions, preserved B1/B2/C2
  suites and hostile-ACL/idempotence probes, but identified remaining service
  structural privileges on the six protected tables. Revision is required:
  reset service-role table/column ACLs on all 17 tables and restore CRUD only,
  without changing the authenticated B1/B2 column grants. Include PostgreSQL
  17 MAINTAIN in applicable tests; avoid version-specific migration syntax.

- B5 completed locally: service structural gap fixed, supervisor inspected the
  revised migration and reran 2,174 assertions with zero failures. Author also
  reran B1/B2/C2 (43/59/22) and service table/column negative controls. Commit
  8274947 integrated as bded460. No live migration or function deployment.
- B4 adapter independent review found three blockers: an unhydrated admin
  mutation can upload demo seeds as a replacement directory; token refresh can
  overwrite unsynced owned preferences; passive stale sign-in events can reopen
  a failed logout. The eight-file changes remain uncommitted and unaccepted.
  Required revisions preserve authoritative directory snapshots, pending owned
  edits, and a logout latch resumable only through deliberate authentication.

- Final B4 login slice includes the existing admin-session adapter and its test
  because a deliberate successful sign-in must explicitly resume the shared
  local-identity boundary after logout. Passive Auth events cannot reopen it.
  The helper independently verifies the returned session, matching active
  profile and unchanged token before reopening. Marketing login must reject
  Auth/network/profile failures without local credential fallback, including
  `?demo=1`; personas remain preferences. No new demo product mode is added.
  Verification covers absent/expired/mismatched sessions, inactive profiles,
  failed logout followed by stale events, deliberate ordinary/admin sign-in,
  and anonymous browser rendering. No real Auth accounts are test fixtures.

- Final B4 admin-session wiring also synchronously invalidates shared local
  identity and directory cache before awaiting its SDK logout. The adapter
  exposes a local-only invalidation helper reused by ordinary logout; callers
  must not send duplicate SDK sign-outs. Re-review also covers directory GET
  ordering across mutations and automatic resumption of persisted owned dirty
  preferences after successful hydration, without uploading clean defaults.

- Subsequent read-only check of the old streaming checkout found it switched
  to main, clean and 20 commits ahead of origin/main, HEAD 7afd3ab (streaming
  merge), with 6f81ba7 corpus merge beneath it. Another writer continued after
  the initial ee3f232 conflict. No supervisor integration from that checkout
  occurred. Resolve writer ownership, then compare final trees/history before
  any D2 continuation or E4 merge; do not assume the original four-file diff
  remains the complete external change set.

  The external history now includes 99502a7 (handler/repair/telemetry), 849e70b
  (browser stream/conversations), af931b2 (panel components) and 66d9ebc
  (panel help). These overlap D3-D10 and must be reviewed as recovery inputs
  before dispatching duplicate implementation. Their presence is not acceptance
  evidence. The external main tree does not include the independently reviewed
  recovery security/corpus commits; that is branch divergence, not evidence
  those fixes were deleted.

- B4 adapter slice accepted after revised independent review: 10 independent
  probes and 90 focused checks passed; supervisor reran the 90 checks. Author
  full gates: 280 Vitest, 119 Deno, build passed; 32 negative controls restored.
  Commit 5920609 integrated as d2711be. Final four-file login/admin-session
  wiring assigned next in task/local-login-authority. B4 remains open until
  that wiring and its independent verification pass.

### Fixed-commit external streaming review — 99502a7

Read-only recovery review used Git-object copies and fake providers, not the
external checkout. Fourteen existing handler tests passed; eight independent
contract probes failed and one reader-disconnect probe passed. D3/D4 stay open:

- Claim is conversation-scoped: omitted-parent retry creates a second
  conversation and spends again (four model calls instead of two). Changed
  payload is treated as a duplicate instead of a conflict. No durable assistant
  reservation, running claim, expiry/replay or terminal finalization guard.
  Evidence: handler.ts:260–272, index.ts:60–70; existing duplicate test uses a
  global turn-key set that hides the actual database key scope.
- Assistant insertion uses the caller JWT (index.ts:84–105,177–187), incompatible
  with accepted B2 client grants/RLS. Add service-only claim/finalize operations
  with verified-parent ownership; do not loosen B2 to accommodate the adapter.
- Provider failures before or after visible answer text persist no assistant
  result (handler.ts:425–446). Partial text is lost on reload.
- Exhausted length continuations store complete despite a truncated frame
  (handler.ts:487–497).
- An invalid supplied parent silently creates a new conversation and runs the
  provider instead of rejecting (handler.ts:260–268).
- Private internalReasoning is sent publicly and saved after identifier-only
  redaction (handler.ts:334–345). It must stay private; redaction is insufficient.

Preserve existing verified Auth/model checks, successful/cancelled persistence,
selected-row verification, same-existing-conversation duplicate suppression,
and no model swap after visible text. Reader-disconnect behavior passed only
within the live worker lifetime; this does not prove durable restart recovery.
At this review checkpoint integration was paused pending writer ownership. The owner subsequently confirmed no other worker is active; the pause is resolved as recorded below.

- Read-only GitHub tip recheck after external main merges: origin/main remains
  63ef6a1266766ef3d8cfc199356d834e1ddb33ed; upstream/main remains
  37191d8cebbbe92f640ac436d8686a1004a95b35 (`git ls-remote --heads` both remotes).
  No supervisor push occurred; the observed new external commits are local.

- B4 final caller slice accepted: 79 focused tests rerun by supervisor; fresh
  independent review added 11 passing probes with actual identity helpers and
  fake Auth/storage. Fourteen mutation controls restored after intended failure.
  Commit cd1e119 integrated as 8c9c4fb. Browser verification on localhost:
  `?demo=1#login` displayed blank normal credentials with no demo bypass; direct
  `/admin` showed sign-in only, no private UI. Both pages had no browser console
  warnings/errors. Temporary tab and localhost server closed. Existing Vite
  public-manifest import notices remain unrelated warnings. No real Auth login
  or production account writes were attempted.
- Supervisor reproduced the fixed-object streaming probes: eight failures and
  one disconnect pass, confirming the D3/D4 recovery findings above.

### Combined local verification at 8c9c4fb

Supervisor ran on task/supervisor-recovery:

- `npm test`: 344 tests passed across 23 files.
- `deno test -A --config supabase/functions/deno.json supabase/functions`:
  135 passed, zero failed.
- `npm run build`: passed, 259 modules; existing mixed deskBrief import and
  2.25 MB bundle warnings retained. No lint/type-check/CI result claimed.
- Previously verified disposable SQL: B1 43, B2 59, C2 22 and B5 2,174
  assertions passed. No SQL changed during final adapter/caller integration.

Recovery branch is local only. Live migrations, deployments, five-ID retry,
SMTP/Vercel acceptance, external streaming recovery and publication remain
open. Owner subsequently confirmed no other worker is active. Review overlapping
local main work as recovery input before integration. Existing primary checkout
modifications remain intact.


### Resumed recovery and live corpus audit — 2026-09-21

Owner confirmed no other developer/IDE worker is currently active and authorized
continuing local recovery with agent skills. The prior observed commits/branch
changes did not establish their authoring process; references above to another
writer were an inference. Ownership is no longer a blocker. Local main is
7afd3ab; recovery was clean at 8c9c4fb before resumption. Production operations
and publication retain the separate E2/E4 authorization gates.

Read-only live SQL and local OCR_FILES.csv reconciliation now establish:

- All 2,337 eligible IDs are present, with no unexpected IDs and no stored
  content_sha256 mismatch against the current source index. 2,335 are indexed.
- Only 1f7ffc739c73a91f3fb346698a07b8bd618c20fa (2006-93-Synop.pdf) and
  4dc99a9ba57d09577a0e7b0ac37651ed1bc3f0c8 (2006-16-gaz.pdf) remain unindexed;
  both have zero chunks. The earlier five-ID retry proposal is superseded.
- Oversized ae6b11152a923ed75a90ab94312db82eab0b984d remains absent and excluded.
- 51,057 chunks: zero absent embeddings, blank contents, invalid/null spans,
  orphan chunks or chunks belonging to unfinished documents. Every indexed
  document has chunks. Latest indexed_at is 2026-09-21T10:25:26.051Z.
- 300 deterministic chunk-ID samples matched their exact stored document spans;
  this sample excludes astral-codepoint text because JS offsets use UTF-16.
  This is sampled integrity evidence, not full retrieval relevance acceptance.
- No matching ingestion worker was found by read-only process inspection.
  The additional indexed records since the previous observation do not establish
  who retried them. No ingestion was triggered by this audit.
- 716 original file URLs are blank (123 bills, 504 regulatory, 82 questions,
  6 industry, 1 budget). 1,619 documents have bill document keys. Missing URLs
  require authoritative source reconciliation, not invented links.
- All 2,337 page_count columns and 51,057 chunk page_number fields are null.
  Chunks are document text spans, not declared PDF-page chunks. Metadata n_pages
  is populated and includes positive counts; evaluate a validated page_count
  backfill separately. A document page count does not identify chunk page spans.
- Metadata integrity is blank on 1,288 records; unknown must remain unknown
  unless supported by source evidence. No blank title/OCR text or empty metadata
  object was found. The wider provenance envelope still needs source comparison.
- Live migration history ends at 0011. Local 0012–0015 and ingest-function
  hardening remain unapplied. Live match_documents still lacks indexed_at gating.

Independent fixed-object browser review (849e70b/af931b2/66d9ebc) passed 29
existing tests but reproduced ten failing contract probes. D7–D10 recovery must
address B4 logout/cache/request isolation; late account hydration; first-turn
conversation-ID adoption preserving text/Stop; cancellation failure and early
Stop; premature EOF; durable D3 retry/reload states; persisted Work-mode sources;
and allowed reasoning effort on role shortcuts. Use existing B4 helpers rather
than creating a competing identity boundary. Exact paths remain D7–D10 above,
with aiClient.test.js, AgentComponents.test.jsx and AiPanel.test.jsx as focused
test paths. No browser source edits were made by this read-only review.

Documentation reconciliation is required in this plan, corpus reconciliation
spec/first-pass status, streaming handover/status, and E3's AGENTS.md/README.md/
coordination.md. Older dated evidence remains historical, not silently rewritten.


D2 recovered locally as a038a93 from independently reviewed ee3f232. Supervisor
reran the 27 agent/retrieval tests on the integrated recovery branch: all passed.
The branch remains clean. No external handler or browser work was blindly merged.
Fetch on resumption confirmed origin/main at 63ef6a1; upstream/main advanced to
2bbdc3c. Upstream changes remain a separate reviewed E4 integration decision.


D3 implementation dispatch uses the existing isolated recovery checkout and the
approved contract appended to streaming-handover.md. Exact CLI-generated local
migration: supabase/migrations/20260921115831_research_turn_persistence.sql.
Exclusive scope is persistence.ts/test, handler.ts/test, the SQL migration/test,
and oversized-turn-key rejection in validate.ts. Baseline 14 handler tests pass;
eight new persistence/key guards failed on the recovered implementation before
edits. The nine recovered prerequisite files are unaccepted working inputs;
index.ts/config.toml remain excluded until D6. No production action occurred.


D5 recovery review adds two bounded prerequisite scopes before repair/telemetry:
research-chat/sources.ts + sources_test.ts must reject a forged suffix on an
issued handle; research-chat/validate.ts + new validate_test.ts must bound row
column names (existing value/count caps leave keys unbounded). D3 retains its
exclusive oversized-turn-key edit until it lands; no concurrent edits to validate.
Then repair.ts/repair_test.ts and telemetry.ts/telemetry_test.ts plus handler.ts
must reject factual rewrites or unfinished/filtered/tool-call repair output,
charge repair within the shared 12-attempt cap and log each attempt including
thrown repair errors. Existing same-length rewrite acceptance was independently
reproduced by the supervisor using a fake generator with no finish event.

E3 documentation drafts now update recovery AGENTS.md/README.md and the primary
ignored coordination.md, clarifying actual test commands, current architecture,
modern key names, corpus citation limitations, local versus deployed status and
unverified email/Vercel acceptance. They remain pending independent review and
final status reconciliation; no documentation has been published.


Supervisor reproduced all ten independent browser-recovery failures with
`vitest run --config review.config.mjs review.probes.test.jsx` on fixed-object
copies. These are intentional failing review probes, not failed tests of the
accepted recovery baseline. They define D7–D10 acceptance before integration.

Backfill refinement: source inspection validates 2,337 total-page counts but the
foundation defines page_count as null until pagewise Markdown; filling it requires
a semantic amendment and is not needed for OCR-span citations. Required provenance
restoration can be metadata-only using each source ID and expected text hash.
The source sidecars provide missing host/licence/date fields; preserve their
meaning, never infer publication freshness or permission. No missing URL joins
or missing integrity values can be recovered from the currently inspected inputs.


E3 tracked documentation independently reviewed and committed locally as 22ef26b
(AGENTS.md/README.md only). Reviewer-identified stale coordination/onboarding
statements were corrected in ignored local docs; onboarding is a narrow E3
scope extension to remove the obsolete no-tests claim. Final E3 closure still
requires final implementation/deployment statuses and older-plan cross-links.

D5 citation-token prerequisite is a separate concurrent task with unchanged
interfaces: exact scope _shared/{citations.ts,citations_test.ts,handles.ts,
handles_test.ts}, in supervisor-created task/citation-token-boundaries at
/private/tmp/niyantran-citation-token-boundaries. It corrects the shared helper
at its origin rather than adding a duplicate recovery rule in sources.ts.
D3 does not modify those files. Validation-key limits wait for D3's validate.ts
edit to land; no overlapping source writes are authorized.


A3 inspection/recovery checkpoint is closed: Tasks 1/2 history and Task 3 files
were distinguished and recovered, D1/D2 focused baselines reproduced, later
external handler/browser commits inventoried and independently reviewed as fixed
objects, and owner coordination resolved. This closes recovery inspection, not
the remaining D3–D10 correctness work or E4 final history integration.


A bounded read-only match_documents smoke check used one existing stored chunk
embedding per feature and scoped retrieval to that document. All five features
returned three chunks with nonblank content and ordered spans, all within the
requested document. This confirms the deployed retrieval RPC can return source
spans; it is a privileged SQL check using stored vectors, not a signed-in browser,
new natural-language query embedding, or semantic answer-quality evaluation.
No provider call or database write was made.


D5 citation-token prerequisite accepted after supervisor source review and
14 focused plus nine full-ladder existing checks. Commit 31b0ec2 integrated
as 4cb3006. Author's full gates: 344 Vitest, 162 Deno, build passed; original
three new guards failed before the fix. Independently reviewed sources,
chatStream and pure telemetry helpers recovered as b2284f7 after 13 supervisor
checks. Handler attempt logging remains unaccepted and separate.

D5 repair leaf is a concurrent two-file task: research-chat/repair.ts and new
repair_test.ts in task/citation-repair-contract. Its existing input/result shape
remains stable; it must require a valid stop finish, reject missing/length/filter/
tool-call finishes, and permit citation insertion without factual rewriting.
Prompt material remains untrusted evidence. Exceptions remain visible to the
handler for per-attempt accounting; D5 handler budget/log integration is sequential
after D3/D4. No model/provider invocation outside fakes is authorized.


D4 includes a newly confirmed adapter prerequisite: _shared/openrouterStream.ts
and openrouterStream_test.ts currently synthesize a successful stop/tool_calls
finish when the raw provider stream supplies no finish_reason. Remove this false
completion path and test premature EOF/[DONE] without a provider finish before
relying on D5's valid-finish check. Preserve valid completed streams without usage
(usage stays unknown), and never execute incomplete tool calls. This is a narrow
D4 scope extension; no provider calls are required for its verification.


D4 cancellation acceptance includes the repair phase: the recovered handler
clears its cancellation poll before citation repair begins, so Stop during repair
is otherwise ignored. Keep cancellation observation bounded across the whole
claimed execution and clear it on every terminal/deadline path. Raw hidden
reasoning is never a public ticker input; use tool events or concise server-owned
activity labels. Do not claim identifier redaction makes private reasoning safe.


D5 repair leaf reviewed by supervisor and committed in its isolated task branch
as d51f781, pending recovery integration after the frozen D3 review. Supervisor
reran all 17 focused tests. Author: original 13 failures/3 passes, then 17 focused,
192 full Deno, 344 Vitest and build passed. Only repair.ts/test changed; factual
rewrites, incomplete/filtered/tool-call finishes and post-finish events now fail
closed while provider exceptions remain observable to the handler.

D3 author froze seven scoped files for independent review: 40 focused, 215 Deno,
344 Vitest, build; disposable B1/B2/C2/B5/D3 assertions 43/59/22/2183/77 all passed.
Actual concurrent claims/finalizations and 8 source/10 SQL removed-guard controls
were exercised. D3 is not checked off until independent review and supervisor
verification complete. Author now works only on the disjoint two-file D4 adapter
prerequisite in task/provider-stream-completion; root persistence files are frozen.


D4 terminal-status acceptance also checks malformed answer envelopes and provider
finish reasons: a null parseEnvelope or an unexpected/filtered finish must not
fall through to complete merely because some decoder text exists. Preserve
visible partial text as error/truncated as appropriate; do not silently store an
empty successful answer. This exercises the spec's existing malformed-provider
output requirement in the handler, independently of the D1 incremental decoder.


D3 accepted locally as 09b4a0b after independent review and supervisor verification.
Supervisor executed 57 combined persistence/handler/repair tests and 77 disposable
SQL assertions with rollback. Independent review additionally exercised 10 SQL
checks, four fake-provider probes and concurrent claim/finalization behavior.
The live schema is unchanged. D5 repair leaf is now integrated as 633375f.

D4 provider prerequisite accepted as 43dea17 after supervisor source review and
27 focused tests. Author recorded 196 Deno, 344 Vitest and build passes; three
post-finish defects reproduced before the fix, plus two removed-guard controls.
Missing/contradictory finish and late output cannot masquerade as success. D4
handler lifecycle remains open and is dispatched to the existing Astra/high
agent. A disjoint Astra/high task in task/research-selection-bounds owns only
validate.ts and validate_test.ts for the D5 oversized-column-name prerequisite.
These are actual dispatch settings, not a claim that the planned browser model
assignments have already run.


D5 selection-bound prerequisite accepted locally as 0433f53 after supervisor
review and nine focused tests. Names above 200 UTF-16 units are discarded intact;
no truncation collisions. Author reproduced five original failures and five
removed-guard failures, then passed 262 Deno, 344 Vitest and build. This bounds
retained selection data, not the HTTP request body.

D8 is dispatched concurrently in task/research-conversation-recovery from
43dea17, exclusive aiConversations.js/test and aiThreads.js. It uses the existing
Astra/high agent, replacing the planned Sol/high assignment for this slice. The
D3 ownership/status contract is fixed; D4 handler writes are disjoint. Required
first-frame draft adoption will expose an owner/draft-bound API for D10. D7
stream-client recovery remains sequential after its frame contract is verified.


D5 accounting review reproduced a partial-price estimate: 100 prompt + 50
completion tokens with only prompt pricing produced cost=0.1/source=pricing,
silently assigning zero cost to the unpriced completion component. Unknown
prices/counts must not imply free usage. The provider normalizer also defaults
missing token fields to zero. D5 includes a narrow follow-up scope in
_shared/openrouterStream.ts/test for nullable/unknown usage preservation, with
required consumer adjustments only in its existing handler/telemetry scope.
Retain actual provider cost when present and finite/nonnegative; otherwise
estimate only when every nonzero billed component has a known valid price.
Test partial usage, empty usage, partial pricing and mixed known/unknown totals.
D4 does not implement this accounting change.


D4 accepted after supervisor source review and reproduction of all 47 focused
checks. Author passed 274 Deno, 344 Vitest and build, with 11 restored-guard
controls failing as intended. The four-file change removes private reasoning
from public output, observes cancellation through repair, rejects malformed/empty
terminal answers, derives terminal frames from finalized storage and bounds the
live unread queue. Large saved answers replay on demand without an answer cap.
D5 per-attempt budget/accounting and D6 timestamp-safe cancellation cleanup remain
explicit follow-ups; no live behavior was changed.


D4 committed locally as 51c595c. D8 accepted after supervisor review, three
revisions and all 27 focused tests reproduced. Author passed 371 Vitest, 253 Deno
and build; 12 removed-guard controls failed. Identity/client changes clear the
cache, late results are rejected, pins are owner-specific, expiry projection is
immutable, and reload keeps sources/activity/errors/timing/model fields. D10
first-frame and final reconciliation wiring remains outstanding.


D8 integrated as ef74a2f (task commit5d0d3e2). D7 is now dispatched in
task/research-browser-stream from that verified D4/D8 baseline, exclusive four
client/test files. Actual assigned model is Astra/high using the existing agent;
the planned Sol/high assignment has not run. D5 proceeds concurrently only in
its server scopes. The optional internal attempt-metadata hook and bounded
logging contract are specified in the handover amendment before implementation.


D6 scope clarification from wiring review: include narrow handler.ts/type and
handler_test.ts plus telemetry.ts/test changes necessary for optional retrieval
context and purpose=embedding. Old index.ts omits turn cancellation from query
embedding fetches/retries and their logs. These belong to the existing function
wiring requirement, not a corpus-ingestion rewrite. Fixed begin/observe/finish
attempt contract is recorded in the handover spec before D6 starts. Include
abort-during-query/retry tests, exactly-once embedding attempt logs, bounded
service RPC waits and timestamp-safe cancellation deletion. No schema or global
ingestion-helper change is authorized by this clarification.


A fresh process-list check found no matching local node/Python/Deno corpus-ingest
worker (command arguments were not printed). Together with unchanged DB counts
and indexed_at this establishes no observed local progress; it does not inspect
an inaccessible remote IDE host. No stop/restart/retry was performed.


D5 and D7 authors have frozen their scoped changes for independent cross-review.
Reported gates: D5 294 Deno / 371 Vitest; D7 274 Deno / 418 Vitest; both
builds pass with existing warnings. These are author evidence, not acceptance.
Fresh read-only NTER observation remains 2,337 documents / 2,335 indexed /
51,057 chunks, latest indexed_at 2026-09-21T10:25:26.051Z.

D3 integration follow-up: a supervisor rollback-only SQL probe reproduced two
reserved messages with only one distinct created_at. The current default now()
is transaction-scoped; created_at-only history ordering is consequently
ambiguous. Before D6 acceptance, correct the unapplied D3 migration and its
disposable SQL suite so each reserved user precedes its assistant and successive
claims in one conversation have strictly ordered pairs. Verify same-transaction
and concurrent claims, preserving existing idempotency and ownership gates.
Exclusive write scope: supabase/migrations/20260921115831_research_turn_persistence.sql
and supabase/tests/research_turn_persistence.sql. No live migration or backfill.


D5 accepted locally as 61a4fcc after independent review (87 focused checks,
five additional probes, full 294 Deno) and supervisor rerun (87 focused pass).
Author additionally verified 371 Vitest and build. Unknown usage stays unknown;
repair shares the twelve-call budget; per-attempt telemetry follows durable
finalization with bounded waits. D7 remains open: independent probes reproduced
terminal downgrade after reader failure and an unbounded identity-check wait;
its author is correcting both before acceptance.


D9 visual integration scope clarification: the recovered component commit adds
class names for ticker, citation bubbles, evidence surface and source reader but
the checkout has no corresponding styles (only the old model picker is styled).
Add one component-local src/ai/research.css, imported by the recovered components,
with selectors limited to this research UI. The evidence view must remain inside
the existing panel, scroll independently, preserve Back/close controls and work
at a narrow viewport. This is required rendering for the accepted UI, not a
redesign. Existing shared styles and unrelated application UI stay unchanged.


D7 accepted locally as 35822cc (task commit 1fcd13b). Supervisor reran
51 focused Vitest checks and both formerly failing independent review probes;
all passed. Author full gates: 422 Vitest, 274 Deno, build. Valid saved terminals
survive later transport errors; stalled identity checks cannot outlive timeout
or publish unverified content. D9 is dispatched in an isolated component
worktree at 35822cc with the fixed browser contract. Actual reused agent remains
Astra/high; planned Terra/medium assignment is not claimed as executed.


D9 reader scope extension: SourceReader.jsx and SourceComponents.test.jsx are
authorized only for HTTP(S)-only fetched/fallback file links, visible rejected
fetch handling, and guarded scrollIntoView. Preserve span/hash validation. A
malformed external URL must not become a trusted citation link; strict row
snapshot string values exclude arbitrary nested link objects before RowSource.
Fresh read-only live manifest confirms four active functions: health v4,
refresh-model-pricing v4, admin-models v4, ingest-documents v3. research-chat
is absent; migration history still ends at 20260921000011.


D3 chronology follow-up accepted as 0b63fd1. Supervisor reproduced all 87
SQL assertions and both concurrent/default-isolation and stale stronger-isolation
probes. The latter rejects atomically with 40001 and permits one fresh retry.
Author also passed 2,183 privilege assertions. D6 now owns backend wiring in
the recovery checkout; D9 owns components in its separate worktree. Both are
actual Astra/high agents, with no live actions or delegated child scopes.


D9 additional bounded interface fix: RowSource.jsx and RecordDetail.jsx may add
a default-preserving option to disable SourceBriefBlock only in citation
snapshot viewing. Source review confirmed opening a cited row otherwise calls
resolveOrganisedBrief, which may extract a source and invoke ensureDeskBrief
with a forced retry outside the research budget. Normal desk behavior remains
unchanged. Verify a mounted row citation makes zero brief-generation calls and
that removing the opt-out reproduces the call. Do not alter sourceDoc/deskBrief.


E3 scope includes correcting the Living streaming plan's status/cross-links:
its earlier IDE verification remains preserved and labeled as earlier evidence,
while current recovery acceptance and the selected repair-model decision are
explicit. Historical corpus/RAG/desk-row plans remain unchanged; the recovery
plan and corpus reconciliation spec supersede their current-status implications.


D9 accepted locally as 355ff0f (task dde1cfd). Supervisor reran 26 focused
checks and verified actual browser text highlighting, row snapshot with zero
brief calls, opt-out removal causing one call, normal desk retaining one call,
role/effort normalization, reader error, Escape/focus return, and 390px layout.
A fresh final browser session had no console warnings/errors. Author gates:
445 Vitest, 294 Deno, build; eight removed-guard controls failed correctly.

D10 can start against the fixed D4/D7/D8/D9 interfaces while D6 finishes:
backend wiring has no browser write scope or frame-contract changes. Final
D10 acceptance still depends on integrated D6. Isolated panel checkout starts
at 355ff0f. Alongside AiPanel/AiMarkdown and focused tests, scope permits a
research-only useResearchThread.js/helper and its test if needed to keep
lifecycle logic out of the existing large panel; research.css may receive only
panel status/layout rules. Underlying covered panel controls must not remain
keyboard-active while the evidence surface is open. Actual agent is Astra/high.

### D6 accepted — backend wiring

Accepted locally as 81e562e after supervisor review of all seven scoped files,
80 focused Deno tests and three independent entrypoint probes. Terminal and
running replays avoided model/provider execution; a real handler tool cycle
accounted for its embedding plus three chat attempts after finalization.
The author additionally passed 318 Deno tests, 445 Vitest tests, the production
build and ten removed-guard controls. The existing bundle warning remains.
The supervisor's first focused command omitted read permission for a dynamic
test import; the corrected restricted-permission command passed all 80 checks.

Wiring uses verified caller identity/RLS for reads and explicit verified-owner
service persistence/accounting. Network waits are bounded, cancellation cleanup
compares the observed timestamp, and each actual query embedding retry is
accounted without altering ingestion. Auth SDK waits cannot abort its underlying
request, but late results cannot authorize subsequent work. No deployment,
live provider call, database write or repair-model configuration occurred.
D10 remains active in its isolated checkout; final integrated checks and E4
local history integration follow its acceptance.

### Production candidate inventory — not authorization or execution

The local candidate currently requires migration versions 20260921000012
(profile authority), 20260921000013 (conversation ownership), 20260921000014
(corpus revision integrity), 20260921000015 (least privilege), and
20260921115831 (durable research turns), in recorded order after verifying the
live 0011 baseline. Review current data against each constraint before applying.
Do not re-run foundation migrations or the pricing cron bootstrap.

Changed/new deployable function entrypoints are ingest-documents,
refresh-model-pricing and research-chat. Existing admin-models authorization
also depends on the reviewed profile RPC/migration. Recheck its deployed source
and grants at rollout rather than assuming a local deployment of another
function updates it. Function config retains internal authorization with
verify_jwt=false where specified.

Configuration names to verify without displaying values: SUPABASE_URL,
SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS, OPENROUTER_API_KEY,
ALLOWED_ORIGINS, REFRESH_SECRET and AI_REPAIR_MODEL. The selected repair model
is google/gemini-3.5-flash-lite; confirm its exact availability before rollout,
without silently substituting another model. Browser configuration remains
VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (publishable value), and
VITE_AI_BACKEND. No provider/server secret belongs in browser variables.

Live acceptance must identify two owner-approved ordinary test accounts and
one existing authorized internal-admin account without changing anyone's role
as a shortcut. No actual test identities have been selected or created.
One execution each of greeting, row count, document citation, Stop, and
close-tab/replay recovery is the proposed paid scenario bound, with no automatic
retry after an ambiguous result. Verify cross-account denial without deleting
users. Record actual model/usage/cost and persisted outcomes. A provider price
or model change requires revisiting the spend bound before authorization.

Corpus completion/backfill remains its own exact inventory and authorization:
two unfinished source IDs, one explicit size exclusion, and the separate
four-field metadata proposal. Vercel project/branch/environment and email
delivery still require access. This candidate will be reconciled against the
final D10 integrated commit before any production approval is requested.

### E4 read-only ancestry audit before D10 acceptance

Independent audit found all 28 paths from the five old IDE commits in the
recovery tree; only the active D10 panel/Markdown and Work-mode help remain
unaccepted. Both old main merge commits match their automatic merge trees,
with no hidden manual resolutions. A simulated normal merge produces 20
conflicts and also imports old panel/Markdown changes cleanly. Resolving only
conflicts in favor of recovery would therefore bypass D10 review.

After final D10 acceptance, recheck main at 7afd3ab and clean recovery/main
worktrees, preserve the primary dirty checkout, and fetch/review remote changes.
The proposed local reconciliation uses a documented `git merge --no-ff -s ours
7afd3ab` on recovery to retain old history whose behavior has been recovered
and reviewed. Verify the resulting tree is byte-identical to the accepted
pre-merge recovery tree, then fast-forward main in its existing clean worktree.
This is the whole-tree strategy `-s ours`, not conflict preference `-X ours`.
Do not execute until D10 is accepted; re-audit if either branch advances.
No branch removal, push or publication is implied.

### Required D7 follow-up discovered during D10 review

Two independent failing probes reproduced authoritative reload leaving a pending
lock and hiding saved terminal content behind an unknown partial stream. Scope
expansion is limited to src/lib/researchChat.js and researchChat.test.js in
/private/tmp/niyantran-stream-reconcile, branch task/stream-reconcile at 81e562e.
The identity-design reviewer (Astra/high) implements the fixed reconciliation
contract in the handover spec, with TDD, negative guards and focused/full gates.
D10 owns only its controller invocation and rendered-state fixes. This is
disjoint parallel work; both must integrate before D10 acceptance. No production
action, provider call or replay is authorized by this correction.


## Supervisor handover and resumed verification — 2026-09-21 (evening)

The previous supervisor session ended on a provider usage limit, mid-task. A new
supervisor agent took over at the owner's instruction. The handover left D7's
follow-up and D10 written but **unaccepted and uncommitted** in their worktrees;
no work was lost and nothing was left half-written. Owner confirmed the prior
IDE cannot resume before its limit resets, so the remaining work continues here.

Earlier statements in this plan that anticipated a competing writer are
superseded by the owner's confirmation; they remain as dated record.

### Executed baseline — first execution evidence on this tree

Run by the supervisor. These are executions, not claims. Commands were run with
the OS sandbox disabled for the `/private/tmp/niyantran-*` worktrees only,
because Vite writes `vitest.config.js.timestamp-*.mjs` beside its config and
those paths are outside the sandbox write allowlist.

| Checkout | Base | Vitest | Deno | Build |
| --- | --- | ---: | ---: | --- |
| task/supervisor-recovery (clean) | 81e562e | 445/445 | 318/318 | pass |
| task/stream-reconcile + uncommitted | 81e562e | 462/462 | not run (out of scope) | not run |
| task/research-panel + uncommitted | 355ff0f | 470/471 — **1 failed** | 294/294 | pass |

The recovery baseline reproduces the previously recorded 445/318 exactly, so the
integrated tree has not drifted. Build warnings remain the known 2.25 MB chunk
and the `deskBrief.js` mixed static/dynamic import. No lint, type-check or CI
gate is claimed. Toolchain observed: Node 23.11.0, Vitest 3.2.7, Deno 2.9.7.

### D10 defect reproduced at the D7/D10 seam

`src/ai/useResearchThread.test.js` — "a reconciliation fence covers transport
abortion before the verified settlement promise resolves" fails:
`expected 'Your research session changed.' to be ''`. Eighteen of nineteen
controller tests pass.

An obsolete transport result settling with `identity_changed` reaches the view
while a verified `reconcileSavedTurn` read is still in flight. The saved terminal
answer is authoritative and about to render; the stale error must be fenced. The
defect is in the **caller**, matching both the D7 source contract ("callers must
ignore that obsolete promise's identity_changed result") and this plan's
allocation of controller and rendered-state fixes to D10. Shipped, it would flash
a false session error over a correctly delivered answer and could leave the
composer locked.

Dispatched as a fix-plus-verification task, not a pure review, with the existing
failing test as its specification. Scope unchanged from D10's stated scope.

### D10 integration base

task/research-panel is based on 355ff0f while the recovery tip is 81e562e (D6).
`git merge-base --is-ancestor 355ff0f 81e562e` succeeds, and D6 changed only
`supabase/config.toml` and six `supabase/functions/research-chat/**` files —
disjoint from D10's `src/ai/**`. D10 therefore fast-forwards onto the recovery
tip. The 294 vs 318 Deno difference is D6's tests being absent from the panel
worktree, not a regression.

### Review-probe harness is absent

This plan cites `review.config.mjs` and `review.probes.test.jsx` as defining
D7–D10 acceptance. Neither exists in any worktree and neither is in git; they
were temporary fixed-object review artifacts. Acceptance for D7 and D10 therefore
rests on each slice's own tests plus fresh browser verification. Do not record
that the original ten probes were re-run, because they cannot be.

### Concurrency and model allocation actually dispatched

Three concurrent children, the protocol maximum, with disjoint write scopes:

| Task | Write scope | Model | Mode |
| --- | --- | --- | --- |
| D7 independent adversarial review | src/lib/researchChat.js + test | opus | parallel |
| D10 fence fix and full verification | src/ai/** panel, controller, markdown, css | opus | parallel |
| E3 local agent guidance | docs/agents/{coordination,onboarding}.md | sonnet | parallel |

The supervisor retains `docs/plans/2026-09-21-supervisor-recovery.md` and
`docs/specs/2026-09-21-corpus-reconciliation.md` and edits them concurrently;
no child may write them. Opus is assigned to both code slices because each sits
on an identity boundary with concurrency races and is the last gate before merge.
Documentation reconciliation does not need it. The plan's earlier GPT model names
describe the previous session's tooling and are not what ran here.

### Live database audit — read-only, 2026-09-21 evening

Executed against NTER (vfgcppstyzjarlzyqdac) through privileged read-only SQL.
No write, ingestion, deployment or provider call was made.

- Corpus unchanged: 2,337 documents, 2,335 indexed, 51,057 chunks, latest
  `indexed_at` 2026-09-21T10:25:26.051Z. Both unindexed records carry correct
  title, `file_url`, `document_key` and a `content_sha256` matching the source
  index, with `chunker_version` null and zero chunks. A retry is chunk-and-embed
  only; no mapping work is outstanding for them.
- Migration history still ends at 20260921000011. Four functions deployed
  (health v4, refresh-model-pricing v4, admin-models v4, ingest-documents v3);
  `research-chat` absent; no `research_turns` claim/lookup/finalize functions.
- Deployed `match_documents` still has no `indexed_at` guard, confirmed by
  reading the function definition. Harmless only because both unindexed
  documents have zero chunks. **Migration 0014 is a hard prerequisite before any
  re-ingest**, since a cleared `indexed_at` beside surviving chunks would serve
  stale content.
- `document_chunks` and `desk_rows` have **never been analyzed**: `last_analyze`
  and `last_autoanalyze` are both null and the restarts reset the counters
  (`n_live_tup` reads 31 for a 51,057-row table and 0 for a 34,184-row table).
  Both retrieval tables are planned on stale statistics. `ANALYZE` is proposed
  before and after the corpus retry.
- Postgres restarted a third time at 2026-09-21 10:24:55 UTC, one minute before
  the final successful index. `shared_buffers` 224 MB (Nano), `work_mem` ~2 MB,
  `maintenance_work_mem` 32 MB; `document_chunks` relation 853 MB of which the
  HNSW index is 380 MB; database 995 MB.
- Security advisors, all unmitigated in production: `create_organisation` is
  executable by `anon` via `/rest/v1/rpc/create_organisation` and self-assigns
  owner and enterprise plan; `is_platform_admin`, `get_my_profile`,
  `update_my_onboarding_profile`, `handle_new_user`, `is_org_member` and
  `is_org_owner` are likewise anon-executable; `update_updated_at_column` and
  `debug_timeout` have mutable `search_path`; Auth leaked-password protection is
  disabled. These are the identity-boundaries P0s, live. Deploying migrations
  0012-0015 before any real signup is the supervisor's standing recommendation.
- Auth now holds **two** users, superseding the earlier "all users deleted"
  record: niyantranai@gmail.com and nter-auth-test+1789985534982@gmail.com, both
  created 2026-09-21 ~10:12 UTC, both role=user, plan=explorer, status=active,
  no persona, onboarding incomplete. There is no internal-admin account, which
  E2 requires. Note `user_profiles` has its own `id` primary key and a `user_id`
  foreign key to `auth.users`; joining on `id` returns nothing.

### Repository state observed

21 worktrees, 26 local branches, 5 remote-tracking refs. `main` @ 7afd3ab is
20 commits ahead of `origin/main` @ 63ef6a1; `origin/dev` @ 25723f7. Nothing has
been pushed. Upstream is deliberately out of scope by owner instruction.

**Corrected 2026-09-21:** an earlier entry in this section claimed `main` was
registered to a worktree that no longer existed and that `git worktree prune`
was required. That was a supervisor error — a truncated directory listing read
as an absent directory. `main` is checked out at
`/private/tmp/claude-501/-Users-vighneshshukla-Downloads-DDL-Labs-Clients-AI-Project----Niyantran-AI/7ffd58b0-9804-4b16-aacc-c6b64a416cdd/scratchpad/wt-desk-rows`,
clean and 20 ahead of `origin/main`. No prune is needed and none was performed;
E4 fast-forwards `main` in that existing worktree exactly as originally planned.

### Advisor coverage verified against the local migrations

E3 returned a claim that no advisor finding is addressed by the recovery branch.
Supervisor verification against the migration sources shows that is wrong, and
the correction was applied to coordination.md. Actual coverage:

| Advisor finding | Closed locally by |
| --- | --- |
| `create_organisation` anon-executable, self-grants owner/enterprise | 0012 — `REVOKE ALL … FROM PUBLIC, anon, authenticated` |
| `get_my_profile`, `update_my_onboarding_profile`, `is_platform_admin`, `is_org_member`, `is_org_owner` anon-executable | 0012 — revoked from anon, granted to `authenticated`/`service_role` |
| `handle_new_user` anon-executable | 0012 — revoked from PUBLIC/anon/authenticated |
| mutable `search_path` on those six | 0012 — `ALTER FUNCTION … SET search_path = ''` |
| anon table/column access | 0015 — per-table `REVOKE ALL … FROM PUBLIC, anon` |
| `update_updated_at_column` mutable `search_path` | **not covered** — defined in 0002/0003, never altered |
| Auth leaked-password protection disabled | **not covered** — dashboard setting, no SQL fix |

So seven of nine findings are already fixed and verified locally; they remain
live risks solely because migrations 0012 and 0015 are undeployed. This
strengthens rather than weakens the case for deploying before any real signup.

**New finding — untracked production schema drift.** `public.debug_timeout()`
exists on the live database but appears in no migration in this repository. It
was created directly against `NTER` and is one of the two mutable-`search_path`
advisor entries. It must be a deliberate decision to adopt it into a migration
or drop it; it must not be silently removed, and its presence means the live
schema is not fully described by `supabase/migrations/`.

### E3 accepted with one supervisor correction

Scope held: `docs/agents/coordination.md` edited, `docs/agents/onboarding.md`
inspected and correctly left unchanged, the four pre-existing modified tracked
files untouched. Figures transcribed accurately against the audit. One
materially wrong claim corrected as above. E3 also correctly reported, without
fixing it, that this checkout's root `AGENTS.md` still carries the stale "no
automated test, lint, type-check, or CI command" line; that resolves on its own
at E4, because the reconciled version already exists on the recovery branch in
22ef26b and this checkout predates it.

### D7 rejected on first review — blocking defect found

The D7 follow-up is **not accepted**. Independent adversarial review (opus,
28 new probes, 22 restored defects) found that `reconcileSavedTurn` resolves the
saved assistant by `.eq('turn_key', …).eq('role','assistant')`, but
`chat_messages.turn_key` is populated on **user rows only**. Supervisor verified
this directly against the migration sources: `20260921115831:164` inserts the
user row with the key, `:166` inserts the assistant without it,
`finalize_research_turn` never sets it, and `20260921000002:36,40` constrains
`unique (conversation_id, turn_key)` with the comment "user turns only".

An equality filter against a NULL column never matches, so the function returned
`false` on every production call. **The slice was a no-op**, and D10's fence
would have been built on top of it. The delivered 62/62 suite did not catch it
because its fixture invented an assistant row carrying a turn key — a row the
unique constraint makes unrepresentable.

This is the clearest possible vindication of the protocol's non-vacuity rule: a
fully green suite proved nothing because every test agreed with the same wrong
assumption. It was found only because the dispatch required restoring each
protected defect and probing schema-shaped rows.

Remedy directed, inside the existing two-file scope and with no schema change:
resolve by retained message id when known (the 202 path rejects a response
without a non-empty `message_id`, so the dominant case always has it), and fall
back to an owner-scoped two-step read — user row by turn key, then the earliest
later assistant in that conversation, which the claim inserts at exactly
`user_created_at + 1µs`. Widening `unique (conversation_id, turn_key)` to include
`role` was rejected: that constraint is the D3 idempotency mechanism and carries
87 independently reviewed SQL assertions.

The reviewer's finding 2 was folded into the same dispatch: a successful
reconciliation currently resolves the open transport promise as
`identity_changed`, showing the user a false session warning. A distinct neutral
end reason is required, leaving the logout path unchanged.

`docs/specs/2026-09-21-streaming-handover.md` carried the same wrong premise
("an assistant matching the retained original turn key") and has been corrected
in place with a dated supervisor correction; the original text is retained.

### Open defects recorded, not yet scoped

- **`reconcileSavedTurn` idempotence** — a repeat call after a successful
  reconciliation returns `false`, indistinguishable from "still locked". The UI
  is correct because the operation is gone, but a caller branching on the
  boolean can misread it. Low severity; fix when D10's consumer is settled.
- **Transient verification failure is a dead end for every retained turn** —
  one rejected `get_my_profile` makes `verifiedLocalIdentity()` call
  `identityChanged(null)` (`src/lib/userStore.js:141-144`), which bumps the
  generation and removes **every** operation in the module, discarding retained
  replay intent for unrelated conversations too. Since D10 calls reconciliation
  after every reload, a single network hiccup silently discards recovery intent.
  It fails safe — nothing is spent or written — but it needs its own task in
  `src/lib/userStore.js`. Out of scope for D7, which only amplifies the blast
  radius by running it automatically.
- **Dead code** — the intermediate `'Saved result read failed'` throw is
  unreachable; the bare `catch` always replaces it, and that same bare catch
  converts genuine programming errors into "Try Reload", masking bugs.

### D10 verified by the supervisor — acceptance held pending D7

The fence defect is fixed and independently verified. Supervisor executions on
task/research-panel:

| Check | Result |
| --- | --- |
| `npx vitest run src/ai/useResearchThread.test.js` | 21/21 (baseline was 18/19) |
| `npx vitest run` | **473/473**, 30 files |
| `npm run build` | passes, only the two known warnings |
| Supervisor vacuity check | fence `await` removed → the original failure returns verbatim, 1 failed / 20 passed; restored → 21/21 |

Scope held exactly: `git diff --stat` shows `AiPanel.jsx` and `AiMarkdown.jsx`
byte-identical to the measured baseline (298 and 47 changed lines, unchanged),
and `research.css` moved 13 → 16 lines, the three being the declared z-index
rule and its comment. Only `useResearchThread.js` and its test carry the fix.

**Design.** `settleSaved()` captures the matching operation before the verified
read starts and hangs a `fence` promise on it; `execute()` awaits that fence
between the transport promise and `finishTurn`. It **defers** the obsolete
result rather than suppressing it, which is what preserves the genuine-error
path: with no read in flight there is no fence and an identity error surfaces
immediately. Nothing special-cases `identity_changed`. The fence is keyed to one
exact promise so concurrent reads cannot release each other's, and a `finally`
releases it when the read throws. The author additionally proved that a blunt
suppression rewrite fails its own new test, so the guard rejects the wrong shape
of fix and not merely its absence.

**Second in-scope fix, declared.** The reader overlay painted under the panel
header (`.ai-work-surface` z-index 5 against `.ai-v2-head` z-index 6), so the two
headers visibly collided whenever a citation opened. One rule added. The author
flagged this rather than folding it in silently, which is the correct handling.

**Browser evidence** used an isolated fixture outside the repository with fake
auth, RLS, storage and a fake SSE provider that throws on any external URL; zero
non-localhost requests, no live project, no model, no database. Observed: reload
after a completed answer renders the saved answer and citation with no stale
error, Stop gone, composer unlocked, still one request and one turn key; account
switch clears question, answer, evidence and reader and rehydrates the new owner;
a genuine terminal error still shows its message with partial text retained;
citation opens the correct highlighted span and a forged second source never
renders; Stop queues before acknowledgement with one cancellation write; 390px
layout has no horizontal overflow; console clean but for Vite and React DevTools
notices. A MutationObserver timeline captured the defect flashing
`err:"Fixture connection lost"` at 132 ms and clearing at 214 ms before the fix,
and no error state at any sample after it.

**Acceptance is held, not granted.** D10 cannot land before the D7 follow-up,
and the author reproduced why: this worktree's `src/lib/researchChat.js` does not
export `reconcileSavedTurn`, so in a real browser every Reload raises a TypeError
inside `settleSaved` and shows "The saved result could not be loaded. Try
Reload." even while the saved content renders. The author correctly declined to
add a defensive fallback — the interface is fixed and integration is the
supervisor's. Its browser fixture aliased the D7 worktree's transport to get
coverage, which was sound at the time but predates the D7 rework; the integrated
seam must be re-exercised against the corrected implementation before acceptance.

### D7 rework verified by the supervisor — accepted for integration

Supervisor executions on task/stream-reconcile:

| Check | Result |
| --- | --- |
| `npx vitest run src/lib/researchChat.test.js` | **107/107** (was 62) |
| `npx vitest run` | **507/507**, 27 files |
| `npm run build` | passes, only the two known warnings |
| Supervisor vacuity — original defect restored | resolving the assistant by `turn_key` again → **3 tests fail**, including the filter-honouring probe |
| Supervisor vacuity — role filter restored on read 2 | → **2 tests fail**, including "a deleted answer cannot adopt a later turn's answer" |

Scope held: only `src/lib/researchChat.js` (+74/−3) and its test (+416).

**The test fixture is the real repair.** The delivered suite passed 62/62 against
an assistant row carrying a `turn_key`, which `unique (conversation_id, turn_key)`
makes unrepresentable. The rework replaces it with `chatMessagesTable(rows)`,
which *applies the filters it is given* under SQL NULL semantics, so a query
shape that cannot match in Postgres cannot match in the test either. That is why
restoring the original defect now fails instead of passing. The lesson
generalises beyond this slice: a fake that answers canned results validates query
*text*; a fake that honours filters validates query *meaning*.

**Supervisor accepts the author's departure from the dispatch.** I specified
`.eq('role','assistant')` on read 2 of path (b). The author left it off and
flagged it rather than burying it. Its reasoning is correct and I verified it by
restoring the filter: with the filter, a turn whose reserved answer was deleted
matches the *next turn's* answer and adopts it; without it, the next message is
the following question, whose role recheck rejects it. The claim inserts the
answer at exactly `user_created_at + 1µs`, so the unfiltered next message is the
answer whenever it exists. The dispatch was wrong and the implementation is
right; the correction stands.

**Finding 2 closed without disturbing logout.** `remove(entry, reason =
'identity_changed')` keeps all four other call sites (lines 145, 200, 218, 522)
passing nothing, so the logout path is byte-identical; only reconciliation passes
`'reconciled'`. `result()` gains one branch returning a neutral
`status:'reconciled'` with empty `error`/`errorCode` for that reason alone. A
successful reconciliation no longer tells the user their session changed.

Residual limitations recorded honestly by the author and accepted: the path (b)
ordering contract rests on reading `claim_research_turn`, not on an executed
query against NTER; the filter-honouring fake reproduces PostgREST semantics as
understood, and is not PostgREST; and the client `Date.parse` backstop is
millisecond resolution, so the server-side `.gt` is authoritative for
microsecond ordering. The code says so in comments.

Findings 3 and 4 remain unfixed and separately recorded, as directed.

### Module D integrated and the seam verified — afcc041

Both slices committed on their own branches and merged into task/supervisor-recovery
by the supervisor, following the established integrate-after-review pattern:

| Slice | Task commit | Integrated as |
| --- | --- | --- |
| D7 follow-up | f0c0e16 | 0aed532 |
| D10 panel | 189c31e | afcc041 |

D10 was based on 355ff0f and merged forward without conflict, as the disjointness
check predicted (D6 touched only `supabase/**`, D10 only `src/ai/**`).

Integrated gates, run by the supervisor on afcc041:

| Check | Result |
| --- | --- |
| `npx vitest run` | **535/535**, 30 files |
| `deno test -A --config supabase/functions/deno.json supabase/functions` | **318/318** |
| `npm run build` | passes, only the two known warnings |
| Working tree | clean |

**Runtime seam check.** Unit tests inject fakes, so they cannot prove the real
binding resolves. A `vite-node` probe imported both real modules and constructed
the controller with no override for `reconcileSavedTurn`: the export resolves as
a function of arity 1 and the controller builds. The TypeError D10 reproduced in
its own worktree — `typeof reconcileSavedTurn === "undefined"` on every Reload —
is gone.

**Browser verification of the integrated path.** A supervisor fixture in the
session scratchpad resolves every module from the integrated worktree with **no
transport alias**, against fake auth, RLS, storage and a provider that throws on
any external URL. The reload race was driven deliberately: HTTP 202 running, a
terminal row saved server-side, "settle transport during read" armed, then
Reload. Observed:

- the saved answer rendered with its citation and source, "The proposal remains
  pending. [1]" / "Fixture committee record";
- **no stale error** — the error region was empty and the document contained no
  "session changed" text;
- **zero Stop controls inside the panel** and the composer neither disabled nor
  readonly, so the lock was released;
- still **one request and one turn key** — no second execution and no second
  spend;
- `blocked external: 0`, `legacy: 0` — no live project, model or database;
- console clean, no errors.

A following account switch cleared the previous owner's question, answer and
evidence and rehydrated as a draft for the new owner, with the second turn taking
a new distinct key. Fixture server and tab were stopped afterwards.

This closes the one interaction that had never been exercised: D10's fence had
only ever run against a fake or an aliased pre-rework copy, and D7's
reconciliation had never been driven by the real panel.

**Module D is complete.** D1-D10 are accepted and integrated. Remaining recovery
work is C4 (corpus retry), E1, E2, E3 closure and E4.

### E4 complete — local integration into main

Executed by the supervisor. No push, no deployment, no publication.

A normal content merge of `7afd3ab` was re-simulated and still conflicts, as the
earlier E4 audit predicted, and would reimport the superseded panel, transport
and handler implementations. The documented whole-tree strategy was used instead:

```
git merge --no-ff -s ours 7afd3ab     # on task/supervisor-recovery
```

producing **eeb4bb1**, whose parents are `afcc041` and `7afd3ab`.

| Verification | Result |
| --- | --- |
| Tree hash before / after the merge | `a2581e9a…` / `a2581e9a…` — **byte-identical** |
| `git diff afcc041 HEAD` | empty |
| `git merge-base --is-ancestor 7afd3ab HEAD` | true, so `main` fast-forwards |
| `main` fast-forward in its own clean worktree | `--ff-only` accepted |
| `main` tree vs recovery tree | identical |

Gates re-run on `main` itself at eeb4bb1: **535 Vitest**, **318 Deno**, build
passes with the two known warnings, working tree clean.

`main` is now 54 commits ahead of `origin/main` @ 63ef6a1. `origin` was
re-checked read-only afterwards and is unchanged: nothing has been pushed. The
primary checkout's four owner-modified files are untouched throughout. Task
branches `task/stream-reconcile` (f0c0e16) and `task/research-panel` (189c31e)
are retained; no branch was deleted.

Recovery modules A, B, C (except C4) and D are complete and integrated. E1, E2,
E3 closure and E4 publication remain.

## E2 deployment runbook — prepared, NOT executed

> Prepared by the supervisor at `main` = eeb4bb1. Nothing here has been run.
> Every step needs the owner's explicit authorization. This supersedes the
> earlier "Production candidate inventory" section, which predates D7/D10.

### Pre-flight, executed read-only against NTER

All checks below were run and passed, so no migration should fail on an
unexpected live name or on existing data:

| Risk | Check | Result |
| --- | --- | --- |
| 0012 drops `"Users can insert own profile"` without IF EXISTS | policy exists live | present |
| 0012 drops `"Authenticated users can create organisation"` without IF EXISTS | policy exists live | present |
| 0013 drops `chat_messages_{select,insert,update,delete}` without IF EXISTS | all four exist live | present |
| 0013 drops `chat_cancellations_{select,insert,update,delete}` without IF EXISTS | all four exist live | present |
| 0013 drops `chat_messages_conversation_id_fkey` without IF EXISTS | exists, `FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE` | present |
| 0013 drops `chat_cancellations_conversation_id_fkey` without IF EXISTS | same shape | present |
| turn-persistence drops `chat_messages_status_check` without IF EXISTS | exists live | present |
| 0013 adds composite owner FKs | `conversations`, `chat_messages`, `chat_cancellations` all hold 0 rows | no data to violate |
| turn-persistence widens the status check | `chat_messages` holds 0 rows | no data to violate |
| 0014 replaces `match_documents` | live identity `query_embedding vector, match_count integer, p_document_ids uuid[], p_desk_tier text` matches the replacement signature — replaces in place, no second overload | matches |
| 0014 / corpus integrity | orphan chunks | 0 |

0013 also carries its own guard: a `DO` block that raises with a remediation
HINT and changes no rows if any child row disagrees with its parent's owner.

### Apply in this exact order

| # | Migration | Effect |
| --- | --- | --- |
| 1 | `20260921000012_profile_authority.sql` | Trigger-guards role/plan/status/organisation on `user_profiles`; drops public self-insert; revokes the six anon-executable RPCs and fixes their `search_path`; disables public `create_organisation` |
| 2 | `20260921000013_conversation_ownership.sql` | Composite `(id, user_id)` parent keys; child rows must belong to both their user and their conversation; client cannot write assistant rows |
| 3 | `20260921000014_corpus_revision_integrity.sql` | `chunk_commit` stores exact current text on hash reuse; **`match_documents` gains `d.indexed_at is not null`** |
| 4 | `20260921000015_least_privilege.sql` | Per-table and per-column revocation from PUBLIC/anon, then minimum grants; corpus and catalogue become client-read-only |
| 5 | `20260921115831_research_turn_persistence.sql` | `research_turns` claim table, immutability triggers, `lookup/claim/finalize_research_turn`, widened status check, `chat_messages_owner_turn` index |

Order matters: 4 revokes broadly and re-grants, and it must run after 1 and 2
so their column grants are the ones preserved. 3 must be applied **before any
re-ingest** — the live `match_documents` currently has no `indexed_at` guard, so
a re-ingest that clears `indexed_at` beside surviving chunks would serve stale
content. This is the ordering constraint that ties E2 to C4.

### Functions to deploy

| Function | Why | `verify_jwt` |
| --- | --- | --- |
| `research-chat` | new; the entire streaming path | false — the handler verifies the caller itself |
| `ingest-documents` | provenance-preserving mapper from C3 | false — handler compares the bearer to the secret key |
| `refresh-model-pricing` | B5 rejects disabled legacy credentials | false — `REFRESH_SECRET` header or secret key |

`admin-models` and `health` are unchanged, but `admin-models` depends on the
reviewed profile RPC from migration 1. Recheck its deployed source and grants at
rollout rather than assuming another function's deploy refreshed it.

### Configuration to verify by name, never by value

Server (Edge Function secrets): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`,
`SUPABASE_SECRET_KEYS`, `OPENROUTER_API_KEY`, `ALLOWED_ORIGINS`,
`REFRESH_SECRET`, `AI_REPAIR_MODEL`.

`_shared/supabase.ts` reads the modern platform-injected JSON vars first and
falls back to `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. **This
project's legacy JWT keys were disabled on 2026-09-21**, so if a modern var were
missing the fallback would select a dead key and fail at runtime rather than
loudly at deploy. Confirm both modern vars are populated before deploying.

`AI_REPAIR_MODEL` = `google/gemini-3.5-flash-lite` (owner-approved). Confirm that
exact model is still served by OpenRouter before rollout; do not substitute.

Browser: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the publishable value,
despite the legacy variable name), `VITE_AI_BACKEND`. No provider or server
secret belongs in a `VITE_` variable.

### Bounded paid verification

Identities: the two existing ordinary accounts are `niyantranai@gmail.com` and
`nter-auth-test+1789985534982@gmail.com`. A second ordinary account is needed for
cross-account denial, and **no internal-admin account exists** — provision it
through the trusted path migration 1 establishes, never by editing a role as a
shortcut.

One execution each, no automatic retry after an ambiguous result: greeting (no
retrieval, no follow-up chips); desk row count; document citation opened in the
reader; Stop mid-turn; close-tab then reload replay. Then a cross-account denial
check that deletes no user. Record actual model, usage, cost and persisted
outcome for each. Revisit the spend bound if provider pricing changed.

### Rollback

Migrations 1, 2, 4 and 5 tighten privileges and add constraints; the tables they
constrain are empty, so reverting is a privilege restoration rather than a data
migration. 3 replaces two functions and can be reverted by re-applying the 0009
definitions. Function deploys roll back by redeploying the previous version.
There is no automated rollback script; prepare one before applying if the owner
wants an unattended path.

### Deliberately excluded from E2

The provenance backfill (four fields, 2,337 documents) and the C4 corpus retry
are separate authorized executions. `debug_timeout` — the live function present
in no migration — needs a deliberate adopt-or-drop decision and is not resolved
by this deployment.

## C4 retry manifest — prepared, NOT executed

> Prepared by the supervisor. Every step requires the owner's authorization.
> Recheck the live state immediately before executing; this manifest records a
> verification performed on 2026-09-21 evening, not a standing guarantee.

### The exact set — two documents, verified three ways

A fresh live read returned exactly two documents with `indexed_at is null`, both
with zero chunks and `chunker_version` null. Their on-disk source text was then
hashed and compared against both the OCR index and the live row:

| Source ID | File | Characters | index `n_chars` | source hash = index | source hash = live |
| --- | --- | ---: | ---: | --- | --- |
| `1f7ffc739c73a91f3fb346698a07b8bd618c20fa` | 2006-93-Synop.pdf | 5,306 | 5,306 | yes | yes |
| `4dc99a9ba57d09577a0e7b0ac37651ed1bc3f0c8` | 2006-16-gaz.pdf | 969,286 | 969,286 | yes | yes |

Both already carry correct `title`, `file_url` and `metadata.document_key`
(`bill:2006:93`, `bill:2006:16`). **No mapping work is outstanding.** Because the
stored text hash already agrees with the source, the handler will short-circuit
the text upsert; the retry is a pure chunk, embed and commit.

Expected result: roughly 750-800 chunks for the Finance Bill (the comparable
959,238-character `2011-8-gaz.pdf` produced 741) and 6-10 for the synopsis.
Estimated embedding spend is well under one US cent at `text-embedding-3-small`
rates; the whole 2,337-document first pass cost 0.2886 USD.

### Hard prerequisites, in order

1. **Migration `20260921000014` must be applied first.** The deployed
   `match_documents` has no `indexed_at` guard, so an ingest that clears
   `indexed_at` while old chunks survive would serve stale content. These two
   documents have zero chunks today, which is the only reason the gap is
   currently harmless — a retry removes that protection. This is the ordering
   constraint that ties C4 to E2.
2. Deploy the reviewed `ingest-documents` handler (C3 provenance preservation)
   before retrying, so the run does not write with the older mapper.
3. `ANALYZE public.document_chunks; ANALYZE public.desk_rows;` — neither has ever
   been analyzed and the planner is working from counters the restarts reset.
4. Confirm no other writer is active: no bulk desk-row load, no second ingest,
   no concurrent paid test.

### Execution, smallest first, one process

Run each separately and verify before starting the next. Do not run them
together, and do not use `--shard`.

```
node scripts/ingest-national-desk.mjs --corpus ~/Downloads/NTER-Complete-Processed-Data \
  --feature "Bill Passage Probability Index" \
  --only 1f7ffc739c73a91f3fb346698a07b8bd618c20fa --batch 1
```

then, only after the first is confirmed indexed:

```
node scripts/ingest-national-desk.mjs --corpus ~/Downloads/NTER-Complete-Processed-Data \
  --feature "Bill Passage Probability Index" \
  --only 4dc99a9ba57d09577a0e7b0ac37651ed1bc3f0c8 --batch 1
```

`--only` does not exist yet; it is task `task/ingest-only`, in progress. Until it
lands, the alternative is a full 1,742-document feature re-walk, which is what
that task exists to avoid.

### Verification after each document

- `indexed_at` is set and `chunker_version` is populated;
- chunk count is plausible and every chunk has an embedding, non-blank content
  and ordered non-overlapping-from spans;
- a sample of chunk `char_from`/`char_to` slices matches `documents.ocr_text`
  exactly (BMP text only — JS offsets are UTF-16);
- `documents` row count is still 2,337 and no other row's `indexed_at` changed;
- `model_call_logs` shows only `purpose=embedding` entries for this run, and the
  incremental spend is recorded.

Afterwards re-run `ANALYZE` on `document_chunks`, and re-check the total: the
expected end state is **2,337 documents, 2,337 indexed**.

### Risk and stop conditions

The Finance Bill at 969,286 characters is the load that coincided with earlier
Postgres restarts, though the comparable 959,238-character document succeeded at
09:36:36 UTC under a single-process `--batch 2` pass. The instance is unchanged
(Nano, 224 MB shared buffers, `work_mem` ~2 MB) and the HNSW index has grown to
380 MB, so the margin is thinner than it was then.

Stop and report rather than retrying automatically if: PostgREST returns 503 or
a schema-cache error; `pg_postmaster_start_time()` moves during the run; or the
document reports an error without `indexed_at` being set. A failed attempt leaves
the document exactly as it is now — stored, unindexed, zero chunks — so a later
attempt is safe, but repeated attempts inside one degraded window are not.

`2003-6-gaz.pdf` (`ae6b1115…`, 5,387,224 characters) stays excluded under the
2,000,000-character ceiling. Loading it needs a large-document path (page-wise
chunking or sliced commits), which is separate work and not part of C4.

### `--only` selector accepted and integrated — c72b71d

Task `task/ingest-only` (cd2bce3) integrated as **c72b71d**; `main` fast-forwarded
and is now 56 commits ahead of `origin/main`. Gates on `main`: **546 Vitest**,
**318 Deno**, build passes with the two known warnings, tree clean.

Supervisor verification beyond the author's report:

| Check | Result |
| --- | --- |
| Source review of filter placement | the selection applies to `rows` **before** the read loop, and `counts` is built after the `in_current_corpus` and feature filters — so a key from another feature is correctly reported missing, and unselected files are never opened |
| Vacuity: removed the missing-key throw | 3 tests fail, including the CLI exit-code test |
| Focused / full / build, rerun | 25 / 546 / pass |
| Smoke against the real 1,742-row feature | selected **exactly 2** documents, both with `file_url` and `document_key` |
| Missing key against the real index | exit code **1**, message names the key |

The smoke runs used a deliberately invalid `SUPABASE_URL` and a fake secret, so
the two dispatch attempts failed at the network with no live call. That also
surfaced something worth recording: **`--dry-run` is a server-side dry run**, not
a client-side one. The script posts `dry_run: true` and the handler returns at
`ingest-documents/handler.ts:240`, before `upsertDocument` and before the
embedding call guarded at `:221`. So it writes nothing and spends nothing, but it
does require reachable credentials. That is existing intended behaviour — it
reports `kept`/`inserted`/`deleted` against real stored hashes, which a local-only
dry run could not — and the option's "writes nothing" description is accurate.

Author's design decision accepted: `--only` is rejected outside `--corpus` mode
rather than implemented for `--manifest`/`--export`. Those modes read an already
bounded input, so the motivation does not apply, and rejecting is better than
silently ignoring a selector the user supplied.

C4 is now executable as a two-document operation the moment E2 lands.

## Local consolidation — 2026-09-21

Owner authorized consolidating the local repository before further development.

**Safety gate first.** `git cherry main <branch>` was run for all 25 task
branches. It reported **zero** commits without an equivalent patch in `main`, so
no work was lost by the cleanup. Branch tips were recorded to
`docs/2026-09-21-deleted-branch-tips.txt` before deletion and remain recoverable
from the reflog.

| Before | After |
| --- | --- |
| 22 worktrees | **1** — the primary checkout |
| 26 local branches | **1** — `main` |
| primary checkout on `task/corpus-ingest` @ fb7821a | on **`main` @ c72b71d** |

The primary checkout was moved to `main` with the owner's four modified files
preserved and verified byte-identical by checksum afterwards. `.claude/launch.json`
needed care: it is tracked on `task/corpus-ingest` but deliberately untracked on
`main` (commit 63ef6a1, "keep .claude/ local"), so the tracked copy was reverted
before the switch and the owner's edit restored afterwards as a local file. That
is the intended end state rather than a workaround.

Note for the owner: that launch.json edit defines a `desk-rows-worktree` entry
pointing at `…/scratchpad/wt-desk-rows`, which no longer exists. The entry is now
stale and its dev-server command will fail until it is edited or removed. It was
left untouched because the file is the owner's.

Gates on `main` in the primary checkout: **546 Vitest**, **318 Deno**, build
passes with the two known warnings.

**The push did not happen.** `git push origin main` was refused by this session's
permission layer as an out-of-place publication. `origin/main` remains at
63ef6a1 and `main` is 56 commits ahead. The push is a fast-forward — verified by
`git merge-base --is-ancestor origin/main main` — and needs no force. It must be
run by the owner, or the session needs a permission rule allowing it.

### Correction — the push has now happened (owner-executed, 2026-09-21)

The paragraph above ("The push did not happen") is superseded. The owner ran
`git push origin main` themselves in this session. Result:

    To https://github.com/ddllabs/niyantran.git
       63ef6a1..c72b71d  main -> main

459 objects, 358.50 KiB, no force, fast-forward exactly as predicted. Verified
read-only afterwards:

- `git status -sb` → `## main...origin/main` with no ahead/behind markers
- `git rev-list --count origin/main..main` → 0; `main..origin/main` → 0
- `main` and `origin/main` both resolve to c72b71d

Local and remote are now in sync: **one local branch (`main`), one worktree, one
remote branch tracking it**. The only working-tree modifications are the owner's
three `public/data/*.json` files, left untouched by design.

### Remaining remote loose end: `origin/dev`

`origin/dev` still exists on the ddllabs fork at 25723f7. It is **not** recovery
work and must not be deleted as cleanup. Facts:

- It is 95 commits behind `main`; merge-base is 570c3f1.
- `git cherry main origin/dev` reports 2 commits with no patch equivalent in
  `main`: 5675997 ("Add Google Sign-In with server ID-token verification") and
  25723f7 ("Reorder signup: persona and details first, plan after, Google below
  create"), both authored by ItsCloudDev on 2026-09-21.
- Both are also contained in `upstream/main`, so `origin/dev` is a stale pointer
  at a prefix of upstream's history, not independent fork work.
- `upstream/main` (2bbdc3c) carries **4** commits absent from our `main`: the two
  above plus 37191d8 ("Add admin testing phase with free full access and
  Gemini-only AI") and 2bbdc3c itself ("Ship profile menu, fold entry briefs into
  record panels, and add nter.news ingest").

Deleting `origin/dev` would not lose the commits — upstream holds them — but it
is an outward-facing change to a shared remote and is out of scope for the
consolidation. Upstream integration remains deliberately deferred by owner
instruction; note that 37191d8 introduces a Gemini-only AI path, which conflicts
head-on with the OpenRouter-sole-gateway constraint in `AGENTS.md` and will need
a deliberate reconciliation decision rather than a merge.

## Repository hygiene pass — 2026-09-21 (owner-authorized)

Owner asked for local and remote to match with no leftover dangling data or
stale branches, upstream reconciliation explicitly deferred. Executed:

**1. Leftover refs from the previous IDE — found and removed.** Two refs existed
under `refs/codex/turn-diffs/checkpoints/…`, invisible to `git branch`, left by
the Codex IDE the earlier agent was running in. Both were **tree** objects, not
commits — whole-worktree snapshots taken at 2026-09-20 16:41 UTC (600 files) and
2026-09-21 14:31 UTC (711 files).

Before deleting, every blob in both trees was set-differenced against every blob
reachable from `main`'s full history (`git rev-list --objects main`, 2010
objects). Result:

- 2026-09-20 checkpoint: **0** blobs absent from `main`'s history.
- 2026-09-21 checkpoint: **4** blobs absent — `public/data/{conflict,markets,news}.json`
  (older 14:31 feed snapshots, superseded by the 15:15 refresh) and
  `.claude/launch.json`, whose blob is **byte-identical** to the copy already in
  the owner's working tree (bfa02a2).

No source code, test, migration or document existed only in those checkpoints.
Both refs were deleted.

**2. Insurance bundle before pruning.** `docs/2026-09-21-deleted-branches.bundle`
(79 KB) captures the 16 recorded branch tips that are *not* ancestors of `main`,
thin against `main` as prerequisite. The other 10 recorded tips are ancestors of
`main` and therefore already published. Verified: **0** of the 26 tips in
`docs/2026-09-21-deleted-branch-tips.txt` are unprotected. Restore with
`git bundle unbundle`; `main` must be present first.

**3. Working tree committed.** 3cf9388 `chore(data): refresh desk feed
snapshots`. These were machine-regenerated feed caches, not hand edits:
`conflict.json` differs only in `fetched_at`/`updated` (88 rows identical);
`markets.json` and `news.json` carry live quote and headline movement. Row counts
unchanged at 88/9/4. Committing them follows existing practice in this repo.

**4. Object store compacted.** `git gc --prune=now`: 1097 loose objects (5.20 MiB)
→ **0**; single pack, 101.08 MiB. `git fsck` exits clean with **no** dangling,
unreachable or broken objects. The HEAD reflog (100 entries) was deliberately
left intact as a further safety net; expiring it was neither necessary nor
attempted.

**5. Published and pruned.** `git push origin main` → `c72b71d..3cf9388`,
fast-forward. `git fetch --prune --all` removed nothing — there were no stale
remote-tracking refs.

**Verified end state:** 1 local branch, 1 worktree, clean working tree, `main` ==
`origin/main` == 3cf9388, zero dangling objects. Gates: **546 Vitest**, **318
Deno**, build passes.

### Deliberately not done: `origin/dev`

Merging `origin/dev` into `main` was tested non-destructively with
`git merge-tree --write-tree main origin/dev`. It does **not** auto-merge — five
content conflicts:

    package-lock.json
    package.json
    src/marketing/LoginPage.jsx
    src/marketing/SignupPage.jsx
    vite.config.js

`origin/dev`'s two unmerged commits are upstream authorship (ItsCloudDev) and are
contained in `upstream/main`, so this is the upstream reconciliation the owner
deferred, not fork cleanup. The branch was left in place; deleting it would also
be an outward-facing change to a shared remote.

Note: `upstream/main` advanced during this pass, `2bbdc3c..528dfb4`. Upstream is
now **5+** commits ahead of `main`, still including 37191d8's Gemini-only AI path,
which conflicts with the OpenRouter-sole-gateway constraint in `AGENTS.md`.

## E2 pre-flight re-verified live — 2026-09-21 17:43 UTC

The runbook above was prepared at `main` = eeb4bb1. Every fact in it was re-read
against NTER before proposing execution. Results, and the corrections they force.

### Still true, re-confirmed

| Fact | Live reading |
| --- | --- |
| Applied migrations end at 0011 | `list_migrations` returns 0001-0011, nothing further |
| Policies 0012/0013 drop without IF EXISTS | all 10 present |
| FKs and `chat_messages_status_check` dropped without IF EXISTS | all 3 present |
| Tables the new constraints touch are empty | `conversations` 0, `chat_messages` 0, `chat_cancellations` 0 |
| `match_documents` replaces in place | identity `query_embedding vector, match_count integer, p_document_ids uuid[], p_desk_tier text` — single overload |
| Live `match_documents` lacks the readiness guard | `position('indexed_at' in prosrc) = 0` — **confirmed missing** |
| Orphan chunks | 0 |
| Corpus shape | 2,337 documents, **2** unindexed, 51,057 chunks, 0 null embeddings |
| `research_turns` | does not exist |
| `debug_timeout` | still present, still in no migration |
| Identities | 2 auth users, both `role=user`, `plan=explorer` — **no internal admin** |
| Postgres uptime | start 2026-09-21 10:24:55 UTC, 7h18m — **no fourth restart** |

### Corrections to the runbook

**1. "`admin-models` and `health` are unchanged" is not accurate.** Both import
`_shared/supabase.ts`, which was rewritten by 7ff8e04 (2026-09-20T20:55:59Z) to
read `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` instead of the legacy
JWT vars. All three functions deployed at 2026-09-20T20:52:44Z — **3 minutes 15
seconds before that commit**.

The key question is whether those bundles hold working credentials, and the
answer is yes, empirically: the `refresh-model-pricing` cron (`0 */12 * * *`,
jobid 1) succeeded at 00:00 and 12:00 UTC on 2026-09-21, and
`model_pricing.fetched_at` = 2026-09-21T12:00:01Z across 446 rows. A function
calling `serviceClient()` wrote to the database after the legacy keys were
disabled, so that deploy carries the modern key path.

None of `auth.ts`, `cors.ts`, `http.ts`, `logging.ts` or `models.ts` — the rest of
what those two import — has changed since.

**Decision: deploy all five functions, not three.** The three-minute gap makes
the deployed bundle's provenance inferential rather than certain, and a redeploy
is cheap, idempotent and removes the ambiguity. `health` and `admin-models` keep
`verify_jwt = true`; `config.toml` already declares `verify_jwt = false` for
`research-chat`, `ingest-documents` and `refresh-model-pricing`.

**2. `AI_REPAIR_MODEL` is confirmed served.** `google/gemini-3.5-flash-lite` is
present in `model_pricing`, `is_available = true`, refreshed 2026-09-21T12:00Z,
1,048,576-token context, supports `tools` and `structured_outputs`. No
substitution needed.

**3. `ingest-documents` is genuinely stale and must be redeployed.** Deployed
2026-09-21T06:29:24Z; seven later commits touch it or its `_shared` dependencies,
including 1b71635 (C3 provenance preservation).

### New findings the runbook did not carry

**Planner statistics are wrong by three orders of magnitude, not merely absent.**

| Relation | `n_live_tup` | Actual rows | `last_analyze` |
| --- | ---: | ---: | --- |
| `document_chunks` | **31** | 51,057 | never |
| `desk_rows` | **0** | 34,184 | never |
| `documents` | 2,337 | 2,337 | autoanalyzed 10:31 UTC |

The 10:24 restart reset the counters and autovacuum has not caught up. `ANALYZE`
is therefore a prerequisite of the **paid verification**, not only of C4 — every
retrieval in those scenarios would otherwise be planned against a table the
planner believes holds 31 rows.

**The first ingest pass failed in five distinct ways, not one.** From
`function_logs`:

| Reason | n |
| --- | ---: |
| `documents read: <!DOCTYPE html>…` (PostgREST gateway page — database down) | 143 |
| `chunk_commit: canceling statement due to statement timeout` | **20** |
| `documents read: Could not query the database for the schema cache` | 12 |
| `chunk_commit: <!DOCTYPE html>…` | 11 |
| `embeddings served by text-embedding-3-small, expected openai/…` | 10 |
| `documents upsert: undefined` | 5 |
| `model_call_logs insert:` (gateway / schema cache) | 3 |

Statement timeout is a real and distinct C4 risk. `service_role` carries
`statement_timeout = 300s` (migration 0010); `anon` 3s, `authenticated` 8s.

**Evidence the Finance Bill will succeed.** The largest successfully indexed
document is *The Finance Bill, 2011* — 959,238 characters, **741 chunks**. C4's
`2006-16-gaz.pdf` is 969,286 characters, 1.05% larger. The owner's judgement that
a single-file retry should work is supported by the closest available comparable.

**Chunk `metadata` and `page_number` are empty by construction — confirmed
again, with the mechanism.** `document_chunks.source_kind` holds exactly one
distinct value across all 51,057 rows: `document`. `_shared/chunking.ts` only
carries `pageNumber` on `pdf_page` units, and `toCommitRow` hardcodes
`metadata: {}`. Document-level provenance is fully populated: **0** of 2,337
documents have empty metadata; all 2,337 carry `title`, `n_chars` and
`text_sha256`. No backfill is warranted for either column.

Separately, `document_key` is present on 1,619 of 2,337 and `file_url` on 1,621 —
the ~718-document provenance gap already excluded from E2 as its own authorized
task.

### Blockers found, and who must clear them

1. **`.env.local` carries only `VITE_AI_BACKEND`, `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.** `scripts/ingest-national-desk.mjs` requires
   `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (an `sb_secret_…` key; it rejects any
   other prefix at line 317) and throws without them. **C4 cannot run until the
   owner supplies them.** E2's migrations and function deploys do not depend on
   this file.
2. **No internal-admin account and only one spare ordinary account.** Unchanged,
   owner-only, and the admin must be created through the trusted path 0012
   establishes.
3. `VITE_AI_BACKEND` is already `supabase`, so the browser will take the Supabase
   path as soon as the functions exist.

### Execution route

Migrations and function deploys will go through the Supabase MCP tools
(`apply_migration`, `deploy_edge_function`) rather than the CLI. The CLI is
installed at `/opt/homebrew/bin/supabase` and the project is linked
(`supabase/.temp/project-ref` = vfgcppstyzjarlzyqdac), but it cannot write its
telemetry file under this session's sandbox.

### E2 phase 1 attempted and blocked — 2026-09-21

Owner authorized execution. Migration `0012_profile_authority` was staged and
submitted through the Supabase MCP `apply_migration` tool and was **refused by
this session's permission classifier**. No SQL reached the database.

Verified read-only immediately afterwards — the database is untouched:

| Check | Reading |
| --- | --- |
| `max(version)` in `supabase_migrations.schema_migrations` | `20260921000011`, 11 rows |
| `public.guard_profile_authority()` | does not exist |
| trigger `user_profiles_authority_guard` | does not exist |
| policy `Users can insert own profile` | still present |
| `anon` UPDATE on `user_profiles` | still granted |

**Function deployment was deliberately not attempted afterwards.** `research-chat`
reads and writes `research_turns`, `lookup_research_turn`, `claim_research_turn`
and `finalize_research_turn`, all of which are created by migration 5. Deploying
the functions while the schema is still at 0011 would put a function live that
fails on every call — strictly worse than the present state, where it simply does
not exist. Phase 2 stays blocked behind phase 1 by dependency, not only by
sequence.

**Pre-flight completed before the refusal, and it cleared the one real risk in
0012.** The migration ends with six `ALTER FUNCTION … SET search_path = ''`
statements, including on `handle_new_user()`, the Auth signup trigger. Breaking
it would break every new signup. Both conditions were checked against the live
catalogue:

- all six function bodies fully qualify their references (`public.user_profiles`,
  `public.organisation_members`, `auth.uid()`), so an empty `search_path`
  resolves nothing differently; every remaining identifier is `pg_catalog`;
- `handle_new_user()` is `SECURITY DEFINER` **owned by `postgres`**, so
  `current_user` inside it is `postgres`, which the new guard's allowlist admits.
  Signup continues to work.

Trigger firing order on `user_profiles` is alphabetical among BEFORE triggers:
`update_user_profiles_updated_at`, then `user_profiles_authority_guard`, then
`user_profiles_email_normalised`. The guard excludes `updated_at` from its
comparison, so the maintenance trigger writing it first is harmless.

**Preferred unblock: `supabase db push`.** It applies all five pending migrations
in filename order and records their **exact repository versions**
(`20260921000012` … `20260921115831`). The MCP `apply_migration` tool assigns its
own generated version instead, which would leave the live migration history
permanently out of step with the repository and make a later `db push` attempt to
re-apply files already applied. The CLI is installed at
`/opt/homebrew/bin/supabase` and the project is linked.

### Migration 0012 defect found by the real push — fixed in fa88b31

The owner ran `supabase db push`. It offered exactly the five expected
migrations, in the expected order, and aborted on the first:

```
Applying migration 20260921000012_profile_authority.sql...
ERROR: column "phone_e164" of relation "user_profiles" does not exist (SQLSTATE 42703)
At statement: 7
```

**Nothing was applied.** The CLI runs each migration in a transaction and the
whole file rolled back. Verified read-only: `schema_migrations` still holds 11
rows ending at `20260921000011`; `guard_profile_authority` absent; trigger
absent; `Users can insert own profile` and `Authenticated users can create
organisation` still present; `anon` still holds SELECT/INSERT/UPDATE/DELETE/
TRUNCATE on `user_profiles`.

**Root cause: the migration was written against a schema file that does not
describe the live database.** `public.user_profiles` is created by
`backend/sql/auth_schema.sql`, which is created by **no tracked migration** —
the same class of untracked drift as `debug_timeout`. That file declares
`phone_e164 text` (line 171) and `job_title text` (line 177). Live has
`phone_number` and **no `job_title` at all**.

**The GRANT failing was the lucky outcome.** Statement 7 is a `GRANT UPDATE
(…)`, which validates column names at execution. Had it named only real
columns, two silent defects would have reached production:

1. `IF NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164` — plpgsql resolves record
   fields at **runtime**, so `CREATE FUNCTION` succeeds and the trigger then
   raises on **every INSERT or UPDATE** of `user_profiles`. Profile editing and
   onboarding would both have broken.
2. `personal_columns` would not have contained `phone_number`, so
   `to_jsonb(NEW) - personal_columns` retains it and a user changing their own
   phone number is rejected as an authority-field change.

**Resolution: the live schema is authoritative.** `backend/` is self-contained
and referenced by neither `package.json`, `vercel.json` nor `vite.config.js`, and
nothing under `src/`, `server/` or `api/` reads either column. So 0012 now names
`phone_number`, and `job_title` is dropped rather than added — adding a column is
a schema change, not a privilege migration, and belongs to its own task if the
product wants the field.

The same two names were corrected in `supabase/tests/profile_authority.sql` and
`supabase/tests/least_privilege.sql`.

**Why the gates did not catch this.** Those `.sql` fixtures are wired to no
runner — nothing in `package.json` or `config.toml` executes them. The 546 Vitest
and 318 Deno tests never touch the live schema, so they were green before the
fix and green after it. **The push was the first execution that could have found
this, and it did.**

**Supervisor error acknowledged.** The pre-flight above verified function bodies,
ownership and trigger ordering for 0012 but never compared its column list
against `information_schema.columns`. That check has now been run and passes:
every column 0012 names exists on `public.user_profiles`, and `id`, `email`,
`created_at` and `email_normalised` remain outside `personal_columns` so the
guard continues to protect them.

**The other four migrations were checked for the same class of defect.** 0013 and
0014 reference none of the drifted tables. 0015 touches six of them but names no
columns — it builds every column list dynamically from `pg_attribute` via
`format('public.%I', table_name)::regclass`, and excludes the six B1/B2 tables
from the `authenticated` revoke so 0012's column grants survive. The turn
persistence migration reads `user_profiles` only as `p.user_id` and `p.status`,
both of which exist. **Only 0012 was affected.**

Gates after the fix: **546 Vitest**, **318 Deno**.

## E2 phases 1 and 2 EXECUTED — 2026-09-21 17:55-18:00 UTC

Owner re-ran `supabase db push` after fa88b31. All five migrations applied in
order, no errors.

### Phase 1 verified

| Migration | Verification | Result |
| --- | --- | --- |
| history | `schema_migrations` rows / max | **16** / `20260921115831`, exact repository versions preserved |
| 0012 | `guard_profile_authority()` and `user_profiles_authority_guard` | both present |
| 0012 | `Users can insert own profile`, `Authenticated users can create organisation` | both dropped |
| 0012 | `create_organisation` body | stub, raises `42501` |
| 0012 | `authenticated` column UPDATE grants on `user_profiles` | exactly the 10 personal columns, including `phone_number` |
| 0012 | `handle_new_user()` | still `SECURITY DEFINER`, postgres-owned, `search_path` set — signup intact |
| 0014 | `match_documents` source | now contains `indexed_at` — the readiness guard is live, unblocking C4 |
| 115831 | `research_turns` + `lookup/claim/finalize_research_turn` | table and all three RPCs present |
| 0015 | `anon` table privileges across `public` | **none — the empty set** |
| 0012+0015 | `anon`-executable RPCs | **12 → 5** |

The five RPCs `anon` can still execute are `ai_models_guard`, `ai_roles_guard`,
`normalise_email`, `set_email_normalised` and `update_updated_at_column` — four
trigger functions and one pure text function, none of which read or write user
data. `update_updated_at_column` still carries a null `search_path`; that is
cosmetic here because it only assigns `new.updated_at`, but it is the last
unhardened function and belongs in a later cleanup with `debug_timeout`.

`create_organisation`, `get_my_profile`, `is_platform_admin`, `is_org_member`,
`is_org_owner`, `update_my_onboarding_profile` and `handle_new_user` are all now
closed to `anon`.

### ANALYZE

Run immediately after phase 1, before anything reads at scale:

| Relation | Estimate before | Estimate after |
| --- | ---: | ---: |
| `document_chunks` | 31 | **51,057** |
| `desk_rows` | 0 | **34,184** |
| `documents` | 2,337 | 2,337 |

### Phase 2 — all five functions deployed

Deployed with the Supabase CLI rather than the MCP tool, so `_shared` was bundled
by the toolchain that owns that resolution.

| Function | Version | `verify_jwt` | Bundle hash |
| --- | ---: | --- | --- |
| `research-chat` | **1 — first ever deploy** | false | new |
| `ingest-documents` | 4 | false | **changed** (ab1991ff → 85b22783) |
| `refresh-model-pricing` | 5 | false | **changed** (56380c17 → fb48ae2e) |
| `admin-models` | 5 | true | `3283d180…` **unchanged** |
| `health` | 5 | true | `a345d2b5…` **unchanged** |

**The earlier doubt is resolved by evidence, not inference.** `health` and
`admin-models` rebuilt to byte-identical bundles, which proves their 2026-09-20
20:52:44Z deploy already contained 7ff8e04's modern-key code despite predating
the commit by three minutes — they were deployed from the working tree. The
decision to deploy all five was still correct: it converted an inference into a
fact and caught two functions that genuinely were stale.

### Smoke test — non-vacuous

`research-chat` called with no credentials:

```
POST /functions/v1/research-chat  →  HTTP 401  {"error":"missing bearer token"}
OPTIONS (Origin: http://localhost:5173)  →  HTTP 204
```

A structured JSON rejection rather than a Deno stack trace proves the module
graph resolved, the function booted and the handler's own auth check ran — which
is the thing `verify_jwt = false` makes the handler responsible for. CORS
preflight is configured. No errors in `function_logs` for the window.

### What E2 still owes

Phase 3, the bounded paid verification, is **not** done and remains owner-gated:

1. no internal-admin account — must be provisioned through the trusted path 0012
   establishes, never by editing a role;
2. only one spare ordinary account, so cross-account denial cannot be tested;
3. the five scenarios themselves, one execution each, no automatic retry.

C4 is now unblocked on the database side — `match_documents` carries the
`indexed_at` guard and the reviewed `ingest-documents` mapper is deployed — but
still blocked on credentials: `.env.local` holds only the three `VITE_`
variables, and `scripts/ingest-national-desk.mjs` requires `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` (`sb_secret_…`).

## Track 2 — database authorization suite EXECUTED — 2026-09-21

The authorization half of E2 phase 3, run where `AGENTS.md` requires it: a
disposable local database, never the live project. No accounts, no browser, no
spend. Runner committed as `npm run test:sql` (0ed4782).

| Fixture | Container | Result | Vacuity |
| --- | --- | --- | --- |
| `profile_authority` | postgres:17-alpine | **PASS** | fails without 0012 |
| `conversation_ownership` | postgres:17-alpine | **PASS** | fails without 0013 |
| `corpus_revision_integrity` | pgvector:pg17 | **PASS** | fails without 0014 |
| `least_privilege` | pgvector:pg17 | **PASS** | fails without 0015 |
| `research_turn_persistence` | pgvector:pg17 | **PASS** | fails without 115831 |

**Vacuity is checked, not assumed.** Each chain is rebuilt without the migration
that fixture exists to prove, and the fixture must then fail. A green fixture
that still passes without its migration is reported as VACUITY FAIL.

**That check paid for itself on the first run.** `profile_authority` passed
*without* migration 0012. Cause: `backend/sql/auth_schema.sql` section 23 is a
deliberate copy of 0012 — "Kept equivalent to migration
20260921000012_profile_authority.sql" — so the bootstrap had already installed
`guard_profile_authority` and its trigger before 0012 ran, and 0012 was a no-op
in that chain. The fixture was restating a state the bootstrap produced. The
vacuity baseline now cuts `auth_schema.sql` at that section header, so the run
demonstrates the fixture actually detects the guard's absence.

**Why these fixtures had rotted.** They are wired to no runner — nothing in
`package.json` or `config.toml` executed them. That is the same reason 546 Vitest
and 318 Deno stayed green while migration 0012 could not apply: no gate in this
repository had ever executed a line of the SQL. `npm run test:sql` closes that
gap and is now documented in `AGENTS.md`.

**`backend/sql/auth_schema.sql` reconciled to live.** `phone_e164` →
`phone_number` and `job_title` dropped, in both the table definition and the
section 23 copy. Drift confirmed to be exactly those two columns:
`email_normalised` is absent from the file correctly, because migration 0001 adds
it. The file now describes the database that exists.

### What this covers, and what it does not

Covered, at the database authority layer: the profile authority guard and its
trusted-role allowlist; conversation and message ownership including a probe that
drops the foreign key to prove RLS independently hides mismatched children;
client inability to write assistant rows; corpus revision integrity and the
`indexed_at` readiness gate; the least-privilege ACL matrix with negative
controls for broad defaults and historical column grants; and research turn claim
immutability.

Not covered, and still requiring E2 phase 3 proper: anything above the database —
HTTP identity and ownership validation in the deployed functions, the browser
transport, streaming, Stop, reload reconciliation, citation opening, and real
provider calls. `conversation_ownership.sql` says so in its own header: it "tests
database authority, not D3/D6 HTTP identity/ownership validation."

## C4 executed — one document indexed, one stopped on a Postgres restart — 2026-09-21

Run after E2 phases 1 and 2, with `SUPABASE_SECRET_KEY` supplied by the owner in
`.env.local` and `SUPABASE_URL` passed on the command line (it is the public
project URL, and the script has no fallback to `VITE_SUPABASE_URL`).

### Document 1 — `2006-93-Synop.pdf` — INDEXED

```
indexed  1f7ffc739c73  chunks=7 +7 =0 -0  tokens=1564  usd=0.000031
```

Verified against the manifest's checks, all passing:

| Check | Result |
| --- | --- |
| `indexed_at` set, `chunker_version` populated | 2026-09-21 18:24:41Z, version 1 |
| chunk count plausible (predicted 6-10) | **7** |
| every chunk has an embedding | 0 null |
| no blank content | 0 blank |
| spans ordered and non-overlapping | true, 0 → 5,306 = exactly `n_chars` |
| **chunk slices equal `documents.ocr_text`** | **true for every chunk** |
| no other document touched | corpus 2,337 / 2,336 indexed |
| spend | one embedding call, $0.000031 |

### Document 2 — `2006-16-gaz.pdf`, The Finance Bill 2006 — STOPPED

Cloudflare **520** after 97 seconds, then `execute_sql` returned a connection
timeout. `pg_postmaster_start_time()` moved from **10:24:55Z to 18:26:57Z**.

**That is the manifest's hard stop condition, so C4 was stopped rather than
retried.** This is the fourth restart of the day and the first one causally tied
to a single identified document.

**Nothing was damaged.** State immediately after:

| | |
| --- | --- |
| Finance Bill | `indexed_at` null, `chunker_version` null, **0 chunks** |
| its `ocr_text` | intact, 969,286 characters; `content_sha256` present |
| synopsis from document 1 | still indexed, still 7 chunks |
| orphan chunks | 0 |
| corpus totals | 2,337 documents, 2,336 indexed, 1 unindexed |
| `document_chunks` | 51,064 = 51,057 + the 7 new ones; the Finance Bill wrote nothing |

### The failure is now diagnosed, not speculative

`model_call_logs` records the run's embedding call as **successful**: 326,525
tokens, $0.006531. So roughly 750 chunks were embedded without difficulty. The
crash is not in chunking, not in the provider, and not in the 2,000,000-character
ceiling. **It is `chunk_commit` writing all of those chunks in one call.**

Capacity at the moment of failure:

| | |
| --- | --- |
| `shared_buffers` | 286,728 kB |
| `work_mem` | 2,184 kB |
| `maintenance_work_mem` | 32,768 kB |
| `document_chunks` | 853 MB |
| `document_chunks_embedding_hnsw` | **380 MB** |
| database | 996 MB |
| single-commit vector payload | 750 × 1536 × 4 B ≈ **4.4 MB**, plus 750 HNSW insertions in one transaction |

The comparable that succeeded — *The Finance Bill, 2011*, 959,238 characters,
**741 chunks** — remains the largest single commit this database has ever
accepted, and it was accepted at 09:36 UTC when the HNSW index was smaller. At
969,286 characters this document is only 1.05% larger in text, so the text size
is not the discriminator; the index it has to insert into is.

### Recommendation: do not retry as-is

A retry re-embeds (another $0.0065, since the handler embeds before committing)
and attempts the same single oversized commit against a database whose index has
not shrunk. The earlier prediction that a single-file retry would succeed was
based on the 2011 comparable and was reasonable, but the evidence now says the
binding constraint is the commit, not the file.

The fix is **sliced commits** — the same large-document path already identified
as separate work for the 5,387,224-character `2003-6-gaz.pdf`. It turns out to be
needed at 969k on this instance, not only at 5.4M. Options, in order of
preference:

1. **Slice `chunk_commit`** so a document's chunks are committed in bounded
   batches inside the handler, each its own transaction. Bounded work, no plan
   change, no instance change. This is real work in `ingest-documents` and its
   RPC, and it needs its own task and review.
2. Raise the instance tier for the duration of one commit. Costs money and proves
   nothing about the code path.
3. Leave the document unindexed. It is one document of 2,337 — 99.96% coverage —
   and the corpus is fully usable without it.

**The corpus is at 2,336 of 2,337.** The remaining document is stored, hashed,
mapped, and safe to retry whenever the sliced-commit path exists. A later attempt
costs nothing beyond the embedding, and the failure leaves no residue.

## First successful production research turn — 2026-09-21 18:40Z

After four failed attempts the streaming research agent completed a turn in
production: conversation `a80e9696`, `status = complete`, 2,342 characters,
$0.004547, 18,256 tokens over two `chat_answer` calls. Turn claim, persistence,
streaming, follow-ups and cost accounting all behaved.

The failure that blocked the first four was **not** in the migrations, the
grants, the model chain or the provider. It was a deployment packaging defect:
`index.ts` resolved persona prompts with `Deno.readTextFile` on a computed path,
which is outside the static import graph that `supabase functions deploy`
uploads, so the five markdown files were never shipped. Every turn died with
`path not found: .../_shared/personas/analyst.md` about 49 ms into a 120-second
budget — before a model was selected, which is why `model_call_logs` held no chat
rows. Fixed in c594398 by bundling them as JSON the way `deskCatalog.json`
already ships.

**Four error-swallowing sites stood between that failure and its cause**, and
each had to be removed before the next was visible:

| Site | What it destroyed | Fix |
| --- | --- | --- |
| `handler.ts` attempt loop | non-retryable provider errors | b61842c |
| `persistence.ts:189` | bare `catch {}` — the whole error object | 534ca02 |
| `index.ts:67` | bare `catch {}` — replaced everything with a generic 503 | c0e7d46 |
| `index.ts:186` | `result.error` from PostgREST, never read at all | c0e7d46 |

This is the finding worth carrying forward. Local tests could not have caught the
packaging defect — every test had the files on disk — so **only a deployed
execution could find it**, and the swallowed errors made that execution mute.
546 Vitest and 318 Deno passed throughout. An error path that discards its cause
converts a one-line fix into an afternoon.

Note also that the 18:26:57 restart had wiped the planner statistics again:
`document_chunks` and `desk_rows` were back to 0 estimated rows. They were
re-analyzed at 18:40 before the successful turn. **`ANALYZE` should become part
of restart recovery** rather than something remembered — this instance restarted
four times on 2026-09-21 and each restart resets the counters.

Four defects found in the trail behind the successful turn are scoped in
`docs/plans/2026-09-22-research-turn-findings.md`. The headline one: 14,550 of
34,184 desk rows carry their own `row_key` inside `record_text` as an `id:` line,
so the model cites that instead of an issued `ref:` handle and no citation ever
resolves. None of the four is executed.

## E2 phase 3 — internal admin provisioned through the trusted path — 2026-09-22

Owner chose `niyantranai@gmail.com`, the project's main address. Promoted through
the path migration 0012 establishes, never by editing a role as a shortcut:

```sql
update public.user_profiles set role = 'admin'
 where email = 'niyantranai@gmail.com' and role = 'user';
```

One row affected. The MCP SQL connection runs as `postgres`, which is one of the
two roles `guard_profile_authority()` admits, so the guard permitted the write
rather than being bypassed — the trigger and function are both still present and
enabled afterwards.

`is_platform_admin()` tests `role = 'admin' AND status = 'active'` specifically,
not `owner`, so `'admin'` is the value that actually grants anything.

### The untrusted half, proved without impersonation

The guard is the second line of defence. The first is the privilege layer, and it
is closed in production:

| Column | `authenticated` may UPDATE |
| --- | --- |
| `role` | **no** |
| `plan` | **no** |
| `status` | **no** |
| the 10 personal columns | yes |

An ordinary signed-in user cannot even attempt a privilege change: the UPDATE is
refused at the column grant, before the trigger is reached. `anon` holds no table
privileges at all.

The guard's own behaviour — that it raises `42501` for any caller outside
`postgres`/`service_role` — is proved separately and non-vacuously by
`supabase/tests/profile_authority.sql` under `npm run test:sql`, which fails when
migration 0012 is removed from its bootstrap. Attempting the same proof against
production would mean simulating a privileged role on the live database, which is
neither necessary nor appropriate when a disposable database proves it exactly.

### State

| | |
| --- | --- |
| `niyantranai@gmail.com` | **admin**, active |
| `nter-auth-test+1789985534982@gmail.com` | user, active |
| `shukla.vighnesh@gmail.com` | user, active |
| active admins | **1** |

Two ordinary accounts remain, which is what cross-account denial needs. The
promotion is reversible with the same statement and `role = 'user'`.

### What phase 3 still owes

The five bounded paid scenarios — greeting, desk row count, document citation
opened in the reader, Stop mid-turn, and close-tab-then-reload replay — plus the
cross-account denial check. Each needs a signed-in browser, so they need the owner
present. R2 changed the expected greeting result: it should now return a short
answer with no follow-up chips and no attachment context.
