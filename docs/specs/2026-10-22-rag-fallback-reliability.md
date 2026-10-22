# RAG fallback reliability

> **Status: Living.** Owner-authorized repair, 2026-10-22.

## Current state and problem
Production logs show Gemini 429/500 failures followed by successful Haiku fallback; the UI presents a model label without clearly explaining the switch. DeepSeek emitted partial output before the application 115-second execution cutoff. The database turn lease is 120 seconds. Telemetry races database work against 250 ms, reporting failure and losing returned IDs even when writes subsequently succeed.

## Outcome and acceptance
- Live and saved messages distinguish selected model from the fallback actually used, including multi-hop fallback. Interrupted output never claims an unrelated model served it.
- New chat claims receive a bounded 300-second lease, with five seconds reserved for persistence, provided the current paid runtime supports it. Existing earlier claims retain their boundaries. Cancellation, single finalization and the answer reserve remain intact.
- Post-answer telemetry has a realistic bounded budget, retains completed IDs, and cannot block delivery or duplicate writes. Costs and settlement policies are unchanged.
- Causal failing regressions precede fixes; focused and full required checks pass, followed by independent review, CI and runtime verification.

## Scope and exclusions
Chat frontend, research-chat handling/persistence/telemetry, narrowly scoped chat claim migration and regression tests. No billing code, financial functions, balances, invoices, pricing policies, provider keys or payment settings changes. Do not promise unlimited response duration or provider availability.
