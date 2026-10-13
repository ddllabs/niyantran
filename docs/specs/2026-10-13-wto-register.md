# WTO Dispute Settlement as a register (F129, L2)

> **Status: Living.** Owner, 2026-10-13: "WTO data im ok if you collect it". Branch
> `task/wto-register`. Plan: [record follow-ups plan](../plans/2026-10-13-record-followups-plan.md),
> phase L2. ICJ (phase L1) is not built: the owner chose to keep it as it is.

## Current state

The WTO Dispute Settlement module serves live news. Since F84 this comes from a forum-specific
Google News query, with GDELT as the fallback. It holds no dispute numbers, parties or stages. The
stored backup pack (`backup/LAW/F46_WTO_Dispute_Settlement.xlsx`) is unusable:

- every title reads "WORLD TRADE ORGANIZATION";
- every status reads "See official current status";
- the complainant field holds scraped prose.

## Source

The WTO publishes its whole dispute register as data that its own case pages read. Each page
loads these files from `www.wto.org/library/disputes/` (checked 2026-10-13):

- `dispute_case_arrays_e.js`: one record per dispute, DS1–DS646. Fields: code, title, origin
  (complainants), destination (respondent), start date (consultations requested), subject, short
  title, agreements cited, last update, status with its date, third parties, and whether reports
  were adopted.
- `dispute_arrays_e.js`: the status names (ST0–ST34, some kept only as commented-out lines) and the
  agreement names.

Members are written as codes, mostly ISO 3166 alpha-3, and given common English names here. The
WTO's own name table is not in the files its case pages load, so it could not be copied.

The WTO's display code (`dispute_code.js`, read on 2026-10-13) applies two rules:

- **Complainants and respondents** follow the dispute's start date:
  - EEC is the European Communities before 1 December 2009 and the European Union from that date;
  - TUR is Turkey before 1 June 2022 and Türkiye from that date.
- **Third parties** follow two exception lists in `dispute_arrays_e.js` (`eec_exceptions`,
  `tur_exceptions`): EEC is the European Union, and TUR is Türkiye, unless the dispute is listed.

Other codes:

| Code | Name |
|---|---|
| CHT | Chinese Taipei |
| HKG | Hong Kong, China |
| ROM | Romania (the old ISO code) |

One third-party entry ("OR") matches no member and is shown as written.

A dispute may have several current stages, separated by "|" on the WTO's side. All of them are
kept (`stages`), each with its date; the table shows the first.

**Terms (open question for the owner; publication gate).** The data file is committed on the task
branch only; it is not pushed until the owner decides. The terms page for wto.org could not be retrieved. Related
WTO platforms allow reuse with acknowledgement and require permission for commercial use or
redistribution. Niyantran is a paid product, so the owner should confirm with the WTO
(enquiries@wto.org) before the data is published.

What is collected is factual register data: numbers, parties, dates, statuses and official titles.
The WTO's summaries are not copied. Every row and the panel credit "World Trade Organization" and
link the official case page.

## Change

1. **Collector.** `scripts/collect-wto-disputes.mjs` (run by hand, unsandboxed) fetches the two
   files once, identified by a User-Agent naming the project.
   - It parses them as text. It never executes the WTO's JavaScript.
   - It writes `public/data/embedded_csv/judiciary_wto_disputes.json`.
   - **Fields:**
     - `ds_number` ("DS600"), `ds`;
     - `title`, `short_title`;
     - `complainants`, `respondent`, `third_parties` (names, as the rules above give them);
     - `consultations_requested` (ISO date);
     - `status`, `status_date`;
     - `reports_adopted`;
     - `agreements` (short names);
     - `last_updated`;
     - `source_url` (the official case page);
     - `source`, `as_of` (collection time).
   - **Blanks:** a field the WTO leaves empty stays empty, and an unknown code stays as written.
2. **Feed.** The module serves the stored register first, through the server's stored-table path
   and the client fallback alike. The live news search remains the fallback when the register file
   is missing.
3. **Record panel.** A register adapter, `lawWtoRegister`, takes register rows. The news adapter
   keeps news rows.
   - **Tiles:**
     1. stage (the WTO's status, with its date);
     2. complainant → respondent;
     3. agreements cited;
     4. the clock: "Compliance period ends: Not on the row". The register states no compliance
        date, and none is computed.
   - **Needs board:**
     - on the row: DS number, parties, measure (the title), agreements, current stage with its
       date, third parties;
     - not on the row: compliance and retaliation status, unless the status names them.
   - **Map:** complainant and respondent at approximate country centres. The European Union is
     not a place and is left unplaced, and the caption says so.
   - **Footer:** provenance is "WTO dispute settlement register (wto.org)" as of the collection
     date.
   - **Related records:** the same respondent's other disputes, and the same short title (one
     dispute raised by several complainants).

## Acceptance

- The collector's parser is tested on the real downloaded files (fixtures saved from the 2026-10-13
  fetch, outside the repo) and on synthetic text. It never uses `eval` or `Function`.
- Every register row passes the record-panel contract.
- Tests cover the date rules for EEC and TUR.
- Dispatch tests show register rows get the register panel and news rows keep the news panel.
- `npm run lint`, `npm test`, `npm run build` and the router import pass, and a browser check
  confirms the module shows the register.

## Not changed

- ICJ (the owner kept it as it is).
- The backup pack (not moved, not edited).
- The news query (F84).
