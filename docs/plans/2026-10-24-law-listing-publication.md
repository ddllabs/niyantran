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

## Implementation-stage verification and release boundaries

Production corpus and existing ten documents/527 chunks untouched. No new paid queries, indexing or OCR. SQL tests use local disposable containers only. Real production website acceptance and metadata-only reconciliation require separately authorized activation after review; they are not simulated by local green tests. Track exact commands, regression outcomes and review findings below.

## Execution evidence

PR13 fix `91254514`, updated head `bd4a9060`, merged as `e651b7f0` after independent review and CI40006075188: Build and tests and SQL fixtures both success. Supervisor reran16 Python/7 importer tests, lint/build. Original scanner regression RED is documented in operations handoff. No corpus writes.

Client review found incomplete CLI states returning0 and preflight fingerprint not bound to registration. CLI regression failed before correction; pending now exits2 and holds3. Registration sends the expected fingerprint for atomic server comparison. Client tests use synthetic fixtures and localhost only.

## Implemented handoff

- Additive canonical tables, scoped admin actions, atomic admission and durable publication intent/activation are implemented. New unsupported Law sources hold before indexing. Historical exact retries remain compatible.
- Canonical NCLT pagination/search and record-key attachment resolution are wired through module, selection/pins, coverage and research-chat. The source-register count is explicitly distinct from indexed-document coverage.
- Updated `corpus-text-import.mjs` uses live reconciliation and passes the expected mapping fingerprint. New `law-listing-reconcile.mjs` plans, publishes and verifies metadata only; private fsynced reports record uncertain outcomes and stop automatic replay.
- Independent backend review found a publication/document lock inversion. The original ordering reproduced an actual PostgreSQL deadlock; activation now takes the publication lock first. A projection trigger's unrelated DELETE passthrough also failed a regression before correction. No remaining concrete blocker was found in the final read review.
- Baseline source-membership refresh is intentionally separate and tracked as F246. The first adapter holds unsupported forums, revisions/translations and compound-only matches. No production-scale throughput claim is made.

Client entry point: [Law listing client guide](../operations/law-listing-client-guide.md). Server interface/release sequence: [backend contract](../operations/law-listing-backend-contract.md). Scanner explanation: [review repair](../operations/law-cohort-screen-review-fix.md).

## Local browser evidence

Isolated headless Chrome loaded the real DeskView component through local Vite with a synthetic 102-record canonical response. Assertions passed for 100+2 pagination, two same-title order/announcement selections remaining distinct, server search finding the last-page Globiz fixture and resetting to page1, empty results, and a503 error without stale rows. Zero browser page errors. All API/external requests were intercepted; no production corpus or provider calls occurred. This is component/browser integration evidence, not authenticated production website or natural-language RAG acceptance.

The development server emitted the existing public embedded-manifest import warning while loading the fixture; production build and browser assertions passed. No unrelated asset-import refactor was made.

## Integrated verification

- `npm test`: 423 files,6573 tests passed.
- `deno test -A --config supabase/functions/deno.json supabase/functions`:1203 passed.
- `python3 -I scripts/law-cohort-screen.test.py`:16 passed.
- `node --experimental-strip-types --test scripts/corpus-text-import.test.mjs scripts/law-listing-reconcile.test.mjs`:21 passed, including real localhost CLI exit checks. A service-role credential in the publishable-key slot failed the added regression before the transport guard; both credential slots now refuse service credentials.
- `npm run lint`, `npm run build`, router import and `npm run check:bundle`:passed. The final credential-only delta also passed focused ESLint. Bundle check reports181170 bytes gzip initial JavaScript across two assets, within its budget.
- Backend causal checks cover concurrent publishers, actual activation/exact-retry lock contention, stale mapping, aliases, unrelated deletion and projection/visibility guard removal.
- `bash supabase/tests/run.sh`:all57 disposable SQL fixtures passed, including omission/vacuity controls, Law concurrent publishers and activation/exact-retry overlap. No live database was used as a fixture.

At the end of local implementation, no listing feature push, migration, Edge deployment, seed, existing-ten publication or activation had occurred. The ten documents/527 chunks were not mutated by this task. Production listing/search/natural-language acceptance remains a release gate; successful vector self-lookup is not substituted for it.

Local implementation commits: `a04eec63` backend, `76f6391f` canonical serving/attachments, `a9449fdf` clients/CI. At that local checkpoint they were on `task/law-listing-spec`, unpublished; PR13 alone had merged. The subsequent authorized release is recorded below. Task worktree cleanup was requested through managed archival after integration; recoverable snapshots preserve delegated work.

## Authorized release — 2026-10-24

Owner subsequently authorized push, PR, merge after CI, deployment, metadata-only existing-ten reconciliation and website verification. PR15 merged as `2173b95be8dc785ac0c04b7291b6c38c25b45162`; required PR and main CI passed. Matching production readers/handlers were verified before seed, ten publications and activation. See [release evidence](../operations/law-listing-release.md) for unchanged fingerprints, actual caller path and website findings. No larger batch or re-ingestion ran.
