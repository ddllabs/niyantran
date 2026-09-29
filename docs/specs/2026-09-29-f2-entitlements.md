# Spec: server-owned plan entitlements (F2, phase 1)

> **Status: Historical (2026-09-29).** Task F2 of
> `docs/plans/2026-09-28-remaining-work.md`. Phase 1 landed in `f74c8c1`, and
> its migration is live on NTER. Phase 2 (server-side gating before real
> payments) is task F6 in the same plan.

## Current state (read from the code and NTER on 2026-09-29)

- `user_profiles.plan` (`app_plan`: explorer, professional, enterprise)
  exists. Every signup gets `explorer`, and all 10 live accounts are
  explorer. There is no status, trial or period column.
- The browser decides the plan. `src/lib/planEntitlements.js` reads
  `plan`, `planStatus` and `trialEndsAt` from the session user in
  `sessionStorage`. Signup writes a 14-day trial there
  (`startTrialFields`), and a checkout writes a paid plan there
  (`applyPaidPlan`). Anyone can edit either value in the browser.
- `/api/billing/verify` checks the Razorpay signature, the order and the
  payment, and issues an invoice, but never records a plan. Razorpay is not
  configured, so no real payment is possible today.
- Desk data is public (static files under `public/data/`, and `desk_rows`
  is readable by any signed-in account). Desk locks, row caps and export
  limits therefore can't be enforced by hiding data today.
- The organisation tables exist but aren't enabled. Plans are per user.

## Owner decisions (2026-09-29)

1. No plan loses the AI research assistant.
2. Trials are server-side, once per account: 14 days of Pro or Enterprise,
   with no card.
3. A payment grants a fixed period (one month or one year). Renewal is
   manual: paying again extends the period.
4. Plans are per user. Organisation seats are out of scope.
5. Phase 1 makes the plan server-owned. At launch the server doesn't gate
   desk access, row caps or exports. Phase 2, before charging real money,
   moves premium data behind the server, runs exports through it and
   enforces row caps at the API.

## Expected outcome

- The plan lives in `user_profiles`. A signed-in user can't set their own
  plan, status, period or trial by any route.
- `my_entitlement()` returns the effective plan. A lapsed period or trial
  reads as free at read time, so no scheduled job is needed.
- `start_trial(plan)` grants 14 days once per account.
  `trial_started_at` makes a second trial impossible.
- The trial picked at signup is applied by `handle_new_user()` from the
  signup metadata. An existing free account can start its one trial from
  the upgrade dialog.
- `grant_paid_plan(...)` (service role only) is called by
  `/api/billing/verify` after its existing checks. It is idempotent per
  payment. While Razorpay keys are absent, checkout says that payments
  aren't enabled and grants nothing.
- `grant_manual_plan(...)` (service role only) backs an admin "plan"
  control on the Users page: plan plus an optional end date, recorded with
  `plan_source = 'manual'`. Choosing Explorer revokes.
- Every grant is logged in `plan_grants`: who, what, until when, by whom,
  and which payment.
- The browser reads its plan from `my_entitlement()` at sign-in and when
  the terminal opens. The desk locks and caps stay in the browser, driven by
  that server value. Editing `sessionStorage` no longer changes them.
- The pricing page lists "AI research assistant" for every plan.

## Interfaces

New `user_profiles` columns:

| Column | Type | Meaning |
|---|---|---|
| `plan_status` | text: free, trial, active | Default `free` |
| `plan_period_end` | timestamptz | End of the trial or paid period; null means open-ended (manual grants only) |
| `plan_source` | text: trial, payment, manual | How the current plan was granted |
| `trial_started_at` | timestamptz | Set once, never cleared |

`my_entitlement()` returns jsonb with these keys: `plan` (the effective
plan), `status`, `period_end`, `source`, `trial_used`, `lapsed` (true when
a period ended) and `granted_plan` (the stored plan).

The browser uses `pro` for `professional`, as before.

## Acceptance evidence

- A new SQL fixture, `supabase/tests/entitlements.sql`, proves:
  - a user can't update any plan column;
  - the trial runs once and only for Pro or Enterprise;
  - only the service role can grant;
  - a lapsed period reads as free;
  - a repeated payment id doesn't extend twice;
  - the signup trial is applied.

  The vacuity check fails it without the migration.
- Route tests prove that verify grants only after every check passes (and
  never on a signature, order or status failure), and that the admin plan
  route validates input and refuses non-admins.
- Browser tests prove that the entitlement comes from the server value and
  that a tampered session user doesn't unlock anything.
- Every new test is shown failing before the change. Then the production
  build, Vitest, Deno and `npm run test:sql` all pass.

## Scope

- One migration, `supabase/migrations/20260929100000_plan_entitlements.sql`.
- The SQL fixture and its `run.sh` chain entry.
- `server/billingApi.mjs` (verify grants), `server/usersApi.mjs` (the
  admin plan field) and `src/admin/` (the Users page control).
- `src/lib/planEntitlements.js`, `src/lib/userStore.js`, `src/lib/billing.js`,
  `src/marketing/SignupPage.jsx`, `src/shell/UpgradeModal.jsx` and
  `src/shell/TerminalShell.jsx`.
- `src/lib/pricingStore.js` (the AI line on every plan).

## Exclusions

- Organisation seats, Razorpay subscriptions and automatic renewal.
- Server-side gating of desks, row caps and exports (phase 2).
- Google sign-up trials: a Google redirect carries no signup metadata, so
  those accounts start free and can take the trial from the upgrade dialog.
