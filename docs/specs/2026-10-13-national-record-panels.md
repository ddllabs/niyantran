# National record panels (F124)

> **Status: Living.** Owner request 2026-10-13: give the National desk the same record-panel
> makeover as Global, by the same process. The reference files are client mockups: their placement,
> look and feel, and the kind of information they show are binding; their figures are not. Research:
> [National record panels](../research/2026-10-13-national-record-panels.md). Plan:
> [plan](../plans/2026-10-13-national-record-panels.md). Branch `task/national-record-panels`.
> The shared anatomy, contract and kit are those of the
> [Global record panels spec](2026-10-13-global-record-panels.md).

## Objective

When a reader selects a record in one of the eight National modules that the reference covers, the
Record tab shows the same five-part panel as Global. The panel says:

- what the record is;
- where it stands (stage, date, house);
- what it touches (ministry, sectors, named companies, constituency);
- where every figure comes from.

The other nine National modules keep their current record views.

Success means three things:

- the panel answers "what is this, where does it stand, as of when" at a glance;
- no figure appears without its source and date;
- no field claims more than the data holds.

## Assumptions

1. **The reference is a layout and content guide.** Its figures and bracketed placeholders are never
   copied. A field appears only when our row or analysis pack holds it; otherwise it is omitted, or
   reads "Not on record" where its absence matters (for example, a question's answer).
2. **Scope is the eight reference modules** (owner's rule for Global: include a module only if the
   reference has a panel for it):
   - Bill Passage Probability Index
   - Parliamentary Question Database
   - Policy Pipeline Tracker
   - Regulatory Body Watch
   - Cabinet Decisions
   - MP Profiles & Performance
   - Candidate Affidavit Database
   - National Morning Brief
3. **The reference's review notes are not reader content.** These are the cards badged "Gap", "Fix"
   or "Split required" and notes such as "filtering is the whole fix". The backend fixes they point
   to are recorded as open work, not built here.
4. **No server or data changes in this feature.** Cabinet filtering, a house column for MPs,
   individual case listings and question answers are separate tasks.
5. **Policy Intelligence Graph is excluded.** It stays full-screen without a Record tab.

## Panels

The visual types are the existing kit's: `timeline`, `board`, `map`, plus touch lanes and
related-record links. Lanes follow the reference, and a lane with nothing behind it reads "None on
record".

| Module | Tiles (held fields only) | Visual | Lanes |
|---|---|---|---|
| Bills | Stage, Introduced, House; plus passage probability, precedent and days in stage from the analysis pack, each labelled for what it is | timeline "Stage history": the bill's own stage and dates where held; earlier steps implied, not dated | Ministry → bill → sectors & segments → named companies (from `buildRecordModel`) |
| Questions | Tabled, Ministry, Asked by, Type (starred or unstarred) | timeline "Question lifecycle": tabled → answer, with "answer not on record" | Ministry → question → sectors & segments → named companies |
| Pipeline | Stage, Reported, Ministry | board: what the row's stage holds. For a live PIB release the board says it is a press release, not a stage. | Source → item → instrument (if held) → sectors |
| Regulatory | Issued, Regulator (when held), Action type (when held) | timeline: this notice in the window of the rows on hand, labelled as a rolling window, not an archive | Regulator → instrument → entity classes (if held) → sectors |
| Cabinet | Date, Ministry; "Decision type" and "Outlay" only if held | board "What the feed served today": the feed's own make-up. It does not label a press release as a decision. | Ministry → decision → sectors → states (if held) |
| MP Profiles | Questions asked, Committees, State; attendance, debates and MPLADS shown as "Not on record" because the reader expects them | none, or a board of register counts | Party → member → constituency → committees |
| Affidavits | Declared assets, Liabilities, Criminal cases (as declared), Education | none | Party → candidate → constituency → outcome (if held) |
| Morning Brief | Section, Published, Source, Window | board "Section status" | Publisher → item → records → sectors |

**Shared rules:**

- **Header:** title, meta, one status badge, and the record's PDF and source links (https only).
- **02 About:** the saved-AI-brief card (F123) and the analysis pack's authored brief, changes and
  watch-for where held, labelled as register analysis.
- **Footer:** "Ask AI about this <thing>", provenance (source, as-of or the flag
  `as-of not on record`), and module caveats from the LIMITS list in
  `src/lib/nationalLandingSummary.js`. In particular:
  - affidavit figures are "as declared, not verified" and licence-restricted;
  - MP counts are register counts, not a ranking;
  - Cabinet and Pipeline are a press feed.
- **Related records** open in place: the same ministry's bills, the same member's questions, and
  the same constituency's candidates.

## Kit changes (supervisor)

- **Panel host loads the National packs.** The analysis map for the module and the ontology are
  loaded, as `BillRecordPane` does today, and passed in `ctx` (`ctx.packs = { analysis, ontology }`).
  Adapters stay pure and synchronous. Until the packs load, the panel renders without the
  pack-derived parts.
- **Registry covers the eight National modules.** `RailContent` sends a registered National
  module's records to `RecordPanel` instead of `NationalRecord`. The other modules still reach
  `NationalRecord`.

## Owner decisions (2026-10-13)

1. **AI briefs: saved only.** The National panels read saved briefs, as Global does (F123). Selecting
   a record makes no model call. The auto-generation in `BillRecordPane` is not carried over;
   revisit it with AI credits (F111).
2. **Rollout: one batch,** on the supervisor's recommendation: N1–N2, then N3–N9 in parallel, one
   review, one push for owner review on production.
3. **Backend fixes, as separate tasks after the panels.** Each must keep the app truthful: it may
   only show more precisely what the source says, never add facts.
   - **F125 Cabinet filter:** show only PIB items that the source itself marks as Cabinet decisions.
     If PIB holds no reliable marker, stop and ask the owner.
   - **F126 MP house and parties:** the house is derived from each member's own source link
     (`/ls/` or `/rs/`); party names are normalised for display, with the original kept.
   - **Affidavit case listing: blocked.** The rows hold one count per candidate. Individual cases
     need a richer source, and MyNeta/ADR restrict redistribution, so it is not built. It is
     logged in open-work.

## Commands

```bash
npm run lint
npm test
npx vitest run src/shell/record
npm run build
```

## Testing strategy

As for Global:

- every adapter's model passes `contractProblems` for every real row;
- each guard is shown to fail when its defect is restored;
- dispatch tests prove that registered modules render `RecordPanel` and the other nine still render
  `NationalRecord`;
- browser checks at 375, 939 and 1440px, in light and dark, on live data;
- an independent review before merge.

## Boundaries

- **Always:**
  - name the source and as-of on every figure;
  - label a derived or self-declared figure for what it is;
  - keep the other nine modules' views unchanged.
- **Ask first:** any server, data or pack change; changing AI generation behaviour beyond the
  owner's answer to question 1.
- **Never:**
  - show the reference's placeholder or review-note text;
  - present "passage probability" as a forecast where it is an outcome or a base rate;
  - push without the owner's go-ahead.

## Success criteria

1. Each of the eight modules shows the five-part panel, with 2–4 tiles, its visual, About, What it
   touches, and a footer with provenance.
2. No rendered panel contains placeholder text, a figure without a source and date, or a label that
   overstates its data.
3. The other nine National modules, and all non-National desks, render exactly as before.
4. Lint, all tests and the build pass. The owner accepts on production.
