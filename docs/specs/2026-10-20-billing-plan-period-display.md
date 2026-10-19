# Purchased plan periods and credit-rule verification

> **Status: Living.** Owner authorizes local implementation, verification and Test Preview publication. Production web and Live keys unchanged.

Current: paid periods are stored privately with exact start/end/allowance; account UI only shows active entitlement. Renewals/downgrades are invisible until activation. Prices/allowances differ but the credit denomination is globally one paisa; top-up catalogue is independent of plan.

Outcome: authenticated owned read endpoint projects active and future fulfilled paid periods from canonical records, scoped to merchant and mode. Future cards show plan, dates, allowance and explicitly deferred availability. Empty/read-error/loading states are truthful. Refresh after purchases/status refresh, no early entitlement or credit grants. Existing invoice/history remains intact. No inference from invoice dates or failed checkout attempts.

Acceptance: disposable SQL ownership/mode/state/read-only tests; UI date/order/credit/error/refresh checks; causal regressions. Execute all paid-plan upgrade/downgrade pairs and all top-ups across Free/Plus/Pro/Max, proving exact allowances, unchanged denomination, top-up preservation, no early grants and existing rollover. No commercial rule changes. Full app/Deno/SQL/lint/build/bundle/router and Test deployment checks.

Scope: additive read-only RPC migration, SQL fixtures/runner, server billing service/API, billing client, new PlanPeriods component/tests, PlanBilling wiring, documentation. No fulfilment/credit-engine changes unless a demonstrated scoped defect requires review. No payments/provider writes during implementation. Owner separately approved exact read-only migration20261019194527 after clarification; apply only after verification. Previous exception covered only checkout_preflight. Production web/config/Live keys/corpus excluded.
