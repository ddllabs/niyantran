# Global record panels (F121)

> **Status: Living.** Owner request 2026-10-13. Decisions on the same day: staged
> rollout; re-skin the four dossiers into the new format; add a Record tab for Heads of
> State and Global Commodities; rule-based "what it touches" links with no impact page.
> Research: [global record panels](../research/2026-10-13-global-record-panels.md).
> Plan: [plan](../plans/2026-10-13-global-record-panels.md). Branch
> `task/global-record-panels`.

## Objective

When a reader selects a record on any Global desk module, the Record tab shows one
consistent panel modelled on the owner's reference. It says what the record is, where
it sits, what it touches, and where every figure comes from. Today, eight modules
show a generic field dump, four show unrelated dossier layouts, and two have no Record
tab at all.

The reader is an analyst checking a claim. Success is three things:

- one glance answers "what is this, how serious, as of when";
- the page never shows a figure without its provider and date;
- the page never implies data the platform does not hold.

## Assumptions

1. The reference is a guide, not a pixel contract (owner: "not a hard-and-fast thing
   to follow"). We keep its anatomy, tone and honesty rules, and adapt it to the
   terminal's design tokens and side-panel width (about 400–660px).
2. **A field is shown only when the row holds it.** Reference placeholders such as
   `[date]` or `[as listed]` never appear. An absent fact is omitted, or written as "Not
   on record" where its absence matters (e.g. procurement value).
3. The "✦ Niyantran analysis" block (a fixed sentence for Open Fronts, empty for most
   other Global rows) is replaced by the panel. A cached entry brief, when one exists,
   appears as a card in 02 · About, labelled as a generated brief. **Not yet built**
   (review of batch 3, 2026-10-13): no panel shows the cached brief. The retired dossier
   views did, through `useEntryBrief`. It is open as F123, because fetching briefs
   touches the AI-credit work (F111).
4. Non-Global desks and the AI source reader keep the existing `RecordDetail`
   unchanged.
5. Maritime Choke-Points and Energy are not in the reference and stay as they are.

## Panel anatomy (shared kit)

Every Global record renders one `RecordPanelModel` through one `RecordPanel`
component:

```js
/**
 * @typedef {'red'|'amber'|'green'|'blue'|'grey'} Tone
 * @typedef {{ code?: string, l1: string, l2?: string }} Node   // graph node; l1/l2 shortened to 22 chars in the graph
 * @typedef {{
 *   title: string,
 *   meta: string[],                         // e.g. region · type
 *   badge?: { text: string, tone: Tone },   // one status badge
 *   links: { label: string, href: string }[],   // source documents; https only
 *   glance: {
 *     tiles: { label: string, value: string, sub?: string, tone?: Tone }[],   // 2–4
 *     visual?: Visual, visual2?: Visual,
 *     callout?: { tone: 'amber'|'red', text: string },
 *   },
 *   about: { label: string, rows?: [string, string][], chips?: string[], cards?: { heading: string, body: string }[] },
 *   touches?: { label: string, lanes: [string, string, string, string],
 *               nodes: { left?: Node, center: Node, right?: Node, far?: Node },   // a missing node draws "None on record"
 *               links: { title: string, detail: string, to?: { tab: string, feature: string }, row?: object }[] },   // row: a related record from ctx.rows, opened in place (batch 3)
 *   footer: { ask: string, provenance: { source: string, asOf?: string, flags?: string[] }, note?: string },
 * }} RecordPanelModel
 *
 * Every Visual carries { type, title, right?, caption? }. Registered types (visuals/index.js and
 * visuals/types.js; modelContract rejects any other type):
 *   map:      points: { lat: number, lon: number, label: string, tone?: Tone, main?: boolean, approximate?: boolean }[]
 *   timeline: steps: { label: string, detail?: string, done?: boolean, now?: boolean }[]   // at most one `now`
 *   board:    rows: { label: string, value: string, note?: string, tone?: Tone }[]   // batch 2; at least one row
 */
```

**Contract** (`modelContract.js`; every adapter test runs it over every real row). A model must
have:

- a title;
- 2–4 tiles with labels and values;
- only registered, well-formed visuals;
- https-only links;
- an About label, and no empty About rows;
- four touch lanes and a centre node, when touches exist;
- an Ask AI label;
- a provenance source **and** an as-of date, or the flag `as-of not on record`.

Banned anywhere in the model: reference placeholders (`[date]`, `[as listed on the record]`, any
`[word…]` token), and leaked `undefined`, `NaN` or a bare `null` value.

- **Adapters** are pure functions: one per module, `(row, ctx) => RecordPanelModel`.
  `ctx` holds the feed rows and the lookup tables. Adapters are unit-tested on real
  dataset rows.
- **Visuals:**
  - the map reuses `GeoDotsMap`, and approximate (region-level) positions are captioned
    as such;
  - stage timeline, value board, leader card and orbital profile are small SVG/CSS
    components;
  - the "what it touches" graph is an inline SVG of up to four nodes. An empty node
    reads "None on record".
- **Footer:**
  - "✦ Ask AI about this <thing>" calls `openAiResearch` with the row;
  - provenance names the provider and the as-of date, plus flags such as "provenance
    unconfirmed" or "not ACLED".
- **Close** (×) clears the selection, as today.
- Design:
  - terminal tokens (`--accent`, `--line`, `--panel`, `--muted`);
  - light and dark themes;
  - single column; tiles wrap to two columns below about 480px of panel width.

## Rule-based "what it touches" (no impact page)

Links are computed only from data we hold, by documented rules in `touchRules.js`:

| Module | Left | Right | Far | Cross-links |
|---|---|---|---|---|
| Open Fronts | Region | Chokepoints mapped to that region (curated region→chokepoint table) | Other fronts in the same region (count) | "Other fronts in <region>" → Open Fronts; "Chokepoints in play" → Maritime Choke-Points |
| Global Intelligence | Origin country (parsed from vendor_or_origin) | Operator ("India", the register's scope) | Same-origin programmes (count) | "Same-origin programmes" |
| Infra | Country | Sector | Same-country assets (count) | "Other assets in <country>" |
| Later batches | Per the reference lanes, using held fields only | | | |

A link that resolves to nothing is shown as "None on record", never invented. The
"Open full impact analysis" button is omitted.

### Batch 2 decisions (2026-10-13, supervisor)

- **One new visual, the value board**, for Growth Indicators, Global Trade, Global Commodities and
  Geopolitics News Wire. The orbit and leader-card visuals in the reference are not built: launch
  rows hold no orbital data, so an orbit profile would imply facts the platform does not hold, and
  a leader card would repeat the tiles.
- **Country positions.** Constitutions, Growth, Trade and Heads of State place a country on the map
  from a curated table of country centres, captioned approximate. A country missing from the table
  gets no map, never a guessed one.
- **Source-status rows** ("Source offline or empty") are not records. They keep the old view on
  every module, registered or not.
- **Touch lanes** use only the fields in the module's own feed rows:

| Module | Left | Centre | Right | Far |
|---|---|---|---|---|
| Satellite Infrastructure | Provider | Launch | Launch site | Same provider (count) |
| World Constitutions | Country | Constitution | Enacted (decade) | Same decade (count) |
| Growth Indicators | Economy | Series | Rank on GDP growth | Same year (count) |
| Global Trade | Economy | Exports | Rank on exports | Openness (trade share of GDP) |
| Geopolitics News Wire | Publisher | Story | Published | Same publisher (count) |
| Heads of State | Country | Leader | Party | Same ideology (count) |
| Global Commodities | Group | Benchmark | Move | Same group (count) |

- **Licence and liveness cautions.** Global Commodities levels are illustrative pack values, and the
  panel says so; it never names a licence-gated provider as its source. News Wire stories are
  reporting search results (GDELT) or BBC World RSS, not official records.

## Rollout (staged)

| Batch | Modules | Note |
|---|---|---|
| 1 | Shared kit, Open Fronts, Global Intelligence, Infra | The supervisor builds it; it fixes the contract. Owner review on production. |
| 2 | Satellite Infrastructure, World Constitutions, Growth Indicators, Global Trade, Geopolitics News Wire, Heads of State, Global Commodities | Adds the Record tab for Heads of State and Commodities (`hasRail` change) |
| 3 | Alliances, Sanctions, Global Aid, Nuclear Watch | Re-skins the dossiers: reuse their data logic in the new layout and retire the old `alw-*`/`nww-*` record markup |

## Commands

```bash
npm run lint
npm test
npx vitest run src/shell/record
npm run build
```

The router import check is not needed (no `api/` or `server/` change is planned).

## Project structure

- `src/shell/record/`:
  - `RecordPanel.jsx`, `recordPanel.css`;
  - `visuals/` (map, timeline, board, leader, orbit, touch graph);
  - `adapters/<module>.js`;
  - `registry.js` (feature → adapter);
  - `geoLookup.js` (curated region and country positions, labelled approximate);
  - `touchRules.js`.
- Integration: `src/shell/RailContent.jsx` (dispatch).
- Batch 2 also touches `TerminalShell.jsx` / `sidePanelModel.js` for the two new
  Record tabs.
- Tests sit beside each file (`*.test.js[x]`), following the repo's Vitest pattern.

## Testing strategy

- **Adapters (unit):**
  - every row of the real dataset yields a valid model;
  - no placeholder text such as `[`…`]` appears;
  - tiles number 2–4;
  - provenance always has a source;
  - flags are present when `provenance` is unconfirmed;
  - only https links are allowed.
- **RecordPanel (render):** each section appears only when its model part exists;
  empty touch nodes read "None on record"; Ask AI dispatches the row.
- **Dispatch:**
  - registered features render `RecordPanel`;
  - unregistered features still render `RecordDetail`;
  - the AI reader is unchanged.
- **Browser:** 1440, 939 and 375px; light and dark; select records in each batch
  module; no sideways scroll; Ask AI opens the AI tab with the row.
- **Tests first.** For each new guard, show that it fails before the change.

## Boundaries

- **Always:**
  - name provider and as-of on every figure;
  - omit absent facts;
  - label approximate positions and schematic maps;
  - keep `RecordDetail` behaviour for everything outside this scope.
- **Ask first:**
  - any server or API change;
  - adding a dependency;
  - changing Choke-Points or Energy;
  - building an impact-analysis page;
  - wiring a licence-gated source.
- **Never:**
  - imply event counts, prices or positions the data does not hold;
  - show placeholder text;
  - push or deploy without the owner's go-ahead.

## Success criteria

1. Selecting a record on each module of the current batch shows the five-part panel,
   with 2–4 glance tiles, a module visual, About, What it touches (rule-based or "None
   on record") and a footer with Ask AI and provenance.
2. No rendered panel contains placeholder text or a figure without its provider and
   date.
3. Records from non-Global desks render exactly as before; the existing tests pass.
4. The panel works at 375px and 939px without sideways scroll, and in dark mode.
5. Lint, all tests and the build pass. The owner accepts each batch on production
   before the next ships.

## Exclusions

- An impact-analysis page.
- New data sources or server changes.
- Choke-Points and Energy panels.
- Changes to non-Global record views.

## Batch 3 decisions (2026-10-13)

- **Scope (owner, 2026-10-13):** include a module only if the reference has a panel for it. The
  reference has panels for Alliances, Sanctions, Global Aid and Nuclear Watch, and none for Maritime
  Choke-Points or Energy (it only mentions them inside other panels), so those two stay as they are.
- **Visuals follow the reference:**

| Module | Visual | Visual 2 |
|---|---|---|
| Alliances | Member states (map, members placed at approximate country centres) | Roster history (timeline from the milestones) |
| Sanctions | Who listed whom (map: issuers and the target) | Who has listed what (board) |
| Global Aid | Where the appeal lands (map) | none |
| Nuclear Watch | Facility on the map (exact facility coordinates) | none |

- **Touch lanes** start from the reference and keep only what the rows hold; a lane with nothing
  behind it reads "None on record":

| Module | Left | Centre | Right | Far |
|---|---|---|---|---|
| Alliances | Region or seat | Bloc | Members (count) | Fronts touching members (from Open Fronts, if the rows allow) |
| Sanctions | Issuing authority | Programme | Sectors | Listed entities or instruments |
| Global Aid | Agency | Appeal | Countries or region | Sectors |
| Nuclear Watch | Country | Facility | Front (if the row names one) | Operator or capacity |

- **Proven figures carry over.** Each adapter reuses the data logic already in `src/lib` (rosters,
  programme boards, funding, facility status) rather than recomputing it.
- **Retirement:** the four dossier record components (`AlliancesAnalytics`, `SanctionsAnalytics`,
  `GlobalAidAnalytics`, `NuclearAnalytics`) are used only by the Record tab, so they are removed
  with their dispatch in `RailContent.jsx`. Their `alw-*` and `nww-*` CSS classes stay, because the
  desk monitors share them.

## Open questions

None.
