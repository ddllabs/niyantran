# Deployed to NTER: ingest-worker with the outage release (F328)

> **Status: Historical (2026-11-17).** What was deployed to NTER on 2026-11-17 (UTC) on the developer's go-ahead, what
> was checked, and what was not. No migration was applied in this step; the batch-close migration applied earlier the
> same day is in [its own record](2026-11-17-batch-close-apply.md).

The deploy came from `main` at `885acc31` (PR #164), clean, with CI green on that commit. Before it: 22,437 ingest
jobs, all `succeeded`; none queued or running.

## What changed

| Step | Before | After | Time (UTC) | Rollback |
|---|---|---|---|---|
| `ingest-worker` | the version deployed on 2026-11-12 from `d93325ed` (the function list numbers it 12; the 2026-11-13 record calls it v11) | the next version (13 in the function list), active | 20:16 | redeploy from `d93325ed` |

Deploy command, as before: `supabase functions deploy ingest-worker --use-api --project-ref vfgcppstyzjarlzyqdac`
(CLI 2.117.0). The worker's schedule (cron job 4, every 30 seconds) was left running.

## Checks

- Of the worker's files and the shared files it imports, three differ from `d93325ed`, tests aside, all from the F328
  commit `3ed5ead3`: `ingest-worker/supplied-batch-step.ts`, `ingest-worker/index.ts` and `_shared/embed.ts`.
- The function list shows the new version, active, updated at the deploy time.
- The twelve scheduled runs in the five minutes before the deploy succeeded. The first two after it (20:16:17 and
  20:16:47) succeeded and their calls returned 202; none timed out.
- Afterwards: 22,437 jobs, all `succeeded`.

## Not verified

- No job has run through this version: nothing was queued. F328's path (a provider outage returning unfinished jobs to
  the queue as `embed_outage`) has not run on NTER; it rests on the Edge Function tests.
- Only two scheduled runs after the deploy were read.
- One scheduler HTTP call in the five minutes before the deploy is recorded as timed out. The response table does not
  name the function called, and several schedules share it, so it was not attributed.
