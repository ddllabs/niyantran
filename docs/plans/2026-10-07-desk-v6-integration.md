# Desk v6 integration: proposed capability map and delivery plan

> **Status: Living.** 2026-10-07. Planning is authorized; capability boundaries and implementation checkpoints are proposed for owner review. No application implementation or publication has begun.

Tracker: F88 in [open work](open-work.md). Repository workflow: [coordination](../agents/coordination.md). Supervisor planning branch: `task/desk-v6-integration`, based on synchronized `main` at `3e85c8f`.

## Product contract

The supplied `nter-all-sections-v6.html` governs design, image identity/cropping, layout and interactions. Actual application records and source metadata govern values, fields, coverage, dates and availability. Preserve the reference's key/value presentation, but do not create missing values, certify configured sources as working, or silently turn missing data into zero.

Reuse existing module workspaces and shell callbacks. Landing detail's Open in Terminal uses canonical in-app navigation; it does not hardcode a production URL or open a second signed-in application. Existing Home, AI, STT, record search, account, theme, language, persona and access behavior remain shell-owned. Reference catalogue search may provide a dedicated discovery view, but must not replace the working record-search capability.

The v6 reference supersedes vector artwork, inline disclosure, vertical landing rail and older layout/motion clauses in the Oct 4–5 landing specs. Their real-data contracts, preparation parity, deduplication, provenance, bounded loading, error handling and coverage restrictions remain applicable. Module workspace navigation is a separate context and must remain usable. No database migration, ingestion, source repair, fabricated dataset or billing policy change is implicit in this UI task.

## Existing documents and current evidence

- National: `docs/specs/2026-10-04-national-landing-redesign.md`, its plan and audit.
- Global: `docs/specs/2026-10-05-global-landing-redesign.md`, its plan and verification.
- Law: `docs/specs/2026-10-05-law-landing-redesign.md`, its plan and verification.
- Integrated release: `docs/plans/2026-10-05-desk-landing-release-verification.md`.
- Compact headers/login globe: `docs/specs/2026-10-07-login-globe-compact-desks.md` and plan.
- Static preview: `docs/specs/2026-10-07-desk-reference-preview.md` and plan, on the separate temporary branch. Asset source commit `50e3004`; individual byte hashes and image credits are in its manifest. Use that version as the frozen visual reference; do not merge the whole static preview into the application.

Read-only supervisor browser execution exercised all 40 sector selections, the 145-module search catalogue, directory navigation, planned/configured detail dialogs, motion toggle and data breakdown. National/Global/Law settled layouts at 375/768/1440px had no horizontal page overflow. Enter in search dismissed the module dialog after switching desks; mouse selection worked. Hover CSS was inspected, not pointer-tested. These are reference behavior observations, not verification of production connections.

Two read-only agents reconciled source files and existing documents. The reference has 145 module entries; current curated navigation has 75 (National12, Global16, Law12, State14 including selected Local, Economics6, Carbon4, Sports6, Entertainment5). All reference entries map to feature-map entries after explicit aliases, but that does not establish implemented source coverage. State has15 and Local16 HTML-ONLY entries. Existing summary endpoints cover only National12/Global16/Law12.

The previous claim of 81 curated navigation entries was corrected by executed catalogue parsing to75. No live production queries or code tests were run during this planning audit.

## Proposed capability map

| Stable ID | Responsibility | Prerequisite |
|---|---|---|
| desk-foundation | Canonical catalogue mapping, shared presentation contract, image inventory, dialogs, responsive motion, shell directory | — |
| national | First complete reference-faithful page with real summaries and chart | desk-foundation |
| global | Global imagery, sectors, modules and honest source coverage | accepted National shared contract |
| law | Law imagery, sectors and report/order distinctions | accepted National shared contract |
| state-local | Geography-scoped pages and Local navigation decision | desk-foundation; owner Local decision |
| economics | Markets/macro catalogue with real availability | desk-foundation; extra-desk summary contract |
| carbon | Carbon coverage/charts with real observations | desk-foundation; extra-desk summary contract |
| sports | Feed-aware catalogue without invented session totals | desk-foundation; extra-desk summary contract |
| entertainment | Feed-aware catalogue and chart identity | desk-foundation; extra-desk summary contract |
| desk-release | Cross-page verification, final review, authorized publication and cleanup | all accepted page slices |

Build order: foundation with a small National path → complete National and owner comparison → Global/Law → State/Local → Economics/Carbon → Sports/Entertainment → release. Each capability receives a scoped spec and exact task dispatch after the map is reviewed. This is not an implementation-ready monolithic spec.

## Fixed interfaces before page delegation

`DeskPresentation` contains desk ID, copy, image references/credits, sector IDs, and canonical module identities separate from display labels. Module identity is `(source tier, canonical feature)`, not a potentially duplicated display name. Every reference entry gets a mapping outcome, including unavailable/HTML-ONLY entries; missing map entries fail validation.

`ModuleSummary` retains nullable count, unit/count basis, resource identity, availability, source mode, source date/period, retrieval timestamp, populated columns, actual sources and coverage limitations. Counts from a fetched page are not automatically a whole-database total. Shared resources are counted once. Heterogeneous counts are described as combined records; missing values remain unreported. Database, embedded fallback, curated and feed-backed provenance remain distinguishable.

Shared UI receives models/summaries, canonical navigation callbacks, retry, language, motion preference and lock metadata. It does not own provider fetching, account entitlement decisions or new data. Detail coverage fields match the actual module schema; absent requested fields are disclosed instead of populated with sample values. Metrics/charts are derived from real summary aggregates. No full register is downloaded just to show a counter.

Supervisor alone owns common model/schema changes, router/dispatcher wiring, shell integration, asset inventory and shared CSS. Page agents consume frozen exports. Current Global/Law imports of `ModuleRow`/`SourceControl` from National must be decoupled before concurrent page edits. Old vector motion selectors cannot be reused blindly for photo-card markup.

## Ordered tasks and exclusive write scopes

Task progress is tracked only in F88, not in duplicate task lists. Each row is split into focused changes of roughly2–5 files before dispatch.

| Task | Scope and owner | Acceptance/evidence | Depends on |
|---|---|---|---|
| T0 Inventory/specs | Supervisor: this plan, new capability specs under docs/specs, F88 | Approved map; nine-page alias/source/image inventory; precise supersession; Local decision recorded | Owner review |
| T1 Shared catalogue contract | Supervisor: `src/desks/catalog.js`, new `src/desks/landing/deskPresentation.js` and colocated tests; route tests only as separately scoped | Explicit145 mappings; canonical IDs; no sibling fallback; access callbacks preserved | T0 |
| T2 Image inventory | Asset agent: new `public/images/desks-v6/**`, `src/desks/landing/deskImages.js` and verification script/test | All used hero/card/composite assets copied byte-for-byte with credits; lazy card/directory loading; no recompression without separate decision | T0 |
| T3 Shared presentation | UI agent: new `src/desks/landing/DeskLandingFrame.jsx`, `deskLandingV6.css`, `useDeskLandingMotion.js`, their tests; split dialog primitives into a separate dispatch | National path renders; native dialog focus/Escape/backdrop; selected cards/explorer; reduced motion/pause; exact reference composition | T1,T2 |
| T4 Shell navigation | Supervisor: `src/shell/TerminalShell.jsx`, `DeskNav.jsx`, appropriate shell CSS/tests; separate dispatcher edit `src/desks/DeskLandingView.jsx` | Landing rail replaced with reference-style directory/navigation; module views retain usable navigation; locks/personas/Back/record search/STT pass | T3 |
| T5 National data coverage | Data agent: `src/lib/nationalLandingSummary.js` and tests; separate API allowlist task in `server/nationalLandingSummary.mjs` and API tests | All17 mapped entries handled truthfully; prepared-feed parity, unknown/error/zero/dedup; no provider or ingestion edits | T1 |
| T6 National complete page | National agent: `NationalLandingView.jsx`, its test, `nationalLanding.css`, National-only presentation model/test | Five sectors/17 entries, actual bill-sector/stage chart only if summary supplies it; exact imagery/crops/motion; every canonical CTA | T3–T5 |
| T7 Global | Global agent: `GlobalLandingView.jsx`, its test, `globalLanding.css`, Global-only model/test |16 entries; commodity illustration excluded; upcoming-launch and partial-country coverage disclosed | Accepted T6 |
| T8 Law | Law agent: `LawLandingView.jsx`, its test, `lawLanding.css`, Law-only model/test |12 entries; reporting vs orders, shared SC dedup, limited Allahabad High Court coverage explicit | Accepted T6 |
| T9 Additional desk summaries | Supervisor/data agent: separate new extra-desk projection and tests; then bounded server endpoint/API wiring; then client hook/tests | Same source-aware contract for remaining desks; per-desk allowlists; cancellation/retry; no hardcoded reference totals or full row payloads | T1; exact endpoint spec |
| T10 State/Local | Coordinated page agent: new State/Local page models and colocated tests; root alone integrates routing/catalogue | Geography labels match loaded Goa pack; no arbitrary-state selector without source support; unavailable entries honest; Local policy preserved | T9; Local decision |
| T11 Economics/Carbon | Separate agents: desk-exclusive new page models/styles/tests |11/7 entries mapped; pricing/date/unit provenance; chart unknowns explicit | T9 |
| T12 Sports/Entertainment | Separate agents: desk-exclusive new page models/styles/tests |8/8 entries; configured feeds distinguished from retrieved rows; no fixed live totals | T9 |
| T13 Integrated acceptance | Independent read-only reviewer; supervisor fixes only separately assigned scopes | All reference interactions/links, themes/Hindi, mobile/zoom/touch/motion, data failures and regressions executed | T7–T12 |
| T14 Release/cleanup | Supervisor only, after owner authorizes preview push and final main publication | Inspect exact diff/commits/deployment; delete only merged task branches; preserve rollback and reference until acceptance | T13 |

## Branches, agents and environments

Start locally on `task/desk-v6-integration` from main. The reference preview branch/project stays independent. No new permanent dev branch or backend environment is needed. Specs/docs and each verified slice get coherent local commits; main remains unchanged until release acceptance.

Use one supervisor integration checkout. Sequential workers can use it only with exclusive scopes. Genuine concurrency gets supervisor-created worktrees/short-lived branches from the same verified integration checkpoint, for example `task/desk-v6-global` and `task/desk-v6-law`. Agents never edit another branch's shared files, commit, merge, push or deploy. Each dispatch includes onboarding, exact plan/spec, branch/path, scope, dependencies and commands. Supervisor reviews uncommitted diffs, reproduces material checks, creates one coherent commit per slice and integrates it. Squash only incidental agent iterations; preserve separately reversible shared/page changes.

At most two page implementation agents run together; a third slot is for an independent reviewer and the fourth is the supervisor. Source/data tasks and consumers remain sequential until their interface is fixed. Browser testing is coordinated by the supervisor, not shared concurrently. No blind merges, force pushes, stashing or discarding another worker's changes.

Remote work is for review: after explicit authorization, push the integration branch to the existing application project for a protected Vercel preview. The static reference deployment remains the comparison target. Application previews share the live Supabase project, so use read-only flows and controlled local fixtures for write/failure tests. Backend/source deployments, migrations, paid calls and production publication require separately named scope. Never send credentials through client variables or preview assets.

## Verification and fidelity gates

For each slice run its focused Vitest command, `npm run lint`, `npm run build`, and `git diff --check`. For changes under src/lib run full `npm test` and `deno test -A --config supabase/functions/deno.json supabase/functions`. For api/server changes run `node -e "import('./api/router.js').then(() => console.log('router import ok'))"`. SQL fixtures are required only if SQL changes are separately authorized, using disposable databases. There is no standalone type-check.

Meaningful guards must fail with the protected defect restored: mock counter substitution, double-counting a shared resource, missing canonical mapping, treating unknown as zero, exposing absent columns and incorrect source identity. Test dialogs/search with keyboard and mouse, including Enter defect, Escape/focus restoration and Back. Demonstrate real source parity by execution, not just code inspection; do not equate offline source checks with live connection acceptance.

Visual comparison uses the same viewport, loaded state, chosen sector, motion state and theme. Record screenshots plus DOM geometry against the frozen reference. Reference desktop hero242px at851–1699 and295px at1700+; National intentionally stacks below1150. Card201px/image107px at desktop;5/3/2-column sector breakpoints. Match image crop, overlay, selected border, hover5px lift/1.07 image zoom, entry/stagger and dialog timing. Preserve accessible contrast/focus; dark/Hindi/loading/error states have no supplied exact reference and need explicit review rather than a false pixel-equivalence claim.

National is the approval checkpoint for shared UI before page fan-out. Each later page is reviewed separately against its reference and real data. Final tests cover every mapped CTA and loading/ready/empty/unavailable/error/retry/geography states, persona locks, both themes, Hindi accommodation, 200% native zoom, 360/768/1440/1700+ widths, touch, reduced motion and hidden-tab lifecycle. Record unverified environmental cases explicitly.

## Decisions and limits

1. Pending owner response: restore separate Local desk versus preserve State folding. Any restored Local must retain existing access policy rather than granting a new pack silently.
2. Proposed terminal handoff: navigate within the app using existing callbacks. New-tab production handoff is a static-reference artifact.
3. Catalogue completeness is not source expansion. Planned/map-only modules can appear with honest unavailable coverage; new working sources require later explicit scope.
4. Actual production data is currently mixed database/API/embedded/curated/feed provenance. The implementation cannot claim everything is database-backed. Prefer established canonical feeds and disclose fallback identity; stop if a requested database-only metric has no verified path.
5. Reference stage values are inaccurate relative to local bill data; “General” is unclassified. Law reports are not judicial outcomes; source relevance work remains F84. These are fixed truthfulness constraints, not reasons to substitute the design.
6. No product code, assets, deployment or database changes made in this planning phase. Old work/verification records are retained. Reference cleanup occurs only after integrated replacement acceptance and explicit exact-target cleanup authorization.
