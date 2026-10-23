# National corpus continuation

> **Status: Living.** Owner authorized resuming National ingestion on 2026-10-23 IST, targeting cohorts of 1,000 bill identities. Law awaits a separate delivery.

Current baseline, read-only SQL at 2026-10-23 00:39 IST: 3,379 documents, 3,376 indexed, 99,225 chunks; 2,134 of 9,415 current bill identities covered. The 7,281 uncovered identities are not all ready or necessarily represented by usable local text. No fresh release-ready inventory existed at resumption.

Use the existing operator contract in `docs/operations/corpus-jobs.md`. Target 1,000 distinct bills per review cohort, with all associated candidate documents accounted for separately. Execute accepted sources in sequential stages of at most 500 documents, 20,000 chunks and 10 million characters. Keep existing per-document bounds, two-second write gap, independent maintenance audits, live capacity/retrieval gates and exact manifest hashes. This is not authorization for 1,000 simultaneous writers or relaxed quality checks.

Accept only absent sources after original/pack/PDF identity, full text/layout/context, both current listing features and actual Download proof. Preserve prior hold evidence; classify unreviewed separately from failed. Keep source versions and roles distinct. Existing-source changes, Law, nonbill ingestion, paid OCR, deployment/schema/compute changes, publication and edits to original data collections are excluded.

Use a new runtime directory and frozen manifests. Never restart completed releases. Record source-level decisions and exact bill/document/chunk deltas. Before paid writes confirm current price, manifest budget, endpoint dry run, fresh baseline, metrics and writer exclusivity. Independent cumulative audits and planner count checks are required before each maintenance acknowledgement and final completion.

Acceptance: eligible subset ingested with verified vectors/spans/context/provenance, correct current bill scope and real scoped citations; unchanged existing documents; reconciled usage and counts; held and pending documents reported without implying completion. If fewer than 1,000 identities pass, report the actual accepted count and remaining reasons rather than filling with held sources.
