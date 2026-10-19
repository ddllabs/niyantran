# Production research delivery and structured-answer recovery

> **Status: Living.** Owner authorized investigation, repair, main publication and production verification on 2026-10-19. Razorpay paused and isolated.

Evidence: one new account's turn completed and saved 3,191 characters after
78.456 seconds; its SSE connection failed before completion. Recorded charge
880.688 credits corresponds to completed provider work. No balance adjustment
is justified by a transport failure alone. A separate DeepSeek turn produced
no parseable structured answer and was declined. No provider HTTP error or
insufficient-balance error is evidenced in the recent model logs.

Problem: automatic saved-answer rechecks retire the stream lock when a terminal
row appears, but never refresh the displayed conversation. The first load can
therefore remain a running placeholder. Terminal output lacking its required
JSON envelope gets no bounded corrective attempt even when no text was shown.

Outcome: after verifying the original terminal answer, reload authoritative
conversation state under existing identity/context fences. Permit one explicit
structured-answer correction when stop output has no envelope and no visible
answer; reuse retrieval checkpoint and global budgets. Never accept unvalidated
raw prose, rerun retrieval, change a displayed model mid-answer or retry forever.

Scope: useResearchThread controller/tests; research-chat handler/tests. No SQL,
credit settlement changes, balance mutations, model catalogue changes, payment
code/secrets, corpus ingestion or timers. The exact network disconnect cause is
unknown; do not claim a platform timeout caused it. Existing owner Reload can
recover the historical saved answer without another provider execution.

Acceptance: causal tests prove late saved answer reaches rendered controller
store, no second send/charge and account-change/dispose fencing. Invalid output
gets at most one correction; repeated invalid output remains error; visible
partial output never restarts; telemetry retains rejected attempt and costs.

Verification prerequisite discovered: four unrelated publisher assertions in
lawWireFeed.test.js and wtoFallbackFeed.test.js use12 October fixtures against
the real clock. Reproduced in isolation without importing changed RAG code.
Pin only Date in those tests to12 October; retain all publisher assertions and
real fetch/timer behavior. No production feed code changes.
