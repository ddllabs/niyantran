# F253 implementation plan

**Status: Living.** Implements the matching cache-policy spec. Sequential on task/ai-research-cache-policy.

1. Read shared frontend/handler/agent, Law review, briefs, serializer, web policy and tests.
2. Causal tests at handler provider boundary and briefs. Write scopes: research-chat/handler.ts and handler_test.ts; _shared/openrouterStream.ts and its tests; desk-brief/handler.ts and handler_test.ts/record_test.ts. Preserve request semantics and all policy gates.
3. Extract existing model-aware cache fields; enable at common chat boundary and brief transport. Add cross-desk regression matrix without changing web policy.
4. Focused/full checks per spec; independent read-only review permitted, no delegation beyond review. Record evidence and limitations in this plan and open-work. Local verified commit only; no production action in this task.

## Execution evidence — 2026-10-24

The original Law16-case matrix failed after cache/session assertions were added; the long-evidence serializer and brief-boundary tests also failed before implementation. Independent review found citation repair still bypassed the wrapper: its accepted/rejected/thrown repair regression failed before routing it through cachedStream. The final policy wrapper is separate from served-model observation to preserve answer attribution.

Independent reviewer:74 serializer/brief tests and196 handler tests pass, including10 cross-desk indexed/missing-record cases. Full Edge suite1333 passes; lint, production build, router import and diff check pass. Full application suite6575 tests across423 files passes. Existing mocked feed errors are test fixtures, not live incidents. No new paid calls or browser sessions; production cache-hit rate/cost/latency are not measured by these tests.

Read-only production aggregate:1110 Law and3456 National documents have indexed_at set; zero in either tier lack all non-null chunk vectors. This is existence verification, not complete per-document vector coverage or citation reconciliation. No indexed rows were returned for other tiers. All interactive chats use the same frontend send path/backend; separate desk/record briefs are not interactive RAG and have no web-search fallback. Their persistent stored-brief reuse remains unchanged.

Web policy is unchanged. Missing-record auto-on is not universal broad-chat auto-on. Failed lookups preserve privacy instead of assuming missing text. When a module has any indexed documents, desk-wide auto web remains off even if other entries in that module lack text; selecting/attaching one of those entries triggers its per-record decision. Explicit off, greetings and model support gates remain. Required web execution is further bounded to context questions with missing records and no attached indexed document, within the existing budget.

Shared-code risk is real: handler/agent/serializer affect multiple desks. Law-only source checking is conditional on Law context/evidence, so a cross-desk chat retrieving Law evidence can legitimately enter Law review. No evidence here establishes a wider regression from F247–F251; synthetic regression coverage and the read-only vector check are the verified scope, not an end-to-end acceptance run on every desk.

References inspected: OpenRouter prompt caching https://openrouter.ai/docs/guides/best-practices/prompt-caching and response caching https://openrouter.ai/docs/guides/features/response-caching. Supabase changelog Markdown fetch was unsupported by the web reader; no Supabase API/schema contract changed in this task.

Release boundary: local code/tests only, no push, PR, deploy, data mutation, ingestion or re-ingestion. F253 remains open until publication and production cache-usage acceptance. F252 provider-tail work is not closed by this configuration repair.
