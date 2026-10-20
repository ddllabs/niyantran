# Billing summary: allowance versus balance

> **Status: Normative.** Owner-approved UI refinement,2026-10-21.

Current summary gives equal prominence to plan price, period allocation, spendable balance and its top-up subset. A prorated allocation looks like the advertised plan allowance.

Show three facts: Plan price, Monthly allowance (standard catalog amount), Credits available (server spendable amount). Move credited-this-period allocation and welcome/top-up components into the expandable breakdown; explain proration only when the period allocation differs from the catalog allowance. Preserve usage, holds, debt, expiries, original grants and all financial calculations. Free has no monthly allowance; one-time welcome and top-ups remain in its breakdown.

Scope: public plan display metadata, BillingWorkspace/CSS and focused tests. No server/SQL/financial/provider or Production changes. Verify allowance metadata against the unchanged payment catalog, summary/breakdown separation, missing-credit states, responsive rendering and unchanged actual account amounts. Show an image of the actual resulting UI. Continue only the existing Razorpay Test Preview rollout.
