# One-paisa credit conversion: implementation plan

> **Status: Historical (2026-10-18).** Completed credit rollout. Owner direction 2026-10-18. Specification:
> [one-paisa credits](../specs/2026-10-18-credit-paise.md). This document is an
> ordered execution record. Local verification and the approved controlled
> production backfill are complete; reconciliation preceded credit-write resume.

## Scope and authority

F225 in open-work.md is the sole tracking item. Credit redenomination is a
pre-payment dependency, separate from M1/M2 T15. Do not modify corpus ingestion,
feed scheduling, production payments or provider records. Existing cleanup
observations remain on the branch ancestry; do not push them incidentally.
Use task branches; no implementation agent commits, merges or releases.

## Execution graph

P0 contracts/inventory -> P1 local accounting prototype -> checkpoint A ->
P2 readers/retries -> checkpoint B -> P3/P4/P5 disjoint presentation work ->
P6 integration/release packet -> P7 controlled credit rollout -> checkpoint C.
Payment specs/plans may then consume the settled denomination and commercial
decisions; payment implementation also requires actual M1/M2 closure.

### P0 — Freeze contracts and executable inventory (S, sequential)

Supervisor owns this spec/plan, open-work.md and a dated execution evidence
record. Freeze the value-preserving 10x mapping, ledger conversion kind,
per-entry denomination, lot lineage, idempotency/version contract and lock
order. Reconcile existing normative ADR 0011 through an additive decision
record if schema semantics change; do not rewrite historical execution logs.
Read-only inventory refresh includes settings, row counts, sums, balances,
debt, lots/holds/late calls, grants, source-key uniqueness and numeric limits.

Accept: exact column inventory and before/after equations; no unresolved
accounting interface delegated to implementers; final pack prices remain marked
unapproved. Review the spec before implementation.

### P1 — Auditable accounting prototype and cutover barrier (M, sequential)

Write scope: newly CLI-created migration file(s), new SQL fixture(s), and
supabase/tests/run.sh for fixture registration and atomic-cutover verification. No old applied migration edits. Prototype the ledger
and lot conversion described in the spec on disposable local databases.
Include all credit writers in a barrier before settings are read. Prove lock
ordering, bounds, no privilege widening, no destructive history updates,
unit tagging and once-only conversion. Keep current-rate operation working
until the explicit conversion transaction. Test old and fresh installations.

Accept: exact conservation at wallet/lot/debt levels; all old ledger rows and
charge costs unchanged; admin/research writes cannot cross a half-converted
state; controlled abort restores original state. Prove no duplicate signup,
monthly or rollover grant. Verify numeric(14,4) limits and retained rounding.

Checkpoint A: independently review migration math, concurrency and permissions
before dependent work. Keep SQL definitions under one writer at a time.

### P2 — Mixed-era readers, estimates and request replay (M, sequential)

Write scope: new SQL migration(s)/fixtures for my_credits,
my_conversation_credits, my_usage_summary/timeseries/activity,
model_credit_estimates, reserve/settle/admin adjustment response contracts;
server/usersApi.mjs and its focused tests for amount versioning. Split into
smaller reviewed tasks if the write scope exceeds a focused session.

Normalize historic rounded charges per frozen unit; never rescale USD costs.
Exclude conversion entries from usage; preserve Free cycle allowance through
replacement-lot lineage. Freeze the API unit metadata consumed by P3-P5.
Handle stale browser submissions and old request-id replay exactly once.

Accept: reports, answer charges and model estimates agree across old-only,
new-only and mixed turns; debt repayment and late log settlement are correct;
same original admin request succeeds once, conflicting payload rejects.

Checkpoint B: review fixed response contracts and a passing local SQL baseline.
Only then dispatch parallel tasks with disjoint write scopes.

### P3 — Credit cache, warning and administrator controls (M)

Depends on P2. Write scope: src/lib/creditsStore.js and tests,
src/admin/userCredits.js and tests. Scale fixed warning 200 -> 2,000 and admin
ceiling 1m -> 10m, matching server guards. Implement unit/version cache refresh
and stale amount handling against the frozen API; no double browser scaling.

Accept: old cached data cannot mix with new charges or submit an unintended
adjustment; economic warning/limit identical; sign-out/account isolation kept.

### P4 — Pricing and billing presentation (S)

Depends on P2. Write scope: src/lib/publicPlans.js and tests,
src/shell/PlanBilling.jsx and its tests. Show allowances 10k/20k/65k/750k and
rescale illustrative typical costs, clearly estimates. INR prices unchanged.
Do not add checkout/top-up purchase calls in this task.

Accept: desktop/mobile plans and signed-in billing agree; no promise of
currently unavailable storage/model features; Free still can discover future
top-up buying without paid model access.

### P5 — Published legal unit wording (S)

Depends on P2. Write scope: src/lib/legalPolicies.js and tests. One credit
INR0.01; signup 10k; durations, rollover and existing refund decisions unchanged.
F107's address/lawyer-review gate remains explicit. No unsolicited legal changes.

P3/P4/P5 may run in parallel because their scopes are disjoint. Shared tests,
global fetch fixtures or documentation changes stay with the supervisor.

### P6 — Independent integration and release packet (M, sequential)

Supervisor integrates reviewed changes and owns docs/specs/2026-10-18-credit-paise.md,
this plan, open-work.md, related living F111 material and the new evidence record.
Preserve older Historical records. Record exact migration inventory, conversion
counts and expected sums, compatible client/RPC ordering, bounded write pause,
activity drain conditions, preflight queries, rollback/forward-repair actions,
release target and production read-only acceptance queries. State each exact
production action before requesting its release approval if not already covered.

Verify: npm run lint; npm test; npm run build;
deno test -A --config supabase/functions/deno.json supabase/functions;
npm run test:sql; node -e "import('./api/router.js').then(() => console.log('router import ok'))".
Use the existing no-dotenv guard for Node commands. Check the current bundle
gate and browser screens at desktop/mobile sizes; no type-check claim.
New tests must demonstrate red-before-green and SQL vacuity. Reuse full-suite
results unless subsequent edits justify another run. SQL uses disposable local
Docker containers only, never the shared live project as a fixture.

### P7 — Controlled credit rollout and backfill (M, sequential)

Depends on P6 gates and explicit applicable production release authorization.
Recheck actual production inventory/activity; deploy compatible contracts,
activate bounded credit-write barrier, drain, convert atomically with assertions,
verify, reopen and smoke-check current-unit reads and one separately authorized
bounded answer only if needed. Do not force providers, reset launch_at, remint
signup grants or alter corpus/feed flags. No Razorpay payment operations.

Accept: all users retain the same INR value, all original ledger rows retained,
unit markers and source keys prevent repeat conversion; no queued old-rate
request executes after the boundary; published amounts match the database.
Checkpoint C: report actual backfill/release evidence, then update tracker Done
with landed hashes. Draft approval or local green tests are not production proof.

## Related repair and payment work

Required fixes within F225: mixed-history estimates/reports, admin retry unit
ambiguity, settings-before-wallet-lock race, cache/threshold/copy drift and
replacement-lot source lineage. Keep additional findings in open-work.md.

After these contracts are settled, specify payment order/event persistence,
captured-only fulfilment, webhook deduplication/recovery, all-account top-ups,
invoice recovery, renewal anchoring and next-cycle paid downgrade. Reconcile
refunds through purchase-linked entitlements/credits. These are O6/F110 scope,
not silently included in the credit migration. Pack quantities become
20k/50k/100k/200k/500k; suggested prices remain unapproved. Organisation
subscriptions remain P2/later. Legal address/current GST/merchant readiness and
test-mode acceptance gate activation, not local specification work.

## Current evidence and limits

P0–P5 are implemented locally. P6 verification, independent review and the
release packet are recorded in the [execution evidence](../research/2026-10-18-credit-paise-evidence.md).
P6 passes: 6,224 app tests, 1,155 Deno tests, 44 SQL fixtures with vacuity,
lint/build/router import/bundle gate, and desktop/mobile browser checks.
SQL and client review findings were fixed with red-before-green regressions.
P7 completed with subsequent explicit owner approval: compatible application
`de51434`, production `dpl_99ho6FyZMshn7f5HECTbpqyMydsM`, migrations
`20261017194626` / `20261017194628`, all three wallets reconciled while paused,
then writes resumed at 20:34:28 UTC October 17 (02:04:28 IST October 18). Hosted Razorpay MCP registration
is a separate local configuration operation; authentication and callable access
must be confirmed, not inferred from registration. M1/M2 T15 remains open and
the last observed follow-up configuration was PAUSED, not silently resumed.
