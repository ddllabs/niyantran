# Implementation plan: Law record panels (F128)

> **Status: Living.** It implements the [Law record panels spec](../specs/2026-10-13-law-record-panels.md).
> Branch `task/law-record-panels` from `main` at `537911c`. It is tracked as F128 in
> [open-work](open-work.md). It reuses the F121 kit and the F124 process
> ([National plan](2026-10-13-national-record-panels.md)).

## Approach and sequencing

**L1–L2 are sequential, done by the supervisor.**
- **L1** extends the kit (clock tile, health strip, Quick exit, `ctx.today`) and keeps the two source
  fields.
- **L2** builds the insolvency adapter, which sets the Law pattern: the four tile questions, the
  needs board, the clock and the health strip.

**L3–L4 run in parallel after L2**, each with a Sonnet task agent in a supervisor-created worktree.
Each write scope is one adapter file and its test.

**L5 is the supervisor's:** register the modules, cover dispatch with tests, run browser checks, get
an independent review on Fable, and merge locally. The push waits for the owner's go-ahead.

Supervisor-owned files:

- the kit files: `registry.js`, `RecordPanel.jsx`, `modelContract.js`, `recordPanel.css`,
  `visuals/*`;
- `RailContent.jsx`;
- `src/lib/lawPack.js`;
- `server/featureFeed.mjs` (the `parseRssOrXml` change only).

The other agent's web-search work (`task/web-search`) is not touched; `src/ai/` is outside every
write scope.

## Tasks

| Task | Owner | Content | Depends on |
|---|---|---|---|
| L1 | Supervisor | Kit: `tile.clock`, `footer.health`, `model.quick` with the host hand-off, `ctx.today`, contract rules and tests. Data: `ibbiOne` keeps `last_submission_date` (new `lawPack.test.js`); `parseRssOrXml` reads `<source>` into `publisher` (server test). | owner answers |
| L2 | Supervisor | `adapters/lawInsolvency.js`: IBBI announcements and NCLT orders | L1 |
| L3 | Sonnet | `adapters/lawSupremeCourt.js`: SC order and Orders by Topic | L2 |
| L4 | Sonnet | `adapters/lawWire.js`: the nine wire modules, one adapter with a per-module configuration (tiles' wording, needs list, callout, cite card, Quick exit) | L2 |
| L5 | Supervisor | Register all twelve; dispatch tests; browser at 375, 939 and 1440px, light and dark; no AI request on selection; Fable review; merge | L3, L4 |

Each adapter task's acceptance:

- the contract passes for every real row (the stored packs, and live-shaped wire fixtures);
- the tiles answer the four questions in order, with the clock last;
- only held fields appear, and an absent answer reads "Not on the row";
- related links exclude the record itself;
- each guard is shown to fail when its defect is restored.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A wire headline read as a court record | High | Badge, callout and tile 3 all say "coverage, not an order"; a test bans "order", "charged" and "stage" claims in wire tile values |
| A deadline shown as open when it has passed | High | `ctx.today` comparison, tested with fixed dates either side |
| The publisher change alters other feeds | Low | Field added only when `<source>` exists; explicit outlet tags still win; server test |
| Unclassified topics presented as a classification | Medium | "Unclassified" is stated, and no related link is built for it |
| Touching the web-search agent's files | Medium | `src/ai/` stays outside every write scope; the hand-off uses the existing `openAiResearch` seed |

## Verification commands

```bash
npm run lint
npm test
npx vitest run src/shell/record src/lib/lawPack.test.js
npm run build
node -e "import('./api/router.js').then(() => console.log('router import ok'))"
deno test -A --config supabase/functions/deno.json supabase/functions
```
