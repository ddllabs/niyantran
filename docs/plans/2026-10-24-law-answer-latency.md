# F250 latency implementation

> **Status: Living.** Sequential implementation; independent read-only review permitted under repository review workflow.

1. Confirm v88 baseline and per-attempt bottleneck from existing logs. Read the latency spec and current answer path.
2. Routing experiments failed. Implement the refined discarded-draft optimization below with causal agent/handler tests. Preserve the evidence-first review; the post-v89 narrow validation correction is recorded below.
3. Compare bounded provider timing and source-reviewed quality. Preserve all failed runs. No model/reasoning/guard changes to force a speed pass.
4. Run full app/Edge, lint/build and independent review. Publish isolated task branch, merge only after required checks, deploy exact merged payload after main CI.
5. NTER four-case acceptance, citation checks and read-only corpus preservation. Update open-work and handoff, retain broader semantic qualification separately if not covered by this task.

Baseline: v88 live70/161/81/66 seconds,53.4/70.6/75.2/52.2 credits. Local accepted review-only35.270/114.736/23.770/63.904 seconds,8calls,USD0.013125858. These are historical samples, not a controlled same-time comparison or production SLA.

## Experiments (2026-10-24; not released)

- Latency sorting: 89.075/45.119/58.242/120.118 seconds; fourth case timed out. Eight calls, USD0.0124668514 known cost; final interrupted call has unknown cost. Fails reliability/performance acceptance.
- Throughput sorting: first case79.376 seconds; follow-up timed out at120.007 seconds. Fails acceptance; do not publish routing alone as a fix.
- Next local-only experiment: synthesize against all retained original paragraph units in one call, preserving selected model/reasoning and server validators. This tests whether serial selection is avoidable; it is not an accepted runtime design. Source review and timing must pass before changing the runtime spec or implementation. Private experiment lives in /tmp and is not production code.

## Refined candidate

Skip only the discarded draft for a single attached Law document after both successful scoped nonempty searches. Keep selector and synthesis unchanged. Exact implementation/test scope expands to agent.ts, agent_test.ts, handler.ts and handler_test.ts. Add an internal evidence-ready finish which the handler accepts only into mandatory Law review, never directly as a completed response. Preserve broad/multi-document/web/empty/failure paths, attempt accounting, cancellation and source retention. One fewer model call is the deterministic saving; provider variance still requires NTER measurement.

Direct synthesis was rejected: follow-up blended unsupported clauses under the wrong paragraph citations; false-premise case timed out after a party-source guard rejection. Internal-quotation direct synthesis also timed out after a support-quote rejection. Neither changes the runtime.

Causal evidence for refined candidate: agent test failed137pass/1fail before guard; handler tests failed170pass/2fail before wiring. Review found initial-provider failover bypass; outage tests failed172pass/2fail before adding the narrowly bounded existing-chain fallback. Focused tests then passed. Full Edge/app/build/lint and independent review required before publication; live measurements pending.

PR35 merged as258c7ad6 after required PR and main CI; research-chat v89 deployed with exact42-file source match. Live original turn used two answer calls (draft skipped),107s total, dominated by94.457s selection. This is not a hint-detection failure. Follow-up completed14s; remaining live acceptance pending.

Additional coverage found document chips without a desk hint did not enable eligibility despite actual Law evidence. Four absent-hint regressions failed before the one-line correction. Eligibility now uses attached scope/no web, while the agent still verifies actual scoped Law chunks and the handler still requires mandatory Law review. Independent178-test handler review passed; full verification and CI required for this follow-up.

## Post-v89 acceptance correction

All four v89 website turns completed in107.384/14.431/21.700/19.038s (median20.369s), with two answer calls each. The first three passed independent source review. The fourth failed: disposition-only evidence did not establish “not because Globiz had not proved the debt.” Timing alone is not acceptance.

Added a narrow negative-merits-contrast check and specific feedback using the existing one correction. The regression failed without the guard. A second causal control failed with the initial blanket guard; refinement preserves the complete contrast when explicitly present in its own cited original. The check is lexical and cannot establish general entailment or catch all paraphrases. Correction may add latency or fail closed if the shared correction is spent. All four website cases must be repeated after release.

Private false-premise replay completed in30.112s, two calls,USD0.00100791936: separately stated operative no-cost order, debtor’s costs request and debtor’s debt-proof submission, with correct source paragraphs. It did not trigger correction, so causal fixtures—not this provider sample—prove the guard. No ingestion or database writes. No-hint verification:6,575 app tests,1,297 Edge tests, lint/build pass; initial guard full Edge1,298 pass; final supported-contrast refinement requires final focused/full checks below.

Final local checks:31 focused Law /1,299 full Edge pass; lint/build and diff checks pass. Independent reviewer found no blocker and confirmed the private false-premise source mapping. App6,575 passed on this branch before the isolated Edge guard refinement; CI reruns the complete suite. Remaining gates: PR/main CI, exact deployment and all four NTER cases.
