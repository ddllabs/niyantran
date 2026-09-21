// OpenRouter embeddings (RAG spec §C, ADR 0002). One model, one width,
// asserted on every call before anything is stored. Response fields verified
// against OpenRouter's API reference on 2026-09-21:
//   { data: [{ embedding: number[], index: number }], model: string,
//     usage: { prompt_tokens: number, total_tokens: number } }
// Price from GET /api/v1/embeddings/models the same day: prompt 0.00000002 USD/token.

export const EMBED_MODEL = 'openai/text-embedding-3-small';
export const EMBED_DIMS = 1536;
export const EMBED_PRICE_USD_PER_TOKEN = 0.00000002;
export const EMBED_URL = 'https://openrouter.ai/api/v1/embeddings';

/** Request bounds: inputs per request, estimated tokens per request, and per single input. */
export interface EmbedBatchBounds {
  maxCount: number;
  maxTokens: number;
  maxInputTokens: number;
}
export const EMBED_BATCH: Readonly<EmbedBatchBounds> = Object.freeze({ maxCount: 96, maxTokens: 200_000, maxInputTokens: 7_000 });

const MAX_ATTEMPTS = 3;

export interface EmbedResult {
  vectors: number[][];
  model: string;
  promptTokens: number;
  costUsd: number;
  requests: number;
}

export class EmbeddingError extends Error {
  /** Cost and tokens already spent by the batches that succeeded before the failure. */
  costUsd: number;
  promptTokens: number;
  status?: number;
  constructor(message: string, spent: { costUsd: number; promptTokens: number }, status?: number) {
    super(message);
    this.costUsd = spent.costUsd;
    this.promptTokens = spent.promptTokens;
    this.status = status;
  }
}

export interface EmbedDeps {
  fetch: typeof fetch;
  apiKey: string;
  sleep?: (ms: number) => Promise<void>;
  /** Overrides for tests; production uses EMBED_BATCH. */
  batch?: Partial<EmbedBatchBounds>;
}

function estimate(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Split inputs into request-sized batches, preserving order. A single input never exceeds maxInputTokens. */
export function planBatches(inputs: string[], maxCount = EMBED_BATCH.maxCount, maxTokens = EMBED_BATCH.maxTokens): string[][] {
  const batches: string[][] = [];
  let cur: string[] = [];
  let curTokens = 0;
  for (const input of inputs) {
    const t = estimate(input);
    if (cur.length && (cur.length >= maxCount || curTokens + t > maxTokens)) {
      batches.push(cur);
      cur = [];
      curTokens = 0;
    }
    cur.push(input);
    curTokens += t;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

interface ProviderResponse {
  data?: { embedding?: unknown; index?: unknown }[];
  model?: unknown;
  usage?: { prompt_tokens?: unknown; total_tokens?: unknown };
  error?: { message?: unknown };
}

async function requestBatch(
  deps: EmbedDeps,
  batch: string[],
  spent: { costUsd: number; promptTokens: number },
): Promise<{ vectors: number[][]; model: string; promptTokens: number }> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastStatus = 0;
  let lastMessage = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await deps.fetch(EMBED_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.apiKey}`,
        'content-type': 'application/json',
        'http-referer': 'https://niyantran.ai',
        'x-title': 'Niyantran Terminal',
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: batch, encoding_format: 'float' }),
    });
    lastStatus = res.status;
    const payload = (await res.json().catch(() => ({}))) as ProviderResponse;
    if (res.status === 429 || res.status >= 500) {
      lastMessage = String(payload?.error?.message ?? `HTTP ${res.status}`);
      if (attempt < MAX_ATTEMPTS) await sleep(500 * attempt);
      continue;
    }
    if (!res.ok) {
      throw new EmbeddingError(`embeddings HTTP ${res.status}: ${String(payload?.error?.message ?? 'no detail')}`, spent, res.status);
    }
    const model = typeof payload.model === 'string' ? payload.model : '';
    if (model !== EMBED_MODEL) {
      throw new EmbeddingError(`embeddings served by ${model || 'an unnamed model'}, expected ${EMBED_MODEL}`, spent, res.status);
    }
    const data = Array.isArray(payload.data) ? payload.data : [];
    if (data.length !== batch.length) {
      throw new EmbeddingError(`embeddings returned ${data.length} vectors for ${batch.length} inputs`, spent, res.status);
    }
    const ordered: number[][] = new Array(batch.length);
    for (const item of data) {
      const idx = typeof item.index === 'number' ? item.index : -1;
      const vec = item.embedding;
      if (idx < 0 || idx >= batch.length || !Array.isArray(vec)) {
        throw new EmbeddingError('embeddings response item is malformed', spent, res.status);
      }
      if (vec.length !== EMBED_DIMS) {
        throw new EmbeddingError(`embedding width ${vec.length}, expected ${EMBED_DIMS}`, spent, res.status);
      }
      ordered[idx] = vec as number[];
    }
    const promptTokens = Number(payload.usage?.prompt_tokens ?? 0);
    return { vectors: ordered, model, promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0 };
  }
  throw new EmbeddingError(`embeddings HTTP ${lastStatus} after ${MAX_ATTEMPTS} attempts: ${lastMessage}`, spent, lastStatus);
}

/** Embed every input, in order. Throws EmbeddingError carrying the cost already spent. */
export async function embedTexts(deps: EmbedDeps, inputs: string[]): Promise<EmbedResult> {
  const bounds = { ...EMBED_BATCH, ...deps.batch };
  const maxChars = bounds.maxInputTokens * 4;
  const clamped = inputs.map((s) => (s.length > maxChars ? s.slice(0, maxChars) : s));
  const spent = { costUsd: 0, promptTokens: 0 };
  const vectors: number[][] = [];
  let requests = 0;
  if (!clamped.length) return { vectors, model: EMBED_MODEL, promptTokens: 0, costUsd: 0, requests };
  for (const batch of planBatches(clamped, bounds.maxCount, bounds.maxTokens)) {
    const r = await requestBatch(deps, batch, spent);
    requests += 1;
    vectors.push(...r.vectors);
    spent.promptTokens += r.promptTokens;
    spent.costUsd += r.promptTokens * EMBED_PRICE_USD_PER_TOKEN;
  }
  return { vectors, model: EMBED_MODEL, promptTokens: spent.promptTokens, costUsd: spent.costUsd, requests };
}
