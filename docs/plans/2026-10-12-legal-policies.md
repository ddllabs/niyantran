# Legal policies implementation

> **Status: Living.** Spec: `../specs/2026-10-12-legal-policies.md`. Tracked as
> F107 (with F108, F109). Branch `task/legal-policies` from `main` at
> `b36ade0`. Sequential; no delegation of writes. Evidence:
> `../research/2026-10-12-personal-data-inventory.md` and
> `../research/2026-10-12-policy-requirements.md`.

1. **Policy content.** Rewrite the default Privacy Policy and Terms of
   Service from the data inventory and owner decisions; add Refund &
   Cancellation, Shipping & Delivery, About and Contact content. Write scope:
   `src/lib/privacyStore.js`, `src/lib/termsStore.js`, new
   `src/lib/legalPolicies.js`.
2. **Pages and links.** Routes `#/about`, `#/contact`, `#/refunds`,
   `#/delivery` rendered with the existing `LegalDocPage`; footer shows
   "operated by Niyantran Strategy Consulting Private Limited" and links all
   policy pages. Write scope: `src/marketing/MarketingSite.jsx`, new page
   components under `src/marketing/`, scoped `marketing.css` if needed.
3. **Signup notice.** A plain line with links to Terms and Privacy at account
   creation (no pre-ticked box). Write scope: `SignupPage.jsx` and its test.
4. **Pricing (F99), next step.** The public pricing page shares plan IDs
   with billing and entitlements (`billing.js`, `planEntitlements.js`,
   admin pricing). Changing it to Free/Plus/Pro/Max in INR is planned
   separately with F109 so billing and display cannot diverge.

Verification: red-first focused tests (policy facts present and consistent;
routes and footer links exist; signup notice), full `npm test`, lint, build;
browser check of every new page at 360 and 1440 px and the footer.
Excluded: billing/invoice/GST code, Razorpay, credits, admin editor
persistence (F108), backend. No push or deploy.
