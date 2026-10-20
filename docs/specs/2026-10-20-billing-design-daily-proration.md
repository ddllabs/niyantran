# Billing design and daily proration

> **Status: Normative.** Owner approved the proposed scoped redesign with “go” on2026-10-20. Test Preview only.

## Outcome
Modernize only the middle billing page: concise current plan, compact next-plan notice, progressively disclosed change-plan review, compact topup pack selection, unified payments/invoices table with expandable references. Preserve header/navigation and brand tokens. Existing company logo on self-contained printable invoices; retain exact financial facts, escaping and invoice numbering.

## Daily pricing contract
New Test upgrade quotes use IST calendar dates. Cycle days=max(1,endDate-startDate). While the exact paid period is active, remainingDays=clamp(endDate-todayDate,1,cycleDays); the final partial calendar date counts as one day. Both price difference and incremental credit difference use remainingDays/cycleDays. Amount rounds to paise; stored credits retain four decimals and display sensible precision. Upgrade quote expires at the next IST midnight or exact cycle end, whichever is earlier. Start/renewal quotes retain10minute validity; existing issued orders/quotes remain immutable. Exact expiry, stale grant version, ownership, capture idempotency, reviewed late captures, free scheduling, manual renewal,10% rollover and topups unchanged.

## Architecture and scope
Add a new service-only daily quote RPC and pure private calendar-day helper, leaving existing billing_cycle/capture/credit/entitlement functions unchanged. New Preview uses daily RPC; existing stored orders keep terms. No changes to balances, grants, historical invoices, keys, Production deployment or corpus. Shared migration requires separately bounded owner approval before activation.

UI scopes: PlanBilling, PlanCycleReview, PlanChoices, Purchases, PlanPeriods; new billing summary/history components and scoped CSS. Reuse current client auth, server reads and payment flow; no design dependency. Branded invoice source stays server/inrBilling.mjs with inline trusted logo data, no remote asset dependency. api/router.js and vercel.json include the exact existing logo asset in the function package. The unified history opens an authenticated, sandboxed in-page invoice dialog; its print/save-PDF control is part of the invoice. Preserve the legacy popup API for existing consumers.

## Acceptance
Daily helper same date different times identical; midnight boundary; first/final day; month lengths/leap years; expiry; all upgrade pairs; identical fee/credit fraction; stale quote and legacy preservation. Browser desktop/mobile and dark mode: readable hierarchy, keyboard/focus, selection and review, empty/error/pending histories, raw IDs collapsed, logo invoice/print layout, no horizontal overflow. No payment initiated by agent.

## Checks
Focused regression RED/GREEN + omission-vacuity SQL, concurrency suite, npm test, deno test -A --config supabase/functions/deno.json supabase/functions, npm run lint/build/check:bundle and router import. Read-only reconciliation of owner-reported genuine Test purchases. Publish task/razorpay-plan only.
