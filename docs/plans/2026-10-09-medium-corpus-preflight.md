# Plan: medium corpus audit

> **Status: Living.** [Spec](../specs/2026-10-09-medium-corpus-preflight.md). Owner authorized investigation/preparation; sequential, no delegation. Existing task branch; preserve prior uncommitted work and immutable evidence.

1. Refresh checkout/production baseline and inspect current preflight/ingestion limits. Read-only.
2. Add explicit medium preflight policy, preserving small defaults; scope scripts/corpus-job-preflight.mjs and scripts/corpus-job-preflight.test.mjs. Prove medium acceptance fails first, then test invalid tier/oversized source/stage packing boundaries. No execution worker change.
3. Verify focused Node checks, npm test, npm run lint, npm run build and git diff --check.
4. Copy immutable candidate inventory into new artifact directory corpus-job-plan/medium-preparation; run read-only medium audit. Capture per-source original/text/PDF/current mapping evidence. Draft stages are not released and remain incompatible with live small-worker limits.
5. Review pass/hold receipts, current endpoint chunk/embedding/time/memory behavior and largest input sizes. Perform no-write endpoint checks for proposed pilot sources if useful. No paid calls or failure injection.
6. Write docs/research/2026-10-09-medium-corpus-readiness.md, update this spec/plan, docs/operations/corpus-jobs.md and R7 in docs/plans/open-work.md. Record exact client-required evidence only when verified missing; unresolved internal audit checks are not client-data blockers.

Runtime PDFs/text/receipts/checksums/logs go in the new artifact directory. Medium dry-run checks must use dry_run:true; production documents/chunks must remain unchanged. Do not re-OCR or execute an unapproved medium pilot. Any further execution requires a concrete release after this evidence exists.

## Executed outcome — 2026-10-09

Tasks 1–6 complete: 117 receipts reconcile to 48 pass / 69 hold; 10,093 passing chunks, twelve draft stages. All 48 no-write endpoint checks and independent chunk/hash checks passed; no embedding clamp affects them. Eight sources /672 chunks are proposed for a modest character-cap extension, beginning with one83-chunk Immigration/Foreigners2025 pilot then seven589-chunk follow-up. Drafts are unauthorized; live worker unchanged. No client missing-data requirement established; held-source CSV names internal checks first. 51 focused checks, 2,465 application tests, lint/build pass, existing bundle/type-stripping and PDF font warnings recorded. Production remains2,455 documents /2,452 indexed /57,153 chunks. [Full evidence](../research/2026-10-09-medium-corpus-readiness.md). Remaining execution/hold review stays in R7; no declaration of full corpus completion.
