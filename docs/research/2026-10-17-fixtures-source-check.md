# World Leagues fixtures source check

> **Status: Living.** Read-only source observations on 2026-10-17; no production changes.

The configured TheSportsDB public API configuration returned HTTP 403 for all four
league IDs, for both next and past windows. The currently documented public
configuration from [TheSportsDB API documentation](https://www.thesportsdb.com/docs/api)
returned HTTP 200 for all eight requests. No paid account or secret was used.

| League | ID | Next events | Past events |
| --- | --- | --- | --- |
| English Premier League | 4328 | 1 | 1 |
| NBA | 4387 | 1 | 1 |
| Indian Premier League | 4460 | 0 (verified empty) | 1 |
| La Liga | 4335 | 1 | 1 |

Observed successful response times: 287–564 ms. This is a limited next/last-event
sample, not a complete fixture schedule or a guarantee of future availability.
An empty IPL next window is distinct from a failed check. Local tests use isolated
responses: all four leagues checked, one failed league, verified empty windows,
unchanged league IDs and incomplete results rejected from successful refreshes.

Implementation changes only the public configuration in `server/sportsApi.mjs`,
validates the response shape, records next/past coverage per league and avoids
caching incomplete checks. The feature envelope serves a truthful unavailable
status when a league could not be checked; the store can retain its known-good copy.
No timer, paid source, league substitution or production serve switch changed.

Raw diagnostic observations are temporary local files, not durable datasets.
Production closure requires the approved deployment followed by three scheduled
refresh opportunities, checking all four leagues and failure counters each time.
