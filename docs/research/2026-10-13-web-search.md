# Web search in AI Research: TenderBase reference and Niyantran gap

> **Status:** Historical (dated 2026-10-13). A code reading of TenderBase
> (`DDL Labs codebase/tenderbase-onboard`, not a git checkout, not executed)
> and of Niyantran `main` at `879b917`, made before the web-search spec.
> **Evidence class:** code reading only. Nothing was run or called.

## Why

Owner, 2026-10-13: most Niyantran records exist only as SQL desk rows, so an
Ask AI answer about them restates the row. Web search should fill that gap,
whatever persona is in use, the way TenderBase's composer globe does through
OpenRouter and Exa. Owner decisions recorded the same day:

1. Web search turns on automatically **per record**: when the selected or
   attached record has no embedded document.
2. The **globe overrides the automatic choice both ways**. Its default
   follows the record (lit when the record has no embedded document); a
   click overrides it and is stored **per conversation in the database**.
3. **Three** web searches per turn at most.
4. Web sources are **labelled** as web (not official) and kept apart from
   document and row citations; clicking them shows the list of web sources.
5. Every search is recorded in the telemetry tables for later credit
   pricing (F111). No credit enforcement now.
6. The chat panel is outside the parallel UI refactor, so the backend and the
   chat UI are built together on `task/web-search`.

## How TenderBase does it

Paths are relative to `tenderbase-onboard/`.

### Mechanism: an OpenRouter server tool

Not the `web` plugin and not the `:online` suffix. The request's `tools`
array gets one extra entry, and OpenRouter runs the search with Exa:

```ts
// supabase/functions/_shared/agent-core/webSearch.ts:44-54
{ type: 'openrouter:web_search',
  parameters: { engine: 'exa', max_results: 5, max_total_results: 10,
                max_uses: clamp(1, MAX, remaining) } }
```

- `tool_choice` stays `'auto'`: the globe makes the tool **available**; the
  model decides whether to search (`ComposerWebToggle.tsx` comment:
  "Availability only").
- `max_uses` is the only cap OpenRouter enforces within one call. The agent
  loop makes several calls per turn, so it passes the **remaining** turn
  budget each call and drops the tool at zero (`talk-to-tender/handler.ts:1142-1157`).
- `:free` and unknown models never get the tool: "a paid server tool on a
  free model is a surprising bill" (`talk-to-tender/models.ts:418-422`).
- Limits are code constants: Talk2Tender 2 per turn
  (`models.ts:383`), Ask AI 3 per call, custom agents default 2, maximum 10.
- `EXA_SEARCH_COST_USD = 0.007` per search, recorded for visibility only:
  OpenRouter already includes it in `usage.cost`.

### Prompt (`talk-to-tender/prompt.ts:198-207`, only when the flag is on)

The documents stay primary and are searched first; no web search for
greetings or anything the passages already answer; when the answer lies
outside the documents the model **must** search before answering; one broad
search rather than several narrow ones; web facts are cited **inline as
markdown links**, never in the `sources` array or with `[n]` markers; a web
result never overrides the documents ("the document wins and you say so").

### Results, storage, telemetry

- Results arrive as `url_citation` annotations on the streamed message,
  parsed to `{url, title || url, snippet ≤500}` and de-duplicated by URL.
- Messages keep `web_sources` (at most 20, `{url ≤2000, title ≤300}`, no
  snippets).
- Migration `20260818013405`:
  - `conversations.web_search_enabled boolean not null default false`;
  - `chat_turn_traces` step type gains `web_search`;
  - `model_call_logs.web_search_count int not null default 0` and
    `web_search_cost_usd numeric`.
- The search count comes from
  `usage.server_tool_use_details.web_search_requests` (older payloads:
  `server_tool_use`); annotation batches over-count ("logged sixteen" for a
  two-search turn). Cost from `usage.cost_details.web_search_cost`, else
  searches × 0.007.

### UI

- Composer: a "Web" pill with a globe, `aria-pressed`, disabled while
  streaming; the setting is per conversation, written straight to
  `conversations.web_search_enabled`.
- Under the answer, `WebSourceList.tsx`: "From the web", up to four stacked
  favicons and "N sources". Clicking opens a **Sources** tab in the right pane
  (`WebSourcesPanel.tsx`): favicon, title and host, each an external link in
  a new tab.
- Favicons come from Google's favicon service by host
  (`SourceFavicon.tsx`): a third-party request per host.
- The activity ticker shows "Searched the web" with a result count.

### Known weaknesses not to copy

- If the model is refused the tool, the globe and the prompt still say web
  search is available.
- Ask AI counts annotation batches, not the provider's count, and never
  stores the search cost.
- There is no search-specific error path; an empty search is silent.

## Niyantran today (`main` at `879b917`)

- **No web search anywhere.** `research-chat` offers two tools,
  `search_documents` and `search_desk_rows` (`agent.ts:666-675`); the request
  builder (`_shared/openrouterStream.ts:106-140`) sends no `plugins` and no
  server tools. Web search is listed as deferred item P4 in
  `docs/plans/open-work.md` and in the 2026-09-20 agent spec.
- **The per-record signal exists.** `resolveDocumentIds` (`handler.ts`,
  `index.ts`) keeps only documents with `indexed_at`; a record whose key
  resolves to nothing is the `'unresolved'` widening case, and a turn naming
  no document is `'unkeyed'`. On the client, `coverageOf()`
  (`src/lib/corpusCoverage.js`) drives the tray's "Full text" / "Record only"
  badges.
- **Our loop differs from TenderBase's.** Research calls run with tools; the
  final answer call sends `tool_choice: 'none'` and a strict JSON schema
  (`answer`, `sources`, `follow_up_questions`) with
  `provider.require_parameters: true`. Search results reach only the call that
  ran the search, so they must be carried forward as evidence for the answer
  call to cite. Whether the server tool coexists with
  `require_parameters` and our model list is unverified: the first risk to
  probe.
- **Telemetry:** `model_call_logs` has no search columns;
  `chat_turn_traces.step_type` allows only `search_documents`,
  `search_desk_rows`, `reasoning`, `answer`
  (`20260921000004_telemetry_and_pricing.sql:46`). Cost already prefers
  OpenRouter's `usage.cost`.
- **Citations:** `TextCitation` and `RowCitation` only. `CitationBubble`
  accepts only those kinds, `SourceList` groups text citations only, and the
  side-panel viewer (`WorkSurface.resolveViewer`) knows page, text and row.
  `AiMarkdown` already renders `[text](https://…)` as a new-tab link, and the
  `[n]` marker grammar skips `[n](`, so inline web links will not collide.
- **Composer:** attach, model picker, dictation and submit; the request body is
  whitelisted by `validate.ts`, so a new field must be added there.
- **ADR 0002** makes OpenRouter the only outbound model endpoint; a server
  tool billed through OpenRouter fits it.

## Probes (executed 2026-10-13, owner-approved spend)

Two Node scripts (session scratchpad, not committed) called OpenRouter with
the server key read from `.env.local` and redacted from all output. Total
cost **$0.207**.

### Probe 1: research-call shape with the web tool

The request matched a `research-chat` research call: strict
`ANSWER_JSON_SCHEMA`, `provider.require_parameters: true`, the
`search_documents` function tool, and
`{type:'openrouter:web_search', parameters:{engine:'exa', max_results:5,
max_total_results:15, max_uses:3}}` with `tool_choice:'auto'`. The system
prompt was three sentences (no persona). One question, about the RBI
Monetary Policy Committee's latest decision.

| Model | Status | Searches | Unique URLs | Cost (USD) | Inference only | Schema kept |
|---|---|---|---|---|---|---|
| google/gemini-3.8-flash (default) | 200 | 1 | 5 | 0.0157 | 0.0087 | no (fenced JSON, own keys) |
| deepseek/deepseek-v4-flash | 200 | 1, then called `search_documents` | 5 | 0.0001 | 0.0001 | n/a (tool call) |
| anthropic/claude-sonnet-5 | 200 | 2 | 10 | 0.0522 | 0.0382 | no (markdown) |
| openai/gpt-6-astra | 200 | 3 (the cap) | 13 | 0.1331 | 0.1121 | no (own keys) |

- The server tool is accepted with `require_parameters` and with our own
  function tool, on all four providers (Google, StreamLake, AWS Bedrock for
  Claude, OpenAI). `max_uses: 3` held.
- **Search count:** `usage.server_tool_use_details.web_search_requests`
  (no `server_tool_use` key seen). **Search cost:** no
  `cost_details.web_search_cost` key is sent; `usage.cost −
  cost_details.upstream_inference_cost` equals exactly $0.007 × searches in
  every case (0.007, 0.014, 0.021).
- **Annotations:** `{type:'url_citation', url_citation:{url, title,
  start_index, end_index, content}}`. `content` is page text, 374–3,635
  characters: enough to carry forward as evidence.
- **Recency:** Gemini's one search returned February 2025 pages for "most
  recent", while GPT found October 2026 ones. Queries need the current date.

### Probe 2: control

| Request | gemini-3.8-flash | deepseek-v4-flash |
|---|---|---|
| A. Same research call without the web tool | tool call (no text) | schema kept |
| B. Answer call: no tools, strict schema, one row handle and the probe 1 web excerpts carried in a user message | schema kept; row cited `[1]` in `sources`; 3 inline links; no URL in `sources` | schema kept; 4 inline links; no URL in `sources` |

**Reading (small sample: four calls with the web tool, two without):** a
call in which OpenRouter runs a web search does not keep `response_format`.
The cause is the call mechanics, not prompt length: probe 1 had no persona
and a three-sentence prompt. A tools-free answer call that receives the web
results as evidence keeps the schema, keeps web pages out of `sources`, and
cites them inline as instructed.

### Consequence for our loop

`research-chat` already treats a research reply that is not a schema-valid,
handle-checked answer (`acceptedDraft`, `agent.ts:373`) as a draft and runs
the tools-free answer phase. So:

- web search belongs only to research calls, never the answer call;
- their annotations are captured server-side, de-duplicated, and carried into
  the next call as labelled, untrusted evidence (URL, title, trimmed excerpt);
- the final answer comes, as now, from the answer call under the strict
  schema; row and document citations stay `[n]` + `sources`, and web facts
  are inline links;
- the server owns the web source list (from the annotations, not the model),
  and can drop or neutralise an inline link whose URL was not among the
  pages searched this turn, the same way the citation ladder rejects unissued
  handles.

A turn that searches the web therefore pays one extra answer call; turns
without a search keep the `acceptedDraft` shortcut.

## Implications for the spec

1. Reuse the server tool, not a client-run search, so no new key or vendor.
2. Pass the remaining budget (3) per call and withdraw the tool at zero; never
   send it on the answer call.
3. Carry web results forward as labelled, untrusted evidence; the answer cites
   them as inline links, and the server, not the model, owns the web source
   list shown under the answer.
4. Gate the tool by model (no `:free`), and make the globe honest when the
   tool is withheld.
5. Count searches from the provider's usage, not annotations.
6. One migration: the trace step type, the two `model_call_logs` columns, a
   per-conversation globe column (null = follow the record), and web sources
   on messages.
7. Favicons: owner decision 2026-10-13, a plain globe and the domain name,
   no third-party icon request.
8. Validate inline web links on the server against the pages searched this
   turn, as the citation ladder does for handles.
9. Tell the model today's date for web queries, so "latest" finds this year.
