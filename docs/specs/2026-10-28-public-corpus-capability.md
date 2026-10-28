# F264: Public corpus capability and administrative readiness

> **Status: Normative.** Owner approved implementation and production release 2026-10-28. Ingestion and larger batches remain unauthorized.

## Approved capability map

| Module | Responsibility | Dependency |
|---|---|---|
| resolution-policy | Caller-visible ready IDs, verified metadata, explicit unknown, web policy | Existing Bill/Law/ordinary resolver |
| public-capability | Only Full text / Record only across record surfaces | Resolution semantics |
| admin-readiness | Bounded read-only detailed diagnostics | Existing associations and admin auth |
| client-handoff | Reconciliation and admission guidance | All three verified modules |

## Contract

Full text requires current successful caller-visible complete indexed coverage. Record only describes available record fields, never proves OCR absence or verified database identity. Pending may use a neutral loading indicator; no third technical public badge. Partial sources retain ready IDs and citations. Missing/error/snapshot states must not invent server-citable rows, absence, or automatic widening. Internal states are preserved for diagnostics. Public title/ARIA/tooltips must not leak technical status vocabulary; ordinary unrelated business statuses remain intact.

Server re-resolves each turn under caller access. A single resolution result supplies ready IDs and policy evidence where possible; avoid duplicate RPC and new LLM calls. Explicit web-off remains binding. Verified metadata-only records permit topic-grounded automatic web. Partial ready text is retained and supplementation is independently disclosed; unknown identity/access failure never grants automatic scope expansion. Direct documents are not assumed readable. Existing Bill/Law adapters, citations, F260 completion guard and scope constraints remain.

Public caches isolate caller/session, invalidate stale/error readiness and reject late responses. Listings resolve only bounded visible records, deduplicate in-flight work, never per-row polling or whole-corpus scans. All selectable real-record surfaces get consistent treatment; modules, aggregates, uploads and placeholders do not pretend to be database records.

Admin reuses Documents with read-only readiness records/documents, stable bounded pagination (default50 max100), exact desk/cohort/ID filters, no whole-corpus counts by default. Preserve legacy Bill management separately; never treat null legacy keys as absence of Law/ordinary links. Privileged diagnostics do not assert ordinary-user visibility. No new repair or ingestion mutations.

Client continues using existing ingestion engine and immutable manifests. Readiness inspection is not approval; separate screened/registered/indexed/mapped/published/retrieval-verified/accepted evidence. Unsupported adapters and ambiguity hold. No automatic repair, re-OCR, embedding replacement or batch resume. Recommend separately approved100 before1000.

## Acceptance

Causal UI/policy tests cover every internal state, refreshed/saved/mixed pins, caller change, errors and revoked direct IDs; preserve ready partial IDs, explicit overrides, exact scope and citation provenance. Cross-desk public labels, no technical status in visible/accessible markup; admin details/authorization/pagination. Request-count and local timing comparison without extra model calls. SQL tests only disposable DB. Full Vitest/Deno, lint/build/router import, relevant SQL fixtures and script tests, local browser acceptance. No hosted preview tests that write production. Remote provider timing/live NTER acceptance deferred to authorized release review.

## Exclusions

Ingestion/mapping repairs, auth redesign, billing/provider/chunker changes, F262/F263 fixes, global capacity claims.
