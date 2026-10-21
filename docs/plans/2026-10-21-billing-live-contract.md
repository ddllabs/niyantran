# Live-capable billing implementation

> **Status: Living.** Sequential; no delegation. Spec: ../specs/2026-10-21-billing-live-contract.md.

1. Integrate main without losing billing work. Inventory all Test mode guards,
   versioned capture/read consumers and hosted schema/function baselines.
2. Add failing server/API and own-credit dispatch tests for Live capability,
   closed checkout, Test allowlist, mode/merchant authority and legacy recovery.
3. Add migration-specific latest-chain SQL fixture, observe missing-contract RED;
   implement additive v2 quote/capture/read RPCs and mode constraint widening.
   Preserve old functions; retain historical financial rows. Verify all mode pairs,
   financial invariants, dates/no-rollover, ACLs, races and omission-vacuity.
4. Wire server/API/credit reader to v2, keeping old order recovery dispatch.
   Run focused checks then full npm test, Deno, npm run test:sql, lint/build/bundle,
   router import and diff review. Use disposable containers only for write tests.
5. Prepare exact migration and read-only hosted before/after assertions. Request
   narrow shared-NTER activation approval only once concrete/reviewable. No Live
   configuration or synthetic financial operations against hosted NTER.
6. Apply only approved migration, push task/razorpay-plan, wait required CI and
   Preview domain gate; verify signed-in Test quote/balance/history without Pay.
   Record exact evidence, untouched Production checkout/Live keys and limitations.

## Verification record (2026-10-21)

- Integrated origin/main at626761d with local mergefa43348; preserved both
  billing history and the mandatory GitHub/Vercel release gates.
- Observed server regression RED:12 failed/4 passed before implementation;
  API/own-credit dispatch RED:3 failed/89 passed with old consumers restored.
  Focused final checks:181 tests in5 files passed.
- Observed disposable SQL RED without v2, followed by matrix GREEN and
  omission-vacuity failure. Latest lifecycle fixture also passes; concurrent
  Live captures observe an actual database lock wait and produce one upgrade
  invoice and one incremental grant. No hosted financial fixtures were used.
- `npm test`:419 files/6,497 tests passed.
- `deno test -A --config supabase/functions/deno.json supabase/functions`:
  1,172 tests passed.
- `npm run lint`, `npm run build`, `npm run check:bundle`, router import and
  `git diff --check` passed. Initial JavaScript gzip180,710 bytes within budget.
- `npm run test:sql`:all52 fixtures passed, including omission-vacuity guards;
  latest lifecycle additions also passed in a separate focused rerun.
  Owner approved the narrow shared-NTER migration; applied
  `20261020230745_billing_live_cycle.sql` successfully. Before/after hashes of
  all8 original financial functions and all5 wallet rows match exactly;
  orders/periods/invoices remain empty and rollover remains0. Readback confirms
  the two mode constraints and all three explicit function ACLs. No hosted
  financial fixtures or credentials changed. Preview publication/browser
  acceptance follow this verified activation.
- Reviewed correctness, ACLs/authentication, merchant/mode/quote binding,
  immutable dispatch compatibility and query bounds. Existing financial RPCs
  remain intact; no new packages or financial settings are introduced.
