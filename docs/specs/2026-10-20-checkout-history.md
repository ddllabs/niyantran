# Customer purchase history

> **Status: Living.** Owner approved the UI fix and Test-only branch publication on2026-10-20. Production/Live unchanged.

Current state: PurchaseHistory exposes ready/unpaid and creation-retryable
attempts in an indefinitely retained disclosure. The owner wants abandoned
checkout records out of the customer billing view.

Outcome: show fulfilled/refunded purchases and unresolved payment/support-review
records. Omit checkout-only attempts using the existing unpaid/retryable
classification. Keep all records, creation request IDs, reconciliation, and
duplicate-payment protections unchanged. No age-based cancellation, deletion,
provider request, schema, secret or Production action. Do not infer a failed or
cancelled payment from elapsed time.

Acceptance: mixed history hides unpaid/retryable records but retains completed,
refunded, creating, reconciling and review records; empty completed history stays
truthful. Causal render regression, existing purchase/retry guards, lint/build
and local rendered-browser verification. Scope: PurchaseHistory.jsx,
PurchasesExperience.test.jsx, Purchases.test.jsx and these task records/sole tracker. Webhook secret
re-entry remains a separate pending owner action.
