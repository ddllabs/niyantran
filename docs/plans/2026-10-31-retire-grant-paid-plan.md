# Retire `grant_paid_plan` (F276)

> **Status: Living.** Prepared and applied 2026-10-31, with the owner's approval ("approve PR 82, merge and
> apply the migration"). Merged in PR #82 / `c175e33b`. Open work: F276, now Done in [open-work](open-work.md).

## Current state

- Paid plans are granted by the checkout's capture functions, chosen in `server/paymentService.mjs`
  (`billing_cycle_capture_v3` for current orders). Every period ends at `private.billing_month_end`,
  the purchase's anchor day in IST. On NTER, read-only, 2026-10-31: a 31 January anchor gives
  28 February, 31 March, 30 April.
- `public.grant_paid_plan(uuid, text, text, text)` is the grant used before the checkout existed. It adds
  one month to the previous end, so renewals drift after a short month (31 Jan, 28 Feb, 28 Mar).
- Nothing calls it:
  - **Code:** no caller in `server/`, `api/`, `src/` or `supabase/functions/`. The billing API test only
    asserts it is not called.
  - **NTER, read-only, 2026-10-31:** no function body names it, and nothing depends on it.
    `plan_grants` holds 4 payment grants, all through the checkout, and 2 manual grants.
    Call counts can't be read because `track_functions` is `none`.
  - **Privileges:** `service_role` and `postgres` only.

## Change

- **`supabase/migrations/20261031130000_retire_grant_paid_plan.sql`:**
  `DROP FUNCTION IF EXISTS public.grant_paid_plan(uuid, text, text, text)`.
- **Grants it already made** stay in `public.plan_grants`, and `private.credit_due_cycles_legacy` still
  serves them.
- **`supabase/tests/grant_paid_plan_retired.sql`**, on the full billing chain, checks that:
  - the function is gone;
  - checkout capture, manual grants and the legacy cycle function remain;
  - a real checkout capture still grants Plus to the anchor-day month end;
  - an existing legacy payment grant is still served.

  Its vacuity check fails without the migration.
- **Living docs:** `docs/flow.md` and `docs/design.md` named `grant_paid_plan` as the payment path.
  Both now name the capture functions.

The earlier fixtures (`plan_entitlements`, `inr_plans`, `ai_credits`) load only the migrations up to
their own, so they still test the function as it was. They are unchanged.

## Release, after approval

1. Merge the PR after both required CI jobs pass.
2. Apply `20261031130000_retire_grant_paid_plan.sql` to NTER.
3. Verify with read-only checks:
   - `to_regprocedure('public.grant_paid_plan(uuid,text,text,text)')` is null;
   - the capture functions are present with unchanged privileges;
   - `plan_grants` counts are unchanged;
   - `private.billing_month_end` gives the same three dates as above.

   No payment is needed, because the checkout functions are not modified.
4. Record the evidence here, and move F276 (a) to Done with the commit.

## Rollback

Re-run the `grant_paid_plan` definition, and its `service_role` grant, from
`20261012120000_inr_plans.sql`. No data is changed by the drop.

## Applied 2026-10-31

1. **CI:** PR #82 was brought up to date with main (`c489caeb`). Both required jobs passed, and it merged as `c175e33b`.
2. **Read-only pre-check, just before applying:**
   - the function was present, and no function body named it;
   - 6 grants: 4 payment grants, all through checkout, with 0 legacy payment grants; and 2 manual grants;
   - 4 billing periods;
   - latest migration `20261028185850`.
3. **Applied on NTER** from `main`: `20261031165846 retire_grant_paid_plan`.
4. **Read-only verification:**
   - `grant_paid_plan` is gone, and this is the only new migration.
   - `billing_cycle_capture_v3`, `billing_capture`, `grant_manual_plan` and `credit_due_cycles_legacy` are present.
   - The v3 capture can be run by `service_role` only, not by `authenticated` or `anon`. `grant_manual_plan` can still be run by `service_role`.
   - Grants (6), payment grants (4) and billing periods (4) are unchanged.
   - `billing_month_end` still gives 28 Feb, 31 Mar and 30 Apr for a 31 January anchor.
