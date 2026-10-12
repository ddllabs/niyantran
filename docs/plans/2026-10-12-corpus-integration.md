# Corpus integration review

> **Status: Living.** Owner-authorized local integration preparation, 2026-10-12.

## Contract
Review the 92-file corpus snapshot on an isolated task checkout based on origin/main 6acabfb. Preserve the shared checkout byte-for-byte, UI files, and the committed Download resolver and companion. Prepare coherent local commits only for verified work. No merge, push, deployment, ingestion, or production writes. Earlier ingestion authorizations do not authorize execution during this task.

## Plan and scopes
1. Coordinate with the UI chat, fetch origin, create task/corpus-integration-20261012, and hash/copy the exact pending corpus files. Completed; UI confirmed no Git or corpus writes in progress. Snapshot inventory is /private/tmp/corpus-integration-snapshot.json.
2. Review tests and implementation for context chunking, version retrieval, mapping regression tests, and corpus scripts. Independent read-only review covers Edge code and worker safety.
3. Correct demonstrated corpus defects in this checkout only, with failing regression evidence; otherwise retain unfinished work uncommitted and record blockers in R7.
4. Run npm ci, npm test, full Deno tests, corpus Node tests, lint, build, and disposable local SQL fixtures. No production credentials copied.
5. Commit verified slices and evidence in dependency order. Report hashes, file scopes, gaps, dependencies and untouched work. Verify the shared snapshot remains unchanged.

Acceptance requires executed checks and review evidence, not old run reports alone. Runtime manifests, original corpora, credentials and generated files are excluded from commits. Current data counts in historical reports are dated evidence, not a fresh production reconciliation.

## Verification outcome

The snapshot was reviewed and split into local commits. Two independently identified defects were corrected with red/green regression evidence: model continuation sections and required two-feature current listing validation. Final suites: 2,506 application, 881 Edge, 113 corpus tests; lint/build and all 22 SQL fixtures with 22 non-vacuity checks pass. See [full review, paths, order and remaining holds](../research/2026-10-12-corpus-integration-review.md). No production work or ingestion ran. Owner integration review remains; R7 is not closed.
