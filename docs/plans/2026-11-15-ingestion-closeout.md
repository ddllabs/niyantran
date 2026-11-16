# Corpus ingestion and hybrid retrieval close-out plan

> **Status: Living.** Written 2026-11-15. Corrected in place as items land. The
> only list of open work is [open-work.md](open-work.md); this plan orders it.

## Purpose

Close the corpus-ingestion programme ([bulk ingestion spec](../specs/2026-11-01-bulk-ingestion.md))
and the hybrid-retrieval programme ([hybrid plan](2026-11-04-hybrid-and-contextual-retrieval.md))
so that nothing is left open without a reason on record.

## Definition of closed

- The Regulatory v1.1 collection is loaded on NTER and passed acceptance.
- Hybrid search has a recorded decision, ship or hold, after one cold measurement.
- Every other item below is done and landed on `main`, or deferred with the reason recorded here and in the tracker.

## Open items by wave

Each item's status is in its tracker entry. Nothing below has landed on `main` unless the tracker says so.

| Wave | Items | What |
|---|---|---|
| 1. Small code | F342 | Script tests run in CI (`task/f342-script-tests`, `4a4fa6d0`). |
| | F340 | Load-proof harness: no default database, load copy refused (`task/f340-f305-proof-harness`, `455c5b57`). |
| | F305 | Failed proof runs keep evidence; acceptance reports index misses (`455c5b57`; `task/f305-acceptance-index-miss`, `1045538f`). |
| | F295 | Retrieval timing tests (`task/f295-retrieval-timing-tests`, `65826255`). |
| | | Wave 1 merged 2026-11-15 as PR #149 (`291c3b95`). |
| 2. Ingestion code, in order | F339 with F345 | Built (`6d428d18`, PR #150). Full live screen at 700: 2,605 screened, 714 held; rehearsal 15 of 15. |
| | F285 | Built (`72fb98e7`): `run` reads partitions from the database; a function creates a partition with its access rules. Not applied. |
| | F325 to F328 | Bill-key role collision; a twice-failed job blocking its batch; failure rate; provider outage failing a whole claim. |
| | F314 remainder | Readiness and the admin readers; a key with house and introduction date. |
| | F305 remainder | Index-miss count shown (`0a3f65ea`); clustered-vector option built (`916b1c4b`). |
| 3. Production steps | | Each on the developer's specific yes, with a rolled-back dry run first. |
| | | Apply `20261113090000_national_search_only` (F330). |
| | | Deploy `admin-ingest`. |
| | | Load Regulatory: done 2026-11-16, 2,605 records ([record](../operations/2026-11-16-regulatory-load.md)); the search check fell from 50 to 40 of 55 and awaits the developer's reading. |
| | | Worker limits: back at `claim_batch` 2, `max_running` 1 since 2026-11-16. |
| | F324, F288 | One cold hybrid measurement straight after the load, counting TOAST reads; then the developer's ship-or-hold decision and the `hybrid_search` flag row. |
| 4. Paperwork | F343 | Done (`626707fe`): 29 marked Historical, 67 left Living. |
| | | Tracker corrections (this pass). |

## Deferred, with reason

| Item | Reason |
|---|---|
| F272, F292 | Developer, 2026-11-15: not built until the corpus size makes them matter. |
| F302 | A split adds a required check name, which needs a branch-protection change; the job ran in about 19 of 30 minutes. |
| F307, Parliamentary Questions screen | Needs its own spec and the missing Rajya Sabha key for v1.4 from the owner. |

F284, F286 and F293 were also proposed for deferral. Their entries describe present behaviour rather than a scale limit, so they stay open until the developer says otherwise.

## Decisions only the developer or the owner can close

- **Owner:** licence confirmation; orders naming individuals; F346 titles, dates and source URLs keyed by `source_key`.
- **Developer:** F279 capacity; F289 headers and model-written context; F338 RBI files; F311 long bills; F312 and the held bills in F314; F283 migration history; whether the agent's first-pass comparison in F346 counts toward the hand check.

## Working method

- One builder per item in its own worktree, on a `task/<slug>` branch; task agents leave work uncommitted.
- An independent review; the supervisor reproduces red and green and makes the commit.
- Nothing is pushed, deployed or applied without the developer's go-ahead ([AGENTS.md](../../AGENTS.md)).
