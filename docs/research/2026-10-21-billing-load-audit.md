# Billing initial-render and disclosure audit

> **Status: Living.** Read-only application investigation, 2026-10-21. No implementation or deployment in this audit.

## Executed browser evidence

Signed-in in-app browser, Razorpay Test Preview, bare #/account/billing. Three reloads sampled through read-only DOM queries:
- Reload1: no billing DOM53ms; legacy352ms; modern464ms. Both layout counts never positive together in samples.
- Reload2: legacy586ms, correct legacy15px heading/20px24px padding; fonts loading then loaded636ms; modern670ms, correct modern16px heading/24px padding. Evidence supports component replacement, not a modern component waiting for its styling. Fonts can add a small independent swap; no browser performance trace or cold-cache/network-throttle test was available through this connection.
- Reload3: legacy401ms; modern540ms with balance placeholder and no breakdown, card277px high; credits/breakdown arrive1440ms, card313px high. The36px shift is directly observed. These are sampled elapsed times after reload returns, not standardized navigation/FCP/CLS metrics.
- Settled DOM: modern1, legacy0. No captured console errors. Disclosure:12px muted rgb(109,103,95), transparent background, padding0,18px high and160px wide.

## Source findings

PlanBilling.jsx starts config=null, fetches configuration in an effect, returns BillingWorkspace only for config.cycleChanges, otherwise immediately renders the full legacy tree. Missing configuration and known legacy configuration are conflated. fetchBillingConfig also converts failed reads to a legacy-style disabled config; error handling needs an explicit decision in the fix.

The temporary legacy Purchases reads configuration and history, and PlanPeriods reads periods. The modern tree mounts new PlanPeriods and BillingHistory instances after the switch, which initiate reads again. This is source-confirmed redundant initiation, not a measured network request count. Parent CreditsPage and PlanBilling also both call refreshCredits; the store deliberately queues one follow-up while a read is in flight for financial freshness. Do not remove that freshness guarantee globally to fix this page.

BillingWorkspace.jsx conditionally inserts the entire details block only once credits exist. Reserve its space or render a stable loading disclosure row to prevent the measured jump. Header data and unrelated sections should not be held behind the slowest billing read unnecessarily.

Legacy and modern implementations coexist deliberately: server/billingApi.mjs exposes cycleChanges only when enabled AND mode=test. Production still uses the legacy path. Base classes reused with scoped billing-modern overrides are not themselves evidence of duplicate page rendering. PlanBilling.jsx's inner config.cycleChanges branch around line191 is unreachable when true because the function returned at169; remove in a scoped cleanup. No evidence of a late CSS overlay on the modern component in the sampled warm loads.

## Suggested scope, not applied

Use explicit pending/ready/error configuration states. Show a stable loading layout until the billing mode is known, mount one selected implementation, reuse supplied config and stable shared reads, and reserve credit-detail space. Preserve server-owned financial state, role checks and the valid legacy route. Add deferred-config and delayed-credit render tests; explicitly distinguish config failure from known disabled checkout.

Give the native details summary a visible padded row, accent text/chevron, hover/focus and expanded states. Preserve keyboard/details semantics and avoid decorative entrance animation. Current18px click target is easy to miss; aim for40-44px row height.

## Verification

`npm test -- src/shell/PlanBilling.test.jsx src/shell/credits/BillingWorkspace.test.jsx src/shell/credits/BillingCreditBreakdown.test.jsx`:3 files/33 tests passed. These are not temporal-render regression tests; PlanBilling.test.jsx currently groups null config with disabled checkout and expects the old coming-soon copy. That expectation must change for pending config. No app source, SQL, payment, secret, environment or deployment changes. Only this audit and the open-work tracker were edited.
