# Planned modules: what sources the repo already has (F196)

> **Status: Historical (dated 2026-10-15).** Read-only research. Sources were tested on 2026-10-15
> with plain GET requests; nothing was loaded or changed.

Owner, 2026-10-15: "our admin panel already has a list of sources, and this code has some Excel files
which show sources. The source is in that only … We just have to make them up and working." The two
tender aggregators are excluded until the owner supplies a source.

## Where sources are named

- The admin API status screen is `src/data/source-registry.json` (138 entries). Only 4 of the 19
  planned modules have an entry: Sports Governance (Google News), Election Forecast (Google News),
  State Fiscal Deep-Dive (RBI press releases RSS), Municipal Tenders (eprocure, "requires terms
  review"). The other 15 are HTML-only rows in `html-feature-map.json` with no source.
- The only spreadsheets are the 69 `backup/*/F*.xlsx` packs. Relevant: `F63_Sports_Governance_Policy`
  (34 news rows, 2026-08-29 to 09-10) and 4 RBI state-bond auction releases in the F20 pack.
- No data.gov.in, NITI, NFHS, UDISE, NCRB or CPGRAMS address appears anywhere in the repo.

## Tests (2026-10-15)

| Source | Result |
|---|---|
| Google News built from each module's name | 200 in 0.3–1.2 s, results off-topic (why the modules were marked planned) |
| Curated Google News queries | Defection 36 relevant in 7 days; Sports governance 35; Governor / President's Rule 57 (noisy); assembly sessions 9; polls 7 |
| RBI press releases RSS (registry) | 200, 0.43 s, latest 10 items only |
| RBI state-bond auction release pages | 200, 0.9–1.6 s, an HTML table per release (state, offered, accepted, cut-off, tenor) |
| RBI Handbook of Statistics on Indian States (Dec 2025, same RBI site) | HTML table pages 200 in ~1.2 s, 181 state-wise tables; the spreadsheet downloads are behind a captcha (not attempted) |
| Manifold search "India election" | 200, 0.87 s, 47 markets, 14 open |
| Wikidata districts (registry) | 833 districts, no indicators |
| Wikidata MLA party histories | 10,469 MLAs with a party, 959 with more than one |

## Per module

| Module | Proposed source | Kind | Effort | Blocker |
|---|---|---|---|---|
| Election Forecast Aggregator | Manifold, filtered to Indian elections | live API | S | thin (about 14 open markets); betting odds, not polls |
| Sports Governance & Policy | curated news query + F63 history | news, scheduled | S | none |
| Governor Friction & President's Rule | curated news query | news, scheduled | S | noisy |
| Legislative Productivity Comparison | curated news query | news | S | no sittings or bills data: news only |
| MLA Defection & Anti-defection | curated news + party-switch register (MLA pack × Wikidata) | news + register | M | only 147 switches dated; no disqualification register |
| Party Organisation Map | party seat counts per state from the MLA register | register | S–M | means party strength, not office-bearers |
| SDL Auction & Borrowing Tracker | RBI press RSS, each release's table kept | scheduled, kept | M | history starts at go-live plus the 4 shipped releases |
| State Economic Data (GSDP) | RBI handbook tables 19–52 | register | M | RBI terms; HTML tables |
| State Fiscal Deep-Dive | RBI handbook tables 164–178 + RSS | register | M | same |
| NITI Aayog State Indices | RBI handbook table 106 (SDG India Index), 10 | register | S after the handbook | other NITI indices absent |
| Cross-State Comparison Engine | handbook + MLA registers | register | M | after the handbook |
| District Health, Education, Economic, Agriculture, Infrastructure | RBI handbook, state level only | register | S each after the handbook | not district data: needs a relabel |
| District Governance & Grievance, District Crime & Safety | none | — | — | stay planned |

## How a module is built

`src/lib/plannedModules.js` and the landing presentation (`configured`), its registry and
feature-map entries (what the admin screen shows), a branch in `serveFeatureFeed` or a
`FEATURE_TOPIC_Q` query, `FEED_SCHEDULE` for outside calls, and for a stored register a
`FEED_REGISTERS` entry plus a mapping in `scripts/load-feed-register.mjs`. Desk summaries
(`stateLandingSummary.js`, `sportsLandingSummary.js`) follow.
