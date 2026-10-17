# Live module status, 2026-10-17

> **Status: Historical (2026-10-17).** A read-only check of production, taken for the milestone
> snapshot in `plans/open-work.md`. Nothing was written to production. Re-run the probe before
> relying on these numbers.

## How it was measured

- **Every desk module on the live site:** `node scripts/module-probe.mjs --out … --compare
  docs/research/2026-10-14-module-audit/probe-before-t1.json` against `https://niyantran-six.vercel.app`,
  2026-10-17 05:52–05:55 UTC (120 modules from `DESK_CATALOGUE`, one request a second). Raw result:
  [`2026-10-17-live-module-status.json`](2026-10-17-live-module-status.json).
- **The scheduled feed store on NTER:** read-only SQL on `feed_state`, `feed_runs` (last 24 hours)
  and `cron.job`, 2026-10-17 about 05:45 UTC.

## The 120 desk modules

All 120 answered HTTP 200.

| How the module is answered | Modules | What it means |
|---|---|---|
| From the scheduled store (`served: store`) | 69 | A timer refreshes the source every 5 min to 1 day; the page reads the stored copy, 0.1–0.7 s |
| From a stored register, computed on request | 2 | Party Organisation Map (MLA register) and Cross-State Comparison Engine (RBI handbook) |
| From a dataset shipped with the site | 42 | Fixed data files (bills, questions, court packs, geo packs, carbon packs, dossiers); no live source |
| Fallback (archive) | 2 | NSE/BSE Delayed Market Feed has no live source (4.1 s, shipped prices as of 15 Jul 2026); MLA Report Card timed out once (0 rows, 4.1 s), then answered live with 500 rows in 0.4 s on a re-probe |
| Planned, empty by design | 5 | State Tender Aggregator, Municipal & Panchayat Tender Aggregator, District Performance Tracker, District Governance & Grievance, District Crime & Safety |

By desk:

| Desk | Modules | Store | Shipped dataset | Other |
|---|---|---|---|---|
| National | 17 | 6 | 11 | |
| Global | 16 | 5 | 11 | |
| Law | 12 | 8 | 4 | |
| Economics | 11 | 9 | 1 | 1 fallback (NSE/BSE) |
| Carbon | 7 | 2 | 5 | |
| Sports | 8 | 8 | | |
| Entertainment | 8 | 8 | | |
| State | 41 | 23 | 10 | 2 computed, 1 fallback (MLA Report Card), 5 planned |

**Modules with a live source: 72 of 120, all answering** (69 store, 2 computed, MLA Report Card).
43 are fixed data (the 42 shipped datasets plus NSE/BSE, which has no live source) and 5 are planned. Against the 2026-10-14 baseline, 79 modules changed, almost
all from "live on every request" to "store"; none disappeared.

### Thin answers worth a look (fewer than 10 rows)

- Governor Friction & President's Rule (1), Legislative Productivity (2), Policy Pipeline (2,
  PIB's latest releases hold few policy items), MLA Defection (4): curated news searches with strict
  headline guards; honest but thin.
- Fixtures & Results — World Leagues (7): its source is failing (below).
- Live Global Stock Exchanges (5), Centre-sanctioned Projects (8), CBAM Watch (7), India CCTS (6):
  small by nature.

## The scheduled feed store

- `feed_state`: 70 module names, 258 store variants (a variant is one table, state or block); 68
  serving. Not serving: MLA Report Card + Statement Tracker (no real source; open-work F160) and
  District Performance Tracker (planned).
- By class: news 32, reference 15, register 9, official 5, events 4, markets 3, charts 2, leaders 1.
- Last 24 hours of runs: 727 ok, 1,063 unchanged, 31 failed, 13 timed out (98% succeeded).
- **One source failing persistently:** Fixtures & Results — World Leagues, 14 consecutive failures,
  last good fetch 2026-10-16 18:35 UTC ("TheSportsDB did not return Premier League, NBA, IPL or La
  Liga"). Its stored copy (7–9 rows) is still served and stops at the 7-day stale ceiling
  (about 2026-10-23). Recorded as open-work F215.
- Other failures were one to three runs each and recovered (Assembly digest, Cabinet Decisions,
  Sports Governance, Statement Tracker, NGT, tribunals, Municipal/Panchayat Watch).
- `feed_items`: 117,028 items. Database: 1,890 MB.
- pg_cron: six jobs active, including job 5 (the feed timer, every 5 minutes).

## Other production facts at the same time

- `main` = `origin/main` = `f1ce760`; CI passed on the last five pushes (`05cc82d` failed on the
  flaky F210 test).
- The site serves `index-DYC_dpIO.js`.
- Migrations: 59 in the repo and 59 applied on NTER; the last is `20261015240000_record_brief_format`.
- Edge Functions: `research-chat` v63, `desk-brief` v16, `ingest-worker` v3, `ingest-documents` v21.
- Corpus: 3,379 documents, 99,225 chunks; `desk_rows` 136,752.
- The homepage still says 246 source endpoints by owner decision (F191); the registry counts 120
  working-route addresses.
