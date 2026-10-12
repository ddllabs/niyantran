# Main consolidation — 2026-10-12

> **Status: Historical (2026-10-12).** Executed integration and preservation record.

The owner authorized the UI supervisor to integrate the existing corpus branch and push combined main. `task/corpus-integration-20261012` was already based on released UI/Download commit `6acabfb`; no replacement task branch was needed. A fresh fetch confirmed main and origin/main matched that baseline.

Independent read-only review of `6acabfb..d0a8020` found no required blocker. The supervisor inspected the scope, implementation and regression tests and reran:

- `npm test`: 185 files / 2,506 tests passed.
- `deno test -A --config supabase/functions/deno.json supabase/functions`: 881 passed.
- `node --experimental-strip-types --test scripts/corpus-*.test.mjs`: 113 passed.
- `npm run lint`: passed, no warnings/errors.
- `npm run build`: passed; existing >500 kB chunk warning remains.
- `npm run test:sql`: 22 fixtures and 22 migration-removal non-vacuity checks passed in disposable local containers, both returned to stopped state.
- Commit-range `git diff --check`, scope and credential-shaped code scans: passed. No standalone type-check claimed.

The 12 reviewed commits fast-forwarded main to `d0a80209f1293113a4d54dd632691300da02bdb6`; origin/main was pushed to the same commit. UI implementation, committed Download resolver/companion, dependencies, API/server code and deployment configuration are unchanged. The shared main checkout is clean.

All 92 original uncommitted files were copied and hash-verified before reconciliation. Twelve tracked copies were reconciled, and 80 untracked originals were retained separately before their committed versions arrived. Eight reviewed files differ from the originals because of review fixes/documentation. The exact originals, hashes and reconciliation inventory remain at `/Users/vighneshshukla/.codex/visualizations/2026/10/11/01a12c6a-9837-7103-95ed-141c16cb46bb/corpus-originals-before-integration-20261012/`. No original corpus content was lost. No merged worktree or branch was deleted.

The reference-only Vercel project `niyantran-desk-reference-v6` (`prj_hlv83bVVPDlaJht0GP7njfUDhsLA`) was disconnected from Git under separate owner authorization. Readback verified `link: null` and retained project/deployment history. Actual project `niyantran` (`prj_6UiaDz2rkTOmqIOaXnCAs92V7d86`) remains linked to main. Earlier browser checks found all eight desk URLs and nine additional public page URLs clean, no reference matches in the deployed bundle, and no reference names in 168 module names; those browser checks were signed out.

This record precedes final Vercel release readiness verification, reported in the owner handoff. The push/deployment does not deploy Supabase Edge Functions. No production database operation, migration, compute change, source release, paid model evaluation or ingestion restart occurred. R7 pending-source and repair holds remain open; their manifests must not be restarted by treating this code merge as ingestion authorization.
