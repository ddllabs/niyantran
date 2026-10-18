# Razorpay integration plan

> **Status: Living.** Local implementation and Docker tests authorized 2026-10-18; release remains gated.

[Spec and contracts](../specs/2026-10-18-razorpay-integration.md). Existing tracker
F107/F110/O6, no duplicate programme. Planning baseline3ccdf8a. Preserve separate
uncommitted M1/M2 observation records. Local implementation evidence is recorded below.

## Original implementation sequence and current checkpoints

These phases describe the agreed design. Local code is implemented; acceptance
and publication are separate checkpoints. The implementation outcome and current
execution route below supersede planning-only statements in the dated baseline.

### 1. Lock contracts and isolate test operations — S

Dependencies: owner-approved local implementation amendment; production still waits for M1/M2 T15.
Resolve mode/merchant/address/GST/test database inputs without reading secrets.
Inspect deployed schema/function definitions read-only against latest migrations
before final migration design. Record exact secret names/destinations/mode only.
Reconcile approved top-up prices and previous legal/renewal decisions in living
documents. Exact scope: this plan/spec, open-work tracker, living credit-paise
spec, relevant legal/INR specs when reconciling confirmed decisions.
Acceptance: approved catalogue, lifecycle/refund contracts, selected test environment,
reproducible test commands, and no unrestricted production test-grant path. No key values read.

### 2. Ship one isolated top-up path end to end — L

Depends on1. Begin with Free account/20,000-credit499-INR pack. Add versioned
server-owned catalogue, durable buyer-bound order snapshot, request deduplication,
provider REST adapter and captured-only fulfilment transaction with invoice.
Exact likely scope: server/billingApi.mjs, server/inrBilling.mjs, new
server/paymentOrders.mjs and server/paymentCatalog.mjs; src/lib/billing.js;
src/lib/billingApi.test.js, src/lib/billingClient.test.js; migrations created
with supabase migration new (timestamp assigned then, never invented here),
supabase/tests/payment_fulfilment.sql, supabase/tests/run.sh. Define exact RPC
names/arguments, table exposure and lock order before editing dependent callers.
Acceptance: one captured payment gives exactly one current-unit lot and invoice,
no plan change; duplicate/replayed requests and price changes are safe. Reject
unauthorised writes, foreign ownership and amount/currency/mode mismatch.
Verify focused Vitest, causal SQL fixtures/vacuity/down, all common gates.
Keep external provider calls mocked in this slice; no real order creation yet.

### 3. Add durable webhooks and browser-independent recovery — L

Depends on2's fixed order/fulfilment interfaces. Exact likely scope: new
server/paymentWebhook.mjs, server/paymentRecovery.mjs; server/billingApi.mjs;
api/router.js raw-body routing; src/lib/paymentWebhook.test.js and
src/lib/paymentRecovery.test.js; migration/tests from this slice only.
Raw bytes must survive the actual Vercel request parser; prove this in local
adapter tests and isolated deployment before registering a webhook. Persist
minimal verified event data and hashes, not card/secret data. Callback and
webhook use the same atomic fulfilment RPC. No independent second grant path.
Acceptance: repeated/concurrent/out-of-order delivery, browser closed, grant or
invoice failure, unknown provider POST outcome and recovery survive correctly.
Capture/amount/currency/order/mode checks all fail closed. Define refunds/disputes
and reconciliation operation before live release; cash initiation is not automatic.
Checkpoint: durable financial core and recovery pass review before adding packs.

### 4. Paid-plan lifecycle and catalogue expansion — M/L

Depends on2–3. Implement all five approved packs and paid monthly plan actions.
Verify renewal anchor (including31st/leap-year boundaries), upgrade from now,
queued downgrade at next cycle, no auto-renew, one eligible allowance per paid
period and existing10% rollover. Preserve top-ups across plan changes and expiry.
Exact likely scope: publicPlans/billing server and tests; a new additive SQL
migration replacing relevant grant/entitlement routines; SQL fixtures for
plan lifecycles, invoices, payment fulfilment and current credit unit.
Inspect actual grant/credit trigger coupling before naming exact function edits;
no blanket replacement of the credit engine or editing applied migrations.
Acceptance: retries never extend twice, future renewals cannot mint early, top-up
eligibility is identical for Free/paid while model entitlements remain distinct.

### 5. Complete the existing account checkout UI — M

Depends on fixed interfaces from2–4. Exact likely scope: src/shell/PlanBilling.jsx,
src/shell/credits/OverviewSection.jsx, existing credits page route, src/lib/billing.js,
new small checkout/status components and adjacent tests/styles. Show server
quotes, expiry, pending/cancel/failure/recovered success and invoice links.
Standard Checkout loads only on purchase intent. Do not optimistically add credits
or enable unavailable plans from a browser callback. Refresh authoritative
entitlement/credit stores after confirmed fulfilment. Preserve current-unit cache
metadata and all-account top-up access. No broad UI redesign.
Acceptance: desktop/mobile, keyboard, script-blocked/load-failed, browser back,
session change and repeated button taps; pending payments can be recovered.

### 6. Legal and isolated Test Mode acceptance — M

Depends on core/UI plus F107 address/current seller facts. Exact likely scope:
src/lib/legalPolicies.js and tests, server/inrBilling.mjs invoice rendering/tests,
confirmed billing spec updates. No hypothetical lawyer sign-off claim.
Common commands: npm test; deno test -A --config supabase/functions/deno.json
supabase/functions; npm run test:sql; npm run lint; npm run build;
npm run check:bundle; router import. Use no-dotenv guard for local npm commands.
SQL tests use disposable Docker Postgres; remote MCP itself needs no Docker.
After separate approval, configure Test Mode on a restricted Test preview and
run success/failure/cancel/pending/retry/webhook/browser-close cases. Under the
pre-launch amendment, shared NTER may receive expected changes for dedicated
test buyers only; reconcile an exact before/after inventory and prove all other
accounts unchanged. Test refunds require the approved bounded test scope.

### 7. Controlled production activation — S/M, separate approval

Depends on M1/M2 closure, all implementation acceptance, merchant approval,
current seller/legal facts and test evidence. Prepare additive migration and
function inventory, provider mode/capture/webhook details, rollback and disable
controls before seeking exact release approval. Provision secrets securely on
Vercel without exporting them. Deploy compatibility before consumers; keep
checkout closed until read-only readiness passes. Deploy the scoped research-chat change only after its RPC exists; no corpus redeploy.
Owner performs one bounded real payment; reconcile provider captured amount,
order, exactly-one grant/current-unit credit change and invoice. Monitor event
backlog/failures and recovery. Open checkout only after acceptance; disabling new
orders must still permit verified webhook processing and recovery of paid orders.
Rollback code must preserve valid financial records and denomination compatibility.

## Parallelism and review

Sequential default. After catalogue/order/RPC contracts are fixed, UI fixture
work (step5) can run alongside disjoint server webhook work (step3) only under an
explicit dispatch with exclusive files. SQL/credit/plan changes stay sequential
with one integration owner. Security/accounting review independently checks the
core before release; routine catalogue/copy/test work does not require the most
expensive model. Model selection follows task risk, instructions and access.
The initial planning pass dispatched no agents. Subsequent local implementation
received independent read-only accounting/security review, and the completion
audit used one Luna/medium documentation reviewer.

## Current plan gates

Local implementation/Docker testing is authorized before T15. The latest recorded
read-only source observation has MLA and Constitutions at2/3 genuine daily
opportunities; Growth recovered on its ordinary16:05 UTC retry after16:00 failed.
That retry is not a new expected daily opportunity. T15 remains open; this is the
last recorded observation, not a fresh production query in this documentation task.

The owner now confirms the app is pre-launch with no customer/paid users and no
second hosted Supabase database. The controlled shared-NTER route below replaces
the blanket second-hosted-project prerequisite. It does not silently waive T15 or
execute production/provider changes. Merchant approval, separate Test credentials,
restricted test buyers, acceptance and production release remain pending.

## Initial planning evidence — before implementation

Read current billing client/server, public plans, invoice/grant/credit migrations
and existing specs; official Standard Checkout/Node/webhook/MCP documentation
and Context7 official SDK docs. No provider account API invoked. No app code,
SQL, environment, database or service changed. Local document diff check required;
no runtime test suite is needed solely for this prose plan.

## Schema-first implementation slices — expanded 2026-10-18

The earlier seven phases are programme milestones. Execute them as the smaller
ordered slices below, each with exclusive scope and at most about five changed
files. Migration and test-runner edits are owned sequentially by one integrator.
The five-table contract is implemented locally in migration 20261018160700.
T15 and separate owner approval still gate publication and production actions.

| Slice | Depends on | Exact scope or bounded scope assignment | Acceptance and verification |
| --- | --- | --- | --- |
| A. Inventory and contracts (S) | owner review | This spec/plan; read-only deployed table/RPC/trigger inventory | Confirm schema parity, five-table necessity, period/adjustment semantics and isolated targets; record unresolved drift before DDL. |
| B. Durable order model (M) | A | One new migration; supabase/tests/billing_orders.sql; supabase/tests/run.sh | Orders/payments constraints and request claim/binding RPC; reject wrong-owner/mode and mismatched idempotency payload; focused SQL fixture plus vacuity. |
| C. Catalogue and provider boundary (M) | B | server/paymentCatalog.mjs; server/paymentOrders.mjs; adjacent two tests | Immutable approved prices, safe unknown POST outcome, checked provider shapes and retries; mock-only Vitest. |
| D. Top-up accounting (M) | B | New migration; supabase/tests/billing_topups.sql; runner | Captured-only one order -> one 20,000-credit purchase effect; existing wallet/lot/ledger/debt conservation and unchanged plan; SQL concurrency and vacuity. |
| E. Atomic invoice and capture (M) | D | New migration; payment invoice SQL fixture; runner; server/billingApi.mjs and its test | Invoice plus benefit transaction rolls back together on injected failure, retry produces one invoice/grant; full focused integration. |
| F. One local checkout path (M) | C,E | src/lib/billing.js; client test; smallest top-up purchase component and its test | Free customer buys first pack against mocked provider, server pending/success authoritative, no paid-model escalation; browser and Vitest. |
| G. Signed event inbox (M) | E | New migration; SQL fixture; runner; server/paymentWebhook.mjs and test | New billing_events table, raw bytes validated before parse, durable duplicate detection, denied browser writes; SQL/Vitest. |
| H. Vercel webhook transport (M) | G | api/router.js; adapter test; webhook integration test | Real adapter preserves raw bytes, size limits and signature rejection; import/build and isolated transport proof before webhook registration. |
| I. Durable recovery and adjustments (M) | G,H | New migration; adjustment SQL fixture; runner; server/paymentRecovery.mjs and test | New billing_adjustments, leased retries/backoff, capture/refund/dispute ordering, stuck/unknown orders and overpayments visible; mock and concurrent SQL tests. |
| J. Explicit paid periods (M) | E,A | New migration; paid-period SQL fixture; runner | New billing_plan_periods, anchored windows/queued downgrade and compatible grant/profile links; month-end/leap-year/source-key tests with controlled clock. |
| K. Entitlement/credit integration (M) | J | One migration; two lifecycle/credit fixtures; runner | Same transaction-boundary rules for period activation and credit refresh; legacy/manual path unchanged, no early or duplicate allowance, rollover preserved. |
| L. All products and account UI (M) | F,I,K | server catalogue/test plus smallest credits/plan components, split further if over five files | All packs/plans accessible to eligible account types, correct pending/cancel/recovery states, authoritative balances and invoices; browser/contract tests. |
| M. Seller and invoice copy (M) | address/policy facts | server/inrBilling.mjs/test; src/lib/legalPolicies.js/test | Correct seller snapshot and non-GST configuration, plan/top-up invoice display, documented adjustment handling; focused tests. |
| N. Isolated full acceptance (M) | L,M | Existing verification configuration and execution evidence only | Full npm/Deno/SQL/lint/build/bundle/router, causal guards, isolated Test Mode checkout and registered webhook proof after separate provider approval. |
| O. Release and bounded live acceptance (S) | N,T15,owner approval | Approved additive migrations/server/UI/config only | Keep closed until ready; owner-operated bounded payment, reconcile one benefit/invoice, recovery works while new checkout disabled. |

Checkpoints: B-E financial core; G-K asynchronous/lifecycle core; N full acceptance.
After B/C interfaces are fixed, frontend fixture work and webhook transport can
be delegated in separate worktrees with disjoint files; shared billingApi/router,
SQL runner and migrations remain sequential. Do not dispatch agents merely to
repeat inventory. Independent accounting/security review challenges invariants
before release. That initial plan update preceded implementation; subsequent review and local
execution are recorded in the implementation outcome and execution evidence.

## Docker evidence and planned test matrix

Read-only checks on 2026-10-18 confirmed running containers:
- niyantran-recovery-db: postgres:17-alpine, PostgreSQL17.11.
- niyantran-corpus-test-db: pgvector/pgvector:pg17, PostgreSQL17.11.

Docker CLI is /Applications/Docker.app/Contents/Resources/bin/docker; the initial
shell PATH did not include it. Sandboxed socket access was denied; the approved
read-only CLI call succeeded. Both answered SELECT current_database(),
current_setting('server_version') on database postgres. No restart, reset,
container removal, schema migration or fixture write occurred. The second
container's name does not authorize corpus ingestion; it is the existing local
SQL runner target only, and no ingestion process is invoked.

Use ./supabase/tests/run.sh <focused_fixture> on newly assigned disposable
niyantran_<fixture>_test databases, never an existing data database. Fixture
bootstrap must include current invoice, plan, credit and F225 migrations, with
synthetic users/orders only. Each financial fixture must fail when its protected
migration/guard is absent. Exercise two independent SQL sessions for callback/
webhook races, account credit use during fulfilment and renewal conflicts.

Matrix: forged callback; invalid/absent status; authorized-only; wrong owner,
order, merchant/mode, amount or currency; request replay/body conflict; failed
attempt followed by captured attempt; second capture/overpayment; refund before
capture; simultaneous callback/webhook; signature over altered whitespace/raw
body; browser close; provider timeout before/after order creation; database
failure before invoice; invoice failure after credit work; worker lease expiry;
late webhook; period boundary/31st/leap year; credit debt; historical units;
account deletion; denied anon/customer RPC access and event data visibility.

The planning baseline used Docker readiness SELECTs only. The subsequent local
implementation and runtime verification are recorded in the execution evidence.
Before external Test Mode, prepare the environment route below. Docker SQL
fixtures alone do not exercise Supabase Auth/PostgREST or public Vercel webhook
delivery. Shared-NTER testing requires dedicated buyers and enforced restrictions;
no destructive SQL fixtures may target NTER. Do not expose the local DB/Auth stack.

Planning limitations: no live schema drift query or payment-provider access was
performed in this update. Official Razorpay Checkout/webhook references were
rechecked; Supabase changelog Markdown fetch was unavailable through the web
reader and local DNS lookup, so do not claim a fresh Supabase changelog review.
Resolve that documentation check before production migration approval. Remote
references fetched successfully; planning branch matched origin/main at start.

## Implementation authorization — 2026-10-18

Owner approved local implementation and Docker testing explicitly before T15.
Production changes/provider writes remain separately gated. Seller identity and
address supplied; reviewed adjustments chosen. Read-only production metadata
confirms existing invoice/grant/profile/credit columns and no billing tables.
T15 at16:05 UTC: daily references2/3 each; Growth16:00 writer failed World Bank
GDP timeout after12006ms, retained20 stored rows. No forced refresh.

## Local implementation outcome

Implemented the five-table migration and additive provenance, server catalogue,
owned durable purchases, captured-only atomic benefit/invoice fulfilment, raw-byte
webhooks, leased bounded recovery, anchored paid periods and reviewed adjustments.
Browser Checkout remains closed by default. Existing credit denomination and debt
logic are retained; no historical payment backfill is fabricated.

Files were grouped by interface rather than creating separate migrations for each
slice, so the additive schema and transactional core can be tested as one unit.
Independent read-only accounting/security review completed and findings were fixed.
The new research-chat entitlement RPC dependency must be deployed only after the
approved database migration. No Edge function was deployed locally or remotely.

See [local execution evidence](../research/2026-10-18-razorpay-local-evidence.md).
External Test-mode acceptance, restricted environment preparation, merchant readiness,
secure keys, recovery-runner assignment and production release remain pending.

## Current acceptance checkpoints

| Checkpoint | Status |
| --- | --- |
| Local purchase/schema/financial core | Implemented and locally reviewed; not published |
| Local webhook transport and browser fixture | Executed with mocked provider; not hosted Razorpay acceptance |
| Full local verification | Latest full Vitest403 files/6,324 tests and Deno1,155 green; lint/build/bundle/router passed. Earlier paging timeout did not recur; no paging code/limit changed. Expanded SQL full run45 fixtures passed; evidence records exact scenarios. |
| Dedicated hosted test-buyer restriction | Implemented locally; red/green tests and independent read-only security review passed; not deployed/configured |
| Actual Test-mode provider/webhook/recovery | Pending credentials, environment preparation and approved execution |
| Live release / first real payment | Pending T15, merchant readiness, acceptance and separate release approval |

## Remaining execution route — pre-launch, one hosted database

This route is recommended, not executed by this documentation change. No second
hosted database purchase or provisioning is required. Owner's two-day target is
planning context, not a promise that acceptance gates can be skipped.

| Step | Scope / evidence | Dependencies and ownership |
| --- | --- | --- |
| 1. Finish local acceptance | Diagnose the unchanged bill-sort timeout; map required scenarios to actual tests and fill gaps. Keep destructive SQL and concurrency testing in disposable Docker databases. | Supervisor coordinates; efficient model/medium for focused diagnosis and test mapping. |
| 2. Prepare the hosted rehearsal | Inventory existing owner/test profiles and financial counts read-only; define dedicated test buyers, preserve dataset/credit history and invoice counters; configure the locally implemented/tested server-side buyer allowlist. Prepare restricted Vercel Test preview using NTER, isolated Test keys and its own webhook secret/URL. | Depends on fixed API contract; no provider write or deployment during this documentation task. Shared billing changes remain sequential. |
| 3. Check merchant and operations readiness | Confirm merchant/site approval, capture settings, public policies, recovery owner and backlog/failure monitoring. | Can proceed in parallel with1–2; efficient model/low-medium for checklists, owner for merchant facts. |
| 4. Controlled external Test acceptance | With execution approval and applicable T15 gate satisfied/amended: apply additive migration before app/research-chat; deploy restricted Test preview, register Test webhook, run bounded checkout/capture/duplicate/browser-close/recovery/refund scenarios. Reconcile only the allowlisted test accounts. | Sequential after1–2 and secure Test provisioning. Supervisor operates; independent strong financial review only for new accounting/race defects. |
| 5. Test-to-Live readiness | Preserve clearly attributable Test records; drain pending Test events using the Test-configured receiver/recovery; do not reuse Test buyers as live customers or delete invoices/reset counters. Verify no pending/unexplained balances. Keep public checkout closed. | After4; supervisor owns reconciliation and mode separation. |
| 6. Controlled live release | After T15 closure, merchant readiness, acceptance and separate release approval: deploy reviewed compatible code and scoped research-chat if needed, provision Live credentials/webhook separately, verify closed-checkout readiness. Owner makes one bounded approved real purchase; reconcile one capture/benefit/invoice before general opening. | Sequential. No parallel production migration or release writers. |

Existing Docker inventory on2026-10-18 shows only niyantran-recovery-db
(postgres:17-alpine) and niyantran-corpus-test-db (pgvector/pgvector:pg17), with
no published ports. They are SQL fixtures, not running Supabase Auth/PostgREST.
No container was started, stopped or reset during this documentation update.
A full local Supabase stack is an optional route for additional Auth/API testing;
it needs setup, and external webhooks still need an approved HTTPS receiver.

Server secrets remain RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
RAZORPAY_WEBHOOK_SECRET and RAZORPAY_ACCOUNT_ID; never VITE secret variants.
Keep Test credentials on the Test deployment and Live credentials on the Live
deployment; the same merchant account ID does not make those modes interchangeable.
The current billing orders/events are mode-scoped but credit wallets are shared
per user, which is why dedicated test buyers are necessary on shared NTER.

A bounded manual recovery control exists. Assign a named operator and backlog
monitoring before live opening. Any production schedule needs separate approval;
do not repurpose feed-refresh cron. Rollback closes new Checkout but preserves
compatible webhook/recovery and financial records. No corpus function is in scope.


Reference documentation checked for this environment recommendation:
[Supabase local development](https://supabase.com/docs/guides/local-development)
distinguishes the full local services from a PostgreSQL-only fixture;
[Razorpay webhook testing](https://razorpay.com/docs/webhooks/validate-test/)
requires a reachable public receiver for actual provider delivery. Neither
requirement mandates a second hosted Supabase database.


## Test buyer configuration contract — local preparation

BILLING_TEST_BUYER_IDS contains comma/whitespace-separated verified account UUIDs.
This server-only setting is mandatory for creating new Test-mode orders; an empty
or malformed list denies creation. It is not a browser/email/user-metadata gate.
The verified bearer account must match. Test mode with no valid list advertises
Checkout disabled; the public config never returns the list. Live-mode buyer
eligibility is unchanged. Removal from the list does not strand owned purchases,
webhooks or recovery. No actual account IDs or keys are provisioned in this task.


Hosted rehearsal ingress check: the Razorpay receiver must be reachable without
an interactive Vercel login. Verify deployment protection on the chosen Test URL;
a Razorpay signature does not bypass platform authentication. Prepare a scoped,
approved receiver/access arrangement, then prove real delivery. No broad Vercel
protection change or public tunnel is installed by this local preparation.


## Secure provisioning handoff — pending owner Test credentials

Use Razorpay Test mode to generate a separate key ID/secret pair. Do not paste
values into chat, commit files, output logs or a VITE variable. User enters the
values directly into the approved deployment's environment-variable interface.
Use server-only RAZORPAY_KEY_ID (Test prefix) and RAZORPAY_KEY_SECRET, with Secret
storage for the secret. RAZORPAY_ACCOUNT_ID, a separate RAZORPAY_WEBHOOK_SECRET
and BILLING_TEST_BUYER_IDS are required for the complete rehearsal. The webhook
secret is an independently chosen value, not the API secret.

Scope rehearsal configuration to Preview and exactly task/razorpay-plan; never
Production or all Preview branches. Older previews lack the new buyer guard.
Confirm this branch-specific target is supported/available before provisioning;
if branch publication is needed, it remains within the existing publication gate.
Keep BILLING_CHECKOUT_OPEN closed until dedicated buyers, migrated schema,
compatible code, ingress and execution scope have been verified. Do not register
a webhook or make a provider order merely because credentials have been stored.

This handoff executed no writes or deployment. The connector still returned the
known403 for the exact DDL Labs project. The CLI executable was unavailable in
this runtime and offline npm had no cached package, so no current Vercel settings
are claimed verified. No credential files were inspected; no secret was obtained.
Owner has so far confirmed only a Live key. Test-pair readiness is requested by
mode only; actual values must be provisioned through a secure UI.


## Vercel/GitHub readiness check — 2026-10-18

Owner confirms Test keys are ready but has not provided/provisioned their values.
Read-only GitHub refs show main at3ccdf8a and no task/razorpay-plan remote branch.
The local branch exists at the same base with verified implementation uncommitted.
Vercel CLI64.5.0, installed into a temporary npm cache, successfully used its own
existing authentication for the exact team/project, without inspecting credential
files or exposing environment values. This supersedes the earlier CLI-unavailable
observation. The connector's known403 does not mean CLI access is unavailable.

Project readback: niyantran, GitHub ddllabs/niyantran, Production branch main,
current Production deployment READY at3ccdf8a. Preview deployment protection is
all_except_custom_domains. Environment metadata lists no RAZORPAY_* or BILLING_*
entries. No Test key value was read, saved or sent to any service.

An explicitly scoped attempt to add only BILLING_CHECKOUT_OPEN=0 for Preview and
task/razorpay-plan returned400: branch not found in connected Git repository.
No broader scope was substituted and no environment variable was created. The
next dependency is publication of the verified Test branch; it triggers a Preview
build and needs an explicit exception to the current pre-T15 publication gate.
A question requesting that narrowly scoped amendment is pending. Main/Production,
Supabase migrations, corpus and Live keys remain unchanged.


## Owner-approved Test publication amendment — 2026-10-18

Owner approved the recommended Test-branch publication before T15 closure.
Shared Supabase does not require merging to main: both Preview and Production
already use NTER. Execute only commit/push task/razorpay-plan and its automatic
Preview build; do not merge/push main, apply Supabase migrations, deploy any Edge
Function, change Production settings or provision/use Live keys. Keep Test
Checkout closed. This narrow amendment does not authorize a real payment or
opening public checkout. Hosted application acceptance remains dependent on the
later migration/execution scope and secure Test credential provisioning.
