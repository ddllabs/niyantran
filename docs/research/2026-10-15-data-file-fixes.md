> **Status: Historical (dated 2026-10-15).** Exact inventory of the owner-approved data-file fixes for audit
> cause 7 (`docs/research/2026-10-15-module-quality-audit.md`). Owner approval 2026-10-15: "Whatever
> recommendations you have given, I agree with them".

# Data-file fixes for audit cause 7 (F202)

Five defects in shipped packs. Two are fixed in the data (bill dates, Isometric dates), one in the data
with sources recorded (Heads of State), and two in code because a deterministic rule beats editing rows
(tender status, constitution names). `backup/` was not touched. No row was added or removed and no `id`
changed in any file.

Guard: `src/lib/dataFileFixes.test.js` (12 tests). Run against the files and code at `HEAD` (3cfe20c) all
12 fail; against this change all 12 pass.

| File | sha256 (first 16) at HEAD | after |
|---|---|---|
| `public/data/embedded_csv/national_bill_tracker.json` | `becb4b79d9603bc9` | `8166349c9f070d7b` |
| `public/data/embedded_csv/national_bill_tracker.meta.json` | `c61eb3281a153c44` | `2c2b3acbab3eccf3` |
| `public/data/embedded_csv/climate_registry_wire.json` | `06309e22e9c9c1ed` | `badd1ba9110d0df3` |
| `src/data/leaders.json` | `521b82be1691bbdb` | `83a9339e8c35a9f3` |

## 1. Bill register dates (`national_bill_tracker.json`, 9,819 rows)

**Defect.** Sansad gives each bill a calendar date (`source_date_raw`, always `YYYY-MM-DD 00:00:00.0`). The
pack stored that date shifted back 5 or 6 hours as a UTC time, so every bill read one day early:
`source_date_raw "2026-08-10 00:00:00.0"` was stored as `date_introduced "2026-08-09 19:00:00"`,
`occurred_at "2026-08-09T19:00:00Z"`.

Measured on the HEAD file: 9,666 rows were 5 h behind and 153 rows 6 h behind (all introduced in 2002, 2008
or 2009). Every row had a wrong `date_introduced` and `occurred_at`. The pack has no `date`, `eventDate` or
`sourcePublishedAt` field, so nothing else needed recomputing.

**Change — every row (9,819 of 9,819), two fields, one rule:** with `D = source_date_raw.slice(0, 10)`

| Field | Old | New |
|---|---|---|
| `date_introduced` | `D − 5 h` (or `− 6 h`) as `"YYYY-MM-DD HH:00:00"` | `D` |
| `occurred_at` | `D − 5 h` (or `− 6 h`) as `"…THH:00:00Z"` | `"DT00:00:00+05:30"` (midnight IST) |

Unchanged on purpose: `id` (it embeds the old, shifted date, e.g. `156-Lok Sabha-2026-08-09-…`, but ids are pin
and `desk_rows` keys), `source_date_raw`, `as_of` and every other field. Row order unchanged.

`national_bill_tracker.meta.json`: `newest_record` `"2026-08-09T19:00:00Z"` → `"2026-08-10T00:00:00+05:30"` (same rule
applied to the newest `source_date_raw`). `as_of`, `row_count` unchanged.

**Verified against sansad.in** (`GET https://sansad.in/api_rs/legislation/getBills?billName=…`, 2026-10-15),
`billIntroducedDate` vs the pack:

| Bill | sansad.in | old `date_introduced` | new |
|---|---|---|---|
| LS 156, National Co-operative Development Corporation (Amendment) Bill, 2026 | 2026-08-10 | 2026-08-09 19:00:00 | 2026-08-10 |
| LS 153, Tribunals Reforms Bill, 2026 | 2026-08-10 | 2026-08-09 19:00:00 | 2026-08-10 |
| LS 70, Land Ports Authority of India Bill (2010) | 2009-08-07 | 2009-08-06 18:00:00 | 2009-08-07 |
| LS 67, National Commission for Minority Educational Institutions (Amendment) | 2009-08-07 | 2009-08-06 18:00:00 | 2009-08-07 |
| LS 59, National Co-operative Development Corporation (Amendment) Bill (2012) | 2012-05-17 | 2012-05-16 19:00:00 | 2012-05-17 |
| RS LVII, National Co-operative Development Corporation (Amendment) Bill (1995) | 1995-08-25 | 1995-08-24 19:00:00 | 1995-08-25 |

All six match the new value. The two 2009 rows are from the 6-hour group.

**Production follow-up (not done here).** The pack feeds `desk_rows` for two national modules. An offline run of
`deskRowsFor` (the loader's own pipeline) over HEAD and this change shows only these modules' rows differ
(same keys, changed content; nothing added or pruned except Carbon Registry Wire):

| Desk | Module | Rows | Changed | New | Pruned |
|---|---|---|---|---|---|
| national | Bill Passage Probability Index | 9,817 | 9,817 | 0 | 0 |
| national | Policy Intelligence Graph | 9,817 | 9,817 | 0 | 0 |
| global | Heads of State | 43 | 19 | 0 | 0 |
| carbon | Carbon Registry Wire | 24 | 1 | 13 | 13 |

Central Tender Aggregator and World Constitutions load 0 rows into `desk_rows` before and after.
After the change is merged to `main`, from the main checkout, with `.env.local` holding `SUPABASE_URL` and
`SUPABASE_SECRET_KEY`:

```bash
npx vite-node --config vitest.config.js scripts/load-desk-rows.mjs -- --dry-run --tier national
npx vite-node --config vitest.config.js scripts/load-desk-rows.mjs -- --tier national --feature "Bill Passage Probability Index"
npx vite-node --config vitest.config.js scripts/load-desk-rows.mjs -- --tier national --feature "Policy Intelligence Graph"
npx vite-node --config vitest.config.js scripts/load-desk-rows.mjs -- --tier global --feature "Heads of State"
npx vite-node --config vitest.config.js scripts/load-desk-rows.mjs -- --tier carbon --feature "Carbon Registry Wire"
```

then, because about 19,700 rows are rewritten: `analyze public.desk_rows;` and check `n_live_tup`.

## 2. Heads of State (`src/data/leaders.json`, 19 entries)

**Defect.** 19 entries stored an office ("US President", "Japan PM", "Poland (govt)") instead of the holder, so
`flattenLeader` (`src/lib/globalResources.js`) showed them as "Not verified".

**Source.** Wikidata, queried 2026-10-15 at `https://query.wikidata.org/sparql`. The holder was taken from the
person's own `position held` (P39) statement with a start date and no end date, not from the country's P35/P6
alone (the Thailand item's P6 still names Paetongtarn Shinawatra, whose term ended in 2025):

```sparql
SELECT ?person ?personLabel ?pos ?posLabel ?start ?end WHERE {
  VALUES ?person { wd:Q22686 wd:Q269909 wd:Q566257 wd:Q1705028 wd:Q12612463 wd:Q2096387 wd:Q7686199
                   wd:Q4777855 wd:Q24237654 wd:Q192533 wd:Q946 wd:Q28860866 wd:Q335697 wd:Q10831196
                   wd:Q16139757 wd:Q1855372 wd:Q1951896 wd:Q6504758 wd:Q1932603 }
  ?person p:P39 ?st . ?st ps:P39 ?pos .
  OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
  FILTER(!BOUND(?end) || ?end > "2025-01-01"^^xsd:dateTime)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

Cross-check: country P35 (head of state) / P6 (head of government) for wd:Q30 Q145 Q183 Q17 Q884 Q843 Q902 Q854
Q889 Q16 Q36 Q55 Q408 Q881 Q869 Q846 Q878 Q334 Q241 agreed with every row except Thailand's stale P6.

**Change.** Each of the 19 rows: `name` old → new, plus `as_of: "2026-10-15"` and
`source_url: "https://www.wikidata.org/wiki/<QID>"` added. Other field changes are listed.

| id | Old `name` | New `name` | QID | Office (P39), start | Other fields old → new |
|---|---|---|---|---|---|
| us | US President | Donald Trump | Q22686 | President of the United States (Q11696), 2025-01-20 | — |
| gb | UK Prime Minister | Andy Burnham | Q269909 | Prime Minister of the United Kingdom (Q14211), 2026-07-20 | `since` 2024 → 2026 |
| de | German Chancellor | Friedrich Merz | Q566257 | Federal Chancellor of Germany (Q4970706), 2025-05-06 | — |
| jp | Japan PM | Sanae Takaichi | Q1705028 | Prime Minister of Japan (Q274948), 2025-10-21 | `since` 2024 → 2025 |
| kr | South Korea President | Lee Jae Myung | Q12612463 | President of South Korea (Q6296418), 2025-06-04 | — |
| pk | Pakistan PM | Shehbaz Sharif | Q2096387 | Prime Minister of Pakistan (Q735575), 2024-03-03 | — |
| bd | Bangladesh (interim) | Tarique Rahman | Q7686199 | Prime Minister of Bangladesh (Q14565638), 2026-02-17 | `role` Chief Adviser → Prime Minister; `party` — → Bangladesh Nationalist Party; `ideology` Technocratic → —; `since` 2024 → 2026; `latest` (described the Yunus interim government) → "" |
| lk | Sri Lanka President | Anura Kumara Dissanayake | Q4777855 | President of Sri Lanka (Q2914380), 2024-09-23 | — (Wikidata's English label reads "Anura Kurankan Dissanayake"; the name in common use is kept) |
| af | Taliban (IEA) | Hibatullah Akhundzada | Q24237654 | Supreme Leader of Afghanistan (Q108130107), 2021-08-15 | — |
| ca | Canada PM | Mark Carney | Q192533 | Prime Minister of Canada (Q839078), 2025-03-14 | — |
| pl | Poland (govt) | Donald Tusk | Q946 | Prime Minister of Poland (Q3259469), 2023-12-13 | `role` PM / President → Prime Minister |
| nl | Netherlands (govt) | Rob Jetten | Q28860866 | Prime Minister of the Netherlands (Q3058109), 2026-02-23 | `party` — → Democrats 66; `ideology` Right-coalition → —; `since` 2024 → 2026 |
| au | Australia PM | Anthony Albanese | Q335697 | Prime Minister of Australia (Q319145), 2022-05-23 | — |
| vn | Vietnam (CPV) | Tô Lâm | Q10831196 | General Secretary of the Communist Party of Vietnam (Q848786), 2024-08-03 | — |
| th | Thailand PM | Anutin Charnvirakul | Q16139757 | Prime Minister of Thailand (Q12376089), 2025-09-07 | `party` Pheu Thai-led → Bhumjaithai Party; `since` 2024 → 2025 |
| qa | Qatar (Emir) | Tamim bin Hamad Al Thani | Q1855372 | Emir of the State of Qatar (Q25711499), 2013-06-25 | — |
| ae | UAE (President) | Mohamed bin Zayed Al Nahyan | Q1951896 | President of the United Arab Emirates (Q955006), 2022-05-14 | — |
| sg | Singapore PM | Lawrence Wong | Q6504758 | Prime Minister of Singapore (Q866756), 2024-05-15 | — |
| cu | Cuba (President) | Miguel Díaz-Canel | Q1932603 | President of Cuba (Q1370482), 2018-04-19 | — |

The pack's top-level `asOf: "2026-07"` and the other 24 entries are unchanged. The `latest` commentary on the
19 rows was kept except Bangladesh's; it is editorial text, not sourced to Wikidata.

## 3. Central Tender Aggregator status (code, no data change)

**Defect.** `public/data/embedded_csv/national_tender_aggregator.json` holds 10 eProcure tenders, all
`status: "Open"`, deadlines 10–13 Jul 2026 (ids 1–10; id 6 closes 10-Jul-2026 12:00 PM, ids 9–10
13-Jul-2026 11:00 AM, the rest 13-Jul-2026 03:00 PM). When the board keeps expired rows (backup / exhaustive
pack) it showed them as Open.

**Change.** Status is derived at read time, so it stays right as days pass and the file is untouched:
`src/lib/shapeTenders.js` adds `tenderStatus(row, now)` — a stored "Open" (or empty) status whose deadline has
passed reads "Closed"; any other stored status, and a row with no readable deadline, keeps its own.
`applyOpenTenderFilterToFeed(feed, now)` now applies it on the backup / exhaustive path (rows kept, status
derived) instead of returning that feed untouched. The live path still hides expired rows, as before.
Data file: no change.

## 4. Carbon Registry Wire, Isometric rows (`climate_registry_wire.json`, ids 11–24)

**Defect.** The 14 Isometric rows had `date: ""`, `source_date_raw: ""`, `occurred_at: null`; 6 titles were
rebuilt from the URL slug ("Cop29 what it actually means…").

**Loader.** No loader change is needed: `server/featureFeed.mjs` (registry slice, ~2193-2215) takes Verra from
live RSS and the Isometric rows from this stored pack in both its live and fallback paths, so fixing the pack
fixes both.

**Change.** Dates and titles read from each article page at `https://isometric.com/writing-articles/<slug>`
(the row's `link`), 2026-10-15. For every row: `date` "" → the ISO date, `source_date_raw` "" → the page's date
as written (e.g. "April 22, 2024"), `occurred_at` null → the ISO date. `title` changed only where the page title
differs from the slug-derived one.

| id | Old `title` | New `title` (page `<title>`) | Date on page → `date` / `occurred_at` |
|---|---|---|---|
| 11 | A new era for carbon removal | (unchanged) | April 22, 2024 → 2024-04-22 |
| 12 | A new module for energy emissions accounting | (unchanged) | November 25, 2024 → 2024-11-25 |
| 13 | A new protocol for electrolytic seawater mineralization | Certified protocol for carbon removal via Electrolytic Seawater Mineralization | March 17, 2025 → 2025-03-17 |
| 14 | A new sheriff in town the eu tackles cdrs trust problem | A new sheriff in town: the EU tackles CDR’s trust problem | February 23, 2024 → 2024-02-23 |
| 15 | Advancing energy emissions accounting for carbon removal | (unchanged) | September 30, 2024 → 2024-09-30 |
| 16 | Advancing mrv with national renewable energy laboratory | Advancing MRV with National Renewable Energy Laboratory | February 23, 2024 → 2024-02-23 |
| 17 | Aligning incentives | (unchanged) | December 8, 2023 → 2023-12-08 |
| 18 | Bringing isometrics scientific rigor to trees | Bringing Isometric’s scientific rigor to trees | December 5, 2024 → 2024-12-05 |
| 19 | Building a feedstock eligibility questionnaire | (unchanged) | January 21, 2025 → 2025-01-21 |
| 20 | Certified protocol for biochar production and storage | Certified protocol for Biochar Production and Storage | October 10, 2024 → 2024-10-10 |
| 21 | Contributing to critical research | (unchanged) | July 3, 2023 → 2023-07-03 |
| 22 | Cop29 what it actually means for carbon removals | COP29: what it actually means for carbon removals | December 2, 2024 → 2024-12-02 |
| 23 | Developing direct air capture | (unchanged) | October 17, 2023 → 2023-10-17 |
| 24 | Doe prize a step forward for quality | DOE prize a step forward for quality | May 28, 2024 → 2024-05-28 |

All 14 were re-fetched and checked against the page: each page carries exactly one date in that form and its
`<title>` equals the new title. Rows 1–10 (Verra) and every other field are unchanged. The desk row key is
the title slug plus the row's position, and dated rows now sort by date, so 13 Isometric rows get new
`desk_rows` keys (13 upserted, 13 old keys pruned on the next load; see §1).

## 5. World Constitutions names (code, no data file)

**Defect.** `/api/constitutions` (`server/resourcesApi.mjs`, `loadConstitutions`) used Constitute Project's
`country_id` as the display name, so 46 of the 188 in-force constitutions read like `Bahamas_the`. The module
is live only; there is no stored pack.

**Change.** `src/lib/globalResources.js` adds `constitutionCountryName(countryId)`: underscores become spaces, a
trailing "the" is dropped, and a 16-entry override map covers ids the rule would get wrong (`Cote_d_Ivoire` →
Côte d'Ivoire, `Congo_the` → Republic of the Congo, `Democratic_People_s_Republic_of_Korea_the` → North Korea,
`Republic_of_Korea__the` → South Korea, `Lao_People_s_Democratic_Republic__the` → Laos, `Iran_Islamic_Rep_of_` →
Iran, `Micronesia__Fed_States_of_` → Micronesia, `Republic_of_Moldova` → Moldova, `Russian_Federation__the` →
Russia, `The_former_Yugoslav_Republic_of_Macedonia` → North Macedonia,
`United_Kingdom_of_Great_Britain_and_Northern_Ireland__the` → United Kingdom, `United_Republic_of_Tanzania__the` →
Tanzania, `United_States_of_America` → United States, `Viet_Nam` → Vietnam, `Brunei_Darussalam` → Brunei, and the
plain id `Swaziland` → Eswatini). `loadConstitutions` sets `title` and `country` from it; `constitution_id` and
`source_url` still use Constitute's own id.

Checked against the live list (`GET https://www.constituteproject.org/service/constitutions?lang=en`,
2026-10-15): 188 in force, 46 ids with underscores, all 46 formatted without underscores, and each name resolves
on the record map (`countryPosition`). The only plain id renamed is Swaziland.

The record panel (`src/shell/record/adapters/constitutions.js`, `readableCountry`) passes an already formatted
name through unchanged, so the panel title now matches the table. It used Constitute's longer forms ("The
Gambia", "Iran (Islamic Republic of)", "Republic of Korea"); the table and panel now both read "Gambia", "Iran",
"South Korea".

## Existing tests that pinned the old data

Two adapter suites read the real pack or the real loader and pinned the old values; they were updated, with
no change to the adapters:

- `src/shell/record/adapters/headsOfState.test.js`: the placeholder cases now use the US profile as it stood
  (named "US President", no as-of or source); no pack row is badged Not verified; the 19 sourced rows carry
  `as_of` and a Wikidata item URL; Bangladesh's empty `latest` shows no Latest card; 11 rows (was 9) have
  ideology "—".
- `src/shell/record/adapters/constitutions.test.js`: fixture rows are picked by Constitute id or by display name,
  and the expected names are the loader's.
