# Next Law cohort: agent handoff

> **Status: Living.** Preparation instructions. This document does not authorize new ingestion. Check the linked release evidence before operating.

## Paste-ready message

You are preparing the next Law corpus cohort for NTER from the shared legal pack. Aim for up to 1,000 eligible NEW documents within the supported IBBI_NCLT collection; this is a preparation target, not permission to ingest. Report legal-record, immutable-document and chunk counts separately. If fewer eligible records exist, report the real count. Do not relax checks or mix other forums to fill a quota.

Repository: https://github.com/ddllabs/niyantran. Fetch current main and create your own `task/client-law-next-1000-<agent>-<date>` branch. Inspect pwd, branch, status and remotes before working. Never push to main, force-push, reset/stash another worker's changes, or modify a different agent's branch. Follow AGENTS.md: task agents leave scoped edits for supervisor review; commits, PRs and pushes require the applicable owner/supervisor authority. An ingestion run normally needs no code changes.

Read these documents in order:

1. `AGENTS.md`, `docs/agents/onboarding.md`, `docs/agents/coordination.md`.
2. `docs/plans/open-work.md` and `docs/operations/law-listing-release.md` for actual release/acceptance state.
3. `docs/specs/2026-10-24-law-listing-publication.md`, its implementation plan, and `docs/specs/2026-10-23-supplied-text-bulk-orchestration.md` for boundaries.
4. `docs/operations/law-listing-client-guide.md`, `docs/operations/law-listing-backend-contract.md`, `docs/operations/supplied-text-import.md`, and `docs/operations/law-cohort-screen-review-fix.md`.
5. `docs/Architectures/01-ingestion-pipeline.md`, `docs/specs/2026-09-30-rag-v2-chunk-contract.md`, `docs/specs/2026-10-01-rag-v2-ingestion-v2.md`, and `docs/operations/corpus-jobs.md`.
6. Historical decisions/evidence in `docs/operations/law-five-release/` and `docs/operations/law-cohort-2-release/`; current release receipts are authoritative for their listing mappings.

Use the existing scripts and chunker:

- `scripts/law-cohort-screen.py`: schema 3 screen/finalize, including semantic JSON identity comparison and complete conflict scanning.
- `scripts/corpus-text-import.mjs`: existing OCR adapter, exact chunking dry run, read-only live reconciliation, bounded registration and publication-status receipts.
- `scripts/law-listing-reconcile.mjs`: metadata-only plan/publish/verify for documents already registered. It does not ingest or embed.
- `scripts/law-client-api.mjs`: shared authenticated transport. Use short-lived platform-admin credentials and a publishable key; never a service-role key. Keep credentials out of chat, Git and reports.

Mapping rules: match verified source associations or exact official order URLs, then verify forum, type, case number and date. Company titles and PDF basenames are not identities. Keep an IBBI announcement separate from an NCLT order even if the company name matches. New eligible orders absent from the register get canonical listings; existing indexed documents get metadata-only links. Revisions, translations, ambiguous aliases, unsupported forums, policy failures and stale mappings remain held. Never mutate original document metadata or completed manifests to force a match.

Known release acceptance findings: F247 tracks incorrect attribution of party submissions as tribunal findings in a Globiz answer; F248 tracks the legacy record panel ignoring structured case_number. Do not claim these passed or repair them by re-ingestion. The ten documents are already published and remain excluded from the next cohort.

For preparation now:

- Inventory/pin the archive, member and policy hashes from reviewed evidence. Note that the shared ZIP filename says v1.1 while its internal root says v1.2; verify bytes rather than assuming those labels match. Use fresh private staging outside Git.
- Screen bounded windows with schema 3 and the complete subtree conflict scan. Exclude both historical decision sets, but also reconcile against current database inventory; local exclusions alone do not prove absence. Retain held reasons and source locators. Do not use `--no-scan-subtree` for a finalizable cohort.
- Prepare candidate and unsigned decision proposals. Do not invent Vighnesh's approval, reuse an old decision ID, or run finalize on an unapproved cohort. Current importer dry-run/live-reconciliation modes require a finalized eligible decision manifest; do not bypass that requirement. If no new owner eligibility decision exists, return screening/inventory evidence first and clearly label chunk/spend/mapping values that are still unverified. Estimates, if prepared, must use the existing chunker, not a second implementation.
- Return a cohort report: exact candidate keys and evidence hashes, already-present exclusions, held reasons, proposed collection boundary, document/record counts, preparation checkpoints, and the checks needed to authorize a bounded run. Ask for one concrete cohort authorization rather than per-document approvals. No register_text, embeddings, publication writes, schema changes or deployment in this preparation stage.

After a future explicit owner authorization covers the exact cohort, decision ID/approver and resource limits:

- Finalize the approved keys only, run the importer offline, then `--reconcile` against `https://vfgcppstyzjarlzyqdac.supabase.co`. Recheck exact chunk totals, conservative spend and live mappings. If evidence changed, bounds are exceeded or new holds appear, stop that scope and report it.
- Submit only within that authorization using `--submit --approval <exact-decision-manifest-sha256> --max-chunks <approved-count> --max-estimated-cost-usd <approved-ceiling>`. A 1,000-document cohort is not 1,000 concurrent jobs. Preserve current worker concurrency/retries and per-document limits; split into reviewed submanifests if needed. The cost option is a client admission estimate, not a provider-enforced hard cap.
- Save intent/result checkpoints and both ingestion and publication receipts. After a lost acknowledgement, inspect remote status before replay. Already-registered documents must not be resubmitted to repair listings. Use the metadata-only script for pending publication after fresh reconciliation.
- Completion requires confirmed indexing AND publication: exact document/chunk counts, vectors, source/citation offsets, canonical listing identity, module/global search, correct selected-record attachment, realistic natural-language retrieval and website citations. Vector self-lookup alone is insufficient. Sample reruns must create no duplicate jobs/chunks/records or embedding cost.
- Report successes, held/pending/uncertain outcomes, actual costs, verification limits and before/after deltas. Do not expand into another cohort, another collection, or all remaining corpus without a new bounded authorization.

The earlier scanner mistake was comparing raw JSON bytes before decoding identities, skipping malformed rows and trusting declared hashes. Those could hide a competing revision. The schema 3 fix fails closed and has causal regression tests. This does not establish that the completed ten documents were wrong, and it does not authorize re-ingesting them.
