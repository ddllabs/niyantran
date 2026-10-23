# F247/F248 implementation and release

> **Status: Living.** Owner approved fixes, NTER testing, PR/CI merge and deployment; no larger batches or re-ingestion.

Spec: ../specs/2026-10-24-law-answer-attribution-fields.md. Sequential work on task/law-answer-attribution-fields.

1. Reproduce panel omission and missing attribution instruction with failing tests. Write scope: src/shell/record/adapters/lawInsolvency{,.test}.js and supabase/functions/research-chat/prompt{,_test}.ts.
2. Prefer structured case_number with legacy fallback; add mandatory legal attribution/retrieval and final-answer checks. No schema or immutable corpus change.
3. Update docs/operations/law-next-batch-agent-message.md and law-listing-client-guide.md for 100-first preparation, checkpoint resumption and explicit later approval. Keep the public handoff filename stable.
4. Run focused Vitest/Deno then npm test, full Edge suite, npm run lint and npm run build. Independent review of scoped diff before release; reviewer read-only, no delegation beyond review.
5. Push/open PR, merge exact reviewed head only after required CI. Deploy research-chat plus matching web; verify exact versions and production alias. Test both defects on signed-in NTER; compare original ten fingerprints. Record truthful bounded results and any failures. Update open-work and handoff release state.

Verification commands: npx vitest run src/shell/record/adapters/lawInsolvency.test.js; deno test -A --config supabase/functions/deno.json supabase/functions/research-chat/prompt_test.ts; npm test; deno test -A --config supabase/functions/deno.json supabase/functions; npm run lint; npm run build. CI SQL fixtures remain required even without SQL changes.

## Verification so far

F248 regressions failed on the original implementation (missing canonical field and precedence); after correction all 14 focused adapter tests pass. F247 prompt-contract test failed before the instruction change; all 45 prompt tests pass afterwards. These are wiring tests, not semantic model evaluations. Independent reviewer reran both focused suites and found no code blocker; requested handoff branch/format clarification was incorporated. Full Edge suite 1204, lint and production build pass. Application suite: 423 files / 6,575 tests pass. Live acceptance remains pending.
