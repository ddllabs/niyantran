# Global persona rollout

> **Status: Living.** Owner-authorized implementation and production release.

Spec: [published personas for all users](../specs/2026-10-28-persona-global-rollout.md). Branch task/persona-global-rollout. Sequential; no delegation.

1. Add independent service-only management, runtime eligibility and confined active-prompt RPCs. Start global_enabled=false and retain current pilot compatibility. Write a disposable global-authorization fixture and prove its negative control.
2. Separate admin override permission from published-prompt consumption in shared resolution and research-chat wiring. Write failing non-admin consumption/override tests before implementation. Update admin endpoint and audience metadata.
3. Replace pilot-only UI wording with actual server-reported audience and global publication/rollback labels; update focused UI tests. Preserve draft, history, exact text and page layout.
4. Run focused and full application/Edge suites, lint/build/bundle checks and disposable SQL fixtures. Push a protected PR and require both named jobs on the exact head. Apply only this migration, deploy only affected functions, enable global consumption, merge and verify nter.pro on its checked merge commit. Preserve published texts and record rollback/state evidence in the completion receipt.

Write scope: persona shared resolver/tests, research-chat wiring and relevant tests, admin-personas authorization/audience, persona UI/client labels/tests, additive rollout migration, new SQL fixture/runner mapping, task specs/plans and only the persona tracking entry in open-work.md. Another worker's corpus documents and tracker hunks are excluded.

## Verification before PR

- Red-first shared resolver tests: the old coupled permission accepted the consumer override and rejected an admin test while consumption was paused (two causal failures). The separated implementation passes both.
- Focused UI tests: 8 passed. Edge suite: 1,429 passed. Lint, production build and bundle guard passed.
- Full application suite: 6,634 passed across 435 files. The admin-personas entry passes `deno check` after correcting timeout ordering. Local SQL execution is blocked by an unresponsive Docker daemon; the isolated CI SQL job must pass all fixtures and the new migration-removal negative control before any live migration.
- Initial CI run 40570258073 passed both required jobs, including the global SQL fixture and its migration-removal negative control. Final-head checks remain a release prerequisite.
- Downloaded 43 live research-chat files: source matches the current main implementation; refresh/compare again before deployment. Live six active/draft revision IDs and hashes captured in temporary local release evidence; prompt contents must remain unchanged.
- Self-review covers separate consumption/management authorization, service-only RPC grants, own-persona confinement, profile status, exact text, rollback flags and preservation of audited CAS publication. No dependencies, role changes or public browser data access are introduced.

## Release receipt — 2026-10-28

- Runtime code: `88140bd3`. Both required jobs passed on push run 40571301059 and PR run 40571309106. Initial SQL run also proved the new fixture fails when this migration is removed. All 59 disposable fixtures passed in CI. The local Docker daemon remained unresponsive; no containers were restarted or deleted.
- Migration `20261027192031_persona_global_rollout` applied alone, atomically with its exact ledger source. Staged with global_enabled=false. No blanket db push or migration-history repair.
- Deployed only admin-personas v2 and research-chat v106. Downloaded 45 source files and compared byte-for-byte with the checked commit: no differences. Existing handler JWT verification retained; unauthenticated requests return401 for both endpoints.
- Live persona_admin/persona_admin_access/persona_published_access/persona_active are SECURITY INVOKER and executable only by service_role, with no anon/authenticated grant. Security advisors unchanged:36 informational RLS/no-policy findings and21 preexisting definer-function warnings; the four persona tables intentionally have no browser policies. No new finding introduced ([linter guide](https://supabase.com/docs/guides/database/database-linter)).
- Set global_enabled=true only after the source/auth checks. enabled remains true. All six active/draft revision IDs, generations and SHA256 prompt hashes are identical before/after. No prompts were saved or published during rollout; no roles or corpus/billing records changed.
- Actual signed-in normal chat completed with source=published, Corporate revision `113f7829-f80d-4db6-9582-23ea8ba5edc6`, hash `b97e89a9188abf785f1f896ba597733b8993d2f40587985a36f8c6a60ed82cbf`. Browser showed the completed greeting and no console errors. The live browser identity was the owner admin; non-admin global consumption and override/management denial were executed in disposable SQL and runtime tests, not another customer's session.
- Frontend publication uses protected PR61; require the documentation receipt commit's checks and the main merge commit's checks before nter.pro domain assignment. Final production admin-page audience/labels and exact alias/commit are verified after merge in the completion report.

Rollback: operator sets global_enabled=false to restore owner-only published consumption, or enabled=false for bundled defaults for all users. Keep revision history and admin management available; no destructive rollback is needed. No in-flight or stored replay behavior changed.
