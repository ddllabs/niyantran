# Applied on NTER: the five-desk search-only route (F374)

> **Status: Historical (2026-11-20).** What was deployed and applied to NTER on 2026-11-19 and 2026-11-20 (UTC) on the
> developer's go-ahead for each step, what was checked, and what was not. Nothing was loaded. Spec:
> [five-desk search-only route](../specs/2026-11-19-five-desk-search-only-route.md). Open work: F374 (the screens,
> policies and loads).

All three steps came from `main` at `45920b7d` (PR #192), clean, with CI green on that commit. Before them: 25,894
documents; 22,437 ingest jobs, all `succeeded`; none queued or running; 107 history rows; no other session active on
the database.

## What changed

| Step | Before | After | Time (UTC) | Rollback |
|---|---|---|---|---|
| `admin-ingest` | version 15 in the function list, from `dc92bb60` | version 16, active | 2026-11-20 00:00:29 | redeploy from `dc92bb60` |
| `ingest-worker` | version 13, from `885acc31` | version 14, active | 2026-11-20 00:00:31 | redeploy from `885acc31` |
| Migration `20261123090000_national_search_only_five_desks` | the five desks refused `no_adapter`; one shared host list; no history row | six search-only desks, hosts checked per desk; helper `ingest_search_only_desks`; both unique indexes rebuilt over the six desks; history row present | 2026-11-20 00:50 | the Down section in the migration's header, clean only before the first admission of one of the five desks |
| `pg_cron` job 4 (`ingest-worker`) | active | paused 00:50:39, resumed 00:50:50 | 2026-11-20 00:50 | none needed |

Deploy command, as before: `supabase functions deploy <name> --use-api --project-ref vfgcppstyzjarlzyqdac`
(CLI 2.117.0). `research-chat` was not redeployed; it stays at version 113 and does not yet carry the wider publisher
table.

## Checks

**Dry run, 2026-11-19 23:04.** The file with its trailing `commit;` and `analyze` replaced by checks and `rollback;`,
about 5 s, with the worker running and the queue empty. Every guard in the file passed. Inside the transaction:

- the helper lists the six desks with the hosts the spec names;
- `ingest_admit_adapter` returns `national_search_only` for each of the six, and nothing for the hyphen spelling of
  Transfers, for Parliamentary Questions and for an unknown desk;
- none of `anon`, `authenticated`, `corpus_ingest` and `service_role` may execute the helper or the three replaced
  functions; each replaced function keeps its security mode, search path and volatility;
- both indexes carry the six-desk predicate; each build took about 0.2 s and each drop and rename under 0.2 s;
- `ingest_register_batch` and `ingest_register_text_unmapped` kept their hashes.

After the rollback the function hashes, both index definitions, the document count, the history and the schedules were
identical to the read taken before, and no temporary index remained. A first attempt a few seconds earlier stopped on
a syntax error in the wrapper before the transaction opened; it ran nothing.

**Deploys, 2026-11-20 00:00.** The Edge Function tests passed on the commit (1,897). Of the shared files the two
functions import, those that differ from the earlier deploys are `suppliedText.ts`, `publisher.ts`, `citations.ts`,
`retrieval.ts` and, for `admin-ingest`, `embed.ts`. The function list shows both new versions, active. The worker's
first three scheduled runs afterwards succeeded and their calls returned 202.

**Apply, 2026-11-20 00:50.** The same file body, byte for byte, then a guard that raises unless the six function
hashes equal the dry run's, the document count is unchanged, every job is `succeeded`, the helper lists six desks and
no history row exists; then the history row, `commit;` and `analyze public.documents`. About 4 s to the commit with
the worker paused, and no lock timeout. Read afterwards from a separate read-only session:

- the hashes (`md5` of the function source, first eight characters): `ingest_admit_adapter` `19880f9b`,
  `ingest_admit_document` `106826dc`, `ingest_admit_tier` `b4cf635c`, `ingest_search_only_desks` `f33de088`;
  unchanged, `ingest_register_batch` `1d91963c` and `ingest_register_text_unmapped` `9a6514f6`;
- both indexes exist under their old names with the six-desk predicate, and no temporary index remains;
- 25,894 documents; 22,437 jobs, all `succeeded`; the history holds 108 rows and includes `20261123090000`;
- `documents` was analysed at 00:50:48 with 25,894 live rows;
- job 4 is active; the 13 runs between 00:45 and 00:52 succeeded, and the two calls after the resume returned 202.

## Not verified

- No record of the five desks has been registered or admitted on NTER. Admission with a desk's own host and refusal
  with another desk's host rest on the migration's fixture in `supabase/tests/`, run in CI.
- No job has run through the new function versions: nothing was queued. `admin-ingest` has not been called since its
  deploy.
- A probe of `ingest_admit_tier` with a record holding only the tier and desk returned nothing for every desk,
  Regulatory included, so it showed nothing either way.
- The lock times were read at a quiet moment with no other session active.
- The definitions the migration replaced were compared with the repository only through the migration's own guards.
