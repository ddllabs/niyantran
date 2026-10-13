# Implementation plan: web search in AI Research (F124)

> **Status: Living.** Implements the [web search spec](../specs/2026-10-13-web-search.md)
> (approved by the owner on 2026-10-13). Branch `task/web-search` from `main` at
> `879b917`, worktree `.claude/worktrees/web-search`. Tracked as F124 in
> [open-work](open-work.md).

## Who does what

The **supervisor** (the coordinating agent, Opus 5.5) has four jobs:

- fixes the contract;
- writes the migration;
- does the integration wiring;
- reviews, verifies, commits and merges every task.

Task agents follow `docs/agents/onboarding.md`. Each works in its own worktree
branched from `task/web-search` and leaves an uncommitted diff.

| Task | Owner | Model | Why that model |
|---|---|---|---|
| T0 contract and pure helpers | supervisor | Opus 5.5 | fixes every interface the others build on |
| T0f probe fixtures | sub-agent | Haiku 5.5 | mechanical: trims saved probe responses into test fixtures |
| T1 migration and SQL fixture | supervisor | Opus 5.5 | schema, RLS and the non-superuser test are sensitive |
| T2 stream and agent loop | sub-agent | Fable 5.1 | the riskiest code: streaming, failover, budget, the `acceptedDraft` shortcut |
| T3 policy, prompt, telemetry | sub-agent | Sonnet 5.5 | pure functions with a precise spec |
| T4a composer, thread state, ticker | sub-agent | Sonnet 5.5 | UI against a fixed frame contract |
| T4b source row, panel, links | sub-agent | Sonnet 5.5 | UI against a fixed message shape |
| T5 handler wiring | supervisor | Opus 5.5 | joins T2 and T3 across the handler, index and validator |
| T6 independent review | sub-agent | Opus 5.5 (`code-reviewer`) | fresh context, did not write the code |
| T6s security pass | sub-agent | Sonnet 5.5 (`security-auditor`) | untrusted web text, link check, privacy |
| T7 local run and docs | supervisor | Opus 5.5 | browser verification and evidence |

**Concurrency.**

- Phase 1 runs T0 with T0f beside it.
- Phase 2 runs at most four agents at once (T2, T3, T4a, T4b) on disjoint files.
- Phase 3 is sequential.
- Phase 4 runs T6 and T6s side by side.

In total there are seven sub-agent runs plus the supervisor.

**Supervisor-owned files (no task agent edits them):**

- `_shared/webSearch.ts`, `_shared/chatStream.ts`;
- `research-chat/handler.ts`, `index.ts`, `validate.ts`;
- the migration;
- `docs/`.

## Phase 1: contract (sequential)

### T0: Contract and pure helpers (supervisor)

- **Interfaces fixed here:**
  - `_shared/webSearch.ts`:
    - limits: `WEB_SEARCHES_PER_TURN = 3`, `WEB_RESULTS_PER_SEARCH = 5`,
      `WEB_RESULTS_PER_CALL = 15`, `WEB_PAGES_PER_TURN = 15`,
      `EXA_SEARCH_COST_USD = 0.007`;
    - types: `WebPage {url, title, excerpt}` and
      `WebSource {url, title, domain, cited}`;
    - helpers: `webSearchTool(remaining)`, `parseWebAnnotations(annotations)`,
      `normaliseUrl(url)`, `mergePages(seen, pages)`, `webSearchCount(usage)`,
      `webSearchCostUsd(usage, count)`, `webEvidenceBlock(pages)`.
  - `_shared/chatStream.ts` frames:
    - `web {offered, mode, reason}`;
    - `webSources WebSource[]`;
    - `tool` name `'web_search'`.
  - Agent contract, as type signatures only (T2 implements them):
    - `ModelEvent` gains `{type:'web-results', pages: WebPage[]}`;
    - `StreamRequest.serverTools?: unknown[]`;
    - `AgentInput.webSearch?: {perTurn: number}`, where absent means not
      offered;
    - `AgentEvent` gains
      `{ web: {pages: WebPage[], searches: number, costUsd: number|null, latencyMs: number} }`;
    - `AgentResult` gains `webPages` and `webSearches`.
  - Request `web_search?: boolean`. Client message shape:
    `message.webSources: WebSource[]`.
- **Acceptance:**
  - the helpers are tested against fixtures from probe 1 (counts 1, 2 and 3
    give $0.007, $0.014 and $0.021; title falls back to the URL; non-http
    URLs are dropped; de-duplication; the 15-page cap);
  - the type changes compile in Deno.
- **Verify:** `deno test -A --config supabase/functions/deno.json supabase/functions/_shared/webSearch_test.ts`
  (fails first); `deno check` on research-chat.
- **Files:** `_shared/webSearch.ts` and its test, `_shared/chatStream.ts`, type-only
  edits in `_shared/openrouterStream.ts` and `research-chat/agent.ts`. Size M.

### T0f: Probe fixtures (Haiku sub-agent, alongside T0)

- **Acceptance:** `_shared/__fixtures__/web-search/`:
  - one trimmed SSE transcript per probe-1 model, with annotations shortened to
    300 characters and usage kept;
  - one answer-phase response from probe 2.

  The fixtures contain no key and no auth header.
- **Verify:** `grep` finds no `Bearer`, `sk-or` or `Authorization`; the JSON parses.
- **Files:** that folder only. Size S.

### T1: Migration and SQL fixture (supervisor)

- **Acceptance:**
  - the migration adds:
    - `conversations.web_search boolean`;
    - `chat_messages.web_sources jsonb not null default '[]'`;
    - `model_call_logs.web_search_count` and `web_search_cost_usd`;
    - the `web_search` step type;
  - its down steps are in the header;
  - the fixture proves that the owner reads the new columns and another user
    cannot, that an `authenticated` role cannot write
    `conversations.web_search`, and that an unknown step type is rejected;
  - it runs as a non-superuser, and the vacuity check fails without the
    migration.
- **Verify:** `npm run test:sql` (needs Docker, run outside the sandbox).
- **Files:** `supabase/migrations/2026101314xxxx_web_search.sql`,
  `supabase/tests/web_search.sql`. Size S. Depends on: none.

### Checkpoint 1

- Deno and Vitest suites pass, lint passes, and the SQL fixtures pass.
- The contract is committed on `task/web-search`.
- Then the Phase 2 worktrees are cut from that commit.

## Phase 2: parallel (four agents, disjoint files)

### T2: Stream and agent loop (Fable)

- **Acceptance:**
  - `buildRequestBody` puts `serverTools` beside `tools` on research calls and
    never on a `tool_choice: 'none'` call, Anthropic included;
  - the stream parser emits `web-results` from `delta.annotations` and from
    `message.annotations`, and keeps `server_tool_use_details` and
    `cost_details` in the usage it reports;
  - `runAgent`:
    - offers the tool with `max_uses = perTurn − used` and withdraws it at 0;
    - counts searches per call (§2 of the spec);
    - carries the pages into the next call as `webEvidenceBlock`;
    - never promotes a draft from a call that searched;
    - drops a discarded failover attempt's pages;
    - emits `web` events;
    - returns `webPages` and `webSearches`;
  - with `webSearch` absent, every existing test passes unchanged.
- **Verify:** `deno test … research-chat/agent_test.ts _shared/openrouterStream_test.ts`;
  each new behaviour has a test that fails first.
- **Files:** `_shared/openrouterStream.ts`, `_shared/openrouterStream_test.ts`,
  `research-chat/agent.ts`, `research-chat/agent_test.ts`. Size M/L.
  Depends on: T0, T0f.

### T3: Policy, prompt and telemetry (Sonnet)

- **Acceptance:**
  - new `research-chat/webPolicy.ts`:
    - `decideWebSearch({focus, override, conversational, model, scope})`
      returns `{offered, mode, reason}`, covering every row of the spec's §1
      table;
    - `checkLinks(answer, allowedUrls)` keeps the link text and drops the
      URL;
    - `webSourcesOf(pages, answer)` puts cited pages first and caps the list
      at 20;
  - the `WEB_SEARCH` prompt block is added only when web search is offered,
    and asserts the records-win rule, inline links and the date-and-year
    guidance;
  - `telemetry.ts` writes `web_search_count`, `web_search_cost_usd` and the
    `web_search` trace rows, and `summary()` gains `web_searches` and
    `web_search_cost_usd`.
- **Verify:** `deno test … research-chat/{webPolicy,prompt,telemetry}_test.ts`.
- **Files:** `research-chat/webPolicy.ts` and its test, `prompt.ts`, `prompt_test.ts`,
  `telemetry.ts`, `telemetry_test.ts`. Size M. Depends on: T0.

### T4a: Composer globe, thread state, ticker (Sonnet)

- **Acceptance:**
  - `WebSearchToggle` shows the predicted state, its reason and the gated
    state, with `aria-pressed`, and is disabled while streaming;
  - `corpusCoverage.js` gains a cached `documentModules()` and a
    `webDefaultFor(focus, attachments, deskContext)` prediction, where a
    keyless row means no document;
  - `researchChat.js` reads the `web` and `webSources` frames, and the turn
    request carries `web_search` when it is overridden;
  - `useResearchThread` keeps the override per conversation and the server's
    last `web` decision, and `aiConversations.js` reads `conversations.web_search`;
  - `ActivityTicker` labels the `web_search` step.
- **Verify:** `npx vitest run src/ai/WebSearchToggle.test.jsx src/lib/corpusCoverage.test.js src/lib/researchChat.test.js src/ai/useResearchThread.test.js src/ai/ActivityTicker.test.jsx`;
  lint.
- **Files:** `src/ai/WebSearchToggle.jsx` and its test, `src/ai/AiPanel.jsx`
  (composer slot only), `src/ai/ActivityTicker.jsx`,
  `src/ai/useResearchThread.js`, `src/lib/researchChat.js`,
  `src/lib/aiConversations.js`, `src/lib/corpusCoverage.js`, and their tests.
  Size L, made up of small slices. Depends on: T0.

### T4b: "From the web" row, sources panel, link marks (Sonnet)

- **Acceptance:**
  - `WebSourceRow` under the answer shows "From the web · unofficial", up to
    three domains and "N sources", and only when there are sources;
  - clicking it opens a `web` viewer in `WorkSurface` (`WebSourcesList`):
    title, domain, "cited in the answer", and an external link with
    `rel="noopener noreferrer"`;
  - `AiMarkdown` marks links whose URL is in the message's `webSources`;
  - saved messages render the same.
- **Verify:** `npx vitest run src/ai/WebSourceRow.test.jsx src/ai/WebSourcesList.test.jsx src/ai/WorkSurface.test.jsx src/ai/AiMarkdown.test.jsx src/ai/MessageRow.test.jsx`;
  lint.
- **Files:** those components and their tests, `src/ai/MessageRow.jsx`,
  `src/ai/WorkSurface.jsx`, `src/ai/AiMarkdown.jsx`, and the web rules in
  `src/index.css`. Size M. Depends on: T0.

### Checkpoint 2

- The supervisor reviews and merges each diff into `task/web-search`.
- Then both suites, lint and the build are run.

## Phase 3: integration (sequential)

### T5: Handler wiring (supervisor)

- **Acceptance:**
  - `validate.ts` accepts a boolean `web_search`;
  - the handler:
    - resolves the per-key coverage of the turn (`index.ts` returns which keys
      have no indexed document) and reuses `document_modules()`;
    - stores the override with the service role;
    - calls `decideWebSearch`, re-gates the model on failover, and passes
      `webSearch` to `runAgent`;
    - sends the `web`, `tool` and `webSources` frames;
    - runs `checkLinks` before streaming the final answer and before saving;
    - saves `web_sources`, telemetry and the usage summary;
  - `handler_test.ts` covers:
    - an automatic turn with a row-only record (searches, sources saved);
    - an indexed bill (no tool on any call);
    - both overrides;
    - the model gate;
    - a failover that discards pages;
    - a link to a page that was not searched being removed.
- **Verify:** both suites, lint, the build, and
  `node -e "import('./api/router.js')…"` if anything under `api/` changed (not
  expected).
- **Files:** `research-chat/handler.ts`, `index.ts`, `validate.ts`, and their tests. Size L.
  Depends on: T1, T2, T3.

## Phase 4: review and verification

### T6 and T6s: independent review and security pass (side by side)

- `code-reviewer` (Opus) reads the whole branch diff against the spec.
- `security-auditor` (Sonnet) covers:
  - web text as untrusted input;
  - the link check, including `javascript:`, `data:` and lookalike URLs;
  - the absence of any third-party request from the browser;
  - what leaves the system: search queries.
- Findings come back as reports. The supervisor fixes and re-verifies, or
  records an item as accepted.

### T7: Local run and documentation (supervisor)

- Recreate the local-stack helper scripts in the session scratchpad.
- Apply the migration locally and serve `research-chat` locally with the real
  OpenRouter key.
- Run the dev server on its own port and drive the three spec cases in the
  browser on Gemini and DeepSeek. The spend cap is $1.00 in total, with $0.21
  already used.
- Record screenshots, the `model_call_logs` and trace rows, and the cost in
  `docs/research/2026-10-13-web-search-local-run.md`.
- Update F124 in `open-work.md`.
- Merge `task/web-search` into `main` locally (fast-forward or merge commit).

### Checkpoint 3 (owner)

These are production actions. Each needs the owner's go-ahead by name:

1. push `main`;
2. apply the migration to NTER;
3. deploy `research-chat`.

Order: migration, then function, then push, so the browser never sends
`web_search` to a function that ignores it. Production changes are recorded
in `docs/agents/coordination.md`.

## Risks

- **Phase 2 drift.** Four agents build on T0's types. A needed change to the
  contract stops the affected agent and comes back to the supervisor, rather
  than being made in place.
- **Merge conflicts with the UI refactor.** The other agent's branch
  (`task/national-record-panels`) touches record panels, not `src/ai/` or
  `supabase/`. `docs/plans/open-work.md` is the shared file most likely to
  conflict, so its edits stay small.
- **Spend.** Only T7 calls OpenRouter. Unit tests use the fixtures.
