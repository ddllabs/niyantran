# Purchase status wording

> **Status: Living.** Approved Test Preview wording correction; Production excluded.

Ready provider orders currently render “Confirmation pending” even when Checkout
was dismissed without payment. Show “Awaiting payment” for ready orders. Retain
retryable, fulfilled, review, refunded and uncertain-state labels. Do not infer a
persisted cancellation or payment from a browser dismissal.

Scope: Purchases.jsx rendering and a focused rendering regression test. No API,
SQL, stable intent, retry, provider, financial or credential changes.
Acceptance: render a ready unpaid purchase without confirmation-pending text;
render uncertain and terminal states truthfully; existing billing client tests
still prove stable intent preservation. Publish only task/razorpay-plan Preview.

Implementation plan: first reproduce the ready-state rendering defect, change
only its label, run focused tests, lint, build and bundle checks, inspect diff,
commit scoped files, push the approved branch, verify exact Preview SHA and
unchanged Production target. Record release evidence in the existing billing
plan/evidence and sole open-work tracker. No additional agents required.

Local evidence: the ready-order rendering test failed before the change, while
six existing-state cases passed. After the change, all seven cases pass; focused
billing checks pass 58 tests. Full npm test passes 6,358 tests across 404 files.
Lint, build, bundle budget, router import and diff whitespace checks pass.
Review confirms the sole runtime change is the ready-state display string;
no database or duplicate-payment code changes. Release evidence is maintained
in the existing billing plan and local execution record.
