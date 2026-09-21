// Turn telemetry (streaming spec §E.7). Two tables on purpose:
// model_call_logs answers "what did we spend" — one row per provider attempt,
// including the repair pass — and chat_turn_traces answers "what did the agent
// look for, and did retrieval return anything", which is the multi-query and
// empty-retrieval signal a port otherwise loses silently. Neither write may
// fail a turn that already answered.

import type { AttemptMetadata, ModelEvent, StreamRequest, Usage } from '../_shared/openrouterStream.ts';
import { log } from '../_shared/logging.ts';
import type { TraceStep } from './agent.ts';

export type CallPurpose = 'chat_answer' | 'citation_repair';
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
  openrouter_generation_id: string | null;
  raw_usage: Record<string, unknown> | null;
}

export interface TurnTraceRow {
  user_id: string;
  conversation_id: string | null;
  message_id: string;
  step_index: number;
  step_type: 'search_documents' | 'search_desk_rows' | 'reasoning' | 'answer';
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
  error?: string | null;
  latencyMs: number;
  usage?: Usage | null;
  generationId?: string | null;
  pricing?: Pricing | null;
}

export function modelCallRow(a: AttemptInput): ModelCallRow {
  const { cost, source } = costOf(a.usage ?? null, a.pricing);
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
    error_message: a.status === 'success'
      ? null
      : a.status === 'aborted'
      ? 'Provider attempt aborted.'
      : 'Provider attempt failed.',
    latency_ms: Math.max(0, Math.round(a.latencyMs)),
    prompt_tokens: known(a.usage?.prompt_tokens),
    completion_tokens: known(a.usage?.completion_tokens),
    total_tokens: known(a.usage?.total_tokens),
    cached_prompt_tokens: known(a.usage?.cached_prompt_tokens),
    reasoning_tokens: known(a.usage?.reasoning_tokens),
    cost_usd: cost,
    openrouter_generation_id: a.generationId ?? null,
    raw_usage: a.usage ? { ...a.usage, cost_source: source } : null,
  };
}

/** One trace row per tool step, plus a closing row for the answer itself. */
export function turnTraceRows(a: {
  userId: string;
  conversationId: string | null;
  messageId: string;
  steps: TraceStep[];
  callIdByStep?: Map<number, string | null>;
  answer?: { latencyMs: number; modelCallLogId: string | null; aborted: boolean; error?: string | null };
}): TurnTraceRow[] {
  const rows: TurnTraceRow[] = a.steps.map((s) => ({
    user_id: a.userId,
    conversation_id: a.conversationId,
    message_id: a.messageId,
    step_index: s.step,
    step_type: s.name,
    input: JSON.stringify(s.input).slice(0, 2_000),
    result_count: s.resultCount,
    top_similarity: null,
    latency_ms: s.latencyMs,
    chunk_ids: s.chunkIds.length ? s.chunkIds : null,
    row_keys: s.rowKeys.length ? s.rowKeys : null,
    model_call_log_id: a.callIdByStep?.get(s.step) ?? null,
    aborted: false,
    error_message: s.status === 'error' ? 'tool step failed' : null,
  }));
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
      model_call_log_id: a.answer.modelCallLogId,
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
}

export const TELEMETRY_TIMEOUT_MS = 250;
type ProviderStream = (request: StreamRequest) => AsyncGenerator<ModelEvent>;
interface RecordedAttempt extends AttemptMetadata {
  requested: string;
  purpose: CallPurpose;
  answer: boolean;
  started: number;
  latency: number;
  status: CallStatus | null;
}

/** Per-turn accounting. Records reflect actual iterator starts, not planned
 * agent attempts. Writes happen once, after durable turn finalization. */
export function createAttemptRecorder(options: {
  userId: string;
  conversationId: string;
  messageId: string;
  pricing(model: string): Promise<Pricing | null>;
  db: TelemetryDb;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const records: RecordedAttempt[] = [];
  const traces = new Map<string, TurnTraceRow>();
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
        answer: !request.tools?.length,
        served: null,
        generationId: null,
        provider: null,
        usage: null,
        started: now(),
        latency: 0,
        status: null,
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
    const sum = (key: keyof Usage): number | null => {
      let total = 0;
      for (const record of records) {
        const value = known(record.usage?.[key]);
        if (value === null) return null;
        total += value;
      }
      return Number.isFinite(total) ? total : null;
    };
    return {
      attempts: records.length,
      prompt_tokens: sum('prompt_tokens'),
      completion_tokens: sum('completion_tokens'),
      total_tokens: sum('total_tokens'),
      cached_prompt_tokens: sum('cached_prompt_tokens'),
      reasoning_tokens: sum('reasoning_tokens'),
      cost_usd: sum('cost'),
    };
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
      await Promise.all([
        ...records.map(async (record) => {
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
            latencyMs: record.latency,
            usage: record.usage,
            generationId: record.generationId,
            pricing,
          });
          const id = await bounded('model_call', () => options.db.logModelCall(row), null);
          if (id === null) log('research_chat.telemetry_failed', { stage: 'model_call', reason: 'not_recorded' });
        }),
        ...(traces.size
          ? [bounded('turn_trace', () => options.db.logTurnTraces([...traces.values()]), undefined)]
          : []),
      ]);
    })();
    return flushing;
  }
  return {
    wrap,
    summary,
    flush,
    rejectLast(purpose: CallPurpose) {
      if (flushing) return;
      const record = records.findLast((r) => r.purpose === purpose && r.answer);
      if (record?.status === 'success') record.status = 'error';
    },
    addTraces(rows: TurnTraceRow[]) {
      if (!flushing) { for (const row of rows) traces.set(`${row.step_type}:${row.step_index}`, row); }
    },
  };
}
export type AttemptRecorder = ReturnType<typeof createAttemptRecorder>;
