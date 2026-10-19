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
