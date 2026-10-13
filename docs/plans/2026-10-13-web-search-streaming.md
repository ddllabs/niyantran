# Plan: web search streams once, with live sources and site icons (F131)

> **Status: Living.** Implements the
> [spec](../specs/2026-10-13-web-search-streaming.md), approved by the owner
> on 2026-10-13. Branch `task/web-search`, worktree
> `.claude/worktrees/web-search`.

## How the work is split

The supervisor fixes the interfaces below before any task starts. The three
tasks then run concurrently, because their write scopes do not overlap. Task
agents leave their work uncommitted. The supervisor reviews it, runs every
check and commits.

## Interfaces fixed before the tasks

1. **The `webProgress` frame**, sent by `research-chat` (`chatStream.ts`):
   `{ webProgress: { pages: [{ url, title, domain }] } }`.
   - Each frame carries only pages not yet sent in this turn.
   - URLs are https and normalised. Pages have no excerpt.
   - It is for display only and is never stored.
2. **The `web_search` tool frame and its saved activity step** gain
   `searches`, an integer: the count capped at the offered `max_uses`.
   - A `start` frame with the same `step` comes before the first page.
   - The `end` frame is unchanged apart from `searches`.
3. **`GET /api/site-icon?domain=<host>`** returns 200 with image bytes, 404
   for no icon, or 400 for a refused host.
   - The client builds the URL as
     `/api/site-icon?domain=${encodeURIComponent(domain.toLowerCase())}`.

## Tasks

### A. Server (`research-chat`), one sub-agent

**Write scope**
- `supabase/functions/_shared/openrouterStream.ts`, `webSearch.ts`,
  `chatStream.ts` and their tests;
- `supabase/functions/research-chat/agent.ts`, `handler.ts` and their tests;
- one new trimmed fixture in `_shared/__fixtures__/web-search/`.

**Steps, each test written to fail first**
1. A `web-progress` event per annotation burst. `web-results` stays as it
   is, at the end only.
2. The count is capped at `max_uses`, for the trace row, the log, the budget
   charge and the cost fallback.
3. A research call offered the web tool holds its draft:
   - no `draftText` and no `retract` is sent;
   - a promoted draft is sent once, then `promoted`.
4. The handler:
   - sends `webProgress` frames for pages from a call offered the tool;
   - sends a `web_search` `start` frame with the first page;
   - adds `searches` to the step.

**Verify**
```bash
deno test -A --config supabase/functions/deno.json supabase/functions
```
Prove each guard by mutation.

### B. Icon endpoint, the supervisor

**Write scope:** new `server/siteIconApi.mjs` and its test; `api/router.js`;
`vite.config.js`.

**Verify**
- `npm test -- server/siteIconApi`
- the router import check
- one real request to DuckDuckGo through the local handler

### C. Chat UI, one sub-agent

**Write scope**
- `src/lib/researchChat.js`, `src/ai/useResearchThread.js`,
  `src/ai/AiPanel.jsx` (live turn only), `src/ai/MessageRow.jsx`;
- new `src/ai/WebSourceStrip.jsx`;
- `src/ai/WebSourcesList.jsx`, `src/ai/AiMarkdown.jsx`, `src/ai/research.css`
  or `src/index.css`;
- removal of `src/ai/WebSourceRow.jsx` and its tests;
- tests for each of these.

**Steps**
1. `researchChat.js` merges `webProgress` frames into `webLive`.
2. The strip: four icons and "+N", the letter fallback and the live state.
3. The strip is placed at the top of the live and saved answers, and the
   bottom row is removed.
4. Site icons in the web-sources panel and in inline links.

**Verify**
- `npm test`
- `npm run lint`
- `npm run build`

### D. The supervisor

- **Privacy policy.** Add the half-sentence to `src/lib/legalPolicies.js`,
  with its test.
- **Integration.**
  - Run both test suites, lint, the build and the router check.
  - Do a local run in the browser pane against the local stack.
  - Measure, read-only, how often production logs `research.draft_retracted`
    with the reason `searching` or `rewriting` on turns without a web search
    (decision 5).
- **Production, each step only on the owner's go-ahead.**
  - Redeploy `research-chat`.
  - Push to `origin/main`.
