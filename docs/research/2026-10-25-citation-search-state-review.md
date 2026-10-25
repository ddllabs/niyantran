# Citation entry, discovery search and view-state investigation

Status: **Living.** Read-only investigation and proposed scope, 2026-10-25 IST. Investigation itself made no source or data changes. Owner subsequently approved the recommendations and autonomous preview implementation; see the normative discovery-workspace spec and plan. Capability boundaries and product choices below are proposals for owner review before formal module specs.

## Baseline and evidence

Checkout `task/nter-news-rss-preview`, HEAD `0030407a41d9918f73ea890e75f44148007e048d`; clean at entry. Fetched origin without changing working files; origin/main remains `348ae6b13ced086544b3fd8fe72713985a35177d`. Preview: https://niyantran-git-task-nter-news-rss-preview-ddl-labs.vercel.app/. No new Vercel URL created.

Read AGENTS.md, agent coordination, open-work, spec/planning/debugging/browser review skills, taste skill and app-screen/critique guidance. Reviewed catalogue identity/presentation/search, command search, shell navigation and side-panel selection, generic DeskView and filter popover, paged-list contract/tests, row-source handoff, citation types/bubbles/source grouping, viewer state and record-brief side effects. Supabase skill applied to a read-only aggregate coverage query; no provider credentials read or exported. Existing citation version/grouping requirements remain applicable.

### Confirmed in the signed-in browser

1. Catalogue opens in its own mode with120 modules. Result rows already include desk / section, e.g. Law / International Courts, but rendered as a flat list with a small subline. The header incorrectly says SEARCH SEVEN DESKS; identities span eight desks.
2. Records is a separate mode with a separate query. Searching Globiz from Global returned its Law / NCLT record, proving that record lookup is cross-desk for this example. No result was opened and no new AI question was sent.
3. Existing Globiz chat source cards have no Open citations CTA. Citation numbers are SPAN elements without role/tabindex, inside the one document button. Measured title14px, metadata11.5px and number10px. The surrounding document button opens its first citation; numbers are not individual targets.
4. Open Fronts filter search Ukraine reduces88 rows to1. Closing the popover preserves the1-row result. Navigating through Diplomacy to Alliances and using browser Back restores88 rows; reopened filter query is empty. Original route/unfiltered state restored and popover closed at the end.

### Confirmed by source reading / existing tests

- `src/ai/SourceList.jsx:105` opens `g.first`; line115 renders plain number spans. `CitationBubble.jsx` already resolves a specific source and has selected/focus behavior, so exact citation navigation does not need a retrieval change. Avoid nesting new buttons inside the current outer button.
- Text document cards depend on readable text-citation payloads, not a frontend embeddings check. Row citations and web sources have separate renderers. Do not claim that all citations require embeddings or that all unembedded records lack citations. Preserve these source types and existing version tags.
- `src/shell/DeskCatalogueSearch.jsx` defaults to catalogue; switching to Records mounts CommandSearch with its own local query. Selecting a record clears that query and closes the dialog; returning to the trigger defaults to catalogue. A module result first opens a coverage detail rather than navigating immediately. These are existing behaviors to clarify in design.
- `src/shell/commandSearch.js:22` queries `search_desk_rows` only, four hits per desk, concatenates in desk order and truncates to16 overall. It ignores returned totals and offers no continuation; later desks can disappear from broad searches. One failed desk rejects the combined record request. SQL orders feature/row key, rather than product-wide relevance. Record subtitles omit the presentation section/group; navigation matches use raw feature/bucket metadata rather than the catalogue display aliases.
- `src/desks/DeskView.jsx:125` keeps query/sort/page locally. Shell keys it by tier/module (`TerminalShell.jsx:541`), so navigating modules remounts it. Reset effect clears query and selection; only Parliamentary Questions persists query/answer-filter. Page, sort, chart filters, module/sub-picks, selected row and scroll lack a general scoped restoration contract. Shell also clears selection/visual filters on history navigation.
- Same-module table row click calls onSelect, not setQ. The report that *every simple row click* clears the filter was not reproduced and must not be presented as confirmed. Existing paged code preserves the view key unless query/sort/filter changes; that first-page reset is intentional.
- `src/ai/openRowSource.js:63` fetches an off-page target by key and returns it for selection. It does not return a page number, change the current table page or insert/reveal the row. `deskViewPaging.test.jsx` proves right-panel selection for a target outside the page, but does not assert that the left table reveals/highlights it. Global record selection routes through this same handoff and increments reload. Search query/origin view are not part of the handoff.
- Specialized module monitors keep their own local state, so a generic DeskView fix alone does not establish all-module restoration. Scope an explicit module-state adapter inventory.

## Record search coverage: execution evidence

Read-only SELECT on NTER project `vfgcppstyzjarlzyqdac`:

`select tier, feature, count(*)::int as row_count from public.desk_rows group by tier, feature order by tier, feature;`

Observed42 populated desk/module pairs,137,757 rows. Snapshot counts by desk: Global11, National8, State14, Law3, Economics2, Carbon4. No Sports or Entertainment rows. Catalogue contains120 module identities across eight desks. This is a count of the stored search/grounding inventory, not proof that the other modules have no frontend data, nor a claim that every stored snapshot is current. No document bodies, embeddings or customer identifiers queried.

Do not expand the AI grounding/embedding corpus just to improve navigation search. Full-product record search needs a separately approved coverage contract and source inventory, including structured registers, API/live or cached feeds, specialized views and planned modules. A prettier list cannot solve missing search coverage.

## Design direction from the taste review

Keep the existing terminal palette/type/shell. This is a component/app-screen refinement, not a new landing-page direction; no random style draw or new brand system. Source evidence is the product's useful artifact: make its action explicit, keep exact source identity legible, use quiet borders/flat surfaces, and reserve emphasis for Open citations and the active number. All affordances must work on keyboard/touch; hover alone is insufficient.

Search should read as a destination list: result title first, then Desk → Section → Module, with record identity beneath when relevant. Display aliases come from the existing catalogue; canonical keys remain routing identities. Separate result types with clear headings/counts and consistent active/focus rows. Preserve the query across mode changes. Do not imply full record coverage, completeness or relevance ranking before the coverage provider supports it.

No generated mockup, screenshot inspector script or new test/fixture code was created. Browser observation used the in-app browser rather than launching a separate authenticated profile through the taste inspector. No mobile implementation acceptance is claimed by this review.

## Capability map (approved for scoped preview implementation)

| Module id | Responsibility | Depends on |
| --- | --- | --- |
| workspace-state | Scoped search/filter/sort/page/selection/scroll state and reveal-record navigation contract | — |
| citation-entry | Actionable document artifact, Open citations CTA, individual exact citation controls | — |
| record-search-coverage | Honest cross-module search coverage, bounded ranking/continuation and partial failure contract | — |
| search-discovery | Unified discovery presentation/query, canonical hierarchy, exact destination handoff | workspace-state, record-search-coverage |

Proposed order: define workspace-state and coverage interfaces first; implement/review citation-entry independently; deliver workspace-state; deliver approved record-search-coverage scope; integrate search-discovery. Sequential implementation unless separately authorized otherwise. These modules can be reviewed/shipped independently; no implementation is authorized by this document.

## Proposed outcomes and acceptance criteria

### workspace-state
- Same-module row selection preserves query, active filters, sort, page and scroll; no unrelated row is highlighted by title alone.
- Leaving/revisiting a module, Back/Forward and returning from a record restore its scoped view. Search-change intentionally starts at page1. Account identity separates stored state, with logout clearing private state. Proposed persistence is session-scoped; whether a full reload restores it is an explicit spec decision.
- Opening a global record keeps the origin search/view available for Back, reveals the exact target on the left and opens the same record on the right. If existing filters exclude it, show a clear temporary record-focus view with Return to results, rather than silently destroying filters. Missing/removed records have an explicit unavailable state.
- Cover generic and specialized module state, cancelled/late fetches and same-title/different-key records. Do not promise all-module parity until the adapter inventory passes.

### citation-entry
- A compact document artifact shows title, module/version/page context and an explicit Open citations action. Main CTA opens the first listed citation; each number opens its own original source object through the existing viewer action.
- Reuse the current readable-source validation and exact source identity, including document/chunk/version. Preserve multiple versions, repeated clicks and active citation indication. No nested buttons; proper accessible names, visible focus, hover/focus metadata and touch targets.
- Number hover/focus can show available title/version/page/section information. Citation payloads do not include a passage excerpt, so do not promise instant snippet previews or make new fetches on every hover without a separate bounded design.
- Preserve web-source and row-source behavior; no model/retrieval/embedding/credit changes.

### record-search-coverage
- Inventory120 catalogue entries into searchable provider / intentionally empty or planned / not yet supported, with real source/freshness and access boundaries. Do not label missing provider coverage No results.
- Agree whether this release is indexed-snapshot search with explicit limits, or true cross-module records. Recommendation: provide global catalogue discovery immediately, then complete record coverage through a separate read-only provider/index rather than alter the AI corpus. Preview verification uses isolated fixtures; data/index production changes need separate approval.
- Use one stable hit contract: canonical tab/tier/feature/row key plus display title/path/kind and snapshot/source metadata. Bound results, rank consistently and supply continuation/total semantics; preserve successes if another provider fails. Cancel old queries and reject late results.
- No brute-force download of every module into the browser or unbounded parallel scans. Confirm source availability and performance budgets in its spec before implementation.

### search-discovery
- One retained query; clearly named All / Modules / Records scopes or equivalent, without misleading coverage promises. Explain module-preview versus open-record actions.
- Desk, section, module and record hierarchy from the canonical catalogue; same-name modules/records remain distinguishable. Dynamic eight-desk/120-module labels, not hardcoded seven.
- Full keyboard, dictation/IME, Escape/focus return and drag-to-AI behavior retained. Clear loading/empty/partial/error states; desktop/tablet/mobile and light/dark acceptance.
- Record destination consumes workspace-state's reveal contract. Do not clear origin query or lose list position on selection; do not fake target visibility when right-panel-only selection succeeds.

## Proposed write scopes / verification plan for the later specs

- workspace-state: TerminalShell.jsx; DeskView.jsx; openRowSource.js; deskRoute/history handoff; new scoped state helper; specialized state adapters identified by inventory; related tests. Final exact adapter scope must be enumerated before editing.
- citation-entry: SourceList.jsx; MessageRow.jsx; CitationBubble.jsx only if reuse needs a prop; research.css/chat-presentation.css; source/component interaction tests. No citation payload/server/retrieval change anticipated.
- record-search-coverage: commandSearch provider boundary and tests first; any server/index/SQL scope requires a separately reviewed inventory/contract, not blanket permission to ingest.
- search-discovery: DeskCatalogueSearch.jsx; CommandSearch.jsx; commandSearch.js; corresponding CSS/tests; catalogue identity lookup (no arbitrary rename of canonical module keys).
- Before implementation, write module specs under docs/specs/ and ordered plan under docs/plans/, retaining this report as evidence. Owner reviews scope/coverage/persistence decisions; no coding from this investigative turn.
- Verification later: causal RED/GREEN for each reported defect, end-to-end interaction fixtures for state plus left/right identity, not just mocked setState calls. Focused Vitest, full npm test, npm run lint/build/check:bundle, router import for server edits; both app/Edge suites for src/lib changes; disposable SQL fixtures for schema/SQL changes. Preview push/deploy and both exact-commit CI jobs require the next scope's explicit authorization. No main/production release implied.

## Checks actually run in this review

`NODE_OPTIONS='--import=/private/tmp/nter-rss-offline.mjs' npm test -- src/shell/DeskCatalogueSearch.test.jsx src/shell/commandSearch.test.js src/shell/CommandSearch.test.jsx src/desks/landing/deskCatalogue.test.js src/ai/SourceComponents.test.jsx src/ai/openRowSource.test.js src/desks/deskViewPaging.test.jsx`

Result: seven files /72 existing tests passed with external traffic denied. These confirm current contracts and expose test coverage limits; they do not prove the proposed new behavior. No full suite/build run was needed for documentation-only work. No new record opened (which could generate a platform-paid brief if missing), no AI call, billing operation, provider configuration, source content, Supabase mutation or Vercel action. Final repository changes are documentation only, uncommitted/unpushed for owner review.
