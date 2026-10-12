# Module: signup-composition

> **Status: Living.** Owner approved scope and implementation on 2026-10-12.

## Outcome

Signup feels complete through visible product-related artwork and a clear form
hierarchy. Proposed desktop composition: a dedicated illustration/context area
beside the form rather than artwork largely hidden behind it. Mobile places a
compact graphic above the form or reduces decorative artwork to prioritize fields.

## Scope

src/marketing/SignupPage.jsx, signup-scoped rules in marketing.css, new static
illustration assets under public/brand if approved, SignupPage.test.jsx and
relevant marketing UI tests. Reuse palette roles from desk-theme; do not change
shared marketing/auth styles without proving Login/reset views retain behavior.

## Acceptance

- Artwork has a deliberate visible area at desktop widths; form fields and
  persona options remain readable without art behind them.
- Name, email, password, confirmation, persona selection, Google sign-in,
  verification/resend and existing error messages retain behavior and order.
- No plan-selection step or access claim contradicts free signed-in desks.
- Keyboard, autocomplete, labels, form scrolling, zoom and small screens work;
  decorative graphics have empty alt/aria-hidden and reduced-motion handling.
- No auth API, profile schema, subscription facts or analytics behavior changes.
- Compare desktop/mobile signup and verification-state previews before rollout;
  mock authentication for tests. Apply index.md verification contract.
