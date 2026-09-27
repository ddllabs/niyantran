# Streaming research agent — Implementation plan

**Date:** 2026-09-21
**Spec:** `docs/specs/2026-09-20-streaming-research-agent-design.md`
(Normative; Decisions 1–7, §A–§I, as amended 2026-09-21: work mode is the
viewer, evidence-first always, document scoping). Consumes the fixed
interfaces of `document-rag-and-citations` (§F tool, §G ladder, §H reader)
and `desk-row-grounding` (§C tool, §E rules, §F block, §G viewer), both
Historical. Module id `streaming-research-agent`.
> **Status:** Living — the earlier IDE execution record below is retained as
> historical evidence. Supervisor recovery found additional correctness and
> authorization defects; current acceptance is tracked in
> `docs/plans/2026-09-21-supervisor-recovery.md` and the amended contract in
> `docs/specs/2026-09-21-streaming-handover.md`. **Updated 2026-09-21:
> D1–D10 are all accepted and integrated, and `research-chat` is deployed
> (v1).** The migrations it depends on, including
> `20260921115831_research_turn_persistence`, are applied. What remains is
> live Task 8 — the bounded paid browser acceptance — which is blocked on an
> internal-admin account and a second ordinary account. (Superseded: D1–D8
> and D9 accepted with D10 in progress, deployment unperformed.)

**Goal:** Sign in, open Ask AI with the `supabase` backend, pick a model,
ask. The ticker shows the model thinking and each tool step as it runs;
the answer streams with `[n]` bubbles that open the document reader or
the record; follow-ups appear as chips; Stop halts the turn; a reload
mid-answer finds the finished answer; every conversation is on the server.
With the flag unset, the panel behaves exactly as today.

**Architecture:** One edge function, `research-chat`, framework-free and
dependency-injected: the handler validates, claims the turn, builds the
prompt, runs the agent loop over the two fixed tools through a streaming
OpenRouter client, pushes SSE frames through a disconnect-tolerant sender,
applies the citation ladder (and a repair pass when it fired), persists
the turn and its telemetry. The browser gains a stream reader, a
server-backed conversation store with the legacy store's call signatures,
and five components (ticker, bubble, picker, viewer, model row) that the
panel's `supabase` branch mounts. Two algorithms exist twice (reasoning
segmentation; persona files) and are parity-tested.

**Tech stack:** Deno (edge function, `npm:@supabase/supabase-js@2`),
OpenRouter chat completions streaming with tools and `response_format`,
React 19 + Vitest, the foundation's `_shared/{auth,models,logging,supabase,
cors,http,chatStream,personaMap}.ts`.

**Branch:** `task/streaming-research-agent` from `main` (`2630696`).
Sequential; a worktree under the scratchpad while the corpus ingest still
runs from the main checkout.

## Facts this plan rests on (2026-09-21)

| Fact | Value |
|---|---|
| Allowlist (`ai_models`, enabled) | 7 rows; default `google/gemini-3.5-flash-lite` (tier 1); `google/gemini-3.7-flash` (2), `google/gemini-2.5-flash-lite` (1), `deepseek/deepseek-v4-flash` (1), `deepseek/deepseek-v4-pro` (2), `anthropic/claude-sonnet-5` (3), `openai/gpt-6-astra` (3); every row `efforts = {low,medium,high}`; every row's pricing lists `tools`, `response_format`, `structured_outputs`, `reasoning` |
| Roles (`ai_roles`) | DEFAULT_ANALYST → gemini-3.5-flash-lite, EXPERT_ESCALATION → gpt-6-astra, PDF_PARSER → gemini-3.5-flash-lite, VISUAL_RESEARCH → gemini-3.7-flash |
| `chat_messages` | `unique (conversation_id, turn_key)`; columns `sources`, `follow_ups`, `activity`, `model_requested`, `model_served`, `reasoning_effort`, `status`, `error_message`, `usage`, `timing`; RLS: the user's own rows for all four verbs |
| `conversations` | `title`, `desk_tier`, `desk_feature`, `model_id`, `last_message_at`; RLS per user; `chat_cancellations` keyed by conversation |
| Telemetry | `model_call_logs` (caller/purpose/status/tokens/cost/generation id/raw_usage), `chat_turn_traces` (step_index, step_type in search_documents/search_desk_rows/reasoning/answer, chunk_ids, row_keys, model_call_log_id) — service role writes only |
| Persona | `user_profiles.persona` (`app_persona` enum) in the developer's auth schema; `_shared/personaMap.ts` maps it to a prompt file; `src/data/personas/*.md` are 1.2–1.8 KB except `student.md` at 49.5 KB |
| Legacy prompt text | `server/aiApi.mjs:22-46` (grounding rules) and `:48-55` (evidence-first addendum) — copied into the static prompt |
| Panel | `AiPanel.jsx` (944 lines) calls the local store's ten functions synchronously throughout (`ensureAiChat`, `activeAiChat`, `appendAiMessage`, …); `slimRow` at `:103-118`; Work mode button at `:780-796` sets a CSS class and a prompt flag |
| Retrieval | `search()` does not yet take `documentIds` (it passes `p_document_ids: null`); the RPC accepts them |
| Reader / list / row viewer | `SourceReader({ citation, onClose })`, `SourceList({ sources, onOpen })`, `RowSource({ citation, onClose })`, `openInDesk(citation)` |
| Gateway | `verify_jwt = false` for `ingest-documents`; `requireUser` verifies the JWT against the auth server itself |
| Database | Nano compute (no add-on; 224 MB shared buffers); Postgres restarted twice on 2026-09-21 under the two-shard embedding ingest (435 MB vector index). Live tests run when the ingest is idle |

## Decisions taken by this plan (inside the spec's scope)

1. **Persona comes from the profile, not the request.** The handler reads
   `user_profiles.persona` for the caller with the service client; null or
   unmapped → `analyst.md` (the legacy default). The persona block sits
   between the static prompt and the dynamic block, so the cacheable prefix
   is static + persona (stable per user across turns).
2. **Conversation window** = the newest whole messages that fit
   `WINDOW_CHARS = 60_000` (about 15 k tokens), oldest dropped first; when
   any are dropped the stream carries `{ notice: { kind: 'window', dropped } }`
   — one added frame, allowed by the foundation's "may add, never rename".
3. **Pins stay in the browser.** Attachments are per-turn inputs
   (`attachments[]`, text-bearing only); the server-backed store keeps a
   conversation's pins in `localStorage` keyed by the conversation id.
   `conversations` has no attachments column and this cut adds none.
4. **The server-backed store is a drop-in.** `src/lib/aiConversations.js`
   exports the ten functions of `aiChatStore.js` with the same names and
   synchronous signatures over an in-memory cache hydrated from the server
   (`hydrateConversations()` on panel mount; messages loaded on activation);
   writes are optimistic and persisted asynchronously, failures surfaced
   through the same event. `src/lib/aiThreads.js` re-exports one store by
   `aiBackend()`, so the panel changes one import block. `aiChatStore.js`
   is untouched.
5. **`focus` is a prompt hint**, one line in the dynamic block; the tools
   stay available in every focus. The legacy meaning ("desk sample" rows
   injected) is not carried: `search_desk_rows` replaces it.
6. **`documentIds` is added to `search()`** as an optional input passed
   through as `p_document_ids` — a two-line, backward-compatible edit to
   `_shared/retrieval.ts` (RAG module, Historical; recorded there as a
   dated note). Decision 5 of desk-row-grounding needs it.
7. **CORS** through the foundation's `_shared/cors.ts`; `ALLOWED_ORIGINS`
   must list the dev origin and the deployed site (checked in Task 5).
8. **`verify_jwt = false`** for `research-chat`, as for `ingest-documents`;
   `requireUser` is the check.
9. **Repair model proposal:** `AI_REPAIR_MODEL = google/gemini-3.5-flash-lite`
   (the default; tier 1; supports `response_format`). Set as a function
   secret; the owner can change it without a deploy. Flagged in the report
   as the spec's ask-first item.
10. **Cost per attempt** = OpenRouter's `usage.cost` when present (sent
    with `usage: { include: true }`), else tokens × `model_pricing`; the
    source is recorded in `raw_usage`.
11. **Cancellation poll** every 2 s reads `chat_cancellations` for the
    conversation with `cancel_requested_at` after the turn's start; on a hit
    the provider stream is aborted, the partial answer persists with
    `status = 'cancelled'`, the row is deleted.
12. **Reload mid-answer:** the client shows the persisted assistant row
    when it exists; while the turn is still running on the server the
    message list shows the user turn and a "still answering" state derived
    from the absence of the assistant row, refreshed on a 5 s poll for up
    to two minutes.

## Global constraints

- The server resolves the model; an id that is not an enabled allowlist
  row → 400, before any provider call.
- `SYSTEM_PROMPT_STATIC` is byte-identical across turns; the test proves it.
- Every provider attempt writes one `model_call_logs` row with cost; every
  tool step one `chat_turn_traces` row.
- Nothing model-authored reaches the reader without the citation ladder.
- Once a `chunk` has been sent, no model swap.
- No key in the browser; the browser sends the user JWT and the
  publishable key only.
- The legacy branch of `AiPanel.jsx` and `aiChatStore.js` are not edited;
  the legacy path runs the same functions it runs today.
- Live tests are paid and run once each; the transcripts go in the
  verification record. Deploy of `research-chat` is a named step (Task 5)
  under the owner's standing yes for tests and passes; the report says so.
- `git checkout -- public/data` before every commit.

## Fixed interfaces

```ts
// _shared/handles.ts
export function createHandleAssigner(nonce?: string): {
  assign(key: string): string;         // idempotent per key → 'ref:<nonce>-<n>'
  lookup(handle: string): string | undefined;
  handles(): Record<string, string>;   // handle → key
  readonly nonce: string;
}
export const HANDLE_RE: RegExp;         // /ref:[a-z0-9]{6}-\d+/g

// _shared/reasoningSegments.ts  ↔  src/lib/reasoningSegments.js  (fixture src/lib/__fixtures__/reasoningSegments.json)
export const MIN_SEGMENT_CHARS = 25, MAX_SEGMENT_CHARS = 160, MAX_REASONING_SEGMENTS = 12;
export function segmentReasoning(text: string): string[];

// _shared/openrouterStream.ts
export type ModelEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; args: string }           // arguments complete
  | { type: 'finish'; reason: 'stop' | 'length' | 'tool_calls' | 'error' | string; usage: Usage | null; served: string | null; generationId: string | null }
export interface Usage { prompt_tokens; completion_tokens; total_tokens; cached_prompt_tokens?; reasoning_tokens?; cost?: number }
export class ProviderError extends Error { status: number; body: string; retryable: boolean }
export interface StreamRequest { model: string; messages: Message[]; tools?: Tool[]; response_format?: unknown; reasoning?: { effort: string }; max_tokens?: number; cache?: boolean; signal?: AbortSignal }
export function streamChat(deps: { fetch: typeof fetch; apiKey: string }, req: StreamRequest): AsyncGenerator<ModelEvent>
export function parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string>   // one 'data:' payload per yield, [DONE] ends

// research-chat/answerStream.ts — incremental `answer` decoder
export function createAnswerDecoder(): { push(delta: string): string; reset(): void; readonly closed: boolean; readonly text: string }
// push returns the newly decoded answer characters (may be ''); text before the first '{' is never returned

// research-chat/prompt.ts
export const SYSTEM_PROMPT_STATIC: string;                                   // §C.1–10, DESK_GROUNDING_RULES inlined
export const BEFORE_YOU_ANSWER: string;                                       // repeated verbatim in the user turn
export const ANSWER_JSON_SCHEMA: unknown;                                     // strict envelope
export function buildSystemPrompt(a: { persona: string; today: string; catalogue: string; focus: string; selection?: { handle; tier; feature; recordText } }): string
export function buildUserTurn(message: string, attachments: RenderedAttachment[]): string

// research-chat/agent.ts
export const BUDGET = { maxSteps: 12, maxSearches: 10, maxContinuations: 2 } as const;
export interface AgentDeps { model(req: StreamRequest): AsyncGenerator<ModelEvent>; searchDocuments(args, documentIds?): Promise<Chunk[]>; searchDeskRows(args): Promise<DeskRowsResult>; handles: ReturnType<typeof createHandleAssigner>; onEvent(e: AgentEvent): void; now?: () => number }
export type AgentEvent = { reasoning: string } | { text: string } | { tool: ToolFrame } | { finish: ModelEvent }
export interface AgentResult { text: string; chunks: Chunk[]; rows: DeskRow[]; steps: TraceStep[]; continuations: number; usage: Usage[]; served: string | null; finish: string }
export async function runAgent(deps: AgentDeps, a: { system: string; window: Message[]; userTurn: string; scopedDocumentIds: string[] }): Promise<AgentResult>

// research-chat/handler.ts
export interface HandlerDeps { verify?; registry; persona(userId): Promise<string>; db: UserDb; telemetry: TelemetryDb; provider: { stream; apiKey }; embed; env: { repairModel: string }; now?; sleep? }
export async function handleResearchChat(req: Request, deps: HandlerDeps): Promise<Response>
// _shared/chatStream.ts gains: createChatSender(stream) → { send(frame), done(), closed }

// src/lib/researchChat.js
export async function* readSseFrames(response): AsyncGenerator<object>     // resolves on [DONE]; malformed frames skipped
export function createTextCoalescer(commit: (text) => void): { push(delta), patch(from, text), flush() }
export const SAFETY_TIMEOUT_MS = 120_000;
export function streamState(conversationId): StreamState                     // { isStreaming, streamingText, activity[], sources, followUps, model, truncated, error, notice }
export function subscribeStream(fn): () => void
export async function sendTurn({ conversationId, message, turnKey, model, reasoning, focus, selection, attachments, deskContext }): Promise<{ conversationId, messageId } | { duplicate: true }>
export async function recordChatCancellation(conversationId): Promise<void>
export function stopTurn(conversationId): void

// src/lib/aiConversations.js — same names and signatures as aiChatStore.js, plus:
export async function hydrateConversations(): Promise<void>
export async function loadMessages(conversationId): Promise<void>
// src/lib/aiThreads.js — re-exports aiConversations.js when aiBackend() === 'supabase', else aiChatStore.js

// src/lib/aiClient.js (additive)
export function sendResearchTurn({ body, token, signal }): Promise<Response>   // POST research-chat, returns the raw response for readSseFrames

// components
ActivityTicker({ activity, active, timing, model })
CitationBubble({ n, source, onOpen })
ModelPicker({ registry, value: { modelId, effort }, onChange })
WorkSurface({ viewer, onClose })                                              // hosts SourceReader (text) or RowSource (row)
```

## Tasks

### Task 0 — Branch and baseline

Worktree on `task/streaming-research-agent` from `main`; `.env.local`
copied; `node_modules` linked; Vitest 54 / Deno 88 / build green.

### Task 1 — Handles, reasoning segmenter (two copies), persona sync

**Write:** `_shared/handles.ts` + test; `_shared/reasoningSegments.ts` +
test; `src/lib/reasoningSegments.js` + test; `src/lib/__fixtures__/reasoningSegments.json`;
`scripts/sync-personas.mjs`; `supabase/functions/_shared/personas/*.md`
(generated, committed); `src/lib/personas.sync.test.js`.

- Handles: nonce of six `[a-z0-9]`; `assign` idempotent per key; a second
  assigner never repeats a nonce in 1,000 draws; `HANDLE_RE` matches
  handles and nothing bracketed.
- Segmenter: paragraph breaks first; then sentence ends (`. ! ?`) not
  preceded by a digit or a lone capital; merge backwards below 25 chars;
  cut at 160; at most 12 segments (the rest folded into the last). Fixture:
  eight inputs including a numbered plan, initials, an empty string, one
  long paragraph; both runners assert.
- Persona sync: copies `src/data/personas/*.md` byte-for-byte; the Vitest
  test compares every pair and fails naming the file when they differ.
  **Vacuity:** edit one byte of a generated file → fails by name.

### Task 2 — OpenRouter streaming client

**Write:** `_shared/openrouterStream.ts` + test.

- Request body: `stream: true`, `messages`, `tools`, `tool_choice: 'auto'`
  when tools, `response_format` + `provider: { require_parameters: true }`
  when given, `reasoning: { effort }` when given, `usage: { include: true }`,
  `max_tokens` when given; `cache_control: { type: 'ephemeral' }` on the
  system message and the last user message when `cache` and the system
  text ≥ `MIN_CACHEABLE_PREFIX_CHARS = 4_000`.
- SSE parsing: `data:` lines, blank-line framed, `: OPENROUTER PROCESSING`
  comments ignored, `[DONE]` ends; each payload's `choices[0].delta`:
  `reasoning` (or `reasoning_content`) → reasoning event; `content` → text;
  `tool_calls[i]` accumulated by index until `finish_reason` → one
  `tool-call` per call; the last payload's `usage`, `model`, `id` → finish.
- Non-2xx → `ProviderError` with `retryable = status === 429 || status >= 500`;
  a body naming `response_format` / `json_schema` → `code = 'schema'`.
- Tests with scripted streams: a text answer with usage; reasoning then
  tool call then finish; two tool calls interleaved by index; a 503 body;
  a schema-rejection 400; `[DONE]` without usage → `usage: null`.

### Task 3 — Answer decoder and prompt

**Write:** `research-chat/answerStream.ts` + test; `research-chat/prompt.ts`
+ test.

- Decoder: hold text until the first `{`; find the first `"answer"` key
  (whitespace tolerant); after its `:` and opening quote, emit decoded
  characters as they arrive; JSON escapes (`\n \" \\ \/ \t \uXXXX`) decoded,
  a partial escape held; the closing unescaped quote closes the decoder.
  Tests: streamed char by char the emitted text equals `JSON.parse(full).answer`
  for five envelopes (escapes, unicode, a `{` inside the answer, prose
  before the `{`, an answer that is not the first key).
- Prompt: `SYSTEM_PROMPT_STATIC` assembled from ten named constants in §C
  order (the legacy grounding rules and evidence-first text copied
  verbatim; `DESK_GROUNDING_RULES` inlined; worked decomposition examples:
  a bill's committee stage, a regulatory order's penalty clause, a court
  order's holding; the not-found example). `buildSystemPrompt` returns
  static + `\n\n` + persona + `\n\n` + dynamic (date, focus line,
  catalogue, selected record via `selectedRecordBlock`). Test: two builds
  for different users/desks share a byte-identical prefix of
  `SYSTEM_PROMPT_STATIC.length`; the schema is strict with `answer`,
  `sources[{id,source}]`, `follow_up_questions`; `BEFORE_YOU_ANSWER` ends
  both the static prompt and `buildUserTurn`.

### Task 4 — The loop

**Write:** `research-chat/agent.ts` + test; two-line edit to
`_shared/retrieval.ts` (`documentIds?: string[]` → `p_document_ids`) with
a test line.

- Messages: system, window, user turn; assistant tool calls and tool
  results appended in order; each `search_documents` result rendered as
  `${handle} | ${title} | ${desk_feature}\n${content}` blocks (handles from
  the shared assigner; chunks accumulated with `accumulate`), each
  `search_desk_rows` result through `renderDeskRows` with handles from the
  same assigner; `NO_RESULTS` and `SEARCH_BUDGET_EXHAUSTED` as the two
  non-result replies; a hallucinated tool name → a one-line refusal reply.
- First `search_documents` of the turn passes `scopedDocumentIds`; empty
  result → same query unscoped; both traced.
- `finish_reason: length` → append partial text, push a user turn
  "Continue exactly where you stopped…", at most 2; result `continuations`.
- Budget: `maxSteps` model calls, `maxSearches` tool calls in total.
- Tests (scripted model): three document searches → the union of chunks;
  a desk search → rows with handles of the same nonce; endless searcher
  stops at 10 and answers; `length` resumes twice then stops; scoped-empty
  retries unscoped; hallucinated tool tolerated. **Vacuity:** remove the
  search cap → the endless test fails.

### Task 5 — Handler, sender, repair, telemetry, function, deploy

**Write:** `_shared/chatStream.ts` (sender added), `research-chat/{handler,
telemetry,repair,index}.ts`, `handler_test.ts`, `supabase/config.toml`
entry.

- Sender: JSON frames as `data: <json>\n\n`; enqueue failures swallowed
  and `closed` set; `done()` writes `data: [DONE]\n\n` and closes.
- Handler sequence per §E. Validation with `fieldErrors`; 401 via
  `requireUser`; model via `resolveModel` (unknown/disabled → 400);
  effort limited to the model's `efforts` (else 400); create the
  conversation when absent (title from the message; `desk_tier`,
  `desk_feature`, `model_id`); insert the user message with `turn_key`
  (unique violation → `{duplicate:true}`, `[DONE]`); persona; window;
  scoped ids from `document_key` values; run the loop while streaming
  reasoning through the segmenter and the redaction gate (24-char tail;
  handles and UUIDs stripped) and `chunk` through the decoder; failover
  chain requested → default → cheapest enabled tier-1 that is neither,
  retry on `retryable` only, schema `code` → same model once without
  `response_format`, no swap after a chunk; cancellation poll; final
  parse → ladder → repair when fired (`≥ 200` chars, something retrieved,
  ratio 0.7–1.4) → persist assistant row → telemetry rows → `{sources}`,
  `{followUpQuestions}`, `{timing}`, `{done}`; on abort persist partial
  as `cancelled`; on provider failure with nothing streamed `{error}`.
  `EdgeRuntime.waitUntil` wraps the turn so a disconnect does not end it.
- Tests with fakes: validation (400 with `fieldErrors`), 401, unknown
  model 400 (a disabled row still listed in `model_pricing` is refused),
  effort outside `efforts` 400, duplicate before any provider call,
  failover 503 → second model with `{model}`, 503 after a chunk → `{error}`
  and no swap, schema rejection → same model retried without
  `response_format`, frames order and `[DONE]`, persistence shape
  (sources/activity/follow_ups/usage/timing), telemetry rows per attempt
  and per step, repair invoked only when the ladder fired, cancellation
  → `cancelled`. **Vacuity:** remove the registry check → the disabled
  model test fails; remove `if (streamedOut) break` → the no-swap test
  fails.
- `index.ts` wires: `requireUser`; `userClient(token)` for conversations,
  messages, cancellations and both tool RPCs; `serviceClient()` for
  telemetry, registry, `user_profiles.persona` and document-key
  resolution; `embedTexts` for queries; `streamChat` with
  `OPENROUTER_API_KEY`; `AI_REPAIR_MODEL`; CORS from `ALLOWED_ORIGINS`.
- Deploy `research-chat` (`verify_jwt = false`), set `AI_REPAIR_MODEL`,
  check `ALLOWED_ORIGINS` includes `http://localhost:5173` and the site.
  Smoke: a curl with a throw-away user's JWT and a greeting → frames end
  in `[DONE]`; anon → 401.

### Task 6 — Browser libraries

**Write:** `src/lib/researchChat.js` + test; `src/lib/aiConversations.js`
+ test (fake client); `src/lib/aiThreads.js`; `src/lib/aiClient.js`
(`sendResearchTurn`, additive).

- `readSseFrames`: blank-line framing across chunk boundaries, malformed
  frames skipped, `[DONE]` resolves; coalescer commits once per animation
  frame (fake RAF in the test), `patch` rewrites from an offset; the safety
  timeout marks the stream errored after 120 s of silence.
- `aiConversations.js`: cache `{ chats, activeId }`; `hydrateConversations`
  lists the user's conversations (`last_message_at desc`), loads the
  active one's messages; `createAiChat` inserts; `renameAiChat` /
  `deleteAiChat` update/delete; `appendAiMessage` is used only for the
  optimistic user turn (the server persists the real rows; the store
  reconciles on `{done}` by reloading the conversation's messages);
  attachments in `localStorage` per conversation id; the same
  `niy-ai-chats` event.

### Task 7 — Components and the panel's `supabase` branch

**Write:** `src/ai/{ActivityTicker,CitationBubble,ModelPicker,WorkSurface}.jsx`
+ tests; **modify:** `src/ai/AiMarkdown.jsx`, `src/ai/AiPanel.jsx`.

- `AiMarkdown`: `Inline` tokenises `splitCitationMarkers` output; a
  `{citation:n}` with a resolved source → `CitationBubble`; while
  `streaming` an unresolved marker → a fixed-width placeholder; when not
  streaming an unresolved marker is dropped. Props: `text, sources?,
  streaming?, onOpenSource?`. The legacy call (`<AiMarkdown text=… />`)
  renders as before.
- `ActivityTicker`: collapsed one line ("Thinking…", "Searching documents
  for '…'", "Searched · 12 passages", "Looking up rows in …"), expanded
  list with durations, auto-expanded while active, buckets and served
  model when done, "unavailable → …" on a swap.
- `ModelPicker`: models grouped by vendor with tier dots from pricing,
  effort chips limited to `efforts`, role chips; value `{ modelId, effort }`
  persisted in `localStorage`.
- `WorkSurface`: a layer over the thread with a back control; hosts
  `SourceReader` for `text`, `RowSource` for `row`.
- `AiPanel.jsx` (`supabase` branch only): import block from `aiThreads.js`;
  `hydrateConversations()` on mount; `send` → `sendTurn` with
  `turn_key`, the selection (`slimRow(selected)` + tier + feature +
  `billDocumentKey`), pins as `attachments`, `desk_context`; thread
  renderer shows the streaming message (ticker, coalesced text with
  placeholders, then sources and follow-up chips); Stop button while
  streaming; Work mode button toggles `viewer`; bubble/chip clicks open
  the viewer; model row → `ModelPicker`. Legacy branch untouched.
- Vitest: ticker states; marker tokenisation with placeholder/strip;
  picker limits efforts; surface renders the right viewer.

### Task 8 — Live verification

`VITE_AI_BACKEND=supabase` dev server in the worktree; a Supabase session
in the page minted for a throw-away confirmed user through a magic-link
token hash (`verifyOtp` in the page; no password typed), the app's demo
seat for its own gate. Scenarios per §H (greeting; a Lok Sabha count on
the Bill Passage desk; a document question; Stop; close-tab). Legacy
parity with the flag unset. Transcripts and the SQL evidence
(`model_call_logs`, `chat_turn_traces`, `chat_messages`) recorded.

### Task 9 — Close

Plan → Historical with the record; spec → Historical; coordination.md
(function, secrets, commands); merge to `main`; push only when named.

## Risks

| Risk | Mitigation |
|---|---|
| Model ignores `response_format` or the envelope arrives malformed | schema downgrade retry; the decoder tolerates prose before `{`; the ladder + repair; `prose_fallback` recorded |
| Long persona (49 KB student) on every turn | placed before the dynamic block inside the cacheable prefix; measured in the record |
| Nano database restarts under load | live tests only when the ingest is idle; the agent's writes are small |
| Gemini rejects a transcript ending on an assistant turn | continuation sent as a user turn (§B) |
| Disconnect mid-turn | `waitUntil`, swallowed enqueue errors, persisted answer; the client re-reads on reload |

## Earlier IDE verification record (2026-09-21)

The following is the original execution record, not current recovery acceptance.

Executed 2026-09-21 in a worktree on `task/streaming-research-agent`.
Observed, not inferred. Tasks 0–7 are complete; Task 8 (live) is blocked on
the deploy, which the spec reserves for the owner.

| # | Check | Result |
|---|---|---|
| 0 | Baseline | Vitest 54, Deno 88, build clean |
| 1 | Handles | nonce six of `[a-z0-9]`, idempotent per key, 1,000 draws never repeat, `HANDLE_RE` never matches a bracketed marker. Deno 3/3 |
| 1 | Segmenter, two copies | 9 fixture cases; numbering (`3.`) and initials (`R. Kumar`) are not sentence ends; short pieces merge; 30 sentences cap at 12. Vitest 4/4, Deno 2/2. Vacuity: one tampered fixture segment → both runners fail |
| 1 | Persona sync | 5 files copied byte-for-byte; every map entry resolves. Vacuity: one appended byte → the test fails naming the file |
| 2 | OpenRouter client | Deno 6/6: framing across chunk boundaries, comments skipped, `[DONE]`; reasoning/text deltas; two tool calls accumulated by index; usage with cached and reasoning tokens; 503 retryable; a `response_format` refusal classified `schema`; cache breakpoints only above 4,000 characters |
| 3 | Answer decoder | Deno 8/8 (hardened on disk to a real JSON parser): the streamed text equals `JSON.parse(full).answer` for five envelopes at four chunk sizes; prose before the object never shown; only a top-level `answer` opens the stream, so a nested or in-string decoy cannot; split escapes and surrogate pairs held until complete; key length and nesting bounded |
| 3 | Prompt | Deno: ten sections in order, ends with the checklist; two builds for different users and desks share a byte-identical static prefix; strict envelope schema; attachments rendered as untrusted, uncitable context |
| 4 | Agent loop | Deno 42/42 including research and answer as separate phases, the budget (12 attempts, 10 searches, 2 continuations), checkpoint resume without re-running a search, scoped-then-unscoped first document search, hallucinated tool tolerated |
| 5 | Sender | Deno 4/4: SSE framing and `[DONE]`; a cancelled reader swallows writes and reports closed rather than killing the turn; `done()` idempotent; every declared frame round-trips |
| 5 | Citation ladder | Deno 9/9: handles become numbered sources; a handle the model never received is stripped along with its marker; grouped and ranged markers expand; a handle written into prose is rescued and reported as `prose_fallback`; a long answer citing nothing is `uncited_claims`; malformed model sources ignored |
| 5 | Handler | Deno 14/14: 405/401/400 with `fieldErrors`; a disabled model and an unsupported effort refused before any provider call; a plain answer streams and persists with sources, timing and done in order; duplicate `turn_key` answers `duplicate` with no second provider call; a retrieved passage becomes a citation and writes its trace rows; 503 swaps to the next model with a `{model}` frame; a failure after text has streamed never swaps; a `response_format` refusal retries the same model with the schema dropped; a cancellation persists what streamed as `cancelled` and clears the request; a selection the server cannot confirm stays uncitable; attachments never get a handle |
| 5 | Vacuity | an unknown model falling back instead of being refused → the registry test fails; removing the no-swap guard → the no-swap test fails |
| 5 | Defect found and fixed | a turn cancelled mid-answer persisted correctly but never deleted its `chat_cancellations` row, so the next turn on that conversation would have been cancelled before it started |
| 6 | Browser libraries | Vitest 16/16: SSE framing across chunk boundaries, malformed frames skipped; the coalescer commits once per animation frame; a patch rewrites from its offset; duplicate and error frames; conversations hydrate with sources and activity; a draft chat persists nothing until its first turn and is dropped if the turn lands in an existing conversation; attachments stay in `localStorage` |
| 6 | Defect found and fixed | the safety timeout aborted the request but could not interrupt a hung body, because the reader holds a lock; cancelling the reader itself was needed, and why the stream ended is now recorded rather than inferred |
| 7 | Components | Vitest 13/13: a resolved marker becomes a bubble and a row marker is marked as one; an unresolved marker holds a placeholder while streaming and is dropped when finished; markers inside headings and list items resolve; the legacy call leaves brackets alone; ticker states and buckets; the picker limits efforts to the chosen model; the viewer hosts the record or the source list |
| 7 | Browser, research path (worktree on 5174, a throw-away Supabase session, the app's own demo seat; no credential typed) | The panel opens; the model picker lists all seven allowlist models grouped by vendor with their four roles, cost dots and the default marked, and offers only the chosen model's efforts; Work mode opens the evidence layer over the thread, which reads "This answer cites no sources yet" on an empty thread |
| 7 | Browser, allowlist under RLS | signed out, `ai_models` is refused (`permission denied`); signed in, all seven models and four roles load |
| 7 | Browser, legacy parity (flag unset, server restarted) | the panel renders as before, the old model row, Work mode still toggles the prompt flag (`aria-pressed` true → false), no viewer is mounted |
| 5 | Document scoping, live | the function's key lookup (`.in('metadata->>document_key', keys)`) was run against `NTER` with three keys and returned the one document that exists, so a scoped first search will really be scoped. This was the module's only untested integration point, because the handler swallows a failure here and falls back to an unscoped search |
| all | Suites at close | Vitest 89/89 (19 files), Deno 169/169, build clean |
| all | Merged | `task/streaming-research-agent` merged to `main` alongside the desk-row and corpus-ingest branches; every suite re-run green on the merge result. Not pushed; the owner names the push |

## Earlier IDE cutoff: not done, and why

These are the earlier IDE conclusions. Current recovery adds the remaining D10 acceptance gate named above; its plan supersedes any claim below
that only deployment remains. The owner has since selected
`google/gemini-3.5-flash-lite` for the repair model; it has not been configured
in production.

> **Resolved 2026-09-21.** The deploy happened: `research-chat` is live at
> version 1 with `verify_jwt = false`, and `AI_REPAIR_MODEL` is
> `google/gemini-3.5-flash-lite`, confirmed available in `model_pricing`. Only
> Task 8's paid run is still outstanding, blocked on the two missing test
> accounts. The list below is retained as the record of what was pending.

- **Task 5's deploy, `AI_REPAIR_MODEL`, and Task 8's live run.** The spec's
  boundaries reserve "any deploy" and the repair model for the owner, so
  `research-chat` is written, wired and registered in `supabase/config.toml`
  but not deployed, and no paid turn has been run. Everything else in the
  module is built and green.
- Once the owner authorises it, the remaining steps are: deploy the
  function, set `AI_REPAIR_MODEL` (proposal: `google/gemini-3.5-flash-lite`,
  the tier-1 default), confirm `ALLOWED_ORIGINS` covers the dev origin and
  the site, then run the five §H scenarios and record their transcripts.

## Known limitations

- Binary attachments (PDF, image) are not carried on this path; text-bearing
  ones are.
- Conversation memory is a 60,000-character window with a notice when older
  turns fall out; condensing is a later cut.
- `desk-brief` and the rest of `/api/ai/*` stay on the legacy path.
- The repair pass is streamed from the provider but never to the reader; it
  is charged to the platform and logged with `purpose = 'citation_repair'`.
