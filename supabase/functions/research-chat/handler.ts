import { reviewLawAnswer, lawReviewReasoning, LAW_REVIEW_RESERVE_MS } from './lawAnswer.ts';
import { placeholderAnswer, placeholderPrefix } from './answerValidation.ts';
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
import { citedPageRefs, type PageEvidence, pageEvidenceMaps, type PageEvidenceRows } from '../_shared/citations.ts';
import { deskRecordText, deskRowKey } from '../_shared/deskRows.ts';
import { createHandleAssigner } from '../_shared/handles.ts';
import { HttpError } from '../_shared/http.ts';
import { isConversational } from './conversational.ts';
import { isContextQuestion, presearchFor, requiresWebContext } from './turnScope.ts';
import { checkLinks, decideWebSearch, webModelAllowed, type WebScope, webSourcesOf } from './webPolicy.ts';
import { normaliseUrl, WEB_PAGES_PER_TURN, WEB_SEARCHES_PER_TURN, webDomain, type WebSource } from '../_shared/webSearch.ts';
import { log } from '../_shared/logging.ts';
import { type Message, type ModelEvent, ProviderError, type StreamRequest } from '../_shared/openrouterStream.ts';
import type { Chunk } from '../_shared/retrieval.ts';
import type { DeskRow, DeskRowsResult, SearchDeskRowsArgs } from '../_shared/tools/searchDeskRows.ts';
import {
  type AgentCheckpoint,
  type AgentEvent,
  type AgentResult,
  BUDGET,
  createAgentBudget,
  createAgentCheckpoint,
  type DocumentSearchArgs,
  rowSourceKey,
  runAgent,
  TOOL_REPLY_CHARS,
  type TraceStep,
  type WidenedScope,
} from './agent.ts';
import { createAnswerDecoder, undoDoubleEscapes } from './answerStream.ts';
import { buildSystemPrompt, buildUserTurn, type RenderedAttachment } from './prompt.ts';
import { repairCitations, repairSources, repairWorthwhile } from './repair.ts';
import {
  applyCitationLadder,
  type Evidence,
  type EvidenceMap,
  type LadderInput,
  ladderFired,
  UNCITED_ANSWER_CHARS,
} from './sources.ts';
import {
  type AttemptRecorder,
  createAttemptRecorder,
  type GenerationCost,
  type LateCost,
  type Pricing,
  recoverLateCosts,
  type TelemetryDb,
  turnTraceRows,
} from './telemetry.ts';
import {
  type ClaimedTurn,
  executeClaimedTurn,
  fingerprintRequest,
  type TerminalResult,
  type TurnExecution,
  type TurnState,
  type TurnStore,
} from './persistence.ts';
import {
  type Attachment,
  DEFAULT_REASONING,
  documentIdsOf,
  documentKeysOf,
  type Focus,
  type ResearchRequest,
  validateRequest,
} from './validate.ts';

export const WINDOW_CHARS = 60_000;
export const CANCEL_POLL_MS = 2_000;
export const MAX_FOLLOW_UPS = 3;
/** A live page's title on the wire (web-search-streaming spec §2): one line, at most this long. */
const LIVE_TITLE_MAX = 200;
type WebProgressPage = { url: string; title: string; domain: string };

export interface AiModelLike {
  model_id: string;
  label?: string;
  efforts: string[];
  is_default: boolean;
  tier: number;
  /** The lowest plan that may use the model (F150); a row without one needs a paid plan. */
  min_plan?: string;
  params?: Record<string, unknown>;
}

/** The plan columns of the caller's user_profiles row, read with the service client (F150). */
export interface ProfilePlan {
  plan: string;
  plan_status: string;
  plan_period_end: string | null;
  /** Effective model access only; never used to allocate or extend credits. */
  access_until?: string | null;
  /** The account status: my_entitlement() reports nothing for an account that is not active. */
  status: string;
  /** Whether the caller is a platform admin, from is_platform_admin() asked as the caller. */
  admin?: boolean;
}

/** Plans in ascending order (F150). */
export const PLAN_RANK: Record<string, number> = { free: 0, plus: 1, pro: 2, max: 3 };

/**
 * The plan the caller may use now, as public.my_entitlement() reports it through
 * public.entitlement_from(): a paid plan whose period has ended is free, and an account
 * without an active profile has no entitlement, so it is treated as free.
 */
export function effectivePlanRank(row: ProfilePlan | null, now: number): number {
  if (!row || row.status !== 'active') return PLAN_RANK.free;
  // Owner 2026-10-15: "Yes they can bypass. Only admins." An active platform admin may use any model.
  if (row.admin === true) return PLAN_RANK.max;
  const access = Date.parse(row.access_until || '');
  const paid = Date.parse(row.plan_period_end || '');
  const deadline = Number.isFinite(access) ? access : Number.isFinite(paid) ? paid
    : row.access_until || row.plan_period_end ? 0 : NaN;
  if (row.plan_status !== 'free' && Number.isFinite(deadline) && deadline <= now) {
    return PLAN_RANK.free;
  }
  return PLAN_RANK[row.plan] ?? PLAN_RANK.free;
}

/** The rank a model requires: the database default (plus) when unset, beyond every plan when unknown. */
function requiredPlanRank(model: AiModelLike): number {
  return PLAN_RANK[model.min_plan ?? 'plus'] ?? Number.POSITIVE_INFINITY;
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
  /** The scope of a turn, resolved once: the documents whose
   * metadata->>'document_key' is one of `keys`, and the documents in `ids`,
   * keeping only those with indexed_at set. Distinct ids. An unindexed
   * document is dropped, so it discloses as unresolved rather than scoping
   * every search to a document with nothing to search. */
  resolveDocumentIds(scope: { keys: string[]; ids: string[] }): Promise<string[]>;
  /** The stored row, so a client-supplied selection can be trusted before it is cited. */
  findDeskRow(tier: string, feature: string, rowKey: string): Promise<DeskRow | null>;
  /** The keys among `keys` that name a document with indexed_at set: what decides whether a
   * record in scope has embeddings (web-search spec §1). */
  indexedDocumentKeys(keys: string[]): Promise<string[]>;
  /** The conversation's web-search globe override (web-search spec §1). With `requested`, stores
   * it and returns it; without, reads the stored value. Null is automatic. */
  webSearchOverride(conversationId: string, requested?: boolean): Promise<boolean | null>;
}

/** One desk module that has indexed documents: `documents.desk_tier` and `documents.desk_feature`, verbatim. */
export interface DocumentModule {
  desk_tier: string;
  desk_feature: string;
}

/** The document scope a desk module gives a turn: exact `documents` values, so they can filter. */
export interface FeatureScope {
  tier: string;
  feature: string;
}

/**
 * A document search as it reaches retrieval. `desk_feature` is never the
 * model's: the tool schema has no such key. It is set by the server from a
 * FeatureScope, always with that scope's tier as `desk_tier`.
 */
export type ScopedSearchArgs = DocumentSearchArgs & { desk_feature?: string };

export interface RetrievalContext {
  signal: AbortSignal;
  /** Passages to ask for; set on a widened search only (agent WIDENED_TOP_K), else retrieval's default. */
  topK?: number;
  onTiming?: (phase: 'embeddingMs' | 'retrievalMs', ms: number) => void;
  beginEmbeddingAttempt(model: string): ReturnType<AttemptRecorder['beginEmbeddingAttempt']>;
}

/** What reserve_turn_credits answered (AI credits spec §3, §12), as far as the handler needs it. */
export interface CreditReservation {
  /** False when the user had nothing available: no hold was made and the turn does not start. */
  ok: boolean;
  /** The wallet balance in credits, for the 402 body. */
  balance: number | null;
}

/** What settle_turn_credits answered: `pending` while the message still runs inside its deadline. */
export interface CreditSettlement {
  state: 'pending' | 'charged' | 'free';
  /** Credits charged to the turn so far; null while pending. */
  credits: number | null;
}

/** The credit gate (AI credits spec §3), enforced for everyone. Both calls are bounded by the wiring
 * and reject on any failure. */
export interface CreditsGate {
  reserve(userId: string, turnKey: string): Promise<CreditReservation>;
  settle(userId: string, turnKey: string): Promise<CreditSettlement>;
}

export interface HandlerDeps {
  requireUser(req: Request): Promise<{ userId: string; token: string }>;
  credits: CreditsGate;
  models(): Promise<AiModelLike[]>;
  /** The caller's plan columns, or null without a profile (F150). Read only for a model above Free. */
  plan(userId: string): Promise<ProfilePlan | null>;
  pricing(modelId: string): Promise<Pricing | null>;
  /** The system persona prompt; `probe` is the admin persona probe, honoured only for admins. */
  persona(userId: string, probe?: string): Promise<string>;
  catalogue(tier?: string): string;
  /** Desk modules with indexed source documents, as the exact
   * `(desk_tier, desk_feature)` pairs `documents` holds. Read from the corpus,
   * not configured, so it cannot drift away from what search_documents can
   * reach. The prompt's coverage line and the desk feature scope both use it. */
  documentModules(): Promise<DocumentModule[]>;
  db: UserDb;
  persistence: TurnStore;
  executeTurn?: (context: TurnExecution) => Promise<TerminalResult>;
  telemetry: TelemetryDb;
  /** One lookup of OpenRouter's cost for a generation by id, for the round Stop cut off (AI credits
   * spec §3.1); polled by a background job kept alive through waitUntil. */
  generationCost?: GenerationCost;
  /** The background job's timer; tests pass a fake. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  stream(req: StreamRequest): AsyncGenerator<ModelEvent>;
  searchDocuments(args: ScopedSearchArgs, documentIds?: string[], context?: RetrievalContext): Promise<Chunk[]>;
  searchDeskRows(args: SearchDeskRowsArgs, context?: Pick<RetrievalContext, 'signal'>): Promise<DeskRowsResult>;
  /** The page contract's evidence for cited page chunks: document_page_blocks
   * and document_page_images rows by id. Called at most once per turn, only
   * when a cited chunk links blocks or images; a rejection costs the citations
   * their boxes and images, never the turn. */
  pageEvidence(ids: { blockIds: string[]; imageIds: string[] }, signal?: AbortSignal): Promise<PageEvidenceRows>;
  repairModel: string;
  /** answer-speed spec §1: search with the question before the first model call. On in
   * production (index.ts); the scripted handler tests opt in, since their model scripts are
   * written call by call. */
  presearch?: boolean;
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
      typeof parsed.answer !== 'string' || !parsed.answer.trim() || placeholderAnswer(parsed.answer)
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

/** The reasoning count a stream frame carries: measured, partial, or null when unknown (F67). */
function reasoningUsage(usage: { reasoning_tokens?: unknown; observed?: { reasoning_tokens?: unknown } } | null | undefined):
  { reasoning_tokens: number; partial?: true } | null {
  const known = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const total = known(usage?.reasoning_tokens);
  if (total !== null) return { reasoning_tokens: total };
  const observed = known(usage?.observed?.reasoning_tokens);
  return observed !== null ? { reasoning_tokens: observed, partial: true } : null;
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
  // Reasoning is on unless the caller turns it off. Every enabled model
  // advertises low/medium/high, and every turn ran with reasoning_tokens 0
  // because the picker's default is 'off' and the client omits the field
  // entirely for it - so an omitted field and a deliberate "No reasoning" were
  // the same request. They are not the same intent, and the default that
  // matters is the one an omitted field gets. The tender agent reaches the same
  // place from the other direction: it sends effort 'low' on every call, and
  // deleted its think tool because thinking tokens made it redundant - which
  // this one has now done too, on its own evidence.
  //
  // A default must never be able to reject a request, so an effort the chosen
  // model does not accept is dropped here; only an effort the caller asked for
  // by name is worth a 400.
  const asked = request.reasoning ?? DEFAULT_REASONING;
  const wanted = asked === 'off' ? null : asked;
  const effort = wanted && !chosen.efforts.includes(wanted) && request.reasoning === undefined ? null : wanted;
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

  // F150: model access is per model. The caller's effective plan is read from the database for the
  // verified caller, never from the request, whenever the chosen model or any failover the chain
  // could reach is above Free; a chain of Free models never reads it. The chosen model is checked
  // before reserve, so a refused turn holds and creates nothing, and the failover chain is built
  // only from the models the plan allows, so a paid model never answers for a Free caller.
  let allowedModels = models;
  if (failoverChain(models, chosen.model_id).some((id) => requiredPlanRank(models.find((m) => m.model_id === id)!) > PLAN_RANK.free)) {
    let rank: number;
    try {
      // Wall-clock time: deps.now is the turn's timing clock, not the date a plan lapses on.
      rank = effectivePlanRank(await deps.plan(caller.userId), Date.now());
    } catch {
      log('research_chat.plan_unavailable');
      return json({ error: 'Your plan could not be checked.', code: 'plan_unavailable' }, 503, headers);
    }
    if (rank < requiredPlanRank(chosen)) {
      return json({ error: 'This model is available on paid plans.', code: 'model_requires_plan' }, 403, headers);
    }
    allowedModels = models.filter((m) => requiredPlanRank(m) <= rank);
  }

  // AI credits (spec §3), enforced for everyone: reserve before the claim, so a blocked turn creates
  // no message. A replay was answered above and never reserves; a retry of this turn key gets its
  // own hold back. Any failure fails closed: the turn does not start.
  let reservation: CreditReservation;
  try {
    reservation = await deps.credits.reserve(caller.userId, request.turn_key);
  } catch {
    log('research_chat.credits_unavailable', { stage: 'reserve' });
    return json({ error: 'AI credits could not be checked.', code: 'credits_unavailable' }, 503, headers);
  }
  if (!reservation.ok) {
    // Blocked with a positive balance means answers still running hold it (spec §3 step 1).
    const held = reservation.balance !== null && reservation.balance > 0;
    return json(
      held
        ? {
          error: 'Your credits are in use by an answer that is still running. Try again when it finishes.',
          code: 'credits_exhausted',
          balance: reservation.balance,
          held: true,
        }
        : {
          error: 'You have no AI credits left to start an answer.',
          code: 'credits_exhausted',
          balance: reservation.balance,
        },
      402,
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
    releaseHold(deps, caller.userId, request.turn_key);
    return json({ error: 'Turn persistence unavailable' }, 503, headers);
  }
  if (claim.kind !== 'claimed') {
    // A replay of an existing turn shares that turn's hold, which its own request settles. Any other
    // answer started nothing, so this request's hold is released now rather than at its expiry.
    if (claim.kind !== 'running' && claim.kind !== 'terminal') releaseHold(deps, caller.userId, request.turn_key);
    return replayTurn(claim, headers);
  }
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
  const attempts = createAttemptRecorder({
    userId: caller.userId,
    conversationId: claimed.conversation.id,
    messageId: claimed.assistant.id,
    // P3: the effort this turn asked for, on every row; 'off' when it asked for none.
    reasoningEffort: effort ?? 'off',
    pricing: deps.pricing,
    db: deps.telemetry,
    now: deps.now,
  });
  // Transport activity only: silent reasoning must not look like a dead connection.
  const heartbeat = setInterval(() => sender.heartbeat(), 15_000);
  const work = executeClaimedTurn({
    store: deps.persistence,
    ownerId: caller.userId,
    turnKey: request.turn_key,
    claim: claimed,
    execute: deps.executeTurn ??
      ((context) => runTurn(deps, { request, caller, chosen, effort, models: allowedModels }, liveSender, context, attempts)),
  }).then((saved) => {
    if (saved.kind !== 'terminal') throw new Error('Terminal result not saved');
    sendTerminal(sender, saved, visible);
  }).catch(() => {
    sender.send({ saveFailed: { stage: 'assistant_message', detail: 'Turn persistence unavailable' } });
  }).then(async () => {
    try {
      // Accounting is bounded and follows the durable write, even if that write failed.
      try {
        await attempts.flush();
      } catch {
        log('research_chat.telemetry_failed', { stage: 'flush' });
      }
      // Settle charges the rows the flush just wrote (AI credits spec §3 step 4). The terminal frame
      // has already gone, so this adds no answer latency; the credits go in a frame of their own,
      // dropped quietly by the sender if the reader has already stopped at `done`. A round Stop cut
      // off is still waiting for its cost, which the sweep charges later: settle charges the rest,
      // but the turn's credits are not final, so the frame says null rather than a short total.
      const awaitingCost = attempts.lateCosts().length > 0;
      const settled = await settleCredits(deps.credits, caller.userId, request.turn_key);
      if (awaitingCost) log('research_chat.credits_pending', { stage: 'late_cost' });
      sender.send({ credits: awaitingCost ? null : settled });
    } finally {
      clearInterval(heartbeat);
      sender.done();
    }
    // With the stream closed: the rounds Stop cut off have no cost yet, and OpenRouter has it only
    // seconds later (spec §3.1). A background job sets it on their rows; the hold's sweep charges it.
    scheduleLateCosts(deps, attempts.lateCosts());
  });
  deps.waitUntil?.(work);

  return new Response(stream, { status: 200, headers: sseHeaders(headers) });
}

/** Starts the background job for cut-off rounds, kept alive by waitUntil. Without the means to run
 * it the rows stay uncharged, and say so. Never throws. */
function scheduleLateCosts(deps: HandlerDeps, pending: LateCost[]): void {
  if (!pending.length) return;
  const save = deps.telemetry.saveGenerationCost?.bind(deps.telemetry);
  if (!deps.waitUntil || !deps.generationCost || !save) {
    for (const _ of pending) log('research_chat.aborted_cost_unknown', { stage: 'unscheduled' });
    return;
  }
  deps.waitUntil(recoverLateCosts(pending, { lookup: deps.generationCost, save, now: deps.now, sleep: deps.sleep }));
}

/** Releases the hold of a request whose claim started no turn (review R, M1), so it does not block
 * the user's next answer until it expires. Settle answers `pending` for a turn still running, so a
 * live hold is never released. Fire-and-forget: bounded by the wiring like any settle, kept alive by
 * waitUntil, and a failure is only logged; the hold's sweep releases it at expiry anyway. */
function releaseHold(deps: HandlerDeps, userId: string, turnKey: string): void {
  const release = Promise.resolve()
    .then(() => deps.credits.settle(userId, turnKey))
    .then(() => {}, () => log('research_chat.credits_release_failed'));
  deps.waitUntil?.(release);
}

/** The turn's credits to 2 dp, or null when settlement is pending or failed. Never throws: a settle
 * error or timeout (bounded by the wiring) is logged and the hold's sweep finishes the job. */
async function settleCredits(credits: CreditsGate, userId: string, turnKey: string): Promise<number | null> {
  try {
    const settled = await credits.settle(userId, turnKey);
    if (settled.state === 'pending' || settled.credits === null) {
      log('research_chat.credits_pending');
      return null;
    }
    return Math.round(settled.credits * 100) / 100;
  } catch {
    log('research_chat.credits_settle_failed');
    return null;
  }
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

/**
 * The header on an answer nothing backs. It states which of the two happened -
 * the record was never searched, or it was and returned nothing - because those
 * are different facts and the reader can act on the difference.
 */
function unverifiedNote(searches: number, webPages = 0): string {
  // F130: with web pages behind it, the answer is not unbacked - it is backed by the web, not the
  // record, and the reader is told so, and that those pages are unofficial.
  if (webPages > 0) {
    return '**Not from the record.** Nothing below is backed by Niyantran\'s records; it draws on the web sources listed above the answer, which are unofficial.';
  }
  return searches > 0
    ? '**Unverified.** The searches this turn ran returned no passages, so nothing below is backed by the record.'
    : '**Unverified.** Nothing was retrieved this turn, so nothing below is backed by the record. Earlier answers in this conversation are not evidence.';
}

/**
 * The header on an answer whose evidence came from outside the scope the turn
 * asked for. Same reason as the unverified note: the ways a turn leaves its
 * scope are different facts - the document had no matching passage, the corpus
 * holds no document for it at all, nothing named a document, or the desk
 * module held nothing - and the reader can act on the difference. Without this
 * the widening is invisible, which is how "Attached only" returned passages
 * from fifteen other bills. Each text names the scope that was actually left,
 * so a module is never called an attachment.
 */
const WIDENED_NOTE: Record<Exclude<WidenedScope, 'feature-empty'>, string> = {
  empty:
    '**Search widened.** The attached documents held no matching passage, so this turn searched the whole record. What is cited below is not confined to what you attached.',
  unresolved:
    '**Search widened.** The record holds no indexed source document for the attached material, so this turn searched the whole record. What is cited below is not confined to what you attached.',
  // The reported case: a desk module attached, the bill asked about only
  // selected in the table, and the selection gone after a reload. Saying the
  // corpus had no document for it sent the reader looking for a missing bill
  // that was indexed all along.
  unkeyed:
    '**Search widened.** Nothing attached to this turn names a source document - a desk module or an uploaded file does not - so this turn searched the whole record. Drag a bill\'s row into the chat to confine the search to that bill.',
};
/** `module` is the desk module the turn was filtered to; only 'feature-empty' uses it. */
function widenedNote(reason: WidenedScope, module?: string): string {
  return reason === 'feature-empty'
    ? `**Search widened.** Nothing in ${module || 'the open desk module'} matched, so all documents were searched.`
    : WIDENED_NOTE[reason];
}

/** Every terminal frame reflects the row returned by finalization/replay. */
function sendTerminal(
  sender: Pick<ChatSender, 'send'>,
  saved: Extract<TurnState, { kind: 'running' | 'terminal' }>,
  visible: string,
  forcePatch = false,
): void {
  const row = saved.assistant;
  if (row.model_requested) sender.send({ model: {
    requested: row.model_requested, served: row.model_served, reason: 'saved',
  } });
  if (forcePatch || row.content !== visible) {
    const from = forcePatch ? 0 : firstDifference(visible, row.content);
    sender.send({ patch: { from, text: row.content.slice(from) } });
  }
  if (row.status === 'complete' || row.status === 'truncated') {
    sender.send({ sources: row.sources });
    if (Array.isArray(row.web_sources) && row.web_sources.length) sender.send({ webSources: row.web_sources });
    if (row.follow_ups.length) sender.send({ followUpQuestions: row.follow_ups });
  }
  // The reasoning count goes with the timing, so the live summary's "thought" or "waited" matches
  // the saved row's (chat-panel-fixes, F47).
  // F67 (F171 B11): unknown stays unknown (null), and a partial count says it is partial, as the saved
  // row does (src/lib/aiConversations.js reasoningUsage); it was coerced to a measured zero.
  if (row.timing) sender.send({ timing: row.timing, usage: reasoningUsage(row.usage) });
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

/** Lowercase, punctuation (including `/`) as spaces, whitespace collapsed:
 * the catalogue's "Regulatory (RBI/SEBI/TRAI/CCI)" and the corpus's
 * "Regulatory (RBI SEBI TRAI CCI)" are the same module. */
function moduleName(s: string): string {
  return s.toLowerCase().replace(/[\p{P}/]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The desk module a desk-focused turn is confined to, as the exact
 * `documents` values, or undefined when the open module has no indexed
 * documents (most of them) - in which case nothing is filtered and nothing is
 * disclosed, because the coverage line already tells the model. Matched on
 * tier and feature together: module names repeat across tiers.
 */
export function featureScopeOf(
  request: { focus: Focus; desk_context?: { tier: string; feature?: string } },
  modules: DocumentModule[],
): FeatureScope | undefined {
  const context = request.desk_context;
  if (request.focus !== 'desk' || !context?.feature) return undefined;
  const tier = moduleName(context.tier);
  const feature = moduleName(context.feature);
  if (!tier || !feature) return undefined;
  const match = modules.find((m) => moduleName(m.desk_tier) === tier && moduleName(m.desk_feature) === feature);
  return match ? { tier: match.desk_tier, feature: match.desk_feature } : undefined;
}

/**
 * What the prompt is given for an attachment. A document chip is a pointer:
 * its title and kind reach the prompt, never its id and never corpus text -
 * the turn's document scope is what keeps the searches inside it.
 */
function promptAttachment(a: Attachment): RenderedAttachment {
  if (a.kind !== 'document') return { kind: a.kind, title: a.title, text: a.text };
  return { kind: a.kind, title: a.title };
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
  attempts: AttemptRecorder,
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
  const onAbort = () => {
    const usage = attempts.summary();
    context.checkpoint({ usage });
    resolveAbort({
      ...partial,
      usage,
      status: context.signal.aborted ? 'interrupted' : 'cancelled',
      error_message: context.signal.aborted ? 'Execution interrupted.' : null,
    });
  };
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
      }, attempts),
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
  attempts: AttemptRecorder,
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
    deps.persona(caller.userId, request.persona_probe),
    deps.db.recentMessages(conversation.id, [context.claim.user_message_id, context.claim.assistant.id]),
  ]);
  signal.throwIfAborted();
  const { window, dropped } = windowMessages(history);
  if (dropped > 0) sender.send({ notice: { kind: 'window', dropped } });

  let selectionBlock: { handle: string; tier: string; feature: string; recordText: string } | undefined;
  // The selected record's document key, the stored row's when the server can confirm the row.
  let selectionKey: string | null = request.selection?.document_key ?? null;
  if (request.selection) {
    const rowKey = deskRowKey(request.selection.row);
    const stored = await deps.db.findDeskRow(request.selection.tier, request.selection.feature, rowKey);
    if (stored) {
      // Only a row the server can confirm becomes citable evidence.
      const handle = handles.assign(rowSourceKey(stored));
      evidence.set(handle, { kind: 'row', row: { ...stored, snapshot_at: stored.snapshot_at || '' } });
      selectionBlock = { handle, tier: stored.tier, feature: stored.feature, recordText: stored.record_text };
      selectionKey = stored.document_key ?? selectionKey;
    } else {
      selectionBlock = {
        handle: 'the selected record (user-supplied, not citable)',
        tier: request.selection.tier,
        feature: request.selection.feature,
        recordText: deskRecordText(request.selection.row),
      };
    }
  }

  // A corpus fact, and a cheap one: cached for the isolate and never fatal. A
  // turn is still answerable without it, so a failure here costs the coverage
  // line, not the turn.
  let modulesKnown = true;
  const modules = await deps.documentModules().catch(() => {
    modulesKnown = false;
    return [] as DocumentModule[];
  });
  // The coverage line names modules, not tiers: a name on two tiers is listed once.
  const documentModules = [...new Set(modules.map((m) => m.desk_feature.trim()).filter(Boolean))];
  const featureScope = featureScopeOf(request, modules);
  // A greeting carries no question (see the attachments below), so it never searches the web either.
  const conversational = isConversational(request.message);
  // 3. Web search (F130, web-search spec §1): decided once, before the first model call, and said
  //    to the reader. Every lookup here is best-effort; none can fail the turn.
  const [webScope, webOverride] = await Promise.all([
    webScopeOf(deps, request, selectionKey, modules, modulesKnown),
    // A failed read falls back to off, not automatic: "off" may be the reader's privacy choice.
    deps.db.webSearchOverride(conversation.id, request.web_search).catch(() => request.web_search ?? false),
  ]);
  const web = decideWebSearch({
    scope: webScope,
    override: webOverride,
    conversational,
    modelAllowed: webModelAllowed(t.chosen.model_id, t.chosen.params),
  });
  sender.send({ web });
  // Pages searched so far, and the link check every saved text passes (security pass M3): a turn
  // that breaks off or is cancelled saves what it streamed, so that text is checked as well.
  const webSeen: string[] = [];
  // web-search-streaming spec §2: the live pages already sent this turn, and the research round
  // whose web_search start frame has gone out. Display only: never checkpointed, logged or saved.
  const liveSent = new Set<string>();
  let liveRound = 0;
  const safeText = (s: string) =>
    s ? checkLinks(s, [...webSeen, ...evidenceUrls(evidence)], { scanCode: true }).text : s;

  const system = buildSystemPrompt({
    persona,
    today: deps.today?.() ?? new Date(startedAt).toISOString().slice(0, 10),
    catalogue: deps.catalogue(request.desk_context?.tier),
    focus: request.focus,
    selection: selectionBlock,
    documentModules,
    webSearch: web.offered,
  });
  // A greeting carries no question, so the attachments are not context for it -
  // they are the reason a bare "hi" came back as a 2,342-character brief with
  // three follow-up chips. The prompt already asks for no tool and no
  // follow-ups here; withholding the attachments removes what the model was
  // summarising instead of greeting.
  const verifiedHandles = new Set<string>();
  const attachments: RenderedAttachment[] = [];
  if (!conversational) {
    for (const attachment of request.attachments) {
      // A row chip is citable only after its identity is resolved against the
      // database. Never trust its text or an invented browser-supplied handle.
      const stored = (attachment.kind === 'row' || attachment.kind === 'record') &&
          attachment.tier && attachment.feature && attachment.row_key
        ? await deps.db.findDeskRow(attachment.tier, attachment.feature, attachment.row_key)
        : null;
      if (stored) {
        const handle = handles.assign(rowSourceKey(stored));
        evidence.set(handle, { kind: 'row', row: { ...stored, snapshot_at: stored.snapshot_at || '' } });
        verifiedHandles.add(handle);
        attachments.push({ kind: attachment.kind as 'row' | 'record', title: attachment.title, text: stored.record_text, handle });
      } else attachments.push(promptAttachment(attachment));
    }
  }
  // F200: and it is told that it is small talk, so no answer style or persona format turns it into
  // a brief; the agent runs no search for it (agent.ts), so nothing can widen either.
  const userTurn = buildUserTurn(request.message, attachments, verifiedHandles, { smallTalk: conversational });
  const targetRecords = request.focus === 'selection' && request.selection && isContextQuestion(request.message)
    ? webScope.records.slice(-1) : webScope.records;
  const requiredWeb = web.offered && targetRecords.some(r => !r.indexed) &&
    !webScope.documentAttached && requiresWebContext(request.message);
  const documentKeys = documentKeysOf(request);
  const documentIds = documentIdsOf(request);
  const scopedDocumentIds = await deps.db.resolveDocumentIds({ keys: documentKeys, ids: documentIds });

  signal.throwIfAborted();

  // 4. Run the loop, streaming as it goes.
  const decoder = createAnswerDecoder();
  const activity: unknown[] = [];
  let streamed = '';
  let searchMs = 0;
  let writingStart = 0;
  let writingEnd = 0;
  // answer-streaming spec §2: time to the first model call and to the first answer character.
  let firstModelAt = 0;
  let firstAnswerAt = 0;
  let rounds = 0;
  // thinking-display spec §2: each stage is announced once, by what is happening.
  let researchRounds = 0;
  const said = new Set<string>();
  const stage = (label: string) => {
    if (said.has(label)) return;
    said.add(label);
    sender.send({ reasoning: label });
    activity.push({ type: 'activity', text: label });
    context.checkpoint({ activity: [...activity] });
  };

  let served: string | null = null;
  let attemptModel = t.chosen.model_id;
  let responseModel: string | null = null;
  let fallbackReason = 'selected';
  let announcedModel: string | null = null;
  const recordServingModel = (model: string) => {
    if (signal.aborted) return;
    served = model;
    context.checkpoint({ model_served: model });
    if (announcedModel === model) return;
    announcedModel = model;
    sender.send({ model: { requested: t.chosen.model_id, served: model, reason: fallbackReason } });
  };
  // Observe the provider's identity without changing telemetry or retry ownership.
  const observedStream: HandlerDeps['stream'] = async function* (req) {
    responseModel = null;
    yield* deps.stream({ ...req, onAttemptMetadata(metadata) {
      if (metadata.served) responseModel = metadata.served;
      req.onAttemptMetadata?.(metadata);
    } });
  };

  let lawTurn = !conversational && (request.desk_context?.tier === 'law' || request.selection?.tier === 'law' || request.attachments.some(a => a.tier === 'law'));
  const onEvent = (e: AgentEvent) => {
    if (signal.aborted) return;
    if ('lawEvidence' in e) { lawTurn = true; return; }
    if ('internalReasoning' in e) return;
    else if ('retract' in e) {
      // A research draft that was not the answer: take it back from the reader, the checkpoint
      // and the clocks, so a later answer (or another model) starts clean. The reader is cleared
      // with the existing patch frame (from 0, empty), which every client already applies, so the
      // server can ship before or after the frontend (answer-streaming spec, amendment 1).
      if (streamed) sender.send({ patch: { from: 0, text: '' } });
      log('research.draft_retracted', { reason: e.retract, chars: streamed.length });
      decoder.reset();
      streamed = '';
      writingStart = 0;
      writingEnd = 0;
      firstAnswerAt = 0;
      context.checkpoint({ content: '' });
    } else if ('attempt' in e) {
      rounds++;
      if (!firstModelAt) firstModelAt = now();
      // A research round may call no tool at all, so it never claims to be searching; the
      // searches announce themselves. A real turn repeated "Reviewing the question." for
      // each of its six rounds, which is why every label is said once (F46).
      if (e.attempt.phase === 'research') stage(researchRounds++ === 0 ? READING_QUESTION : READING_RESULTS);
      else stage(WRITING);
    } else if ('finish' in e) {
      recordServingModel(e.finish.served || responseModel || attemptModel);
    } else if ('outOfTime' in e) {
      // F199: how often the reserve decides a turn is a question only the logs can answer.
      log('research.out_of_time', { phase: e.outOfTime.phase, cut: e.outOfTime.cut, rounds });
    } else if ('promoted' in e) {
      // The research reply is the answer, so it is the call the answer trace
      // and any later rejection belong to.
      attempts.markLastAnswer('chat_answer');
    } else if ('widened' in e) {
      // The ticker is where the reader watches the turn work, so it is where
      // leaving the attachments has to show; the answer header repeats it for
      // anyone reading the message later.
      const label = widenedLabel(e.widened, featureScope?.feature);
      sender.send({ reasoning: label });
      activity.push({ type: 'activity', text: label });
      context.checkpoint({ activity: [...activity] });
    } else if ('tool' in e) {
      const f = e.tool;
      if (f.phase === 'start') {
        if (f.name === 'search_documents' || f.name === 'search_desk_rows') {
          attempts.addTraces([{
            user_id: caller.userId,
            conversation_id: conversation.id,
            message_id: messageId,
            step_index: f.step,
            step_type: f.name,
            input: JSON.stringify(f.input).slice(0, 2_000),
            result_count: null,
            top_similarity: null,
            latency_ms: null,
            chunk_ids: null,
            row_keys: null,
            model_call_log_id: null,
            aborted: true,
            error_message: null,
          }]);
        }
        sender.send({ tool: { name: f.name, phase: 'start', input: f.input, step: f.step, ...(f.requestedTopK === undefined ? {} : { requestedTopK: f.requestedTopK }) } });
      } else {
        attempts.addTraces(
          turnTraceRows({ userId: caller.userId, conversationId: conversation.id, messageId, steps: [f] }),
        );
        searchMs += f.latencyMs;
        const found = f.found ? { found: f.found } : {};
        const measurements = { latencyMs: f.latencyMs, status: f.status,
          ...(f.requestedTopK === undefined ? {} : { requestedTopK: f.requestedTopK }),
          ...(f.embeddingMs === undefined ? {} : { embeddingMs: f.embeddingMs }),
          ...(f.retrievalMs === undefined ? {} : { retrievalMs: f.retrievalMs }),
        };
        sender.send({ tool: { name: f.name, phase: 'end', step: f.step, resultCount: f.resultCount, ...measurements, ...found } });
        activity.push({
          type: 'tool',
          name: f.name,
          input: f.input,
          step: f.step,
          resultCount: f.resultCount,
          ...measurements,
          ...found,
        });
      }
    } else if ('webProgress' in e) {
      // Pages a running research call's searches returned (web-search-streaming spec §2). The
      // ticker says "Searching the web…" from the first one: a start frame with the step the end
      // frame below will use. The start is not saved; saved steps are end-only.
      if (liveRound !== rounds) {
        liveRound = rounds;
        sender.send({ tool: { name: 'web_search', phase: 'start', step: rounds } });
      }
      const pages: WebProgressPage[] = [];
      for (const page of e.webProgress.pages) {
        if (liveSent.size >= WEB_PAGES_PER_TURN) break;
        const url = normaliseUrl(page.url);
        if (!url?.startsWith('https://') || liveSent.has(url)) continue;
        liveSent.add(url);
        const title = String(page.title ?? '').replace(/\s+/g, ' ').trim().slice(0, LIVE_TITLE_MAX);
        pages.push({ url, title: title || url, domain: webDomain(url) });
      }
      if (pages.length) sender.send({ webProgress: { pages } });
    } else if ('web' in e) {
      // A research call that searched the web (spec §4, §5): one ticker step, one trace row.
      const w = e.web;
      webSeen.push(...w.pages.map((p) => p.url));
      // Written now, like the other tool steps, so a turn that fails later keeps it (spec §5). The
      // round number keeps each call's row distinct.
      const [traceRow] = turnTraceRows({
        userId: caller.userId,
        conversationId: conversation.id,
        messageId,
        steps: [],
        web: [{ attemptIndex: attempts.lastAttemptIndex('chat_answer'), searches: w.searches, pagesAdded: w.pages.length, latencyMs: w.latencyMs }],
      });
      attempts.addTraces([{ ...traceRow, step_index: rounds }]);
      const step = { name: 'web_search', step: rounds, resultCount: w.pages.length, searches: w.searches, latencyMs: w.latencyMs, status: 'ok' as const };
      sender.send({ tool: { ...step, phase: 'end' } });
      activity.push({ type: 'tool', ...step, phase: 'end' });
      context.checkpoint({ activity: [...activity] });
    } else if ('text' in e || 'draftText' in e) {
      decoder.push('text' in e ? e.text : e.draftText);
      const shown = lawTurn || placeholderPrefix(decoder.text) ? '' : decoder.text.slice(streamed.length);
      if (shown) {
        // A research reply promoted to the answer has no answer round to announce it.
        stage(WRITING);
        if (!writingStart) writingStart = now();
        if (!firstAnswerAt) firstAnswerAt = now();
        writingEnd = now();
        streamed += shown;
        recordServingModel(responseModel || attemptModel);
        context.checkpoint({ content: safeText(streamed) });
        sender.send({ chunk: shown });
      }
    }
  };

  const budget = createAgentBudget();
  let checkpoint: AgentCheckpoint | undefined;
  const input = {
    system,
    window,
    userTurn,
    scopedDocumentIds,
    focus: request.focus,
    conversational,
    // Search the current subject before the first call, including "this bill"
    // after a selection change. Ambiguous follow-ups keep model-written queries;
    // conversation history must not override a named current selection.
    ...(deps.presearch && !conversational ? { presearch: presearchFor(request, history.length > 0) } : {}),
    // scopeSent: the reader named a document, by key or by id. Whether it
    // resolved is what `scopedDocumentIds` says; this says whether leaving the
    // attachments is "unresolved" or "unkeyed".
    scopeSent: documentKeys.length > 0 || documentIds.length > 0,
    // The desk module's documents, under desk focus. agent.ts applies it after
    // any confinement and ahead of the model's desk_tier.
    ...(featureScope ? { featureScope } : {}),
  };
  const chain = failoverChain(t.models, t.chosen.model_id);
  let result: AgentResult | null = null;
  let schemaDropped = false;
  let structureRetried = false;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    attemptModel = model;
    try {
      checkpoint ??= createAgentCheckpoint(input, handles, budget);
      result = await runAgent(
        {
          request: {
            model,
            signal,
            session_id: conversation.id,
            // F41 option 1 (owner, 2026-10-15): the lowest-latency provider. Measured twice: briefs
            // finish in about 20 s instead of 37 s and cost a third less, citing about one page fewer
            // (docs/research/2026-10-02-turn-cost-benchmark.md).
            providerSort: 'latency',
            ...(effortOf(t, model) ? { reasoning: { effort: effortOf(t, model)! } } : {}),
            ...(schemaDropped ? { response_format: undefined } : {}),
          },
          model: attempts.wrap(observedStream, 'chat_answer'),
          // Document chips need not carry a desk hint. The agent verifies actual
          // scoped Law chunks before handing evidence back, and emits lawEvidence.
          lawEvidenceOnly: request.focus === 'attached' && !web.offered,
          searchDocuments: (args, ids, topK, onTiming) =>
            deps.searchDocuments(args, ids, {
              signal,
              onTiming,
              ...(topK === undefined ? {} : { topK }),
              beginEmbeddingAttempt: (model) => attempts.beginEmbeddingAttempt(model, signal),
            }),
          searchDeskRows: (args) => deps.searchDeskRows(args, { signal }),
          // Offered per model: a failover to a model that may not search withdraws it (spec §1).
          webSearch: web.offered && webModelAllowed(model, t.models.find((m) => m.model_id === model)?.params)
            ? { perTurn: WEB_SEARCHES_PER_TURN, required: requiredWeb }
            : null,
          handles,
          budget,
          checkpoint,
          onEvent,
          now,
          // F199: the answer keeps ANSWER_RESERVE_MS of the execution deadline, and a call that
          // starts inside it runs at the model's low effort. At high effort a document search
          // hands the answer one reply budget of passages, not forty: Gemini Flash at high read
          // forty and was still thinking when the deadline cut it at 108.7 s.
          ...(context.timeLeft ? { timeLeft: () => Math.max(0, context.timeLeft!() - (lawTurn ? LAW_REVIEW_RESERVE_MS : 0)) } : {}),
          ...lateReasoningOf(t, model),
          ...(HIGH_EFFORTS.has(effortOf(t, model) ?? '') ? { toolReplyChars: TOOL_REPLY_CHARS } : {}),
        },
        input,
      );
      served = result.served || served;
      if (!structureRetried && !signal.aborted && !streamed && result.finish === 'stop' &&
          !parseEnvelope(result.text) && budget.modelAttempts < BUDGET.maxSteps &&
          (!context.timeLeft || context.timeLeft() > 0)) {
        // Correct format once, before any answer is visible. Keep retrieved
        // evidence, tool replies, handles and the turn-wide cost/time budgets.
        attempts.rejectLast('chat_answer', 'Answer declined by this server: finish=stop, envelope=absent.');
        structureRetried = true;
        checkpoint.phase = 'answer';
        checkpoint.text = '';
        checkpoint.finish = '';
        checkpoint.resumeAnswer = false;
        checkpoint.messages.push({ role: 'user', content: 'Return the complete answer in the required JSON object with answer, sources and follow_up_questions. Keep the existing evidence and citation rules. Do not repeat searches.' });
        decoder.reset();
        result = null;
        i--;
        continue;
      }
      break;
    } catch (e) {
      // Every abandoned attempt is logged. Without this the turn persists
      // 'The turn failed. Please try a new turn.' and the cause is lost:
      // model_call_logs only carries attempts that reached the provider, so a
      // failure before that left no trace anywhere. Never log the key or the
      // request body; the status and the provider's short message are enough.
      log('research.attempt_failed', {
        model,
        aborted: signal.aborted,
        streamed: streamed.length > 0,
        kind: e instanceof ProviderError ? 'provider' : ((e as Error)?.name ?? 'unknown'),
        ...(e instanceof ProviderError
          ? { status: e.status, code: e.code, retryable: e.retryable, body: e.body.slice(0, 200) }
          : { message: String((e as Error)?.message ?? e).slice(0, 200) }),
      });
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
        if (next) fallbackReason = `unavailable (${e.status})`;
        continue;
      }
      break;
    }
  }

  if (!result) {
    return makeAssistantMessage({
      content: safeText(streamed),
      sources: [],
      followUps: [],
      activity,
      served,
      status: context.signal.aborted ? 'interrupted' : 'error',
      error: context.signal.aborted ? 'Execution interrupted.' : 'The turn failed. Please try a new turn.',
      usage: attempts.summary(),
      timing: timingOf(startedAt, now(), searchMs, writingStart, writingEnd, { firstModelAt, firstAnswerAt, rounds }),
    });
  }

  let envelope = parseEnvelope(result.text);
  const lawEvidenceReady = result.finish === 'law_evidence' && lawTurn &&
    request.focus === 'attached' && scopedDocumentIds.length === 1 && !web.offered &&
    result.chunks.length > 0 && result.chunks.every(c => c.desk_tier === 'law' && c.document_id === scopedDocumentIds[0]);
  if (
    signal.aborted || (!lawEvidenceReady && ((result.finish !== 'stop' && result.finish !== 'length') ||
    (result.finish === 'stop' && !envelope) || (result.finish === 'length' && !streamed.trim())))
  ) {
    attempts.rejectLast(
      'chat_answer',
      signal.aborted ? undefined : `Answer declined by this server: finish=${result.finish}, envelope=${envelope ? 'parsed' : 'absent'}.`,
    );
    return makeAssistantMessage({
      content: safeText(streamed),
      sources: [],
      followUps: [],
      activity,
      served,
      status: signal.aborted ? 'interrupted' : 'error',
      error: 'The turn did not produce a complete answer.',
      usage: attempts.summary(),
      timing: timingOf(startedAt, now(), searchMs, writingStart, writingEnd, { firstModelAt, firstAnswerAt, rounds }),
    });
  }

  // 5. The citation ladder over what the model actually produced.
  for (const c of result.chunks) {
    const handle = handles.assign(c.id);
    evidence.set(handle, { kind: 'text', chunk: c });
  }
  for (const row of result.rows) evidence.set(handles.assign(rowSourceKey(row)), { kind: 'row', row });

  if (lawTurn && result.chunks.some(c => c.desk_tier === 'law')) {
    let reviewed = null;
    if ((envelope || lawEvidenceReady) && !signal.aborted && budget.modelAttempts < BUDGET.maxSteps &&
        (!context.timeLeft || context.timeLeft() > 1000)) {
      for (;;) {
        const beforeReview = budget.modelAttempts;
        try {
          stage('Checking source support');
          writingStart = now();
          // The selector and synthesizer share the turn's deadline, accounting and one repair.
          reviewed = await reviewLawAnswer(attempts.wrap(observedStream, 'chat_answer'), {
            model: attemptModel, question: request.message,
            compactEvidence: lawEvidenceReady,
            previousQuestions: window.filter(m => m.role === 'user').map(m => m.content ?? ''),
            evidence, signal,
            report: reason => log('research.law_review_rejected', { reason, attempt: budget.modelAttempts }),
            selectionReasoning: effortOf(t, attemptModel) ? { effort: effortOf(t, attemptModel)! }
              : lawReviewReasoning(t.models.find(m => m.model_id === attemptModel)?.efforts ?? []).reasoning,
            ...(effortOf(t, attemptModel) ? { reasoning: { effort: effortOf(t, attemptModel)! } } : {}),
            takeAttempt: minimumRemaining => {
              if (signal.aborted || BUDGET.maxSteps - budget.modelAttempts < minimumRemaining ||
                  (context.timeLeft && context.timeLeft() <= 1000)) return false;
              rounds++;
              budget.modelAttempts++;
              return true;
            },
          });
          break;
        } catch (error) {
          // The skipped draft used to perform this availability check. Preserve only
          // its configured retryable-provider failover, never retry validation failures.
          const next = chain[chain.indexOf(attemptModel) + 1];
          if (lawEvidenceReady && !signal.aborted && budget.modelAttempts === beforeReview + 1 &&
              error instanceof ProviderError && error.retryable && next &&
              BUDGET.maxSteps - budget.modelAttempts >= 2 && (!context.timeLeft || context.timeLeft() > 1000)) {
            attempts.rejectLast('chat_answer', 'Law evidence selection provider unavailable.');
            fallbackReason = `unavailable (${error.status})`;
            attemptModel = next;
            continue;
          }
          reviewed = null;
          log('research.law_review_failed', { aborted: signal.aborted });
          break;
        }
      }
    }
    if (!reviewed) {
      attempts.rejectLast('chat_answer', 'Legal answer declined: original-source support verification failed or unavailable.');
      return makeAssistantMessage({ content: '', sources: [], followUps: [], activity, served,
        status: signal.aborted ? 'interrupted' : 'error',
        error: 'The legal answer could not be verified against original source passages. Please try again.',
        usage: attempts.summary(), timing: timingOf(startedAt, now(), searchMs, writingStart, writingEnd, { firstModelAt, firstAnswerAt, rounds }),
      });
    }
    attempts.markLastAnswer('chat_answer');
    recordServingModel(responseModel || attemptModel);
    writingEnd = now();
    firstAnswerAt = writingEnd;
    envelope = reviewed;
  }

  // F132: the saved answer, and by the terminal patch the streamed one, get their line breaks back.
  const rawAnswer = undoDoubleEscapes(envelope?.answer ?? decoder.text ?? '');
  // Kept so the ladder can run once more, on the same input, with page evidence.
  let ladderInput: LadderInput = { answer: rawAnswer, modelSources: envelope?.sources, evidence };
  let ladder = applyCitationLadder(ladderInput);
  // Enforced, not requested. The prompt asks for no follow-ups on small talk and
  // the model returned three anyway; this is the half the server can guarantee.
  const followUps = conversational ? [] : (envelope?.followUps ?? []);

  // 6. One cheap pass to put the markers back, when the answer cited nothing.
  if (
    result.finish === 'stop' && !signal.aborted && ladderFired(ladder.flags) &&
    repairWorthwhile(ladder.answer, evidence) && deps.repairModel.trim().length > 0 &&
    budget.modelAttempts < BUDGET.maxSteps
  ) {
    try {
      const handleOf = (e: Evidence) => {
        for (const [handle, candidate] of evidence) if (candidate === e) return handle;
        return undefined;
      };
      budget.modelAttempts++;
      const repaired = await repairCitations({ model: attempts.wrap(deps.stream, 'citation_repair') }, {
        answer: ladder.answer,
        evidence,
        model: deps.repairModel,
        signal,
      });
      if (repaired.rejected) {
        attempts.rejectLast('citation_repair', `Repair declined by this server: ${repaired.rejected}.`);
      }
      if (repaired.text && !signal.aborted) {
        const secondInput: LadderInput = {
          answer: repaired.text,
          modelSources: repairSources(repaired.byNumber, handleOf),
          evidence,
        };
        const second = applyCitationLadder(secondInput);
        if (second.sources.length > ladder.sources.length) {
          ladder = second;
          ladderInput = secondInput;
        }
      }
    } catch {
      log('research_chat.repair_failed', { reason: signal.aborted ? 'aborted' : 'provider_failed' });
    }
  }

  // 7. Boxes and images for the cited page chunks (chunk-contract spec,
  //    "Resolving boxes"). The ladder is pure, so the read happens here, once,
  //    after every ladder run has settled which chunks are cited, and the
  //    ladder runs once more on the same input with the prepared maps. The
  //    rerun is deterministic: the answer and the numbering are unchanged.
  if (!signal.aborted) {
    const page = await citedPageEvidence(deps, ladder.sources, evidence, signal);
    if (page) ladder = applyCitationLadder({ ...ladderInput, page });
  }

  // Retrieving evidence is not citing it. If repair could not link a substantial
  // answer, disclose that instead of passing evidence.size off as verification.
  // Small talk asks nothing, so citing nothing remains right.
  const grounded = ladder.sources.length > 0 ||
    conversational || ladder.answer.trim().length < UNCITED_ANSWER_CHARS;
  // Both can be true at once - a widened search that also returned nothing -
  // and they answer different questions, so neither replaces the other.
  const notes = [
    ...(result.widened ? [widenedNote(result.widened, featureScope?.feature)] : []),
    ...(grounded ? [] : [evidence.size > 0 && !result.webPages.length
      ? '**Unverified.** Evidence was retrieved, but this answer could not be linked to verified citations. Treat its claims as unverified.'
      : unverifiedNote(result.searches, result.webPages.length)]),
    ...(requiredWeb && !result.webPages.length
      ? ['**Web context unavailable.** No usable web sources were returned for this turn. The record alone does not establish the missing details.'] : []),
  ];
  // Spec §4: a link survives only to a page searched this turn or a URL already in the turn's
  // evidence. Code is scanned too, because the reader's renderer links inside code as well.
  const checked = checkLinks(ladder.answer, [...result.webPages.map((p) => p.url), ...evidenceUrls(evidence)], { scanCode: true });
  if (checked.removed) log('research.links_removed', { count: checked.removed });
  const webSources = webSourcesOf(result.webPages, checked.text);
  const content = notes.length ? `${notes.join('\n\n')}\n\n${checked.text}` : checked.text;

  const timing = timingOf(startedAt, now(), searchMs, writingStart, writingEnd, { firstModelAt, firstAnswerAt, rounds });
  // `searches` is a step count, not a token figure; `attempts` beside it already
  // is one. It is written on every completed turn, including when it is zero,
  // because zero is a finding: a record question answered without retrieving
  // anything is a real failure, and it was invisible here until the count
  // existed. It sat beside a `thoughts` count until the think tool was removed,
  // and that count is precisely what established the tool was never called.
  // summary() is null when the turn recorded no model attempt at all; spreading
  // that would turn "nothing happened" into an object of zeroes.
  // `widened` rides here for the same reason `searches` does, and because
  // chat_turn_traces has no column for it: the spec expects widening to become
  // rare once the RPC pre-filters, and "rare" is a claim only a query settles.
  // Written only when it happened, so an ordinary turn keeps its existing shape.
  const summary = attempts.summary();
  const usage = summary &&
    { ...summary, searches: result.searches, web_offered: web.offered, web_required: requiredWeb,
      web_reason: web.reason, ...(result.widened ? { widened: result.widened } : {}) };
  const terminal = makeAssistantMessage({
    content,
    sources: ladder.sources,
    webSources,
    followUps,
    activity,
    served,
    status: signal.aborted ? 'interrupted' : result.finish === 'length' ? 'truncated' : 'complete',
    error: null,
    usage: result.finish === 'length' ? { ...usage, continuations: result.continuations } : usage,
    timing,
  });

  if (messageId) {
    attempts.addTraces(
      turnTraceRows({
        userId: caller.userId,
        conversationId: conversation.id,
        messageId,
        steps: result.steps as TraceStep[],
        answer: {
          latencyMs: writingEnd && writingStart ? writingEnd - writingStart : 0,
          aborted: signal.aborted,
        },
      }),
    );
  }

  return terminal;
}

/**
 * Read the blocks and images linked by the cited page chunks and prepare them
 * for the ladder. Undefined - and no read at all - when no cited chunk links
 * any, which is every turn over the pre-contract corpus. A failed read is
 * logged and tolerated: the citations then go out as they would have without
 * the page contract.
 */
async function citedPageEvidence(
  deps: HandlerDeps,
  sources: CitationSource[],
  evidence: EvidenceMap,
  signal: AbortSignal,
): Promise<PageEvidence | undefined> {
  const citedIds = new Set(sources.flatMap((s) => (s.kind === 'text' ? [s.chunk_id] : [])));
  const cited: Chunk[] = [];
  for (const e of evidence.values()) {
    if (e.kind === 'text' && citedIds.has(e.chunk.id) && !cited.includes(e.chunk)) cited.push(e.chunk);
  }
  const refs = citedPageRefs(cited);
  if (!refs.blockIds.length && !refs.imageIds.length) return undefined;
  try {
    return pageEvidenceMaps(cited, await deps.pageEvidence(refs, signal));
  } catch (error) {
    log('research_chat.page_evidence_failed', {
      reason: signal.aborted ? 'aborted' : 'read_failed',
      message: String((error as Error)?.message ?? error).slice(0, 200),
      blocks: refs.blockIds.length,
      images: refs.imageIds.length,
    });
    return undefined;
  }
}

function effortOf(t: TurnInput, modelId: string): string | null {
  if (!t.effort) return null;
  const model = t.models.find((m) => m.model_id === modelId);
  return model?.efforts.includes(t.effort) ? t.effort : null;
}

/** F199: the efforts whose turns get a bounded passage budget. */
const HIGH_EFFORTS = new Set(['high', 'xhigh', 'max']);
/** F199: the efforts a late call may drop to, lowest first. A turn already at one of them, or without
 * reasoning, keeps what it has; a model that accepts neither keeps the turn's effort too. */
const LATE_EFFORTS = ['minimal', 'low'];
function lateReasoningOf(t: TurnInput, modelId: string): { lateReasoning?: { effort: string } } {
  const effort = effortOf(t, modelId);
  if (!effort || LATE_EFFORTS.includes(effort)) return {};
  const efforts = t.models.find((m) => m.model_id === modelId)?.efforts ?? [];
  const late = [...LATE_EFFORTS].reverse().find((e) => efforts.includes(e));
  return late ? { lateReasoning: { effort: late } } : {};
}

export interface Timing {
  search_ms: number;
  reasoning_ms: number;
  writing_ms: number;
  total_ms: number;
  /** answer-streaming spec §2: from the request's arrival to the first model call opening and
   * to the first answer character sent (0 when none was), and the number of model calls. */
  first_model_ms: number;
  first_answer_ms: number;
  rounds: number;
}

const READING_QUESTION = 'Reading the question';
const READING_RESULTS = 'Reading the results';
const WRITING = 'Writing the answer';
const WIDENED_LABEL: Record<Exclude<WidenedScope, 'feature-empty'>, string> = {
  empty: 'The attached documents held nothing; searching the whole record.',
  unresolved: 'No indexed source document for the attached material; searching the whole record.',
  unkeyed: 'Nothing attached names a source document; searching the whole record.',
};
function widenedLabel(reason: WidenedScope, module?: string): string {
  return reason === 'feature-empty'
    ? `Nothing in ${module || 'the open desk module'} matched; searching all documents.`
    : WIDENED_LABEL[reason];
}

function timingOf(
  startedAt: number,
  endedAt: number,
  searchMs: number,
  writingStart: number,
  writingEnd: number,
  marks: { firstModelAt: number; firstAnswerAt: number; rounds: number },
): Timing {
  const total = Math.max(0, endedAt - startedAt);
  const writing = writingStart && writingEnd ? Math.max(0, writingEnd - writingStart) : 0;
  const search = Math.min(searchMs, total);
  return {
    search_ms: Math.round(search),
    writing_ms: Math.round(writing),
    reasoning_ms: Math.max(0, Math.round(total - search - writing)),
    total_ms: Math.round(total),
    first_model_ms: marks.firstModelAt ? Math.max(0, Math.round(marks.firstModelAt - startedAt)) : 0,
    first_answer_ms: marks.firstAnswerAt ? Math.max(0, Math.round(marks.firstAnswerAt - startedAt)) : 0,
    rounds: marks.rounds,
  };
}

function makeAssistantMessage(
  a: {
    content: string;
    sources: CitationSource[];
    webSources?: WebSource[];
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
    web_sources: a.webSources ?? [],
    follow_ups: a.followUps,
    activity: a.activity,
    model_served: a.served,
    status: a.status,
    error_message: a.error,
    usage: a.usage,
    timing: a.timing,
  };
}

/**
 * What the turn's scope says about embeddings (web-search spec §1): each row or record in scope
 * (uploaded files are not records) with whether its document key names an indexed document, and,
 * under desk focus, whether the open module has documents. A failed lookup is not evidence that a
 * document is missing: a keyed record then counts as indexed, and an unknown module as no module.
 */
async function webScopeOf(
  deps: HandlerDeps,
  request: ResearchRequest,
  selectionKey: string | null,
  modules: DocumentModule[],
  modulesKnown: boolean,
): Promise<WebScope> {
  const keys = [
    ...request.attachments.flatMap((a) => (a.kind === 'row' || a.kind === 'record' ? [a.document_key ?? null] : [])),
    ...(request.selection ? [selectionKey] : []),
  ];
  const wanted = [...new Set(keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0))];
  const indexed = wanted.length
    ? await deps.db.indexedDocumentKeys(wanted).then((found) => new Set(found)).catch(() => null)
    : new Set<string>();
  const context = request.desk_context;
  return {
    focus: request.focus,
    records: keys.map((key) => ({ key, indexed: Boolean(key) && (indexed === null || indexed.has(key!)) })),
    documentAttached: request.attachments.some((a) => a.kind === 'document'),
    moduleHasDocuments: context?.feature && modulesKnown
      ? Boolean(featureScopeOf({ focus: 'desk', desk_context: context }, modules))
      : null,
  };
}

/** Every http(s) URL already in the turn's evidence (passages, file links, rows): links the
 * answer may keep without a web search behind them. */
function evidenceUrls(evidence: EvidenceMap): string[] {
  const urls = new Set<string>();
  for (const e of evidence.values()) {
    for (const m of JSON.stringify(e).matchAll(/https?:\/\/[^\s"'<>()\\]+/g)) urls.add(m[0]);
  }
  return [...urls];
}
