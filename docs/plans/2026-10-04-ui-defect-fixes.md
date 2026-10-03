# F60 — Frontend defect fixes implementation

> **Status: Living.** Supervisor-owned execution plan, 2026-10-04.

Spec: [frontend defect fixes](../specs/2026-10-04-ui-defect-fixes.md).
Open-work entry: F60 in `open-work.md`. Integration branch: `task/f60-ui-defect-fixes`.

## Ordered tasks and exclusive scopes

1. Supervisor establishes the clean baseline, records this contract and creates
   three isolated worktrees. No agent commits, delegates, pushes or deploys.
2. Independent implementation tasks may run concurrently:
   - **AI state:** `src/lib/aiConversations.js`, its tests, `src/lib/aiThreads.js`,
     `src/lib/aiDrop.js`, its tests, `src/ai/useResearchThread.js`, its tests.
     Expose errors from optimistic conversation writes, attachment processing state,
     named overflow feedback and reuse file bytes for hashing and extraction.
   - **Shell/desks:** `src/shell/` and `src/desks/` implementation and tests.
     Repair the concrete keyboard, stale-brief, drawer, hidden ticker and graph
     findings. Do not edit shared CSS or library helpers; report any needed change.
   - **Marketing/admin:** `src/marketing/` and `src/admin/` implementation, styles
     and tests. Repair the reviewed accessibility/navigation/contrast defects;
     do not change authentication or billing behavior.
   - **Supervisor AI UI:** `src/ai/AiPanel.jsx`, `AiPanel.test.jsx`,
     `AiMarkdown.jsx`, `AiMarkdown.test.jsx`, `panelLayout.test.js`,
     `research.css`, and `src/index.css`. Repair reading height, safe breaks,
     popover keyboard/focus, removal state and consume AI-state feedback.
3. Supervisor reviews each uncommitted diff, integrates and verifies material
   evidence. Commit coherent slices locally. Obtain independent review of the
   integrated result before closing the task.
4. Run final checks and local browser scenarios with offline fixtures; record
   exact results and limits here. Retain the UI branch for the next owner brief.

## Fixed AI interfaces

- Conversation state adds `persistenceError: string`, empty by default/reset;
  failure messages use safe fixed copy and are fenced by account/generation.
  An authoritative successful hydration clears the warning.
- Controller view adds `attaching: boolean`; `locked` includes it, while
  `canStop` continues to represent research execution only.
- Controller attachment notices name duplicates and overflow; it admits only the
  remaining slots in the existing 12-item limit. Export `MAX_ATTACHMENTS` through
  `aiThreads.js` so policy is shared. Existing synchronous store APIs remain.
- UI shows processing status, `attachNotice` and `store.persistenceError`, with
  Reload for save failures. No raw server error text is displayed.

## Verification

Each owner runs focused `npm test -- <paths>` with red/green evidence, lint and
build after code changes. AI-state and admin owners also run full `npm test` and
`deno test -A --config supabase/functions/deno.json supabase/functions`.
Supervisor runs those full suites, lint and build on integration. Runtime checks
cover AI layouts at desktop/tablet/phone, keyboard popovers/drawer/rows, pending
attachment feedback, save failure recovery, marketing controls and mobile admin
navigation using local fixtures, never the live project as a write fixture.

## Execution evidence

- Start: clean `main` at `0b45d1e`; `git fetch origin --prune` succeeded and
  `main...origin/main` was `0 0`. No production operation authorized for F60.
