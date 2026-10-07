# Desk reference v6 preview plan

> **Status: Living.** 2026-10-07.

1. Fetch and verify main; create task/desk-reference-v6-preview.
2. Write scope: previews/desk-reference-v6/** plus this spec/plan and docs/plans/open-work.md. Extract supplied assets without recompression.
3. Verify hashes, static references, JavaScript syntax and diff scope; commit and push authorized task branch.
4. Deploy branch to separate project niyantran-desk-reference-v6 with static root previews/desk-reference-v6; inspect readiness and browser flows.
5. Record deployment result and outstanding acceptance. Do not merge reference assets into main or delete the branch/project before integration review.

Production app tests are unnecessary for static-only reference packaging; no app code changes.

## Deployment evidence

- Static content commit: `50e3004fb53a1abc670b06fe8333f214e0e85eb0`; task branch pushed.
- Vercel project: `niyantran-desk-reference-v6` (`prj_hlv83bVVPDlaJht0GP7njfUDhsLA`), DDL Labs.
- Deployment: `dpl_Amp6efJ38xLUZq5uD79GY2ehiu2D`, READY, preview target.
- URL: https://niyantran-desk-reference-v6-c4z6vppx3-ddl-labs.vercel.app/
- 44 embedded references extracted into 41 unique assets; exact bytes verified; all inline scripts passed `node --check`; `git diff --check` passed. No production app source changed.
- HTTP verification with Vercel-generated seven-day share link and cookie: HTML 200, 182165 characters, expected National title; PNG 200, image/png, 2370381 bytes. Share token intentionally omitted from repository.
- Chrome automation timed out; Arc was not available. In-app browser automatic approval rejected opening the protected preview via the temporary share link without explicit authorization for that access method. Browser interactions remain unverified pending owner approval.
- Main remains unchanged. Temporary branch/project cleanup is deferred until integrated implementation is verified.
