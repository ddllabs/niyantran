# F222 implementation plan

> **Status: Living.** Sequential local implementation on
> `task/f222-market-ids`; no delegation or production release authorized.

Spec: [Preserve Manifold market IDs](../specs/2026-10-17-f222-manifold-identity.md).
Task status is tracked only in [open-work](open-work.md), F222.

## Ordered execution

1. **Establish the contract and failing evidence.** Write scope: the spec,
   this plan, `docs/plans/open-work.md`,
   `src/lib/manifoldIdentity.test.js`. Exercise both loaders with synthetic
   upstream data, optional/invalid IDs, separate markets with the same question,
   unchanged keys and store round-trip. Run
   `npm test -- src/lib/manifoldIdentity.test.js` with the no-dotenv guard;
   required ID assertions must fail before runtime edits.
2. **Preserve metadata.** Depends on step 1. Write scope:
   `src/lib/econPack.js`. Add optional bounded `market_id` through the
   Political Odds and Election Forecast mapping paths. Do not modify key
   generation or SQL. Run the focused tests plus existing election/store tests.
3. **Verify and review locally.** Depends on step 2. Run full Vitest and Deno,
   lint, build, bundle check, router import and `git diff --check`. Inspect the
   complete diff for compatibility, bounded untrusted input and scope. Write
   evidence to `docs/research/2026-10-17-f222-manifold-identity-evidence.md` and
   update this plan/tracker with exact results, including failures/warnings.
   Create a verified local commit on the task branch. Leave release pending
   user approval; no push, preview or production deployment.

## Fixed interfaces and risks

Optional `market_id` lives inside the existing JSON row; consumers without the
field keep working. Existing storage keys, filters and historical observations
are preserved. On eventual deployment, normal refreshes update row hashes as
metadata arrives. URL-based keys still depend on URLs: this task does not claim
to migrate identity or prevent future URL churn. No local SQL/Docker gate is
needed because no SQL, schema or permissions change.
