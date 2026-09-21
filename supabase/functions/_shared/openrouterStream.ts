// Streaming chat completions through OpenRouter (streaming spec §D). One
// request in, a sequence of ModelEvents out: reasoning deltas, text deltas,
// complete tool calls, then one finish with usage. No retry here — the
// failover chain lives in the handler, which needs to know whether any text
// already reached the reader before it decides.

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}

export interface Usage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_prompt_tokens?: number;
  reasoning_tokens?: number;
  cost?: number;
}

export type ModelEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; args: string }
  | { type: 'finish'; reason: string; usage: Usage | null; served: string | null; generationId: string | null };

/** Private accounting observations; never serialized into the provider body. */
export interface AttemptMetadata {
  served: string | null;
  generationId: string | null;
  usage: Usage | null;
  provider?: string | null;
}
export interface StreamRequest {
  model: string;
  messages: Message[];
  tools?: unknown[];
  response_format?: unknown;
  reasoning?: { effort: string };
  max_tokens?: number;
  /** Add Anthropic-style cache breakpoints when the system prompt is long enough. */
  cache?: boolean;
  signal?: AbortSignal;
  onAttemptMetadata?: (metadata: AttemptMetadata) => void;
}

export interface StreamDeps {
  fetch: typeof fetch;
  apiKey: string;
  endpoint?: string;
}

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Below this, a cache breakpoint is billed as a cache write for nothing. */
export const MIN_CACHEABLE_PREFIX_CHARS = 4_000;

export class ProviderError extends Error {
  status: number;
  body: string;
  retryable: boolean;
  code: 'schema' | 'provider';
  constructor(status: number, body: string) {
    const short = String(body ?? '').slice(0, 300);
    super(`OpenRouter ${status}: ${short}`);
    this.name = 'ProviderError';
    this.status = status;
    this.body = String(body ?? '');
    this.retryable = status === 429 || status >= 500;
    this.code = /response_format|json_schema|structured output/i.test(this.body) ? 'schema' : 'provider';
  }
}

type Part = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } };

function withCacheBreakpoints(messages: Message[]): unknown[] {
  const system = messages.find((m) => m.role === 'system');
  const systemLength = typeof system?.content === 'string' ? system.content.length : 0;
  if (systemLength < MIN_CACHEABLE_PREFIX_CHARS) return messages;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  return messages.map((m) => {
    if ((m === system || m === lastUser) && typeof m.content === 'string') {
      const part: Part = { type: 'text', text: m.content, cache_control: { type: 'ephemeral' } };
      return { ...m, content: [part] };
    }
    return m;
  });
}

export function buildRequestBody(req: StreamRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.cache ? withCacheBreakpoints(req.messages) : req.messages,
    stream: true,
    usage: { include: true },
  };
  if (req.tools?.length) {
    body.tools = req.tools;
    body.tool_choice = 'auto';
  }
  if (req.response_format) {
    body.response_format = req.response_format;
    body.provider = { require_parameters: true };
  }
  if (req.reasoning) body.reasoning = { effort: req.reasoning.effort };
  if (req.max_tokens) body.max_tokens = req.max_tokens;
  return body;
}

/** One `data:` payload per yield; comment lines ignored; `[DONE]` ends the stream. */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line === '') {
          if (data.length) {
            const payload = data.join('\n');
            data = [];
            if (payload.trim() === '[DONE]') return;
            yield payload;
          }
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (done) break;
    }
    if (data.length) {
      const payload = data.join('\n');
      if (payload.trim() !== '[DONE]') yield payload;
    }
  } finally {
    reader.releaseLock();
  }
}

function normaliseUsage(u: Record<string, unknown> | null | undefined): Usage | null {
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cdetails = (u.completion_tokens_details ?? {}) as Record<string, unknown>;
  const out: Usage = {
    prompt_tokens: n(u.prompt_tokens),
    completion_tokens: n(u.completion_tokens),
    total_tokens: n(u.total_tokens),
  };
  if (n(details.cached_tokens) !== null) out.cached_prompt_tokens = n(details.cached_tokens)!;
  if (n(cdetails.reasoning_tokens) !== null) out.reasoning_tokens = n(cdetails.reasoning_tokens)!;
  if (n(u.cost) !== null) out.cost = n(u.cost)!;
  return out;
}

export async function* streamChat(deps: StreamDeps, req: StreamRequest): AsyncGenerator<ModelEvent> {
  req.signal?.throwIfAborted();
  let served: string | null = null;
  let generationId: string | null = null;
  let usage: Usage | null = null;
  let provider: string | null = null;
  const bounded = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value)
      ? value
      : null;
  const observe = () => {
    try {
      req.onAttemptMetadata?.({ served, generationId, provider, usage: usage ? { ...usage } : null });
    } catch { /* accounting observers cannot interrupt the provider */ }
  };
  const res = await deps.fetch(deps.endpoint ?? OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${deps.apiKey}`,
      'content-type': 'application/json',
      'x-title': 'Niyantran Terminal',
    },
    body: JSON.stringify(buildRequestBody(req)),
    signal: req.signal,
  });
  generationId = bounded(res.headers.get('x-generation-id'));
  observe();
  if (!res.ok) throw new ProviderError(res.status, await res.text().catch(() => ''));
  if (!res.body) throw new ProviderError(502, 'empty response body');

  const calls = new Map<number, { id: string; name: string; args: string }>();
  let finish: string | null = null;

  for await (const payload of parseSseStream(res.body)) {
    req.signal?.throwIfAborted();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    if (bounded(json.model)) served = bounded(json.model);
    if (bounded(json.id)) generationId = bounded(json.id);
    if (bounded(json.provider)) provider = bounded(json.provider);
    if (json.usage) usage = normaliseUsage(json.usage as Record<string, unknown>);
    observe();
    if (json.error && typeof json.error === 'object') {
      const e = json.error as { code?: unknown; message?: unknown };
      const status = typeof e.code === 'number' ? e.code : 502;
      throw new ProviderError(status, String(e.message ?? JSON.stringify(e)));
    }
    const choice = (json.choices as Record<string, unknown>[] | undefined)?.[0];
    if (!choice) continue;
    if (choice.error || choice.finish_reason === 'error') {
      throw new ProviderError(502, 'Provider reported an unsuccessful finish');
    }
    const delta = (choice.delta ?? {}) as Record<string, unknown>;
    if (finish) {
      const hasOutput = ['content', 'reasoning', 'reasoning_content', 'tool_calls'].some((key) => {
        const value = delta[key];
        return value != null && value !== '' && (!Array.isArray(value) || value.length > 0);
      });
      if (
        hasOutput ||
        (typeof choice.finish_reason === 'string' && choice.finish_reason && choice.finish_reason !== finish)
      ) {
        throw new ProviderError(502, 'Provider sent contradictory data after finishing');
      }
    }
    const reasoning = delta.reasoning ?? delta.reasoning_content;
    if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
    if (typeof delta.content === 'string' && delta.content) yield { type: 'text', text: delta.content };
    for (const tc of (delta.tool_calls ?? []) as Record<string, unknown>[]) {
      const index = typeof tc.index === 'number' ? tc.index : 0;
      const cur = calls.get(index) ?? { id: '', name: '', args: '' };
      if (typeof tc.id === 'string' && tc.id) cur.id = tc.id;
      const fn = (tc.function ?? {}) as Record<string, unknown>;
      if (typeof fn.name === 'string') cur.name += fn.name;
      if (typeof fn.arguments === 'string') cur.args += fn.arguments;
      calls.set(index, cur);
    }
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) finish = choice.finish_reason;
  }

  req.signal?.throwIfAborted();
  // EOF and [DONE] describe the transport, not a completed generation. Usage
  // may be missing, or repeat the actual finish reason in its final frame.
  if (!finish) throw new ProviderError(502, 'Provider stream ended without a finish reason');
  if (finish === 'tool_calls') {
    const ordered = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call);
    if (!ordered.length) throw new ProviderError(502, 'Provider finished without complete tool calls');
    // Validate the entire batch before emitting any callable item. In
    // particular, length/content_filter fragments must never become tools.
    for (const call of ordered) {
      let args: unknown;
      try {
        args = JSON.parse(call.args);
      } catch { /* rejected below */ }
      if (!call.id.trim() || !call.name.trim() || !args || typeof args !== 'object' || Array.isArray(args)) {
        throw new ProviderError(502, 'Provider returned an incomplete tool call');
      }
    }
    for (const call of ordered) {
      req.signal?.throwIfAborted();
      yield { type: 'tool-call', id: call.id, name: call.name, args: call.args };
    }
  }
  req.signal?.throwIfAborted();
  yield { type: 'finish', reason: finish, usage, served, generationId };
}
