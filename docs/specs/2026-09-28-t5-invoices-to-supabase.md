# Spec: T5, invoices to Supabase

> **Status: Living.** Task C1 of `docs/plans/2026-09-28-remaining-work.md`
> (T5 of the serverless-state plan). The owner approved it on 2026-09-28:
> invoices move to Supabase, with sign-in checks on the billing reads.

## Current state (read in the code on 2026-09-28)

- `server/billingApi.mjs` stores GST tax invoices in the sql.js SQLite file
  under `writablePath()`. On Vercel that file is per instance and lost on
  cold starts (ADR 0005). It is on the guard's known-offender list.
- The invoice number is `NIY/<FY>/<count+1>`, where the count is read from
  the same per-instance file. On Vercel, numbers repeat across instances
  and restart at 1 after a cold start. GST requires unique, sequential
  numbers per financial year.
- None of the billing routes checks who is calling:
  - `GET /api/billing/invoices?email=` lists any address's invoices (name,
    GSTIN, address).
  - `GET /api/billing/invoice/:id` renders any invoice.
  - `POST /api/billing/invoice` (the "demo" record) writes an invoice for
    any email.
  - `create-order` and `verify` take `userId` and `email` from the request
    body.
- `verify` checks the Razorpay signature, but it recomputes the plan from
  the body and never checks the order's amount. A payment for one order
  could be recorded as a more expensive plan.
- Razorpay keys are not set on Vercel, so production has no live payments,
  and the demo path runs there.

## Expected outcome

1. `public.invoices` holds invoices, with RLS: a user reads only their own
   rows, and a platform admin reads all. Clients cannot insert, update or
   delete. The service role writes only through `issue_invoice(jsonb)`.
2. `issue_invoice` assigns `NIY/<FY>/<seq>` from a per-financial-year
   counter in the same transaction as the insert, so numbers are unique and
   gapless: a failed insert rolls the counter back.
3. Every billing route except `config` and `quote` requires a verified
   bearer, and the buyer's identity comes from that bearer:
   - `create-order` stamps the caller's user id into the order notes.
   - `verify` fetches the Razorpay order. It requires the order to belong to
     the caller, to match the claimed plan and period, and to have the
     amount the quote gives, before it records the invoice.
   - `GET /api/billing/invoices` returns the caller's invoices; the `email`
     parameter is ignored.
   - `GET /api/billing/invoice/:id` renders an invoice for its owner or an
     admin, and answers 404 otherwise.
   - `POST /api/billing/invoice` (demo) is refused on a serverless host
     (production and previews) with 403. Locally it requires a bearer.
4. The client sends the bearer on these calls and opens an invoice by
   fetching its HTML with the bearer, because a plain link cannot carry
   one.
5. When the demo record is refused, checkout reports that online payments
   are not enabled yet, instead of granting a paid plan in the browser.
6. The guard's `billingApi imports db.mjs` offender is removed.

## Acceptance evidence

- **SQL fixture `supabase/tests/invoices.sql`:**
  - own-row reads, admin reads, no client writes;
  - `issue_invoice` numbering in sequence per financial year, restarting
    in a new year;
  - a rolled-back issue leaves no gap;
  - it fails without the migration.
- **Route tests, which fail first:**
  - 401 without a bearer on every protected route;
  - another user's invoice is 404;
  - the email parameter is ignored;
  - the demo record is refused on a serverless host;
  - `verify` rejects an amount, plan or owner mismatch;
  - identity comes from the bearer, not the body.
- `npm test`, `npm run build`, the router import, the Deno suite and
  `npm run test:sql` pass.

## Out of scope (reported to the owner)

- **Plan entitlements are enforced only in the browser.** A paid upgrade
  updates `sessionStorage`, not `user_profiles.plan`, and no server route
  checks the plan. That needs its own billing and entitlements spec.
- Razorpay configuration on Vercel, and webhooks.
- Moving the single-page invoice renderer (`gstBilling.mjs`).
