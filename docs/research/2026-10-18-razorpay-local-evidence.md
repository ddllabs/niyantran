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
