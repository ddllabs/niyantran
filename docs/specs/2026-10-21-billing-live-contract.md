# Live-capable approved billing contract

> **Status: Living.** Owner authorized implementation and Razorpay Test Preview release2026-10-21. No Production checkout or Live credential activation.

## Current state and problem
The approved daily prorated upgrades, free downgrade preference and manual renewal
are Test-only in paymentConfig, API capabilities, cycle RPC guards and private
quote/schedule mode constraints. Selecting Live keys currently selects legacy
commercial behavior. The shared credit engine already enforces zero rollover.

## Outcome
New code uses one versioned cycle-v2 contract for Test and Live: IST calendar-day
price and incremental-credit proration; unchanged cycle end; free replaceable
lower/Free preferences; manual renewal in the final seven days, no early future
credits, Free on unpaid expiry, independent top-up validity, no rollover.
Test callers remain restricted to verified allowlisted buyers. Live is only a
capability until separately configured and opened. Closed checkout cannot quote
or create new paid orders; owned recovery and free schedule changes stay usable.

## Boundaries
New service-only quote/capture RPCs and an authenticated own-credit read wrapper.
Preserve old quote/capture/read functions and immutable historic Test orders.
Broaden only private quote/change mode constraints to test/live; do not backfill
balances, purchases, periods, invoices or settings. Match buyer, merchant and mode
on quote claim and capture; forbid foreign cycles/schedules and cross-mode replay.
Legacy Test cycle-v1 and generic purchase recovery retain their dispatch paths.
Unknown versioned contracts fail closed. No provider credentials, payment actions,
Production deployment, timer, reset, refund or checkout opening is in scope.

## Acceptance
Causal RED/GREEN server tests and migration-omission SQL failure. Disposable SQL
proves Test/Live start, upgrade, schedule/replace/cancel, renewal, expiry/no-rollover,
wrong owner/mode/merchant, stale/expired quotes, capture/replay/concurrency, wallet
and invoice conservation, and service-only ACLs. No hosted synthetic Live rows.
Full Vitest, Deno, SQL fixtures, lint, build, bundle and router import pass. Readback
proves existing deployed function hashes and financial fingerprints unchanged.
Test Preview exact SHA, mandatory CI and signed-in quote UI verified without Pay.

## Write scope
server/paymentService.mjs,server/billingApi.mjs,src/lib/creditsStore.js and focused
tests; one new migration, new SQL/concurrency fixtures and runner entries;
this spec, matching plan and open-work. Shared NTER activation requires a concrete
reviewed migration and narrow approval before application.
