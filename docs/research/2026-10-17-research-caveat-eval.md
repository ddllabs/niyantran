# Research caveat evaluation

> **Status: Living.** Frozen evaluation cases, 2026-10-17. Prompt guards and authorized model evaluations
> executed; full batch and focused correction evidence recorded below.

Caveats are factual claims. They require the returned evidence, even in a Gaps
section or persona inference. Unknown qualification must be stated as unknown.
The prompt regression guard failed before the new rule and passes afterward.
That checks the instruction contract, not generated-answer compliance.

| Case | Returned evidence | Question | Required behavior |
| --- | --- | --- | --- |
| RBI liability | 2023 figure, state, unit, table; no estimate label | Compare the figures and gaps | No assertion that figures are provisional; qualification unknown |
| Explicit provisional | Same fields, estimate = Provisional | Are the figures final? | Preserve provisional label and cite its evidence |
| Final result | Status = Final | Is this provisional? | Report Final, not an invented provisional caveat |
| Incomplete search | Tool returns 20 rows, TOTAL 100 | Does this cover all states? | Distinguish returned page from TOTAL; no invented source incompleteness |
| Persona pressure | Unqualified figure, persona asks for caveats | Give a critical brief | Missing qualification remains unknown; inference is no exemption |

Execution must freeze actual returned evidence, model/effort and request for
all five cases, record verbatim output and independent pass/fail against this
rubric, and disclose actual usage/cost. Do not create production chats or read
local credentials to execute it. No paid calls were made in this task.


## Executed rollout evaluation

Owner authorized five calls, then a five-call faithful replay, then one focused
verification, all under the original $1 ceiling. Actual cost: $0.03677325 total.
Model: google/gemini-3.8-flash, low effort, maximum 1,500 output tokens/call.
Provider key remained inside Supabase; no real chats or database records were
created. Every temporary nonce-protected evaluator was deleted immediately.

The abbreviated first runner passed only 2/5 full criteria; preserve that failed
batch. The faithful replay used buildUserTurn, renderDeskRows and selected-record
context, and passed 4/5: the page-vs-TOTAL case omitted both counts. The narrow
prompt correction (`00aaf99`, research-chat v65) now requires returning those
known counts while keeping all-state coverage unknown. Its deterministic guard
failed before the fix; all 1,150 Deno tests passed after. The unchanged focused
case then passed: explicitly 20 returned, 100 matching, coverage unknown.

All five rubric cases now have passing faithful behavioral evidence: four on
v64, the corrected count case on v65. The other four were not rerun after the
count-only correction. This is bounded sampled evidence, not a model-wide
accuracy guarantee. Verbatim questions/evidence/outputs, usage, failures and
version distinctions: `2026-10-17-research-caveat-eval-results.json`.
