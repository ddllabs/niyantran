# Mandatory CI implementation

> **Status: Living.** Sequential; no delegation.

Spec: ../specs/2026-10-21-ci-enforcement.md

1. Inspect GitHub permissions, current protection and official Vercel checks API.
2. Configure native checks for Build and tests and SQL fixtures (disposable
   Postgres), requires=none, blocks=deployment-alias, targets=preview/production,
   timeout=2400 seconds; verify names, timing and fail-closed behavior.
3. Protect main with strict required checks, GitHub Actions app binding,
   administrator enforcement, no force pushes/deletion, and PR-only changes.
4. Correct advisory-policy comments in .github/workflows/ci.yml, AGENTS.md and
   docs/agents/coordination.md; no execution changes to quality jobs.
5. Publish isolated task/ci-required-checks; observe CI/Preview pending and
   successful transitions. Check protected merge behavior without merging or
   publishing application changes to Production. Record limitations and evidence.

Write scopes: the files above, this spec/plan and docs/plans/open-work.md.
Verification: GitHub/Vercel authenticated API reads; git diff --check; workflow
comparison; fresh remote CI for the configuration/documentation commit.
