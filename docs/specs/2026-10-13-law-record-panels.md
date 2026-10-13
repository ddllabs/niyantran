# Law record panels (F128)

> **Status: Living.** Owner request 2026-10-13 ("go ahead with Law now, same process"). As for
> National, the reference file is a client mockup: its placement, look and feel, and the kind of
> information it shows are binding; its figures are not. Research:
> [Law record panels](../research/2026-10-13-law-record-panels.md). Plan:
> [plan](../plans/2026-10-13-law-record-panels.md). Branch `task/law-record-panels`. The shared
> anatomy, contract and kit are those of the
> [Global](2026-10-13-global-record-panels.md) and [National](2026-10-13-national-record-panels.md)
> record panels specs.

## Objective

When a reader selects a record in any of the twelve Law modules, the Record tab shows the same
five-part panel as Global and National, in the Law reference's form. The panel answers four
questions, in this order:

1. is it operative;
2. who decided it, under what power;
3. what it requires, and of whom;
4. what the clock is.

It also states plainly what a lawyer would need that the row does not hold.

Success means three things:

- a practitioner sees at once whether the row is a record or only news coverage;
- no figure appears without its source and date;
- no deadline, holding or status is asserted that the source does not state.

## Assumptions

1. **The reference is a layout and content guide.** Its figures, its bracketed placeholders and its
   placeholder maps are never copied.
2. **All twelve modules are in scope.** The reference covers every module in the catalogue.
3. **Saved AI briefs only, as for National (owner decision of 2026-10-13, F123).** Selecting a Law
   record makes no model call. Today `RecordDetail` generates a brief on every Law selection; that
   behaviour is not carried over.
4. **The reference's review notes are not reader content.** Examples: "Split this module in two",
   "rename the module a watch list". Where a note describes a real limit (unclassified topics, broad
   searches, coverage instead of orders), the panel states that limit as a fact.
5. **No deadline is computed from statute.** A clock shows only a date the source states. A
   limitation period or appeal window worked out from the law would assert a deadline that the
   source never stated.

## Panels

Three panel families cover the twelve modules.

### Tiles

The four tiles always ask the four questions in order, in the forum's own wording. The fourth tile
is the clock and is tinted. A tile whose answer is not held reads "Not on the row", or "Not checked"
for good-law status, never a guess.

| Module | 1 Operative | 2 Who decided, power | 3 Requires, of whom | 4 Clock |
|---|---|---|---|---|
| IBBI announcement | Process (CIRP / Liquidation / Voluntary Liquidation) | Insolvency professional | Applicant | Claims due: the stated last date, marked Closed when past |
| NCLT order | Order as recorded (remarks, e.g. "Admission – Final Order") | NCLT, with the case number as written (the bench is not decoded) | Corporate debtor | Next date: Not on the row |
| SC order | Order of the Supreme Court, dated | Diary number | Topic as classified ("Unclassified" stated as such) | Still good law? Not checked (no citator) |
| Orders by Topic | Topic | Orders under this topic in the table (counted) | Order date | Still good law? Not checked |
| Wire modules (9) | Published (date) | Publisher (from the source) | "Coverage, not an order" | The forum's clock (for example "Next date", "Compliance by", "Next time-limit"): Not on the row |

### Other parts of the panel

| Module | Visual | Needs board ("What a lawyer needs · what this row has") | Lanes |
|---|---|---|---|
| IBBI announcement | timeline "Where this matter stands": public announcement and claims deadline, from held dates only | Corporate debtor, process type, IP, announcement date, IBBI source, announcement PDF, claims deadline, CIN, NCLT bench, each marked from the row | Authority → announcement → entity → sector (none on record) |
| NCLT order | none | Case number, order type, corporate debtor, order date, order PDF, bench, CIN, NCLAT appeal | Tribunal → order → entity → sector |
| SC order | none | Citations, coram, result, provisions, holding, treatment, order PDF | Court → order → topic → later cases (none on record) |
| Orders by Topic | board "Orders in the table by topic": counts, this topic marked | as for SC order | Court → topic → order → later cases |
| Wire modules | none (no parties or situations are held, so no map) | the forum's list from the reference, all marked from the row (in practice "Not on the row") | Publisher → item → forum → entities (no record linked) |

**Shared rules:**

- **Header:** title as the source prints it, meta, one status badge ("Live registry" for stored
  records, "Coverage — not an order" for wire items), and the PDF or source link (https only).
- **Callout:** the module's main limit, stated plainly. Examples:
  - NCLAT is not in the pack;
  - 208 of 220 SC topics are unclassified;
  - SC PDFs may need a court session;
  - a wire item matched a broad keyword search and may not concern this forum.
- **02 The pointers:** the held fields as key–value rows, the saved-AI-brief card, a "Summary as
  published" card for wire items (plain text, quoted), and an "If you cite this" card.
- **Quick exit** (owner decision 1): document buttons as in the reference. Each one opens AI
  Research with that request as a draft and the record attached. Nothing runs until the reader
  sends it.
- **Footer:**
  - "Ask AI about this matter / order / item";
  - provenance: source, plus as-of or the flag "as-of not on record";
  - a health strip computed from the rows on hand, for example "Rows 434 · Claims date on row 66%";
  - the module note.
- **Related records** open in place:
  - the same entity across NCLT and IBBI (66 debtors appear in both);
  - the same insolvency professional's matters;
  - the same SC topic, except "Unclassified".

## Kit changes (supervisor)

1. **Clock tile.** `tile.clock` tints the tile. The contract allows at most one, and only as the
   last tile.
2. **Health strip.** `footer.health`: up to four `[label, value]` pairs rendered beside the
   provenance. The contract requires both parts of each pair to be non-empty.
3. **Quick exit.** `model.quick`: up to four `{ label, prompt }`. `RecordPanel` renders the row, and
   the host calls `openAiResearch({ row, attachFeed: true, prompt })`. The prompt only fills the
   chat draft (`AiPanel` `setDraft`).
4. **Today in ctx.** The host passes `ctx.today` (an ISO date), so adapters stay pure and testable
   when they mark a deadline as passed.
5. **Registry.** All twelve Law modules, matched on the judiciary tier.

## Owner decisions (2026-10-13)

1. **Quick exit hands off to AI Research.** The buttons look as in the reference. A click opens AI
   Research with the request drafted and the record attached. No model call happens until the
   reader runs it.
2. **Two source fields kept, in this batch.** Each only shows more of what the source states.
   - **IBBI claims deadline.** `ibbiOne` in `src/lib/lawPack.js` keeps `last_submission_date`, so
     the clock tile and the timeline have a date. Both the server and the client fallback use this
     shaper.
   - **News publisher.** `parseRssOrXml` in `server/featureFeed.mjs` reads Google News's `<source>`
     element into `publisher`. Feeds without it are unchanged, and an explicit outlet tag set
     elsewhere still wins.
3. **Not now:**
   - narrowing the broad news searches (F84 stays open);
   - the ICJ and WTO registers from the backup packs, logged as a later data task.
4. **Rollout:** one batch, as for National.

## Commands

```bash
npm run lint
npm test
npx vitest run src/shell/record src/lib/lawPack.test.js
npm run build
node -e "import('./api/router.js').then(() => console.log('router import ok'))"
deno test -A --config supabase/functions/deno.json supabase/functions
```

The Deno suite runs because `src/lib/` changes.

## Testing strategy

As for National:

- every adapter's model passes `contractProblems` for every real row;
- each guard is shown to fail when its defect is restored;
- dispatch tests prove all twelve Law modules render `RecordPanel`, and the State and National
  modules are untouched;
- `lawPack.test.js` proves that the deadline survives shaping;
- a server test proves that the publisher is read from `<source>`;
- browser checks at 375, 939 and 1440px, in light and dark, on live data;
- no `/api/ai/*` request on selection;
- an independent review before merge.

## Boundaries

- **Always:**
  - name the source and as-of on every figure;
  - mark wire items as coverage;
  - mark a passed deadline as closed;
  - print names exactly as the source prints them.
- **Ask first:**
  - any other server or data change;
  - using the backup packs;
  - changing the catalogue (splitting modules).
- **Never:**
  - show the reference's placeholder or review-note text;
  - compute a deadline from statute;
  - describe a wire item as an order, a charge, a holding or a stage;
  - push without the owner's go-ahead.

## Success criteria

1. Each of the twelve modules shows the five-part panel, with four tiles (the clock last and tinted),
   the needs board, the callout, the pointers, Quick exit, What it touches, and a footer with
   provenance and health.
2. No rendered panel contains placeholder text, a figure without a source and date, or a label that
   overstates its data.
3. Non-Law desks render exactly as before.
4. Lint, all tests, the router import and the build pass. The owner accepts on production.
