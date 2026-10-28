# F264 local implementation review

> **Status: Living.** 2026-10-28. Local review only; not deployed. Production, mapping repairs and ingestion remain held.

## Implementation

Baseline d9cc6a8e; supervisor branch task/public-corpus-capabilities. Sol High owns public UI, Terra Extra High owns server resolution and cross-review, Sol Medium owns admin diagnostics/export. Supervisor reviews, integrates and independently verifies. Implementation and local verification are complete; all changes remain local and uncommitted for owner review. Client corpus branch untouched.

Public record availability uses only Full text / Record only. Fresh caller-isolated evidence determines Full text. Internal detailed states and ready partial IDs remain separate. A shared viewport-aware scheduler batches24 keys/request, at most2 active coverage resolver RPCs per client across overlapping lookup groups, coalesces common consumers and rejects late responses after caller change. Real record listing/selected/chat paths use one public component; module discovery, business/freshness statuses, simulations/aggregates, uploads and unsupported placeholders remain distinct from corpus capability.

Server reuses caller-visible resolution for retrieval and web policy. Partial ready documents remain searchable/citeable; unverified/inaccessible identity is unknown rather than absence. Explicit web/privacy/model restrictions and attachment/desk boundaries remain. No new LLM call, provider configuration, embedding or chunking change.

Admin Documents adds bounded read-only readiness records/documents. A caller-authenticated, independently admin-checked RPC exposes detailed diagnostic dimensions, not ordinary-user access claims. Page-wide inspection cap100 distinct documents with shared-answer reuse;24 links/record and1001 chunk probes/document. Inspection-limit states are unknown, never false readiness. New indexes/migration are unapplied and need release-time load/locking review. Existing Bill mutations remain isolated.

Readiness export uses private exclusive JSONL files, bounded responses, required nested metadata shapes, cursor/segment validation and unknown-stop behavior. It is not an ingestion executor, approved repair manifest, complete alias inventory or deployment attestation. Existing import/chunking clients remain unchanged. See [contract and command](corpus-readiness.md) and [client handoff](2026-10-28-corpus-client-handoff.md).

## Independent review corrections

- Duplicate caller lookups replaced by one resolution result; adapter errors retain successful other evidence and leave affected keys unknown.
- Account changes before first observer, expired/error coverage, inflight overlap and placeholder-to-record viewport lifecycle guarded causally.
- Shared RPC gate causally prevents cross-group bursts, aborts stalled transports after15 seconds and on caller changes, and lets direct readers use a completed newer refresh immediately. Independent review cleared these guards;97 affected tests pass.
- Test-only brief lookup spy stabilized after an order-dependent mock binding failure: same25-file order318tests passed; reverting the correction restored14 failures. No brief runtime or assertions changed.
- Chat usable-item counts include partial ready text and exclude stale/revoked direct attachments.
- Admin expected-link-count mismatch held, late filter results invalidated, catalogue placeholders excluded.
- Export valid terminal pages accepted; empty advancing/misaligned cursors and broken resume chains rejected; oversized or unexpected OCR fields and missing readiness fields refused.
- First full application run found only2 generated stylesheet assertions failing; generated terminalStyles updated and focused checks pass. Full rerun passed 6,692 tests in442 files.

## Executed local evidence

- Supervisor server-focused Deno 334 pass; final integrated Edge 1,462 pass.
- Supervisor client scripts 38 pass: readiness export 12, existing import/reconciliation/mapping 26.
- Lint/build pass; router import pass; diff check clean at inspection.
- Initial final application attempt:441 files,6685 pass/2 stylesheet failures; corrected as above. Final application rerun passed 6,701/6,701 in 442 files (172.78s), after the final cancellation/supersession guards and test-only mock stabilization. The intervening run reproduced14 order-dependent brief-fixture failures; same-order causal correction is recorded above. All 62 disposable SQL fixtures and 62 migration-removal non-vacuity checks passed.
- Chrome isolated profile, all nonlocalhost requests blocked: actual shared capability and AttachmentTray across Parliamentary/Bill/Law/Economics/State identities, eight internal states; actual Parliamentary adapter/RecordPanel, MP cards and admin read-only records/documents. Correct labels, admin details retained, no browser page errors. Synthetic responses, not production acceptance. Final replay passed with no page errors.
- Local mocked resolver microbenchmark:10 warmups +100 interleaved samples/case, equal3ms per mocked RPC. Full/partial/metadata request counts2→1, mixed3→1, direct1→1. p50 about9.1–9.4ms→4.6–4.7ms for reduced paths; direct unchanged. This measures scheduling/request overhead only, not actual database/RAG/provider latency.

## Review boundaries

No push, PR, merge, deployment, hosted SQL mutation, mapping repair, queue resume, OCR or embedding operation. No production or paid provider questions. Local tests cannot prove live model latency or deployed RLS/function/frontend coordination. Release acceptance must verify matching migration/functions/frontend, authenticated user/admin separation, full/partial/metadata-only questions, scope traces and citations. F262/F263 remain separate open work; no unrelated fixture or History fixes. No100/1000 batch admission implied.
