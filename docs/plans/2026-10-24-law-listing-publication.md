# Law listing implementation

> **Status: Living.** Owner authorized implementation and client updates; no larger batches or re-ingestion. PR 13 correction/push/merge separately authorized.

Spec: `docs/specs/2026-10-24-law-listing-publication.md`. Tracker F244/F245.

## Sequence and ownership

1. Isolated PR13 worktree: scanner, tests and operations explanation only. Supervisor reviews, runs gates, commits and pushes existing PR branch; merge only exact reviewed head after required CI. Never force push.
2. Backend worktree: additive Law listing migration, SQL fixtures and admin-ingest integration. No production execution. Establish bounded RPC contracts below before frontend/client integration.
3. Main task checkout: canonical Law page read integration, browser selection/coverage/RAG resolution and client scripts after backend contracts are confirmed. If delegated, use disjoint worktrees and exact scopes. Supervisor owns shared docs/open-work and integration.
4. Verify focused red/green, lint/build/router, full app and Deno suites, disposable SQL fixtures with negative controls, client tests and local browser behavior. Independent final review. Commit local implementation; no implicit production migration/backfill.

## Fixed integration boundaries

Canonical records and separate record-document links preserve immutable supplied-text metadata. Publication queue is durable and independent of paid indexing. Legacy prepared row keys seed from existing desk_rows; source memberships own refreshes, not arbitrary deletion. First supported collection is IBBI_NCLT with tribunal_order/NCLT citation and official order URL; unsupported mappings hold.

Admin-ingest actions will expose read-only reconciliation and idempotent publication/status through existing platform-admin checks. They operate on bounded source identities and hashes; no service-role credentials in client tools. Publication contract is separate from immutable text manifest. Backend returns explicit held, pending and published states, stable listing/document IDs and fingerprint, never counts registration as published.

Read RPC supplies bounded pages plus exact filtered/total counts, stable keys and document_key `law-record:<record-id>` where appropriate. Attachment RPC accepts at most twelve keys and returns verified document IDs and keys under caller permissions. Existing bill paths remain unchanged. Server reads use caller/anon credentials, never service-role exposure. Canonical serving remains unavailable until explicit seed/activation; no static fallback after activation that hides database failures.

## Verification and release boundaries

Production corpus and existing ten documents/527 chunks untouched. No new paid queries, indexing or OCR. SQL tests use local disposable containers only. Real production website acceptance and metadata-only reconciliation require separately authorized activation after review; they are not simulated by local green tests. Track exact commands, regression outcomes and review findings below.
