# Record brief measurement (F123)

> **Status: Historical (dated) 2026-10-15.** A one-off measurement the owner approved on
> 2026-10-15: 20 real records, two candidate models, total spend under $0.10. It chose the
> default model for the stored record brief. Prices and models change; re-measure before
> relying on these figures.

## Question

Open-work F123, owner decisions 2026-10-15: every record panel gets an AI brief, written the
first time anyone opens the record, stored, and reused by every later viewer; the platform
pays; a cheap, fast model. Which model, and what will it cost?

## Method

- `scripts/measure-record-briefs.ts` (Deno) imports the Edge Function's own prompt builder and
  request body (`supabase/functions/desk-brief/record.ts`: `buildRecordPrompt`,
  `recordRequestBody`, `parseBrief`, `normaliseRecordBrief`), so the calls are the ones
  production makes: row fields only (no web, no documents, no identifiers), JSON
  `{headline, points[3]}`, `max_tokens` 350, `temperature` 0.2, `reasoning: {enabled: false}`,
  `response_format: json_object`, `usage: {include: true}`.
- 20 fixed rows from `public/data/embedded_csv` (read-only): 7 Global (Open Fronts, Global
  Intelligence, Infra), 8 National (bills, policy pipeline, parliamentary questions, regulators,
  Cabinet decisions, MP profiles), 5 Law (Supreme Court orders, NCLT, WTO).
- One call per row per model, sequential, straight to OpenRouter. The script prints only the
  provider's usage, latency and the brief; it never prints the key or the environment, and it
  stops before a call once spend reaches $0.09.
- Run on 2026-10-15 at 12:36 UTC:

  ```bash
  deno run --allow-net=openrouter.ai --allow-read --allow-env=OPENROUTER_API_KEY \
    --env-file="<main checkout>/.env.local" scripts/measure-record-briefs.ts
  ```

  (`--allow-env=OPENROUTER_API_KEY` is needed for the script to read the key that
  `--env-file` loads.)
- Model ids checked against `https://openrouter.ai/api/v1/models` the same day:
  `google/gemini-2.5-flash-lite` ($0.10 / $0.40 per million input / output tokens) and
  `anthropic/claude-haiku-5.5` ($0.10 / $0.50; OpenRouter does not list `temperature` for it,
  so that parameter is dropped).

## Results

| Model | Briefs OK | Prompt tokens | Completion tokens | Reasoning tokens | Cost, 20 briefs | Mean per brief | Median / max latency |
|---|---|---:|---:|---:|---:|---:|---|
| google/gemini-2.5-flash-lite | 20/20 | 8,095 | 2,057 | 0 | $0.0016323 | $0.0000816 | 1.17 s / 1.99 s |
| anthropic/claude-haiku-5.5 | 20/20 | 10,894 | 4,097 | 0 | $0.0031379 | $0.0001569 | 2.06 s / 3.50 s |

Total spend for the measurement: **$0.00477**.

Projected cost, one brief per record:

| Model | Per 1,000 briefs | 21,094 panelled records |
|---|---:|---:|
| google/gemini-2.5-flash-lite | $0.082 | $1.72 |
| anthropic/claude-haiku-5.5 | $0.157 | $3.31 |

Regeneration adds to this: a record is rewritten when its data changes, at most once a day,
and a failed attempt is retried after 10 minutes. The global cap in the function
(`RECORD_LIMITS.globalPerDay`, 5,000 generations a day) bounds the daily spend at about $0.79
with Haiku 5.5 or $0.41 with Gemini 2.5 Flash Lite at these prices.

## Quality (read against the fields each model was given)

**google/gemini-2.5-flash-lite**

- One invented fact: brief 7 (Sittwe Port) says the project is "expected to be completed in
  2026"; the row says `expected_completion: ongoing`.
- Drops figures the row states: brief 6 omits the Rs 76,000 crore cost, brief 1 the latest
  development; brief 13 says only that results are not stated.
- Shortest output (about half Haiku's completion tokens), within the 90-word budget.
- Some awkward lines: brief 1 "does not state the provenance … beyond being unconfirmed";
  brief 5 turns `as_of` into "as of September 2026".

**anthropic/claude-haiku-5.5**

- No wrong fact in 20 briefs. Two additions from outside the fields, both correct: brief 18
  names "NCLT Mumbai" from the case code `(MB)`, brief 19 "NCLT Kochi" from `KOB`.
- Keeps the row's figures and names (cost, jet count, diary number, bill number, dates).
- Longer than asked: points often total 100–130 words against the 90-word budget.
- Brief 15 says "the title field is untitled": the measured prompt printed "Record: Untitled
  record" for rows whose name is in `mp_name`. Fixed after the run: the prompt now takes the
  record's name from `mp_name`, `program_name`, `project_name`, `entity`, `topic` and similar
  columns too, and says "(no title field)" when there is none. Only the "Record:" line of
  briefs 4, 5, 6, 7, 14 and 15 changes (it printed "Untitled record" for them); this was not
  re-measured. Gemini showed no artefact from it.

## Recommendation

Default to **`anthropic/claude-haiku-5.5`** (`DEFAULT_RECORD_BRIEF_MODEL` in
`supabase/functions/desk-brief/record.ts`). The owner's first test is "factual to the row, no
invention": Haiku 5.5 wrote no wrong fact and kept the row's figures, where Gemini 2.5 Flash
Lite invented one completion date and dropped figures. Haiku costs about twice as much, but
both are small: about $3.31 against $1.72 to brief every panelled record once, and about two
seconds against one for the first viewer, who sees "Writing AI brief…" meanwhile.

`google/gemini-2.5-flash-lite` stays the cheaper choice and can be switched to with the
`RECORD_BRIEF_MODEL` secret alone, without a deploy.

Follow-ups, not done here: tighten the prompt so Haiku keeps to the 90-word budget, and
re-measure (another owner-approved run) after that change and the title fix.

## Addendum, 2026-10-15: what changed after the independent review

Added after the measurement; the figures above are unchanged. The design these points describe
is in the migration header (`supabase/migrations/20261015220000_record_briefs.sql`) and the head
of `supabase/functions/desk-brief/record.ts`.

- **Where a brief's content comes from.** When `desk_rows` holds the record, the function briefs
  that stored copy, never the browser's row, and the brief is the record's one shared brief
  (source `desk_rows`). `desk_rows` is a snapshot, so such a brief describes the snapshot's copy,
  which can lag the live row the panel shows; it is rewritten when the copy changes, at most once
  a day.
- **Records not in `desk_rows`** (live rows, modules outside the snapshot) are briefed from the
  row the browser sends (source `client`). Nothing proves that row genuine, so its brief is stored
  under its content hash and served only to a request whose row hashes the same. A row forged
  with a real record id gets a brief that only an identical forgery reads; it never reaches an
  honest viewer and never replaces or stands in for a `desk_rows` brief. A changed live row is a
  new brief (no once-a-day rule), within the same generation limits, so a frequently changing
  live module costs more than the one-brief-per-record projection above.
- **Retries.** A failed attempt is retried after 10 minutes, doubling per failure (10, 20, 40, 80,
  160 minutes, capped at 24 hours), and not again for the same content after five failures; new
  content starts again. (The Results section's "retried after 10 minutes" described the first
  version.)
- **The global cap.** `RECORD_LIMITS.globalPerDay` (5,000) can be used up by about 25 accounts at
  their 200-a-day limit. After that no new brief is written until the next UTC day; every stored
  brief is still served.
- **Modules.** Only modules in the desk catalogue (`supabase/functions/_shared/deskCatalog.json`)
  are briefed; any other module name answers "not available".
- **Model id.** `anthropic/claude-haiku-5.5` is OpenRouter's id, which is the form
  `model_pricing.model_id` stores (`refresh-model-pricing` copies OpenRouter's `id`, and migration
  `20261014230000` joins `model_pricing` on this exact string). Checked from repository data only;
  whether the live row is available today was not checked.

## Raw output

The script's output, unedited.

Run at 2026-10-15T12:36:12.666Z; 20 records x 2 models; total spend $0.004770.

### google/gemini-2.5-flash-lite

| # | Desk / module | Prompt | Completion | Reasoning | Cost (USD) | Latency (ms) | OK |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | global / Open Fronts | 351 | 103 | 0 | 0.0000763 | 1990 | yes |
| 2 | global / Open Fronts | 358 | 106 | 0 | 0.0000782 | 1126 | yes |
| 3 | global / Open Fronts | 347 | 105 | 0 | 0.0000767 | 1289 | yes |
| 4 | global / Global Intelligence | 346 | 99 | 0 | 0.0000742 | 1178 | yes |
| 5 | global / Global Intelligence | 332 | 97 | 0 | 0.0000720 | 1299 | yes |
| 6 | global / Infra | 358 | 104 | 0 | 0.0000774 | 1066 | yes |
| 7 | global / Infra | 343 | 96 | 0 | 0.0000727 | 1102 | yes |
| 8 | national / Bill Passage Probability Index | 444 | 118 | 0 | 0.0000916 | 1021 | yes |
| 9 | national / Bill Passage Probability Index | 440 | 125 | 0 | 0.0000940 | 1090 | yes |
| 10 | national / Policy Pipeline Tracker (Draft-to-Gazette) | 459 | 93 | 0 | 0.0000831 | 1064 | yes |
| 11 | national / Parliamentary Question Database | 420 | 91 | 0 | 0.0000784 | 1055 | yes |
| 12 | national / Parliamentary Question Database | 413 | 99 | 0 | 0.0000809 | 996 | yes |
| 13 | national / Regulatory Body Watch (RBI/SEBI/TRAI/CCI) | 430 | 74 | 0 | 0.0000726 | 1028 | yes |
| 14 | national / Cabinet Decisions | 424 | 93 | 0 | 0.0000796 | 1297 | yes |
| 15 | national / MP Profiles & Performance (MPLAD, attendance, debates) | 320 | 109 | 0 | 0.0000756 | 1334 | yes |
| 16 | law / Supreme Court Order & Judgment Feed | 516 | 117 | 0 | 0.0000984 | 1166 | yes |
| 17 | law / Supreme Court Order & Judgment Feed | 511 | 111 | 0 | 0.0000955 | 1184 | yes |
| 18 | law / NCLT / NCLAT (Insolvency) | 392 | 114 | 0 | 0.0000848 | 1087 | yes |
| 19 | law / NCLT / NCLAT (Insolvency) | 398 | 104 | 0 | 0.0000814 | 1456 | yes |
| 20 | law / WTO Dispute Settlement | 493 | 99 | 0 | 0.0000889 | 1301 | yes |
| | **Total** | 8095 | 2057 | 0 | 0.0016323 | median 1166, max 1990 | 20/20 |

Served as: google/gemini-2.5-flash-lite. Mean cost per brief $0.0000816; projected $0.0816 per 1,000 briefs and $1.72 for 21,094 panelled records (one brief each).

### anthropic/claude-haiku-5.5

| # | Desk / module | Prompt | Completion | Reasoning | Cost (USD) | Latency (ms) | OK |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | global / Open Fronts | 494 | 180 | 0 | 0.0001394 | 3495 | yes |
| 2 | global / Open Fronts | 508 | 228 | 0 | 0.0001648 | 3019 | yes |
| 3 | global / Open Fronts | 480 | 191 | 0 | 0.0001435 | 2125 | yes |
| 4 | global / Global Intelligence | 483 | 202 | 0 | 0.0001493 | 2760 | yes |
| 5 | global / Global Intelligence | 481 | 197 | 0 | 0.0001466 | 1856 | yes |
| 6 | global / Infra | 478 | 214 | 0 | 0.0001548 | 1992 | yes |
| 7 | global / Infra | 497 | 195 | 0 | 0.0001472 | 2026 | yes |
| 8 | national / Bill Passage Probability Index | 602 | 192 | 0 | 0.0001562 | 1963 | yes |
| 9 | national / Bill Passage Probability Index | 551 | 170 | 0 | 0.0001401 | 1827 | yes |
| 10 | national / Policy Pipeline Tracker (Draft-to-Gazette) | 654 | 252 | 0 | 0.0001914 | 2249 | yes |
| 11 | national / Parliamentary Question Database | 564 | 216 | 0 | 0.0001644 | 1883 | yes |
| 12 | national / Parliamentary Question Database | 544 | 233 | 0 | 0.0001709 | 2034 | yes |
| 13 | national / Regulatory Body Watch (RBI/SEBI/TRAI/CCI) | 568 | 160 | 0 | 0.0001368 | 1980 | yes |
| 14 | national / Cabinet Decisions | 546 | 197 | 0 | 0.0001531 | 2060 | yes |
| 15 | national / MP Profiles & Performance (MPLAD, attendance, debates) | 456 | 204 | 0 | 0.0001476 | 2085 | yes |
| 16 | law / Supreme Court Order & Judgment Feed | 639 | 198 | 0 | 0.0001629 | 2058 | yes |
| 17 | law / Supreme Court Order & Judgment Feed | 615 | 203 | 0 | 0.0001630 | 2248 | yes |
| 18 | law / NCLT / NCLAT (Insolvency) | 529 | 214 | 0 | 0.0001599 | 1873 | yes |
| 19 | law / NCLT / NCLAT (Insolvency) | 533 | 231 | 0 | 0.0001688 | 2191 | yes |
| 20 | law / WTO Dispute Settlement | 672 | 220 | 0 | 0.0001772 | 1820 | yes |
| | **Total** | 10894 | 4097 | 0 | 0.0031379 | median 2058, max 3495 | 20/20 |

Served as: anthropic/claude-haiku-5.5. Mean cost per brief $0.0001569; projected $0.1569 per 1,000 briefs and $3.31 for 21,094 panelled records (one brief each).

### The briefs, side by side

#### 1. global / Open Fronts (geopolitics_war_tracker row 0)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
conflict_name: Russia–Ukraine War
region: Eastern Europe
conflict_type: Interstate war
current_stage: active
intensity: Critical
trend: Escalating
started: February 2022
latest_development: Attritional front largely static; artillery, drones and deep strikes define the fighting; Western aid and mobilisation remain decisive variables.
table_kind: state
as_of: 2026-09-07T16:55:06.648Z
provenance: unconfirmed
```

</details>

**google/gemini-2.5-flash-lite**

> **Russia–Ukraine War in Eastern Europe: Active Interstate War Escalating**
>
> - The Russia–Ukraine War is an active interstate war in Eastern Europe that started in February 2022.
> - The conflict is currently at a critical intensity and is escalating, with attritional fighting and deep strikes.
> - The record does not state the provenance of this information or its specific status beyond being unconfirmed.

**anthropic/claude-haiku-5.5**

> **Russia–Ukraine War: an active interstate war in Eastern Europe, rated critical and escalating since February 2022.**
>
> - This record covers an interstate war in Eastern Europe that began in February 2022 and is still active.
> - It is rated critical intensity with an escalating trend, and the latest note says the front is largely static, with artillery, drones and deep strikes defining the fighting.
> - The record does not give casualty figures, territorial changes, or dates for specific events, and its provenance is marked unconfirmed.

#### 2. global / Open Fronts (geopolitics_war_tracker row 5)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
conflict_name: Israel–Hezbollah (Lebanon)
region: Middle East
conflict_type: Interstate war
current_stage: ceasefire fragile
intensity: High
trend: Easing
started: September 2024
latest_development: US/France-brokered ceasefire holding unevenly; disputes over withdrawal lines and Hezbollah disarmament recur.
table_kind: state
as_of: 2026-09-07T16:55:06.648Z
provenance: unconfirmed
```

</details>

**google/gemini-2.5-flash-lite**

> **Israel-Hezbollah Interstate War in Middle East, Fragile Ceasefire Holding Unevenly**
>
> - The conflict is an interstate war between Israel and Hezbollah in the Middle East, which started in September 2024.
> - The current stage is a fragile ceasefire with high intensity, but the trend is easing.
> - The record does not state the specific withdrawal lines or details of Hezbollah disarmament disputes.

**anthropic/claude-haiku-5.5**

> **Israel–Hezbollah conflict in Lebanon: a high-intensity interstate war since September 2024, now under a fragile ceasefire.**
>
> - The record covers an interstate war between Israel and Hezbollah in Lebanon, started in September 2024, with intensity rated High and the trend listed as Easing.
> - The current stage is a fragile ceasefire, which the latest development says is holding unevenly, with recurring disputes over withdrawal lines and Hezbollah disarmament.
> - The record gives no casualty figures, dates for the ceasefire, or details of who brokered it beyond the US and France, and its provenance is marked unconfirmed.

#### 3. global / Open Fronts (geopolitics_war_tracker row 40)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
conflict_name: South Sudan — Instability
region: East Africa
conflict_type: Civil war
current_stage: ceasefire fragile
intensity: Medium
trend: Escalating
started: 2013
latest_development: 2018 peace deal fraying; delayed elections and elite rivalry risk renewed war.
table_kind: state
as_of: 2026-09-07T16:55:06.648Z
provenance: unconfirmed
```

</details>

**google/gemini-2.5-flash-lite**

> **South Sudan Instability: Civil War in East Africa, Fragile Ceasefire Escalating**
>
> - South Sudan has been experiencing civil war in East Africa since 2013.
> - The current stage is a fragile ceasefire with medium intensity and an escalating trend.
> - The record does not state the specific impact of the fraying 2018 peace deal or the exact nature of elite rivalry.

**anthropic/claude-haiku-5.5**

> **South Sudan instability: a civil war since 2013, with a fragile ceasefire and a trend listed as escalating.**
>
> - This record covers a civil war in East Africa that started in 2013, currently at a fragile ceasefire stage with medium intensity.
> - The latest development says the 2018 peace deal is fraying, with delayed elections and elite rivalry posing a risk of renewed war, and the record is marked unconfirmed.
> - The record does not give casualty figures, displacement numbers, named parties, or the specific events behind the escalating trend.

#### 4. global / Global Intelligence (geopolitics_defense_procurement row 0)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
program_name: Rafale Marine (Rafale-M) Naval Fighter
category: Combat aircraft
stage: contract signed
vendor_or_origin: Dassault Aviation, France
detail: 26 Rafale-M jets for INS Vikrant deck operations, part of a broader France-India defense agreement signed in 2025.
table_kind: state
as_of: 2026-09-07T16:55:06.648Z
provenance: unconfirmed
```

</details>

**google/gemini-2.5-flash-lite**

> **Rafale-M Naval Fighter jets for INS Vikrant**
>
> - This record is about the Rafale Marine (Rafale-M) naval fighter jet program.
> - The contract for 26 jets for INS Vikrant deck operations has been signed, as part of a 2025 France-India defense agreement.
> - The provenance of this information is unconfirmed.

**anthropic/claude-haiku-5.5**

> **Rafale Marine naval fighter program: 26 jets from Dassault Aviation for INS Vikrant, contract signed.**
>
> - This record covers the Rafale Marine (Rafale-M) naval fighter program, a combat aircraft from Dassault Aviation, France, at the contract signed stage.
> - It states 26 jets for INS Vikrant deck operations, part of a France-India defence agreement signed in 2025, and the provenance is marked unconfirmed.
> - It does not give a delivery schedule, contract value, or any figures beyond the jet count and signing year.

#### 5. global / Global Intelligence (geopolitics_defense_procurement row 4)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
program_name: Tejas Mk1A Light Combat Aircraft
category: Combat aircraft
stage: deliveries underway
vendor_or_origin: HAL, India
detail: An indigenous fighter upgrade with AESA radar; deliveries to IAF squadrons are ramping up after earlier engine-supply delays.
table_kind: state
as_of: 2026-09-07T16:55:06.648Z
provenance: unconfirmed
```

</details>

**google/gemini-2.5-flash-lite**

> **Tejas Mk1A Light Combat Aircraft: Indigenous fighter upgrade deliveries underway**
>
> - The Tejas Mk1A is an indigenous combat aircraft upgrade by HAL, India.
> - Deliveries to Indian Air Force squadrons are ramping up after earlier engine-supply delays.
> - The record's provenance is unconfirmed and the status is as of September 2026.

**anthropic/claude-haiku-5.5**

> **Tejas Mk1A light combat aircraft: deliveries to IAF squadrons are underway, per an unconfirmed record.**
>
> - The record covers the Tejas Mk1A light combat aircraft, a combat aircraft from HAL, India, described as an indigenous fighter upgrade with AESA radar.
> - Its stage is listed as deliveries underway, with deliveries to IAF squadrons ramping up after earlier engine-supply delays.
> - The record does not give delivery counts, dates or engine details, and its provenance is marked unconfirmed.

#### 6. global / Infra (geopolitics_infra_projects row 0)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
project_name: Vadhavan Port
sector: Major port
country_region: Maharashtra, India
status: under construction
expected_completion: 2030
detail: India's deepest greenfield container port, being built at Dahanu at an estimated cost of roughly Rs 76,000 crore; planned to rank among the world's top-10 container ports.
table_kind: state
as_of: 2026-09-07T16:55:06.648Z
provenance: unconfirmed
```

</details>

**google/gemini-2.5-flash-lite**

> **Vadhavan Port: India's deepest greenfield container port under construction in Maharashtra**
>
> - Vadhavan Port is a major port project in Maharashtra, India, currently under construction.
> - It is planned to be India's deepest greenfield container port, with an expected completion in 2030.
> - The record does not state the specific reasons for its construction or its potential impact.

**anthropic/claude-haiku-5.5**

> **Vadhavan Port, a greenfield container port in Maharashtra, is under construction with completion expected in 2030.**
>
> - The record describes Vadhavan Port, a major port being built at Dahanu in Maharashtra, described as India's deepest greenfield container port. Its status is under construction, with expected completion in 2030.
> - The estimated cost is roughly Rs 76,000 crore, and the port is planned to rank among the world's top-10 container ports. The provenance of this record is marked unconfirmed.
> - The record does not state current progress, the construction phases completed, or any official confirmation of the cost and timeline.

#### 7. global / Infra (geopolitics_infra_projects row 3)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
project_name: Sittwe Port & Kaladan Multi-Modal Transit Corridor
sector: Connectivity corridor
country_region: Rakhine, Myanmar
status: operational (partial)
expected_completion: ongoing
detail: An India-built port and transit corridor linking Kolkata to Mizoram via Myanmar, intended to ease Northeast India's connectivity.
table_kind: state
as_of: 2026-09-07T16:55:06.648Z
provenance: unconfirmed
```

</details>

**google/gemini-2.5-flash-lite**

> **Sittwe Port and Kaladan Corridor: India-built connectivity project in Myanmar**
>
> - This record is about an India-built port and transit corridor in Rakhine, Myanmar.
> - The project is partially operational and expected to be completed in 2026.
> - The record does not state the current operational capacity or the reasons for its ongoing completion.

**anthropic/claude-haiku-5.5**

> **Sittwe Port and Kaladan corridor in Rakhine, Myanmar, an India-built transit route to Mizoram, partly operational.**
>
> - The record describes an India-built port and transit corridor in Rakhine, Myanmar, linking Kolkata to Mizoram and meant to ease Northeast India's connectivity.
> - Its status is recorded as operational (partial), with expected completion listed only as ongoing and no figures given.
> - The record does not state what share of the corridor is working, any dates or costs, or whether its provenance has been confirmed.

#### 8. national / Bill Passage Probability Index (national_bill_tracker row 0)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
bill_name: THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026
bill_number: 156
house: Lok Sabha
sector: Co-operation
date_introduced: 2026-08-09 19:00:00
current_stage: Passed
bill_type: Government
bill_category: Ordinary Bill
source_url: https://sansad.in/rs/legislation
occurred_at: 2026-08-09T19:00:00Z
source_date_raw: 2026-08-10 00:00:00.0
as_of: 2026-09-07T18:01:38.471Z
provenance: official
```

</details>

**google/gemini-2.5-flash-lite**

> **The National Co-operative Development Corporation (Amendment) Bill, 2026, has passed the Lok Sabha.**
>
> - This is the National Co-operative Development Corporation (Amendment) Bill, 2026, a government ordinary bill.
> - The bill was introduced in the Lok Sabha on August 9, 2026, and has now passed.
> - The record does not state the bill's contents or its status in the Rajya Sabha.

**anthropic/claude-haiku-5.5**

> **Lok Sabha record for the National Co-operative Development Corporation (Amendment) Bill, 2026, now marked as passed.**
>
> - The record is a Government Ordinary Bill, number 156, introduced in the Lok Sabha on 9 August 2026 in the Co-operation sector.
> - Its current stage is recorded as Passed, as of 7 September 2026, with the official source linked to the Sansad legislation page.
> - The fields do not state the bill's provisions, the vote counts, or whether the Rajya Sabha has acted on it.

#### 9. national / Bill Passage Probability Index (national_bill_tracker row 2500)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
bill_name: The Handloom Weavers (Welfare) Bill, 2016
bill_number: 161
house: Lok Sabha
sector: TEXTILES
date_introduced: 2016-08-04 19:00:00
current_stage: Lapsed
bill_type: Private Member
bill_category: Financial Bill
source_url: https://sansad.in/rs/legislation
occurred_at: 2016-08-04T19:00:00Z
source_date_raw: 2016-08-05 00:00:00.0
as_of: 2026-09-07T18:01:36.762Z
provenance: official
```

</details>

**google/gemini-2.5-flash-lite**

> **The Handloom Weavers (Welfare) Bill, 2016: A Private Member's Financial Bill Introduced in Lok Sabha**
>
> - This record is about The Handloom Weavers (Welfare) Bill, 2016, a Private Member's Financial Bill.
> - The bill was introduced in the Lok Sabha on 4 August 2016 and has since lapsed.
> - The record does not state the reasons for the bill lapsing or its specific financial implications.

**anthropic/claude-haiku-5.5**

> **The Handloom Weavers (Welfare) Bill, 2016, a Lok Sabha private member bill in the textiles sector, has lapsed.**
>
> - This record is a private member bill, number 161, introduced in the Lok Sabha on 4 August 2016 and classed as a financial bill.
> - Its current stage is recorded as Lapsed, as of 7 September 2026.
> - The record does not state the bill's contents, the reason it lapsed, or any vote or passage figures.

#### 10. national / Policy Pipeline Tracker (Draft-to-Gazette) (national_policy_pipeline row 0)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
policy_name: National Pharmacy Commission Bill 2026
ministry: Health and Family Welfare
stage: Draft released for consultation
source_title: What is the National Pharmacy Commission Bill? Here's what the draft proposes - The News Minute
source_url: https://news.google.com/rss/articles/CBMirwFBVV95cUxQMXBLMWRJR1NCeUctZUV4M1dDdGlmbEpxbHZPWXVVZEpDbnYzal9OSV9yYWpMWnZNVFFoamM3S2hRSEZyV3RFOGw3RWxCMGRUWlBXRzdiWEJ4MzNkY3NtNFEzdkQxU0Z6amJDMXB1ZE0wemlQTEZyTGZpZVdxQWpXWXRjVlV
date_reported: 2026-07-05
```

</details>

**google/gemini-2.5-flash-lite**

> **National Pharmacy Commission Bill 2026 draft released for consultation by Health Ministry**
>
> - The record is about the National Pharmacy Commission Bill 2026.
> - The draft bill has been released for consultation by the Ministry of Health and Family Welfare.
> - The record does not state the specific proposals within the draft bill or its intended impact.

**anthropic/claude-haiku-5.5**

> **Draft National Pharmacy Commission Bill 2026, from the Health and Family Welfare ministry, released for public consultation**
>
> - This record tracks the National Pharmacy Commission Bill 2026, a Health and Family Welfare ministry policy, now at the draft stage released for consultation. It was reported on 5 July 2026.
> - The source is a News Minute article titled 'What is the National Pharmacy Commission Bill? Here's what the draft proposes', reached through a Google News link. The record gives no provisions, figures or timelines.
> - The fields do not state what the draft proposes, its key terms, the consultation deadline, or whether it has been introduced in Parliament. Those details would need the full draft or the ministry's notice.

#### 11. national / Parliamentary Question Database (national_question_database row 0)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
mp_name: Mani A
party: DMK
house: Lok Sabha
ministry: MICRO, SMALL AND MEDIUM ENTERPRISES
subject: Expanding Khadi Production in Tamil Nadu
date: 2026-04-02
question_type: UNSTARRED
source_url: https://sansad.in/getFile/loksabhaquestions/annex/187/AU6302_KIQmzb.pdf?source=pqals
occurred_at: 2026-04-02T00:00:00Z
source_date_raw: 02.04.2026
as_of: 2026-09-07T16:49:32.669Z
provenance: official
```

</details>

**google/gemini-2.5-flash-lite**

> **Lok Sabha Question on Expanding Khadi Production in Tamil Nadu**
>
> - This record is a parliamentary question about expanding Khadi production in Tamil Nadu.
> - The question was asked by MP Mani A of the DMK party in the Lok Sabha.
> - The record does not state the ministry's response or any details about Khadi production figures.

**anthropic/claude-haiku-5.5**

> **Lok Sabha unstarred question by DMK MP Mani A on expanding Khadi production in Tamil Nadu, dated 2 April 2026.**
>
> - This record is an unstarred parliamentary question from Lok Sabha, asked by Mani A of the DMK, under the Ministry of Micro, Small and Medium Enterprises.
> - The record shows only the subject, date and source document; it gives no answer, figures, or current status for Khadi production in Tamil Nadu.
> - The fields do not state what the question asked in detail, what the government replied, or any outcome, so those points must be checked in the linked source PDF.

#### 12. national / Parliamentary Question Database (national_question_database row 4000)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
mp_name: Benny Behanan
party: INC
house: Lok Sabha
ministry: WOMEN AND CHILD DEVELOPMENT
subject: Audit of One Stop Centres
date: 2024-08-02
question_type: UNSTARRED
source_url: https://sansad.in/getFile/loksabhaquestions/annex/182/AU1880_9MOjet.pdf?source=pqals
occurred_at: 2024-08-02T00:00:00Z
source_date_raw: 02.08.2024
as_of: 2026-09-07T16:49:32.669Z
provenance: official
```

</details>

**google/gemini-2.5-flash-lite**

> **Audit of One Stop Centres raised in Lok Sabha by Benny Behanan**
>
> - This record is a parliamentary question about the audit of One Stop Centres.
> - The question was asked by Benny Behanan of INC in the Lok Sabha on 02 August 2024.
> - The record does not state the details of the audit or the ministry's response.

**anthropic/claude-haiku-5.5**

> **Lok Sabha unstarred question by Benny Behanan on audit of One Stop Centres, Women and Child Development ministry, 2 August 2024.**
>
> - This record is an unstarred question tabled by Benny Behanan (INC) in the Lok Sabha to the Ministry of Women and Child Development, dated 2 August 2024, with the subject 'Audit of One Stop Centres'.
> - The record links to an official Sansad annex PDF, but the fields here carry no figures, findings, or answer text, so the current status of any audit is not stated.
> - The fields do not say what the audit found, how many centres were covered, or what the ministry replied; those details would need the source document.

#### 13. national / Regulatory Body Watch (RBI/SEBI/TRAI/CCI) (national_regulatory_watch row 10)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
regulator: RBI
title: Result of Underwriting Auction conducted on July 03, 2026
date: 2026-07-03
detail_url: https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63077
pdf_url: https://rbidocs.rbi.org.in/rdocs/PressRelease/PDFs/PR5995BA86101A4484550AB186A31336905F3.PDF
action_type: other
source_url: https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63077
```

</details>

**google/gemini-2.5-flash-lite**

> **RBI Underwriting Auction Results**
>
> - This record is the result of an underwriting auction by the RBI.
> - The auction was conducted on July 03, 2026.
> - The record does not state the specific results of the auction.

**anthropic/claude-haiku-5.5**

> **RBI press release on the result of an underwriting auction held on July 03, 2026.**
>
> - This record is an RBI press release titled Result of Underwriting Auction, dated 2026-07-03, with links to the detail page and a PDF.
> - The record does not give the auction's amount, participants, tenor, or cut-off figures, as these appear only in the linked documents.
> - The record also does not state what the underwriting auction was for or what the outcome was beyond its title.

#### 14. national / Cabinet Decisions (national_cabinet_decisions row 0)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
topic: Cabinet approves Minimum Support Prices (MSP) for Kharif Crops for Marketing Season 2026-27
ministry: Cabinet Committee on Economic Affairs
date: 2026-05-12
source_url: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2260617
pdf_url: https://www.pib.gov.in/PressReleasePage.aspx?PRID=2260617
occurred_at: 2026-05-12T00:00:00Z
as_of: 2026-09-07T16:45:48.926Z
provenance: official
source_date_raw: 2026-05-12
```

</details>

**google/gemini-2.5-flash-lite**

> **Cabinet Approves Minimum Support Prices for Kharif Crops for Marketing Season 2026-27**
>
> - The Cabinet Committee on Economic Affairs approved minimum support prices for Kharif crops.
> - This decision is for the Marketing Season 2026-27.
> - The record does not state the specific prices approved for each crop.

**anthropic/claude-haiku-5.5**

> **Cabinet Committee on Economic Affairs approves Kharif MSP for marketing season 2026-27.**
>
> - This record is an official entry, dated 12 May 2026, that the Cabinet Committee on Economic Affairs approved Minimum Support Prices for Kharif crops for the 2026-27 marketing season.
> - The fields give no crop-wise prices, percentage increases or total outlay, so the actual price figures are not stated here.
> - The record names only the topic, ministry, date and PIB source link; for the rates and details, the linked official release must be checked.

#### 15. national / MP Profiles & Performance (MPLAD, attendance, debates) (national_mp_report_card row 0)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
mp_name: Mani A
party: DMK
constituency: Dharmapuri
state: Tamil Nadu
questions_asked: 109
committees: Labour, Textiles and Skill Development; Labour, Textiles and Skill Development
source_url: https://sansad.in/ls/members/biographyM/5814?from=members
```

</details>

**google/gemini-2.5-flash-lite**

> **Mani A, DMK MP from Dharmapuri, Tamil Nadu: Questions Asked and Committee Memberships**
>
> - Mani A is a Member of Parliament from Dharmapuri, Tamil Nadu, representing the DMK party.
> - The MP has asked 109 questions and is a member of the committees on Labour, Textiles and Skill Development.
> - The record does not state the MP's attendance or debate participation.

**anthropic/claude-haiku-5.5**

> **Profile record for Mani A, DMK Member of Parliament from Dharmapuri, Tamil Nadu.**
>
> - The record lists Mani A as DMK MP for Dharmapuri in Tamil Nadu, with 109 questions asked and membership of the Labour, Textiles and Skill Development committee, listed twice.
> - The record gives no attendance, debate, or MPLAD fund figures, and does not give a term period or a date for these counts.
> - It does not explain the scope of the questions or the committee role, and the title field is untitled, so it cannot be read as a full performance review.

#### 16. law / Supreme Court Order & Judgment Feed (judiciary_sc_orders row 0)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
court: Supreme Court
case_title: A.G. KUMAR VS. STATE REP. BY INSPECTOR OF POLICE
diary_no: 26263 / 2026
order_date: 03-Jul-2026
topic: Bail / Criminal
pdf_url: https://www.sci.gov.in/view-pdf/?diary_no=262632026&type=o&order_date=2026-07-03&from=latest_judgements_order
source_url: https://www.sci.gov.in/view-pdf/?diary_no=262632026&type=o&order_date=2026-07-03&from=latest_judgements_order
source_date_raw: 03-Jul-2026
occurred_at: 2026-07-02T19:00:00Z
as_of: 2026-09-07T16:55:06.648Z
provenance: official
```

</details>

**google/gemini-2.5-flash-lite**

> **Supreme Court order on bail in A.G. Kumar vs. State Rep. by Inspector of Police case.**
>
> - This record is a Supreme Court order concerning bail in the case A.G. Kumar vs. State Rep. by Inspector of Police.
> - The order was issued on 03 July 2026 under diary number 26263/2026.
> - The record does not state the outcome of the bail application or the reasons for the order.

**anthropic/claude-haiku-5.5**

> **Supreme Court order in A.G. Kumar vs State, a bail and criminal matter dated 3 July 2026.**
>
> - This is a Supreme Court order and judgment feed entry for a bail and criminal matter, diary number 26263 of 2026, titled A.G. Kumar vs State Rep. by Inspector of Police.
> - The order is dated 3 July 2026, and the record is marked as an official source with a link to the order PDF.
> - The record does not state the outcome of the bail application, the charges involved, the parties' arguments, or the reasoning in the order.

#### 17. law / Supreme Court Order & Judgment Feed (judiciary_sc_orders row 100)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
court: Supreme Court
case_title: K. SREENIVASA VS. V. SHOBHA,
diary_no: 33708 / 2026
order_date: 03-Jul-2026
topic: Other / Unclassified
pdf_url: https://www.sci.gov.in/view-pdf/?diary_no=337082026&type=o&order_date=2026-07-03&from=latest_judgements_order
source_url: https://www.sci.gov.in/view-pdf/?diary_no=337082026&type=o&order_date=2026-07-03&from=latest_judgements_order
source_date_raw: 03-Jul-2026
occurred_at: 2026-07-02T19:00:00Z
as_of: 2026-09-07T16:55:06.648Z
provenance: official
```

</details>

**google/gemini-2.5-flash-lite**

> **Supreme Court Order in K. Sreenivasa VS. V. Shobha, Diary No. 33708 / 2026**
>
> - This record is a Supreme Court order in the case K. Sreenivasa VS. V. Shobha.
> - The order was issued on 03-Jul-2026.
> - The topic is classified as Other / Unclassified.

**anthropic/claude-haiku-5.5**

> **Supreme Court order in K. Sreenivasa vs V. Shobha, diary no. 33708/2026, dated 03-Jul-2026.**
>
> - This is a Supreme Court order and judgment feed record for case K. Sreenivasa vs V. Shobha, filed under diary no. 33708/2026.
> - The order is dated 03-Jul-2026, and the topic is listed as Other / Unclassified, with an official source link to the order PDF.
> - The record does not state what the order decided, the parties' arguments, or any outcome, so the substance must be checked in the PDF.

#### 18. law / NCLT / NCLAT (Insolvency) (judiciary_nclt_orders row 0)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
date: 2026-08-06
subject: In the matter of CMP EURO TECHNOPLAST PVT. LTD. [C.P. (IB)/1231(MB)2025]
entity: CMP EURO TECHNOPLAST PVT. LTD.
remarks: Admission - Final Order
source_url: https://ibbi.gov.in/uploads/order/20d61d2381547cbe169cd942379a5fee.pdf
```

</details>

**google/gemini-2.5-flash-lite**

> **CMP EURO TECHNOPLAST PVT. LTD. Insolvency Proceedings**
>
> - This record concerns insolvency proceedings for CMP EURO TECHNOPLAST PVT. LTD.
> - The case is CP (IB)/1231(MB)2025 and a final order for admission was issued on 2026-08-06.
> - The record does not state the reasons for the insolvency or the outcome of the final order.

**anthropic/claude-haiku-5.5**

> **NCLT Mumbai issues final admission order in insolvency case against CMP Euro Technoplast Pvt. Ltd.**
>
> - The record is an NCLT final order dated 6 August 2026 admitting the insolvency petition C.P. (IB)/1231(MB)/2025 against CMP Euro Technoplast Pvt. Ltd.
> - The record's only status detail is the remark 'Admission - Final Order', so the case is recorded as admitted.
> - The record does not state the petitioner, the amount of debt, the resolution professional, or any next steps, and these must be checked in the linked order PDF.

#### 19. law / NCLT / NCLAT (Insolvency) (judiciary_nclt_orders row 60)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
date: 2026-07-21
subject: In the matter of Air Travel Enterprises India Ltd. [IA(IBC)/313/KOB/2026 in CP(IB)/33/KOB/2023]
entity: Air Travel Enterprises India Ltd.
remarks: Others
source_url: https://ibbi.gov.in/uploads/order/c81065bbabcaac863289861baee7d78d.pdf
```

</details>

**google/gemini-2.5-flash-lite**

> **Air Travel Enterprises India Ltd. insolvency proceedings before the National Company Law Tribunal.**
>
> - This record concerns insolvency proceedings for Air Travel Enterprises India Ltd.
> - The proceedings are registered under IA(IBC)/313/KOB/2026 in CP(IB)/33/KOB/2023.
> - The record does not state the current status or outcome of these proceedings.

**anthropic/claude-haiku-5.5**

> **NCLT Kochi application IA/313/2026 in insolvency case of Air Travel Enterprises India Ltd, dated 21 July 2026**
>
> - This record is an order or filing in the matter of Air Travel Enterprises India Ltd, under application IA(IBC)/313/KOB/2026 in CP(IB)/33/KOB/2023, dated 21 July 2026.
> - The record is tagged under the category 'Others' and gives the source as an IBBI order PDF, but the fields do not state the relief sought or the decision.
> - The fields do not describe the parties' arguments, the outcome, or any directions, so those details cannot be confirmed from this record.

#### 20. law / WTO Dispute Settlement (judiciary_wto_disputes row 600)

<details><summary>Fields given to the model</summary>

```
Fields of this record (the only evidence you may use):
ds_number: DS601
ds: 601
title: Anti Dumping Measures on Stainless Steel Products from Japan
short_title: China — AD on Stainless Steel (Japan)
complainants: Japan
respondents: China
respondent: China
third_parties: Australia, Brazil, Canada, European Union, India, South Korea, Mexico, Russia, Saudi Arabia, Chinese Taipei, United States, Vietnam
consultations_requested: 2021-06-11
status: Report(s) adopted, with recommendation to bring measure(s) into conformity
status_date: 2023-07-28
reports_adopted: true
agreements: Anti-dumping, GATT 1994
last_updated: 2025-03-07
source_url: https://www.wto.org/english/tratop_e/dispu_e/cases_e/ds601_e.htm
source: World Trade Organization
as_of: 2026-10-13T14:08:16.173Z
```

</details>

**google/gemini-2.5-flash-lite**

> **China — Anti-Dumping Measures on Stainless Steel Products from Japan (DS601)**
>
> - This record concerns China's anti-dumping measures on stainless steel products from Japan.
> - Reports have been adopted, recommending China bring its measures into conformity, as of July 2023.
> - The record does not state if China has complied with the recommendations.

**anthropic/claude-haiku-5.5**

> **WTO DS601: Japan's complaint against China's anti-dumping measures on stainless steel products, reports adopted in 2023.**
>
> - This record covers WTO dispute DS601, in which Japan is the complainant and China the respondent, over anti-dumping measures on stainless steel products. Consultations were requested on 11 June 2021.
> - The status is that the reports were adopted on 28 July 2023, with a recommendation to bring the measures into conformity, and the record was last updated on 7 March 2025.
> - The record does not state the dispute's findings, the specific products covered, the duty rates, or whether China has complied with the recommendation.

