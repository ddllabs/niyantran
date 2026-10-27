# Message for the corpus ingestion agent

> **Status: Living.** Owner-review handoff, 2026-10-28. Production and ingestion remain held.

Copyable message:

> Keep ingestion and collection expansion paused. Preserve your corpus branch, checkpoints and receipts. The supervising agent owns the shared F257–F260 fixes and the existing mapping repair release; do not implement competing production fixes or apply mappings yourself.
>
> The local changes introduce verified record-to-document associations, current coverage badges, confined retrieval and rejection of empty successful answers. They are not yet a production release. Do not assume this branch or these files have been pushed.
>
> Read AGENTS.md, docs/agents/onboarding.md, docs/agents/coordination.md, docs/plans/open-work.md, docs/specs/2026-10-28-corpus-record-retrieval-contract.md, docs/operations/2026-10-28-corpus-repair-review/README.md and the existing supplied-text/Law listing contracts. The runnable offline repair planner is scripts/record-mapping-repair.mjs; its tests are scripts/record-mapping-repair.test.mjs. Existing ingestion/chunking scripts remain the ingestion engine. No OCR or embeddings need regenerating for a missing listing association.
>
> Provide a read-only reconciliation of your batches: document IDs, source keys, exact full URLs, text hashes, chunk/vector counts, listing identities, verified links, holds, visibility, checkpoints and costs. Separate registered, indexed, mapped, published and website-accepted counts. A matching PDF URL checked during admission is not a persisted serving association. A null legacy key does not mean a Law document is unmapped.
>
> After the shared changes are reviewed and released, update your scripts on your isolated task branch to consume the released mapping contract. A new collection requires a tested adapter before bulk admission. Preserve full URL identity and validating metadata; never match by title alone or assign arbitrary keys. One answer can serve several MP rows; versions must remain explicit. Unknown or ambiguous mapping stays held.
>
> Future batch acceptance must prove current authenticated Full Text coverage, generic attached-record questions, confined document and row retrieval, correct citations/reader navigation and idempotent registration plus mappings. Empty scoped retrieval must never trigger a broader corpus search. Web context follows its separate disclosed privacy policy and is not evidence from the attached PDF.
>
> For now: no re-ingestion, queue resumes, new batches, schema changes, production fixes, push, merge or deployment. Return reconciliation evidence and proposed client-script updates for review. A later 100-document validation cohort and then 1,000 documents each need explicit release authorization; this message does not authorize either.
