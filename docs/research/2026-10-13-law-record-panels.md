# Law record panels: reference, current state and data inventory

> **Status: Historical (2026-10-13).** This is a read-only review by the supervisor for the Law
> record panels (F128). Sources: the owner's reference file
> `~/Downloads/nter-law-record-panels_4 (1).html` (not in the repo), a data inventory by a read-only
> sub-agent, and reads of the code. Nothing was changed.
> Companions: [Global](2026-10-13-global-record-panels.md) and
> [National](2026-10-13-national-record-panels.md) record panels research.

## 1. The reference

The Law reference uses the same record-panel kit and the same five parts as Global and National:
header, 01 at a glance, 02 the pointers, 03 what it touches, and a footer with Ask AI and
provenance. It adds five elements of its own:

1. **Four fixed tile questions, in order:**
   - is it operative;
   - who decided it, under what power;
   - what it requires, and of whom;
   - what the clock is.

   The wording follows each forum (a bench, a chamber, a compliance date). The fourth tile is always
   the clock, and it is tinted so that the eye finds the deadline first.
2. **A "What a lawyer needs · what this row has" board** on every panel. It lists the fields a
   practitioner needs and tags each one "on the row", "partial" or "absent". Its header gives the
   count, for example "5 of 9 on the row".
3. **A callout** (amber or red) that states the module's main limit plainly.
4. **"Quick exit" document buttons**, for example "CIRP / claim note", "Limitation & deadline sheet"
   or "Case note". They imply AI-drafted documents.
5. **A health strip** beside the source line, for example "Rows 434 · Claim date parsed x%".

The reference sorts the twelve modules into three states, and says so on each panel:

| State | Modules | What the reference shows |
|---|---|---|
| Live registry | 01 NCLT / NCLAT | A real IBBI record (Kobelco, voluntary liquidation) |
| Planned, no rows | 02 Supreme Court, 03 High Court, 04 Orders by Topic | The target record, with bracketed placeholders |
| News wire | 05 District Court, 06 NGT, 07 CAT & NCDRC, 08 Judge Profiles, 09 ICC, 10 ICJ, 11 WTO, 12 Sector Tribunals | Badge "Coverage — not an order", a needs board marked absent throughout, a red callout, and a "If you cite this" card |

Owner, 2026-10-13 (for National, and the same holds here): the reference files are client
mockups. Their data may be inaccurate. What counts is the placement, the look and feel, and the kind
of information the reader should see. As with National, several panels carry review notes for the
team rather than reader content ("Split this module in two", "rename the module a watch list"). The
ICC, ICJ and WTO panels also draw world maps whose markers are all placeholders.

## 2. The catalogue and the mapping

The live list is `FEATURE_ORDER.judiciary` (`src/desks/catalog.js`). It maps one to one onto the
reference; no Law module is missing.

| Ref | Reference module | App module | What we actually hold |
|---|---|---|---|
| 01 | NCLT / NCLAT (Insolvency) | NCLT / NCLAT (Insolvency) | Stored: 148 NCLT orders + 286 IBBI announcements = 434 |
| 02 | Supreme Court Orders & Judgments | Supreme Court Order & Judgment Feed | Stored: 220 SC orders (not "planned") |
| 03 | High Court Case Tracker | UP High Court (Allahabad) Order Feed | Live Google News search |
| 04 | Orders by Topic | Order Archive by Topic (Cross-Court) | The same 220 SC orders, sorted by topic (not "planned") |
| 05–12 | the eight wire modules | same names (Judge Profiles is "HC Judge Profiles & Bench Analytics") | Live Google News search, then GDELT |

## 3. Where the rows come from

**Server.** `server/featureFeed.mjs`, judiciary branch:
- SC, Topic and NCLT come from the embedded packs through `lawRows` (`src/lib/lawPack.js`), so the
  live and stored paths both use the same shaper.
- Every other module comes from a Google News RSS search (the registry's product-name query, for
  example `India ("ICC" OR "Proceedings")`), then GDELT. Results are capped at 100 rows.

**Client fallback.** `src/lib/archiveFeed.js` uses the same three packs. Supabase `desk_rows`
holds the same three Law tables (snapshot of 2026-09-21) and no wire rows.

## 4. Data each module holds

| Module | Fields that matter | Gaps and caveats |
|---|---|---|
| NCLT orders (148) | subject (the case number as written), entity (141), date, remarks (Admission – Final Order 83, Others 22, Appointment of Liquidator 19, Approval of Resolution Plan 7, Rejected 5, …), source_url (IBBI-hosted PDF) | No bench field (it sits inside the case number), no CIN, no NCLAT. |
| IBBI announcements (286) | type (CIRP 193, Voluntary Liquidation 53, Liquidation 40), corporate_debtor, applicant, insolvency_professional, date, last_submission_date, source_url (282 PDFs) | **`ibbiOne` drops `last_submission_date`**, so the app never shows the claims deadline. All 286 deadlines (2026-05-27 to 09-04) have passed as of 2026-10-13. No CIN. 66 debtors also appear as an NCLT entity. |
| SC orders (220) | case_title, diary_no, order_date (`DD-Mon-YYYY`), topic, pdf_url (sci.gov.in `view-pdf`, which may need a live court session) | 208 of 220 topics are "Other / Unclassified". No citation, coram, result, provisions or holding. Order dates 2026-06-25 to 07-03; `as_of` 2026-09-07. |
| Wire modules | date, title, source_url (news.google redirect), summary (≤400 characters, HTML stripped), section ("COVERAGE — GOOGLE NEWS RSS" or "… GDELT 2.0") | **The publisher is dropped:** Google News RSS names it in a `<source>` element that `parseRssOrXml` does not read. The broad queries pull unrelated stories (the ICC search matches cricket; open item F84). The reference's ENTITYNAME, ID and EVENTDATE are not source fields; `recordChecklist` fills them from the title, an index and the date. |

**Richer stored packs not in use.** The `backup/` XLSX packs hold 177 ICJ General List cases, 641
WTO DS case pages, 500 Wikidata judges and 8,531 Allahabad HC order PDFs. `backup/` is probably not
deployed. Using any of them is a separate data decision. The Sector Tribunals pack holds at least
one PAN in a title, so it needs a personal-data check first.

## 5. The Record tab today

- **Renderer.** No Law module has a record-panel adapter, so every Law row renders in the generic
  `RecordDetail`: title, field summary, date timeline, documents (with the SCI session note),
  related entities and provenance. The fields that `recordChecklist` adds probably show as
  duplicates.
- **Model calls on selection.** Every Law row has no pack brief, so `SourceBriefBlock` runs
  `resolveOrganisedBrief` on selection. That calls `/api/ai/source-extract` and then `ensureDeskBrief`,
  which runs a model. Selecting a Law record therefore spends model calls today, as National did
  before F124.
- **Status labels.** `src/lib/apiStatus.js` has no Law entries, so all twelve read "Live".
- **Caveats.** `lawNote` and the SCI `pdf_note` (`src/lib/lawPack.js`), the four `limitations`
  strings in `src/lib/lawLandingSummary.js`, and the group descriptions in
  `src/desks/landing/lawPresentation.js`.
- **Tests.** The landing has tests; `lawPack.js` and Law record rendering have none.

## 6. Gaps and constraints for the spec

1. **Only three modules hold records.** NCLT/IBBI and the SC table can fill the four tiles from
   their own fields. The wire panels can show only the headline, date, summary and source, and they
   must say the item is coverage, not an order, as the reference does.
2. **The reference's "planned" state does not apply to SC and Topic.** We hold 220 real orders, so
   they get real panels. Their needs boards will show most fields as not on the row.
3. **The clock tile needs held dates.** IBBI holds a claims deadline once `ibbiOne` keeps it.
   Elsewhere no deadline is held, and none may be computed from statute (for example a limitation
   period), because the panel would then assert a deadline the source never stated.
4. **Quick exit means AI documents.** Generating them on selection would spend credits, which the
   owner ruled out for briefs until F111. This is an owner decision.
5. **Maps.** No Law row names a state party or a situation, so the reference's ICC, ICJ and WTO
   maps would hold only placeholders. They are left out.
6. **Review notes stay out of the panels.** "Split this module in two", "rename the module a watch
   list" and the classifier and query criticisms are catalogue or backend tasks, not reader text.
   Where they describe a real limit (unclassified topics, broad queries), the panel states that
   limit as a fact.
