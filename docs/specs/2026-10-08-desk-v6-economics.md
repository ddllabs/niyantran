# Economics desk v6

> **Status: Living.** Approved local scope implemented on 2026-10-08. Owner review and publication remain pending.

Tracking: F88 in [open work](../plans/open-work.md). [Slice plan](../plans/2026-10-08-desk-v6-economics.md); [overall integration plan](../plans/2026-10-07-desk-v6-integration.md).

## Objective and current state

Replace only the Economics landing page with the supplied v6 composition and interactions. Retain existing Economics terminal workspaces and use their actual prepared feed data for summaries. Reference images, card order, crop, selected/hover states, popups and directory behavior govern presentation; reference counts and availability do not govern data.

Pre-implementation source inspection on 2026-10-08 found:

- `DeskLandingView.jsx` still sends Economics to the standard landing, which loads one flagship feed. The curated finance catalogue lists six modules, while v6 has eleven in four groups. All eleven exist in `html-feature-map.json` and have explicit `econSlice` mappings.
- `server/featureFeed.mjs` has dedicated finance branches. Registry adapter/status strings differ from actual branch behavior; the envelope returned by the executed branch must govern coverage. News search must never stand in for prices, forecasts or macro observations.
- `server/financeApi.mjs` supplies live World Bank, Yahoo, Wikidata and Manifold adapters. Successful configuration is not evidence that these providers currently return usable rows.
- Existing National/Global/Law summaries establish a compact projection, bounded cancellable client loading, retry, nullable counts, populated-column and canonical-route pattern. Economics needs its own allowlist/projector and endpoint using that pattern; no new database or provider is needed.
- Exact Economics assets and v6 copy already exist in `DESK_VISUALS.economics`. Four cards use `nse-bse` composite, `macro-indicators.png`, `trade.jpg`, `industry-machinery.png`; hero is `economics-markets-hero.png`. Preserve the reference assignment even where its image choice is unexpected.

Executed offline extraction through existing `econPack` projectors: quote snapshot 144 raw/144 prepared, Manifold 500 raw/31 political prepared, DGFT 229 raw/229 prepared. These are local snapshot evidence only. No live provider, production, authenticated account or browser acceptance execution occurred in this planning turn.

## Reference-to-source contract

Canonical names below are route identities, even when display copy needs a qualifier. Each popup exposes actual coverage and populated columns; unavailable requested fields are disclosed, never invented.

| Reference group | Canonical module | Actual implementation coverage to verify |
|---|---|---|
| Market Intelligence | NSE/BSE Delayed Market Feed | NSE delayed quotes if returned; otherwise frozen embedded quotes. Snapshot date may be unreported. No live tick or sector coverage claim. |
| Market Intelligence | Live Global Stock Exchanges | Yahoo last index quotes for configured venues; no licensed tick stream or universal exchange coverage. |
| Macro Indicators & Models | Economic Overview of All Countries | World Bank GDP current US$, latest non-empty country observations; aggregates excluded; no trade balance table. |
| Macro Indicators & Models | Key Financial Indicators (GDP, CPI, PMI, Emp-to-Pop) | World Bank growth, CPI and employment-to-population observations. PMI absent. Preserve observation years and indicator units. |
| Macro Indicators & Models | Economic Simulator | Historical India GDP growth baseline. No working what-if engine or generated scenario results. |
| Industry, Trade & Technology | Sector Policy — Power/Energy/Green/Critical Minerals | India electricity-access series. No full policy/ministry/critical-mineral register. |
| Industry, Trade & Technology | Trade Agreements & Economic Sanctions | Embedded DGFT notifications. No complete sanctions, WTO tariffs or agreement inventory. |
| Industry, Trade & Technology | Top Financial & Business Players | Wikidata Indian enterprise chief-executive identities. No ranking, financials or market cap. |
| Industry, Trade & Technology | AI & the Tech Industry | PIB RSS entries. Verify topic coverage from the actual returned rows; no investment database or automatic claim that every item is AI-specific. |
| Prediction Markets | Prediction Market Political Odds | Existing political-market filter and recent-volume ordering; live Manifold or political snapshot. Not all 500 raw markets or NTER forecasts. |
| Prediction Markets | Election Forecast Aggregator | Existing branch returns status only. Show unavailable forecasting coverage, null count and reason; no forecasts or consensus values. Retain its canonical terminal handoff to the existing status workspace. |

Provider error for an otherwise implemented feed is distinct from a deliberately unavailable capability. Remove `source_status` rows from all counts and columns. Do not copy legal assertions from provider notes into landing copy without separately verified scope; describe missing election data factually.

## Expected behavior and fixed interfaces

- `EconomicsLandingView` consumes `ECONOMICS_PRESENTATION`, `useEconomicsLanding(ECONOMICS_FEATURES)` and the existing `DeskLandingFrame`. Its canonical tier is `finance`, shell tab is `economics`.
- `GET /api/economics-landing?feature=<allowlisted canonical name>` is read-only and forces finance tier regardless of supplied query tier. Unknown feature gets 400, other methods 405. Both Vite middleware and Vercel router use the same server handler/projector.
- Summary envelope uses version 1, feature/resource identity, nullable count, unit, count basis, availability, source mode, observation/source period, retrieval time, populated columns, safe public source links and limitations. Dates are derived only from returned metadata/observation dates; retrieval time is not a quote update date. Preserve stored vs API provenance and errors with useful coverage metadata. Do not include full row payloads.
- Client queue has at most three workers, bounded per-request timeout and abort-on-navigation, validates feature/version/resource identity, preserves valid error summaries and retries the requested module. No per-render provider polling.
- Count only prepared source entries and explicitly label heterogeneous combined counts. Do not sum quote prices, probabilities, GDP dollar levels, CPI percentages or different indicators into a metric. If a whole-database total is unknown, retain that distinction.
- Data breakdown shows measured module counts with count basis and units. Include a real quote-count-by-exchange series only when usable exchange labels exist; disclose missing labels and do not infer sectors. No numeric market/macro chart comparing incompatible units. Unknown/loading/error must not appear as zero.
- Shell enables v6 landing layout for Economics only in empty-feature guide mode. Existing topbar controls, access checks, module workspace rail, command search, AI and STT remain intact. All eleven module routes resolve via existing shell callbacks; non-curated entries must still have usable canonical route/access metadata without broad catalogue expansion.

## Visual and interaction acceptance

Four reference photo cards and eleven module popups retain exact order, hero/card geometry, images/composites/crop, hover lift/zoom, stagger, selected border and dialog styling. Existing frame provides catalogue search, filters, All sections dialog, data dialog, keyboard Escape/backdrop/focus return, pause/reduced motion and theme behavior. Source-constrained copy may differ from aspirational reference claims.

Verify first click and Back/reclick for all eleven destinations in the real shell; preview callbacks alone are insufficient. Reference preview full reload/session flash previously investigated is an independent issue, excluded here. Never claim the terminal table itself has been redesigned by this landing change.

Responsive evidence at 360/768/1440/1700px; both themes, Hindi accommodation, no page overflow or missing images. Native 200% zoom, touch and OS reduced-motion/hidden-tab checks remain required or explicitly reported unverified. Owner reviews the completed Economics slice before Carbon implementation.

## Scope, conventions and exclusions

React JSX components, colocated Vitest tests, existing ES module helpers and shared frame contracts. Keep canonical identities separate from display labels, for example:

```js
const module = (feature, title = feature) => ({ tier: 'finance', feature, title, configured: true });
```

This is a read-only landing/summary slice on `task/desk-v6-integration`. No new dependencies, migrations, ingestion, provider repair, auth/billing changes, database writes, data-collection edits, publication, main merge or branch cleanup. Do not expand Carbon/other desk scope through a generic endpoint. Reuse assets; no recompression or speculative shared-frame rewrite.

## Verification commands and gates

Planned focused commands after each slice (test paths introduced by the plan):

```bash
npx vitest run src/desks/landing/economicsPresentation.test.jsx
npx vitest run src/lib/economicsLandingSummary.test.js src/lib/economicsLandingApi.test.js
npx vitest run src/desks/useEconomicsLanding.test.js src/desks/EconomicsLandingView.test.jsx src/desks/landing/DeskLandingFrame.test.jsx src/desks/landing/economicsPresentation.test.jsx
npm test
deno test -A --config supabase/functions/deno.json supabase/functions
npm run lint
npm run build
node -e "import('./api/router.js').then(() => console.log('router import ok'))"
node scripts/verify-desk-v6-assets.mjs
git diff --check
```

Prove key guards fail when restoring the defect: 500 raw Manifold count, counted status row, wrong canonical tier/feature, unknown treated as zero, unsupported PMI/forecast fields and news-as-market coverage. Fixture execution proves rejection/fallback paths; explicitly distinguish it from actual provider execution. No SQL check needed without SQL changes; no standalone type-check exists. Record build warnings, unavailable providers and browser checks not executable. Independent review and supervisor re-execution precede local commits; publication needs exact owner authorization.

## Executed local acceptance — 2026-10-08

Economics now uses the shared v6 frame: four groups, eleven canonical finance routes, exact existing images and a quote-count-by-exchange highlight. A dedicated compact GET endpoint calls the same source handler locally and in the Vercel router. Generic XLSX backup packs are rejected even when labelled embedded; status/news rows never become fabricated finance records. Narrow GDP/forecast card descriptions qualify the reference copy. Dark hero contrast has an Economics-only override.

Final local endpoint execution returned: Indian quotes144 (stored), global index quotes5 (API), country GDP186 (API), financial indicators186 (API), electricity-access observations25 (API), India growth baseline36 (API), DGFT notifications229 (stored), enterprise identities101 (API), political markets250 (API). Technology returned502/null/error; election forecasts200/null/unavailable. These are observed responses, not permanent database totals. Periods and populated fields come from each response; CPI/employment years are not independently supplied by the existing adapter. A later browser reload independently showed nine measured counts/1,162 combined entries; totals can vary with feed responses.

Verification executions:
- `npm test`:159 files/2,227 tests passed.
- `deno test -A --config supabase/functions/deno.json supabase/functions`:862 passed.
- `npm run lint`:passed, no warnings.
- `npm run build`:passed; existing large-chunk and mixed static/dynamic deskBrief import warnings remain.
- Router import, asset verifier (41 byte-identical assets,40 named images,9 configurations against50e3004) and `git diff --check`:passed.
- Independent review:39 focused tests passed; final review clear after source-loader/backup rejection and misleading card-copy fixes. Defect-restoration guards were observed failing before corrections, including raw market totals, status counting, fabricated PMI/forecast, unsupported news and embedded-labelled backup packs.

Browser execution: all four cards/eleven popups had exact canonical terminal hrefs; data dialog showed BSE5/NSE139, Escape/focus return, directory, coverage filter and pause controls worked. Both themes inspected;360/768/1440/1700 widths had no overflow or broken images. No captured preview console errors. Hindi has test coverage, but full translated content is not claimed. Native200% zoom, touch, OS reduced motion and hidden-tab lifecycle remain unverified. Retry/abort/error paths are fixture-tested; provider recovery was not induced in the browser.

Actual shell attempted Economics but the current account redirected to National and displayed Economics Upgrade. Signed-in first-click/Back acceptance is therefore unverified; account/access behavior was not altered. Preview is `http://127.0.0.1:5174/tmp/desk-v6-preview.html?desk=economics`. This is owner review evidence, not acceptance or a production deployment. Carbon remains separate.
