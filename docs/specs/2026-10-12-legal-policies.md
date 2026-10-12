# Legal policies for payment-gateway activation

> **Status: Living (draft).** Owner requested on 2026-10-12. Not legal advice:
> the drafts need review by an Indian lawyer before the gateway submission.

## Problem

Activating a payment gateway (Razorpay) needs public, accurate policy pages
that match what the product does and what it sells. The current Terms and
Privacy pages are generic drafts and the site lacks refund, delivery and
contact pages.

## Current state (read from code, 2026-10-12)

- `src/marketing/TermsPage.jsx` and `PrivacyPage.jsx` render default text from
  `src/lib/termsStore.js` and `src/lib/privacyStore.js` (last updated
  3 September 2026). Address, website, jurisdiction and courts are blank.
- Neither names the DPDP Act 2023 or its Rules, a grievance officer, the data
  processors actually used, refunds or payments.
- Edited content is kept in each browser's `localStorage`, so an admin edit
  does not reach other visitors.
- The pricing page still advertises older desk restrictions (F99) although all
  desks are free to signed-in users (F98).
- Billing code (invoices, `issue_invoice`, GST supplier settings) assumes GST
  invoicing.

## Owner decisions (2026-10-12)

- **Entity:** Niyantran Strategy Consulting Pvt Ltd, Kolkata. Not
  GST-registered.
- **Plans:** Free ₹0, Plus ₹399, Pro ₹999, Max ₹9,999. Pricing is based only
  on AI credits and storage; desks and data stay free to signed-in users.
- **Credits:** consumption is measured in tokens; the credit definition and
  credit policy will be set later. Policies must not promise quantities that
  are not yet defined.
- **NYAI:** an in-house fine-tuned (SFT) model, available only on Pro and Max;
  other models are credit-based on every plan.
- **Grievance officer and contact person:** Tamanesh Kauri, +91 80134 25401.

## Expected outcome

Public pages, consistent with each other, the pricing page and the product:
Privacy Policy, Terms of Service, Refund & Cancellation, Delivery (digital
service), and Contact (entity, address, email, phone, grievance officer).
Content is the same for every visitor.

### Further owner decisions (2026-10-12, later)

- **Contact email:** niyantranai@gmail.com (all policy contacts).
- **Address:** "Kolkata, West Bengal, India" until the owner supplies the
  full registered address.
- **Refunds:** no refund rule; payments for an AI service are not refunded.
- **Credits:** unused credits remain on the account.
- **Billing:** plan-based, monthly.
- **Storage:** no user file storage exists yet. A personal file manager will
  come later; only then does storage count towards plan cost. Policies and
  pricing must not sell storage as a current feature.
- **NYAI:** the pricing page may say "Niyantran AI is coming soon".

## Open decisions (owner)

1. Full registered address (gateways require it on the Contact page).
2. Whether monthly plans renew automatically (card/UPI mandate) or are paid
   each month by hand; recurring mandates carry RBI disclosure rules.
3. Whether "unused credits remain" means they carry over every month while
   the account exists, and what happens to them on downgrade or closure.
4. Failed or duplicate charges: gateways expect these to be refunded even
   under a no-refund policy; confirm that exception.
5. Courts: Kolkata assumed from the registered office; confirm.

## Scope (to be fixed in the plan)

Policy content and pages under `src/lib/` and `src/marketing/`, footer links,
the pricing copy (F99), and making published legal content shared rather than
per-browser. Excluded: billing/invoice/GST code, Razorpay keys and webhooks,
credit metering, NYAI itself, any backend deployment. Billing and GST changes
are flagged for a separate task.

## Acceptance

- Each policy statement traces to code evidence (data-flow inventory) or an
  owner decision; nothing promises undefined credit quantities or unreleased
  features as live.
- Gateway checklist items present and consistent across pages and pricing.
- Lint, tests and build pass; pages checked in the browser at phone and
  desktop widths.
- Lawyer review recorded as pending until the owner confirms it.

## Drafted text: assumptions to confirm (2026-10-12)

The drafts in `src/lib/legalPolicies.js` make these choices where no owner
decision existed:

1. **Renewal** is described both ways: automatic renewal with RBI pre-debit
   notice if chosen at checkout, otherwise the plan ends with the paid month.
2. **Training:** user questions, attachments and answers are not used to
   train AI models, including Niyantran AI, without separate consent.
3. **Refund exceptions:** duplicate, failed (debited but not activated) and
   unauthorised charges are refunded, confirmed within 7 working days.
4. **Credits** remain while the account is open, have no cash value and lapse
   when the account is closed.
5. **Eligibility:** 18 and over.
6. **Business hours:** Monday to Saturday, 10:00 to 18:00 IST.
7. **Liability cap:** fees paid in the three months before a claim.
8. **Courts:** Kolkata, West Bengal.

## Execution evidence (2026-10-12, branch `task/legal-policies`)

- Pages: Privacy (13 sections), Terms (20), Refund & Cancellation (7),
  Shipping & Delivery (4), About (4), Contact (3), at clean paths `/privacy`,
  `/terms`, `/refunds`, `/delivery`, `/about`, `/contact` and as `#/<page>`.
  Footer links all six and names the operating company; signup shows a notice
  linking Terms and Privacy (new tab, no checkbox).
- Red-first tests: `src/lib/legalPolicies.test.js` (company, contact,
  grievance officer on every page; processors named; plans, monthly billing,
  no GST, Kolkata courts; no-refund with exceptions; routes and footer) and a
  signup notice test.
- `npm test` 190 files / 2,533 tests; Deno 881 passed; lint exit 0; build;
  `git diff --check`. Browser: all six pages at 360 and 1440 px render with
  no horizontal overflow; signup notice links verified.
- Not done here: pricing page (F99, with F109), admin editor persistence
  (F108), lawyer review, full registered address.

## Pricing page (F99), 2026-10-12, branch `task/pricing-inr`

The public pricing page now shows Free ₹0, Plus ₹399, Pro ₹999 and Max
₹9,999 per month from `src/lib/publicPlans.js`, with "Niyantran AI is coming
soon" on Pro and Max, notes that no GST is charged and that credit allowances
will be published with the credit policy, and a comparison of only what the
product offers. The yearly toggle, USD prices, Government plan and
unsupported claims (API access, team collaboration, dashboards, deployment
options) are removed. Every plan button leads to signup; "Contact us" opens
the contact page. Billing (`pricingStore.js`, `billing.js`, server charge
table) is unchanged and still describes the old plans: F109 must align it
before payments go live. The admin pricing editor no longer feeds this page
(it never reached visitors; F108).

Evidence: red-first `src/lib/publicPlans.test.js`; `npm test` 192 files /
2,539 tests; Deno 881; lint exit 0; build. Browser (DOM checks, pane hidden):
four rupee cards, Pro/Max coming-soon, nine comparison rows, no "$" or yearly
text, no overflow at 360/768/1440; plan button goes to signup, help button to
`/contact`; zero console errors. The hero's unmeasured figures ("UPTIME
99.9%", "FEED 211+") remain under F30.
