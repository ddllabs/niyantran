# One-paisa credits: local verification and release packet

> **Status: Living.** F225, 2026-10-18 IST. Local verification and separately
> approved production rollout/backfill complete. Reconciliation passed before
> credit writes resumed. Razorpay remains on hold; corpus ingestion excluded.

Original local implementation: `7d7aaa9` on `task/credit-paise-plan`. Release
branch cherry-picks only the three F225 commits, excluding unrelated closure
observations: `3132f78` (spec), `679921a` (implementation), `de51434` (handoff).
Production application release is `de51434`; F225 is closed after reconciliation.

## Outcome and scope

One credit becomes INR0.01. Existing economic value is preserved by converting
balances, debt, allowances and credit thresholds at 10:1. INR prices, provider
USD costs, exchange rate, dates, durations and model entitlements do not change.
Razorpay implementation, final top-up prices, corpus ingestion and M1/M2 T15
are outside this change. Free and paid top-up eligibility remains a requirement
for the later payment implementation; no checkout is introduced here.

The approved specification and ordered plan are under
`docs/specs/2026-10-18-credit-paise.md` and
`docs/plans/2026-10-18-credit-paise.md`. ADR 0013 supplements the original
append-only accounting decision. Historical F111 evidence is retained.

## Implementation inventory

- `20261017194626_credit_paise_contract.sql`: additive private epoch and audit
  mappings, epoch gate before settings/wallet access, hold rate metadata,
  current-unit reports/estimates, unit metadata RPC, versioned adjustment and
  compatible legacy replay. It leaves the live denomination unchanged.
- `20261017194628_credit_paise_convert.sql`: separate atomic cutover. It drains
  expired accounting at the old rate, validates activity and numeric bounds,
  snapshots old entries, bridges debt, closes old positive remainders and mints
  mapped replacements, changes settings, and reconciles every wallet/lot/debt.
  It preserves the operator's prior pause state. Repeating it rejects.
- SQL fixtures cover populated and empty installations, legacy and new
  requests, mixed-era usage, spent signup lineage, future lots, debt, holds,
  later settlement, duplicate source prevention, privileges and rollback.
  The atomic fixture executes the actual cutover without an outer transaction.
- `server/usersApi.mjs` and administrator components preserve the amount's
  observed epoch through retries. Directory balances are suppressed if the
  unit changes during the read. Unknown/stale adjustment units fail closed.
- Credit store and research controller invalidate unit-specific cached amounts.
  Successful charge/estimate results carry their observed unit through the
  consumer continuation; final generation checks reject delayed wallet reads.
  Unversioned streamed amounts are replaced by authoritative saved charges.
  Public plans, billing and Terms show the new allowances and unit. Only Terms'
  effective date changes; other legal policy dates remain unchanged.

## Verification evidence

All Node commands use
`NODE_OPTIONS='--import=/tmp/niyantran-cleanup-no-env/guard.mjs'` to prevent
dotenv loading. SQL uses the two disposable local Docker Postgres containers,
never production as a fixture. No standalone type-check exists or is claimed.

Focused regressions demonstrated failures before the protected fixes:

- Administrator API/components: unit tagging, stale retries, directory
  transition, unavailable-unit controls, old/new economic caps and valid
  four-decimal large amounts.
- Public plan/billing/legal tests: old quantities/unit wording and Terms date.
- Deferred client tests: stale final-session estimates, late v1 metadata,
  unversioned stream charges, and unit changes before result consumers or
  wallet publishers resume. Focused store/controller suite: 137 passed.
- SQL mutation: debt-after-lots fails with numeric overflow; restored ordering
  passes the valid 9-billion balance/debt boundary.
- SQL mutation: split autocommit cutover fails the unchanged-state assertion;
  restored atomic DO passes for both initially paused and unpaused states.
- SQL fixtures fail when their migration is omitted. A separate two-session
  check returned SQLSTATE 55P03 at the epoch gate before a writer read settings.
- Full-row fingerprints cover original ledger entries, draws, charge mappings
  and USD costs, and settled holds. Mutating one original ledger note makes
  the fingerprint assertion fail; the disposable mutation rolled back and its
  mismatch count returned to zero. The strengthened conversion fixture passes
  independently with vacuity after the full matrix's earlier conversion pass.

Focused SQL contract/conversion/empty fixtures pass with vacuity checks. The
first complete SQL run reached all selected fixtures but its shell runner was
edited while running and ended with a parse error; it is not a passing gate.
The stable rerun passed all 44 fixtures, including vacuity and applicable
down/reapply checks, exit 0. The strengthened conversion fixture then passed
with its additional fingerprint assertions. Deno: 1,155 passed, zero failed.

| Command (Node guard as above) | Final outcome |
|---|---|
| `npm run lint` | Pass, zero warnings |
| `npm test` | 6,224 tests passed across 394 files, zero failed |
| `npm run build` | Pass; existing >500 kB chunk advisory retained |
| `npm run check:bundle` | Pass, initial gzip 180,405 bytes against 182,446-byte limit |
| `deno test -A --config supabase/functions/deno.json supabase/functions` | 1,155 passed, zero failed |
| `npm run test:sql` | 44 fixtures passed, vacuity and applicable down/reapply checks |
| `./supabase/tests/run.sh credit_paise_contract credit_paise_convert credit_paise_empty` | Focused contract, populated conversion and fresh install pass with vacuity |
| `./supabase/tests/run.sh credit_paise_convert` | Strengthened full-row fingerprint fixture passes with vacuity |
| `node -e "import('./api/router.js').then(() => console.log('router import ok'))"` | `router import ok` |
| `bash -n supabase/tests/run.sh`; `git diff --check` | Pass |

Final local logs are `/tmp/niyantran-credit-paise-{lint,build,bundle}-verified.log`,
`/tmp/niyantran-credit-paise-vitest-verified.log`,
`/tmp/niyantran-credit-paise-sql-final.log` and
`/tmp/niyantran-credit-paise-deno.log`. These generated logs remain untracked.

The first integrated JavaScript run caught the two final consumer race
regressions during their red stage, plus the existing no-rupee-display source
guard. The latter now allows exactly the metadata-validation read of
`inr_per_credit`, retaining its prohibition on money conversions/display in
credit components. Its focused 19-case guard passes. No credit UI shows a
balance converted into INR.

Local browser verification used the real Vite application: desktop pricing
and a 390-pixel iframe showed 10,000 / 20,000 / 65,000 / 750,000 allowances,
unchanged INR plan prices and the new typical-cost illustration. Mobile Terms
exposed INR0.01 and the 10,000 signup allowance. No browser warnings/errors
were observed. Temporary browser harness was deleted. Signed-in billing and
admin interactions use component tests; no production account was exercised.
The dotenv-blocked Vite server reported the expected missing `SUPABASE_URL`
authentication startup warning. Authenticated live flows were not verified;
no secret files were loaded to enable them. The local server was stopped
after verification; disposable Docker containers retain their prior running state.
Screenshots: `/tmp/niyantran-credit-paise-desktop.png` and
`/tmp/niyantran-credit-paise-mobile.png` (local evidence, not committed).

## Approved release procedure

Exact production target: Supabase NTER `vfgcppstyzjarlzyqdac`, and Vercel
project `prj_6UiaDz2rkTOmqIOaXnCAs92V7d86` in
`team_QFu1p3ObeXmlMQczPBcZb582`. The local implementation request did not
authorize these operations; the owner subsequently explicitly approved push,
deployment and controlled production backfill in this chat.

1. Refresh the read-only inventory and deployed revision. The October 17
   19:30 UTC inventory (3 wallets, 3 lots, 20 ledger entries, 17 lot draws,
   92 charge rows, 18 historical holds, zero active holds) is historical,
   not an execution-time snapshot. Capture original ledger fingerprints,
   lot/hold/cost totals, source keys, settings and allowances without user data
   or keys in logs. Check numeric limits and old wallet reconciliation.
2. Apply only the contract migration, then deploy the compatible client/server.
   Do not run an indiscriminate migration push that also applies the cutover.
   Verify `credit_unit()` is still v1/0.10 and existing reads still work.
3. As database owner, persist `private.credit_epoch.paused = true` in its own
   committed transaction. This is a credit-only write pause. It rejects new
   reservations/admin changes; do not change feed timers, serve flags or data.
   Wait for existing answers/holds/settlement and late cost writes to drain.
   Do not terminate answers. Observe at least the five-minute hold window and
   recheck activity immediately before cutover. Investigate any continuing
   activity rather than assuming elapsed time proves quiescence.
4. Apply only the conversion migration while the persistent pause remains set.
   It uses a 10-second lock timeout and a single atomic DO statement. It must
   retain `paused = true` after success. Any failed guard aborts all conversion
   work; the previously committed pause remains until explicitly cleared.
5. While paused, use direct SELECT queries for reconciliation. Do not invoke
   `my_credits()` as a read-only probe: it refreshes accounting. Compare epoch,
   settings, wallet snapshots, raw ledger sums, open lot remainders minus debt,
   lot draws/conversion debits, debt identity, original ledger fingerprints,
   and unchanged costs/entitlements. Verify signup/monthly source keys and
   replacement lineage. Every assertion must pass before reopening.
6. Explicitly resume credit writes by committing `paused = false`. Verify
   current-unit reports/estimates and administrator unit metadata, and reload
   already-open tabs. An earlier deployed bundle cannot acquire new cache
   guards without a reload. Any paid answer smoke call requires a separately
   authorized bounded execution; read-only inspection is sufficient otherwise.
7. Record actual migration IDs, deployment/commit, before/after counts and
   acceptance evidence. Only then close F225 with landed hashes. Payment work
   still requires actual M1/M2 closure and its own authorization/specification.

## Recovery

A failed cutover rolls back atomically; correct the cause while retaining the
operator's persistent pause. A client rollback must retain the current-unit
contracts. After any new-unit activity, do not divide history by ten or restore
an old database over intervening activity: four-decimal new charges can require
five old-unit decimals. Prepare and verify a forward accounting correction,
preserving original entries and conversion lineage, before any repair.


## Production execution — October 18 IST / October 17 UTC

Owner approval: push, deploy and controlled production one-paisa backfill;
reconcile before resuming credit writes. No Razorpay operation, model call,
corpus operation, feed timer/serve change, provider-key change or database
restart was performed. All ten Edge Function versions and bundle hashes are
unchanged, including the ingestion functions.

- Fresh fetch: clean checkout; `main = origin/main = 1621924`. A dedicated
  `task/credit-paise-release` branch cherry-picked only F225's three commits.
  Runtime `server/`, `src/` and `supabase/` trees match the verified local tree.
- Vercel connector returned its known scope 403. The authenticated CLI API
  fallback succeeded for the exact team/project; no credential files or dotenv
  files were opened. Previous production was `dpl_7YLtFYmpTNqB8QqtNeC9nwa2TET1`.
- Contract migration applied, rate still 0.10 and epoch v1/unpaused. The first
  apply request expired; direct inspection confirmed no schema/history change
  before the fresh retry succeeded. The apply-time version `20261017202608`
  was pinned to local version `20261017194626`, per the rollback runbook.
  `credit_unit()` is executable by authenticated/service roles, not anon;
  administrator adjustment remains service-only.
- Pushed branch, fast-forwarded main, pushed main. Production deployment
  **`dpl_99ho6FyZMshn7f5HECTbpqyMydsM` READY**, exact commit
  **`de51434fdea7934dbefe3026e78eff9f8f9ac5dc`**,
  `niyantran-k937gp4ie-ddl-labs.vercel.app`, serving the production alias.
- First-attempt CI: branch **39066720672**, main **39066765071**, both jobs
  green in both runs. No reruns or waived failures.
- Credit pause committed **20:28:25.540573 UTC**. All 18 holds already swept;
  no active holds or running answers. Last research/transcription cost call
  remained **11:05:48 UTC**, with no new calls through the drain window.
- Immediate pre-cutover check **20:33:44 UTC** confirmed the full five-minute
  window elapsed, original ledger hash unchanged, rate 0.10, pause true and
  zero active activity or wallet mismatches.
- Atomic conversion committed **20:33:51.333374 UTC**. Apply-time version
  `20261017203351` pinned to local **`20261017194628`**. The previous persistent
  pause remained true after success.
- Direct accounting reconciliation **20:33:58 UTC** passed while still paused.
  A separate read-only transaction verified all three accounts' real summary,
  daily timeseries and grouped activity totals against normalized ledger
  charges, both before and after conversion. No `my_credits()` write/refresh
  or paid answer was used as a verification fixture.
- Only after accounting and report checks passed, writes resumed at
  **20:34:28.380845 UTC** (**02:04:28 IST October 18**). Follow-up confirms
  `credit-paise-v2`, rate0.01, `paused=false`, 11 usable model estimates,
  3 wallet mappings and 3 lot mappings.

| Production quantity | Before | After |
|---|---:|---:|
| Wallets | 3 | 3 |
| Aggregate balance | 2,330.9553 old credits | 23,309.553 new credits |
| Aggregate debt | 0 | 0 |
| Open lots | 3 | 3 replacements |
| All retained lots | 3 | 6 |
| Ledger rows | 20 | 26 |
| Original ledger rows retained | 20 | 20, exact fingerprint |
| Historical charges | 669.0447 stored old credits | 6,690.447 projected current credits |
| Cost mappings / provider USD total | 92 / 0.704257 | 92 / 0.704257 |
| Historical lot draws / holds | 17 / 18 | 17 / 18, exact fingerprints |

The six added ledger entries are three explicit remainder conversion debits
(total -2,330.9553) and three replacement grants (23,309.553). Original signup
grants total3,000 and original charge debits -669.0447 remain stored exactly.
The raw ledger sum, including the bridge, is the new wallet balance. It is not
correct to multiply that entire ledger sum again. Each Free cycle still has
its original economic allowance, now10,000, through retained lot lineage.

Every wallet-versus-ledger, wallet-versus-open-lots-minus-debt, before/after
wallet mapping, per-lot draw identity, debt identity, replacement-lineage and
duplicate source-key mismatch count was **zero** before reopening.

Exact retained fingerprints (aggregate full-row checks, no user records):

| Retained object | Before and after MD5 |
|---|---|
| Original 20 ledger entries | `cb2954e2708a8227b93e1863bc2c03b9` |
| 17 lot draws | `54db5d439f19dac3a6ec9572f218fe49` |
| 92 charge mappings and costs | `d29f077fd7cd4f7528bd8f93ebb6ab3c` |
| 18 historical holds | `6897dd90a8a59be43137354b155a44bc` |
| Charged provider-call rows | `f2a2c202af9c588c0aafb27f8f37e28d` |
| Plan entitlement identities/dates | `8da3919158281e5eb0f9c5ac0b709922` |

Plan grants and invoices were empty before and after, with matching empty-set
fingerprints. Plan prices, USD/INR95, launch timestamp,30-day signup validity,
12-month top-up validity, five-minute holds and10% rollover are unchanged.
Allowances are10k/20k/65k/750k; reservation cap3,000.

Production browser verification: Pricing shows the four new allowances,
unchanged INR prices and typical200-credit example; Terms shows INR0.01,
10,000 signup credits and18October2026 date. Public Pricing/Terms HTTP200;
unauthenticated `/api/users` HTTP401. Existing tabs need a reload. Signed-in
browser adjustment/answer execution was not exercised; SQL report checks and
local component tests cover those projections without spending credits.
Bounded Vercel request-log scan for this exact deployment,20:27–20:35:35 UTC,
returned zero HTTP5xx records, no excluded intervals and no further page.

Security advisors show deny-by-default RLS/no-policy information and
intentional authenticated SECURITY DEFINER RPC warnings. The new metadata-only
`credit_unit()` warning is expected: authenticated callers read only the public
unit/rate, with anon execution revoked. No permission expansion to the ledger
or adjustment writer was made. [Advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

### Legacy backfill interpretation

Historical backfilled ledger rows retain their original number and frozen
0.10 rate. Current usage, answer costs, charts and estimates project them at
10x into the one-paisa unit:100 old credits displays as1,000 current credits,
both representing the same INR10 processing value. Historical grants remain
visible in raw accounting at their original numbers; conversion entries and
mapped replacement lots explain the new balance. New writes use0.01 natively.
M1/M2 T15 and payment activation are not closed by this credit release.
