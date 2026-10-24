# F251 implementation plan

**Status: Living.** Implements the [qualification spec](../specs/2026-10-24-law-answer-qualification.md). Branch `task/law-answer-qualification`, baseline `fd059e4b`.

1. Read-only baseline: current function, corpus fingerprints, representative source originals, bounded baseline evaluations. Private source text stays outside Git.
2. Causal tests then the smallest measured improvement. Write scope: `supabase/functions/research-chat/lawAnswer.ts`, `lawAnswer_test.ts`; `supabase/functions/_shared/lawContext.ts`, `lawContext_test.ts`, `research-chat/lawPassages.ts` and `lawPassages_test.ts` for the reproduced monetary-decimal false paragraph detection; shared stream tests only if its contract changes; `scripts/eval-law-answers.ts` only for reproducible measurement needs.
3. Compare identical inputs, retain failed runs, review all claims against original citations. Reject regressions. Independent reviewer may read the diff and private evaluation outputs; no edits or delegation.
4. Run focused Deno tests, full `npm test`, full Edge suite, lint, build and router import if applicable. Review before commit.
5. Push PR, attach it, merge only after both required CI jobs pass. Check exact main CI, deploy reviewed research-chat bundle, verify source match and unauthenticated rejection.
6. Test on authenticated NTER, inspect original source links and response semantics, compare corpus fingerprints. Record exact results and limitations in `docs/operations/`; update sole tracker `docs/plans/open-work.md`.

No larger batch or re-ingestion is authorized by this task.

Revised write scope after measured schema rejection: handler.ts and handler_test.ts wire/verify the compact-evidence path; evaluator opts into it for single-document fixtures. No schema-format or model routing change ships. Full source-preserving checks and configured retryable failover cover both paths. Additional exact-quotation regression follows a reproduced baseline error. Independent review is required again on the final diff.
