# Razorpay plans and credit top-ups

> **Status: Living.** Local implementation approved 2026-10-18, explicitly before T15 closure.
> Narrow Test-branch publication approved and closed Preview deployed. Main/Production, hosted migration, provider writes and Live activation remain gated. Tracked under existing F107/F110/O6.

## Objective and existing decisions

A signed-in active account can buy a monthly paid plan or a credit top-up,
receive exactly the purchased benefit once after capture, and retrieve a durable
invoice even if the browser closes before completion. Free and paid accounts
can buy top-ups. A top-up does not change model eligibility or buy a paid plan.

One credit represents INR0.01 of provider cost; this is the accounting unit,
not a promise that retail top-up prices equal quantity multiplied by0.01.
Preserve completed F225 conversion, original ledger entries and lineage.
Monthly prices/allowances: Plus399/20,000; Pro999/65,000; Max9,999/750,000.
Free signup10,000 valid30 days. No automatic renewal or subscriptions at launch;
10% unused monthly rollover and12-month top-up expiry remain. Existing decided
renewal anchoring and next-cycle downgrade semantics need implementation review,
not another product-decision round.

The owner subsequently confirmed the proposed top-up prices in this chat. Carry
that confirmation forward; earlier living documents saying unapproved are stale:

| Credits | Price INR | Payment amount in paise |
| ---: | ---: | ---: |
| 20,000 | 499 | 49,900 |
| 50,000 | 1,199 | 119,900 |
| 100,000 | 2,299 | 229,900 |
| 200,000 | 4,399 | 439,900 |
| 500,000 | 10,499 | 1,049,900 |

No current GST collected under the existing unregistered-seller assumption;
owner reconfirmed non-registration on2026-10-18. Recheck if seller status changes before activation. Refund exceptions/courts were
already decided; reconcile actual copy with current expiry/no-auto-renew rules.

## Pre-implementation baseline — 2026-10-18

The following bullets describe the code before this task, not outstanding defects
in the current local implementation. See current status below.

- React/Vite browser, JavaScript/JSX, Node24 Vercel router and .mjs services.
- src/lib/billing.js already lazy-loads official checkout.js and posts plan
  create-order/verify requests. PlanBilling/CreditsPage exist, checkout disabled.
- server/billingApi.mjs uses native fetch to Razorpay REST and node:crypto HMAC.
  Existing request authentication derives buyer identity from a verified token.
- Verification currently accepts authorized as well as captured payments; a
  missing payment status also falls through. This cannot become live fulfilment.
  Add explicit payment/order/amount/currency/mode binding and captured-only checks.
- Verification recomputes a current plan quote and uses client-supplied orderId;
  there is no durable local purchase snapshot. Price/version changes, recovery
  and browser-independent processing therefore need an order ledger.
- Plan grant and invoice are separate RPCs; existing per-payment deduplication
  helps but is not a complete atomic purchase/credit/invoice transaction.
- No payment webhook route or durable event inbox. No customer top-up checkout.
  Admin top-up adjustment is not a payment-fulfilment API and must stay separate.
- grant_paid_plan renews with base + interval1 month; it does not implement the
  recorded anchored-renewal/queued-downgrade requirements. HTTP blocks lower
  active plans today. Plan lifecycle is an explicit separate implementation slice.
- Existing previews share production NTER: changing keys to Test Mode alone
  would not isolate grants/invoices. The pre-launch amendment below replaces
  the original separate-hosted-database requirement with a controlled option.

## Current implementation and acceptance status — 2026-10-18

The local branch implements the five private billing tables, durable purchases,
captured-only atomic benefit/invoice fulfilment, signature-validated webhook
inbox, bounded recovery, paid periods, reviewed adjustments and account UI.
The baseline defects above were addressed locally; the older grant_paid_plan
function remains for legacy compatibility rather than serving the new purchase path.
Research-chat now uses the new canonical billing profile RPC and must be released
only after the billing migration. Corpus functions remain excluded.

[Execution evidence](../research/2026-10-18-razorpay-local-evidence.md) separates
executed checks from claims. External provider acceptance and release are pending;
the earlier paging timeout passed unchanged in the latest isolated and full runs.
Its root cause is not established; do not claim a sorting fix was applied. No credential provisioning,
webhook registration, provider order, production billing migration or release
occurred. Test counts do not prove every acceptance scenario individually.

### Pre-launch environment amendment — owner clarification 2026-10-18

Owner confirms there are no customer/paid users and launch is planned within two
days. Treat existing owner/admin/test accounts and all stored datasets as retained
application state, not as an empty database. This is owner-provided customer
context, not a new production account recount. No second hosted Supabase project
is available or required as an unconditional prerequisite.

Recommended route: destructive/negative/concurrency fixtures remain on disposable
local databases; a bounded pre-launch Razorpay Test-mode rehearsal may then use
existing hosted NTER, with dedicated synthetic accounts and a restricted Test
preview. This supersedes the earlier blanket requirement for a second hosted DB.
A shared database is not data isolation: test purchases mint real wallet lots,
plan grants and invoice rows in that database. Before such a rehearsal, enforce a
server-side test-buyer allowlist, keep public checkout closed, and preserve mode
and account provenance. The current local branch now enforces this on new Test orders using
server-only BILLING_TEST_BUYER_IDS (comma/whitespace-separated account UUIDs).
Empty/malformed lists fail closed before any order write/provider call. Buyer
identity comes from verified authentication, never request-body IDs or email.
Live mode ignores this Test-only list. Owned verification and recovery remain
available for existing orders after a buyer is removed or checkout is closed.
The public configuration exposes no allowlist or secret. This has not been
deployed or configured on NTER. Keep Test and Live credentials/endpoints in separate deployment
configurations, drain pending Test events before retirement, and retain test
financial records labelled by their billing order/mode. Do not delete records or
reset invoice counters to hide testing. Define any later cleanup by exact IDs.

The two currently running containers are PostgreSQL test databases, not a full
Supabase Auth/PostgREST stack. They prove SQL behavior but not the full HTTP/Auth
integration. A complete local Supabase stack is an alternative if hosted writes
are deferred; it would need setup and a separately approved public webhook
receiver. Never expose the database/Auth stack publicly just to receive webhooks.

This amendment selects a practical proposed environment route; this documentation
update does not execute migrations, deployments, credential changes or payments.
T15 and the existing production-action boundaries remain unless explicitly amended.

## Architecture recommendation

Keep React/JSX and existing Node ESM. Use official Razorpay Web Standard Checkout
in the browser and retain a small, tested server REST adapter for Orders/Payments
APIs. The official Node SDK is an alternative wrapper, not a different architecture;
no new dependency is required for the existing native-fetch integration. No new
React checkout wrapper or TypeScript migration. SDK types/examples can inform
contracts without changing the repo language.

Supabase Postgres owns durable order state, purchase snapshots, event deduplication,
plan/top-up fulfilment, append-only credit entries and invoices. Sensitive RPCs
are service-role only; user reads are scoped by verified auth.uid(). Do not move
payment authority to the browser. The scoped research-chat dependency is included
in the release inventory; corpus Edge Functions must not be redeployed.
Razorpay MCP is an optional operator connection, never the runtime payment path.
Context7 can retrieve current documentation; its connection was exercised.
No callable Razorpay MCP tools are exposed in this session; plugin directory
search returned no match. Do not claim its installation/authentication is verified.
The official hosted endpoint is https://mcp.razorpay.com/mcp; connection must be
verified independently, using secure credential entry, before operator use.

## Purchase and recovery contract

1. Client submits product ID and a request ID, never trusted price/credits/userId.
2. Server authenticates an active buyer, selects a versioned catalogue item and
   durably records buyer, kind, amount-paise, INR, credit unit/quantity or plan,
   requested lifecycle action, expiry/period rules, mode and seller snapshot.
3. Create a provider order and persist its binding before returning checkout.
   Handle unknown create-order outcomes through reconciliation; do not blindly
   retry provider POSTs or assume generic provider idempotency support.
4. Browser opens Standard Checkout with public key ID, saved provider order and
   server amount. Secrets remain server-side. Checkout success is a pending
   confirmation, not proof that benefits can be granted.
5. Callback verification uses the order ID stored by the server for that buyer,
   validates signature and fetches provider payment/order. Require captured,
   matching IDs, exact amount, INR and correct Test/Live mode. Authorized stays
   pending, failed stays unfulfilled. No partial-payment fulfilment at launch.
6. Webhook endpoint validates signature over original raw bytes with its own
   webhook secret, before parsing/processing. Verify expected merchant/mode;
   deduplicate event IDs AND purchase/payment effects. Events can repeat or arrive
   out of order. Verified callback and webhook converge on one fulfilment path.
7. One database transaction records paid fulfilment, the plan period or top-up
   lot/ledger/debt repayment, and invoice; concurrent callback/webhook/retries
   cannot mint another benefit or invoice. Preserve credit writer lock order and
   F225 denomination barrier. A failure leaves retriable durable state, not
   silent partial success. Future plan periods mint credits only when eligible.
8. Persist/recover failed processing independently of the browser, with bounded
   reconciliation for paid/unfulfilled orders. Any new timer is a separate
   explicit release operation. A signed-in status query returns owned order
   status; UI shows pending until authoritative fulfilment is confirmed.
9. Refund/dispute events are durable audited adjustments, never ledger edits.
   Specify full/partial refund and consumed-credit consequences before shipping
   that slice. Initially no automatic cash refund initiation: operator-authorized
   refunds only, with event reconciliation and recorded status. Never repay
   twice or mint again when an older captured event arrives after a refund.

## Acceptance and boundaries

Test free-account top-up without plan escalation; every paid plan/top-up pack;
authorised-only/missing status; bad signature; wrong buyer/order/amount/currency/
mode; duplicate and simultaneous callback/webhook; out-of-order delivery;
browser-close-after-pay; provider timeout; DB failure; expired order; current
catalogue changed after order; paid renewal/upgrade/downgrade/date boundaries;
F225 current/legacy reports and debt conservation; invoice retries and refunds.

Destructive/negative SQL tests use disposable local data only. External acceptance
uses dedicated test buyers under the pre-launch environment amendment. All SQL migrations need fixtures, denied
anon/authenticated write tests, vacuity and rollback/reapply evidence. Full
npm/Deno/SQL/lint/build/bundle/router gates, desktop/mobile checkout fixture,
then separately authorized Razorpay Test Mode acceptance on the restricted Test
preview against the chosen environment, including shared NTER if prepared as above.
Production remains closed through M1/M2 T15 closure, reviewed implementation,
merchant/legal readiness and explicit owner release approval. A generated key
alone is insufficient for activation. Never put secret keys in chat, git, VITE_
variables, browser storage or logs. No credential rotation or key export.

Excluded: corpus ingestion, AI/model changes, organisation billing, recurring
mandates, subscription auto-renewal, unrelated feed/timer changes and real-money
transactions during planning. Existing hourly closure monitor stays active.

## Inputs pending before external testing/live activation

- Owner confirms the generated key is Live mode. Obtain/provision a separate
  Test-mode pair securely for isolated acceptance; no key values requested/read.
- Merchant/live website approval and available payment methods/capture setting.
- Seller name/address supplied in the approved amendment; owner confirmed no GST
  registration. Policy review status remains unconfirmed.
- Restricted Test preview, dedicated buyers, server-side buyer restriction,
  Test/Live separation and approved secure key provisioning. A second hosted
  Supabase project is optional under the pre-launch amendment.
- Separate approval for test-provider writes, webhook registration, migrations,
  live keys, checkout opening and a bounded owner-operated real-money acceptance.

## Sources checked 2026-10-18

- [Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/)
- [Node server integration](https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/)
- [Webhook signatures, duplicates and ordering](https://razorpay.com/docs/webhooks/validate-test/)
- [Official SDK verification helpers](https://github.com/razorpay/razorpay-node/blob/master/documents/paymentVerfication.md)
- [Official remote MCP setup](https://github.com/razorpay/razorpay-mcp-server#remote-mcp-server-recommended)

The official Node SDK documentation was also retrieved through Context7. Snapshot
claims in old specs are historical context; current code and later owner decisions
control this draft. No claim that documentation lookup verifies merchant access.

## Proposed schema contract — expanded 2026-10-18

This is a design proposal grounded in checked-in migrations, not applied DDL or
proof of live schema parity. Proposed launch scope: **five new private tables**,
plus additive nullable links on five existing public tables. No replacement
wallet, ledger, plan catalogue, invoice counter or credit denomination backfill.
Verify live definitions read-only before finalising migration SQL.

| New table | Principal fields and role | Connections and constraints |
| --- | --- | --- |
| private.billing_orders | UUID; nullable buyer user_id; durable customer reference; stable request_id/request_hash; provider/account/mode; product ID/version/kind; integer amount_paise and INR; credit quantity/unit or plan action; immutable pricing/expiry/seller snapshot; provider_order_id; separate payment/fulfilment states; fulfilled_payment_id; timestamps, recovery lease and next_attempt_at | Buyer references auth.users with SET NULL; unique customer/request identity and provider/account/mode/order ID; immutable snapshot after creation. One purchase intent, many payment attempts, at most one selected fulfilment payment. |
| private.billing_payments | UUID; order_id; provider payment ID/account/mode; exact amount/currency; validated provider status and capture time; refunded amount; observed_at | Many attempts to one billing_order; provider/account/mode/payment ID unique. Composite binding prevents selecting a payment from another order. Failed attempts are retained; a later captured attempt can complete the order. |
| private.billing_events | UUID; provider/account/mode/event ID; event type; nullable matched order/payment; minimal verified payload, raw-body hash; processing state/attempts/error code/next_attempt_at/lease | Unique provider/account/mode/event ID; bind unmatched events after reconciliation. Insert only after signature validation. Event completion and financial effects commit together; durable inbox doubles as recovery work queue, avoiding a sixth queue table. |
| private.billing_adjustments | UUID; payment_id; provider refund/dispute ID and kind; amount_paise; provider state; separate benefit-adjustment state; reason/operator audit; timestamps | Many refunds/disputes per payment; unique provider/account/mode/kind/adjustment ID. Refund totals and benefit reversals validated under payment/order locks. Disputes and refunds must not both reverse the same value. No automatic cash refund initiation. |
| private.billing_plan_periods | UUID; order_id; nullable buyer; plan; starts_at/ends_at; anchor date/timezone/day; allowance/unit snapshot; scheduled/active/superseded/cancelled state; applied_at | Plan orders have at most one purchased period at launch; no period for a top-up. Explicit future window prevents early model entitlement or monthly mint. Existing plan_grants remains grant audit, rather than being overloaded as the schedule. |

Use UUID internal IDs, integer paise for money and existing numeric credit
precision; never binary floating point for fulfilment. Scope provider identity
by merchant account and configured Test/Live environment; do not assume every
provider entity contains a mode flag. Reject cross-environment bindings.
Financial identities survive account deletion with restricted snapshots and a
retention policy; auth deletion cancels unapplied entitlement and cannot cascade
through paid purchase/invoice facts. No card details, secrets or full unfiltered
provider responses in these tables. Private schema access is explicitly revoked
from browser roles; use narrowly granted, fixed-search-path privileged routines.

### Existing table changes and unchanged relationships

| Existing table | Proposed additive change | Purpose |
| --- | --- | --- |
| public.invoices | nullable unique billing_order_id FK | One sale invoice per fulfilled purchase; keep provider/payment uniqueness, payload snapshots and existing financial-year counter. Top-up product metadata lives in payload; legacy plan_id compatibility is explicit, not a fake paid plan. |
| public.plan_grants | nullable unique billing_plan_period_id FK | Links payment-derived grant audit to an explicit period. Manual and legacy grants retain NULL and existing behaviour. |
| public.user_profiles | nullable active_billing_plan_period_id FK | Projection of the currently effective period; future periods cannot replace current paid access early. |
| public.credit_lots | nullable billing_order_id and billing_plan_period_id FKs | Top-up lot traces to its order; monthly/rollover lineage traces to the paid period. Existing source_key uniqueness remains an additional duplicate barrier. |
| public.credit_ledger | nullable billing_order_id and billing_adjustment_id FKs | Append-only trace for paid grant or compensating adjustment. Multiple entries per purchase are allowed where the existing accounting engine requires them; order transaction controls once-only fulfilment. |

These are five affected existing tables, not five replacement tables. Existing
credit_wallets, credit_lot_draws, credit_charge_rows, credit_holds,
credit_settings, credit_plan_allowances, invoice_counters, conversion lineage
and research-call records continue to serve their current roles. RPC bodies and
constraints may need focused changes without additional tables. A refund entry
must have an explicit supported ledger shape; never impersonate an administrator
to bypass the current adjustment.created_by requirement.

Versioned sellable products stay in server/paymentCatalog.mjs at launch; the
purchase stores the complete immutable versioned snapshot. This avoids a sixth
catalogue table and accidental browser/admin price mutation. Existing
credit_plan_allowances stays authoritative for native plan allowances; contract
tests reject drift between the catalogue and allowance configuration. A later
editable catalogue is a separate feature.

### Transaction, RPC and API boundaries

Proposed service-only RPC contracts (names finalised with migrations):
- billing_claim_order(user, request_id, request_hash, server_snapshot): atomically
  claims a stable request. Same payload returns existing order; different payload
  returns conflict; in-flight creation returns pending rather than a second POST.
- billing_bind_provider_order(order, verified_provider_order): persists a checked
  binding; unknown provider POST outcome remains reconciling until resolved.
- billing_fulfil_capture(order, verified_payment): accepts only trusted server
  input, checks persisted buyer/product/amount/mode bindings, records capture,
  applies top-up or records paid period, issues invoice and marks fulfilled in
  one database transaction. No generic RPC callable by customer roles.
- billing_apply_event(event): processes a signed durable inbox event through the
  same shared internal fulfilment/adjustment routines, not a second grant path.
- billing_apply_due_period(user, now): internal activation hook used by existing
  entitlement and credit refresh paths. No new production timer is assumed.
- billing_order_status(order): returns a sanitised owned view via authenticated
  server route; customer access never exposes event payloads or other buyers.

Callbacks and webhook workers verify signatures/provider facts in Node, then
call the shared database core. SQL does not call Razorpay or trust a browser's
claimed captured state. Payment evidence remains durable if grant/invoice work
fails. On retry, capture is revalidated and the atomic fulfilment is retried.
Acquire the denomination barrier before credit configuration/wallet work; define
one lock order compatible with existing profile/grant triggers, then test real
concurrent sessions for deadlocks. Do not finalise a guessed lock order from
source reading alone. No network request while holding DB financial locks.

Preserve existing /api/billing/create-order and /verify compatibility with
additive purchase identifiers. Add owned order-status and signed webhook routes;
use a single structured error contract. No-store on authenticated billing and
status responses. Bound request bodies, purchase creation rate and polling;
request IDs survive retries, while a fresh purchase uses a new explicit intent.
Unknown results show pending, not a failed payment followed by blind recreation.

### Lifecycle and adjustment design risks

credit_due_cycles currently infers payment windows from ordered plan_grants,
and credits_on_plan_grant invokes refresh after insertion. Explicit new payment
periods must replace inference only for linked new grants; unlinked manual and
legacy grants retain their current path/source keys. Adapt entitlement reads
and credit refresh together so the queued lower plan starts exactly at its
window without early credit mint or double cycles. Preserve existing ten-percent
rollover and top-up expiry rules. Concurrent renewal/upgrade intents must be
serialised and revalidated; a stale captured quote requiring incompatible plan
terms enters an operator-visible exception, never silently reinterprets purchase.

Persist capture, refund and dispute facts separately from applied benefits.
Payment failure on one attempt cannot cancel another captured payment. A second
captured payment for a fulfilled order enters overpayment reconciliation; it
cannot mint a second grant or disappear. Stale capture events cannot resurrect
refunded/superseded benefits. Duplicate event identity with a different body hash
is an integrity incident. Refund/dispute payload arriving before capture must be
recoverable by fetching authoritative provider state.

Before enabling live adjustment processing, specify proportional credit reversal
rounding, already-spent credits/debt, paid-plan revocation timing and dispute-won
restoration. Existing exception-based cash refund policy remains; these are
technical/accounting consequences, not a new commercial refund promise. Until
resolved, retain facts and flag pending operator action rather than applying a
speculative reversal. An original sale invoice is not edited after refund;
credit-note requirements and seller retention are launch-readiness decisions,
not an assumed replacement for proper accounting advice.

### Migration and historical records

Create additive migrations using the Supabase CLI, then guarded RPC/constraint
changes, then compatible server code, then UI. Keep checkout closed. Old rows
remain NULL-linked and unchanged; do not fabricate historical Razorpay orders or
rerun the one-paisa conversion. If actual prior provider purchases are discovered,
make a separately inventoried import/reconciliation decision. Index foreign keys,
use explicit grants/RLS for any exposed objects, and test migration application
as a non-superuser. Down/reapply tests operate on disposable fixtures only;
production rollback disables new orders and preserves paid facts/recovery.

A webhook returns success only after its validated event is durably committed;
transient inbox storage failure returns a retriable response. Durable receipt is
not customer-visible fulfilment. Recovery must have an explicitly assigned,
bounded runner and backlog alerts before activation; a new scheduled job needs
separate production approval. Existing feed-refresh cron is not repurposed.
Do not rely indefinitely on provider retries or an open browser. Expired local
checkout intent is not permission to discard a real captured payment.

## Owner-approved implementation amendment

Local implementation and Docker tests may begin before T15 (owner explicitly
confirmed). Production gates remain. Seller: Niyantran Consulting Pvt. Ltd.;
48, Vivekananda Park, Haridevpur, Kolkata, West Bengal, India – 700082.
Not GST-registered; retain niyantranai@gmail.com. Refund/dispute facts are
automatic; benefit changes require reviewed operator action with audit/retry IDs.

Implementation RPC boundary: service-only public.billing_order(p_action text,
p jsonb), billing_capture(p_order_id uuid,p_payment jsonb), billing_event(p_action
text,p jsonb), billing_review_adjustment(p jsonb). Customer identity is derived
from verified bearer and passed only by the server. Snapshot uses productId,
kind, planId/credits, amountPaise, currency, creditUnit, label and seller. HTTP
requests add productId and stable requestId while retaining planId compatibility.
No customer can call the financial RPCs directly.


### Test Preview setup verification — 2026-10-18

Owner retained the Vercel payment backend and approved a closed Preview refresh.
Both API credential names now have Sensitive, Preview-only task/razorpay-plan
metadata; values/mode/pair validity remain unread/unverified. Same-commit24d51d4
Preview dpl_2D72ZQmN9hmLytECecJNYH97HXPm is READY; closed config, app shell,
Plus quote and unauthenticated-order rejection verified. Webhook fails closed503
and public access redirects to Vercel authentication302. Merchant ID, separate
webhook secret, test-buyer allowlist, approved ingress and hosted migration are
still outstanding; no actual provider acceptance or Production change. See
[execution evidence](../research/2026-10-18-razorpay-local-evidence.md#closed-test-preview-credential-refresh--2026-10-18).


### Hosted transport blocker — 2026-10-19

Branch-only merchant/webhook/buyer configuration now exists and same-source
Preview dpl_HRHCghckTkLp5Jzqcp8uDvhunGzC is READY with Checkout closed. The
hosted JSON webhook probe now reaches400 raw-body refusal. An equivalent lazy
request.body getter reproduces this locally; current plain-stream transport tests
do not exercise the Vercel helper. Acceptance requires a causal getter test and
original-byte preservation without HMAC reserialization or weakened validation.
No source fix/push yet. Public ingress, exact55 event review, shared DB migration
and actual Test acceptance remain pending. Production/Live/corpus unchanged.


### Approved raw-body fix scope — 2026-10-19

Owner approves local-only webhook transport correction. Read original bytes from
the host-restored request stream without triggering a lazy body parser. Preserve
Buffer/string body support, size bounds, fail-closed parsed-only refusal and
original-byte HMAC verification. Acceptance: first demonstrate lazy-getter failure
in the real router fixture; then prove exact whitespace/Unicode bytes succeed,
reserialized/bad signatures fail before persistence, and oversized inputs remain
rejected. Source scope server/paymentService.mjs plus focused tests. No global
parser/router configuration, schema, checkout flag, provider or deployment changes.


### Raw-body implementation outcome — 2026-10-19

Local reader now avoids lazy body parsing and consumes restored data/end events;
original-byte HMAC, raw Buffer/string support, size limits and fail-closed parsed
objects remain. Both lazy-getter and consumed/restored failures were demonstrated
before passing; real localhost HTTP validates exact bytes and HMAC with no getter
access. Focused80 and Deno1,155 tests plus lint/build/bundle/router checks pass.
See execution evidence for final full-suite result and interim red checkpoints.
Not pushed/deployed; actual Test webhook delivery is pending. Checkout/Production/
Live/corpus unchanged by this local correction.

Final local full-suite verification:403 application files/6,333 tests and1,155
Deno tests pass; focused80, lint/build/bundle/router/diff checks pass. Hosted
verification and all remote changes remain explicitly excluded from this task.


### Current raw-body publication status — 2026-10-19

Supersedes the earlier local-only outcome: owner approved Test publication and
18db302 is now on origin/task/razorpay-plan. Exact-commit Preview
dpl_HtZeAsvc2oVEpSPj7Po9u77n6inf is READY; deployed JSON reaches HMAC rejection400
rather than raw-body failure, malformed JSON does not invoke host parsing, size
limit413 and unauthenticated order401 remain. Checkout closed. CI39160473575
app+SQL jobs green attempt1. Production/main/protection unchanged; no database,
Live/provider/corpus operation. Public delivery302 and signed provider acceptance
remain outstanding. Latest deployment evidence notes remain local.


### Current hosted foundation status — 2026-10-19

Owner-authorized shared NTER migration applied successfully as hosted version
20261018200238/billing_purchases (reviewed local20261018160700 migration). Five
private RLS tables and service-only RPCs verified; original profile/financial
fingerprints, balances and record counts preserved. New billing tables empty.
Test Checkout closed. Actual provider acceptance blocked on Test-alias ingress: a
short-lived share link redirects through cookies and was revoked; automatic
approval review rejected the non-expiring alias exception without explicit scope
approval. No exception applied. Owner will handle browser Test steps once ready.
Production web/main/Live/Edge/corpus unchanged; shared schema was upgraded.


## Test order creation diagnostic gap — 2026-10-19 (local scope)

Owner Test Plus attempts persisted as reconciling with no provider order binding;
owner reports Razorpay Test Orders empty. Payments/events/invoices remain zero.
The provider adapter discards HTTP status and createPurchase catches provider and
binding errors together without diagnostics. This prevents determining the cause.
Add server-only bounded stage/category/HTTP-status diagnostics without provider
bodies, error messages, credentials, headers or buyer data. Preserve pending
responses, no automatic POST retry, stable IDs and existing accounting guards.
Acceptance: causal tests prove safe authentication/rate-limit/provider/transport
classification and distinguish bind failure; hostile error text cannot reach logs
or client. Local verification only; publication needs owner approval. No claim
that keys are invalid or that the underlying provider issue is fixed.


## Rejected creation recovery — 2026-10-19

Status: Living. Existing stable per-product intents preserve uncertain results but
strand HTTP401 rejections. Add service-only durable rejection metadata and atomic
retry claim on the same purchase ID. Only explicit authentication HTTP401/403
received during provider creation is automatically classified retryable. Timeout,
transport, parse,5xx and binding failures stay uncertain; no blind repeat POST.
Retry uses original immutable amount/snapshot; one claimant gets a fenced lease,
others reuse the existing result. An ambiguous retry consumes retry permission.
Keep signature/capture/invoice deduplication and records. Cap retries per purchase.

Old unclassified intents require explicit operator review, never inferred rejection
from age or an empty receipt lookup. Provide service-only Test-only review RPC
requiring active admin, reason and confirmation that provider absence was checked;
reject bound/paid/leased/recent/foreign requests. Record operator decision with
reason/time/actor. This operator confirmation is a trusted manual evidence boundary,
not machine proof of provider absence; use only after reviewing exact Test receipts.

No new tables: additive columns on private.billing_orders and one service-only
RPC. Main code/Live keys remain unchanged. Shared hosted Supabase migration and
old-intent review are separate concrete approval gates; perform neither silently.
Verification: causal application/SQL fixtures, genuine two-session retry contention,
wrong owner/mode/account/admin refusal, original snapshot, timeout after retry,
no public execute, unchanged capture deduplication. Focused/full Vitest, Deno,
SQL/vacuity/concurrency, lint/build/bundle/router; Test-only publication authorized.
