# D3: paid live round on production

> **Status: Historical (dated 2026-10-15).** The owner signed in to production in the app's browser;
> the supervisor ran the checks there and read the results back with read-only SQL. Spend: 137 credits
> (629 → 492) on the owner's account.

| # | Check | Result |
|---|---|---|
| 1 | Greeting (Gemini Flash, Low) | Answered. A plain greeting got a full brief (Snapshot, Context, Gaps, Confidence) opening with "Search widened." |
| 2 | Bill count on the Bill Passage desk | **Wrong.** "How many bills were introduced in the Lok Sabha in 2026, how many assented?" answered 0 and 0 with "Strong" confidence; the register holds 23 and 11. The model called `search_desk_rows` with filters `{"year":"2026","house":"Lok Sabha"}`; rows have no `year` field (the year is in `date_introduced`) and the filter is exact JSON containment (`row @> filters`), so it matched nothing and the model reported zero as fact. |
| 3 | Document question (Espionage Control Bill, 2025) with a highlighted span | Passed. Clauses cited; the passage opens in the page viewer at "Cited p. 1" highlighted on the PDF. Once, clicking source 3 in the list reloaded the desk, collapsed the panel and showed the desk tour again (not reproduced on the next click). |
| 4 | Stop, then reload | Passed. "Cancelled · 4.23 credits"; the conversation came back after a page reload. |
| 5a | Gemini Lite, Medium | Passed: 4 searches, 6 citations, 11 s, 14.8 credits. |
| 5b | Changing model or reasoning mid-conversation | **Defect.** After choosing Gemini Flash · High the Lite answer disappeared from the thread (it is saved: `chat_messages` complete) and the next send failed with "Your research session changed"; Reload restored it. |
| 5c | Gemini Flash, High, document question | **Defect.** The second model call was cut off at 108.7 s (`model_call_logs` status aborted) after reading 40 passages; the answer was saved as "interrupted" with no text; the page showed "Execution interrupted" after about two minutes. No credits were charged. |
| 5d | GPT | Not run: "GPT – Astra" is shown as "Paid plans" for the owner's admin account (per-model `min_plan`); a model also appears under its raw id "gpt-luna-latest". |
| 6 | Cross-account denial | Passed. As the owner's account in production (`set local role authenticated`, rolled back): 9 own conversations, 0 other users' conversations, 0 other users' messages; other profiles visible only because the account is a platform admin (by design). |
| — | Escape with the model menu open | Closes the whole side panel instead of only the menu. |
