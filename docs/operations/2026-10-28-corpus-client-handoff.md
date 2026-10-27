# Message for the corpus ingestion agent

> **Status: Living.** 2026-10-28. F257–F260 released through PR #62; existing reviewed mappings applied. New ingestion and larger batches remain held.

## Copyable message

Keep ingestion and collection expansion paused. Preserve your corpus branch, checkpoints and receipts. Fetch `origin/main`, confirm it contains merge `8f01b348de0ff3edf7fd457a81f474515369d15b` (PR #62), and work on a separate task branch. Integrate main deliberately; do not discard uncommitted work, rewrite shared history, or touch another agent's branch. Follow AGENTS.md: leave a scoped reviewable diff unless separately authorized to publish it.

### Read first

- `AGENTS.md`, `docs/agents/onboarding.md`, `docs/agents/coordination.md`.
- `docs/plans/open-work.md` and `docs/specs/2026-10-28-corpus-record-retrieval-contract.md`.
- `docs/operations/2026-10-28-corpus-repair-review/README.md`, `verification.md` and `release.md` in that folder.
- `docs/operations/supplied-text-import.md`, `docs/operations/law-listing-backend-contract.md`, `docs/operations/law-listing-client-guide.md`.
- Existing ingestion scripts and their tests; `scripts/record-mapping-repair.mjs` and `scripts/record-mapping-repair.test.mjs`.

### What went wrong

The Parliamentary OCR documents and embeddings existed, but the listing records did not have a persisted association that the browser and research server could resolve. Matching a PDF URL during admission was not enough. The shared serving path previously handled Bill/Law mappings; Parliamentary record attachments could therefore carry only SQL metadata.

At larger feature size, approximate search could select global candidates before filtering and return an underfilled feature result. Missing record mappings exposed that path. Implicit widening then escaped the user's chosen context, and an empty model response could be stored as a successful answer. These are separate platform defects; do not describe all of them as corrupt OCR or failed ingestion. Do not infer an unmapped Law document solely from a null legacy key.

### What is now fixed

The released shared resolver uses the current `(tier, feature, row_key)` and reviewed document associations. Bill and Law retain their existing adapters. Browser coverage and server retrieval use the same current identity and permission/readiness checks. Attached and selection searches remain within their resolved documents, desk searches remain within the module, and broad search requires an explicit choice. Empty scoped results do not authorize widening. Automatic web context remains a separately disclosed policy and is not evidence from the attached PDF.

Underfilled feature search now recovers within the same feature, with a 100,000-eligible-chunk bound; above that it fails explicitly. This is not proof of capacity for an 18-million-document corpus or guaranteed exact recall for every filled approximate result. Empty or placeholder output is rejected as a failed answer rather than saved as complete.

The supervisor already applied 5,638 reviewed associations covering 4,749 existing Parliamentary documents, under `owner-authorized-20261028-f257-mapping-repair`. Exact replay created no duplicate links. All 49,090 chunks/vectors and full document/chunk row hashes were unchanged. Do not re-ingest those documents or replay this repair with invented approval values. The original inventory held 1,198 documents for incomplete indexing or unverified identity; those are not approved admissions.

### Your next work: preparation only

Produce a read-only reconciliation of your batches: document IDs, source keys, exact complete URLs, text hashes, chunk/vector counts, listing tuples, verified links, visibility, holds, checkpoints and costs. Report registered, indexed, mapped, published and website-accepted counts separately. Reconcile against current live state before proposing any action; the old inventory is a cutoff-bound receipt.

Update client scripts locally to consume the released mapping contract. Existing OCR/chunking/ingestion is the engine; do not rebuild it or regenerate text/embeddings to fix associations. `record-mapping-repair.mjs` is a runnable offline planner and approved-SQL renderer, not a database executor. Its automatic adapter supports reviewed Parliamentary exact-source matches only. A new collection needs a tested adapter and policy boundary before admission.

Preserve full URL identity, validate metadata and text hashes, bind reviewed row/document/chunk fingerprints and expected aliases, and hold ambiguous or stale inputs. Never match by title alone or assign arbitrary document keys. One answer may legitimately map to multiple MP rows; distinct versions must remain explicit. Produce the review manifest, dry-run counts, proposed client-script diff, causal tests and limits before requesting a batch release.

### Acceptance before future batches

Verify authenticated Full text coverage, generic attached-record questions, exact document scope in traces, substantive answers, accurate attribution, citations and reader navigation, plus registration and mapping idempotency. Test missing/partial/held/revoked records as well as successes. Preserve checkpoints and enforce document, chunk and spend limits. A successful indexing job alone is not completion.

The Parliamentary register's old answer-status copy, cached record briefs and MP-named attachment suggestions are tracked separately as F261. Do not mistake that text for missing vectors or attempt re-ingestion to correct it.

No queue resumes, new batches, re-ingestion, production mappings, schema changes, merges or deployments are authorized by this message. Return the reconciliation and proposed script changes for review. The recommended next release is a bounded 100-document validation cohort, followed by 1,000 only after acceptance and explicit owner approval. Neither cohort is authorized yet.
