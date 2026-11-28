# File-manager credit functions: no double charge, cancel only before the worker starts (F413)

> **Status: Living (2026-11-27).** Merged in PR #248 (`e0966466`) and applied to NTER on 2026-11-27 with the
> developer's go-ahead; the record is F413 in `docs/plans/open-work-done.md`. The `file_indexing_billing` flag is still
> off. Finding 6 and the Cancel button are F415.

## Current state

The review of 2026-11-27 (`docs/research/2026-11-27-f413-file-manager-credit-review.md`) reproduced four defects in
the file-manager credit functions as F411 adopted them from NTER:

- two concurrent enqueues for one file create two jobs and two holds;
- a repeated settlement of a failed job charges again;
- cancelling a running job releases its hold while the worker goes on, charges in full and sets the job back to
  completed;
- the job row keeps only the last charge.

From reading, a retry also re-arms the hold with its old rate and sweep mark.

On NTER the flag row is absent and `user_file_jobs` has no rows, so nobody has been billed.

## Decisions (developer, 2026-11-27)

- A job the worker has started runs to the end and is billed; that is the design.
- Cancel is therefore allowed only while a job is queued. A running job refuses with `job_running`, and the user is
  never told credits were released when they will not be.
- The double charges are defects and are fixed.

## Outcome

`supabase/migrations/20261127100000_file_manager_credit_fixes.sql` changes the following, and nothing else.

**Index and column:**
- A partial unique index `user_file_jobs_one_active_per_file` on `user_file_jobs (file_id)` for `queued` and `running`
  jobs.
- A column `user_file_jobs.settled_attempt`.

**The four functions:** F411's text, with only the changes marked `F413` in them.
- `user_file_enqueue_indexing`: a clash on the index becomes its existing `duplicate_job` error (23505).
- `user_file_job_cancel`: refuses a running job with `job_running` (P0001). A queued job is cancelled as before, its
  hold released, and nothing is charged.
- `user_file_job_retry`: re-arms the hold at the current rate with no sweep mark. Retrying while another job for the
  file is active gives `duplicate_job`.
- `user_file_settle_credits`: settles each attempt once. A repeated call for the same `attempt_count` returns
  `already_settled` and charges nothing. The job row adds each attempt's charge.

**Unchanged:** signatures, SECURITY DEFINER, `search_path`, grants, the flag gate, the hold estimate, the charge
arithmetic, `user_file_advance` and `user_file_claim`.

**Self-check:** at the end, the migration raises, and so undoes everything, if the index, the column, a marked change
or a grant is not as stated.

## Acceptance evidence

`supabase/tests/file_manager_credit_fixes.sql`, through `run.sh` on its own chain:
- the chain is `file_manager_grants`' chain, then `bootstrap_file_manager_credit_stubs.sql`, then the migration as a
  non-superuser;
- the stand-ins lock the wallet `FOR UPDATE`, write a ledger row and move the balance, as NTER's private functions do.

It checks:

- **1a:** a second active job for one file is refused.
- **1b, 1c:** retrying a failed job while the file has another active job gives `duplicate_job`, and the file keeps one
  active job.
- **2a, 2b:** a repeated settlement for the same attempt returns `already_settled`, and the ledger holds one charge.
- **5:** a retry re-arms the hold at the current rate, with no sweep mark.
- **4:** after a charged failure, a retry and a charged second attempt, the job row shows the ledger's total (195).
- **3a to 3d:**
  - cancelling a running job is refused with `job_running`;
  - a queued job is still cancelled;
  - the running job keeps running with its hold open;
  - the cancelled job's hold is released and it is charged nothing.
- **Unchanged behaviour:** `enqueue` still refuses while the flag is off, and the four functions keep their grants.

Vacuity: without the migration the run fails. Run past each error, without the migration, checks 1a, 1b, 2a, 3a, 4 and
5 each fail on their own defect. With it, all 18 checks pass.

Concurrency, run by hand on a migrated throwaway database: session A enqueued and held its transaction open for 3
seconds; session B enqueued for the same file 1 second later. B was refused with `duplicate_job`, leaving one job and
one hold of 80 credits. Before the migration the same test gave two jobs and two holds.

## Scope

The migration, the fixture, the stand-ins bootstrap, one chain entry in `supabase/tests/run.sh`, this spec, and F413
in `docs/plans/open-work.md`.

## Exclusions and follow-ups

- **Finding 6:** a 30-minute hold can lapse while a long job runs, so the user can overspend into debt. Its fix ties
  the hold to the worker's lease, which reaches into the worker's code. It stays open under F413.
- **The file manager's Cancel button** (`src/fileManager/DriveJobsDrawer.jsx` on the `file-manager` branch) is shown
  for running jobs too. After this change, pressing it on a running job shows the `job_running` message. Hiding it for
  running jobs is the contributor's change; telling the contributor is the developer's step.
- **F414**, the declared file size, is unchanged.
- **Applying:** on NTER by the route used for F410 and F412, with the history row under `20261127100000`, with the
  developer's yes. Before: a read-only check that the four functions still match F411's text and that `user_file_jobs`
  has no duplicate active jobs. Only then can the flag be turned on.
