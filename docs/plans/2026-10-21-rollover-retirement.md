# Rollover retirement: backend inventory

> **Status: Living.** Analysis only,2026-10-21. Backend work is tracked in open-work.md.

Owner requests no future rollover. Frontend first; actual database grants remain unchanged in this phase.

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
