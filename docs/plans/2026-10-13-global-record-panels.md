# Implementation plan: Global record panels (F121)

> **Status: Living.** It implements the
> [global record panels spec](../specs/2026-10-13-global-record-panels.md). Branch:
> `task/global-record-panels` from `main` at `7faf3a1`. Tasks are tracked as F121 in
> [open-work](open-work.md), which is the repository's single tracker (no
> `tasks/todo.md`).

## Approach and sequencing

**Batch 1 is sequential, done by the supervisor.** It creates the shared contract
(`RecordPanelModel`, the visuals, the lookup tables and the touch rules). Parallel work
before that contract exists would multiply integration ambiguity
(`coordination.md` § Sequential and parallel work).

**Batches 2 and 3 run in parallel with sub-agents** once batch 1 has landed and the
contract is fixed:

- each module adapter (and any new visual it needs) is a disjoint write scope;
- the supervisor creates one worktree per task, dispatches with
  `docs/agents/onboarding.md`, then reviews, verifies and commits;
- **supervisor-owned files** (no task agent edits them):
  - `registry.js`, `RecordPanel.jsx`, `modelContract.js`, `recordPanel.css`;
  - `visuals/index.js`, `visuals/types.js`;
  - `RailContent.jsx`, `TerminalShell.jsx`, `sidePanelModel.js`.

  A task that needs a new visual adds its own component, with its own CSS file
  imported by it, and the supervisor registers it;
- at most 3–4 agents run at once, to keep reviews prompt.

Every task is test-first, and every phase ends with a checkpoint.

## Architecture decisions

- **Adapters are pure** (`row, ctx → model`). They are testable on real dataset rows
  without React, and new modules plug in without touching the renderer.
- **The map reuses `GeoDotsMap`** (land-dot canvas, already in four monitors). The
  reference's hand-drawn continents are not copied. Region-level positions come from a
  curated table and are captioned "approximate".
- **The registry gates the switch.** Only registered features use `RecordPanel`, so
  non-Global desks and the AI reader keep `RecordDetail` untouched.
- **Touch rules are explicit tables** (region → chokepoints, origin parsing), each
  tested. Unmatched means "None on record".

## Batch 1 tasks (supervisor, sequential)

### T1: Record panel renderer and styles

- **Acceptance:**
  - `RecordPanel` renders header, 01 glance (tiles, optional visuals and callout),
    02 about, 03 touches and footer from a model;
  - absent parts are omitted;
  - Ask AI calls `openAiResearch` with the row;
  - light and dark tokens are used.
- **Verify:** `npx vitest run src/shell/record/RecordPanel.test.jsx`; lint.
- **Files:** `src/shell/record/RecordPanel.jsx`, `src/shell/record/recordPanel.css`,
  `src/shell/record/RecordPanel.test.jsx`. Size M. Depends on: none.

### T2: Visuals (map, stage timeline, touch graph)

- **Acceptance:**
  - `PanelMap` wraps `GeoDotsMap` with labelled points and a caption, including
    "approximate" when any point is;
  - `StageTimeline` marks done and now;
  - `TouchGraph` draws up to four nodes and writes "None on record" for missing ones;
  - all are accessible (`role="img"` and labels).
- **Verify:** focused tests; lint.
- **Files:** `src/shell/record/visuals/{PanelMap,StageTimeline,TouchGraph}.jsx` and
  tests. Size M. Depends on: T1 (styles).

### T3: Lookup tables and touch rules

- **Acceptance:**
  - `geoLookup` resolves all 17 Open Fronts regions and the countries used by the
    batch 1 data to approximate positions;
  - `touchRules` maps the Open Fronts regions to the curated chokepoints, parses
    origin countries from `vendor_or_origin`, and counts same-region, same-origin and
    same-country records;
  - unknown input returns empty.
- **Verify:** focused tests over the real datasets.
- **Files:** `src/shell/record/{geoLookup,touchRules}.js` and tests. Size S–M.
  Depends on: none.

### T4: Open Fronts adapter

- **Acceptance:** for all 88 rows:
  - tiles are Intensity, Trend, Type and Last verified (as of);
  - the badge comes from stage (active red, ceasefire fragile amber, frozen grey, and
    so on);
  - the map uses the dossier coordinates where a name matches, otherwise the region,
    marked approximate;
  - the editorial callout is shown;
  - About holds Began (`started`) and the latest development;
  - touches follow T3;
  - provenance shows the register, as of, and "provenance unconfirmed";
  - no placeholders.
- **Verify:** focused tests on the real dataset.
- **Files:** `src/shell/record/adapters/openFronts.js` and test. Size S. Depends on:
  T3.

### T5: Global Intelligence adapter

- **Acceptance:** for all 10 rows:
  - tiles are Stage, As of, Category and Value ("Not on record");
  - a stage timeline normalises the 10 stage strings to the canonical steps;
  - the map shows origin → India (approximate);
  - About holds Vendor and the programme note;
  - touches follow T3;
  - provenance as T4.
- **Verify:** focused tests.
- **Files:** `src/shell/record/adapters/globalIntelligence.js` and test. Size S.
  Depends on: T2, T3.

### T6: Infra adapter

- **Acceptance:** for all 10 rows:
  - tiles are Status, Expected, Sector and Country;
  - the map shows the asset's country (approximate);
  - About holds Region and the detail;
  - touches show same-country assets and sector;
  - provenance names the curated register;
  - no placeholders.
- **Verify:** focused tests.
- **Files:** `src/shell/record/adapters/infra.js` and test. Size S. Depends on: T3.

### T7: Registry and dispatch

- **Acceptance:**
  - `registry.js` maps the three features to their adapters;
  - `RailContent` renders `RecordPanel` for registered features and `RecordDetail` for
    all others;
  - the AI reader is unchanged;
  - existing tests pass.
- **Verify:**
  - `npm test`, lint, build;
  - browser check at 1440, 939 and 375px, light and dark: select records in all three
    modules, check that Ask AI opens with the row, and check that a National record
    still uses the old view.
- **Files:** `src/shell/record/registry.js` and test, `src/shell/RailContent.jsx`.
  Size S–M. Depends on: T1–T6.

### Checkpoint: batch 1

- All gates pass and the browser evidence is recorded.
- Merge locally, push with the owner's go-ahead, then owner review on production.
- Fold any feedback into the spec before batch 2.

## Batch 2 tasks (parallel sub-agents after batch 1 lands)

Batch 1 landed at `a62c2bb`. Batch 2 branches from `main` as
`task/global-record-panels-b2`.

**T7b (supervisor, first, sequential):** the shared pieces the adapters inherit, so no task agent
edits a shared file:

- the value-board visual (`visuals/ValueBoard.jsx`), registered in `visuals/index.js` and
  `visuals/types.js`, with its shape checked by `modelContract.js`;
- source-status rows keep the old view (`RailContent.jsx`);
- the batch 2 decisions in the spec (no orbit or leader visual, country centres, touch lanes).

**Then one task per module**, each in a supervisor-created worktree under `.claude/worktrees/`, on
a `task/f121-<module>` branch from the T7b commit. Each write scope is the adapter and its own test
only: `src/shell/record/adapters/<module>.js` and `<module>.test.js`. Task agents run on Sonnet;
the supervisor reviews each diff.

| Task | Module | Visual | Wave |
|---|---|---|---|
| T8 | Satellite Infrastructure | launch-site map (exact pad coordinates) | 1 |
| T9 | World Constitutions | country map (approximate) | 2 |
| T10–T11 | Growth Indicators and Global Trade (one agent, same World Bank shape) | value board, country map | 1 |
| T12 | Geopolitics News Wire | value board (story facts) | 2 |
| T13 | Heads of State | country map | 2 |
| T14 | Global Commodities | value board (illustrative levels) | 1 |
| T14b | Country centres for the maps | none (`geoLookup.js` data and test) | 1 |

At most four agents run at once.

After those:

- **T15 (supervisor):** register them, and enable the Record tab for Heads of State
  and Commodities (`hasRail`), with tests.
- **Checkpoint:** as for batch 1.

## Batch 3 tasks (parallel sub-agents after batch 2 lands)

| Task | Module |
|---|---|
| T16 | Alliances |
| T17 | Sanctions |
| T18 | Global Aid |
| T19 | Nuclear Watch |

- **Scope of each:** move the dossier's data logic into an adapter, keep its proven
  figures, and retire its record markup.
- **T20 (supervisor):** register them, remove the dossier dispatch, and run the
  regression tests.
- **Checkpoint:** owner review.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Maps imply false precision | High | Use exact coordinates only from rows that carry them; region positions are captioned "approximate"; the map caption says it is schematic |
| Touch rules read as real causal links | Medium | Label the lanes as "on record" relations; documented rules only; empty means "None on record" |
| Breaking non-Global record views | Medium | Registry gate; dispatch tests; National record browser check |
| Side-panel width crowds the tiles | Low | Tiles wrap to two columns; tested at 375 and 939px |
| Parallel agents diverge in style | Medium | The batch 1 contract and kit are fixed first; adapters return data only, never markup |

## Verification commands

```bash
npm run lint
npm test
npx vitest run src/shell/record
npm run build
```

## Review of batch 1 (2026-10-13)

An independent code-reviewer agent (model Fable) reviewed `c47bad4`. Fixes:

- **Must fix before merge, all done with tests that failed first:**
  1. Open Fronts drew 9 of 14 dossier fronts twice. Fixed with case-insensitive matching, a
     `SAME_AS` / `PART_OF` alias table, and exclusion of the row's own or parent dossier from
     the context markers.
  2. The tile-wrap container query had no container (`.rp { container-type: inline-size }`).
  3. The contract passed visuals the renderer drops. It now validates registered types (map,
     timeline) and their shapes, and the visuals registry moved to supervisor-owned
     `visuals/index.js`.
  4. The contract now requires an as-of date (or "as-of not on record"); Infra falls back to the
     register's own date.
- **Also done before batch 2:**
  - `originCountry` reads the last comma segment exactly, so "Indian Navy" is no origin;
  - graph labels are shortened to 22 characters with a tooltip;
  - dark-theme contrast for the Ask AI button and the graph;
  - the placeholder rule narrowed so prose such as "null and void" passes;
  - the About section is hidden when empty;
  - the Global Intelligence footer wording.
- **Deferred:** memoising map points (performance), and replacing the constant "Value — Not on
  record" tile.
- **Re-review of `a3735e3`:** all four must-fixes resolved, no regressions, ready to merge. Its one
  nit, a prototype-inclusive visual lookup that printed "[object Undefined]" for a type such as
  `constructor`, is closed with `Object.hasOwn` and a test that failed first.
