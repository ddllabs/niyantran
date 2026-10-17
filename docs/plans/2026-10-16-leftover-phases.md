# Plan: the leftover phases after F201/F202 (2026-10-16)

> **Status: Historical (completed 2026-10-16).** P0 and tasks A–D landed; what is left is ordered in
> `open-work.md`, "Milestones". Written 2026-10-16 from the owner's instruction: "Go plan out the leftover phases
> … and proceed. You can spawn multiple sub-agents … not every task requires an Opus." Items are tracked
> in `docs/plans/open-work.md` (F201 T9b, F169/F160, F202). The owner is making UI changes on another
> branch at the same time, so **no task here edits `.jsx`, `.css`, `src/shell/` or desk layout code**.

## Decisions already made by the owner

- The AI queries the RBI handbook figures through the structured search (`search_desk_rows`): SQL field
  filters, date ranges and trigram text match. No vectors for tabular figures (owner 2026-10-16: "We
  don't need to do vectorization on table-type fields").
- The feed timer has run since 2026-10-15; scheduled modules are switched to serving from the store
  after a comparison, class by class.

## Phases and tasks

Write scopes are disjoint, so tasks A–D run concurrently in their own worktrees. Production steps are
the supervisor's.

| Task | What | Write scope | Model | Production step (supervisor) |
|---|---|---|---|---|
| **P0** | Load the handbook into `desk_rows` (code merged in `c18110f`) | none | supervisor | dry run, load, `analyze`, check `n_live_tup` (+102,569) |
| **A** | The AI's module catalogue lists the eight handbook modules with every table number and title, so the AI names a module and picks a table | `src/desks/catalog.js` (grounding logic only), `src/lib/deskCatalogBuild.js`, `supabase/functions/_shared/deskCatalog.json`, research-chat prompt text if needed, their tests | Sonnet | redeploy research-chat after diffing the deployed source; four live questions in the owner's tab |
| **B** | Serve scheduled modules from the store: a read-only comparison report (stored copy vs live answer, per scheduled module); "nothing new" for PIB modules such as Cabinet Decisions counted as success, not failure; Music Charts' 20 s timeout; a module that comes back empty keeps serving its last good copy | `server/feedStore.mjs`, `server/feedServe.mjs`, `server/feedSchedule.mjs`, `server/featureFeed.mjs` (Cabinet and Music branches only), new `scripts/compare-feed-store.mjs`, tests | Opus | run the report; switch `serve` on class by class; independent review first |
| **C** | F202 leftovers: same-event rewordings, Climate Newswire's story count, the AI & Tech filter, leaders' "latest" notes that describe a previous office-holder (data file, with an inventory addendum) | `src/lib/curatedNews.js`, `server/nationalFeed.mjs`, `server/featureFeed.mjs` (the `TECH_TITLE` filter only), `src/data/leaders.json`, `docs/research/2026-10-15-data-file-fixes.md` (addendum), tests | Sonnet | none (web deploy) |
| **D** | Handbook block lifecycle before the next edition: the loader switches new block variants on and obsolete ones off in one step and exits non-zero until done; orphans from an unfinished earlier cleanup are reported again. Block names are not changed now (that would rename the live blocks) | `scripts/load-feed-register.mjs`, `src/lib/feedRegister.test.js` | Sonnet | none until the 2026-27 edition |

Deferred because it is UI: showing the Wikidata links in the Heads of State record panel
(`src/shell/record/adapters/headsOfState.js`). It goes to the owner's UI branch or after it.

## Acceptance

- **P0:** `desk_rows` grows by 102,569 rows; a desk-wide search finds Maharashtra's GSDP for 2019-20.
- **A:** the catalogue names the eight modules and their tables; a research-chat question naming
  "outstanding liabilities 2023" is answered from Table 176 with its RBI link.
- **B:** the report lists, per scheduled module, rows stored vs live, the newest dates and the overlap;
  Cabinet Decisions with nothing new records success; Music Charts completes or degrades within its
  limit; an empty refresh never replaces a good stored copy. Serving switched on only for classes the
  report shows as equal or better than live.
- **C:** each fix has a test that fails first; live probe of the touched modules.
- **D:** a simulated next edition (the 2025 figures copied as 2026) leaves no stale block serving after
  one load.
- **Every task:** `npm run lint`, `npm run build`, router import, full `npx vitest run`; Deno tests when
  `supabase/functions` changes.

## Checkpoints

1. After P0 and A: the AI answers handbook questions in production.
2. After B's review: serving switched on class by class, with a probe after each class.
3. After C and D: merged, full suite, pushed.
