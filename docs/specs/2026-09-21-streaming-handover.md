# Streaming research handover amendments

> **Status: Historical (2026-09-28).** Local implementation was authorized by the owner on 2026-09-21; production actions remained separate.
> Superseded: `research-chat` is deployed (v32 on 2026-09-28) and D10 is done; the legacy feature-flag path and its endpoint were retired in `14b2344`, and the local chat store in `f05a5b6`.
> Module: `streaming-research-agent`. Prepared 2026-09-21.

## Purpose and actual cutoff

Continue the existing streaming spec, not a new AI architecture. Foundation,
document retrieval and desk-row grounding already have implementation history.
The user-facing streaming research path remains unfinished and research-chat
is not among the four deployed Edge Functions.

At the initial handover, the worktree had committed handles/segmenter/persona
synchronization (6a3dff3) and the OpenRouter stream client (6fef2e9), plus four
untracked Task 3 prompt/answerStream files. Those files have since been reviewed
and integrated through recovery D1. D1–D9 are locally verified; D10 panel and
browser integration remains in progress. The recovery plan records exact
commits and evidence. Old IDE completion reports are historical claims until
reproduced on the integrated checkout.

## Retained capability contract

A verified ordinary user can select an enabled model, ask a grounded question,
see genuine activity updates and streamed answer text, open validated source
citations, stop a turn and recover persisted conversation state after reload.
Personas come from trusted profile reads and alter style only. Document text
answers and desk-row counts use their respective evidence tools. The legacy
AI flag path is preserved except where a separately approved security repair
must close an authentication bypass.

The original spec remains the detailed reference for SSE envelopes, tools,
citation ladder and UI interfaces, subject to these proposed corrections:

1. Identity checks and child ownership from identity-boundaries are required
   before live research tests. Do not use a demo seat to bypass the application
   gate while separately minting a real Supabase session.
2. Fix message ownership and define one server-owned assistant result per user
   turn. The user-message idempotency key must not collide with the assistant
   result. Browser retries cannot trigger a second provider call or forge a
   completed answer. Persist terminal failure/cancellation so reload does not
   infer perpetual execution from an absent assistant row.
3. Task 3's decoder must find the top-level answer string, not a nested answer
   property or an apparent key inside earlier JSON text. Test chunk boundaries,
   escaped quotes, surrogate pairs, malformed envelopes, reset and multiple
   keys. The current string-search implementation warrants review.
4. Validate selected row identity against the server snapshot before treating
   browser-supplied row text as authoritative. Attachments are user-supplied
   context, separately labeled, and cannot mint trusted source handles.
5. Enforce budgets across scoped/unscoped retries, continuations, failover and
   repair. Log every provider attempt with its actual model, usage and cost
   source; no model swap after answer text becomes visible.
6. Citation repair that changes displayed answer text must emit the existing
   patch mechanism (or a reviewed additive frame) and persist the exact same
   final text/sources. Test a repair that removes or renumbers citations.
7. Progress should describe tool actions and concise public activity. Do not
   assume provider reasoning is safe to expose merely after stripping UUIDs.
   Never display raw hidden reasoning or internal prompts in the ticker.
8. Disconnect survival is bounded by the Edge runtime lifetime. Verify the
   actual deployment limits later; waitUntil is not a durable job queue. Persist
   interrupted/error state where possible and avoid unbounded polling claims.
9. The original greeting acceptance says three follow-ups while the prompt
   task says omit them. Proposed behavior: greetings make no retrieval call
   and have no follow-up chips; substantive answers may have up to three.
10. The owner approved `google/gemini-3.5-flash-lite` as the repair model during
    this review. Apply it only in the later authorized deployment step. No live
    secret or setting was changed by this planning task.
11. Remove the old plan's instruction to discard public/data changes. Those
    files are outside this work scope. Prior IDE deployment authority is not
    carried into this planning task. Deployment and paid/live verification
    remain explicit later gates after ingestion is quiescent.

## Acceptance and scope

### D2 interface clarification during implementation

The original AgentDeps omitted the model configuration required by StreamRequest.
Add deps.request (all provider request configuration except messages/tools) and
an exported shared budget state with modelAttempts, searches and continuations.
The handler must reuse that state across failover/retry/repair rather than reset
the budget per runAgent call. Reserve the final permitted model attempt for a
tools-disabled answer. Scoped/unscoped searches each consume one search attempt.
Provider retries are not silently introduced inside the loop. Propagate the
request AbortSignal. Raw provider reasoning uses an internalReasoning event;
the handler must never map it directly to public activity text. Existing SSE
frame names remain unchanged. These are technical clarifications within scope.

Independent D2 review additionally requires a resumable server-owned checkpoint
or typed failure snapshot: transcript, evidence, complete tool traces and progress
must survive an attempted provider retry together with the budget. Tool-call
attempt text is transcript-only, never concatenated into the final answer.
Use explicit research/answer phases so the final tools-disabled attempt can
stream without exposing premature tool-phase text. That final attempt consumes
the same twelve-call budget; it is not a free or hidden additional request.
Complete failed-tool trace events must reach the handler even when execution
throws. The handler owns retry and persistence policy, not reconstruction of
otherwise inaccessible agent internals.

Retain framework-free dependency-injected Deno code and the existing React
and Vitest patterns. Server scope is research-chat/ plus the minimal shared
stream/retrieval adapters. Browser scope is the research stream and conversation
libraries, source UI components and AiPanel's Supabase branch. Split handlers,
telemetry, repair, persistence and UI into bounded tasks before delegation.

Fake-provider tests cover all amended edge cases, authorization failures,
duplicate turns, cancellation, transport disconnect, malformed provider output,
source validation, model denial, repair synchronization and limits. Restore
each protected defect to prove the associated guard is non-vacuous. Integration
tests include two users. Browser verification covers both feature-flag paths,
source navigation, reload, Stop, responsive layout and console/network errors.

Commands after implementation: `npm test`,
`deno test -A --config supabase/functions/deno.json supabase/functions`,
`npm run build`; `VITE_AI_BACKEND=supabase npm run dev` only from the assigned
isolated checkout. Use a disposable local database for write tests. Production
deploy is a separate explicit operation, never bundled into a unit-test task.

Excluded: web search, binary attachment ingestion, local-chat migration,
personal memory, compaction, billing/credits and legacy AI endpoint retirement.

### D3 persistence clarification before dispatch

The existing schema has a unique user-message turn key but no durable running
turn. A retry without conversation_id could create a second conversation, and
an assistant row with a null key could be duplicated. D3 therefore includes a
small additive migration and disposable SQL tests, subject to independent
review before integration. No production migration is authorized here.

Use a server-owned durable turn claim keyed by verified user_id and turn_key.
Claiming must atomically create or validate the owned conversation and reserve
one user message plus one assistant result. A repeated key returns the original
conversation/result and never calls a provider again; a changed payload with the
same key is a conflict. Client data cannot mark a turn complete. Service-only
claim/finalize operations must recheck the explicit verified owner, and browser
reads remain owner-scoped under RLS. Provider invocation occurs only after a
successful claim. Finalization is idempotent and cannot overwrite a terminal
result with another execution. Running, complete, error, cancelled and truncated
states must survive reload. An expired bounded execution is displayed as
interrupted, never silently restarted or presumed complete. Tests must cover
simultaneous claims, two users, missing conversation IDs, payload conflicts,
terminal immutability, failure before first answer byte and cancellation.

The exact schema/API is settled in a short agent design proposal before source
edits; avoid duplicating result fields across tables unnecessarily. D3's scope
expands to one new migration and one SQL test in addition to persistence and
handler modules. D4 owns SSE lifecycle; D3 uses an injected execution seam so
transport, repair and deployment are not prematurely implemented.


### D3 approved implementation contract — 2026-09-21

Recover the existing 99502a7 handler/import closure as unaccepted input; exclude
its caller-JWT assistant-write index and deployment configuration until D6.
D2 is locally integrated as a038a93. Owner confirmed no competing worker.

A service-only research_turns claim keyed by (user_id, turn_key) stores a canonical
request hash, linked conversation/user/assistant IDs and a private execution
token. Keep answer/status/sources/usage only on the reserved assistant message.
Claims survive message/conversation deletion as consumed-key tombstones, so a
retry cannot recreate a deleted turn or spend again. Account deletion may cascade.

SECURITY INVOKER lookup/claim/finalize operations use fixed search paths and
explicit verified-owner checks. Revoke PUBLIC/anon/authenticated execute and
writes; maintain B2. Claim uses transactional uniqueness and locking, never a JS
check-then-insert. A supplied missing/foreign parent fails; only an omitted parent
permits creation. Reserve exactly one user plus running assistant before spend.
Reject legacy key collisions rather than adopting untrusted old message rows.

Canonical fingerprint covers validated message, requested model/reasoning,
focus, selection, ordered attachments and desk context; sort object keys but
retain array order. Exclude turn_key and conversation_id; compare a supplied
parent independently against the original parent. Reject oversized turn keys
rather than truncate them. Replay before model allowlist resolution preserves
old results after defaults or model availability change.

Same intent returns original running/terminal reservation, changed intent yields
409, and a deleted result yields 410. No replay invokes a provider. Return only
public result identifiers/state, never the execution token. Finalization checks
token/owner/deadline and cannot overwrite terminal results, including through
accidental direct service updates to claimed assistant rows.

Use an initial 120-second authoritative execution deadline with an earlier local
abort to leave finalization time. Expired claims become interrupted on lookup;
D8 also renders expired running rows as interrupted during direct message reload.
No automatic restart, lease renewal, or durable-worker guarantee. Save empty or
partial error results, cancelled results and length-exhausted truncated results.
Exclude both reserved rows from prompt history. D4/D5 remain separate acceptance
steps for public activity, transport, citation repair and per-attempt telemetry.

D3's validate.ts scope is limited to rejecting oversized turn keys. Migration
filename is generated by the Supabase CLI and recorded in the plan. Tests use a
disposable database and fake providers; production remains unchanged.


### D4 transport clarification — 2026-09-21

Bound unread SSE transport buffering to 8 MiB, measured in encoded bytes for
live and replay responses. This is a reader memory guard, not an answer-length
limit: overflow errors/detaches the reader while bounded execution continues to
final persistence. Do not truncate a large final patch silently. Verify a valid
1 MiB patch, overflow, disconnected readers and saved-result replay. The fixed
120-second execution deadline remains authoritative. Public final frames must
reflect the result returned by persistence, including an expired/interrupted
finalization, rather than an optimistic pre-save result.

### D6 wiring review constraints

The old index.ts writes assistant rows with the caller JWT and no longer matches
B2/D3. Recover it selectively. Inject the D3 service-only rpcTurnStore for claims
and finalization with the verified user's explicit ID; keep conversation/history
and cancellation reads and retrieval under the caller's RLS identity. Exclude
both reserved message IDs from history. Do not restore legacy user-message or
assistant insert methods. Telemetry remains server-only. Fake-client tests must
prove client selection, exact owner/claim parameters, absent/invalid bearer
rejection, cancellation error propagation and no network/provider call before
authorized claim. Function registration keeps internal authentication mandatory
when verify_jwt is false. No deployment is part of local wiring acceptance.


### D8/D10 browser integration contract

The conversation store exports captureConversationContext(id),
adoptConversation({id,title}, context), and reconcileTurn(id, context). Capture
the opaque owner/draft context before send; adopt on the first conversation
frame, then reconcile after terminal completion. Logout, identity/client changes
or replacement of the originating draft invalidate the context. A late result
must not select or overwrite another account's or draft's conversation.

Reload reads the stored result and deadline; it does not reconstruct a provider
request from chat rows, because selection/attachments are not fully persisted.
Same-request replay retains the original request and turn key in the stream
client/panel. A genuinely new execution requires an explicit new turn; neither
transport retry nor reload creates a new key automatically. HTTP202 means the
original execution is still running, not completion.

D4 persists public labels as type=activity. D9 renders that type and tool events;
legacy stored type=reasoning is not automatically safe to display. The existing
SSE reasoning frame carries only server-owned public labels after D4. Do not
restore the old renderer's assumption that arbitrary provider reasoning is
public activity.


### D5 attempt-accounting contract

Instrument each actual provider stream once, shared by agent and repair. Record
requested model from that request and observed served model, generation ID, usage
and terminal status. Abort settles an uncooperative attempt once; late events
cannot duplicate its log. Logging/pricing failures have bounded waits and generic
observability, never block durable finalization or expose provider bodies/prompts.

An optional server-internal StreamRequest.onAttemptMetadata callback carries only
normalized served model/generation ID/usage as observed, including before a later
error or abort. It is never serialized into a provider request. Public ModelEvent
and SSE vocabularies remain unchanged. This prevents an abort from discarding
metadata already received merely because the iterator has not returned.

Missing token values remain unknown. Provider finite nonnegative cost takes
precedence; a fallback estimate requires known token counts and valid pricing
for each nonzero component. Aggregate fields remain unknown if any attempted
call lacks that field. Repair consumes the same twelve-attempt budget and is
skipped when no attempt remains; no hidden thirteenth provider request.


### D7 stream-client recovery contract

Retain sendTurn/streamState/stopTurn and add owner-checked retryRequest and
retryTurn. Manual replay uses the unchanged captured request and original turn
key. Allow one in-flight manual replay, bounded by request/silence timeouts; it
never creates another execution key. There is no lifetime replay cap that could
permanently prevent recovery after several network failures.
State distinguishes transport activity from server running/terminal status and
records cancellation-request state, error code and execution expiry. HTTP202
is a running reservation. EOF/timeout is an unknown server outcome, not proof
of cancellation or completion. Do not unlock a second send merely because the
connection closed; recover/refetch the durable result or its authoritative expiry.

Alias draft and assigned conversation IDs to the same operation before invoking
the owner-checked onConversation callback. Logout/account change clears private
state, detaches readers and rejects late frames/coalescer callbacks. Stop writes
the verified owner's cancellation request, including when queued before the
first conversation frame; write failures remain visible. Successful request
submission means stopping, not confirmed cancelled. D10 reconciles stored state
through D8 and clears settled stream state. Network failures still permit later explicit same-key recovery; they are not
permission for an automatic paid restart. A 409 rejects different intent under
a consumed key, disables replay of that conflicting body and shows the conflict;
it does not permanently lock a rejected request. A user may explicitly begin a
new turn after that refusal, but the client never silently substitutes a new key.


D6 also closes the old query-embedding cancellation/accounting gap. Pass an
optional per-turn context to searchDocuments containing the AbortSignal and a
beginEmbeddingAttempt factory (observe sanitized metadata, finish once). Supply
it through the handler's existing search closure; agent.ts need not change.
Start a record only immediately before an actual embedding fetch, including each
retained retry; abort before retry prevents new spend. Embedding attempts use
purpose=embedding (already supported by the table) and join the same bounded
recorder, separately from the twelve chat-model-call budget. Preserve global
corpus-ingestion behavior: inject an abort-aware local adapter rather than
changing ingestion retries during research wiring. Propagate the turn signal
to retrieval RPCs where supported. Service claim/finalization adapters also need
bounded network waits; a timed-out response never authorizes a second execution
and may require replay to discover the eventual stored result.


### Durable message ordering

A claimed turn must persist the user message strictly before its reserved
assistant message in created_at order. New pairs must follow existing messages
in that conversation, including repeated claims within one transaction and
concurrent claims. The ordering fix belongs in the service claim transaction;
frontend role sorting is not a substitute. Preserve IDs, retry behavior and
ownership. Existing production data is not rewritten by this local correction.


### D10 panel integration acceptance details

Hydrate the verified owner's store before creating an empty draft; an empty
conversation list does not itself create one. Capture the D8 conversation
context before append/send and pass it to first-frame adoption and final
reconciliation. An optimistic user message carries the same turn_key as its
request so reload can deduplicate it. Prevent replacing an unacknowledged
pending draft while its stream uses the shared draft alias.

Composer locking uses isPending as well as transport activity and unexpired
stored running assistants. A reopened running turn has no in-memory replay
body: offer authoritative reload and verified cancellation, not a reconstructed
request or automatic restart. For retained network-unknown turns, explicit
recovery reuses the original body/key. Cancellation submission is not terminal
confirmation. Keep partial text visible alongside error/interrupted/truncated
status. Avoid duplicate stored/streamed assistants after reconciliation.

Identity changes clear panel-private viewer/attachments/errors and trigger fresh
hydration; stale completion callbacks may not change the next user's view.
Token refresh must recover from the store's invalidation instead of leaving an
empty panel. The evidence list falls back to the latest saved sources when the
idle stream source array is empty. Check both backend flags in a real browser
using isolated local fake auth/storage/provider inputs; live acceptance remains
a separate production gate.

### D7/D10 authoritative reload reconciliation

Independent D10 review reproduced a completed saved row remaining locked behind
a retained 202/unknown stream, or hidden behind partial text when no message ID
had arrived. Add `reconcileSavedTurn(conversationId)` to the browser transport.
It performs a verified-owner RLS read for an assistant matching the retained
original turn key and conversation, checks terminal status and any known message
ID, and removes only that same operation after rechecking identity/currentness.
No provider request, reconstructed body or implicit replay is permitted. A read
error, running row, mismatched identity/key/message or replaced operation cannot
unlock it. Bound the read; abort any detached reader and ignore its late frames.

D10 invokes this after verified stored-state reload/reconciliation and refreshes
its view under the captured owner/context. Saved terminal matching also uses the
retained turn key when no message ID is known, so completed content is visible
without a duplicate live bubble. Clearing a cache alone is not proof of terminal
completion. Test 202 and unknown outcomes, failure/running rejection, identity
switches and replaced-operation races with no additional provider calls.


### Correction — reload reconciliation cannot resolve by turn key

> **Supervisor correction, 2026-09-21.** The "D7/D10 authoritative reload
> reconciliation" section above specifies a "verified-owner RLS read for an
> assistant matching the retained original turn key". That is premised on a
> schema fact that is not true, and the first implementation built on it was a
> no-op in production. This correction governs; the text above is retained as
> the original record.

`chat_messages.turn_key` is populated on **user** rows only:

- `20260921000002_conversations.sql:36,40` declares `turn_key text` with the
  comment "idempotency claim, user turns only" and `unique (conversation_id,
  turn_key)`. An assistant row therefore cannot carry its user turn's key in
  the same conversation without violating that constraint.
- `20260921115831_research_turn_persistence.sql:164` inserts the user row with
  `turn_key`; `:166` inserts the assistant row with a column list that omits
  it, leaving it NULL. `finalize_research_turn` never sets it.

An equality filter on a NULL column never matches, so resolving the saved
assistant by turn key returns nothing on every real call. A fixture that
invents an assistant row carrying a turn key is testing an unrepresentable
state and will pass while production silently fails closed.

**Required resolution, without any schema change.** The
`unique (conversation_id, turn_key)` constraint is the D3 idempotency
mechanism and is not to be widened:

1. **When the message id is known** — resolve the assistant by
   `.eq('id', <retained message id>)`. The HTTP 202 path rejects any response
   whose `message_id` is not a non-empty string before publishing state, and
   the terminal done-frame carries it too, so this covers the dominant
   retained case. The id narrows the lookup only; every owner, conversation,
   role and terminal-status recheck on the returned row still applies.
2. **When it is not known** — the EOF or timeout case with no frame received —
   use an owner-scoped two-step read: the user row by `(user_id,
   conversation_id, turn_key, role='user')`, then the earliest assistant in
   the same conversation with `created_at` greater than the user row's. The
   claim transaction inserts the assistant at exactly
   `user_created_at + interval '1 microsecond'`, so the ordering is
   deterministic. An absent user row returns false rather than guessing.

`research_turns` is not an alternative lookup for the browser: it is
`service_role` only.

A successful reconciliation must also not be reported to the caller as
`identity_changed`. Retiring a stale operation after an authoritative read is
not an identity change, and surfacing it as one shows the user a false session
warning. Use a distinct end reason that maps to a neutral result, leaving the
logout path's behaviour unchanged.
