# Free plan card

> **Status: Normative.** Owner approved2026-10-21 after confirming Free is a permanent tier with no recurring credit allowance.

Show Free beside Plus/Pro/Max in the billing chooser and profile Change plan dialog. Free card says zero price, no monthly credit allowance and AI uses existing credits; it must not promise returning users a new welcome grant. Mark current Free and disable redundant selection for Free/lapsed accounts. Active paid users choose Free then explicitly confirm the existing zero-charge period-end schedule. Profile dialog forwards Free to the billing review via the existing plan parameter. Remove the duplicate Free footer action. Keep the legacy paid-only PlanChoices default for other consumers.

Scope: PlanChoices, PlanChangeDialog, PlanCycleReview and focused tests; scoped billing/upgrade CSS. Four columns when space permits, two at intermediate widths, one on mobile; profile dialog two/one. No backend, pricing, grants, allowance, expiry, payment or Production/Live changes. Test Preview publication remains within the ongoing UI scope.

Verify RED/GREEN card/current/downgrade/profile handoff and no premature payment; full unit/lint/build/bundle; browser Free/paid and responsive/dark fixture plus authenticated Test selection without saving any schedule or paying.
