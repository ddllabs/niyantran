# INR billing: four monthly plans, no GST, no trials

> **Status: Living.** Owner direction 2026-10-12: "This is an Indian product,
> and all pricing must be reflective in INR." Tracked as F109. Branch
> `task/inr-billing` (from `task/pricing-inr`).

## Current state before this change (code inventory, 2026-10-12)

- Four disagreeing plan vocabularies: public page free/plus/pro/max (INR);
  billing explorer/pro/enterprise/gov (USD $49/$149, × `BILLING_USD_INR` 83,
  plus 18% GST, CGST/SGST/IGST split, "TAX INVOICE"); database enum
  explorer/professional/enterprise; policies INR with no GST.
- A yearly purchase charged one discounted month and granted a year.
- 14-day trials via `start_trial()` and via signup metadata (a direct signup
  with `plan: 'pro'` got a trial).
- The only checkout UI (`UpgradeModal.jsx`) was imported nowhere, but the
  `/api/billing/*` routes were live and would have charged the USD+GST amount
  if Razorpay keys were set.
- No AI credit, quota or plan limit exists anywhere; costs are only logged.
- NTER (read-only): 11 profiles, all explorer/free; no plan grants or invoices.

## Decisions

- Plans: Free ₹0, Plus ₹399, Pro ₹999, Max ₹9,999, monthly only, from
  `src/lib/publicPlans.js` (the single source for page, checkout and server).
- No GST is collected (seller not registered); invoices are plain "INVOICE"
  documents stating that no GST was charged.
- Trials are retired (not in the owner's plan set; the Free plan replaces
  them). The homepage "14-day free trial" button now reads "See plans".
- Database values renamed explorer→free, professional→pro, enterprise→max,
  plus added. Older names map to their successors in the browser and server.

## What changed

- **Database:** `supabase/migrations/20261012120000_inr_plans.sql` renames the
  enum values, adds `plus`, and replaces the plan functions: lapsed periods read
  `free`; `paid_plan_of` knows plus/pro/max only; `start_trial` refuses and is
  no longer executable by signed-in users; `grant_paid_plan` accepts monthly
  periods only; `grant_manual_plan` revokes with `free`; signup always starts
  free. Fixture `supabase/tests/inr_plans.sql`.
- **Server:** `server/inrBilling.mjs` replaces `gstBilling.mjs` (rupee quotes,
  plain invoice); `billingApi.mjs` drops yearly, GST, FX and buyer GSTIN/state;
  every grant is one month; `usersApi.mjs` grants free/plus/pro/max.
- **Browser:** `billing.js` checks out Plus/Pro/Max monthly with no GST;
  `planEntitlements.js`/`entitlementStore.js` read free/plus/pro/max with no
  trials; terminal badge shows the plan name and Free/Active; admin users page
  uses the new names; the localStorage-only admin Pricing page,
  `pricingStore.js` and the unused `UpgradeModal.jsx` are removed.
- `.env.example` drops the GST and exchange-rate settings.

## Release prerequisites (not done; need owner authorization)

1. Apply `20261012120000_inr_plans.sql` to NTER (one transaction, then pin the
   version), after which `analyze public.user_profiles` is not needed (no row
   change). Until it is applied, admin plan grants fail ("Unknown plan") and
   payments could not be granted; the browser already maps the old names.
2. Push and deploy only after step 1.
3. Before Razorpay goes live: an in-app upgrade/checkout screen (F110), the
   credit system that the plans sell (F111), Razorpay keys on Vercel (O6) and
   a reviewer test login.

## Evidence (2026-10-12)

- Red first: new billing API tests (rupee quotes 39,900/99,900/999,900 paise,
  old plan names refused, no GST/FX in config, plain invoice, one month even if
  a year is asked) failed on the old server, then passed.
- SQL: `inr_plans` passes and fails without its migration; the migration also
  applied cleanly inside one `BEGIN … COMMIT` on a scratch database. Full
  `npm run test:sql`: 23 fixtures, 23 vacuity checks, all pass; containers
  stopped afterwards.
- `npm test` 193 files / 2,552 tests; Deno 881; lint exit 0; build; router
  import ok.
- Browser: pricing page shows four rupee cards, Pro/Max "Niyantran AI is
  coming soon", readable notes, comparison table with the price row; footer
  links every policy.
