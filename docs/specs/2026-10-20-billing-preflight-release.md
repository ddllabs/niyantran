# Billing preflight and Test release

> **Status: Normative.** Owner authorized fixes, main integration and Test Preview publication on 2026-10-20.

Fix billing_event reviews' PL/pgSQL variable/table alias collision without changing
webhook processing, authorization or financial effects. Add service-only owned
plan-order preflight: an obsolete grant-version quote must not reopen Checkout.
No automatic replacement POST: an unused stale order can offer an explicit fresh
review, using a deterministic next intent for the same old order/current version.
Unknown provider state, any observed payment, existing recovery/review or a busy
creation lease stays pending. Preserve old orders and immutable snapshots. Existing
capture version check remains the final guard against a plan changing mid-Checkout.

Integrate current local main (includes unpublished consolidated documentation)
into task/razorpay-plan; preserve existing UI/evidence. Verify causal SQL/service/
client tests, full app/Deno/SQL/lint/build/bundle/router and Test Preview. Do not
push main, deploy Production/Edge Functions, change Live secrets or ingest corpus.
Shared NTER SQL activation requires explicit reconciliation of the owner's
Production-unchanged boundary before executing any hosted migration.
