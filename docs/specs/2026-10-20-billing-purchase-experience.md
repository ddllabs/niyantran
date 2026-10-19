# Billing purchase experience

> **Status: Normative.** Owner approved local implementation on 2026-10-20.

Current UI opens top-up Checkout immediately, presents unconfirmed checkout attempts as recent
purchases, and expands operator controls in the account page. Current-plan text
exists but selected/active cards are insufficiently distinct. Existing financial
records must remain intact.

Outcome: selecting a pack reviews price, credits, expiry and unchanged plan before
an explicit Pay action. Plan review explains current plan, purchased allowance,
effective timing and no automatic renewal. Active cards have a textual badge and
distinct border independent of selection. Completed purchases, unresolved states
and unconfirmed checkout attempts are separated; attempts remain inspectable in a collapsed
section with date/reference. Operator tools are collapsed and load failures are
reported, never presented as no records. Purchase completion refreshes invoices,
history, credits and entitlement from server reads.

Scope: account billing React components, adjacent CSS/tests, billing read-error
handling. No record deletion, schema/accounting/signature/idempotency changes,
provider calls, branch integration, push, deployment, Production/Live keys or
corpus work. Existing operator SQL error, queued-period API projection and stale
plan order preflight remain separate acceptance blockers, not silently fixed here.

Evidence: causal regressions for no purchase on card selection, explicit review
confirmation, retained collapsed attempts, unresolved states, active plan and read
errors; focused/full tests, lint, build, bundle and local browser fixture.
