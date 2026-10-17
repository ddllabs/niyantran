# F223: Reliable stored MLA landing summaries

> **Status: Normative.** Owner approved the scoped implementation, verification,
> push and deployment on 2026-10-17.

## Current state and problem

Both State landing routers use the live-first loader with a four-second limit,
although the corresponding module pages use the canonical stored-first loader.
Read-only diagnosis reproduced MLA Directory summary HTTP 502 in 4.15 s while
its module returned stored data in 0.59 s. With no archive rows after the live
deadline, stateLandingAnswer marks the count error and the router answers 502.
MLA Profiles shares that vulnerable path but passed the probe. The original
two logged requests lack feature names, so neither is conclusively attributed.

Supabase holds 31 enabled Directory variants / 4,104 records. Its normal module
response samples 16 from each variant (496 rows). Profiles holds 400 identities
and 100 coverage rows. Existing summary projection against those stored answers
works, but drops fetchedAt/stale metadata. Directory counts remain sampled
records; no change to count meaning or source completeness is authorized.

## Expected behavior and acceptance

Only `MLA Directory` and `MLA Report Card + Statement Tracker` on the State
landing use `serveFeatureFeedStoredFirst`, in both Vercel and local routing.
The canonical helper already handles fresh/stale/disabled/missing stores and
live fallback. Do not duplicate those rules or increase timeouts. Other summary
loaders, unknown/planned validation, query-tier rules and caching remain intact.

Their stored summaries retain fetchedAt, plus stale/ageMinutes when the helper
serves a stale result, without replacing the source's asOf date. Counts and
source notes retain their existing meaning. If no usable source exists, preserve
the existing truthful error/unavailable response, not an invented zero.

Log failed validated State summaries using only the catalogue feature name,
fixed reason code and allowlisted served value. Do not log raw exception text,
query strings, URLs, caller input, credentials or provider payloads. Unknown
features are rejected before logging. The shared State adapter owns diagnostics
so local and production behavior stays aligned.

Prove both routes serve these two modules despite a failed upstream when the
store is healthy; prove stored time metadata, stale fallback, missing-store/live
fallback and unavailable outcomes, and prove unrelated modules retain routing.
Each new guard must fail against the original behavior before relying on green.

## Scope and boundaries

Runtime: `api/router.js`, `server/featureFeed.mjs`,
`server/stateLandingSummary.mjs`, `src/lib/stateLandingSummary.js`.
Tests: `src/lib/stateLandingStored.test.js`, existing State summary tests if
needed for their documented interface. Records: this spec, the F223 plan and
evidence, sole `docs/plans/open-work.md` tracker, existing cleanup evidence and
`docs/agents/coordination.md` release entry. No new dependencies.

No Supabase schema/data/config/serve/timer writes, forced refreshes, Edge
Function changes, corpus ingestion, payment work, or unrelated module changes.
Do not read dotenv or credential files or modify backup/public data collections.
No SQL change means no local database or Docker requirement.

## Verification and release

Use Vitest with real loaders/store reader where practical and synthetic/injected
network/RPC boundaries. Red-before-green guards, focused checks, full Vitest and
Deno, lint/build/bundle/router import and diff hygiene. Node commands use the
existing external no-dotenv preload guard. No standalone type-check exists.
After green branch CI, merge and push main; confirm matching READY Vercel
production deployment and main CI. Read-only compare both summary/module APIs,
including times/notes and sample counts, then a bounded log scan. Record and
push the release evidence and verify its ordinary CI/deployment as well.

Vercel target: niyantran-six.vercel.app, project
prj_6UiaDz2rkTOmqIOaXnCAs92V7d86 in team_QFu1p3ObeXmlMQczPBcZb582.
Supabase NTER vfgcppstyzjarlzyqdac is read-only. Pre-release production is
`5302dc3`, deployment dpl_9x4jNNLXBW1iNySGQ6WADtji4JNs; restoring it requires
owner approval per the rollback runbook. Keep closure follow-up active and
payment held until M1/M2 closure is actually verified.
