# Billing design and daily-proration plan

> **Status: Historical (2026-10-20).** Completed sequentially; no delegation. Spec: ../specs/2026-10-20-billing-design-daily-proration.md. Tracked only under O6.

1. Inventory current contract/UI/logo and reconcile owner-reported Test transactions read-only. Write scope docs only. Verify current branch/remotes and existing data contracts.
2. Add day-fraction helper/new quote RPC, SQL fixture/runner entries, service dispatch and tests. Preserve existing functions/quotes/capture. Prove RED and date boundaries locally, then request bounded shared-NTER activation with concrete migration.
3. Build scoped billing summary and unified history with collapsed technical details; remove duplicated plan/history presentation from this Preview. Keep request ownership and uncertain-payment warnings. Verify component tests and responsive/dark browser fixture.
4. Refine plan chooser and topups/review typography, hierarchy/actions and status copy. Retain explicit payment confirmation and server authority. Focused interaction tests and real browser observation.
5. Brand invoice with existing logo, exact amounts/coverage, customer/seller details and printable responsive layout; test escaping, image embedding and old invoice compatibility.
6. Full local gates and source review. Apply approved additive migration, push verified branch, confirm Test READY and authenticated page/invoice. Production web/settings/Live/corpus unchanged. Record execution evidence; external payment acceptance is distinct from local checks.

## Executed evidence — 2026-10-20

- Source commits: `0649524` (daily pricing) and `bc3b46c` (workspace/invoice). Owner authorized Test publication and separately approved the additive shared-NTER daily-proration migration.
- `npm test`: final release run **413 files / 6445 tests passed**. Earlier runs exposed stale generated terminal CSS registration, invoice GST copy compatibility, and mismatched router/Vercel asset inclusion; all repaired, with focused checks and the final full run passing.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: **1172 passed**.
- `npm run test:sql`: **50 fixtures passed**, including omission-vacuity checks. Final daily fixture rerun covers Plus→Pro, Pro→Max and Plus→Max early/late month, midnight, leap year, final partial day, exact expiry, real quote/claim/capture and duplicate invoice replay.
- `npm run lint`, `npm run build`, `npm run check:bundle`, router import, `git diff --check`: passed. Build has no new warnings. Bundle initial JS180775 bytes gzip, below existing limit. New stylesheet registered in generated terminalStyles.js. Existing logo explicitly packaged in both router and Vercel metadata.
- RED evidence: daily fixture fails without its migration; invoice test fails against old unbranded HTML; history test fails without the component; spendable-balance test fails when total balance replaces available balance, then passes after restoration.
- Browser fixture: real components with synthetic APIs, desktop and390px mobile, dark theme, Free and Pro summaries, expandable chooser, daily upgrade explanation, hidden references and ordinary-user admin exclusion. Mobile table intrinsic width defect found and corrected; summary350px, local history scroller312px for610px table. No browser errors. Branded invoice logo loads; mobile invoice scroll width equals390px viewport. Temporary fixture/server/tabs removed; viewport override reset.
- Read-only reconciliation: three genuine new Test purchases fulfilled and invoiced once; one failed payment and nine success lifecycle events processed on first attempt. Zero wallet debt; balance matches remaining lots. Historical upgrade remains59974 paise/44980.4899 incremental credits.
- Approved migration applied successfully. Existing billing_cycle, billing_cycle_capture, billing_order and my_credits_cycle function definition hashes match before/after. New daily endpoint denied to authenticated role and allowed only to service_role. No existing tables/functions, financial rows, Production settings, Live keys or corpus changed.
- Publication target: `task/razorpay-plan` Test Preview only. Production baseline remains deployment `dpl_54raBgMjb4oZbtXSWc1KBuDrK4xQ`, source `4a0c98109da97caba1fe312c8e9db056dfde7df5`.
- No new provider payment initiated by the agent. Owner's earlier Test rehearsal and local regression execution are distinct evidence. O6 retains Live launch gates.

- Deployed source bc3b46c reached READY as dpl_4jzW7pgVnEPDgJ6FWNqQLvQaY4Eh. Authenticated history joins exactly three purchases/invoices, with existing balances and Plus preference preserved. Actual Max quote displays900000paise/685000credits,31of31days and daily validity. Cancelled only the local selection; no provider payment or schedule change.
- Runtime invoice check: legacy asynchronous popup did not produce a tab in IAB. Added a sandboxed in-page invoice dialog using a bearer-authenticated content read. Legacy popup API retained for other consumers. Native dialog traps focus/restores trigger and supports Escape; iframe has scripts/modals for print but no same-origin permission. New client regression observed RED then GREEN.

## Final release evidence

- In-page invoice fix source `f98203d` READY as `dpl_2XMJZxyr1HqvYGHTS2ySwduU4uUq` at the stable Razorpay Test alias. Authenticated browser opens real upgrade invoice00009 (599.74 INR) and top-up invoice00008 (499 INR) inline, with company logo, exact descriptions, payment references and upgrade service period. Close restores trigger focus; Escape closes; no browser console errors. Print/save-PDF control is present; OS PDF export was not executed.
- Final `npm test`: **413 files /6447 tests passed** after invoice dialog addition. Deno suite rerun **1172 passed**; lint/build/bundle/router passed. SQL unchanged after all50 fixtures and final expanded daily fixture passed.
- No fresh payment, grant, downgrade or renewal performed by the agent. One real daily Max quote read was generated; no checkout/order/payment followed. User's scheduled Plus preference and current86,267credit display remain.
- UI scopes: billing workspace/history/chooser/topups/periods and scoped CSS; authenticated invoice read/dialog; server invoice HTML; exact existing logo asset packaging in router/Vercel metadata. No header/nav, dependencies, Production or Live credential changes.
- Code review completed against the accepted contract: immutable amounts/quotes, server-only daily endpoint, unchanged originals, account-keyed async ownership, preserved warning states/holds/debt, React-escaped fields, escaped invoice data and opaque-origin sandbox.
- Advisory CI for bc3b46c passed; f98203d was in progress at release observation. Local acceptance gates all passed. Existing O6 Live gates remain tracked separately.
