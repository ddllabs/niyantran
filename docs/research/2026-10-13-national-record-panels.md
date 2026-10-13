# National record panels: reference, current state and data inventory

> **Status: Historical (2026-10-13).** This is a read-only review by the supervisor for F124. Sources:
> the owner's reference file `~/Downloads/nter-national-record-panels_2 (1).html` (not in the repo),
> a data inventory by a read-only sub-agent, and reads of the code. Nothing was changed.
> Companion: [Global record panels research](2026-10-13-global-record-panels.md).

## 1. The reference

The National reference uses the same record-panel kit as the Global one. The renderer functions
are identical, and every panel has the same five parts: header, 01 at a glance, 02 about, 03 what
it touches, and a footer with Ask AI and provenance. It uses only the `timeline` and `board`
visuals, which our kit already has.

Owner, 2026-10-13: the reference files are frontend mockups from the client. Their data may be
inaccurate. What counts is the placement, the look and feel, and the kind of information the
reader should see. Our panels show only the data our backend holds.

The National reference was evidently written against the live app. Its row counts match ours
(9,819 bills, 8,000 questions, 782 members, 483 candidates), and several panels carry review notes
for the team rather than reader content: cards badged "Gap", "Fix" or "Split required", and notes
such as "filtering is the whole fix".

| # | Reference module | App module | Tiles | Visual | Lanes |
|---|---|---|---|---|---|
| 01 | Bill Passage Probability Index | same | Passage prob., Precedent, Days in stage, Links | timeline "Stage history" | Ministry → bill → sectors & segments → companies |
| 02 | Parliamentary Question Database | same | Tabled, Ministry, Asked by, Links | timeline "Question lifecycle" | Ministry → question → sectors & segments → companies |
| 03 | Policy Pipeline Tracker | Policy Pipeline Tracker (Draft-to-Gazette) | Stage, Last action, Instrument, Rows | board "What the stage column contains" | Source → item → instrument → sectors |
| 04 | Regulatory Body Watch | Regulatory Body Watch (RBI/SEBI/TRAI/CCI) | Issued, Regulator, Instrument type, Rows | timeline "The rolling window" | Regulator → instrument → entity classes → sectors |
| 05 | Cabinet Decisions | same | Date, Ministry, Decision type, Outlay | board "What the feed served today" | Ministry → decision → sectors → states |
| 06 | MP Report Cards | MP Profiles & Performance (MPLAD, attendance, debates) | Questions, Attendance, Debates, MPLADS | none | Party → member → constituency → committees |
| 07 | Candidate Affidavit Database | Candidate Affidavit Database (Structured + API) | Declared assets, Liabilities, Pending cases, Convictions | none | Party → candidate → constituency → outcome |
| 08 | National Morning Brief | National Morning Brief (Auto-digest) | Section, Published, Source, Window | board "Section status" | Publisher → item → records → sectors |

The reference has no panel for the other nine National modules. These include Policy
Intelligence Graph, the tender, transfer, project, budget and industry modules, and others in the
live catalogue (`src/desks/landing/deskPresentation.js`; `FEATURE_ORDER.national` is the frozen
12-item grounding list).

## 2. The Record tab today

`RailContent` sends every National row to `NationalRecord.jsx` (`isNationalTable`), which
dispatches by name:

| Reference module | Current view |
|---|---|
| Bill, Question, Regulatory, Pipeline | `BillRecordPane` (docked in the side panel, not full-screen) with desks `bill`, `question`, `regulatory`, `pipeline` from `DESKS` in `src/lib/impactRecord.js` |
| Candidate Affidavit | `AffidavitRecord` (`src/desks/ElectoralRecords.jsx`) |
| MP Profiles | `MpRecord` (`NationalRecord.jsx`) |
| Cabinet Decisions, Morning Brief | `GenericRecord` (raw-key tiles; machine fields such as `as_of` can appear) |

`BillRecordPane` builds a record model with `buildRecordModel`. The model holds stage, house,
introduced date, ministry, sectors, segments and companies named in the ontology, the analysis
pack's brief, changes, watch-for, related coverage, the PDF and the source. `whereItLands` and
`howItTravels` render the impact sections. Policy Intelligence Graph is the only full-screen
National module (`isNationalFullscreen`); it has no Record tab and is not in the reference.

**AI generation on selection.** When a bill, question, regulatory or pipeline record has no
authored brief longer than 30 characters, which is nearly every row, `BillRecordPane` calls
`resolveOrganisedBrief` (`src/lib/sourceDoc.js`). That fetches the source document through
`/api/ai/source-extract` and calls `ensureDeskBrief`, which runs a model. Selecting a record
therefore spends model calls today. The Global panels only read saved briefs (F123).

Tests: `BillRecordPane.test.jsx` (static markup for the four desks) and `impactRecord.test.js`.
`NationalRecord.jsx`, `ElectoralRecords.jsx` and the shaping helpers have none.

## 3. Data each reference module holds

| Module | Rows | Fields that matter | Gaps and caveats |
|---|---|---|---|
| Bills | 9,819 embedded (1952–2026; Lok Sabha 6,522, Rajya Sabha 3,297); `as_of` 2026-09-07 | bill_name, bill_number, house, sector, date_introduced, current_stage, bill_type, bill_category, source_url | Stored `probability_score` and `summary` are empty on every row. The analysis pack (4,576 bills) gives `passage_probability` (for a resolved bill this is its outcome, 100 or 0; for 295 pending bills a historical base rate, "not an ML prediction"), precedent and stage duration. About 5,200 bills have no score. Without the pack, "days in stage" is days since introduction. Only 149 bills have an authored brief. |
| Questions | 8,000 embedded (Lok Sabha only, 79 MPs, 2024-07 to 2026-04) | mp_name, party, ministry, subject, date, question_type (unstarred 7,459, starred 541), source_url (PDF) | `status` is empty. No answer text exists. The shaping helper writes "Not reported" defaults. The analysis pack has 34 entries. |
| Regulatory | Live RBI RSS (date, title, link, summary only), else 121 embedded (RBI 96, SEBI 25) | regulator, title, date, pdf_url (78), action_type | The live rows have no regulator or type. There is no TRAI or CCI data. The analysis pack has 101 entries. |
| Pipeline | Live PIB RSS (generic releases), else 8 embedded | policy_name, ministry, stage, date_reported | The live rows are press releases, not draft-to-gazette stages. All the embedded sources are `news.google.com` links, which the record pane hides. |
| Cabinet | Live PIB RSS (all ministries), else 6 embedded (1 actual Cabinet decision) | topic/title, ministry, date, source_url, pdf_url | The feed is not filtered to Cabinet decisions. The backup lists 158 rows in a file that is not in the repo. |
| MP Profiles | 782 embedded (540 Lok Sabha, 242 Rajya Sabha by URL) | mp_name, party, constituency (540), state, questions_asked, committees (612), source_url | `attendance_pct` is empty. There is no MPLADS, debates or house column. Party names are inconsistent. The "18th Lok Sabha" label is wrong for the Rajya Sabha rows. |
| Affidavits | 483 embedded (MyNeta/ADR 2024) | name, constituency, party, criminal_cases, education, total_assets, liabilities, source_url | The rows hold no date. Assets are strings. ADR's licence bars redistribution ("viewable, not exportable"). The current view shows an empty "Wealth change: pending analysis" block. |
| Morning Brief | Fetched client-side by `MorningBriefDesk` (GDELT, PIB, economy wires) | title, date, source_url, source, section, headline | Nothing is stored. It is not a generated digest. |

Status labels in `src/lib/apiStatus.js` call most of these "live" although they serve embedded
packs. `src/lib/nationalLandingSummary.js` holds a LIMITS list of honest per-module caveats that
can be reused.

## 4. What can be reused

- The record-panel kit from F121, unchanged in principle: `RecordPanel`, the contract, the visuals,
  the registry, the saved-brief card and related-record links.
- From `src/lib/impactRecord.js`: `buildRecordModel` (sectors, segments, named companies),
  `analysisFor` and `loadAnalysisMap`, `billFacts`, `whereItLands` and `howItTravels`. These need
  the analysis packs and the ontology loaded first, which happens asynchronously today.
- The LIMITS caveats in `src/lib/nationalLandingSummary.js`.

## 5. Gaps and constraints for the spec

1. **Adapters stay pure.** The bill-style modules need the analysis map and the ontology in `ctx`,
   so the panel host has to load them before an adapter runs.
2. **AI generation.** Keeping or stopping generation on selection is an owner decision, tied to AI
   credits (F111).
3. **Honest labels.** The panels must label several fields for what they are:
   - "passage probability" for a resolved bill is its outcome;
   - "days in stage" without the pack is days since introduction;
   - Cabinet Decisions is a press feed;
   - affidavit figures are self-declared and licence-restricted;
   - MP counts are register counts, not performance.
4. **Review notes stay out of the panels.** The "Gap", "Fix" and "Split required" cards are not
   reader content. The fixes they ask for are backend tasks:
   - filtering PIB to Cabinet decisions;
   - listing cases individually;
   - a house column for MPs;
   - answer text for questions.
5. **Scope.** By the owner's rule for Global, only the eight modules the reference covers change.
   The other nine keep their current views.
