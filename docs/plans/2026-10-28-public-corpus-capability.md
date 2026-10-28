# F264 implementation and review plan

> **Status: Living.** Approved local implementation; see ../specs/2026-10-28-public-corpus-capability.md.

Baseline origin/main d9cc6a8e. Supervisor branch task/public-corpus-capabilities in corpus-record-contract. Task agents leave uncommitted scoped changes and evidence; no commits/push/deploy/network-provider calls. Supervisor owns docs and integration. Worktrees isolate concurrent scopes.

1. Terra xhigh: resolution-policy in corpus-capability-server. Own research-chat handler/index/webPolicy/types and focused tests only. Preserve RPC ABI; deduplicate request-local resolution, enforce unknown/access and partial semantics. Return causal test evidence and API shape to UI agent. No SQL/admin/client edits.
2. Sol high: public-capability in corpus-record-contract. Own corpusCoverage/WebSearchToggle/coverage hooks, AttachmentTray/AiPanel, record hosts/adapters, generic and bespoke record listings and their tests/styles. No admin/backend/docs edits. Work sequential small slices, shared display projection separate from ready evidence. Coordinate server semantics before final policy integration.
3. Sol medium: admin-readiness in corpus-readiness-admin. Own additive admin readiness migration/fixture, admin-ingest actions/tests, corpusUpload client/tests, Documents/readiness components/tests; optional bounded read-only export script/tests. Do not edit research-chat/public UI or docs. No destructive legacy actions for ordinary records.
4. Supervisor review: inspect each diff, rerun causal focused checks; cross-review server/public against contract, admin permissions/query bounds. Integrate scoped diffs, resolve interfaces before tests. Returned defects go back to their owner.
5. Supervisor docs/client: update supplied-text-import, corpus jobs, client handoff and readiness contract/examples; only adjust client code where actual released-contract consumption needs changes, never rewrite ingestion.
6. Integrated verification: npm test; deno test -A --config supabase/functions/deno.json supabase/functions; npm run lint; npm run build; node -e "import('./api/router.js').then(() => console.log('router import ok'))"; npm run test:sql on disposable containers; relevant script tests; git diff --check. Local mocked browser across desks; no paid/production calls. Capture test counts, timing/request counts, limitations. Independent review before any local commit.
7. Review handoff: exact changed scopes, tests, screenshots, risks and production migration/function/frontend order. Production and all batches remain held.

## Evidence

Local implementation and verification complete; awaiting owner review. Supervisor server-focused rerun:334 tests pass; first integrated Deno suite1459 passes. No hosted/provider calls. Local resolver benchmark:10warmups/100samples per case, interleaved equal3ms mocked RPC delay; full/partial/metadata requests2→1, direct1→1, mixed3→1. p50 about9.1–9.4ms→4.6–4.7ms for reduced paths; direct unchanged. This is mocked local scheduling evidence, not database/RAG/provider latency. Independent local Chrome harness uses actual shared capability/AttachmentTray components with five desk identities and eight internal states, external requests blocked; labels correct and no page errors. Final integrated validation is recorded below.


Final integrated review receipt: [local evidence](../operations/2026-10-28-f264-local-review.md). Final application6,701pass; Edge1,462pass; SQL62fixtures +62causal omissions pass; client38pass. Cross-group concurrency, transport cancellation and superseding-reader guards pass97 focused checks and independent review; final full rerun passed. Test-only brief mock stabilization was causally verified without runtime changes. No production publication or ingestion.

## Authorized release

Owner authorized push, PR, merge after both required CI jobs, deployment and authenticated cross-desk acceptance on2026-10-28. Release order: additive read-only SQL migration, admin-ingest/research-chat functions, then merged main frontend after CI. Verify existing table size and lock bounds before migration. Rollback: restore previous functions/frontend; additive diagnostic objects can remain unused. No ingestion or mapping repairs. Record exact release commits, versions and browser evidence in a release receipt.
