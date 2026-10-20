# Billing cycle changes implementation

> **Status: Living.** Sequential implementation; no delegation. Spec: ../specs/2026-10-20-billing-cycle-changes.md. Tasks tracked only under O6 in open-work.md.

## Ordered tasks and write scopes
1. Inventory exact Test account graph; prepare transactional deletion/reconciliation with row-count assertions and local fixture. Scope scripts/ and SQL fixture only; remote execution after frozen-target review. Preserve account/signup/usage and invoice counter.
2. Add versioned quote, schedule and capture SQL functions plus tables. Scope one new supabase/migrations migration, supabase/tests/billing_cycle_changes.sql and run.sh. Quotes include original cycle, grant version, plan prices, fraction, incremental credits and expiry. Verify privilege and old-function invariance, arithmetic, idempotency and races locally before remote DDL.
3. Wire owned API quote/schedule routes and new capture dispatch. Scope server/paymentService.mjs, server/billingApi.mjs and focused tests. No client amount authority; stable quote/request id binding. Verify provider rejection, ownership and expired quote before provider POST.
4. Wire review/schedule/renew UX. Scope src/lib/billing.js, PlanBilling.jsx, PlanChoices.jsx, PurchaseReview.jsx, PlanPeriods.jsx or new isolated cycle-review component, related tests. Existing profile modal still routes through review. Preserve topups.
5. Full checks, review and local browser flows. Red guards must fail before fix, SQL vacuity must fail without new migration. Record exact outcomes and unresolved owner payment acceptance.
6. Activate bounded shared additive migration; perform asserted named Test cleanup; commit/push task/razorpay-plan and verify READY Test deployment and UI. Production/Live/corpus unchanged. No payment performed by agent.

## Risks and choices
- Shared database: new RPC names avoid changing existing Production callers; functional Production behavior unchanged except explicit cleanup of named Test account.
- Manual grant/open-ended plan: fail closed for proration if no paid cycle exists; no guessed dates.
- A previously captured stale quote is review/refund work, never an automatic extra charge/grant.
- Preserve legacy paid records for other users. No historical invoice renumbering.
- Very small upgrade under provider minimum: reject with explicit renewal guidance; no free upgrade.
- No unpaid downgrade becomes active automatically. Paid renewal owns its own future period.

## Verification and activation — 2026-10-20
- Initial SQL guard failed against the pre-change schema (cycle contract absent). Final focused fixture passes nine price/allowance date/pair scenarios, usage/top-up preservation, repeated upgrades, ownership/expired quotes, late capture review, renewal/schedule constraints, synthetic cleanup, concurrent capture and omission-vacuity.
- Full SQL suite: all49 fixtures pass; exact final migration focused recheck also passes.
- Vitest:410 files /6434 tests pass. Deno:1172 pass. Lint, build, bundle guard and router import pass. No standalone type-check exists. Initial JS180771gzip bytes, within budget. Expected failure-path logs occur in existing tests.
- UI mutation proof: replacing the free schedule operation with Checkout fails the downgrade test; source restored and green. Credits RPC routing guard also failed before the wrapper caller change.
- Real browser localhost fixture: server-shaped prorated review, zero-charge schedule, cancellation/manual-payment wording observed, console errors/warnings empty. Fixture data is synthetic, not provider acceptance. Screenshots kept locally outside Git.
- Owner separately approved additive shared-NTER migration. Applied billing_cycle_changes successfully. Eight pre-existing billing/credit/entitlement functions retain identical combined hash (1a873a623727368dc552bc545ed0f4f8). No existing function/trigger was replaced. New private table RLS-without-policy INFO is deliberate: table access revoked, service-only functions own writes.
- Authorized named Test reset completed transactionally against frozen13 order IDs. Removed6 captured payments/invoices,4 paid periods,4 purchase-funded lots and5 linked ledger records;12 related inbox events. No funded-lot draws or active holds existed. Account retained; Free,1286.87welcome credits,debt0,zero remaining purchase orders/periods/Razorpay invoices. Signup lots, usage, chats and global invoice counter preserved. Provider-side Test history remains; no refund/payment/provider deletion was performed.
- Production deployment before release: dpl_54raBgMjb4oZbtXSWc1KBuDrK4xQ at4a0c981; unchanged. No environment/key changes or corpus work. Publication target is only task/razorpay-plan Test Preview.

## Remaining release acceptance
Publish verified branch and confirm READY + real authenticated Free-account review. Genuine new Test payments and webhook delivery for the changed commercial flow require owner rehearsal; local/provider-mocked checks are not that evidence. Existing O6 duplicate replay/browser-close/refund/Live launch gates remain open. No Live switch authorized.
