# Razorpay local implementation evidence — 2026-10-18

> **Status: Living.** Local implementation only; external acceptance and release pending.

## Authority and isolation

Owner explicitly approved local implementation and Docker tests before M1/M2
closure. Branch `task/razorpay-plan`, baseline `3ccdf8a`; pre-existing documentation
changes preserved. No push, deployment, key read/provisioning, provider mutation,
webhook registration, real payment, production migration or data write occurred.
Corpus ingestion was not invoked or modified. Docker fixtures use synthetic users
in freshly created disposable databases on the two existing local test containers.
The npm/build commands blocked dotenv reads with an untracked temporary preload.

## Delivered locally

Migration `20261018160700_billing_purchases.sql` adds five private tables and
nullable audit links. Service-only RPCs claim orders, bind provider facts, fulfil
captured payments atomically, process leased events/recovery and record reviewed
adjustments. RLS and explicit privilege revocation prevent customer financial
writes. Historical rows and credit conversion lineage remain unchanged.

The existing create/verify HTTP routes retain their contract, with durable owned
purchase IDs and stable request IDs. New routes support owned history/status,
raw-byte signed webhooks and authenticated operator recovery/review. Unknown
provider POST outcomes remain reconciling rather than repeating a cash order.
Checkout is closed by default. Five approved packs and monthly plans use server
catalogue snapshots; Free top-ups preserve existing model eligibility.

Paid periods retain calendar anchors, queue downgrades and prevent early minting.
Profile activation occurs before credit reservation, never inside wallet-first
refresh. Legacy manual grants keep precedence, without resurrecting superseded
allowances. Future lots and ledger entries retain purchase provenance. Refunds,
disputes and duplicate captures produce review facts; reviewed removal/restoration
is bounded, audited and idempotent. Original invoices remain unchanged.

React purchase/history and operator review controls are implemented. Future seller
snapshots/policies use the supplied company name/address and existing support
email. Research-chat now consumes the canonical billing profile RPC. Release must
apply the migration before deploying this Edge function or compatible application.

## Executed verification

- Full SQL runner: all **45 fixtures passed**, including missing-migration vacuity
  checks. Final focused `npm run test:sql -- billing_purchases` passed again after
  review fixes, including queued profile activation, invoice failure rollback,
  scheduled provenance, manual precedence, account deletion and denied writes.
- Two independent SQL sessions concurrently fulfil the same captured payment:
  exactly one invoice and one purchased lot; expected wallet reconciles.
- Causal red/green: removing captured-only validation makes the authorized-payment
  test fail; restoring it returns the focused payment-service suite to green.
- Full Deno command `deno test -A --config supabase/functions/deno.json
  supabase/functions`: **1,155 passed**, including the updated chat RPC boundary.
- Actual API router stream tests validate original webhook bytes, altered-signature
  rejection and refusal of already parsed JSON. Provider calls are mocked.
- Isolated headless Chrome with a fresh temporary profile mounts the actual purchase
  and review components. All five packs render, mocked Checkout confirms, purchase
  history/recovery updates, desktop/mobile widths have no horizontal overflow and
  no uncaught exceptions occur. Screenshots are temporary local artifacts.
  This is browser fixture evidence, not external Razorpay payment acceptance.

Final full `npm test`: **402 files / 6,309 tests passed; one unchanged
`featurePage.test.js` bill-name sort case hit its existing 5,000 ms timeout**.
An earlier full run passed all 6,307 tests before the three new router tests.
The unchanged isolated rerun also hit that same timeout: **45 passed / one timed out**. That checkpoint was not a green full suite; the later preparation follow-up below
records the subsequent unchanged paging and full-suite passes.
No timeout threshold or unrelated test was altered.

Final `npm run lint`, `npm run build`, `npm run check:bundle` and guarded router
import all passed. No chunk-size or Node deprecation warning appeared in the
build. Entry gzip 120,687 bytes, within the 182,446-byte budget; initial JavaScript
180,772 bytes across two assets. `git diff --check` passed and a changed-file
private-key/live-key pattern scan found no match. No standalone typecheck exists.
All work remains uncommitted locally on `task/razorpay-plan`; nothing was pushed.
Temporary Vite/browser fixture processes were stopped.

## Independent review and read-only foundation evidence

A separate read-only reviewer checked financial boundaries, concurrency, plan
precedence, privileges and adjustment accounting. Findings were fixed and reviewed
again; no remaining P1 blocker reported. Local bootstrap and deployed definitions
matched for issue_invoice, grant_paid_plan, private.credit_config and
private.credit_wallet (definition hashes compared read-only). Production had zero
invoices/payment-source grants and no new billing tables; no historical paid
payment backfill is needed or fabricated.

## Remaining launch gates

O6 remains open. The owner's subsequent pre-launch environment amendment removes
the unconditional second-hosted-Supabase requirement: use local SQL fixtures plus
a restricted Test preview on existing NTER with dedicated allowlisted test buyers,
or optionally prepare a full local Supabase stack. Separate securely provisioned
Test credentials, actual Test-mode callback/webhook/recovery acceptance, proof of
Vercel raw-body transport, merchant approval/capture readiness and policy review.
Assign a recovery runner before launch; no production schedule has been installed
or approved. Recheck unavailable Supabase changelog documentation before release.
Razorpay MCP remains unverified/not callable; runtime integration does not depend
on MCP. Context7 documentation access was available during planning.

M1/M2 T15 remains open. Production publication/migrations/provider configuration,
Live credentials, opening Checkout and a bounded owner-operated live purchase all
require closure and separate approval. Docker success does not replace these gates.


## Verification limitation

`npm test -- src/lib/featurePage.test.js` repeated the unchanged bill-name sort
5-second timeout (45 other cases passed). The billing implementation does not
modify that test, its paging implementation or its input data. Earlier task
records also mention a paging timeout; this execution does not establish root
cause. Do not raise the threshold or claim a fully green final suite. Track
investigation under O6's release verification before publication.


## Final SQL rerun

After the final profile-activation change, `npm run test:sql` completed again:
**all 45 fixtures passed**, including vacuity checks and the two-session billing
race. Both final focused and full SQL runs exited zero. At that checkpoint the unchanged bill-sort Vitest timeout remained an exception.
The later preparation follow-up records its successful unchanged reruns.


## Documentation reconciliation and environment clarification — 2026-10-18

Owner confirms no customer/paid users and intends launch within two days; no
second hosted Supabase database is available. This is owner-provided context,
not a fresh production account census. Existing datasets, owner test sessions,
credit conversion lineage and financial counters remain retained state.

Read-only Docker `ps` verified only the two PostgreSQL fixture containers running
with no published ports. No full local Supabase Auth/PostgREST stack is running.
No credentials or dotenv files were read. The existing Docker SQL evidence is
unchanged; no new runtime suite was needed for this documentation-only task.

Spec now labels its old defect list as the pre-implementation baseline and links
current local evidence; plan labels initial planning evidence and records current
checkpoints. The remaining execution route recommends existing NTER for bounded
pre-launch Test acceptance after dedicated buyer restrictions and the applicable
approvals/gates. Test mode isolates provider money, not wallet/invoice database
rows. At that documentation-only checkpoint the server-side test-buyer restriction
was required work, not delivered. The implementation follow-up below supersedes
that status.

No migration, deployment, provider configuration, key provisioning, payment or
container state changed. T15 and publication boundaries remain. `git diff --check`
and relative document-link checks verify this edit; the prior Vitest timeout was still
unresolved at that checkpoint. Work remains uncommitted on task/razorpay-plan.


## Local pre-launch preparation follow-up — 2026-10-18

Implemented server-only BILLING_TEST_BUYER_IDS for new Test orders. It parses
comma/whitespace-separated UUIDs and fails closed for absent, empty or malformed
lists. Verified bearer identity is checked before the first order RPC/provider
call; browser userId/email cannot authorize a buyer. Public configuration does
not return the list or secrets, and advertises checkout disabled without a valid
Test list. Live buying rules are unaffected. Existing owned verification,
webhooks and recovery continue after list removal or closed Checkout.

Causal tests: before implementation the focused run failed eight new cases;
after implementation the focused payment/API/router/client suite passed75 tests.
An independent reviewer found no bypass/blocker. Added explicit wrong-merchant
signed-webhook rejection, provider-verification timeout and browser-independent
capture recovery while Checkout is closed. All provider calls remain mocked.

Paging diagnosis: the previously failing file passed46 tests unchanged in an
isolated run; bill-name sort769ms, file3.84s overall. The full suite then passed
**403 files /6,324 tests** in101.44s. No paging source/test timeout was changed;
root cause of the earlier five-second failures is not established. A synthetic
collator benchmark is not sufficient evidence of that root cause; no unrelated
sorting optimization was shipped.

Fresh Deno full suite:1,155 passed. Lint, production build, bundle check and router
import passed. No chunk-size or Node deprecation advisory in build. A subsequent
focused rerun passed75 tests after correcting parameterized list-fixture wrapping.
The full run and focused run agree; no runtime source changed afterward.

Acceptance mapping distinguishes executable evidence from hosted acceptance:

| Scenario | Direct local evidence | Remaining acceptance |
| --- | --- | --- |
| Test buyer restriction, malformed config, identity spoofing, Live unaffected | paymentService.test.js and billingApi.test.js; causal red/green | Configure dedicated hosted accounts and verify deployed access |
| Merchant mismatch, signature/raw bytes, provider timeout | paymentService.test.js; billingWebhookRouter.test.js | Real Razorpay/Vercel delivery and credential/mode behavior |
| Browser-independent capture recovery with new checkout closed | paymentService.test.js mocked recovery path | Actual captured payment followed by closed-browser recovery |
| Catalogue all five packs, one-paisa unit and Pro price | paymentService.test.js | Each approved pack/plan via real Test-mode Checkout |
| Invoice rollback and concurrent same-capture | billing_purchases.sql plus billing_concurrency.sh | Hosted callback/webhook contention and failures |
| Request replay/hash conflict and merchant/mode-scoped lookup | Expanded billing_purchases.sql | Hosted purchase/API repetition |
| Failed attempt then capture; second captured overpayment | Expanded billing_purchases.sql checks status, lot, wallet and invoice counts | Actual provider attempts and callback/webhook race |
| Refund before stale capture, before/after reviewed full refund | Expanded billing_purchases.sql; stale payload has zero refunded amount | Real out-of-order refund/dispute delivery |
| Top-up repays exhausted-lot debt; paid top-up preserves Pro period | Expanded billing_purchases.sql | Hosted balance/invoice reconciliation |
| Plan anchor, queued lower period, no early mint, manual precedence | billing_purchases.sql | Full real purchase lifecycle; renewal/upgrade/rollover at boundaries |

Remaining: scenario-specific coverage is not inferred from aggregate suite counts.
Hosted Vercel parser behavior, PostgREST privileges, actual provider capture,
webhook retry/order, and Test-to-Live reconciliation still need the restricted
rehearsal. Dedicated IDs/keys have not been configured; no user, migration,
provider order, webhook, deployment or production timer was created here.


The added SQL cases passed the focused disposable fixture plus same-capture
concurrency and migration-absence vacuity. A supervisor rerun of the full SQL
suite includes the final stale-capture payload with amount_refunded=0. No new
SQL implementation defect was found. Individual new SQL guards were not each
mutation-tested; the migration-removal check is not presented as proof of each
individual branch. Provider/webhook runtime remains unexercised externally.


Final preparation SQL verification: supervisor `npm run test:sql` completed with
**all45 fixtures passed**, including the expanded billing fixture, two-session
capture race and missing-migration vacuity. The stale-capture test used a zero
refunded amount in the late payload, proving persisted refund facts are retained.
`git diff --check`, relative document links and a changed-source private/live-key
pattern scan passed. This follow-up changed paymentService/billingApi and their
focused tests, the billing SQL fixture, and existing billing spec/plan/evidence/O6
records only. No new migration or production mutation was needed. Hosted
rehearsal still requires secure Test credentials, dedicated buyer IDs, reachable
webhook ingress, applicable M1/M2 gate and the separately approved execution scope.


## Test-branch publication checkpoint — 2026-10-18

Owner approved the recommended branch-only publication before T15. Implementation
and tests committed as6a749b6 on task/razorpay-plan after independent review and
local verification. This commits the migration/Edge source for review but does
not apply a database migration or deploy an Edge Function. Main remains3ccdf8a.
Billing spec/plan/tracker and evidence are committed separately. Pre-existing
M1/M2 observation edits remain unstaged and are not included in this publication.
The next operation is an exact branch push and automatic Preview build, followed
by branch-scoped closed-checkout configuration/readback. No keys are provisioned
or exposed by that step. Test credentials still require secure owner entry.


## Closed Preview verification — 2026-10-18

Code6a749b6 and docs24d51d4 published only to task/razorpay-plan under the narrow
owner amendment. Both CI jobs passed attempt1:
https://github.com/ddllabs/niyantran/actions/runs/39151639554 . Vercel Preview
 dpl_GxGydDNFEv1By8T6x5WjpM1eboJX READY at
https://niyantran-8jirv2za2-ddl-labs.vercel.app . GitHub main/Production stay3ccdf8a.

Exact-scope CLI metadata verified BILLING_CHECKOUT_OPEN=0 is Preview-only and
branch-specific, with no Razorpay keys present at that readback. Authenticated
Preview configuration GET returned enabled=false, checkoutOpen=false,
publicKeyPresent=false, packCount5 and INR. No financial RPC/provider call was
made. No Supabase migration/Edge function was deployed. No Live key was touched.
Other CI annotation: GitHub announces an upcoming ubuntu-latest runner-image
migration; no warning fix or workflow change was made for that announcement.

Test key values have not been supplied/read by the agent; secure owner entry is
still needed. Razorpay credentials belong on Vercel because paymentService.mjs
executes provider requests and signature verification there. Supabase Postgres
executes the atomic accounting RPCs and does not need those merchant secrets.
Latest verification documentation remains local; published head stays24d51d4.
M1/M2 observation edits remain separate/unstaged; no further push or CI rerun.


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


## Owner Plus pilot blocked / local diagnostics — 2026-10-19

Owner clicked Plus rather than initial top-up. Read-only NTER shows two Test
plan-plus intents (39900paise):068c065d-2751-471f-9eff-902e69f48170 at20:24:16UTC
and5af59ea0-3575-4d79-be5a-b89457853c6a at20:26:33UTC onOctober18. Both reconciling,
provider_order_idNULL, attempts1. Payments/events/invoices all0. Test Vercel request
logs confirm two create-order202responses; runtime logs returned0records. Owner
reports Razorpay Test Orders blank. No provider-order existence or charge is
assumed from this response; no new order/recovery/refund was triggered by agent.
Pause manual purchases. Provider creation/transport is suspected, not proven;
empty dashboard alone cannot distinguish authentication, request or connectivity.

Local diagnostic fix: provider adapter retains only bounded internal HTTP status
and fixed failure category; purchase catch logs only stage/category/status. No
provider bodies, raw error messages, headers, config, buyer or keys are logged.
Client pending behavior and POST no-retry policy unchanged. No DB schema change.
Eight new tests failed against old code (8failed/35passed); after implementation
focused3files/88tests pass. Lint, build, bundle check and router import pass;
Deno1155pass. Full application result recorded after completion. Existing unrelated
M1/M2 documentation changes preserved; nothing committed/pushed/deployed in this
local diagnostic step. Requires scoped Test publication approval to observe actual
hosted cause. Production/Live keys, alias exception and checkout configuration
unchanged during this diagnosis. Exception must still be revoked after rehearsal.

Final local verification: npm test403files/6341tests pass171.39s; deno test -A
--config supabase/functions/deno.json supabase/functions1155pass; npm run lint,
npm run build, npm run check:bundle and router import pass. No bundle advisory or
lint warning. SQL not rerun: no SQL changes. Hosted failure remains unresolved
until diagnostics are published and an approved controlled request is observed.

Owner approved push/deploy of diagnostics only to Test Preview2026-10-19;
Production, Live keys and corpus remain unchanged. No repeat pending Plus POST.
