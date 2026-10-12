# Existing-text context implementation

> **Status: Living.** Sequential implementation; no delegation.

[Spec](../specs/2026-10-09-text-section-context.md).

1. Add failing parser/chunker and handler regression tests in `supabase/functions/_shared/textContext_test.ts` and `supabase/functions/ingest-documents/handler_test.ts`. Confirm red on missing context behavior.
2. Implement `supabase/functions/_shared/textContext.ts`: conservative source-only boundaries, exact global spans, embedding inputs, context-aware identity. Integrate opt-in mode in `ingest-documents/handler.ts`; keep page/legacy versions stable. Verify focused Deno checks.
3. Audit cached 48 medium texts without network or DB writes. Prepare new version-aware manifests/runner verification if the evidence permits a concrete pilot; preserve historical drafts.
4. Review changes and execute full Deno/application suites, lint/build and local SQL fixtures. Record warnings and remaining release boundaries in research evidence and R7. Production activation is separate from verified local implementation.

## Local implementation evidence

Tasks 1–4 complete locally: [review and verification](../research/2026-10-09-text-section-context.md). 65 focused Deno checks, 59 focused Node checks, 874 full Deno checks, 2,465 application tests, lint/build and two non-vacuous local SQL fixtures pass. Actual 91-chunk handler output also passed a rollback-only local SQL storage/visibility probe with fake vectors. Final 48-source audit:10,689 chunks, zero word-interior cuts; six documents /518 chunks fit the bounded worker. Final pilot91 and follow-up427 proposals are frozen and unauthorized. Implementation remains uncommitted on the current task branch; activation, owner RAG acceptance and broader document execution remain in R7.

## Owner-authorized pilot release

Owner answered “go” after the exact deployment/pilot proposal. Authorization covers deploying only `ingest-documents` in NTER and one Immigration/Foreigners2025 source,91chunks,maxUSD0.015, with read-only identity/PDF/price/health checks and post-load statistics maintenance. Final authorized manifestSHA `b549c8dbed4b4acf1e4230ab38f8f797836e7d1246b36d42ce19797452f653f2` (`pilot-release.json` in the final artifact directory); proposals and five-document follow-up remain unchanged/unauthorized. Version18 deployment source saved as `rollback-ingest-documents-v18.json`. Only handler/chunking differ from that deployed source, plus new textContext module/config inclusion; unchanged dependencies were compared. Rollback redeploys the exact snapshot if function smoke checks fail. Partial ingestion holds for reconciliation; no automatic deletion or broader re-embedding. Release completed: version19 deployed and one91-chunk pilot indexed/verified at USD0.0002621. [Execution evidence](../research/2026-10-09-text-context-pilot-run.md). Owner chat/RAG acceptance remains pending; five-document follow-up remains unauthorized.

## Owner-accepted pilot and five-document follow-up

Owner confirmed “Perfect, it worked. Continue.” This accepts the pilot's live RAG experience and releases the prepared five-document /427-chunk follow-up (Sports2025, Biodiversity2021, SC/ST2013, Advance Rulings2007, Industrial Finance1985), maximumUSD0.08, unchanged supervised guards. Authorized `follow-up-release.json` SHA256 `cd46909accc77cc72da14e7487efc01dd984ea29e4b2e28dab2fee0ff670a88e`. Original drafts remain immutable.

Sequential execution: refresh bound health baseline and all PDF/listing/text checks; run no-write endpoint checks; execute only this five-source manifest; verify each stored vector/hash/span/context and real scoped retrieval/citations; ANALYZE and compare counts/planner state; record report and R7. Write scope: local release artifacts and this plan, living operations/implementation report, R7, new execution report. No code, schema, deployment, held-source repair, larger-document worker, service, broad re-embedding, merge or push is authorized by this stage. Any failure holds with evidence; do not remove checkpoints or retry paid writes blindly.

Five-document follow-up completed and independently verified:427 chunks,USD0.00133476, no retries or health pauses. [Execution report](../research/2026-10-09-text-context-follow-up-run.md). Owner pilot accepted; bounded six-document cohort complete. Larger-document execution and hold review remain in R7.
