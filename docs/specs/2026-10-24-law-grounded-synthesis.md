# Grounded Law synthesis

> **Status: Living.** Owner authorizes restoring proper answers, fixing follow-up failures, CI-gated merge/deploy and NTER acceptance. No ingestion.

## Current evidence and problem

F247 remains open. V84 renders only excerpts because the previous same-model yes/no audit approved unsupported paraphrases. Its follow-up fails closed on invalid response shape. A local real-provider replay additionally produced a valid-looking JSON answer with mismatched source/excerpt IDs, rejected as unknown_excerpt. The redundant source plus excerpt identifiers require the model to maintain a relation the server already knows; strict whole-answer rejection has no bounded repair. Retain these failures as evidence, not proof of every intermittent failure's cause.

## Outcome and boundaries

Restore concise synthesized answers with sentence-level citations derived from caller-authorized original text. Bind each sentence to one or more server-owned passage IDs; the server alone maps IDs to citations. The entire proposition must be supported, including speaker, dates, requested versus awarded costs, and any assertion that an issue was not decided. Permit multiple passages where one establishes attribution and another establishes the proposition. Source headings are qualified positional context, not a deterministic speaker classifier.

Use the actual serving model and the user-selected supported reasoning for both evidence selection and synthesis, preserve shared request time/attempt/usage limits, and provide one bounded correction for structurally invalid synthesis instead of rejecting the whole turn immediately. Invalid, unknown or ungrounded references must never be accepted by fuzzy matching. No automatic excerpt-only substitution. Provider and source evidence remain untrusted; no new authentication, billing, schema, model configuration, corpus or worker changes.

## Acceptance

A repeatable source-grounded evaluation includes original Globiz question, same-conversation debt/costs follow-up, notice-versus-commencement dates and adversarial false premises. Verify statements against original passages independently, including each citation's full claim support. Test actual provider locally before release and NTER after deployment. Causal regressions cover invalid-shape recovery, unknown/rebound IDs, multiple-source mapping, unavailable support, cancellation, budget limits and persistence. Full app/Edge suites, lint/build, independent review, required PR/main CI, deployment/auth checks and unchanged corpus fingerprint. Do not close F247 on mocked responses alone or on a single successful retry.

## Write scope

research-chat/lawAnswer.ts and tests; handler.ts and tests for bounded orchestration; a repeatable local evaluation script and synthetic fixture; this spec, implementation plan, open-work and final release/handoff records. Existing retrieval changes only if evaluation establishes a concrete missing-context defect. Remove superseded internal audit/render logic as part of replacing this path; preserve externally consumed response/citation interfaces.

## Resource tradeoff

Both Law evidence selection and synthesis permit up to8000 completion tokens (including provider reasoning), with at most one structural correction shared across them. This raises per-call potential usage versus the prior1000-token nonreasoning selector/4000-token synthesis draft. Existing total turn deadline, maximum attempts, cancellation, telemetry and billing remain authoritative. Actual evaluation proved4000-token High synthesis could end with length before any answer, and nonreasoning selection could omit decisive retrieved scope evidence. The live model-pricing catalogue on2026-10-24 lists DeepSeek V4 Flash's output capacity above8000; no model configuration change is made.
