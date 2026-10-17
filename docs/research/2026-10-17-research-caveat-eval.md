# Research caveat evaluation

> **Status: Living.** Frozen evaluation cases, 2026-10-17. Prompt guards verified
> locally; model behavioral execution is pending an authorized budget/environment.

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
