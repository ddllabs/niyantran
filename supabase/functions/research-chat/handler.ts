// The research turn (streaming spec §E). Framework-free and dependency
// injected: nothing here touches Deno.env or the network, so the same code
// runs under the edge runtime and under `deno test` with fakes.
//
// Order matters. The user message is inserted before any provider call, so a
// duplicate send is refused before it can cost anything. The reader's stream
// is never the turn's lifeline: a disconnect only detaches a reader, and the
// answer still finishes and persists.

import { type ChatSender, createChatSender } from '../_shared/chatStream.ts';
import type { CitationSource } from '../_shared/citation.types.ts';
import { deskRecordText, deskRowKey } from '../_shared/deskRows.ts';
import { createHandleAssigner, HANDLE_RE } from '../_shared/handles.ts';
import { HttpError } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';
import { ProviderError, type ModelEvent, type Message, type StreamRequest, type Usage } from '../_shared/openrouterStream.ts';
import { segmentReasoning } from '../_shared/reasoningSegments.ts';
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
import { documentKeysOf, type ResearchRequest, validateRequest } from './validate.ts';

export const WINDOW_CHARS = 60_000;
export const CANCEL_POLL_MS = 2_000;
/** Held back so an identifier split across two deltas can never flash on screen. */
export const REDACTION_TAIL = 24;
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
  status: 'complete' | 'cancelled' | 'error';
  error_message: string | null;
  usage: Record<string, unknown> | null;
  timing: Timing | null;
}

export interface UserDb {
  getConversation(id: string): Promise<ConversationRow | null>;
  createConversation(a: { title: string; desk_tier?: string; desk_feature?: string; model_id: string }): Promise<ConversationRow>;
  /** 'duplicate' when this turn_key already claimed the send. */
  insertUserMessage(a: { conversation_id: string; content: string; turn_key: string }): Promise<{ id: string } | 'duplicate'>;
  recentMessages(conversationId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]>;
  insertAssistantMessage(row: AssistantMessage): Promise<{ id: string }>;
  touchConversation(id: string, title?: string): Promise<void>;
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
  return { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', ...extra };
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });
}

/** Newest whole messages that fit the budget, oldest first, with the count dropped. */
export function windowMessages(all: { role: 'user' | 'assistant'; content: string }[], budget = WINDOW_CHARS): { window: Message[]; dropped: number } {
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

/**
 * Streams reasoning while holding back a short tail, and never lets an
 * identifier through: handles are stripped, and a partial one at the boundary
 * stays in the buffer until the next delta settles it.
 */
export function createReasoningGate(emit: (text: string) => void, tail = REDACTION_TAIL) {
  let buffer = '';
  const clean = (s: string) => s.replace(HANDLE_RE, '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '');
  return {
    push(delta: string) {
      buffer += delta;
      if (buffer.length <= tail) return;
      const release = clean(buffer.slice(0, buffer.length - tail));
      buffer = buffer.slice(buffer.length - tail);
      if (release) emit(release);
    },
    flush() {
      const release = clean(buffer);
      buffer = '';
      if (release) emit(release);
    },
  };
}

function firstDifference(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

function parseEnvelope(text: string): { answer: string; sources: unknown; followUps: string[] } | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  for (const candidate of [text.slice(start), text.slice(start, text.lastIndexOf('}') + 1)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== 'object' || typeof parsed.answer !== 'string') continue;
      const followUps = Array.isArray(parsed.follow_up_questions)
        ? parsed.follow_up_questions.filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, MAX_FOLLOW_UPS)
        : [];
      return { answer: parsed.answer, sources: parsed.sources, followUps };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** The requested model, the default, then the cheapest other enabled model. */
export function failoverChain(models: AiModelLike[], requested: string): string[] {
  const chain: string[] = [requested];
  const push = (id?: string) => {
    if (id && !chain.includes(id)) chain.push(id);
  };
  push(models.find((m) => m.is_default)?.model_id);
  push([...models].sort((a, b) => a.tier - b.tier || a.model_id.localeCompare(b.model_id)).find((m) => !chain.includes(m.model_id))?.model_id);
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
  if ('fieldErrors' in validated) return json({ error: 'invalid request', fieldErrors: validated.fieldErrors }, 400, headers);
  const request = validated.request;

  // The allowlist is the authority: a tampered request can never reach a model
  // that is not an enabled row, whatever model_pricing still lists.
  const models = await deps.models();
  const fallback = models.find((m) => m.is_default) ?? models[0];
  const chosen = request.model ? models.find((m) => m.model_id === request.model) : fallback;
  if (!chosen) return json({ error: 'unknown or disabled model', fieldErrors: { model: `${request.model} is not an enabled model` } }, 400, headers);
  const effort = request.reasoning && request.reasoning !== 'off' ? request.reasoning : null;
  if (effort && !chosen.efforts.includes(effort)) {
    return json({ error: 'unsupported reasoning effort', fieldErrors: { reasoning: `${chosen.model_id} accepts ${chosen.efforts.join(', ')}` } }, 400, headers);
  }

  // start() runs synchronously inside the constructor, so the sender exists
  // before the turn is launched on the next line.
  let sender!: ChatSender;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sender = createChatSender(controller);
    },
  });

  // The reader is not the turn's lifeline: waitUntil keeps the isolate alive
  // so a turn whose reader went away still finishes and persists.
  const work = runTurn(deps, { request, caller, chosen, effort, models }, sender)
    .catch((e) => {
      log('research_chat.turn_failed', { message: e instanceof Error ? e.message : String(e) });
      sender.send({ error: e instanceof Error ? e.message : 'the turn failed' });
    })
    .then(() => sender.done());
  deps.waitUntil?.(work);

  return new Response(stream, { status: 200, headers: sseHeaders(headers) });
}

interface TurnInput {
  request: ResearchRequest;
  caller: { userId: string; token: string };
  chosen: AiModelLike;
  effort: string | null;
  models: AiModelLike[];
}

async function runTurn(deps: HandlerDeps, t: TurnInput, sender: ChatSender): Promise<void> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const startedIso = new Date(startedAt).toISOString();
  const { request, caller } = t;

  // 1. Conversation and the idempotency claim, before anything is spent.
  let conversation = request.conversation_id ? await deps.db.getConversation(request.conversation_id) : null;
  if (!conversation) {
    conversation = await deps.db.createConversation({
      title: request.message.replace(/\s+/g, ' ').slice(0, 60),
      desk_tier: request.desk_context?.tier,
      desk_feature: request.desk_context?.feature,
      model_id: t.chosen.model_id,
    });
  }
  const claim = await deps.db.insertUserMessage({ conversation_id: conversation.id, content: request.message, turn_key: request.turn_key });
  if (claim === 'duplicate') {
    sender.send({ duplicate: true });
    return;
  }
  sender.send({ conversation: { id: conversation.id, title: conversation.title } });

  // 2. Prompt inputs.
  const handles = createHandleAssigner();
  const evidence: EvidenceMap = new Map();
  const [persona, history] = await Promise.all([
    deps.persona(caller.userId).catch(() => ''),
    deps.db.recentMessages(conversation.id).catch(() => []),
  ]);
  const { window, dropped } = windowMessages(history.slice(0, -1));
  if (dropped > 0) sender.send({ notice: { kind: 'window', dropped } });

  let selectionBlock: { handle: string; tier: string; feature: string; recordText: string } | undefined;
  if (request.selection) {
    const rowKey = deskRowKey(request.selection.row);
    const stored = await deps.db.findDeskRow(request.selection.tier, request.selection.feature, rowKey).catch(() => null);
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
  const attachments: RenderedAttachment[] = request.attachments.map((a) => ({ kind: a.kind, title: a.title, text: a.text }));
  const userTurn = buildUserTurn(request.message, attachments);
  const scopedDocumentIds = await deps.db.resolveDocumentIds(documentKeysOf(request)).catch(() => []);

  // 3. Cancellation is an explicit act; a closed connection merely detaches a reader.
  const abort = new AbortController();
  let cancelled = false;
  const pollMs = deps.cancelPollMs ?? CANCEL_POLL_MS;
  const poll = setInterval(() => {
    deps.db
      .cancelRequestedSince(conversation!.id, startedIso)
      .then((hit) => {
        if (!hit || cancelled) return;
        cancelled = true;
        abort.abort();
      })
      .catch(() => {});
  }, pollMs);

  // 4. Run the loop, streaming as it goes.
  const decoder = createAnswerDecoder();
  const activity: unknown[] = [];
  const gate = createReasoningGate((text) => {
    sender.send({ reasoning: text });
    for (const segment of segmentReasoning(text)) activity.push({ type: 'reasoning', text: segment });
  });
  let streamed = '';
  let searchMs = 0;
  let writingStart = 0;
  let writingEnd = 0;
  const attempts: { model: string; startedAt: number }[] = [];

  const onEvent = (e: AgentEvent) => {
    if ('internalReasoning' in e) gate.push(e.internalReasoning);
    else if ('attempt' in e) attempts.push({ model: e.attempt.model, startedAt: now() });
    else if ('tool' in e) {
      const f = e.tool;
      if (f.phase === 'start') sender.send({ tool: { name: f.name, phase: 'start', input: f.input, step: f.step } });
      else {
        searchMs += f.latencyMs;
        sender.send({ tool: { name: f.name, phase: 'end', step: f.step, resultCount: f.resultCount } });
        activity.push({ type: 'tool', name: f.name, input: f.input, step: f.step, resultCount: f.resultCount, latencyMs: f.latencyMs, status: f.status });
      }
    } else if ('text' in e) {
      gate.flush();
      const shown = decoder.push(e.text);
      if (shown) {
        if (!writingStart) writingStart = now();
        writingEnd = now();
        streamed += shown;
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
            signal: abort.signal,
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
      if (abort.signal.aborted) break;
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
  clearInterval(poll);
  gate.flush();

  if (!result) {
    const message = lastError instanceof Error ? lastError.message : 'the model could not be reached';
    if (cancelled) {
      // The reader stopped the turn: keep what they saw, and drop the request
      // so the next turn on this conversation is not cancelled before it starts.
      const messageId = await persist(deps, t, conversation.id, {
        content: streamed,
        sources: [],
        followUps: [],
        activity,
        served,
        status: 'cancelled',
        error: null,
        usage: null,
        timing: timingOf(startedAt, now(), searchMs, writingStart, writingEnd),
      }, sender);
      await deps.db.clearCancellation(conversation.id).catch(() => {});
      if (messageId) sender.send({ done: { message_id: messageId } });
      return;
    }
    sender.send({ error: message, retryable: lastError instanceof ProviderError ? lastError.retryable : false });
    return;
  }

  // 5. The citation ladder over what the model actually produced.
  for (const c of result.chunks) {
    const handle = handles.assign(c.id);
    evidence.set(handle, { kind: 'text', chunk: c });
  }
  for (const row of result.rows) evidence.set(handles.assign(rowSourceKey(row)), { kind: 'row', row });

  const envelope = parseEnvelope(result.text);
  const rawAnswer = envelope?.answer ?? decoder.text ?? '';
  let ladder = applyCitationLadder({ answer: rawAnswer, modelSources: envelope?.sources, evidence });
  const followUps = envelope?.followUps ?? [];
  let repairUsage: Usage | null = null;

  // 6. One cheap pass to put the markers back, when the answer cited nothing.
  if (!cancelled && ladderFired(ladder.flags) && repairWorthwhile(ladder.answer, evidence)) {
    const repairStart = now();
    try {
      const handleOf = (e: Evidence) => {
        for (const [handle, candidate] of evidence) if (candidate === e) return handle;
        return undefined;
      };
      const repaired = await repairCitations({ model: deps.stream }, { answer: ladder.answer, evidence, model: deps.repairModel, signal: abort.signal });
      repairUsage = repaired.usage;
      await logAttempt(deps, t, conversation.id, null, deps.repairModel, repaired.served, repaired.rejected ? 'error' : 'success', repaired.rejected, now() - repairStart, repaired.usage, repaired.generationId, 'citation_repair');
      if (repaired.text) {
        const second = applyCitationLadder({ answer: repaired.text, modelSources: repairSources(repaired.byNumber, handleOf), evidence });
        if (second.sources.length > ladder.sources.length) ladder = second;
      }
    } catch (e) {
      log('research_chat.repair_failed', { message: e instanceof Error ? e.message : String(e) });
    }
  }

  // 7. What streamed and what is true can differ once markers are renumbered.
  if (ladder.answer !== streamed) {
    const from = firstDifference(streamed, ladder.answer);
    sender.send({ patch: { from, text: ladder.answer.slice(from) } });
  }
  if (result.continuations > 0 && result.finish === 'length') sender.send({ truncated: { reason: 'length', continuations: result.continuations } });

  const timing = timingOf(startedAt, now(), searchMs, writingStart, writingEnd);
  const usage = totalUsage(result.usage, repairUsage);
  const messageId = await persist(deps, t, conversation.id, {
    content: ladder.answer,
    sources: ladder.sources,
    followUps,
    activity,
    served,
    status: cancelled ? 'cancelled' : 'complete',
    error: null,
    usage,
    timing,
  }, sender);

  if (messageId) {
    await deps.telemetry
      .logTurnTraces(
        turnTraceRows({
          userId: caller.userId,
          conversationId: conversation.id,
          messageId,
          steps: result.steps as TraceStep[],
          answer: { latencyMs: writingEnd && writingStart ? writingEnd - writingStart : 0, modelCallLogId: null, aborted: cancelled },
        }),
      )
      .catch(() => {});
  }
  await logAttempt(deps, t, conversation.id, messageId, t.chosen.model_id, served, cancelled ? 'aborted' : 'success', null, now() - startedAt, lastUsage(result.usage), null);

  if (!cancelled) {
    sender.send({ sources: ladder.sources });
    if (followUps.length) sender.send({ followUpQuestions: followUps });
  }
  sender.send({ timing });
  if (messageId) sender.send({ done: { message_id: messageId } });
  if (cancelled) await deps.db.clearCancellation(conversation.id).catch(() => {});
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

function timingOf(startedAt: number, endedAt: number, searchMs: number, writingStart: number, writingEnd: number): Timing {
  const total = Math.max(0, endedAt - startedAt);
  const writing = writingStart && writingEnd ? Math.max(0, writingEnd - writingStart) : 0;
  const search = Math.min(searchMs, total);
  return { search_ms: Math.round(search), writing_ms: Math.round(writing), reasoning_ms: Math.max(0, Math.round(total - search - writing)), total_ms: Math.round(total) };
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

async function persist(
  deps: HandlerDeps,
  t: TurnInput,
  conversationId: string,
  a: {
    content: string;
    sources: CitationSource[];
    followUps: string[];
    activity: unknown[];
    served: string | null;
    status: 'complete' | 'cancelled' | 'error';
    error: string | null;
    usage: Record<string, unknown> | null;
    timing: Timing | null;
  },
  sender: ChatSender,
): Promise<string | null> {
  try {
    const { id } = await deps.db.insertAssistantMessage({
      conversation_id: conversationId,
      content: a.content,
      sources: a.sources,
      follow_ups: a.followUps,
      activity: a.activity,
      model_requested: t.chosen.model_id,
      model_served: a.served,
      reasoning_effort: t.effort,
      status: a.status,
      error_message: a.error,
      usage: a.usage,
      timing: a.timing,
    });
    await deps.db.touchConversation(conversationId).catch(() => {});
    return id;
  } catch (e) {
    sender.send({ saveFailed: { stage: 'assistant_message', detail: e instanceof Error ? e.message : String(e) } });
    return null;
  }
}
