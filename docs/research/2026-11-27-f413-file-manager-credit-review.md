# File-manager credit functions: review (F413)

> **Status: Historical (2026-11-27).** A dated record of a read-only review. Nothing was changed on NTER or in the
> repository by it. The fixes are tracked under F413 in `docs/plans/open-work.md`; the storage-size finding is F414.

## Scope

The four functions that hold or settle credits for private-file indexing, as they run on NTER and as `main` carries
them in `20261126150000_file_manager_schema.sql` (F411):

- `user_file_enqueue_indexing(uuid)`: a signed-in user starts indexing one file; it creates a job and a credit hold.
- `user_file_job_cancel(bigint)`: the user cancels a job; it releases the hold.
- `user_file_job_retry(bigint)`: the user retries a failed job; it re-arms the hold.
- `user_file_settle_credits(bigint, bigint, text, integer, integer, numeric)`: the worker (service role) charges the
  actual cost and closes the hold.

They were read against the credit system they call on NTER: `private.credit_refresh`, `credit_wallet`,
`credit_sweep`, `credit_entry`, `credit_draw`, `credit_current_amount` and `credit_config`. They were also read
against main's own pattern for holds, `reserve_turn_credits`, `settle_turn_credits` and `credit_charge_turn`. On the
callers' side, the review read the worker's `supabase/functions/ingest-worker/user-file-step.ts` and the queue functions
`user_file_claim` and `user_file_advance`, on the `file-manager` branch.

## State on NTER (read-only, 2026-11-27)

- The `file_indexing_billing` row is absent from `app_flags`, so `enqueue` and `retry` refuse every call
  (`feature_disabled`).
- There are no rows in `user_file_jobs`, no `credit_holds` row with a `file_job:` key, and no `credit_ledger` row with
  one. Nobody has been held or charged by these functions.
- `credit_settings`: `inr_per_credit` 0.01 (one credit is one paisa, so the functions' `*_paise` names are credits),
  `usd_to_inr` 95, unchanged since 2026-10-17.

Every finding below must be fixed before the flag is turned on.

## How the tests were run

Findings 1 to 4 were reproduced on a throwaway local PostgreSQL 16 database:

- **Build:** `bootstrap_auth`, `bootstrap_storage`, `bootstrap_file_manager_deps`, then F410, F411 and F412 as on
  `main`. The four functions are therefore NTER's text.
- **Stand-ins** for the private credit functions:
  - `credit_wallet` locks the wallet row `FOR UPDATE`, as NTER's does;
  - `credit_entry` writes a ledger row and moves the balance;
  - `credit_draw` does nothing;
  - `credit_current_amount` returns the credits unchanged.
- **Data:** the flag row set to `true`, one user with 10,000 credits, and one uploaded file of 120,000 bytes, whose
  hold is 2 pages × 40 = 80 credits.

The database was dropped afterwards. Findings 5 to 7 come from reading the code and were not executed.

## Findings

### 1. Two concurrent enqueues index and bill one file twice (high, executed)

`enqueue` checks for an active job on the file (`EXISTS ... status IN ('queued','running')`) before it takes any lock.
The first lock it takes is the wallet's, inside `credit_refresh`. No unique index stops a second active job for the
same file: `user_file_jobs` has only its primary key and two non-unique queue indexes.

- **Test:** session A called `enqueue` and held its transaction open for 3 seconds. Session B called `enqueue` for the
  same file 1 second later. B passed the check, waited on A's wallet lock, and then went on.
- **Result:** two jobs (`1:queued`, `2:queued`) and two open holds (160 credits) for one file. The worker would process
  both and charge for both. A double click is enough.
- **Fix:** a partial unique index on `user_file_jobs (file_id) WHERE status IN ('queued','running')`, or a lock on the
  file row (`SELECT ... FOR UPDATE` on `user_files`) taken before the check.

### 2. Settling a job twice charges twice (medium, executed)

`settle` returns `already_settled` only when the job is `completed` with `credits_settled_paise > 0`. A second call for a
failed job, or for a completed job charged 0, writes another ledger charge.

- The worker settles failed jobs with the embedding cost already spent (`p_final_status: 'failed'` with
  `p_actual_cost_usd: spentEmbedCost` or `embedCost`). A repeated call, for example after a network error, would bill
  that cost again.
- **Test:** job 2 was settled as `failed` with US$0.01 (95 credits) twice. The result was two ledger charges totalling
  190 credits, while the job row shows 95.
- **Fix:** settle once per attempt. For example, record the settled attempt on the job and return `already_settled`
  when it equals `attempt_count`, or key the idempotency on the hold (settle only while it is open).

### 3. Cancelling does not stop the worker or the charge (medium, executed)

`cancel` sets the job to `cancelled`, releases the hold and resets the file to `not_indexed`, and tells the user the
held credits are released. `user_file_advance` and `settle` never check for `cancelled`. A worker already running the
job moves it back to `running`, charges the full cost and marks it `completed`.

- **Test:** the user cancelled job 1 and was told 80 credits were released. The worker then advanced it, settled it
  with US$0.02 (190 credits) and completed it.
- **Result:** the job became `completed` with 190 credits settled, the file `indexed`, and the charge was made after
  the hold was released.
- **Fix:** `advance` refuses a cancelled job, and `settle` does not reopen one. What a cancelled job is charged is a
  product decision: the cost already spent, or nothing.

### 4. The job row keeps only the last charge (low, executed)

`settle` overwrites `credits_settled_paise` with the current charge.

- **Test:** after the charged failure in finding 2, job 2 was retried and settled as `completed` with 100 credits.
  The job row shows 100 settled; the ledger holds 290 for `file_job:2` across three charges.
- The ledger is correct; the job row understates what the user paid.
- **Fix:** add to the column, or read the total from the ledger.

### 5. Retry does not reset the hold's sweep mark or rate (low, read)

`retry` re-arms the hold with `ON CONFLICT ... DO UPDATE`, setting `credits`, `expires_at`, `settled_at` and
`shadow_blocked`. It leaves `swept_at` and `inr_per_credit` as they were. Main's `reserve_turn_credits` resets both
when it re-arms a hold.

- **Effect on the rate:** a hold sized in current credits but stored with an old rate is valued wrongly by
  `credit_current_amount`.
- **Effect today:** none, because the rate has not changed since 2026-10-17.

### 6. A hold lasts 30 minutes, a job can last longer (low, read)

- The hold expires 30 minutes after `enqueue` or `retry`.
- The worker's lease is 300 seconds and is renewed by `advance`, and `claim` takes back a job whose lease lapsed.
- A long or reclaimed job stops being reserved after 30 minutes. The user's available balance rises, so they can spend
  it elsewhere. `settle` still charges the full cost; `credit_draw` turns any shortfall into debt.
- `credit_sweep` marks expired `file_job:` holds as swept and charges nothing for them, because `credit_charge_turn`
  finds no research turn with that key.

### 7. The hold and the storage quota trust the size the client declares (low, read; tracked as F414)

- `user_file_prepare_upload` takes `p_size_bytes` from the client, and `user_file_complete_upload` never compares it
  with the stored object.
- For credits, a smaller declared size gives a smaller hold, unless the worker has already recorded `page_count`. The
  charge is still the actual cost, so the effect is the debt in finding 6.
- The storage quota (`user_storage_used_bytes`, F410) counts the same declared size, which is outside F413.

## Compared with main's credit pattern

Main's `reserve_turn_credits` and `settle_turn_credits` are SECURITY DEFINER with `search_path ''` and are not
executable by `authenticated`: only server code holds and settles credits.

The file manager's `enqueue`, `cancel` and `retry` are called by the signed-in user directly, with `search_path` set to
`public, private, pg_temp`. The review found no way to use this against another user:

- each function acts only on rows of `auth.uid()`;
- a hold can only reduce the caller's own available balance;
- `enqueue` and `retry` are gated by the flag;
- `settle` is the service role's alone.

It is still a different pattern from the rest of the credit system. A fix could move the hold to server code, or keep
it in the database with the fixes above.

## Decision needed before the fix

**Cancel mid-run:** charge the cost already spent and keep the job `cancelled`, or charge nothing.
