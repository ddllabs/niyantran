# Desk reference v6 preview plan

> **Status: Living.** 2026-10-07.

1. Fetch and verify main; create task/desk-reference-v6-preview.
2. Write scope: previews/desk-reference-v6/** plus this spec/plan and docs/plans/open-work.md. Extract supplied assets without recompression.
3. Verify hashes, static references, JavaScript syntax and diff scope; commit and push authorized task branch.
4. Deploy branch to separate project niyantran-desk-reference-v6 with static root previews/desk-reference-v6; inspect readiness and browser flows.
5. Record deployment result and outstanding acceptance. Do not merge reference assets into main or delete the branch/project before integration review.

Production app tests are unnecessary for static-only reference packaging; no app code changes.
