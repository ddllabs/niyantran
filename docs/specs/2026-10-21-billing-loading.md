# Stable billing loading

> **Status: Normative.** Owner approved implementation and Razorpay Test Preview deployment2026-10-21.

Fix the audited legacy-to-modern flash, credit disclosure insertion shift, redundant initial reads and unreachable branch. Unknown billing configuration must never mount either actionable billing flow; use a stable account summary and neutral options loading state, with explicit retry on configuration failure. Preserve known legacy configuration outside Test. Reuse CreditsPage's existing credit subscription; do not weaken shared-store financial freshness. Keep invoice/config reads independent and avoid waiting for balance/history before showing plan controls. Keep the credit disclosure row present throughout loading, keyboard operable and visually distinct with a40-44px target. Avoid entrance animation and extra dependencies. No charge, SQL, provider, Production or Live credential changes.

Acceptance: deferred config cannot render the legacy page or start its child data reads; ready configuration mounts exactly one intended flow; error is retryable and distinct from disabled checkout; delayed balance retains account/disclosure geometry; authenticated Preview reload sampling shows no legacy DOM and no36px disclosure insertion. Existing legacy, credits/held/debt, topups, plan selection, invoice and account-isolation tests pass. Full application and Edge suites, lint/build/bundle/router checks. Test Preview exact SHA and unchanged Production deployment verified.

Scope: PlanBilling and billing config helper; CreditsPage prop wiring; shared account presentation/loading state; BillingWorkspace styles; compact period loading; focused tests; audit/plan/tracker docs.
