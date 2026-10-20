# Mandatory CI implementation

> **Status: Historical (2026-10-21).** Sequential; no delegation.

Spec: ../specs/2026-10-21-ci-enforcement.md

1. Inspect GitHub permissions, current protection and official Vercel checks API.
2. Configure native checks for Build and tests and SQL fixtures (disposable
   Postgres), requires=none, blocks=deployment-alias, targets=preview/production,
   timeout=2400 seconds; verify names, timing and fail-closed behavior.
3. Protect main with strict required checks, GitHub Actions app binding,
   administrator enforcement, no force pushes/deletion, and PR-only changes.
4. Correct advisory-policy comments in .github/workflows/ci.yml, AGENTS.md and
   docs/agents/coordination.md, docs/agents/onboarding.md and README.md; no
   execution changes to quality jobs.
5. Publish isolated task/ci-required-checks; observe CI/Preview pending and
   successful transitions. Check protected merge behavior without merging or
   publishing application changes to Production. Record limitations and evidence.

Write scopes: the files above, this spec/plan and docs/plans/open-work.md.
Verification: GitHub/Vercel authenticated API reads; git diff --check; workflow
comparison; fresh remote CI for the configuration/documentation commit.

## Execution evidence

- GitHub main protection readback: strict required checks from GitHub Actions
  app15368; admins enforced; PR required with zero additional human approvals;
  force pushes and deletion disabled. Policy PR4 reported BLOCKED while checks
  were pending. No main push/merge was attempted by this task.
- Vercel project prj_6UiaDz2rkTOmqIOaXnCAs92V7d86 now has native GitHub checks
  chk_83021734-37fe-496c-973e-1ae8de23ccf4 (Build and tests) and
  chk_112d2952-dc3e-4136-9cb1-fa7e3aa8c955 (SQL fixtures). Both target Preview
  and Production, block deployment-alias, require none and time out at2400s.
- Build-start blocking is present in the published API schema but currently
  rejected by the API. Alias blocking is supported and was used. Builds may
  finish before CI; Ready alone does not mean domains were released. The unique
  immutable deployment URL can exist while branch/custom domains are held.
- On d9595ab, Preview dpl_CvdwvjTMbNT67cSLUWjibvRJsutL was Ready with
  aliasAssigned=false and pending native checks. Cancelling only verification
  run39508667078 changed the gate to failed and kept aliasAssigned=false.
- Rerunning that same run/commit (attempt2) passed Build and tests and SQL
  fixtures. Vercel checks became succeeded and aliasAssigned=true automatically.
  No fake passing status, forced promotion or bypass was used.
- A separately authorized main UI merge cbea02e occurred during verification.
  Read-only observation of Production dpl_9Go6uqneAZg4wQcu26K5cpWqrTy4 showed
  Ready, pending native checks and aliasAssigned=false. This task did not
  create, promote or change that Production release.
- Configuration assertions and git diff --check passed. CI execution commands
  and job names are unchanged; only policy comments/documentation changed.
  Documentation is published in PR4, intentionally unmerged to avoid a release.

## Operational boundaries

Privileged project owners can change gates or explicitly force promotion; this
is not a substitute for protecting account credentials. Normal releases must
never bypass failed checks. No application, database, environment variable,
payment key, deploy credential or secret was changed. No new deployment token
was added to GitHub. Supabase migrations remain an explicit authorized operation.
