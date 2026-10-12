# Global record panels: reference, current state and data inventory

> **Status: Historical (2026-10-13).** This is a read-only review by the supervisor
> for F121. Sources: the owner's reference file
> `~/Downloads/nter-global-record-panels_4 (1).html` (not in the repo), a code survey
> of the Record tab, and reads of the Global datasets. Nothing was changed.

## 1. The reference

The reference is a standalone HTML "record-panel kit": one renderer, 14 Global module
examples. It holds itself to one rule: **every figure carries its provider and as-of
date, and a panel never implies data it does not hold**. Bracketed values such as
`[date]` mark fields the record may not have.

Every panel has the same five parts:

| Part | Content |
|---|---|
| Header | Title (20px/700), a LIVE dot (or "NO ROWS YET"), meta (e.g. region), one coloured status badge (red/amber/green/blue/grey), and source-document links (`↗ Source records`) |
| 01 · At a glance | 3–4 stat tiles (label, value, sub-label; coloured value or bar) and one module-specific visual, an optional stage track and an optional caution callout |
| 02 · About this <thing> | Key/value rows, chips or bullets, and note cards (e.g. "What changed at last verification") |
| 03 · <Thing> & what it touches | Four-lane connection graph (left → this record → right → far), a node/link count, two cross-link cards, and "Open full impact analysis" |
| Footer | Related coverage, "✦ Ask AI about this <thing>", provenance (provider, plus "not ACLED" where it matters) and an editorial note |

Visual types: `world` (schematic map with markers, arcs and bands), `timeline` (stages),
`board` (two-column value board with deltas or present/absent tags), `rank` (meters),
`meter`, `shares` (stacked bar), `leader` (leader card), `orbit` (orbital profile),
`strait` and `locator`.

Per-module panels in the reference:

| # | Module | Glance visual(s) | About | What it touches (lanes) |
|---|---|---|---|---|
| 01 | Open Fronts | world (theatre on the map) and an amber callout ("intensity is editorial, not event counts") | Parties, began, classification basis, adjacent theatres; "what changed" card | Region → front → chokepoints → commodities |
| 02 | Global Intelligence | timeline (procurement stage) | Vendor, service, quantity, offsets, delivery window; programme note | Origin → programme → service → industry; world (origin → operator) |
| 03 | Alliances | world (member states) and timeline (roster history) | About this bloc | Region → bloc → members → fronts |
| 04 | Sanctions | world (who listed whom) and board (who has listed what) | About this programme | Authorities → programme → sectors → entities |
| 05 | Global Aid | world (where the appeal lands) | About this appeal | Institution → appeal → countries → donors |
| 06 | Infra | world (asset on the map) | About this asset | Country → asset → routes → sectors |
| 07 | Nuclear Watch | world (facility & front) | About this facility | Country → facility → front → energy |
| 08 | Satellite Infrastructure | orbit (orbital profile) and world (launch site) | About this asset | Operator → asset → constellation → users |
| 09 | Geopolitics News Wire | board (feed state) | What the item says | Publisher → item → records → regions |
| 10 | World Constitutions | world (jurisdiction) and timeline (history) | About this constitution | Country → constitution → topics → comparators |
| 11 | Growth Indicators | world (economy) | About these series | Region → economy → trade → commodities |
| 12 | Heads of State | leader card and world (office) | About this office-holder | Country → leader → blocs → fronts |
| 13 | Global Commodities | board (benchmark board) and world (risk premium) | About this benchmark | Complex → benchmark → chokepoints → economies |
| 14 | Global Trade | world (trade flows) | About this position | Region → economy → partners → sectors |

Maritime Choke-Points and Energy are not in the reference.

## 2. The Record tab today

`SidePanel` → `RailContent view="record"` (`src/shell/RailContent.jsx:133-188`)
dispatches by feature:

| Global modules | Component |
|---|---|
| Open Fronts, Global Intelligence, Infra, Satellite Infrastructure, World Constitutions, Growth Indicators, Global Trade, Geopolitics News Wire | Generic `RecordDetail` (`src/shell/RecordDetail.jsx`, 648 lines) |
| Alliances, Sanctions, Global Aid | Dossiers `AlliancesAnalytics.jsx`, `SanctionsAnalytics.jsx`, `GlobalAidAnalytics.jsx` (`alw-*` classes) |
| Nuclear Watch | `NuclearAnalytics.jsx` (`nww-*` classes) |
| Heads of State, Global Commodities (and Choke-Points, Energy) | **No Record tab.** `hasRail` is false for them, so `availableTabs` is `['ai']`; their own desks (`LeadersDesk`, `CommoditiesDesk`) handle selection |

`RecordDetail` renders, in order:

1. a value strip;
2. the title and a close button;
3. four meta tags;
4. provenance (Source / Source date / Last verified, `provenanceOf`);
5. "✦ Niyantran analysis";
6. a record-text summary;
7. timeline, documents, related entities and all fields;
8. for Open Fronts only, dossier sections 01–03 from `src/data/geo-conflicts.json`.

It has no Ask AI button. For Open Fronts, "Niyantran analysis" is a fixed client-side
sentence built from the row (`frontsAnalysis`). For other Global rows it appears only
when a cached brief exists, because none of their rows carries `brief`, `why_it_matters`
or `watch_for` (Global Aid alone has `brief`).

`RecordDetail` is also used outside the Global desk, including by the AI source reader
(`src/ai/RowSource.jsx`).

Tests:

- `RecordDetail.test.jsx` has one regression test.
- No test covers the Open Fronts template, provenance, or the dossier dispatch.

## 3. Data each module actually holds

These are the row fields from `server/featureFeed.mjs` and the dataset files.
"Provider" is what the footer can honestly name.

| Module | Rows | Fields (abridged) | Coordinates | Provider / as-of |
|---|---|---|---|---|
| Open Fronts | 88 | conflict_name, region, conflict_type, current_stage, intensity, trend, started, latest_development, as_of, provenance ("unconfirmed") | None on the row. `geo-conflicts.json` has lat/lon for 14 dossiers, and only **5** match a register name | Open Fronts register, as_of 07 Sep 2026, provenance unconfirmed |
| Global Intelligence | 10 | program_name, category, stage (10 distinct strings), vendor_or_origin ("Dassault Aviation, France"), detail, as_of, provenance | None. The origin country can be parsed from vendor_or_origin | Procurement register, as_of |
| Infra | 10 | name, sector, region, country (7× India), status, expected, detail | None, only country | Curated `infra-projects.json` |
| Nuclear Watch | — | facility_kind, country, status, lat, lon, operator, capacity, safeguards, latest, checked, source_label | Yes | source_label, checked |
| Satellite Infrastructure | — | provider, pad, country, net, status, lat, lon, source_label | Yes (pad) | The Space Devs |
| Alliances | — | alliance, category, structure, formed, seat, legalBasis, members_json, memberCount, milestones_json, verified, source_label | Members by name (no coordinates) | source_label, verified |
| Sanctions | — | programme, issuer, target, regime_type, sectors/instruments/trail_json, lat, lon | Target only | source_url |
| Global Aid | — | agency, requirement, funded, people_target, period, dataThrough, sectors_json, brief | Region text | source_label, dataThrough |
| Heads of State | 44 | country, office, status, term_start, next_transition, party, ideology, age, iso, last_verified | ISO code | last_verified |
| Global Commodities | 24 | commodity, group, level, change, pct | None | Benchmark provider (licence-gated feeds noted in the reference) |
| World Constitutions | 188 | country, enacted, constitution_id | None | Constitute Project |
| Growth Indicators | 20 | country, year, gdp_growth, inflation, unemployment | None | World Bank |
| Global Trade | 20 | country, year, exports_bn, trade_gdp | None | World Bank |
| Geopolitics News Wire | live | date, title, source_url, publisher fields | None | GDELT / BBC (fetched on open) |

Distributions that shape the badges:

- Open Fronts:
  - stage: active 36, under review 22, low-intensity 14, frozen 8, ceasefire fragile 8;
  - intensity: Medium 34, Low 33, High 17, Critical 4;
  - trend: Stable 43, Escalating 29, Easing 16.
- Chokepoints: 18 entries with coordinates. Their regions ("Persian Gulf", "Red Sea",
  "Black Sea") use different names from the Open Fronts regions ("Middle East",
  "Eastern Europe"), so linking them needs a documented region table.

## 4. What can be reused

- `GeoDotsMap.jsx`: a canvas world map of land dots (`landmap.json`) with points,
  tooltips and a legend. It is already used by the Conflicts, Alliances, Aid and Asset
  monitors, so it can draw the "on the map" visuals without the reference's hand-drawn
  continents.
- `openAiResearch` (`src/lib/aiDrop.js`) for "Ask AI about this <thing>".
- `provenanceOf` logic in `RecordDetail` for provider and date fallbacks.
- The four dossiers already compute rosters, programme boards, funding and facility
  status. Their data logic can feed the new layout.

## 5. Gaps and constraints for the spec

1. **Placeholders.** Many reference fields (parties, began date, quantities, delivery
   windows) are not in the data. The reference itself marks them as placeholders. In the
   product, a field is shown only when the row holds it; no "[date]" text is ever shown.
2. **Coordinates.**
   - Region-level or country-level placement needs a small curated lookup table (17
     Open Fronts regions and the countries in use). It must be labelled as approximate.
   - Exact coordinates come only from the rows that carry them.
3. **"What it touches"** needs rule-based links with documented rules:
   - same-region fronts;
   - a region → chokepoint table;
   - same vendor/origin;
   - same country/sector.

   Empty lanes read "None on record". There is no impact-analysis page.
4. **Provenance honesty.** Open Fronts and procurement rows carry
   `provenance: unconfirmed`, and the footer must say so. Licence-gated providers
   (ACLED, Barchart, Trading Economics, AIS) must not be implied.
5. **Scope of `RecordDetail`.** Non-Global desks and the AI reader keep using it
   unchanged.
