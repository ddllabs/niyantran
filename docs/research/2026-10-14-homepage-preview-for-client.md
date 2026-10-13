# Homepage desk preview: what the data supports, and what needs the client's confirmation (F144)

> **Status: Living.** Owner, 2026-10-14: "For the facts and data counters that we have been able to
> match right now and that are backed up by the database without retitling anything, we can fix. The
> things that require approval can be marked in a document, and I can ask for explicit confirmation
> from them later." Counts were taken on 2026-10-14 from the snapshot files the terminal's desks read
> (`public/data/embedded_csv/`), and the bill stages were checked against the live database (NTER).

The homepage has an interactive preview of six desks (the panel with a table, four indicator tiles and
"Status by stage" bars). Before this change most of its numbers were placeholders written for the
mock-up. Part A lists what has now been corrected; Part B lists what needs the client's decision,
because the data does not support the current wording, or would need a desk to be retitled.

## Part A. Corrected now (same labels, real figures)

| Desk | Figure (label unchanged) | Was | Now | Source |
|---|---|---|---|---|
| Bills | Bills on record | 9,817 | 9,817, live from the database | bill register |
| Bills | Houses | 2 | 2 | distinct houses in the bill register |
| Bills | Ministries | 48 | 56, live from the database | parliamentary questions |
| Bills | Series start | 1952 | 1952 | earliest introduction date (15 May 1952) |
| Bills | Status by stage: Pending | 4,120 (42%) | 689 (7.0%) | bill register, share of all 9,817 bills |
| Bills | Passed | 2,890 (29%) | 169 (1.7%) | same |
| Bills | Assented | 2,100 (21%) | 3,391 (35%) | same |
| Bills | Withdrawn | 709 (7%) | 361 (3.7%) | same |
| Bills | Note | "…Probability scores are stored columns, not a simulator." | "Passage labels are as published on the register." | the probability score is empty for every bill |
| Electoral | States covered | 28 | 36 | MP report card: states and union territories, spellings merged, "Nominated" excluded |
| Economy | Live series | 42 | 7 | macro indicators file (the word "live" is in Part B) |
| Economy | Publishers | 8 | 2 | World Bank and IMF WEO |
| Global | Open fronts | 18 | 88 | fronts register |
| Global | Theatres | 6 | 17 | distinct regions in the fronts register |

The six sample bills on the Bills desk are real records and are unchanged.

## Part B. Needs the client's confirmation

Each item says what the preview shows, what our data actually holds, and a proposal. Nothing in this
part has been changed.

### Bills
1. **Stage bars cover under half the register.** The four stages shown (Pending, Passed, Assented,
   Withdrawn) account for 4,610 of 9,817 bills. The largest stage, **Lapsed (4,566, 46.5%)**, is not
   shown, nor are Removed (221), Negatived (52) and 368 bills without a stage.
   *Proposal:* show the four largest stages (Lapsed, Assented, Pending, Withdrawn), or all stages.

### Electoral ("Electoral returns")
2. **By-elections (8):** no by-election data exists. *Proposal:* replace with "MPs profiled: 780".
3. **Series start (1951):** the electoral data covers 2024 only. *Proposal:* "Election year: 2024", or remove.
4. **Status bars (Declared 480, Counting 32, Notified 22, Disputed 9):** no such field exists.
   *Proposal:* replace with MPs by state or by party from the MP report card.
5. **Six "contest" rows** (for example "Lok Sabha general election, 2024 - Uttar Pradesh"): not records
   in our data. *Proposal:* six real MP rows (name, constituency, state).
6. **Note** ("Seat totals here are a desk preview, not a forecast"): fine if the bars change; review with them.

### Media ("Statement tracker")
7. **Everything on this desk is a placeholder** (128 items this week, 14 official sources, 6 wire
   searches, 3 houses, the source bars and six statements). The statement tracker holds no records.
   *Proposal:* retitle to **Regulatory Watch** (121 notices: RBI 96, SEBI 25) with real rows and counts,
   or to **Cabinet decisions** (6).

### Operations ("Tenders & notices")
8. **Open notices (84):** the tender file holds 10 notices, all marked "Open", but every deadline passed
   in July 2026. Calling them open would be wrong. Ministries (12) and sectors (6): those fields are
   empty. Closing in 7 days (9): none. The status bars and the six rows are placeholders.
   *Proposal:* retitle to **DGFT notifications** (229 real notices) with real rows and counts, or refresh
   the tender feed first.

### Economy ("Macro series")
9. **"Live series":** the 7 series are annual values (2025 and IMF projections to 2031), not live.
   *Proposal:* relabel "Macro series".
10. **Updated today (4) and series start (1991):** no data supports either. *Proposal:* remove, or
    replace with "Market instruments: 144" from the NSE/BSE feed.
11. **Status bars (Prices, Activity, Trade, Fiscal):** no category field. **Sample rows:** five of six
    (CPI, IIP, exports, GST, repo rate) are not in the data; only World Bank GDP is.
    *Proposal:* use the market feed (144 instruments) for rows and counts, or show the 7 real series.

### Global ("Open fronts")
12. **Updated in 48 hours (4):** every front carries the same date (7 September 2026). **Sources (9):** no
    front has a source link, and all 88 are marked "unconfirmed". *Proposal:* remove both, or show
    "Regions: 17" and "Front types" from the register.
13. **Status bars (Active 11, Watch 4, Frozen 2, Closed 1):** the register's stages are **Active 36, Under
    review 22, Low-intensity 14, Frozen 8, Ceasefire fragile 8**. *Proposal:* use these five.
14. **Sample rows:** the theatre labels (Europe, West Asia, Maritime, Himalaya, East, Africa) are not the
    register's regions, and there is no "Sahel" front (there are Mali, Burkina Faso and Niger rows).
    *Proposal:* real rows such as "Russia–Ukraine War — Eastern Europe", "Israel–Hamas War (Gaza) —
    Middle East", "Yemen — Houthi Conflict / Red Sea — Middle East", "India–China LAC Standoff (Ladakh)
    — South Asia", "Myanmar — Civil War — Southeast Asia".
15. **Note** ("Fronts are sourced events"): the register has no source links and every row is marked
    unconfirmed. *Proposal:* "Fronts as recorded in the register; sources are being added."

## How the corrected figures stay right

The figures in Part A come from `src/data/preview-figures.json`, generated by
`node scripts/build-preview-figures.mjs` from the snapshot files; a test recounts them from the files
and fails if they drift, and checks the old placeholders are gone. Bills on record and ministries come
from the live database through `/api/site-figures` (F142). Making the stage bars live from the database
as well would need one more read-only database function (a migration, for the owner to approve).
