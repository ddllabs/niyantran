// One public.model_call_logs row per provider call, by the transcribe-audio pattern. caller is
// 'factcheck'; purpose names the step (the column is free text, no CHECK constraint). message_id and
// conversation_id stay null, so credit settlement and sweep (which read rows by message id) can never
// reach these rows: the fact-check charge is the session's own.

import { log } from '../_shared/logging.ts';
import { ApiError } from './apiError.ts';
import { OPENROUTER_CHAT_URL } from './models.ts';
import type { Ctx, FactcheckDeps } from './types.ts';

export type Purpose = 'transcription' | 'claim_extraction' | 'claim_check' | 'claim_recheck';

export interface ModelCallRow {
  user_id: string;
  conversation_id: null;
  message_id: null;
  caller: 'factcheck';
  purpose: Purpose;
  model_requested: string;
  model_served: string | null;
  provider: string | null;
  status: 'success' | 'error' | 'aborted';
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

/** A log write is abandoned after this long. */
export const TELEMETRY_TIMEOUT_MS = 1_500;
/** Transcription keeps 40 s; extraction and check are short calls and give up after 25 s. */
export const PROVIDER_TIMEOUT_MS = 40_000;
export const CHAT_TIMEOUT_MS = 25_000;
const FAILED = 'The model call failed. Try again.';

const known = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const whole = (v: unknown): number | null => {
  const n = known(v);
  return n === null ? null : Math.round(n);
};
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null);
const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export interface Attempt {
  userId: string;
  sessionId: string;
  purpose: Purpose;
  model: string;
  status: ModelCallRow['status'];
  /** Server-authored only; provider text never reaches the row. */
  reason: string | null;
  latencyMs: number;
  payload: Record<string, unknown> | null;
}

/** Only reported values are kept; a missing cost stays null and is never estimated. */
export function modelCallRow(a: Attempt): ModelCallRow {
  const usage = asObject(a.payload?.usage);
  const cost = known(usage?.cost);
  const prompt = whole(usage?.prompt_tokens ?? usage?.input_tokens);
  const completion = whole(usage?.completion_tokens ?? usage?.output_tokens);
  const total = whole(usage?.total_tokens);
  const cached = whole(asObject(usage?.prompt_tokens_details)?.cached_tokens);
  const reasoning = whole(asObject(usage?.completion_tokens_details)?.reasoning_tokens);
  const seconds = known(usage?.seconds);
  const raw: Record<string, unknown> = {};
  if (usage) {
    for (
      const [key, value] of [['prompt_tokens', prompt], ['completion_tokens', completion], ['total_tokens', total], [
        'seconds',
        seconds,
      ], ['cost', cost]] as const
    ) {
      if (value !== null) raw[key] = value;
    }
  }
  const hasUsage = Object.keys(raw).length > 0;
  return {
    user_id: a.userId,
    conversation_id: null,
    message_id: null,
    caller: 'factcheck',
    purpose: a.purpose,
    model_requested: a.model,
    model_served: text(a.payload?.model, 200),
    provider: text(a.payload?.provider, 200),
    status: a.status,
    error_message: a.status === 'success' ? null : a.reason ?? 'Provider attempt failed.',
    latency_ms: Math.max(0, Math.round(a.latencyMs)),
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    cached_prompt_tokens: cached,
    reasoning_tokens: reasoning,
    cost_usd: cost,
    openrouter_generation_id: text(a.payload?.id, 200),
    // session_id lets the cost of one session be summed from the log.
    raw_usage: hasUsage
      ? { session_id: a.sessionId, ...raw, cost_source: cost === null ? 'none' : 'provider' }
      : { session_id: a.sessionId },
  };
}

/** Never throws and never waits longer than the bound. */
async function record(deps: FactcheckDeps, row: ModelCallRow): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => deps.logModelCall(row)),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          log('factcheck.telemetry_failed', { reason: 'timeout' });
          resolve();
        }, deps.telemetryTimeoutMs ?? TELEMETRY_TIMEOUT_MS);
      }),
    ]);
  } catch {
    log('factcheck.telemetry_failed', { reason: 'write_failed' });
  } finally {
    clearTimeout(timer);
  }
}

/** Logs the row after the response when the runtime allows it, else before it, bounded. */
export async function logCall(deps: FactcheckDeps, row: ModelCallRow): Promise<void> {
  const logged = record(deps, row);
  if (deps.waitUntil) deps.waitUntil(logged);
  else await logged;
}

export interface ProviderOutcome {
  status: ModelCallRow['status'];
  reason: string | null;
  payload: Record<string, unknown> | null;
  /** True when the provider answered 2xx with a JSON body. */
  ok: boolean;
}

/**
 * Sends one provider request, classifies the outcome without ever keeping provider text in the
 * reason, and writes exactly one log row. A network failure, a non-2xx answer, a timeout and a client
 * disconnect are all outcomes, not exceptions.
 */
export async function callProvider(
  ctx: Ctx,
  meta: { purpose: Purpose; model: string; sessionId: string; timeoutMs?: number },
  send: (signal: AbortSignal) => Promise<Response>,
  /** A 2xx JSON answer the caller cannot use is logged as an error, not a success. */
  usable: (payload: Record<string, unknown>) => boolean = () => true,
): Promise<ProviderOutcome> {
  const started = ctx.now();
  let status: ModelCallRow['status'] = 'error';
  let reason: string | null = 'Provider attempt failed.';
  let payload: Record<string, unknown> | null = null;
  let ok = false;
  try {
    const response = await send(
      AbortSignal.any([ctx.req.signal, AbortSignal.timeout(meta.timeoutMs ?? PROVIDER_TIMEOUT_MS)]),
    );
    if (!response.ok) {
      await response.body?.cancel();
      reason = `Provider returned HTTP ${response.status}.`;
    } else {
      try {
        payload = asObject(await response.json());
        if (!payload) reason = 'Provider response was not an object.';
        else if (!usable(payload)) reason = 'Provider response had no usable content.';
        else {
          ok = true;
          status = 'success';
          reason = null;
        }
      } catch {
        reason = 'Provider response was not JSON.';
      }
    }
  } catch (error) {
    if (ctx.req.signal.aborted) {
      status = 'aborted';
      reason = 'Provider attempt aborted.';
    } else {reason = (error as Error)?.name === 'TimeoutError'
        ? 'Provider attempt timed out.'
        : 'Provider request failed.';}
  }
  await logCall(
    ctx.deps,
    modelCallRow({
      userId: ctx.userId,
      purpose: meta.purpose,
      model: meta.model,
      sessionId: meta.sessionId,
      status,
      reason,
      latencyMs: ctx.now() - started,
      payload,
    }),
  );
  return { status, reason, payload, ok };
}

/** A provider call that failed. `aborted` is true when the CLIENT went away, not when the provider failed. */
export class ProviderError extends ApiError {
  readonly aborted: boolean;
  constructor(aborted: boolean) {
    super(502, FAILED, { reason: 'model_failed' });
    this.aborted = aborted;
  }
}

export interface ChatRequest {
  purpose: Purpose;
  model: string;
  sessionId: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Strict JSON-schema output when given; otherwise a plain-text reply. */
  schema?: { name: string; schema: Record<string, unknown> };
  /** OpenRouter provider preferences. Left off for a model that cannot be routed with them. */
  provider?: Record<string, unknown>;
  /** OpenRouter reasoning setting, e.g. { effort: 'low' }. */
  reasoning?: Record<string, unknown>;
}

/**
 * One chat completion with usage accounting. Returns the provider payload and the reply text (null when
 * the reply has none). A provider failure, timeout or client disconnect throws a ProviderError (502); what
 * unusable content means is the caller's decision.
 */
export async function chatCompletion(
  ctx: Ctx,
  r: ChatRequest,
): Promise<{ payload: Record<string, unknown>; text: string | null }> {
  const body = JSON.stringify({
    model: r.model,
    temperature: 0,
    max_tokens: r.maxTokens,
    usage: { include: true },
    ...(r.provider ? { provider: r.provider } : {}),
    ...(r.reasoning ? { reasoning: r.reasoning } : {}),
    messages: [{ role: 'system', content: r.system }, { role: 'user', content: r.user }],
    ...(r.schema
      ? {
        response_format: {
          type: 'json_schema',
          json_schema: { name: r.schema.name, strict: true, schema: r.schema.schema },
        },
      }
      : {}),
  });
  const outcome = await callProvider(
    ctx,
    { purpose: r.purpose, model: r.model, sessionId: r.sessionId, timeoutMs: CHAT_TIMEOUT_MS },
    (signal) =>
      ctx.deps.fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.deps.apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal,
      }),
  );
  if (!outcome.ok || !outcome.payload) throw new ProviderError(outcome.status === 'aborted');
  const choices = outcome.payload.choices;
  const message = Array.isArray(choices) ? asObject(asObject(choices[0])?.message) : null;
  return { payload: outcome.payload, text: typeof message?.content === 'string' ? message.content : null };
}

/** chatCompletion with the reply parsed as JSON (null when it is not JSON). */
export async function chatJson(
  ctx: Ctx,
  r: ChatRequest,
): Promise<{ payload: Record<string, unknown>; content: unknown }> {
  const { payload, text } = await chatCompletion(ctx, r);
  let content: unknown = null;
  if (text !== null) {
    try {
      content = JSON.parse(text);
    } catch {
      content = null;
    }
  }
  return { payload, content };
}

export { FAILED as MODEL_FAILED };
