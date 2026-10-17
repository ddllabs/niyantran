# F218: reliable Satellite Infrastructure landing summary

> **Status: Normative.** Owner authorized implementation, verification, push and
> deployment on 2026-10-17. Base `dbaa415`.

## Current state and problem

The Satellite module uses `serveFeatureFeedStoredFirst`; both landing routers
pass the live-first loader to its summary. The prior rollout observed a summary
502 despite 15 usable stored launches. A fresh pre-change GET returned 200/live
and 12 launches, while the module returned 200/store with the same 12 launches.
An upstream recovery does not remove the unnecessary dependency on that source.

## Outcome and acceptance evidence

Only Satellite Infrastructure's Global landing summary adopts the module's
existing stored-first loader. With a usable snapshot, both routers return 200,
the prepared stored row count, source links and existing coverage limitation,
without contacting the launch source. Preserve fetched time and stale markers
in the bounded summary; retrieval time must not replace content/source dates.
Existing freshness ceilings, disabled/missing-store behavior and live/archive
fallback rules remain owned by the canonical loader. A failed source with no
usable store must still report an error rather than inventing a zero count.
GET-only and feature validation remain enforced. Other summaries keep their
current loaders; broad adoption needs shared-register/count review first.

Prove the regression fails without the routing fix in each router. Exercise
stale, disabled, missing and beyond-ceiling snapshots with controlled upstream
success/failure; run the focused and complete suites, lint, build, bundle gate
and router import. Confirm the production commit is READY and the landing
returns a stored count matching its module after release.

## Scope and exclusions

Write scopes: `api/router.js`, `server/featureFeed.mjs`,
`server/globalLandingSummary.mjs`, `src/lib/globalLandingApi.test.js`, this
spec, its plan/evidence, the orientation comparison and `docs/plans/open-work.md`.
No database/schema, refresh-job, Edge Function, authentication, payment,
dependency or protected dataset changes. Corpus ingestion remains excluded.
T15's scheduled observation gate remains required before payment work.

## Risk and rollback

The reused store reader already applies latest-run filtering and age ceilings.
Preserve those semantics rather than building a separate summary store reader.
If summary errors/count regressions appear after release, hold further work
and use the existing rollback runbook with owner authorization. Last known
production source commit is `dbaa415`; no database rollback is needed.
