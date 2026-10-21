# Billing preflight and Test release plan

> **Status: Living.** Local work and Test publication authorized; shared database activation boundary remains explicit.

Sequential, no delegation. Checkout task/razorpay-plan. Spec ../specs/2026-10-20-billing-preflight-release.md.

1. Preserve dirty work in local commits and backup patch/archive. Merge current
   local main without resetting/stashing. Retain both billing and release evidence.
2. Local migration created by CLI: replace only reviews aliases in billing_event;
   add service-only read preflight. Fixture verifies a nonempty review list,
   account/mode isolation, access denial, stale-plan detection and no financial writes.
3. Service rejects stale checkout reopening; verified unused provider orders may
   return a stable replacement intent, but never auto-POST it. Client stores it
   only from the server, refreshes entitlement and requires another explicit review.
   Add tests for unknown/authorized/captured/provider mismatch and stable replay.
4. Run focused and full app/Deno/SQL/lint/build/bundle/router. Review duplicate
   payment, ownership and recovery invariants. Preserve existing UI acceptance.
5. Before shared SQL activation, resolve Production-unchanged boundary using exact
   reviewed migration. After approval, record before/after financial fingerprints,
   apply narrowly, verify RPC and grants, push only task/razorpay-plan and verify
   exact Preview commit/config/assets/APIs/CI. Main/Production/Live unchanged.

## Verified implementation and approved activation — 2026-10-20 IST

UI89bab64 and prior observation/billing recordsd687b95 preserved before clean
main merge dc9a5e7, integrating local main9d89c1b and origin/main4a0c981. No
conflicts, reset or stash. Runtime6515956 fixes the operator reviews alias
collision and adds owned service-only read preflight. Unused stale provider
orders can offer a deterministic next intent and require explicit review; no
automatic POST, old Checkout reopening, snapshot rewrite, cancellation or grant.
Observed payments, leases, provider mismatch/timeout and unclassified creation
stay pending. Existing capture/version/signature/denomination guards unchanged.

Causal service regressions failed against original behavior (5 failed); client
review-handoff regression failed against original client. Focused5 files138 tests
pass; final explicit-second-click assertion passes. Full app406 files6386 pass;
Deno1172 pass. Full SQL47 fixtures pass, including vacuity, capture concurrency
and retry lease concurrency. Lint/build/bundle/router and whitespace pass; initial
JS180809 bytes gzip. Temporary initial SQL attempts were blocked by stopped
Docker/containers/startup; started only existing two Postgres test containers.
Corrected synthetic account status fixture to existing inactive enum before
passing. No corpus ingestion/service start.

Owner separately approved exact narrow shared-NTER migration after clarification
of Production-unchanged boundary. Applied local migration20261019191550 SHA256
225a30b5841d1cc229875ee384c308a971d85d28f59202a1db899c592846465b. Hosted
billing_event body matched the original migration before replacement. Readback
canonical hashes match local tested functions: event032728b20c880e6f0da2445df5abdb74,
preflight38cd5c8adb304a175c7a4e8f69b9be78. Customer execution denied, service
execution allowed. Real read-only Test reviews returns[] successfully; owned plan
preflight returns stale=false/version0/observedPayment=false.

Complete before/after row fingerprints match for orders/payments/events/adjustments/
periods/invoices and wallets/lots/ledger. Seven Test attempts preserved; zero
payments/events/periods/invoices. No account/financial rows or keys altered.
Pre-release Production dpl_CmCWdRkJMWcskCJqPpABbCdqx7UY exact4a0c981, protection
all_except_custom_domains. Connector403; authenticated exact-scope CLI fallback
works. Preview push/deployment and remote CI verification follow below.


## Test publication verification — 2026-10-20 IST

Pushed only task/razorpay-plan at6182686d131f2ffc0ac92c939805a6f87b207150.
Preview dpl_6CfgxN7to5FcTgGX5avJUm2wvGeP is READY at that exact SHA;
stable alias niyantran-git-task-razorpay-plan-ddl-labs.vercel.app resolves it.
CI39311346794 completed successfully on attempt1: Build and tests and SQL
fixtures both green. All27 deployed JS assets fetched successfully; purchase
review, current-plan and unconfirmed-attempt labels present. Config200 confirms
Test key prefix and existing restricted Test checkout enabled; no keys printed.
Unauthenticated purchases401 and unsigned webhook400 confirm guards. These are
transport/assets checks, not an authenticated browser payment rehearsal.

Production remains dpl_CmCWdRkJMWcskCJqPpABbCdqx7UY at4a0c981, READY;
protection all_except_custom_domains unchanged. Production config200 retains
enabled=false/checkoutOpen=false. No Production web, config or Live-key changes.
The sole shared-database change was the separately approved migration, recorded
in hosted history as20261019192743_billing_checkout_preflight.

Actual Test capture/webhook/invoice reconciliation and paid plan lifecycle
rehearsal remain pending. Future purchased-period UI projection remains open.
No payment, provider order, refund or corpus operation was made by this release
verification. This evidence-only follow-up does not alter the tested runtime.
