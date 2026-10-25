# Citation, search and workspace refinement

Status: **Normative.** Approved scope, 2026-10-25. Owner approved the investigation and autonomous preview implementation. Evidence: [investigation](../research/2026-10-25-citation-search-state-review.md).

## Capability map and contracts

1. **citation-entry**: keep document/version grouping; a visible Open citations action opens its first passage, individual accessible numbered buttons open their exact document/chunk, with selected state and metadata on hover/focus. Preserve web and row sources, reader and retrieval.
2. **workspace-state**: per account + canonical desk/module session state for query, filters, sorting, page, module choices, selected key and scroll. Navigation and Back/Forward restore it; changed search starts page one. Specialized query/filter controls use the same scoped adapter. Persist keys and controls only, never whole records. Logout clears state. Opening an exact search/citation target shows a temporary record-focus view and Return to results without destroying filters; missing targets are explicitly unavailable.
3. **record-search-coverage**: this release retains the existing read-only indexed-snapshot provider. It must explicitly say this is partial coverage (42 populated modules at review; not all 120 or live data), preserve successful desk results on partial failure, distribute bounded results fairly, rank consistently and offer continuation. Catalogue discovery covers all 120 modules in eight desks. A new complete record index/ingestion is excluded: its separate provider inventory/approval remains required, as the approved investigation specifies. No claim of complete global record coverage.
4. **search-discovery**: one retained query across Modules / Records; global catalogue plus accessible indexed records. Titles and Desk → Section → Module breadcrumbs, type/count headings, clear coverage/status and Load more. Query and mode survive dismissal/destination and account changes clear them. Preserve keyboard, IME, dictation, drag to AI, focus return and cancellation.

## Acceptance evidence

Causal failing tests before fixes for exact citation clicks, partial/fair record results, retained view controls and target reveal. Runtime verify navigation Back/Forward, ordinary row selection, off-page/excluded targets, query/mode retention, keyboard and narrow/dark presentation using isolated fixtures to prevent live writes or paid AI briefs. Full application/Edge suites, lint/build/bundle; both required exact-commit CI jobs before preview alias assignment. Production SHA and live Supabase data/schema untouched.

## Scope and exclusions

Write scopes: src/ai/{SourceList,MessageRow,CitationBubble,openRowSource} and related tests/styles; src/shell/{TerminalShell,DeskCatalogueSearch,CommandSearch,commandSearch} and related tests/styles; new src/shell/workspace state helper/provider; src/desks/DeskView and query/filter adapters in AlliancesMonitor,CommoditiesDesk,ConflictsMonitor,FundFlowDesk,GlobalAidMonitor,LeadersDesk,MorningBriefDesk,MpCardsDesk,NuclearWatch,PolicyGraphDesk,SanctionsMonitor,ManifestosDesk,TransitDesk and StatementsDesk if present. Generated terminal style entry only as needed. Docs spec/plan/review/open-work.

Do not alter authentication/billing policy, AI retrieval/corpus, source datasets, homepage layout, SQL/Edge functions, production branches/domains/configuration. Search cannot make unavailable record sources complete. View persistence excludes transient popovers, live connections, chart gestures and calculator inputs. Session reload restoration is included; storage failure degrades to in-memory navigation persistence. Specialized source-specific selection that lacks a stable row key must not invent one.
