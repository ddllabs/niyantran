# National Bills load on NTER (F307)

> **Status: Historical (2026-11-10).** What was loaded into the Bills desk on NTER on 2026-11-09 and 2026-11-10, the
> admission-rules change applied between the two loads, and what is still held. Specs:
> [screening stage](../specs/2026-11-10-screening-stage.md), [Bills admission rules](../specs/2026-11-10-bills-admission-rules.md).
> Open work: F307, F311, F312, F313. Raw run outputs stay outside the repository.

## Result

| Load | Runner commit | Bills | Chunks | Embedding cost | Acceptance (50 sampled per file) |
|---|---|---|---|---|---|
| Test file | `8f52b8c7` | 100 | 3,734 | US$0.02 | passed |
| Main load, 6 files | `8f52b8c7` | 5,037 | 240,485 | US$1.21 | all 6 passed |
| Rescued, test file | `39faf8ae` | 100 | 3,823 | US$0.02 | passed |
| Rescued, rest | `39faf8ae` | 443 | 18,905 | US$0.09 | failed, 2 of 50 (below) |
| **Total** | | **5,680** | **266,947** | **US$1.34** | |

Every job succeeded; no document was refused, failed or left uncertain. NTER now holds 8,576 Bills documents, 2,896 of
them from before this load (4 of those never indexed, F312). The database was 16.4 GB after the main load and 16.7 GB
after the rescue (stop line 34 GB).

Settings for the load: collection policy `national-bills` (decision `F307-national-bills-2026-11-10`: Bills only, bill
identity required, US$10 budget, 400,000-chunk ceiling, stop limits with `min_decided` 400), and `ingest_settings`
`claim_batch` 8, `max_running` 16 (they were 1 and 2). Those two settings are still raised; reverting them is one update.

## The admission-rules change, applied between the loads

PR #117 (`39faf8ae`) admits the listing's own bill key and file names with runs of dots. It was applied after the main
load finished, so no batch was in flight (F291):

1. Deployed `ingest-worker` v10 and `admin-ingest` v13 from `39faf8ae`; the downloaded source matched `main`. Rollback:
   redeploy from `360ca683` (v9 and v12).
2. Paused cron job 4 (04:22 UTC), dry-ran `20261110120000_bills_admission_rules.sql` with its trailing commit replaced
   by a rollback and six checks inside the transaction (a plain bill, a dotted name, a listing key are admitted; a dot
   segment, an encoded slash and a foreign key are refused), then applied it with its `schema_migrations` row
   (version and name; the file does not insert one). Resumed cron job 4 at 04:25 UTC.
3. After the apply, a dotted file name that the old rule refused is admitted; the function is `stable` and only
   `postgres` may execute it. The previous definition was saved before the apply.

## The rescued bills

The re-screen at `39faf8ae` passed 959 bills not yet live (953 from v1.1, 6 recovered from v1.2). The plan held 416 of
them: the 411 the first plan held, for the same reasons (403 fail the bill-text check, 8 are over the chunk limit), and
5 newly screened bills whose text does not name the bill. 543 were loaded: 420 under the listing's key, 139 with a
run of dots in the file name. That is fewer than the proof's estimate of about 800, because many of the bills the new
rules let through are held by other checks (page split, link disagreement, length).

## The two acceptance failures in the last file

Both documents are stored, hashed, indexed and fully vectorised; neither is a load defect.

- **The Bills of Lading Bill, 2025 (as passed by Lok Sabha): `link_not_full`.** Its key also holds an `as_introduced`
  document registered on 2026-10-08 that was never indexed and has no job, so the record reads "partial". NTER holds
  four such documents, all Bills (F312).
- **The Insolvency and Bankruptcy Code, 2016 (gazette notification): `probe_not_first`.** The probe searches with the
  document's first chunk, here 244 characters of gazette heading that 12 Bills documents share word for word, so the
  document cannot reach the top ten (F313).

## Still held

- 403 bills whose text does not name the bill (the owner's rule), and 5 more from the rescue: for the owner.
- 49 long bills over the platform's per-document limit (F311).
- The other holds are listed in the screening receipts by reason (page split, link disagreement, unmapped corrigenda,
  duplicate text, dead links in the corrections pack).
