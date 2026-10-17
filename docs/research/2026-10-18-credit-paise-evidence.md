# One-paisa credits: local verification and release packet

> **Status: Living.** F225, 2026-10-18. Local implementation only. No push,
> production migration, backfill, deployment or payment operation has occurred.
> Production release requires separate owner approval.

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
Screenshots: `/tmp/niyantran-credit-paise-desktop.png` and
`/tmp/niyantran-credit-paise-mobile.png` (local evidence, not committed).

## Release sequence requiring approval

Exact production target: Supabase NTER `vfgcppstyzjarlzyqdac`, and Vercel
project `prj_6UiaDz2rkTOmqIOaXnCAs92V7d86` in
`team_QFu1p3ObeXmlMQczPBcZb582`. No release action below is authorized by
the local implementation request.

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
