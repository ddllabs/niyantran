// Turn telemetry (streaming spec §E.7). Two tables on purpose:
// model_call_logs answers "what did we spend" — one row per provider attempt,
// including the repair pass — and chat_turn_traces answers "what did the agent
// look for, and did retrieval return anything", which is the multi-query and
// empty-retrieval signal a port otherwise loses silently. Neither write may
// fail a turn that already answered.

import type { AttemptMetadata, ModelEvent, StreamRequest, Usage } from '../_shared/openrouterStream.ts';
import { log } from '../_shared/logging.ts';
import { webSearchCostUsd, webSearchCount } from '../_shared/webSearch.ts';
import type { TraceStep } from './agent.ts';

export type CallPurpose = 'chat_answer' | 'citation_repair' | 'embedding';
export type CallStatus = 'success' | 'error' | 'aborted';

export interface ModelCallRow {
  user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  caller: 'research-chat';
  purpose: CallPurpose;
  model_requested: string;
  model_served: string | null;
  provider: string | null;
  status: CallStatus;
  error_message: string | null;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_prompt_tokens: number | null;
  reasoning_tokens: number | null;
  cost_usd: number | null;
  /** Searches the provider ran in this call; 0 when none. */
  web_search_count: number;
  /** The searches' share of cost_usd (never added to it); null when the call did not search. */
  web_search_cost_usd: number | null;
  openrouter_generation_id: string | null;
  raw_usage: Record<string, unknown> | null;
  /** P3: the turn's requested reasoning effort (validate.ts REASONING_VALUES); null when not given. */
  reasoning_effort: string | null;
}

export interface TurnTraceRow {
  user_id: string;
  conversation_id: string | null;
  message_id: string;
  step_index: number;
  step_type: 'search_documents' | 'search_desk_rows' | 'reasoning' | 'answer' | 'web_search';
  input: string | null;
  result_count: number | null;
  top_similarity: number | null;
  latency_ms: number | null;
  chunk_ids: string[] | null;
  row_keys: string[] | null;
  model_call_log_id: string | null;
  aborted: boolean;
  error_message: string | null;
}

/**
 * A trace row that still has to be linked to a provider attempt. `attempt_index`
 * is the position of the attempt in the recorder (see lastAttemptIndex); flush
 * turns it into `model_call_log_id` once the attempt's row has an id, and
 * removes it, so it never reaches the database.
 */
export type LinkedTraceRow = TurnTraceRow & { attempt_index?: number };

/** One research call that searched the web, as a trace step. */
export interface WebTraceStep {
  /** The recorder's index of the attempt whose model_call_logs row this links to. */
  attemptIndex: number;
  searches: number;
  /** New unique pages this call added to the turn. */
  pagesAdded: number;
  latencyMs: number;
}

/** Per-token prices as model_pricing stores them (USD per token). */
export interface Pricing {
  prompt_usd?: number | null;
  completion_usd?: number | null;
}

/**
 * What the attempt cost. OpenRouter's own figure is preferred whenever it sent
 * one — an estimate that drifts is worse than no number, because people trust
 * it — and the token-times-price fallback is only used when it did not.
 */
function known(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function costOf(
  usage: Usage | null,
  pricing?: Pricing | null,
): { cost: number | null; source: 'provider' | 'pricing' | 'none' } {
  if (!usage) return { cost: null, source: 'none' };
  if (known(usage.cost) !== null) return { cost: usage.cost!, source: 'provider' };
  const tokens = [usage.prompt_tokens, usage.completion_tokens];
  const prices = [pricing?.prompt_usd, pricing?.completion_usd];
  let cost = 0;
  for (let i = 0; i < tokens.length; i++) {
    const count = known(tokens[i]);
    if (count === null) return { cost: null, source: 'none' };
    if (count === 0) continue;
    const price = known(prices[i]);
    if (price === null) return { cost: null, source: 'none' };
    cost += count * price;
  }
  return Number.isFinite(cost) ? { cost, source: 'pricing' } : { cost: null, source: 'none' };
}

export function vendorOf(modelId: string): string | null {
  const slash = String(modelId ?? '').indexOf('/');
  return slash > 0 ? modelId.slice(0, slash) : null;
}

export interface AttemptInput {
  userId: string;
  conversationId: string | null;
  messageId?: string | null;
  purpose: CallPurpose;
  requested: string;
  served?: string | null;
  provider?: string | null;
  status: CallStatus;
  /** Provider text. Accepted so callers can pass it, and deliberately never
   * written to error_message - a provider body can contain anything. */
  error?: string | null;
  /** Server-authored rejection reason, and the only text error_message carries. */
  rejection?: string | null;
  latencyMs: number;
  usage?: Usage | null;
  generationId?: string | null;
  pricing?: Pricing | null;
  reasoningEffort?: string | null;
}

export function modelCallRow(a: AttemptInput): ModelCallRow {
  const { cost, source } = costOf(a.usage ?? null, a.pricing);
  const searches = webSearchCount(a.usage) ?? 0;
  return {
    user_id: a.userId,
    conversation_id: a.conversationId,
    message_id: a.messageId ?? null,
    caller: 'research-chat',
    purpose: a.purpose,
    model_requested: a.requested,
    model_served: a.served ?? null,
    provider: a.provider ?? null,
    status: a.status,
    // A rejection is not a provider failure. The status column is constrained to
    // three values, so a declined result stays an error, but saying "Provider
    // attempt failed." of a call the provider completed sends anyone reading
    // these rows to the wrong system. Only server-authored text is carried; a
    // provider body could contain anything and never reaches this column.
    error_message: a.status === 'success'
      ? null
      : a.status === 'aborted'
      ? 'Provider attempt aborted.'
      : a.rejection || 'Provider attempt failed.',
    latency_ms: Math.max(0, Math.round(a.latencyMs)),
    prompt_tokens: known(a.usage?.prompt_tokens),
    completion_tokens: known(a.usage?.completion_tokens),
    total_tokens: known(a.usage?.total_tokens),
    cached_prompt_tokens: known(a.usage?.cached_prompt_tokens),
    reasoning_tokens: known(a.usage?.reasoning_tokens),
    cost_usd: cost,
    web_search_count: searches,
    web_search_cost_usd: searches > 0 ? webSearchCostUsd(a.usage, searches) : null,
    openrouter_generation_id: a.generationId ?? null,
    raw_usage: a.usage ? { ...a.usage, cost_source: source } : null,
    reasoning_effort: a.reasoningEffort ?? null,
  };
}

/**
 * One trace row per tool step, plus a closing row for the answer itself.
 *
 * `model_call_log_id` is left null here and filled at flush, because the id it
 * wants is the primary key of a row that has not been inserted yet. Only the
 * answer row gets one: a tool step is a database query and costs no provider
 * call, and the embedding behind search_documents is recorded but cannot be
 * tied to its step - the embed happens inside the search, which does not know
 * the step number. Guessing by call order would link the wrong row after a
 * retry, and a wrong link is worse than an empty column.
 *
 * A web_search step is different: the call that searched is known, so it names
 * its attempt (`web[].attemptIndex`) and flush links it the way it links the
 * answer. Web rows follow the tool steps and precede the answer. Without `web`
 * the rows are exactly what they were.
 */
export function turnTraceRows(a: {
  userId: string;
  conversationId: string | null;
  messageId: string;
  steps: TraceStep[];
  web?: WebTraceStep[];
  answer?: { latencyMs: number; aborted: boolean; error?: string | null };
}): LinkedTraceRow[] {
  const rows: LinkedTraceRow[] = a.steps.map((s) => ({
    user_id: a.userId,
    conversation_id: a.conversationId,
    message_id: a.messageId,
    step_index: s.step,
    step_type: s.name,
    input: JSON.stringify(s.input).slice(0, 2_000),
    result_count: s.resultCount,
    top_similarity: s.topSimilarity,
    latency_ms: s.latencyMs,
    chunk_ids: s.chunkIds.length ? s.chunkIds : null,
    row_keys: s.rowKeys.length ? s.rowKeys : null,
    model_call_log_id: null,
    aborted: s.status === 'cancelled',
    error_message: s.status === 'error' ? 'tool step failed' : null,
  }));
  for (const w of a.web ?? []) {
    rows.push({
      user_id: a.userId,
      conversation_id: a.conversationId,
      message_id: a.messageId,
      step_index: rows.length + 1,
      step_type: 'web_search',
      input: null,
      result_count: Math.max(0, Math.round(w.pagesAdded)),
      top_similarity: null,
      latency_ms: Math.max(0, Math.round(w.latencyMs)),
      chunk_ids: null,
      row_keys: null,
      model_call_log_id: null,
      aborted: false,
      error_message: null,
      attempt_index: w.attemptIndex,
    });
  }
  if (a.answer) {
    rows.push({
      user_id: a.userId,
      conversation_id: a.conversationId,
      message_id: a.messageId,
      step_index: rows.length + 1,
      step_type: 'answer',
      input: null,
      result_count: null,
      top_similarity: null,
      latency_ms: Math.max(0, Math.round(a.answer.latencyMs)),
      chunk_ids: null,
      row_keys: null,
      model_call_log_id: null,
      aborted: a.answer.aborted,
      error_message: a.answer.error ? String(a.answer.error).slice(0, 500) : null,
    });
  }
  return rows;
}

export interface TelemetryDb {
  /** Returns the new row's id, or null when the write failed (never throws). */
  logModelCall(row: ModelCallRow): Promise<string | null>;
  logTurnTraces(rows: TurnTraceRow[]): Promise<void>;
  /** Sets a cost found after the turn on a row that has none (AI credits spec §3.1). */
  saveGenerationCost?(id: string, cost: number, rawUsage: Record<string, unknown>): Promise<void>;
}

// The database adapter aborts each query after 4 s. Give it time to return the
// inserted id (or its failure) before this last-resort bound: racing it at 250 ms
// discarded ids even when the insert committed. Flush runs after the answer is
// finalized and delivered, so this budget does not delay the visible response.
// Never retry an insert after either timeout: its commit outcome may be unknown.
export const TELEMETRY_TIMEOUT_MS = 5_000;
/** One lookup of OpenRouter's cost for a generation: null when it has none (yet). */
export type GenerationCost = (generationId: string, signal: AbortSignal) => Promise<number | null>;
type ProviderStream = (request: StreamRequest) => AsyncGenerator<ModelEvent>;
interface RecordedAttempt extends AttemptMetadata {
  requested: string;
  purpose: CallPurpose;
  answer: boolean;
  started: number;
  latency: number;
  status: CallStatus | null;
  /** Server-authored, when the provider succeeded and we declined the result. */
  rejection: string | null;
}

/** Per-turn accounting. Records reflect actual iterator starts, not planned
 * agent attempts. Writes happen once, after durable turn finalization. */
export function createAttemptRecorder(options: {
  userId: string;
  conversationId: string;
  messageId: string;
  /** P3: the turn's requested reasoning effort, written on every row. */
  reasoningEffort?: string | null;
  pricing(model: string): Promise<Pricing | null>;
  db: TelemetryDb;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const records: RecordedAttempt[] = [];
  const traces = new Map<string, LinkedTraceRow>();
  const late: LateCost[] = [];
  let flushing: Promise<void> | undefined;
  function merge(record: RecordedAttempt, metadata: AttemptMetadata): void {
    if (record.status !== null || flushing) return;
    const scalar = (value: unknown) =>
      typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value)
        ? value
        : null;
    record.served = scalar(metadata.served) ?? record.served;
    record.generationId = scalar(metadata.generationId) ?? record.generationId;
    record.provider = scalar(metadata.provider) ?? record.provider;
    if (metadata.usage) {
      const usage: Usage = record.usage
        ? { ...record.usage }
        : { prompt_tokens: null, completion_tokens: null, total_tokens: null };
      for (
        const key of [
          'prompt_tokens',
          'completion_tokens',
          'total_tokens',
          'cached_prompt_tokens',
          'reasoning_tokens',
          'cost',
          'web_search_requests',
          'upstream_inference_cost',
        ] as const
      ) {
        const value = known(metadata.usage[key]);
        if (value !== null) usage[key] = value;
      }
      record.usage = usage;
    }
  }
  function settle(record: RecordedAttempt, status: CallStatus): void {
    if (record.status !== null) return;
    record.status = status;
    record.latency = Math.max(0, now() - record.started);
  }
  function wrap(stream: ProviderStream, purpose: CallPurpose): ProviderStream {
    return async function* (request) {
      request.signal?.throwIfAborted();
      const record: RecordedAttempt = {
        requested: request.model,
        purpose,
        answer: !request.tools?.length || request.tool_choice === 'none',
        served: null,
        generationId: null,
        provider: null,
        usage: null,
        started: now(),
        latency: 0,
        status: null,
        rejection: null,
      };
      records.push(record);
      let finished: string | null = null;
      const abort = () => settle(record, 'aborted');
      request.signal?.addEventListener('abort', abort, { once: true });
      try {
        for await (const event of stream({ ...request, onAttemptMetadata: (metadata) => merge(record, metadata) })) {
          request.signal?.throwIfAborted();
          if (event.type === 'finish') {
            finished = event.reason;
            merge(record, { served: event.served, generationId: event.generationId, usage: event.usage });
          }
          yield event;
        }
        request.signal?.throwIfAborted();
        settle(record, finished === 'stop' || finished === 'tool_calls' || finished === 'length' ? 'success' : 'error');
      } catch (error) {
        settle(record, request.signal?.aborted ? 'aborted' : 'error');
        throw error;
      } finally {
        settle(record, request.signal?.aborted ? 'aborted' : 'error');
        request.signal?.removeEventListener('abort', abort);
      }
    };
  }
  function summary(): Record<string, unknown> | null {
    if (!records.length) return null;
    // A total stays null unless every attempt reported that field. Summing the
    // rest would count a silent attempt as zero, and anything totalling
    // `cost_usd` for billing would then undercharge - which is why the
    // all-or-nothing rule exists and is tested.
    //
    // What was wrong is that the observed figures were discarded as well, so a
    // five-attempt turn showed null completion_tokens while four attempts had
    // reported them, and nothing recorded how much of the turn was unaccounted.
    // The canonical fields keep their meaning; the observed part is reported
    // separately, under a name that cannot be mistaken for a total.
    //
    // The trigger was still wrong, and a real turn showed it. Seven attempts,
    // every one of them carrying a usage object, but the two embedding calls
    // have no completion tokens - so completion_tokens nulled out, the observed
    // figure (1,607, from five attempts) was computed and thrown away, and no
    // block appeared, because the guard asked whether an attempt was silent
    // rather than whether a field was. A field is what nulls a total, so a
    // field is what the guard has to ask about.
    const partial: Record<string, number> = {};
    const reportedBy: Record<string, number> = {};
    let fieldGap = false;
    let attemptsReporting = 0;
    const sum = (name: Exclude<keyof Usage, 'cost' | 'web_search_requests' | 'upstream_inference_cost'>): number | null => {
      let total = 0;
      let seen = 0;
      for (const record of records) {
        const value = known(record.usage?.[name]);
        if (value === null) continue;
        total += value;
        seen++;
      }
      if (seen) partial[name] = total;
      if (seen === records.length && Number.isFinite(total)) return total;
      // Say how much of the turn the observed figure covers, so nobody reads a
      // partial sum as a total. A field no attempt reported gets no entry.
      if (seen) {
        reportedBy[`${name}_from`] = seen;
        fieldGap = true;
      }
      return null;
    };
    for (const record of records) if (record.usage) attemptsReporting++;
    // Searches are summed over the attempts that reported any. Unlike the
    // token totals there is no all-or-nothing rule: a call that did not report
    // a search did not search, and a count of zero is the honest report.
    let webSearches = 0;
    for (const record of records) webSearches += Math.max(0, webSearchCount(record.usage) ?? 0);
    // No dollars (AI credits spec §7): this summary is saved as chat_messages.usage, which the user can
    // read, so it carries no cost at any depth. model_call_logs keeps each attempt's cost.
    const out: Record<string, unknown> = {
      attempts: records.length,
      prompt_tokens: sum('prompt_tokens'),
      completion_tokens: sum('completion_tokens'),
      total_tokens: sum('total_tokens'),
      cached_prompt_tokens: sum('cached_prompt_tokens'),
      reasoning_tokens: sum('reasoning_tokens'),
      web_searches: webSearches,
    };
    // Only when the turn is actually short of figures. A complete turn carries
    // nothing extra, so its shape is unchanged.
    if (attemptsReporting < records.length || fieldGap) {
      out.observed = {
        ...partial,
        ...reportedBy,
        attempts_reporting: attemptsReporting,
        attempts_silent: records.length - attemptsReporting,
      };
    }
    return out;
  }
  async function bounded<T>(stage: string, operation: () => Promise<T>, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<T>((resolve) => {
          timer = setTimeout(() => {
            log('research_chat.telemetry_failed', { stage, reason: 'timeout' });
            resolve(fallback);
          }, TELEMETRY_TIMEOUT_MS);
        }),
      ]);
    } catch {
      log('research_chat.telemetry_failed', { stage, reason: 'write_failed' });
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }
  function flush(): Promise<void> {
    if (flushing) return flushing;
    for (const record of records) settle(record, 'aborted');
    flushing = (async () => {
      // The provider attempts first, keeping each row's id. chat_turn_traces
      // links its answer row to the call that wrote the answer, and that id is
      // the primary key of a row that does not exist until this insert returns
      // - which is why the column had been null since it was added. The two
      // writes used to race, so the trace could never have carried it.
      const ids = await Promise.all(
        records.map(async (record) => {
          const pricing = record.served && known(record.usage?.cost) === null
            ? await bounded('pricing', () => options.pricing(record.served!), null)
            : null;
          const row = modelCallRow({
            userId: options.userId,
            conversationId: options.conversationId,
            messageId: options.messageId,
            purpose: record.purpose,
            requested: record.requested,
            served: record.served,
            provider: record.provider,
            status: record.status!,
            rejection: record.rejection,
            latencyMs: record.latency,
            usage: record.usage,
            generationId: record.generationId,
            pricing,
            reasoningEffort: options.reasoningEffort,
          });
          // AI credits spec §3.1: a success with no cost is a warning, never charged as zero.
          if (row.status === 'success' && row.cost_usd === null) log('research_chat.success_without_cost');
          const id = await bounded('model_call', () => options.db.logModelCall(row), null);
          if (id === null) log('research_chat.telemetry_failed', { stage: 'model_call', reason: 'not_recorded' });
          // A call cut off before it reported a cost stays uncharged. With a generation id and a saved
          // row, the background job may still find the cost; without either it is unknown now.
          if (row.status === 'aborted' && row.cost_usd === null) {
            if (id !== null && row.openrouter_generation_id !== null) {
              late.push({ id, generationId: row.openrouter_generation_id, abortedAt: record.started + record.latency, rawUsage: row.raw_usage });
            } else {
              log('research_chat.aborted_cost_unknown', { purpose: row.purpose });
            }
          }
          return id;
        }),
      );
      // The attempt that produced the visible answer: the last one marked
      // `answer` that succeeded. A turn takes several - failover and schema
      // retries - and only one of them wrote what the reader is looking at.
      let answerId: string | null = null;
      for (let i = records.length - 1; i >= 0 && answerId === null; i--) {
        if (records[i].answer && records[i].status === 'success') answerId = ids[i];
      }
      if (traces.size) {
        const rows: TurnTraceRow[] = [...traces.values()].map((linked) => {
          const { attempt_index: attempt, ...row } = linked;
          if (row.step_type === 'answer' && !row.aborted) return { ...row, model_call_log_id: answerId };
          // A web step links to the attempt that searched; an index that names
          // no attempt stays unlinked rather than guessing.
          if (attempt !== undefined) return { ...row, model_call_log_id: ids[attempt] ?? null };
          return row;
        });
        await bounded('turn_trace', () => options.db.logTurnTraces(rows), undefined);
      }
    })();
    return flushing;
  }
  return {
    beginEmbeddingAttempt(model: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (flushing) throw new Error('Turn accounting closed');
      const record: RecordedAttempt = {
        requested: model,
        purpose: 'embedding',
        answer: false,
        served: null,
        generationId: null,
        provider: null,
        usage: null,
        started: now(),
        latency: 0,
        status: null,
        rejection: null,
      };
      records.push(record);
      const finish = (status: CallStatus) => {
        settle(record, status);
        signal?.removeEventListener('abort', abort);
      };
      const abort = () => finish('aborted');
      signal?.addEventListener('abort', abort, { once: true });
      return { observe: (metadata: AttemptMetadata) => merge(record, metadata), finish };
    },
    wrap,
    summary,
    flush,
    rejectLast(purpose: CallPurpose, reason?: string) {
      if (flushing) return;
      const record = records.findLast((r) => r.purpose === purpose && r.answer);
      if (record?.status === 'success') {
        record.status = 'error';
        record.rejection = reason && reason.length <= 256 ? reason : null;
      }
    },
    /** The last attempt of this purpose wrote the visible answer although it
     * was offered tools: a research reply the agent promoted. */
    markLastAnswer(purpose: CallPurpose) {
      if (flushing) return;
      const record = records.findLast((r) => r.purpose === purpose);
      if (record) record.answer = true;
    },
    /** The recorder's index of the latest attempt of this purpose, or -1: what a web step's `attemptIndex` names. */
    lastAttemptIndex(purpose: CallPurpose): number {
      return records.findLastIndex((r) => r.purpose === purpose);
    },
    /** After flush: the saved rows of calls cut off before reporting a cost, which have a generation
     * id to look up later (AI credits spec §3.1). */
    lateCosts(): LateCost[] {
      return late;
    },
    addTraces(rows: LinkedTraceRow[]) {
      if (!flushing) { for (const row of rows) traces.set(`${row.step_type}:${row.step_index}`, row); }
    },
  };
}
export type AttemptRecorder = ReturnType<typeof createAttemptRecorder>;

/** When the background job asks for a cut-off call's cost, after the abort (AI credits spec §3.1).
 * The 2026-10-14 probe saw OpenRouter's generation record appear 6-15 s after the abort. */
export const LATE_COST_POLLS_MS = [8_000, 12_000, 16_000, 20_000, 25_000];
/** The whole job's limit, from its start: well inside the Edge wall clock, which waitUntil does not
 * extend. NTER's organisation is on Supabase Pro (plan "pro", checked 2026-10-14 through the
 * management API), whose wall clock is 400 s per worker (150 s on Free);
 * https://supabase.com/docs/guides/functions/limits */
export const LATE_COST_JOB_MS = 30_000;

export interface LateCost {
  /** The model_call_logs row to update. */
  id: string;
  generationId: string;
  /** When the call was cut off, on the recorder's clock. */
  abortedAt: number;
  /** The row's raw_usage as inserted, so the update only adds cost_source. */
  rawUsage: Record<string, unknown> | null;
}

function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    function stop() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', stop, { once: true });
  });
}

/**
 * The background job for calls Stop cut off (AI credits spec §3.1): ask OpenRouter for each one's
 * cost at LATE_COST_POLLS_MS after its abort, and save the first finite, non-negative figure on its
 * row. The hold's sweep charges it later; nothing here settles. Bounded by LATE_COST_JOB_MS, and it
 * never throws: a cost that never comes is logged once per row and stays uncharged.
 */
export async function recoverLateCosts(
  pending: LateCost[],
  deps: {
    lookup: GenerationCost;
    save(id: string, cost: number, rawUsage: Record<string, unknown>): Promise<void>;
    now?: () => number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    polls?: number[];
    budgetMs?: number;
  },
): Promise<void> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? sleepFor;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('late cost deadline')), deps.budgetMs ?? LATE_COST_JOB_MS);
  const expired = new Promise<void>((resolve) => deadline.signal.addEventListener('abort', () => resolve(), { once: true }));
  const recover = async (row: LateCost): Promise<boolean> => {
    for (const offset of deps.polls ?? LATE_COST_POLLS_MS) {
      try {
        await sleep(Math.max(0, row.abortedAt + offset - now()), deadline.signal);
        const cost = known(await deps.lookup(row.generationId, deadline.signal));
        if (cost === null || deadline.signal.aborted) continue;
        try {
          await deps.save(row.id, cost, { ...row.rawUsage, cost_source: 'generation' });
        } catch {
          log('research_chat.telemetry_failed', { stage: 'late_cost', reason: 'write_failed' });
        }
        return true;
      } catch {
        if (deadline.signal.aborted) return false;
      }
    }
    return false;
  };
  try {
    await Promise.all(pending.map(async (row) => {
      const found = await Promise.race([recover(row), expired.then(() => false)]);
      if (!found) log('research_chat.aborted_cost_unknown', { stage: 'late' });
    }));
  } catch {
    /* never thrown out of the job */
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
}
