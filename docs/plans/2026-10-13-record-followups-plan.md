# Plan: remaining record-panel follow-ups (F122, F129)

> **Status: Living.** Owner request 2026-10-13: "plan for the rest of the phases excluding F123".
> The open items left from the record-panel work are F122 (Global data honesty follow-ups) and F129
> (ICJ and WTO registers). F123 (the AI brief) waits for AI credits (F111) and is out of scope.
> Items are tracked in [open-work](open-work.md). Findings below were re-checked against the code
> on 2026-10-13. Nothing in this plan has been built yet.

## Sequence

Bugs first, then labels, then cleanup, then new data, following the owner's order of work: fixes,
then UI changes, then AI credits (F111), then Razorpay (O6).

| Phase | Item | Content | Needs the owner |
|---|---|---|---|
| G1 | F122 | Correctness bugs on the Global desk | No |
| G2 | F122 | Labels and sources that claim more than the data holds | No |
| G3 | F122 | Map coverage and dead code | Yes: approve deletions (decision 1) |
| L1 | F129 | ICJ Proceedings as a register of the ICJ General List | Yes: approve the data (decisions 2, 3) |
| L2 | F129 | WTO Dispute Settlement as a register | Yes: approve re-sourcing (decision 4) |

G1–G3 are small and independent: one branch each, done by the supervisor with at most one Sonnet
agent, with an independent review on the batch. L1 and L2 each follow the spec, plan and review
process used for the record panels.

## G1. Correctness bugs (F122)

| Bug | Where | Fix | Guard |
|---|---|---|---|
| The Commodities search box does not filter: `groupsFrom` returns `feed.meta.groups` whenever the feed has them | `src/desks/CommoditiesDesk.jsx` | Filter the groups by the search text as the rows path does | A test types a commodity name and expects only its row |
| Global Aid prints "$2.50B" | `money()` in `src/lib/globalAid.js` | Trim trailing zeros after the decimal point ("$2.5B") | A table test: 2.5e9, 2e9, 12.3e9, 250e6 |
| Sanctions: "AUS" matches both the US and Australia | `issuerTokens` in `src/lib/sanctions.js` | Match whole tokens, not substrings | Tests for "AUS", "US", "OFAC", "EU/UK" |
| Heads of State: row `ua2` ("Ukraine (see Zelensky)") repeats `ua` | `src/data/leaders.json`, `flattenLeader` in `src/lib/globalResources.js` | Code only: `flattenLeader` drops a pointer row ("see …") whose target is in the pack; the data file is not edited | A test over the real pack: one Ukraine row |

## G2. Labels and sources that overstate (F122)

| Overstatement | Where | Fix |
|---|---|---|
| A Commodities KPI tile says "Live · API-ready", and the sources name Trading Economics and CME, though the levels are illustrative pack values | `CommoditiesDesk.jsx`; feed `links` in `server/featureFeed.mjs`; `src/data/commodities.json` note | The tile reads "Illustrative pack"; the links list only the pack's own stated basis |
| The Heads of State feed lists Wikidata and the CIA World Factbook as links, though its rows come from the embedded pack | `server/featureFeed.mjs` | List the pack as the source; keep the external links only as "for checking" |
| Heads of State names that are offices ("UK Prime Minister", "Japan PM", "Taliban (IEA)") are not flagged | `flattenLeader` | Flag a row whose name is an office, not a person, as "office, not a named holder" |
| Satellite launches: the "Source" link is the Launch Library JSON endpoint | `flattenLaunch` in `server/assetsApi.mjs` | Link the launch's readable page where the API gives one, else no link. The URL field must be checked against a live response first |
| Alliances: `bindingType` falls back to "Political declaration" and `defaultStanding` to "Full member" or "Participant" | `src/lib/alliances.js` | Fall back to "Not stated" (the record panel already ignores the fallbacks; the desk does not) |

**Acceptance:** a test for each change that fails on the old behaviour; browser check of
Commodities, Heads of State, Satellite and Alliances; `npm run lint`, `npm test`, `npm run build`
and the router import.

## G3. Map coverage and dead code (F122)

- **Map coverage.**
  - Territories on alliance rosters (Cook Islands, French Polynesia, New Caledonia, Niue,
    Montserrat) get positions in `src/shell/record/countryCentres.js`, with land tests like the
    existing ones.
  - Non-states (EU, AU, Sahrawi Arab Democratic Republic) are not places. The map caption says how
    many members are not drawn and why; no position is invented.
- **Dead code (decision 1):**
  - delete `src/desks/AssetAnalytics.jsx` (no importer);
  - delete the `.geo-holistic` rules in `src/index.css` (no desk uses them since F121);
  - delete the helpers in `alliances.js`, `sanctions.js`, `globalAid.js` and `strategicAssets.js`
    that only the retired dossier views used, after a search proves each has no importer;
  - delete `fillSiteLabel` in `src/lib/geoTip.js` if only its test calls it, and fix the comments
    that still name `NuclearSiteMap.jsx`.

## L1. ICJ Proceedings as a register (F129)

**What the stored pack holds** (`backup/LAW/F45_ICJ_Proceedings.xlsx`, read on 2026-10-13):

- 177 cases, described by the pack as the complete ICJ General List from the Court's all-cases page;
- each with the General List number, the case title as the Court writes it (contentious cases name
  the parties, for example "Kohler and Paris (France v. Islamic Republic of Iran)") and a link to
  `api.icj-cij.org/case/<n>`;
- retrieved on about 9 September 2026 (stored as a spreadsheet serial number, 46275);
- plus 15 news rows, which are left out.

The pack holds no phase, dates, orders or time-limits.

**Proposal:**

1. **Data (decision 2).** Build a new `public/data/embedded_csv/judiciary_icj_cases.json` from the
   pack: case number, title, link, snapshot date. Nothing under `backup/` is moved or edited, and the
   file's inventory is recorded in the spec. Before use, check that the link opens a readable page.
   If the API link does not, use the Court's case page, after confirming its address pattern on live
   pages.
2. **Module shape (decision 3).** The ICJ module shows the register as its table, with the live news
   search (F84) kept as a second view. Alternatively, the register only.
3. **Record panel.** A new register adapter:
   - tiles: General List number, contentious or advisory (read from the title's "(A v. B)" form,
     labelled as read from the title), parties as the title names them, and the clock "Next
     time-limit: Not on the row";
   - the needs board marks phase, orders, time-limits and opinions as not on the row;
   - the provenance is "ICJ General List (stored snapshot)" as of the snapshot date.
4. **Freshness.** The snapshot ages. A later task can refresh it from the Court's list (the Court
   adds a few cases a year).

## L2. WTO Dispute Settlement as a register (F129)

**What the stored pack holds** (`backup/LAW/F46_WTO_Dispute_Settlement.xlsx`): 641 rows, DS1–DS641,
each with the DS number and the official case-page link (`wto.org/…/ds<n>_e.htm`). **The rest is
unusable:**

- every title reads "WORLD TRADE ORGANIZATION";
- every status reads "See official current status";
- the complainant field holds scraped sentences ("the United States. This request, dated 7 October
  1997, is in respect of…").

**Proposal (decision 4):** re-source rather than publish the pack.

1. **Research (read-only).** Find whether the WTO publishes dispute data in a structured form (an
   official dataset or API). If it does not, read the case pages' title, complainant, respondent,
   current status and dates. Check the WTO website's terms of use for reuse with attribution.
2. **Build (after approval).** A one-off server-side job, rate-limited and identified, produces
   `public/data/embedded_csv/judiciary_wto_disputes.json`, with each field taken from the page and a
   blank where the page does not state it. A sample of pages is compared by hand before publishing.
3. **Module and panel.** As for ICJ:
   - tiles: DS number, complainant → respondent, current stage as the WTO states it, and the clock
     "Compliance period ends", as stated or "Not on the row";
   - a world map with the two members, now that they are known (the reference's WTO panel draws
     one).

## Decisions for the owner

1. **G3 deletions:** approve deleting the dead code listed, after the importer search.
2. **L1 data:** approve creating `judiciary_icj_cases.json` (177 cases) from the backup pack.
3. **L1 module shape:** register as the table with news as a second view (recommended), or
   register only.
4. **L2:** approve a read-only research step now, and a re-sourcing job from wto.org later, subject
   to its terms of use.

## Not in this plan

- F123 (AI brief, with F111).
- The Sector Tribunals and High Court backup packs. The Sector Tribunals pack holds at least one
  PAN and needs a personal-data check before any use.
- Splitting CAT/NCDRC and the Sector Tribunals by forum (a catalogue change the reference suggests).

## Outcome

- **G1, done `bed03ba` (2026-10-13).**
  - The four bugs are fixed, each with a test that fails on the old code (`src/lib/globalFixes.test.js`).
  - Removing the duplicate Ukraine row changed the committed desk catalogue's Heads of State count
    from 44 to 43. The file was regenerated with `scripts/build-desk-catalog.mjs`.
- **G2, done `e0c3e8d` (2026-10-13).** Labels and sources say no more than the data holds
  (`src/desks/globalLabels.test.jsx`). Since the plan:
  - the Leaders header counts the profiles listed (43), not the pack's stored 44;
  - office-named rows ("UK Prime Minister" and 17 others) now read "Not verified", as "US President"
    already did, with the country and office shown beneath.
- **Verification:**
  - lint 0; 3,624 tests; build; router import; Deno 993.
  - Browser:
    - Commodities search "brent" leaves 1 of 24 bars;
    - no "API-ready", Trading Economics or CME;
    - Global Aid prints "$2.5B";
    - Heads of State lists one Ukraine row, and its sources read "for checking".
- **G3:** waits for decision 1.
