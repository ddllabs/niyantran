// Turn telemetry (streaming spec §E.7). Two tables on purpose:
// model_call_logs answers "what did we spend" — one row per provider attempt,
// including the repair pass — and chat_turn_traces answers "what did the agent
// look for, and did retrieval return anything", which is the multi-query and
// empty-retrieval signal a port otherwise loses silently. Neither write may
// fail a turn that already answered.

import type { Usage } from '../_shared/openrouterStream.ts';
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
export function costOf(usage: Usage | null, pricing?: Pricing | null): { cost: number | null; source: 'provider' | 'pricing' | 'none' } {
  if (!usage) return { cost: null, source: 'none' };
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) return { cost: usage.cost, source: 'provider' };
  const p = Number(pricing?.prompt_usd ?? NaN);
  const c = Number(pricing?.completion_usd ?? NaN);
  if (!Number.isFinite(p) && !Number.isFinite(c)) return { cost: null, source: 'none' };
  const cost = (Number.isFinite(p) ? p * usage.prompt_tokens : 0) + (Number.isFinite(c) ? c * usage.completion_tokens : 0);
  return { cost, source: 'pricing' };
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
    provider: vendorOf(a.served || a.requested),
    status: a.status,
    error_message: a.error ? String(a.error).slice(0, 500) : null,
    latency_ms: Math.max(0, Math.round(a.latencyMs)),
    prompt_tokens: a.usage?.prompt_tokens ?? null,
    completion_tokens: a.usage?.completion_tokens ?? null,
    total_tokens: a.usage?.total_tokens ?? null,
    cached_prompt_tokens: a.usage?.cached_prompt_tokens ?? null,
    reasoning_tokens: a.usage?.reasoning_tokens ?? null,
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
