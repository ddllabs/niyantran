# Free desk access

> **Status: Living.** Owner-approved specification, 2026-10-12.
> Approved capability: free-desk-access, including copy/export. Implementation authorized on task/terminal-follow-up.

## Objective and current state

Every authorized signed-in account can use every desk and module without a
paid-plan interruption. Sign-in and AI usage controls remain in place.

planEntitlements.js currently grants free accounts five persona-selected desks,
trial/paid accounts all desks, caps trial/free feed rows at 25/40 and denies
trial/free copy and export. TerminalShell uses those helpers for routes,
restricted rendering, search scope, clipboard/export guards, upgrade prompts
and shell feed caps. Its onFeed cap does not cap DeskView's separately held
prepared feed, so validation must cover table, side panel and export paths.
DeskDirectory displays locked desk badges. SignupPage presents a plan step
and can send plan metadata that starts a server trial. Existing billing and
server entitlement records have independent account/history responsibilities.

These are source inspection findings. No new account, payment or live AI
request was executed for this planning task.

## Contract

- For an authenticated, authorized account, all known desks and all 120
  modules are available irrespective of persona, free/trial/paid status,
  expired trial, or an entitlement request still loading/failing.
- Do not implement this by spoofing a paid entitlement. Keep identity and
  subscription facts accurate; make desk capabilities independent of price.
  Reject unknown desk identities and retain the existing authentication and
  account authorization boundaries outside these commercial capability helpers.
- No Upgrade badge, locked desk route, navigation-triggered trial modal,
  terminal View plans/Upgrade action or payment-gated copy/export remains.
  Catalogue search and directory include all desks. Deep links, browser
  back/forward, cross-desk links and State context all behave consistently.
- Remove commercial row caps on shell feeds, preserving all available rows
  and existing source notes. Keep normal pagination, source limits, safety
  restrictions and backend query bounds; “uncapped” means no plan-based slice,
  not an unlimited data fetch or invented coverage.
- Allow ordinary record copying and existing export workflows for every
  authorized signed-in account. Preserve editable text copy and real export
  failure handling. No new export formats or clipboard success claims without
  executing a real supported clipboard path.
- Signup proceeds from account/persona creation to email verification when
  required, or directly into the terminal when a session exists. Remove the
  plan-choice step and trial-start calls from this flow. Legacy signup plan
  URLs must still reach signup, but must not start a trial; new signup metadata
  uses the free plan. Google signup/login and existing sessions still work.
- Leave research-chat/model quotas, rate limiting, credits, account activity
  enforcement, admin authorization, RLS, stored entitlements, subscriptions,
  invoices and payment APIs unchanged. No cancellation, refund, migration or
  trial expiry mutation. An access change is not a subscription migration.

## Structure, conventions and boundary audit

Primary code: src/lib/planEntitlements.js; src/shell/TerminalShell.jsx;
src/shell/DeskDirectory.jsx; src/marketing/SignupPage.jsx;
src/lib/signupFlow.js. Tests remain colocated using Vitest describe/it/expect.
Keep capability helpers pure and central, with explicit known-desk validation:

```js
// Illustrative contract; authentication is enforced by the app boundary.
const knownDesk = TABS.some(tab => tab.id === deskId);
```

Before edits, inventory every helper consumer, upgrade/trial entry, signup
plan route and downstream export interceptor. Amend the plan if actual
requirements need another path. Do not remove entitlementStore or billing.js
just because the terminal no longer needs their commercial guards. Marketing
pricing pages and admin billing configuration require a separate scope if the
owner wants a wider commercial repositioning; record any misleading entry
points found rather than silently redesigning marketing.

## Acceptance and verification

1. Cover free, trial, paid, expired and unavailable-entitlement fixtures with
   each persona: all known desk capabilities succeed and unknown routes are
   rejected/normalized safely. All eight landing and 120 module identities
   resolve without upgrade interruptions. Record-search scope is complete.
2. A fixture larger than 40 records retains every row in table, shell feed and
   export; no plan-cap metadata or upgrade note is newly introduced.
3. A free account can copy a record and export it; success/failure states are
   accurate. No navigation route or editable-copy path opens an upgrade modal.
4. Signup with/without a session reaches enter/verify respectively, even from
   legacy paid-plan URLs. No trial or checkout call fires from normal signup.
5. Signed-out, disabled-account and admin denial behavior still passes its
   existing authorization tests. AI quotas and billing storage/API contracts
   are unchanged. Never use production users/data as a test fixture.
6. All F95 direct-card and AI dismissal/draft checks remain valid.

Focused checks: `npm test -- src/lib/planEntitlements.server.test.js
src/lib/signupFlow.test.js src/marketing/loginAuthorization.test.js
src/lib/localUserAuthorization.test.js src/shell/TerminalShell.test.jsx
src/shell/DeskDirectory.test.jsx`. Add a focused SignupPage test for the new
flow. Rewrite obsolete commercial-denial assertions to the approved contract,
while preserving security assertions; do not delete tests merely to get green.
Prove new free-access/copy/export/signup guards fail with the old policy before
relying on them. Run full `npm test`, Deno tests, lint and production build
because src/lib changes require both suites. Use isolated browser fixtures for
session/entitlement/signup and retain real landing/workspace components.

## Exclusions and pending review

Corpus files and data collections, backend AI changes, public anonymous desk
access, realtime feeds, payment history deletion, production writes, push and
deployment are excluded. This spec supersedes earlier desk-commercial rules
only after approval; implementation must reconcile affected normative docs
without rewriting unrelated historical decisions or corpus tracker entries.
