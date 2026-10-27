# F257–F260 local implementation

> **Status: Living.** Released through PR #62 / `8f01b348`, 2026-10-28, with approved mapping repairs. New ingestion remains held. Original task sequence below records the local phase; [release receipt](../operations/2026-10-28-corpus-repair-review/release.md) supersedes its earlier production holds.

Base origin/main dc2b4118. Isolated checkout protects active persona work. Spec: ../specs/2026-10-28-corpus-record-retrieval-contract.md.

## Ordered scope and interfaces

1. Supervisor: record association SQL and RLS, resolver RPC, browser coverage/identity and server binding, ingestion/reconciliation tools. Canonical pointer `desk-record:["tier","feature","row_key"]` is lookup-only, never proof of association. Persist reviewed links by tuple and document UUID; preserve Law/bill adapters. Resolver returns only caller-readable indexed documents with vectors.
2. SQL task: F258 only, new migration/fixture and benchmark under isolated paths; preserve exact document-ID branch and recover within feature. No shared run.sh edits: supervisor integrates registration.
3. Research task: F259/F260 under research-chat agent/answer validation/handler and tests; no index.ts, mapping identity or UI edits. Remove document/module widening; enforce row tool bounds; empty answer is a failed turn. Supervisor integrates mapping in handler after task completes.
4. Supervisor UI scope and shared subject identity, read-only current-corpus reconciliation and unapplied repair manifest/SQL.
5. Independent review; focused causal checks, npm test, Deno suite, npm run test:sql on disposable DB, lint, build, router import; local browser mocked acceptance. No hosted acceptance writes. Record residual production acceptance gates.

Delegation permitted for steps 2/3 with disjoint writes, no commit/push/deploy. Each task reads onboarding, uses a dedicated supervisor-created worktree, and reports exact patches/tests for integration. All shared interface changes are supervisor-owned.

## Final integration refinement

All recoverable record chips now use the tuple pointer for coverage and request serialization, including Bill/Law. The server reads the current desk row and the SQL resolver delegates to its current legacy adapter; cached keys are hints only. This closes the stale-key badge/retrieval mismatch. Final adapter SQL fixtures and the complete 59-fixture SQL suite now pass, including all 59 migration-removal controls. Docker recovery preserved volumes. Local verification is ready for owner review; no release approval is implied.
