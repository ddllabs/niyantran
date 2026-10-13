# Web search: local browser run (F130)

> **Status: Historical (dated 2026-10-13).** This is the browser evidence for
> `docs/specs/2026-10-13-web-search.md` (acceptance item 8), gathered on
> `task/web-search` after the review and security fixes.
>
> **Setup:** local only; nothing touched NTER except read-only copies of two
> `model_pricing` rows and the `ai_models` list.
> - **Stack:** a scratch copy of `supabase/` with project id
>   `niyantran-web-search-local`. It had the auth schema first and migration
>   0007 cut before its NTER cron job; all 46 migrations applied, including
>   `20261013140000_web_search`. Started with the minimal service set.
> - **Function:** `research-chat`, served with a mode-600 env file (the
>   OpenRouter key and the local origin), deleted afterwards.
> - **Models:** Gemini 3.8 Flash (default) and DeepSeek V4 Flash only.
> - **App:** Vite on :5176 for the worktree, pointed at the local stack.
> - **Account:** one local test account with a generated password, kept in
>   a mode-600 scratch file and deleted afterwards, along with the stack's
>   data (`supabase stop --no-backup`).
> - **Data:** the local stack has no desk rows and no passages, so answers
>   could not cite the record. One indexed document row was inserted for
>   `bill:2026:156` so a bill would count as having embeddings.
>
> **Cost:** $0.107 over four turns. Total spend for F130 so far is $0.31 of
> the approved $1.00: $0.207 for the probes and $0.107 here.

## Case 1: a record with no indexed document (automatic)

National › MP Profiles & Performance › MP report cards, with the card for
Raja A (DMK, Nilgiris) selected. Gemini Flash at Low.

| Check | Result |
| --- | --- |
| Globe before sending | Lit. Accessible name: "Web search on (automatic): this record has no indexed document". |
| Streaming | The answer streams with web context named in the prose ("According to web reporting from Frontline and India Today…"). No link is clickable while it streams. |
| Under the answer | "From the web · unofficial · prsindia.org, tracksansad.com, frontline.thehindu.com · 5 sources". |
| Inline links | 8 anchors. Every one points to a page searched this turn and carries the globe mark (`ai-web-link`). No other link was rendered. |
| Sources panel | "Web sources searched", with the unofficial note and 5 pages; 4 are marked "Cited in the answer". Each is an external link. |
| `model_call_logs` | 3 `chat_answer` calls and 2 embeddings. One call has `web_search_count` 1 and `web_search_cost_usd` 0.007, out of a total of $0.0220. |
| `chat_turn_traces` | 2 `search_documents` steps (0 passages), 1 `web_search` step (5 pages, linked to its call) and the answer. |
| `chat_messages` | `web_sources` holds 5 entries. Usage has `web_searches` 1, `web_search_cost_usd` 0.007, turn cost $0.037. |
| `conversations.web_search` | null (automatic). |

## Case 2: a bill with an indexed document (automatic)

Bill Passage Probability Index, with the National Co-operative Development
Corporation (Amendment) Bill, 2026 selected in a new chat.

| Check | Result |
| --- | --- |
| Globe | Unlit. "Web search off (automatic): this record has indexed documents". The chip reads "Full text". |
| Turn | Answered from the record (stage, house, date introduced). No "From the web" row; `web_sources` empty; no search counted. |

A first attempt showed the globe lit for this bill. That was correct: the
reopened conversation still had the Raja A row attached, and a row without a
document key counts as "no indexed document". A new chat gave the result
above.

## Case 3: the globe overrides both ways

| Step | Result |
| --- | --- |
| Click the globe on the indexed bill | "Web search on (you turned it on)". The next answer drew on web reports: 5 sources (thehindu.com, business-standard.com, prsindia.org, ddnews.gov.in), 4 cited. |
| Click it again, then send | "Web search off (you turned it off)". The turn made no web search. `conversations.web_search` is stored as `false`. |

## Layout and theme

| Check | Result |
| --- | --- |
| Dark mode | The unlit globe sits on the composer's surface, not a white pill (review finding 4, fixed). The row and the panel use theme tokens and read well. |
| 375 × 812 | The sources panel and its note wrap; titles wrap; nothing overflows. |

## Finding fixed during the run

An answer with nothing from the record but web pages behind it was headed
"**Unverified.** The searches this turn ran returned no passages, so nothing
below is backed by the record." That is true of the record but hides where the
content came from. It now reads: "**Not from the record.** Nothing below is
backed by Niyantran's records; it draws on the web sources listed under the
answer, which are unofficial." (`f34646a`, with a test that fails without it.)

In this run every answer had the old header, because the local stack had no
desk rows, so the selected row could not be confirmed and cited. On NTER the
row is cited and the answer has no header.

## Not exercised here

- Claude, GPT and DeepSeek in the browser. Each was exercised only in the
  probes, to keep spend down.
- A provider that omits the search count, and a failover mid-search. Both are
  covered by unit tests only.
- Prompt injection from a hostile page. Covered by the link-check tests and
  the security pass, not by a live page.
