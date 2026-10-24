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

## Live quoted-precedent regression

The v85 original-question answer incorrectly converted a Supreme Court quote about IRP admission of a claim in a first CIRP into a finding about Globiz's claimed debt. Citation78 began inside that quote; paragraph7.32 in75 identifies its source. V85 failed acceptance and was rolled back to v84's exact payload as deploymentv86. Add original preceding decimal-paragraph openings as literal contextual text, and a bounded set of their original chunks as citable evidence. Preserve all chunks/hashes and caller authorization; never classify speaker from numbering. Restrict opening context to the initial fragment before a new paragraph. Extend causal and real-provider evaluations to this precedent/current-case distinction.

Read-time evidence-unit correction: repeated provider tests still promoted the quoted first-CIRP tail in chunk79 into a current-case finding. Storage chunks are therefore not selectable propositions. `research-chat/lawPassages.ts` splits available original spans at decimal paragraph boundaries, groups continuations with their original paragraph opening, and keeps final-order paragraphs separate from preceding quotations. A group retains all original citation handles, marks missing span gaps, and is omitted if its opening is unavailable or its source/size bounds are exceeded. No speaker classification or corpus rewrite. Acceptance requires selecting disposition without exposing the preceding quote, selecting a quoted continuation only with its named introduction, and real-provider/live verification. This narrows a demonstrated ambiguity; it is not a universal semantic guarantee.

Each synthesized sentence cites one paragraph unit; separate paragraphs require separate sentences. Server rendering may supply several original chunk citations for that one unit. Matching original numbered headings are literal context, not universal proof of speaker. A narrow explicit-party-heading/tribunal-finding guard triggers the existing one-correction path. Structured documents omit unknown initial fragments, inconsistent overlaps and unavailable paragraph openings. Paired curly quotation boundaries within a supplied span are preserved; arbitrary nested/cross-gap quotation syntax and unnumbered orders are not universally parsed. Runtime acceptance remains source-reviewed, not inferred from syntactic success.


## Evidence retention under High reasoning

The draft reply budget must not become the final Law synthesis evidence budget. Retain only already-authorized Law search results, bounded to256 chunks and300,000 rendered characters per turn. The final paragraph selector retains its existing80,000-character bound; all model attempts, deadlines and citation handles remain unchanged. Retained-only Law evidence and draft-visible Law evidence both activate review, including mixed-desk searches. Non-Law draft reply behavior remains unchanged. Prove a late retrieved scope passage reaches final synthesis under the actual High draft cap and resolves to its original chunk citation.
