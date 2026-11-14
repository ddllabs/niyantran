# Private File Manager: approval and implementation plan

> **Status: Living** — approval pending. This plan records discovery and the proposed sequence; it does not authorize implementation or production changes.

**Spec:** [Private File Manager discovery and integration proposal](../specs/2026-11-14-private-file-manager-discovery.md)
**Final source audit:** [NTER × Tejas OS File Manager final audit](../research/2026-11-15-file-manager-final-audit.md)
**Checkout:** `nter-github-refresh`, branch `task/private-file-manager`, based on upstream `679464770089bde161afc18e2f9200f3ca65a455`.

## Current discovery deliverable

- [x] Refresh the requested GitHub repository in an isolated checkout, preserving the original local source snapshot and its `.env.local`.
- [x] Audit NTER source policies, shared corpus visibility, chat upload behavior, and centralized ingestion path.
- [x] Inspect Tejas OS File Manager source in the preserved `sources` directory; identify org-oriented assumptions and upload policy.
- [x] Trace Tejas OS drive, Storage, tender document, editor document, chunk, embedding, indexing-job and retrieval schemas/flows; note migration archive and live-state caveats.
- [x] Record owner-private requirements, separate bucket contract, ingestion integration boundary, acceptance gates, and unresolved choices.
- [ ] Owner approves scope and resolves the decisions that affect schema, storage/index limits, scanning, artifact lifecycle, and accepted formats.

## Proposed implementation sequence (after approval)

1. **Resolve product contract and threat model** — confirm quotas, parser matrix, scan meaning, artifact lifecycle, folder deletion/retention and admin visibility. Adopt `drive_items` as the item-table name unless the owner chooses another. Fix the owner invariant and two-user threat cases. Bucket product label is **File Manager Drive**; use private Storage bucket ID `file-manager-drive`.
2. **Add owner-scoped persistence and Storage** — additive migrations for one-user `drives`, `drive_items`, durable indexing job rows, private extraction/pages and private chunks, plus transactional usage accounting as approved. Bind every child to the same owner as its drive/item; validate parent folder owner. Create `file-manager-drive` as private with owner-prefix and metadata-backed Storage policies. No personal file rows in shared corpus tables; no edits to current NTER RBAC/shared-corpus RLS.
3. **Build private ingestion adapter** — connect the File Manager Index action to the central job/worker path. Retain leases/fencing, retries/cancel, supported OCR/parser routes, deterministic chunking, embeddings, bounded writes, activation and cost/error telemetry. Write to the new private extraction/chunk records and provide a private search RPC that applies owner scope before top-k. Never call the global `chunk_commit` for private content without an owner-safe destination/contract.
4. **Port selected File Manager experience** — adapt OS browse, upload, folder operations, search/status/preview/delete and AI Artifact section to NTER auth and new APIs. Avoid OS org/team grants, organization-wide Agent Artifacts and tender-specific coupling. Add attach/select in NTER chat with server-side owner validation.
5. **Security and behavior acceptance** — disposable SQL/RLS and Storage tests with two users, forged IDs/paths/parents/job IDs, quota concurrency, lifecycle/retry/activation, parser failures and citations; prove cross-user denial and owner success. Regression-check NTER conversation ownership, shared corpus access and RBAC are unchanged.
6. **Review and rollout proposal** — focused unit/Edge/SQL suites, lint/build, independent security review, rollback and Storage cleanup/quota reconciliation. Production/live writes and deployment remain a separate authorization gate because previews share live Supabase per repository policy.

## Proposed write scopes after approval

- `supabase/migrations/`: additive owner-scoped `drives`, `drive_items`, private job/extraction/chunk/usage tables, constraints, RLS and new Storage bucket policy only.
- `supabase/functions/`: private ingestion adapter/worker and private search/attachment authorization.
- `src/`: File Manager UI, upload and chat integration.
- `docs/specs/`, `docs/plans/`, `docs/plans/open-work.md`: decisions, contract, evidence and progress.
- Tejas source stays read-only reference until the owner explicitly chooses files to port; copy only selected UI pieces after dependency/license/source review.
- Proposed private bucket: ID `file-manager-drive`, product label **File Manager Drive**; not created yet.
- Detailed table inventory, source lineage, policy comparison, pipeline map and acceptance checklist: [final audit](../research/2026-11-15-file-manager-final-audit.md).

## Gate before code copying

Do not copy implementation code until the user accepts this approach and decides the open scope items in the spec, or explicitly delegates reasonable defaults. The first coding change should be the schema/authorization contract, not the UI copy, because the source module assumes organizations, grants and shared-drive machinery that conflict with NTER's requested private-per-user behavior.
