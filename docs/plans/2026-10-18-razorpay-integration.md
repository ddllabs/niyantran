# Razorpay integration plan

> **Status: Living.** Local implementation verified; approved closed Test Preview published 2026-10-18. Production release remains gated.

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
| Local purchase/schema/financial core | Implemented and reviewed; source published to Test branch only. Hosted migration not applied. |
| Local webhook transport and browser fixture | Executed with mocked provider; not hosted Razorpay acceptance |
| Full local verification | Latest full Vitest403 files/6,324 tests and Deno1,155 green; lint/build/bundle/router passed. Earlier paging timeout did not recur; no paging code/limit changed. Expanded SQL full run45 fixtures passed; evidence records exact scenarios. |
| Dedicated hosted test-buyer restriction | Code deployed on closed Test Preview; red/green and independent review passed. No dedicated buyer IDs configured. |
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


## Secret placement by executing runtime

The browser calls /api/billing/* on Vercel. server/paymentService.mjs executes
Razorpay Orders/Payments HTTPS calls and webhook HMAC validation in the Vercel
Node runtime. Therefore RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET belong to the
branch-scoped Vercel server environment. Supabase Postgres runs trusted atomic
billing RPCs and does not call Razorpay; it does not need those merchant secrets.
Other provider secrets belong in Supabase when its Edge Functions execute those
provider calls. The research-chat change here only consumes an entitlement RPC
and does not need payment credentials. Do not duplicate the Razorpay secrets in
Supabase or introduce VITE variants to make them visible in the browser bundle.


## Closed Test Preview publication result — 2026-10-18

Implementation6a749b6 plus documentation24d51d4 pushed only to task/razorpay-plan.
GitHub main and Vercel Production remain3ccdf8a. Preview deployment
 dpl_GxGydDNFEv1By8T6x5WjpM1eboJX is READY at
https://niyantran-8jirv2za2-ddl-labs.vercel.app . CI run39151639554 completed
successfully on attempt1, both app and SQL jobs. This does not replace T15's main
CI/source-observation criteria or constitute provider acceptance.

BILLING_CHECKOUT_OPEN=0 created successfully only for Preview/gitBranch
 task/razorpay-plan; metadata readback confirmed that scope. Authenticated CLI
GET /api/billing/config on the exact deployment returned enabled=false,
checkoutOpen=false, no public key and five INR packs. No financial RPC called.
No migration, Supabase Edge deployment, real/Test provider payment, webhook
registration, main merge or Live key change occurred. Owner secure entry of the
Test pair remains pending; no secret values were supplied/read by the agent.
The latest readiness record is local and not included in24d51d4; separate prior
M1/M2 observation edits remain unstaged. No additional push was made solely to
record verification, avoiding a redundant Preview/CI cycle.


## Closed Test Preview credential refresh — 2026-10-18

Owner approved next Test setup steps and Preview verification with Checkout closed,
Live keys/Production unchanged and corpus excluded. Keep payments on Vercel;
Supabase remains the accounting database. This does not approve hosted migration,
provider writes, checkout opening or a Production/Edge release.

Environment metadata now confirms RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are
Sensitive, Preview-only, gitBranch task/razorpay-plan; neither is scoped to
Production. BILLING_CHECKOUT_OPEN is exactly0 in the same branch scope. Values
were not decrypted, read or printed; key mode, pair validity and Razorpay account
access are not verified by this metadata check. This supersedes earlier notes
that secure key provisioning remained absent.

Executed authenticated CLI redeploy of prior Preview dpl_GxGydDNFEv1By8T6x5WjpM1eboJX,
explicit --target preview, using published commit24d51d4. New deployment
 dpl_2D72ZQmN9hmLytECecJNYH97HXPm is READY (34-second build):
https://niyantran-oo07tez73-ddl-labs.vercel.app . Branch alias:
https://niyantran-git-task-razorpay-plan-ddl-labs.vercel.app . No source push,
main merge, new CI run, database migration or Edge deployment occurred.

Executed checks via authenticated vercel curl on this exact deployment:
- GET / serves an HTML document and bundled entry scripts.
- GET /api/billing/config returns Razorpay, enabled=false, checkoutOpen=false,
  no exposed key, five packs and INR.
- GET /api/billing/quote?planId=plus returns Plus monthly399/39900paise and
  approved seller name/address/support email.
- POST /api/billing/create-order with empty JSON and no application bearer
  returns401 Authentication required, before any order/provider operation.
- POST /api/billing/webhook with empty JSON returns503 Webhook not configured,
  before event persistence/provider operations. This is expected missing setup,
  not successful signed-webhook acceptance.
- Plain unauthenticated GET of the webhook returns302 to vercel.com. Existing
  all_except_custom_domains deployment protection remains unchanged; provider
  delivery requires a separately approved scoped ingress arrangement.

Production project target read before/after is unchanged:
 dpl_VTPtwrTtawEMkvKyq9WgfAGtQV2m, SHA3ccdf8a343070d5365a6093c84230afaf0e1e441.
This current observation supersedes older production deployment IDs while keeping
that same source commit; this execution did not redeploy Production.

Remaining setup: RAZORPAY_ACCOUNT_ID, independent RAZORPAY_WEBHOOK_SECRET and
BILLING_TEST_BUYER_IDS are absent from environment metadata. Dedicated test buyers,
hosted additive migration and compatible release sequence, approved webhook ingress,
actual Test provider acceptance/reconciliation, recovery ownership and M1/M2/live
release gates remain outstanding. No Razorpay order/payment/webhook registration,
secret extraction, financial record write or corpus operation occurred. Existing
local documentation edits are preserved; source unchanged, no suite rerun warranted
for a same-commit Preview rebuild and documentation-only evidence update.


## Branch-only Test configuration completion — 2026-10-19

Owner approved proceeding after the read-only setup review. Scope executed here:
Test branch configuration and closed Preview refresh only. Shared NTER database,
Live keys, Production deployment/protection, Edge Functions and corpus unchanged.

Supabase read-only lookup previously confirmed the owner-selected email maps to
one confirmed, non-deleted Auth account. Its UUID was saved as Sensitive
BILLING_TEST_BUYER_IDS only for Preview/gitBranch task/razorpay-plan. This is the
existing owner-selected account, not a newly created synthetic account; future
Test purchases will affect its shared wallet and invoice history if approved.
No account/financial rows changed. The exact UUID was supplied to Vercel only in
the approved server configuration, never exposed by the public billing endpoint.

Removed only environment entry jUSOF6ZammskG9AD (RAZORPAY_WEBHOOK_SECRET scoped to
all Preview branches), retaining branch-specific VTzpjgqrre24OqVp. Readback proves
six billing entries, all Preview/task/razorpay-plan only, no Production target;
BILLING_CHECKOUT_OPEN remains0. No secret values were decrypted/read/printed.
Owner screenshot confirms the correct branch webhook URL is enabled in Razorpay
Test mode with55 subscriptions. Exact event selections and matching secret values
remain unverified; unrelated events may become unresolved inbox work in the
current generic payment/order/refund/dispute processor. No Razorpay settings changed.

Authenticated CLI redeployed prior Test deployment explicitly to Preview. New
 dpl_HRHCghckTkLp5Jzqcp8uDvhunGzC READY at
https://niyantran-bku7m5sav-ddl-labs.vercel.app ; branch alias unchanged; build40s.
Same published source24d51d4, no source push or new GitHub CI. Deployed config
returns enabled=false, checkoutOpen=false, no exposed key and five packs.
Production target before/after remains dpl_VTPtwrTtawEMkvKyq9WgfAGtQV2m,
SHA3ccdf8a343070d5365a6093c84230afaf0e1e441; protection all_except_custom_domains.

**New executed transport blocker:** authenticated CLI JSON POST {} to the new
Preview webhook returns400 `Webhook raw body unavailable.`, not the expected
invalid-signature response. Previous503 configuration block is gone, but this is
not webhook acceptance. readRawPaymentBody reads req.body, which Vercel documents
as a lazy JSON-parsing getter. A local Readable with original whitespace-bearing
JSON bytes and an equivalent body getter reproduces400 with4 getter accesses.
The existing router fixture uses a plain stream and misses this host-helper case.
This supports the source-level cause; actual signed provider delivery is not run.
Do not reserialize JSON for HMAC or weaken the signature/parsed-only rejection.
A scoped fix must preserve original bytes without invoking the host body getter,
cover the lazy getter causally, retain bounds and parsed-only refusal, and run
focused/full applicable checks before a new source publication is proposed.
No source fix has been applied or published in this configuration-only execution.

Public branch webhook still returns302 to Vercel authentication. Official Vercel
options include automation-bypass credentials (project-wide authority) in webhook
URLs, domain exceptions (entire Preview domain exposure; plan/add-on dependent),
and shareable links (deployment/branch access, webhook POST behavior needs proof).
No access protection was weakened or bypass credential registered with Razorpay.
OPTIONS allowlists do not solve POST webhook delivery. Resolve an exact approved
ingress method before attempting provider events. Hosted billing migration is
still absent per prior read-only table/RPC check; no migration was applied here.
Checkout opening, shared DB migration, real Test transactions, event subscription
cleanup, secure ingress and later M1/M2/live release gates remain open under O6.

Sources: https://vercel.com/docs/functions/runtimes/node-js (lazy request.body),
https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection .


## Approved local webhook transport fix — 2026-10-19

Sequential scope: (1) src/lib/billingWebhookRouter.test.js and paymentService.test.js
causal host-helper tests, retaining existing negative tests; (2) minimal
server/paymentService.mjs raw-reader correction without invoking req.body getter;
(3) focused payment/router checks, full npm/Deno suites, lint, build, bundle and
router import; (4) review and evidence under O6. No new source publication, schema,
remote settings, secret access or corpus work. Preserve earlier documentation and
M1/M2 observation changes. Vercel upstream helpers.ts confirms lazy parsing and
restoration of original bytes to the request stream; do not reconstruct JSON.


## Local webhook raw-body correction — 2026-10-19

Owner explicitly approves the scoped original-byte transport fix and local
verification only; no source publication or remote mutation is part of this task.
Write scope: server/paymentService.mjs, src/lib/billingWebhookRouter.test.js,
src/lib/paymentService.test.js and existing billing spec/plan/evidence/O6 records.
Earlier documentation/M1/M2 observation edits are preserved.

Causal evidence:
1. Added two router regressions emulating Vercel's lazy JSON getter. Both failed
   before the fix:400 raw-body refusal, getter invoked; three existing cases pass.
2. Merely avoiding the getter preserved a plain stream, but a real localhost HTTP
   fixture modeling Vercel consuming/restoring the body returned no original bytes.
   A new consumed/restored router regression failed with invalid signature against
   that intermediate implementation. This is an intentional red checkpoint, not
   a random suite failure. An overlapping interim full suite also failed that same
   newly introduced restoration test (402 files/6,330 tests passed).
3. Final reader inspects only own body data descriptors, never evaluates the lazy
   JSON getter, and reads Vercel's replayed data/end events. Buffer/string handling
   and128KiB default bounds remain; parsed-object-only input still fails closed.
   Interrupted/errored streams reject; excess body chunks are not accumulated.
   Signature comparison, merchant binding, deduplication and fulfilment unchanged.
4. Same real localhost HTTP consumed/restored fixture now proves exact original
   whitespace/UTF-8 bytes, valid HMAC and zero getter reads. No external service,
   real secret or database was involved. Router fixtures also reject signatures
   computed from reserialized JSON before persistence/provider requests.

Final focused command:
 npm test -- src/lib/billingWebhookRouter.test.js src/lib/paymentService.test.js src/lib/billingApi.test.js
passes3 files/80 tests:6 router,35 payment service,39 billing API. Extra boundary
checks preserve exact byte limits across Buffer/string/stream, reject oversized
lazy streams without parsing, and reject partial/error bodies. Final Deno suite
 deno test -A --config supabase/functions/deno.json supabase/functions
passes1,155 tests. npm run lint, npm run build, npm run check:bundle and
 node -e "import('./api/router.js').then(() => console.log('router import ok'))"
all pass; build4.75s, initial JS180,735bytes gzip, no bundle-limit advisory.
Final full Vitest result is recorded below after completion. No standalone
TypeScript check exists. SQL fixtures are not rerun: no migration, SQL contract
or database authorization change in this transport-only fix.

Review: no body reserialization or signature bypass; raw-byte hash remains based
on original bytes; invalid requests fail before RPC/provider calls. No global
parser/helper disabling, route change or dependency added. Local fixtures model
Vercel upstream helpers.ts restoration; actual deployed-runtime/provider acceptance
still requires approved Test publication and signed delivery. Existing Preview
remains the pre-fix24d51d4 build; Checkout remains closed. Public ingress, narrowed
subscription review, shared NTER migration, actual provider acceptance and live
release gates remain pending. No git commit/push, deployment, hosted database or
configuration operation, Live credential use, payment or corpus change occurred.

Runtime reference checked:
https://github.com/vercel/vercel/blob/main/packages/node/src/serverless-functions/helpers.ts
(restored stream events plus lazy body parsing), alongside official Node helper docs.


Final local verification completed2026-10-19: npm test passes403 files/6,333 tests
in108.48s. Final Deno passes1,155/0 failed. Focused payment/router80 tests, lint,
build, bundle gate, router import and git diff --check all pass. No build warnings
matched the warning/deprecation scan. All runtime changes remain uncommitted on
task/razorpay-plan; prior documentation edits and separate M1/M2 observations are
preserved. No push, deployment, provider action or Production/corpus mutation.


## Owner-approved Test publication — 2026-10-19

Owner approves pushing the verified raw-body correction only to task/razorpay-plan
and refreshing/verifying its Test Preview. Local verification remains403 files/
6,333 Vitest and1,155 Deno plus lint/build/bundle/router checks; no runtime change
since those checks. Checkout remains0, all six billing variables branch-only.
Production/main, Live keys, database migration, protection settings, provider
transactions and corpus excluded. Separate M1/M2 observation edits are not part
of this publication. Deployed verification evidence will follow after readiness.


## Published raw-body fix / Test Preview verification — 2026-10-19

Owner-approved commit18db3026e24b8add40d79ab4fc31c000f850db67 pushed only to
origin task/razorpay-plan. Includes the reader, two regression test files and
related billing records; O6 tracker hunk staged separately. Unrelated M1/M2
tracker/evidence edits remain local, unmodified by this publication. No main
merge/push. Existing local test evidence remains6,333 Vitest/1,155 Deno and all
listed lint/build/bundle/router checks; runtime source unchanged after those runs.

Automatic Git Preview build satisfies the requested Test redeployment:
 dpl_HtZeAsvc2oVEpSPj7Po9u77n6inf READY,31-second build, exact source18db302,
branch task/razorpay-plan, project prj_6UiaDz2rkTOmqIOaXnCAs92V7d86.
URL https://niyantran-rob528205-ddl-labs.vercel.app ; stable branch alias unchanged.
No redundant manual redeploy or second source push was performed.

Executed hosted checks using authenticated vercel curl on that exact Preview:
- Whitespace/Unicode JSON POST without signature returns400 Invalid webhook
  signature (before fix:400 Webhook raw body unavailable).
- Malformed JSON without signature also returns400 Invalid webhook signature,
  confirming host JSON parsing is not triggered before original-byte validation.
- Oversized JSON returns413 Request too large, preserving the128KiB limit.
- Public config: enabled=false, checkoutOpen=false, key absent, five packs.
- Unauthenticated create-order POST returns401 Authentication required.
- Application root serves HTML with two JS entry scripts.
No probe has a valid signature/application bearer, so none can persist a billing
inbox/order/financial record or invoke Razorpay. These prove deployed transport
and refusal behavior, not successful signed provider delivery or key-pair validity.

Environment metadata before publication confirms all six billing entries scoped
to Preview/task/razorpay-plan; closed flag0. No environment or secret value changed
or decrypted. Production target after publication remains
 dpl_VTPtwrTtawEMkvKyq9WgfAGtQV2m, source3ccdf8a343070d5365a6093c84230afaf0e1e441;
protection remains all_except_custom_domains. Plain public branch webhook GET
still302; no protection exception/bypass provisioned. Supabase migration/Edge
functions, Live keys, provider settings/payments and corpus untouched.

GitHub CI39160473575 started for exact18db302, attempt1; final result below when
complete. Signed Razorpay acceptance, public ingress, subscription narrowing,
shared NTER migration and M1/M2/live gates remain open under O6. Post-deployment
verification notes remain local to avoid a redundant documentation-only build.


Final publication verification: GitHub CI39160473575 completed SUCCESS on attempt1
for exact18db3026e24b8add40d79ab4fc31c000f850db67; Build and tests plus SQL fixtures
(disposable Postgres) jobs both pass. Remote Test ref is18db302; remote main stays
3ccdf8a. Preview raw-body transport correction is published and verified; broader
O6 provider acceptance remains open. Post-deployment evidence updates are local
and uncommitted; no second docs-only push/build was triggered.


## Controlled hosted Test rehearsal authorized — 2026-10-19

Owner directs completion of remaining Test end-to-end work before moving to Live.
This authorizes the previously described additive billing migration on shared NTER
and bounded simulated purchases for the owner-selected allowlisted account. Test
checkout may be opened only on task/razorpay-plan for the rehearsal, then closed.
Production checkout, Live credentials and corpus remain excluded until Test
acceptance and remaining M1/M2/live gates pass; any real payment is owner-operated.
No automatic production recovery schedule is included.

Ordered execution: (1) read-only migration guard/schema comparison plus retained
financial fingerprints/counts; (2) apply reviewed migration526lines SHA256
21ad5d2c23558454190729a6b9cdec54279fc0c6aab291f20c18e248d6757122; (3) prove
five private RLS tables/service-only RPCs and unchanged existing data; (4) arrange
scoped temporary Test webhook access and narrow provider subscriptions; (5) confirm
Test-mode runtime/allowlisted buyer, open only Test checkout for bounded provider
flows; (6) reconcile capture/credit/invoice/idempotency/recovery/refund facts, close
Test checkout, retain traceable Test records; (7) only then staged Live readiness.
Use native Checkout/dashboard, never fake a provider capture or historical invoice.

Preflight: reviewed local/remote Test commit18db302 matches, origin/main3ccdf8a;
hosted billing tables absent, private.credit_due_cycles exact guard matches.
Existing state:11 profiles,4 wallets,7 lots,28 ledger rows,0 plan grants/invoices;
total balance/remaining33,304.4895 credits, debt0. Fingerprints captured separately
for post-migration verification. Production functions do change with this reviewed
additive migration; web deployment/Live checkout are not thereby activated.
M1/M2 daily references remain incomplete; no forced refresh or false closure.
Browser controls fail across Arc/IAB/Chrome; owner Test UI handoff requested while
independent backend preparation continues. No secrets are read/exported.


## Hosted migration result / Test ingress hold — 2026-10-19

Applied reviewed billing_purchases SQL to NTER using Supabase apply_migration after
owner's controlled end-to-end Test authorization. Hosted history version
20261018200238/name billing_purchases maps to reviewed repository file
20261018160700_billing_purchases.sql, SHA256
21ad5d2c23558454190729a6b9cdec54279fc0c6aab291f20c18e248d6757122. Tool reports
success; this is the shared hosted schema change, not a Vercel production release.

Post-migration checks: all five private tables exist with RLS, no direct
anon/authenticated/service_role DML. Five public billing RPCs permit service_role
execution only, denying anon/authenticated. Profiles11, wallets4, lots7, ledger28,
grants0/invoices0. Fingerprints of every original profile/wallet/lot/ledger row
(excluding additive NULL link columns) match baseline; balance/remaining
33,304.4895 and debt0 unchanged. All five new billing tables have0 rows. No test
financial fixture or fake payment inserted into hosted NTER. Owner-selected buyer
is active/admin/free with3,304.4895 credits and zero debt.

Browser automation unavailable: IAB navigation/focus commands fail, Arc content
unavailable, Chrome extension timed out. Owner agrees to manually execute guided
Razorpay Test dashboard/Checkout steps while supervisor reconciles backend facts.

Ingress experiment: created a7200-second shareable link for only the Test branch
alias. Standard automation-bypass query parameter returned302; correct share-link
parameter returned307 cookie handshake on an unsigned POST. It is not proved a
usable direct Razorpay receiver. Revoked the unused token successfully; no secret
URL/token printed, committed or sent to Razorpay. Temporary token request/response
files remain private in /private/tmp for audit and are never repository artifacts.

Attempt to apply a Test-alias-only protection override was rejected BEFORE
execution by automatic approval review: the API creates a non-expiring exception,
whereas authorization was for a bounded rehearsal. No workaround attempted.
No alias exception, project-wide bypass credential or paid add-on enabled.
Public webhook remains302 and Test Checkout remains enabled=false/open=false.
Explicit approval required for a persistent-until-manual-revocation Test-alias
exception (exact alias niyantran-git-task-razorpay-plan-ddl-labs.vercel.app), keeping
app authentication, server buyer allowlist, HMAC and Production protection intact.
No Live credential change, main/Production web deployment, Edge deployment,
provider transaction, webhook setting, timer or corpus operation. M1/M2 live
opening gate remains pending genuine daily opportunities; no forced refresh.

Next controlled owner pilot after ingress approval: ensure Razorpay Test mode;
review webhook subscriptions, retain the shared webhook secret; sign in to the
Test Preview as the allowlisted account; only after Test runtime confirmation
open restricted Test checkout, buy the20,000-credit/499INR Test pack through
Razorpay's simulation, then reconcile capture/order/lot/ledger/invoice exactly once
before proceeding to paid-plan/failure/recovery/refund cases. Close Test checkout
when the rehearsal ends. No real card/payment or Live activation is authorized
by a Test screenshot or an unsigned probe.


## Approved Test alias exception and owner pilot ready — 2026-10-19

Owner explicitly approved the Test Preview alias exception until manual revocation
after testing. Applied only to niyantran-git-task-razorpay-plan-ddl-labs.vercel.app
using alias-protection-override; no paid add-on or project-wide bypass enabled.
Unauthenticated unsigned webhook POST now reaches application HMAC rejection400,
including after redeployment. This proves ingress, not a valid provider delivery.
Manual revocation remains required when Test acceptance ends.

Updated only BILLING_CHECKOUT_OPEN Preview/task/razorpay-plan to1 for the approved
allowlisted owner rehearsal. Redeployed verified18db302 as
 dpl_7Z3ZA131HxYPektqosTJ7tUgF5Ws, READY. Public runtime configuration confirms
enabled=true, checkoutOpen=true and key prefix Test (key value never printed).
Existing server Test-buyer UUID restriction remains in force. Secret pair validity
and webhook-secret matching remain unproven until a genuine Test transaction.
Production remains dpl_VTPtwrTtawEMkvKyq9WgfAGtQV2m/3ccdf8a; project protection
remains all_except_custom_domains. Live credentials untouched. Shared NTER schema
was upgraded as recorded above; no financial rows created: orders/payments/events/
invoices all0 immediately before owner pilot. No Edge/timer/corpus operation.

Owner next: sign in on the Test branch, open account/billing, select the20,000-credit
499INR top-up and use Razorpay Test Netbanking simulation Success. Pause after one
attempt for capture, webhook, lot, ledger and invoice reconciliation. Do not
repeat pending purchases. Close Test Checkout and revoke the alias exception when
testing finishes. External acceptance and O6 remain open; no Live readiness claim.


## Test order diagnostics — local execution sequence, 2026-10-19

1. Add causal tests in src/lib/paymentService.test.js for sanitized upstream
   status, transport failure and provider-create versus order-bind stages.
2. Change only server/paymentService.mjs: retain bounded provider HTTP status
   on internal errors and emit fixed server diagnostic fields; never log raw
   errors/response bodies/config. Keep pending flow and no POST retries.
3. Run focused Vitest, full Vitest/Deno (src/lib change), lint, build, bundle
   check and router import. Record results in billing evidence and O6.
4. Await approval to publish diagnostics to Test Preview; then one controlled
   attempt/recovery with preserved purchase IDs can identify the hosted cause.
   No Production/Live, provider setting, database migration or corpus change.

Owner approved push/deploy of diagnostics only to Test Preview2026-10-19;
Production, Live keys and corpus remain unchanged. No repeat pending Plus POST.


## Test diagnostic publication — 2026-10-19

Owner approved diagnostics-only Test publication. Runtime895b7a0 and isolated O6
recordcd1413c pushed only task/razorpay-plan; unrelated M1/M2 observation hunks
remain local. Deployment dpl_8ouxfCPPnQ2zQMrE7Zh3Vtr9B26g READY at exactcd1413c,
branch alias publicly reports enabled/open Test mode. Unsigned webhook400 retains
HMAC enforcement and approved alias exception. Production remains
dpl_VTPtwrTtawEMkvKyq9WgfAGtQV2m/3ccdf8a and protection all_except_custom_domains.
No env/key/schema/provider/Edge/timer/corpus changes in this publication. CI
39164169136 attempt1 in progress at initial deployment verification.

Existing pending Plus intents are reused without a new provider call, so owner
was asked to reload the Test Preview and select the previously unattempted
20k/499INR top-up once, stopping at Checkout or pending/error without payment.
Awaiting that controlled reproduction before claiming a hosted cause. No keys
were inspected/exported; do not repeat unresolved Plus requests or fabricate facts.


## Hosted diagnosis confirmed: provider authentication rejection — 2026-10-19

Owner reproduced on the diagnostic Preview by selecting20k/499INR top-up; Plus
remained pending. Safe runtime log at2026-10-18T20:39:36.189Z, request
w8fhv-1792355976024-36e3d4200570, deploymentdpl_8ouxfCPPnQ2zQMrE7Zh3Vtr9B26g:
billing_order_creation_failed {stage:provider_create,category:http,providerStatus:401}.
Thus the request reached Razorpay and failed API authentication before order bind
or browser Checkout. The exact credential fault (mismatch/copy/revocation/etc.)
is not established; Test prefix alone was never pair validation. Webhook secret
is not used for order-create API authentication. No raw provider response, key
or secret was inspected or printed.

Read-only NTER shows top-up intent734e8f1c-f2a1-4b66-8978-7bc72de65c67 reconciling,
49900paise, provider_order_idNULL,attempts1,created20:39:36.155525UTC. Two prior Plus
intents remain reconciling/unbound. Payments/events/invoices all0. No agent
provider write, retry, refund, key/config change, Production/Edge/corpus action.
Next required owner action: securely replace RAZORPAY_KEY_ID and KEY_SECRET with
the matching active Test pair, Preview/task/razorpay-plan only, no quotes or
whitespace; preserve webhook secret/merchant/Production/Live. If original Test
secret unavailable, owner may regenerate Test keys only. After owner reports
saved, redeploy Test Preview then use bounded GET recovery/authentication evidence
before any new purchase intent; preserve unresolved records and stable IDs.
CI39164169136 was still in progress at diagnosis read. O6 remains blocked on
Test API credentials, then full provider/accounting acceptance.


## Owner secret update / Test redeploy metadata mismatch — 2026-10-19

Owner reports adding Test API secret and authorizes Test redeploy. Redeployed only
existingcd1413c with explicit --target preview: dpl_AMXGYdcbnso3kdKugsZhSC6rqMKh
READY, niyantran-hquydl7f0-ddl-labs.vercel.app. Stable branch config enabled/open
Test mode; no secret values inspected. CI39164169136 both app+SQL success attempt1.

Env metadata identifies likely wrong-field update: RAZORPAY_KEY_SECRET updatedAt
1792347945274 (Oct18 23:55:45IST), unchanged from prior; WEBHOOK_SECRET updatedAt
1792357151187 (Oct19 02:29:11IST). All six billing vars remain Preview and exact
Test branch only. Do not initiate more Test order attempts until owner securely
updates API KEY_SECRET and verifies webhook secret still matches Razorpay webhook.
We cannot infer secret contents from these timestamps; no value was exported.

Observed a separate Production source=redeploy created02:29:19IST, deployment
dpl_3jVL7ikUYANELS4Jt94vDF1Sqckj, main3ccdf8a unchanged and protection still
all_except_custom_domains. This differs from earlier production deployment ID;
agent did not invoke production redeploy. Exact initiator not established. No
Production billing vars or Live keys introduced. Reported discrepancy honestly;
no rollback or other Production mutation attempted. Corpus remains excluded.


## Recovery fix execution plan — 2026-10-19

Sequential; no delegation. First add failing service tests and SQL fixture plus
runner chain. Then additive migration20261019000000_billing_creation_retry.sql
(new columns/service-only billing_creation_retry RPC). Next wire service rejection/
atomic retry, truthful purchase history and client retry messaging; no automatic
client retry or new intent IDs. Scope: server/paymentService.mjs,billingApi.mjs;
src/lib/paymentService.test.js,billingClient.test.js,billing.js;
src/shell/credits/Purchases.jsx; new SQL fixture/concurrency script and run.sh.
Run focused tests and disposable SQL first; then all required application/Deno/
SQL gates and build/lint/bundle/router. Review state machine and stale-worker cases.
Commit/push/deploy only verified Test code after hosted migration gate resolved;
keep main/Production web/Live/corpus untouched. Shared migration/legacy reviews
require concrete owner approval as stated in spec. Record all evidence in existing
billing record and O6; preserve unrelated local M1/M2 observations.


Final recovery verification:403files/6351Vitest pass242.59s;1155Deno pass;
46 SQL fixtures pass including migration vacuity and both retry/capture two-session
concurrency. Original billing_purchases.sql also passes on the disposable DB
with the new migration applied. Focused4files102pass; lint/build/bundle/router
import and diff whitespace pass. Source review covers immutable quote, scoped
buyer/account/mode, authenticated Test-only operator boundary, consumed retry
permission before POST, lease mismatch refusal, no blind uncertain re-POST and
unchanged signature/capture/credit/invoice core. No new dependency or credential.

Release dependency: migration20261019000000_billing_creation_retry.sql SHA256
08fb259183945440ce4e075023a30a6a716016b1e19a7e2d15b5167be3da7f85 adds two
metadata columns and one service-only RPC; no new table or financial backfill.
This is a shared hosted database schema mutation, so it is not implied by the
owner's instruction to keep Production unchanged. Concrete approval required
before applying it, and before audited review of the exact old Test intents
068c065d-2751-471f-9eff-902e69f48170,5af59ea0-3575-4d79-be5a-b89457853c6a,
734e8f1c-f2a1-4b66-8978-7bc72de65c67. Read-only recheck confirms all unbound/
reconciling/Test with zero linked payments/invoices. Operator reason must cite
owner's provider-absence evidence, not invent historical401 for the two Plus
requests without retained status logs. Audit rows remain; no grants/invoices
or provider charges occur from classification. Actual provider receipt review
is required before executing the operator action. Code publication to the Test
branch is already approved, but deploying before its DB dependency would break
purchase history and retry RPCs; preserve the current working Preview meanwhile.
No hosted migration, legacy row repair, push, redeploy, Production or Live-key
change performed in this recovery implementation turn. Corpus excluded.


## Recovery migration applied — 2026-10-19

Owner explicitly approves additive shared migration, provider review of three
old Test attempts, conditional retry classification and Test-only publication.
Applied exact reviewed08fb2591 SHA migration to NTER successfully; hosted
history20261018214242/billing_creation_retry maps to local20261019000000.
New RPC denies anon/authenticated execution and grants service_role only.
No retry records modified; payments/events/invoices0. Wallet/lot/ledger complete
row fingerprints match preflight:bd65c80f30935125ed928db1814d2d4f /
e57fd2321652e45372d5d792367b25c6 /61f278e7e4381ea803dc5971a37f5134.
Production web preflight dpl_4HUQ975dnQattdSnfW5TL5cRCXf2/main3ccdf8a and
all_except_custom_domains protection. No Live/env/provider/corpus change.
Arc initially blank; after owner's 'check again' dashboard HTML accessible and
Test mode confirmed. Actual provider receipt review now in progress before
classification; do not infer absence from database rows alone.


## Provider review and legacy retry classification — 2026-10-19

After owner opened Orders, Arc exposed actual Test dashboard HTML and screenshot.
Account matches all three local attempts. Orders tab, All status selected, empty
search/status filters, complete Showing1-2 inventory: only new Pro
order_TpW05aqrgP5E0y/81439bec-7700-4241-8985-0c02a0df56c3 and50k top-up
order_TpVy9B8fGCcZSy/720f9f12-8ed9-4ae2-a1d6-921c2987c303; both Created,
zero attempts. Today includes all old attempts (Oct19IST). Overview zero captured
payments/refunds/disputes. Thus old three exact receipts absent from full provider
inventory, independently of the local DB. No provider settings or payment modified.

Executed approved service-only review_rejection for exactly the three listed
Test IDs, actor the owner-selected active admin. Each retains original row/quote,
state reconciling, creation_retryable=true and exactly one operator audit entry
with reason/time/actor; no fabricated provider401 history. Newer ready Pro/50k
orders untouched. Post-review payments/events/invoices0 and complete ledger,
wallet and lot hashes still match preflight. No credit grant, invoice, refund
or provider-order POST performed by this review. Ready to publish verified Test
code; Production web/Live/corpus remain excluded.


## Recovery Test release — 2026-10-19

Runtimef96863f plus migration/review recordsd709ecb pushed only task/razorpay-plan.
Vercel dpl_CnpXP4qtm4HgnKarC3SuUF7uPzHE READY/exactd709ecb,
niyantran-chcecpdfo-ddl-labs.vercel.app and stable branch alias. Public config
enabled Test mode; unsigned raw webhook400. Production web target/protection
identical to preflight dpl_4HUQ975dnQattdSnfW5TL5cRCXf2/main3ccdf8a. No env/Live
key or corpus action. CI39169346694 attempt1 in progress at initial verification.

Actual signed-in browser purchase-list/config/invoices requests200 on release.
New service-only list returns5 owned Test purchases. Arc AX state stalls while
screenshot says Loading view; owner handoff requested for one old20k/499INR
retry, stopping at Checkout, no payment. Cannot claim hosted retry/capture yet.

Separate existing defect observed during release: GET billing/adjustments503.
Read-only execution of billing_event('reviews',Test scope) reproduces42702:
PL/pgSQL variable pay collides with table alias pay.id. This branch predates
recovery migration; not modified opportunistically. Record under O6 for scoped
fix before refund/operator acceptance. No missing adjustment records inferred
from UI's empty fallback. This does not invalidate observed purchase-list200.


## Owner retry verification and remaining status wording — 2026-10-19

CI run 39169346694 completed successfully on attempt 1: Build and tests and
SQL fixtures (disposable Postgres) both green. Owner confirms Checkout opened
for the old purchases. Read-only hosted reconciliation confirms original Plus
purchase 5af59ea0-3575-4d79-be5a-b89457853c6a now ready with provider order
order_TpWenTd5VhXmFa, and original 20,000-credit purchase
734e8f1c-f2a1-4b66-8978-7bc72de65c67 now ready with order_TpWf2N4uGahVvQ.
Both consumed retry permission and retained their single review audit. Total
purchase intents remains five; payments and invoices remain zero. Wallet, lot
and ledger fingerprints remain unchanged. The separate oldest Plus attempt
068c065d-2751-471f-9eff-902e69f48170 remains reviewed/retryable and unbound.

Owner screenshot shows Payment cancelled alongside Confirmation pending in
history. Purchases.jsx maps ready/unpaid provider orders to the generic pending
label. This is a remaining wording defect, not evidence of capture or renewed
creation failure. Track a scoped distinction between Awaiting payment for ready
orders and uncertain confirmation/reconciliation. Closing Checkout currently
has no durable cancelled-history state; preserve provider order and stable
purchase identity rather than delete the audit or invent a payment fact.
Actual Test payment, credit/invoice fulfilment and signed provider webhook
acceptance remain pending. No additional web deployment or production action
was performed for this verification.

## Purchase status wording — approved Test-only follow-up 2026-10-19

Scope and ordered verification: docs/specs/2026-10-19-purchase-status-wording.md.
Ready unpaid orders now render Awaiting payment; uncertain, retryable and
terminal labels retained. No payment, stable-intent, API or SQL logic changes.
Causal rendering test failed for ready status before fix (six other cases passed).
After fix: 58 focused tests pass; lint, production build and bundle check pass.
Full application suite and approved Test publication verification pending.

Local full application suite completed: 404 files, 6,358 tests pass (119.90s).
Wording commit 10fd50a pushed only task/razorpay-plan; Preview build
dpl_DHpUe1gv4isyHGpLRkbELS4BW81v in progress, exact SHA10fd50a.


## Purchase wording Test deployment verified — 2026-10-19

Commit10fd50a3cc91ea531f42ba32b065e0bef47559a1 deployed READY as
 dpl_DHpUe1gv4isyHGpLRkbELS4BW81v; stable Test branch alias resolves to it.
HTTP read of deployed assets/CreditsPage-DWQPpEer.js confirms Awaiting payment
and retained Confirmation pending labels. Public billing config remains Test.
Production target before/after remains dpl_4HUQ975dnQattdSnfW5TL5cRCXf2 at
main3ccdf8a, protection all_except_custom_domains unchanged. No environment
variable edits, database mutations, provider writes, payment or Live action.

Local full suite404 files/6358 tests, focused58, lint/build/bundle/router and
whitespace checks pass. CI39170163103 app/SQL jobs in progress at final check.
Arc reloaded the signed-in billing page but its data stays in loading state;
actual refreshed history labels could not be observed in that browser session.
Deployed asset verification and local rendered-state regression are complete;
owner should reload the Test billing page to continue the payment rehearsal.
The separate operator-list503 defect remains open and untouched.
