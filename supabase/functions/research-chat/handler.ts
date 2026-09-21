// The research turn (streaming spec §E). Framework-free and dependency
// injected: nothing here touches Deno.env or the network, so the same code
// runs under the edge runtime and under `deno test` with fakes.
//
// Order matters. The user message is inserted before any provider call, so a
// duplicate send is refused before it can cost anything. The reader's stream
// is never the turn's lifeline: a disconnect only detaches a reader, and the
// answer still finishes and persists.

import {
  CHAT_STREAM_QUEUE,
  type ChatFrame,
  type ChatSender,
  createChatReplay,
  createChatSender,
} from '../_shared/chatStream.ts';
import type { CitationSource } from '../_shared/citation.types.ts';
import { deskRecordText, deskRowKey } from '../_shared/deskRows.ts';
import { createHandleAssigner } from '../_shared/handles.ts';
import { HttpError } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';
import {
  type Message,
  type ModelEvent,
  ProviderError,
  type StreamRequest,
  type Usage,
} from '../_shared/openrouterStream.ts';
import type { Chunk } from '../_shared/retrieval.ts';
import type { DeskRow, DeskRowsResult, SearchDeskRowsArgs } from '../_shared/tools/searchDeskRows.ts';
import {
  type AgentCheckpoint,
  type AgentEvent,
  type AgentResult,
  createAgentBudget,
  createAgentCheckpoint,
  type DocumentSearchArgs,
  rowSourceKey,
  runAgent,
  type TraceStep,
} from './agent.ts';
import { createAnswerDecoder } from './answerStream.ts';
import { buildSystemPrompt, buildUserTurn, type RenderedAttachment } from './prompt.ts';
import { repairCitations, repairSources, repairWorthwhile } from './repair.ts';
import { applyCitationLadder, type Evidence, type EvidenceMap, ladderFired } from './sources.ts';
import { modelCallRow, type Pricing, type TelemetryDb, turnTraceRows } from './telemetry.ts';
import {
  type ClaimedTurn,
  executeClaimedTurn,
  fingerprintRequest,
  type TerminalResult,
  type TurnExecution,
  type TurnState,
  type TurnStore,
} from './persistence.ts';
import { documentKeysOf, type ResearchRequest, validateRequest } from './validate.ts';

export const WINDOW_CHARS = 60_000;
export const CANCEL_POLL_MS = 2_000;
export const MAX_FOLLOW_UPS = 3;

export interface AiModelLike {
  model_id: string;
  label?: string;
  efforts: string[];
  is_default: boolean;
  tier: number;
  params?: Record<string, unknown>;
}

export interface ConversationRow {
  id: string;
  title: string;
}

export interface AssistantMessage {
  conversation_id: string;
  content: string;
  sources: CitationSource[];
  follow_ups: string[];
  activity: unknown[];
  model_requested: string;
  model_served: string | null;
  reasoning_effort: string | null;
  status: 'running' | 'complete' | 'cancelled' | 'error' | 'truncated' | 'interrupted';
  error_message: string | null;
  usage: Record<string, unknown> | null;
  timing: Timing | null;
}

export interface UserDb {
  recentMessages(
    conversationId: string,
    excludeMessageIds: string[],
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]>;
  cancelRequestedSince(conversationId: string, since: string): Promise<boolean>;
  clearCancellation(conversationId: string): Promise<void>;
  /** document.id for each metadata->>'document_key' that exists. */
  resolveDocumentIds(keys: string[]): Promise<string[]>;
  /** The stored row, so a client-supplied selection can be trusted before it is cited. */
  findDeskRow(tier: string, feature: string, rowKey: string): Promise<DeskRow | null>;
}

export interface HandlerDeps {
  requireUser(req: Request): Promise<{ userId: string; token: string }>;
  models(): Promise<AiModelLike[]>;
  pricing(modelId: string): Promise<Pricing | null>;
  persona(userId: string): Promise<string>;
  catalogue(tier?: string): string;
  db: UserDb;
  persistence: TurnStore;
  executeTurn?: (context: TurnExecution) => Promise<TerminalResult>;
  telemetry: TelemetryDb;
  stream(req: StreamRequest): AsyncGenerator<ModelEvent>;
  searchDocuments(args: DocumentSearchArgs, documentIds?: string[]): Promise<Chunk[]>;
  searchDeskRows(args: SearchDeskRowsArgs): Promise<DeskRowsResult>;
  repairModel: string;
  headers?: Record<string, string>;
  now?: () => number;
  today?: () => string;
  cancelPollMs?: number;
  waitUntil?: (p: Promise<unknown>) => void;
}

function sseHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    ...extra,
  };
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

/** Newest whole messages that fit the budget, oldest first, with the count dropped. */
export function windowMessages(
  all: { role: 'user' | 'assistant'; content: string }[],
  budget = WINDOW_CHARS,
): { window: Message[]; dropped: number } {
  const kept: Message[] = [];
  let used = 0;
  let i = all.length - 1;
  for (; i >= 0; i--) {
    const m = all[i];
    const size = (m.content ?? '').length + 16;
    if (used + size > budget) break;
    used += size;
    kept.unshift({ role: m.role, content: m.content });
  }
  return { window: kept, dropped: i + 1 };
}

function firstDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

function parseEnvelope(text: string): { answer: string; sources: unknown; followUps: string[] } | null {
  try {
    const parsed = JSON.parse(text.trim());
    if (
      !parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      typeof parsed.answer !== 'string' || !parsed.answer.trim()
    ) return null;
    const followUps = Array.isArray(parsed.follow_up_questions)
      ? parsed.follow_up_questions.filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, MAX_FOLLOW_UPS)
      : [];
    return { answer: parsed.answer, sources: parsed.sources, followUps };
  } catch {
    return null;
  }
}

/** The requested model, the default, then the cheapest other enabled model. */
export function failoverChain(models: AiModelLike[], requested: string): string[] {
  const chain: string[] = [requested];
  const push = (id?: string) => {
    if (id && !chain.includes(id)) chain.push(id);
  };
  push(models.find((m) => m.is_default)?.model_id);
  push(
    [...models].sort((a, b) => a.tier - b.tier || a.model_id.localeCompare(b.model_id)).find((m) =>
      !chain.includes(m.model_id)
    )?.model_id,
  );
  return chain.slice(0, 3);
}

export async function handleResearchChat(req: Request, deps: HandlerDeps): Promise<Response> {
  const headers = deps.headers ?? {};
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, headers);

  let caller: { userId: string; token: string };
  try {
    caller = await deps.requireUser(req);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 401;
    return json({ error: e instanceof Error ? e.message : 'unauthorised' }, status, headers);
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json body', fieldErrors: { body: 'expected a JSON object' } }, 400, headers);
  }
  const validated = validateRequest(body);
  if ('fieldErrors' in validated) {
    return json({ error: 'invalid request', fieldErrors: validated.fieldErrors }, 400, headers);
  }
  const request = validated.request;

  const identity = {
    ownerId: caller.userId,
    turnKey: request.turn_key,
    requestHash: await fingerprintRequest(request),
    conversationId: request.conversation_id,
  };
  let existing: TurnState;
  try {
    existing = await deps.persistence.lookup(identity);
  } catch {
    return json({ error: 'Turn persistence unavailable' }, 503, headers);
  }
  if (existing.kind !== 'missing') return replayTurn(existing, headers);

  // The allowlist is the authority: a tampered request can never reach a model
  // that is not an enabled row, whatever model_pricing still lists.
  const models = await deps.models();
  const fallback = models.find((m) => m.is_default) ?? models[0];
  const chosen = request.model ? models.find((m) => m.model_id === request.model) : fallback;
  if (!chosen) {
    return json(
      { error: 'unknown or disabled model', fieldErrors: { model: `${request.model} is not an enabled model` } },
      400,
      headers,
    );
  }
  const effort = request.reasoning && request.reasoning !== 'off' ? request.reasoning : null;
  if (effort && !chosen.efforts.includes(effort)) {
    return json(
      {
        error: 'unsupported reasoning effort',
        fieldErrors: { reasoning: `${chosen.model_id} accepts ${chosen.efforts.join(', ')}` },
      },
      400,
      headers,
    );
  }

  let claim: ClaimedTurn | TurnState;
  try {
    claim = await deps.persistence.claim({
      ...identity,
      message: request.message,
      model: chosen.model_id,
      effort,
      deskTier: request.desk_context?.tier,
      deskFeature: request.desk_context?.feature,
    });
  } catch {
    return json({ error: 'Turn persistence unavailable' }, 503, headers);
  }
  if (claim.kind !== 'claimed') return replayTurn(claim, headers);
  const claimed = claim;

  // start() runs synchronously inside the constructor, so the sender exists
  // before the turn is launched on the next line.
  let sender!: ChatSender;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sender = createChatSender(controller);
    },
  }, CHAT_STREAM_QUEUE);
  let visible = '';
  const liveSender = {
    send(frame: ChatFrame) {
      if ('chunk' in frame) visible += frame.chunk;
      if ('patch' in frame) visible = visible.slice(0, frame.patch.from) + frame.patch.text;
      sender.send(frame);
    },
  };

  // The reader is not the turn's lifeline: waitUntil keeps the isolate alive
  // so a turn whose reader went away still finishes and persists.
  sender.send({ conversation: claimed.conversation });
  const work = executeClaimedTurn({
    store: deps.persistence,
    ownerId: caller.userId,
    turnKey: request.turn_key,
    claim: claimed,
    execute: deps.executeTurn ??
      ((context) => runTurn(deps, { request, caller, chosen, effort, models }, liveSender, context)),
  }).then((saved) => {
    if (saved.kind !== 'terminal') throw new Error('Terminal result not saved');
    sendTerminal(sender, saved, visible);
  }).catch(() => {
    sender.send({ saveFailed: { stage: 'assistant_message', detail: 'Turn persistence unavailable' } });
  }).then(() => sender.done());
  deps.waitUntil?.(work);

  return new Response(stream, { status: 200, headers: sseHeaders(headers) });
}

/** Replay uses stored output only. Tokens and private claim fields never cross
 * this boundary. D4 may extend the pending transport, not rerun its executor. */
function replayTurn(state: TurnState, headers: Record<string, string>): Response {
  if (state.kind === 'running') {
    return json(
      {
        status: 'running',
        conversation_id: state.conversation.id,
        message_id: state.assistant.id,
        execution_expires_at: state.assistant.execution_expires_at,
      },
      202,
      headers,
    );
  }
  if (state.kind !== 'terminal') {
    const code = state.kind === 'conflict'
      ? 409
      : state.kind === 'deleted'
      ? 410
      : state.kind === 'forbidden'
      ? 403
      : 404;
    return json({ error: `turn_${state.kind}`, code: `turn_${state.kind}` }, code, headers);
  }
  const frames: ChatFrame[] = [{ conversation: state.conversation }, { duplicate: true }];
  sendTerminal(
    {
      send: (frame) => {
        frames.push(frame);
      },
    },
    state,
    '',
    true,
  );
  return new Response(createChatReplay(frames), { status: 200, headers: sseHeaders(headers) });
}

/** Every terminal frame reflects the row returned by finalization/replay. */
function sendTerminal(
  sender: Pick<ChatSender, 'send'>,
  saved: Extract<TurnState, { kind: 'running' | 'terminal' }>,
  visible: string,
  forcePatch = false,
): void {
  const row = saved.assistant;
  if (forcePatch || row.content !== visible) {
    const from = forcePatch ? 0 : firstDifference(visible, row.content);
    sender.send({ patch: { from, text: row.content.slice(from) } });
  }
  if (row.status === 'complete' || row.status === 'truncated') {
    sender.send({ sources: row.sources });
    if (row.follow_ups.length) sender.send({ followUpQuestions: row.follow_ups });
  }
  if (row.timing) sender.send({ timing: row.timing });
  if (row.status === 'truncated') {
    sender.send({ truncated: { reason: 'length', continuations: Number(row.usage?.continuations) || 0 } });
  }
  if (row.status === 'error' || row.status === 'interrupted' || row.status === 'cancelled') {
    const error = row.status === 'cancelled'
      ? 'Turn cancelled.'
      : row.status === 'interrupted'
      ? 'Execution interrupted.'
      : 'The turn failed. Please try a new turn.';
    sender.send({ error, code: row.status });
  }
  sender.send({ done: { message_id: row.id } });
}

interface TurnInput {
  request: ResearchRequest;
  caller: { userId: string; token: string };
  chosen: AiModelLike;
  effort: string | null;
  models: AiModelLike[];
}

/** Observe cancellation through setup, answer, repair and telemetry. Only one
 * DB poll is in flight; late polls/executors cannot reopen a settled turn. */
async function runTurn(
  deps: HandlerDeps,
  t: TurnInput,
  sender: Pick<ChatSender, 'send'>,
  context: TurnExecution,
): Promise<TerminalResult> {
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, context.signal]);
  let active = true;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let partial: TerminalResult = {
    content: '',
    sources: [],
    follow_ups: [],
    activity: [],
    model_served: null,
    status: 'error',
    error_message: null,
    usage: null,
    timing: null,
  };
  const since = new Date((deps.now ?? Date.now)()).toISOString();
  let resolveAbort!: (result: TerminalResult) => void;
  const stopped = new Promise<TerminalResult>((resolve) => {
    resolveAbort = resolve;
  });
  const onAbort = () =>
    resolveAbort({
      ...partial,
      status: context.signal.aborted ? 'interrupted' : 'cancelled',
      error_message: context.signal.aborted ? 'Execution interrupted.' : null,
    });
  signal.addEventListener('abort', onAbort, { once: true });
  const schedule = () => {
    if (active && !signal.aborted) timer = setTimeout(poll, Math.max(5, deps.cancelPollMs ?? CANCEL_POLL_MS));
  };
  async function poll() {
    try {
      const hit = await deps.db.cancelRequestedSince(context.claim.conversation.id, since);
      if (active && !signal.aborted && hit) {
        cancelled = true;
        abort.abort();
      }
    } catch { /* the fixed execution deadline still bounds provider work */ }
    schedule();
  }
  try {
    if (signal.aborted) {
      onAbort();
      return await stopped;
    }
    schedule();
    return await Promise.race([
      runTurnBody(deps, t, {
        send(frame) {
          if (active && !signal.aborted) sender.send(frame);
        },
      }, {
        ...context,
        signal,
        checkpoint(value) {
          if (!active || signal.aborted) return;
          partial = { ...partial, ...value };
          context.checkpoint(value);
        },
      }),
      stopped,
    ]);
  } finally {
    active = false;
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    abort.abort();
    // Clearing the consumed request must not block durable finalization.
    if (cancelled) {
      void Promise.resolve().then(() => deps.db.clearCancellation(context.claim.conversation.id)).catch(() => {});
    }
  }
}

async function runTurnBody(
  deps: HandlerDeps,
  t: TurnInput,
  sender: Pick<ChatSender, 'send'>,
  context: TurnExecution,
): Promise<TerminalResult> {
  const signal = context.signal;
  signal.throwIfAborted();
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const { request, caller } = t;

  const conversation = context.claim.conversation;
  const messageId = context.claim.assistant.id;
  // 2. Prompt inputs.
  const handles = createHandleAssigner();
  const evidence: EvidenceMap = new Map();
  const [persona, history] = await Promise.all([
    deps.persona(caller.userId).catch(() => ''),
    deps.db.recentMessages(conversation.id, [context.claim.user_message_id, context.claim.assistant.id]).catch(
      () => [],
    ),
  ]);
  signal.throwIfAborted();
  const { window, dropped } = windowMessages(history);
  if (dropped > 0) sender.send({ notice: { kind: 'window', dropped } });

  let selectionBlock: { handle: string; tier: string; feature: string; recordText: string } | undefined;
  if (request.selection) {
    const rowKey = deskRowKey(request.selection.row);
    const stored = await deps.db.findDeskRow(request.selection.tier, request.selection.feature, rowKey).catch(() =>
      null
    );
    if (stored) {
      // Only a row the server can confirm becomes citable evidence.
      const handle = handles.assign(rowSourceKey(stored));
      evidence.set(handle, { kind: 'row', row: { ...stored, snapshot_at: stored.snapshot_at || '' } });
      selectionBlock = { handle, tier: stored.tier, feature: stored.feature, recordText: stored.record_text };
    } else {
      selectionBlock = {
        handle: 'the selected record (user-supplied, not citable)',
        tier: request.selection.tier,
        feature: request.selection.feature,
        recordText: deskRecordText(request.selection.row),
      };
    }
  }

  const system = buildSystemPrompt({
    persona,
    today: deps.today?.() ?? new Date(startedAt).toISOString().slice(0, 10),
    catalogue: deps.catalogue(request.desk_context?.tier),
    focus: request.focus,
    selection: selectionBlock,
  });
  const attachments: RenderedAttachment[] = request.attachments.map((a) => ({
    kind: a.kind,
    title: a.title,
    text: a.text,
  }));
  const userTurn = buildUserTurn(request.message, attachments);
  const scopedDocumentIds = await deps.db.resolveDocumentIds(documentKeysOf(request)).catch(() => []);

  signal.throwIfAborted();

  // 4. Run the loop, streaming as it goes.
  const decoder = createAnswerDecoder();
  const activity: unknown[] = [];
  let streamed = '';
  let searchMs = 0;
  let writingStart = 0;
  let writingEnd = 0;
  const attempts: { model: string; startedAt: number }[] = [];

  const onEvent = (e: AgentEvent) => {
    if (signal.aborted) return;
    if ('internalReasoning' in e) return;
    else if ('attempt' in e) {
      attempts.push({ model: e.attempt.model, startedAt: now() });
      const label = e.attempt.phase === 'research' ? 'Searching relevant sources.' : 'Writing the answer.';
      sender.send({ reasoning: label });
      activity.push({ type: 'activity', text: label });
      context.checkpoint({ activity: [...activity] });
    } else if ('tool' in e) {
      const f = e.tool;
      if (f.phase === 'start') sender.send({ tool: { name: f.name, phase: 'start', input: f.input, step: f.step } });
      else {
        searchMs += f.latencyMs;
        sender.send({ tool: { name: f.name, phase: 'end', step: f.step, resultCount: f.resultCount } });
        activity.push({
          type: 'tool',
          name: f.name,
          input: f.input,
          step: f.step,
          resultCount: f.resultCount,
          latencyMs: f.latencyMs,
          status: f.status,
        });
      }
    } else if ('text' in e) {
      const shown = decoder.push(e.text);
      if (shown) {
        if (!writingStart) writingStart = now();
        writingEnd = now();
        streamed += shown;
        context.checkpoint({ content: streamed });
        sender.send({ chunk: shown });
      }
    }
  };

  const budget = createAgentBudget();
  let checkpoint: AgentCheckpoint | undefined;
  const input = { system, window, userTurn, scopedDocumentIds };
  const chain = failoverChain(t.models, t.chosen.model_id);
  let result: AgentResult | null = null;
  let lastError: unknown = null;
  let schemaDropped = false;
  let served: string | null = null;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const attemptStart = now();
    try {
      checkpoint ??= createAgentCheckpoint(input, handles, budget);
      result = await runAgent(
        {
          request: {
            model,
            signal,
            ...(effortOf(t, model) ? { reasoning: { effort: effortOf(t, model)! } } : {}),
            ...(schemaDropped ? { response_format: undefined } : {}),
          },
          model: deps.stream,
          searchDocuments: (args, ids) => deps.searchDocuments(args, ids),
          searchDeskRows: (args) => deps.searchDeskRows(args),
          handles,
          budget,
          checkpoint,
          onEvent,
          now,
        },
        input,
      );
      served = result.served;
      break;
    } catch (e) {
      lastError = e;
      await logAttempt(deps, t, conversation.id, null, model, null, 'error', e, now() - attemptStart, null, null);
      if (signal.aborted) break;
      // Once any answer text has reached the reader, no swap: a second model
      // would restart a different answer under the same paragraph.
      if (streamed) break;
      if (e instanceof ProviderError && e.code === 'schema' && !schemaDropped) {
        schemaDropped = true;
        i--;
        continue;
      }
      if (e instanceof ProviderError && e.retryable) {
        const next = chain[i + 1];
        if (next) sender.send({ model: { requested: model, served: next, reason: `unavailable (${e.status})` } });
        continue;
      }
      break;
    }
  }

  if (!result) {
    return makeAssistantMessage({
      content: streamed,
      sources: [],
      followUps: [],
      activity,
      served,
      status: context.signal.aborted ? 'interrupted' : 'error',
      error: context.signal.aborted ? 'Execution interrupted.' : 'The turn failed. Please try a new turn.',
      usage: null,
      timing: timingOf(startedAt, now(), searchMs, writingStart, writingEnd),
    });
  }

  const envelope = parseEnvelope(result.text);
  if (
    signal.aborted || (result.finish !== 'stop' && result.finish !== 'length') ||
    (result.finish === 'stop' && !envelope) || (result.finish === 'length' && !streamed.trim())
  ) {
    return makeAssistantMessage({
      content: streamed,
      sources: [],
      followUps: [],
      activity,
      served,
      status: signal.aborted ? 'interrupted' : 'error',
      error: 'The turn did not produce a complete answer.',
      usage: totalUsage(result.usage, null),
      timing: timingOf(startedAt, now(), searchMs, writingStart, writingEnd),
    });
  }

  // 5. The citation ladder over what the model actually produced.
  for (const c of result.chunks) {
    const handle = handles.assign(c.id);
    evidence.set(handle, { kind: 'text', chunk: c });
  }
  for (const row of result.rows) evidence.set(handles.assign(rowSourceKey(row)), { kind: 'row', row });

  const rawAnswer = envelope?.answer ?? decoder.text ?? '';
  let ladder = applyCitationLadder({ answer: rawAnswer, modelSources: envelope?.sources, evidence });
  const followUps = envelope?.followUps ?? [];
  let repairUsage: Usage | null = null;

  // 6. One cheap pass to put the markers back, when the answer cited nothing.
  if (
    result.finish === 'stop' && !signal.aborted && ladderFired(ladder.flags) &&
    repairWorthwhile(ladder.answer, evidence)
  ) {
    const repairStart = now();
    try {
      const handleOf = (e: Evidence) => {
        for (const [handle, candidate] of evidence) if (candidate === e) return handle;
        return undefined;
      };
      const repaired = await repairCitations({ model: deps.stream }, {
        answer: ladder.answer,
        evidence,
        model: deps.repairModel,
        signal,
      });
      repairUsage = repaired.usage;
      await logAttempt(
        deps,
        t,
        conversation.id,
        null,
        deps.repairModel,
        repaired.served,
        repaired.rejected ? 'error' : 'success',
        repaired.rejected,
        now() - repairStart,
        repaired.usage,
        repaired.generationId,
        'citation_repair',
      );
      if (repaired.text && !signal.aborted) {
        const second = applyCitationLadder({
          answer: repaired.text,
          modelSources: repairSources(repaired.byNumber, handleOf),
          evidence,
        });
        if (second.sources.length > ladder.sources.length) ladder = second;
      }
    } catch (e) {
      log('research_chat.repair_failed', { message: e instanceof Error ? e.message : String(e) });
    }
  }

  const timing = timingOf(startedAt, now(), searchMs, writingStart, writingEnd);
  const usage = totalUsage(result.usage, repairUsage);
  const terminal = makeAssistantMessage({
    content: ladder.answer,
    sources: ladder.sources,
    followUps,
    activity,
    served,
    status: signal.aborted ? 'interrupted' : result.finish === 'length' ? 'truncated' : 'complete',
    error: null,
    usage: result.finish === 'length' ? { ...usage, continuations: result.continuations } : usage,
    timing,
  });

  if (messageId) {
    await deps.telemetry
      .logTurnTraces(
        turnTraceRows({
          userId: caller.userId,
          conversationId: conversation.id,
          messageId,
          steps: result.steps as TraceStep[],
          answer: {
            latencyMs: writingEnd && writingStart ? writingEnd - writingStart : 0,
            modelCallLogId: null,
            aborted: signal.aborted,
          },
        }),
      )
      .catch(() => {});
  }
  await logAttempt(
    deps,
    t,
    conversation.id,
    messageId,
    t.chosen.model_id,
    served,
    signal.aborted ? 'aborted' : 'success',
    null,
    now() - startedAt,
    lastUsage(result.usage),
    null,
  );

  return terminal;
}

function effortOf(t: TurnInput, modelId: string): string | null {
  if (!t.effort) return null;
  const model = t.models.find((m) => m.model_id === modelId);
  return model?.efforts.includes(t.effort) ? t.effort : null;
}

export interface Timing {
  search_ms: number;
  reasoning_ms: number;
  writing_ms: number;
  total_ms: number;
}

function timingOf(
  startedAt: number,
  endedAt: number,
  searchMs: number,
  writingStart: number,
  writingEnd: number,
): Timing {
  const total = Math.max(0, endedAt - startedAt);
  const writing = writingStart && writingEnd ? Math.max(0, writingEnd - writingStart) : 0;
  const search = Math.min(searchMs, total);
  return {
    search_ms: Math.round(search),
    writing_ms: Math.round(writing),
    reasoning_ms: Math.max(0, Math.round(total - search - writing)),
    total_ms: Math.round(total),
  };
}

function lastUsage(usage: Usage[]): Usage | null {
  return usage.length ? usage[usage.length - 1] : null;
}

function totalUsage(usage: Usage[], repair: Usage | null): Record<string, unknown> | null {
  const all = repair ? [...usage, repair] : usage;
  if (!all.length) return null;
  const sum = (k: keyof Usage) => all.reduce((n, u) => n + (Number(u[k]) || 0), 0);
  return {
    prompt_tokens: sum('prompt_tokens'),
    completion_tokens: sum('completion_tokens'),
    total_tokens: sum('total_tokens'),
    cached_prompt_tokens: sum('cached_prompt_tokens'),
    reasoning_tokens: sum('reasoning_tokens'),
    cost_usd: all.reduce((n, u) => n + (Number(u.cost) || 0), 0),
    attempts: all.length,
  };
}

async function logAttempt(
  deps: HandlerDeps,
  t: TurnInput,
  conversationId: string,
  messageId: string | null,
  requested: string,
  served: string | null,
  status: 'success' | 'error' | 'aborted',
  error: unknown,
  latencyMs: number,
  usage: Usage | null,
  generationId: string | null,
  purpose: 'chat_answer' | 'citation_repair' = 'chat_answer',
): Promise<void> {
  const pricing = await deps.pricing(served || requested).catch(() => null);
  await deps.telemetry
    .logModelCall(
      modelCallRow({
        userId: t.caller.userId,
        conversationId,
        messageId,
        purpose,
        requested,
        served,
        status,
        error: error ? (error instanceof Error ? error.message : String(error)) : null,
        latencyMs,
        usage,
        generationId,
        pricing,
      }),
    )
    .catch(() => null);
}

function makeAssistantMessage(
  a: {
    content: string;
    sources: CitationSource[];
    followUps: string[];
    activity: unknown[];
    served: string | null;
    status: TerminalResult['status'];
    error: string | null;
    usage: Record<string, unknown> | null;
    timing: Timing | null;
  },
): TerminalResult {
  return {
    content: a.content,
    sources: a.sources,
    follow_ups: a.followUps,
    activity: a.activity,
    model_served: a.served,
    status: a.status,
    error_message: a.error,
    usage: a.usage,
    timing: a.timing,
  };
}
