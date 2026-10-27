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
- Full application suite is running. Local SQL execution is blocked by an unresponsive Docker daemon; the isolated CI SQL job must pass all fixtures and the new migration-removal negative control before any live migration.
- Downloaded live research-chat source matches the current main implementation; refresh/compare again before deployment. Live six active/draft revision IDs and hashes captured in temporary local release evidence; prompt contents must remain unchanged.
- Self-review covers separate consumption/management authorization, service-only RPC grants, own-persona confinement, profile status, exact text, rollback flags and preservation of audited CAS publication. No dependencies, role changes or public browser data access are introduced.
