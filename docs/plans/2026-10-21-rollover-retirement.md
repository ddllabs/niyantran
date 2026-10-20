# Rollover retirement: backend inventory

> **Status: Living.** Backend implementation and activation record, 2026-10-21. Tracked in open-work.md.

The original audit below describes the completed frontend-only phase. The implementation section supersedes its pending-work statements.

Owner requests no future rollover. Frontend preparation is deployed; backend retirement now follows the owner-approved spec.

## Required backend changes

- public.credit_settings.rollover_pct currently defaults to10. private.credit_close_lot in20261014200000_ai_credits.sql closes monthly lots at natural expiry and mints10% of their remainder through private.credit_mint. private.credit_expire and private.credit_sync can trigger this lazily when account reports/turns refresh. A UI change cannot disable it.
- Future additive migration: disable rollover minting and set the policy to0; inspect every deployed function definition before replacing it. Preserve locking,idempotent close,expiry ledger entries,wallet/debt reconciliation and non-natural plan-change behavior. Do not edit old migration history.
- public.credit_lots kind=rollover, public.credit_ledger, public.credit_lot_draws and source_key rollover:<lot> remain necessary to explain existing grants/draws. Do not delete rows or remove the kind constraint while history exists.
-20261018160700_billing_purchases.sql links rollover source provenance to purchases. Refund/recovery must continue tracing historical descendants; do not remove that branch merely because new rollover stops.
- SQL fixtures ai_credits.sql,billing_cycle_changes.sql,billing_plan_period_display.sql currently assert10% behavior. Add new migration-specific causal fixtures for natural expiry,no fresh rollover,lazy/delayed sync,duplicate sync,upgrade/renewal/lapse,refund provenance and historical-lot spend/expiry. Rebuild without the new migration to prove guards fail.
- Define cutover handling explicitly. Recommended: stop new rollover grants and let already-issued lots expire on their recorded dates. No deletion/revocation is authorized here. Assess monthly lots already expired but not yet lazily processed at cutover; use the chosen effective date consistently.

## Frontend retirement versus historical compatibility

Remove advertised10% benefit from PUBLIC_PLANS.items/PRICING_COMPARE,BillingWorkspace and PlanCycleReview. Retain CreditLots rollover label,creditsPage.css segment color,and generic wallet/usage rendering for real historical records. Terms and Refund policy contain two additional carry-into-next-month promises; remove those and update their dates in the frontend phase. Keep old dated plans/specs as history; new owner decision supersedes the benefit.

## Rollout boundary

NTER is shared with Production. Global credit expiry/settings changes affect all users,including Production callers. A Test-only UI deployment cannot isolate that policy. A later shared-NTER migration requires a concrete migration/fixture review and explicit narrow approval,or a truly isolated Test database. No backend activation claimed by this frontend release.

## Read-only deployed check

On2026-10-21,NTER query `select rollover_pct from public.credit_settings where id = true` returned10.00. No sync/expiry function was invoked and no table/settings/function was changed. The frontend release therefore does not claim rollover grants are disabled.

## Implementation phase — owner instruction 2026-10-21

The frontend phase is complete. The owner now authorizes backend removal and a reset of the known Test account. Spec: ../specs/2026-10-21-credit-no-rollover.md. The earlier recommendation to retain this account's issued purchase lots is superseded by the bounded reset; unrelated historical lots remain untouched.

Sequential tasks:
1. Inventory deployed function/settings and frozen target graph (read-only). Confirm exact function matches repository and no Live orders. Completed: one paid account, zero Live orders; five Test orders, five payment attempts, four invoices, three plan revisions, four funded lots/ledger grants, no funded draws or active holds; wallet749069.8477/debt0, retained signup1186.132.
2. Add migration-specific SQL fixture on the latest daily billing chain. Prove failure with old rollover behavior. Add the migration removing only rollover creation, keeping expiry logic; set/constrain policy0. Leave old migration-specific fixtures on their historical chains.
3. Prepare a reusable, transaction-scoped reset SQL script that consumes exact frozen UUID settings, never email discovery. Rehearse it with synthetic purchases and bystander data, drift rejection, old capture rejection and post-reset refresh.
4. Run focused and full SQL (including omission checks), npm test, Deno suite, lint, build and bundle checks. Review diff and permissions.
5. Display exact reset inventory. Activate shared-NTER policy only under narrow shared-database authorization; run reset under owner's bounded authorization. Read-only postconditions; no remote synthetic tests.
6. Commit/push the approved Test branch, verify Preview deployment SHA and signed-in Free/reset UI, and confirm Production deployment unchanged. Record evidence and move tracker only when complete.

Reset frozen orders: 9e25819b-13a0-453a-9323-deec008e46f2,367e9ced-6959-4e52-877d-bad7449344b9,2b49452d-d359-4549-8c8c-ac45075dceb6,3e008813-bf6f-4816-858f-96ec228c68c0,4870c81b-2ad0-4141-ba37-0ad97d2ffc59. User b8ad9669-4e23-4d2f-8792-de37206e1d4b. New purchases invalidate this inventory and abort the reset.


## Authorization and verification

Owner explicitly approved shared no-rollover policy and the bounded Test reset on 2026-10-21 after reviewing migration name and shared Production impact. Production web deployment/settings and Live keys are excluded. Global no-rollover is the only shared-policy exception.

Focused SQL RED: the pre-change chain raised `FAIL: natural expiry must not mint rollover`. GREEN: `./supabase/tests/run.sh credit_no_rollover` passes, including omission failure without the new migration. Historical fixture chains intentionally continue testing their old migration contracts; the new latest-chain fixture tests current policy and the exact operator script.

Application suite: 417 files / 6472 tests passed. Edge suite: 1172 passed. Lint/build/bundle pass; initial JS180710 bytes gzip. Production dependency audit: zero known vulnerabilities. All51 SQL fixtures passed with omission/concurrency checks; final focused fixture also passed after tightening the deleted-capture assertion. Router import passed. No standalone type-check exists.

Reset preservation baseline: auth users12, own signup hash a81a0fb4b2eb6aaf00deb5cf6022deac, own lot-draw rows34, other-wallet hash f45167fdb60386d330212c09ef549345, other-profile hash677cb5405d19fc49aca95fbea6ca6426, invoice FY2627 last sequence10. Hashes are comparison evidence, not backups.


## Shared database activation and reset

Approved migration applied successfully on2026-10-21. Source SHA25624693a580c5a8b2ee7103c34cceaf87e491d4cd588330df4a318e47b6b819961; operator script SHA2560a9bcd56a17c2815e50a95885b9f5912498f8724b36d420c59bda1296b898a01. The private expiry function no longer contains credit_mint; rollover_pct0 and validated zero-only constraint confirmed. ACL remains postgres-only. No unrelated schema or provider settings changed.

Executed the exact locally rehearsed operator definition in one transaction with lock timeout5s, frozen five-order UUID array and contract payments5/invoices4/periods3/lots4/ledger4/wallet749069.8477. Reset succeeded: planFree, orders0, periods0, invoices0, wallet1186.132 and debt0. Own signup hash, own34 draw rows, other wallets/profiles hashes, auth count12 and invoice counter10 match the baseline. No auth/chat/usage tables were mutated. Provider Test records remain outside this reset. Live orders0 before reset; no Live keys/settings accessed or altered.

Test Preview publication and final browser evidence pending. Production baseline remains dpl_54raBgMjb4oZbtXSWc1KBuDrK4xQ /4a0c98109da97caba1fe312c8e9db056dfde7df5.
