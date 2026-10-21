# Plan discovery from the account menu

> **Status: Living.** Owner approved implementation and Test-only branch publication on2026-10-20. Production/Live unchanged.

Problem: billing plan cards omit their credit allowance, the avatar has no active
paid-plan badge, and the account menu has no direct plan-change entry point.

Outcome: show each plan's existing included monthly credits on the billing cards.
Show Plus/Pro/Max below the avatar only for the server-confirmed active paid plan,
never a future or lapsed purchase. Add Change plan to the account menu. It opens
an accessible native dialog displaying the current plan/end date and the same
plan choices/allowances/current-plan highlight used by billing. Selecting a plan
does not pay; Review purchase closes the dialog and opens the existing billing
review for that selection. Keep Razorpay outside the native dialog top layer.
Higher plans start now, lower plans start after the current paid period, same
plan extends it. No automatic renewal or pricing/credit/entitlement changes.

Acceptance: paid/lapsed badge cases, visible allowances on all cards, current
highlight, safe selection/review handoff and truthful downgrade timing; keyboard
Escape, focus containment/restoration, mobile/desktop browser checks. Existing
payment/plan-period tests stay green. No hosted payment, SQL migration, secret,
Production/Live or corpus action. Earlier unpublished history fix is preserved;
webhook secret re-entry remains pending.
