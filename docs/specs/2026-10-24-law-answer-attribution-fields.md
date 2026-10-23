# Law answer attribution and canonical case fields

> **Status: Living.** F247/F248 correction, authorized for implementation and release on 2026-10-24. No new ingestion.

The released listing layer maps ten indexed orders correctly. Live Globiz research attributed section 3 corporate-debtor submissions to the tribunal; the prompt requires factual grounding but does not distinguish a statement recorded in an order from the court adopting it. Retrieved chunks can omit their governing heading. The Future Consumer panel ignores structured case_number and parses its title instead.

Expected behavior: legal answers distinguish party submissions, quoted authorities, tribunal reasoning and operative relief; absent attribution requires another targeted search or an explicit attribution limitation, not a confident finding. Section numbers alone are not speaker labels. Final relief controls costs/outcome; a party's prayer is not an order. The panel prefers a nonempty string case_number, preserving legacy title fallback without changing source data.

Scope: research-chat prompt and its contract tests; insolvency record adapter/tests; client preparation guide/message and open-work. Start with the smallest prompt correction and evaluate the original question against real retrieved evidence. Do not infer section roles by case-specific regex or rewrite chunks. If live evaluation fails, diagnose before widening the implementation.

Acceptance: red/green prompt contract and adapter regressions; all app/Edge tests, lint/build, required CI; signed-in NTER original Globiz query and a focused submission-versus-findings follow-up with correct citations; Future Consumer case shown in tiles, field board and details. Prompt assertions establish wiring only; live answers establish bounded semantic evidence, not universal accuracy. Preserve corpus fingerprints. No migration, re-ingestion or batch submission.

Handoff: replace the next preparation target with100 new eligible supported documents, followed by a separately approved1000 only after100 passes indexing/publication, identity/citation/RAG, duplicate and resource checks. Earlier preparation remains reusable; fetch current main, preserve checkpoints, regenerate stale mappings. Both cohorts remain unapproved for submission.
