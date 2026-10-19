# Production RAG recovery plan

> **Status: Living.** In progress, owner-authorized main release.

Spec: ../specs/2026-10-19-rag-production-recovery.md. Work tracked in open-work.
Main-based isolated task/rag-production-recovery checkout preserves billing.
Sequential implementation, no subagents.

1. Reproduce late saved-answer UI refresh failure in useResearchThread tests.
   Fix only src/ai/useResearchThread.js and its test, using existing owner fences.
2. Reproduce malformed provider envelope failure in handler_test.ts. Add one
   corrective answer attempt in handler.ts preserving retrieval checkpoint,
   total attempt/time budgets, strict validation and telemetry.
3. Run focused regressions, full npm/Deno suites, lint, build, bundle and router
   checks. SQL unchanged; no hosted data used as a test fixture. Review diff.
4. Commit scoped files, integrate on main without Razorpay commits, publish
   authorized main and deploy only research-chat Edge Function. Confirm deployed
   versions/source and Vercel commit. No ingestion/provider settings changes.
5. Reconcile historical ledger read-only, verify unauthenticated protection,
   guide owner Reload/recovery and signed-in live turn if authenticated browser
   access is unavailable. Distinguish deployment from behavioral acceptance.

## Local evidence

Late-answer and malformed-envelope tests each failed causally before fixes.
Immediate save/read race also failed before its guard. Focused controller/stream
236 tests pass; handler146 and full Deno1158 pass. Lint/build/bundle/router pass.
Initial full application run:6288 pass/4 fail, all unrelated aged publisher
fixtures. Isolated reproduction:9 pass/4 fail; pin Date only:13 pass. Full suite
re-run pending. Production function v67 files36 all exactly match origin/main.
Prepared Edge bundle replaces only functions/research-chat/handler.ts and retains
all other deployed source plus existing verify_jwt=false (handler authenticates).

Final local verification:401 application files/6292 tests pass;236 focused
controller/stream tests pass;146 handler and1158 full Deno tests pass. Lint,
build, bundle budget, router import and whitespace checks pass, no new warnings.
Publisher clock prerequisite committed separately as7a10c32; no runtime feeds
changed. Manual correctness/security review confirms no new provider call on
transport recovery, original owner/context fencing, one format correction only
before visible text, original retrieval/step/time budgets and cost telemetry.
No historical balance was refunded or rewritten. Main publication authorized;
production behavioral acceptance still requires owner conversation check.

## Production release — 2026-10-19

Verified runtime fix8f7241824d32e0d09c243395ae92b4d0cf470018, with separate
clock-test prerequisite7a10c32, fast-forwarded and pushed main. No Razorpay
commits integrated. Vercel Production dpl_3UwZucTaR2sA9sbYh97jjCKwBr3c READY,
exact8f72418 and Production target confirmed. Protection unchanged
all_except_custom_domains; both nter.pro and www.nter.pro billing config disabled.
Live credentials and Test billing environment were not edited.

Only research-chat deployed, v67 to v68. Retrieved all36 deployed files and
verified exact equality with prepared bundle (only handler.ts differs from v67).
Existing handler authentication retained; unauthenticated POST returns401
missing bearer token without starting model work. No corpus functions, timers,
model catalogue, schema, ledger, wallets or paid provider configuration changed.

CI39258763690: application job green, disposable SQL job running at final check.
No signed-in production query was issued: available Arc session is signed out.
Owner must verify the existing conversation via Reload and a new bounded normal
turn before claiming authenticated behavioral acceptance. Network closure cause
not conclusively established; completed answer persisted before investigation.
Historical charge corresponds to known completed provider work; no refund or
balance repair was performed. Payment testing remains paused.

Follow-up Arc check: signed-in Production terminal observed as vs with3304
credits; refreshed Global/Open Fronts and research controls load, history reports
17 chats. This is not evidence for the affected new-account conversation.
No new model request or payment submitted. Screenshot and AX overlay state
became inconsistent; automatic review rejected a coordinate click near possible
Delete controls. No bypass attempted; Escape safely dismissed history. Owner
should manually open the intended saved conversation before further automation.
Authenticated answer recovery acceptance remains pending. CI39258763690 now
fully green: application and disposable SQL jobs completed successfully.
