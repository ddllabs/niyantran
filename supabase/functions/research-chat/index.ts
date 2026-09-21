// Request-scoped wiring only. Imports do not read environment, start a server,
// or contact Auth/providers. The handler owns the durable turn lifecycle.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { corsHeaders, preflight } from '../_shared/cors.ts';
import { deskCatalogBlock } from '../_shared/deskCatalog.ts';
import { EMBED_DIMS, EMBED_MODEL, embedTexts, servedModelMatches } from '../_shared/embed.ts';
import { errorResponse, HttpError } from '../_shared/http.ts';
import { log } from '../_shared/logging.ts';
import { promptFile } from '../_shared/personaMap.ts';
import { type AttemptMetadata, streamChat } from '../_shared/openrouterStream.ts';
import { search } from '../_shared/retrieval.ts';
import { serviceClient, userClient } from '../_shared/supabase.ts';
import { type DeskRow, executeSearchDeskRows } from '../_shared/tools/searchDeskRows.ts';
import { type HandlerDeps, handleResearchChat, type RetrievalContext } from './handler.ts';
import { rpcTurnStore } from './persistence.ts';

export const NETWORK_TIMEOUT_MS = 4_000;
export interface Runtime {
  userClient: typeof userClient;
  serviceClient: typeof serviceClient;
  fetch: typeof fetch;
  env(name: string): string | undefined;
  readPersona(file: string): Promise<string>;
  timeoutMs: number;
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
  waitUntil?(work: Promise<unknown>): void;
}
function runtime(overrides: Partial<Runtime>): Runtime {
  return {
    userClient,
    serviceClient,
    fetch: (...args) => fetch(...args),
    env: (name) => Deno.env.get(name),
    readPersona: (file) => Deno.readTextFile(new URL(`../_shared/personas/${file}`, import.meta.url)),
    timeoutMs: NETWORK_TIMEOUT_MS,
    waitUntil: (work) =>
      (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(work),
    ...overrides,
  };
}
/** Timeouts can leave a committed RPC behind. Never retry here: the caller
 * recovers with the same durable owner/key, including after a claim timeout. */
async function bounded<T>(run: (signal: AbortSignal) => PromiseLike<T>, ms: number, parent?: AbortSignal): Promise<T> {
  parent?.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    stop = () => {
      controller.abort();
      reject(parent?.reason ?? new HttpError(503, 'Research service unavailable'));
    };
    parent?.addEventListener('abort', stop, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new HttpError(503, 'Research service unavailable'));
    }, ms);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return run(controller.signal);
      }),
      aborted,
    ]);
  } catch (e) {
    // The 503 sent to the caller stays deliberately generic, but the reason must
    // not be lost server-side: this wrapper covers every database query and RPC,
    // so discarding it made a permission error, a missing column and a genuine
    // timeout all indistinguishable.
    if (!parent?.aborted) {
      log('research.bounded_failed', {
        timeout_ms: ms,
        kind: (e as Error)?.name ?? 'unknown',
        message: String((e as Error)?.message ?? e).slice(0, 300),
      });
    }
    throw parent?.aborted ? parent.reason : new HttpError(503, 'Research service unavailable');
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', stop);
  }
}
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function scalar(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value)
    ? value
    : null;
}
function metadata(payload: Record<string, unknown>, generation: string | null): AttemptMetadata {
  const u = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : null;
  const observed = (v: unknown) => typeof v === 'number' ? number(v) : null;
  const usage = u
    ? {
      prompt_tokens: observed(u.prompt_tokens),
      completion_tokens: observed(u.completion_tokens),
      total_tokens: observed(u.total_tokens),
      ...(observed(u.cost) === null ? {} : { cost: observed(u.cost)! }),
    }
    : null;
  return {
    served: scalar(payload.model),
    generationId: scalar(payload.id) ?? scalar(generation),
    provider: scalar(payload.provider),
    usage,
  };
}
/** Local to query retrieval: ingestion keeps its existing batching behavior.
 * Validate before marking success; shared embedTexts' inferred cost/zeros are
 * never used as observed usage for accounting. */
export async function embedQuery(query: string, context: RetrievalContext, r: Runtime, apiKey: string) {
  const result = await embedTexts({
    apiKey,
    fetch: async (url, init) => {
      context.signal.throwIfAborted();
      let attempt: ReturnType<RetrievalContext['beginEmbeddingAttempt']> | undefined;
      try {
        return await bounded(
          async (signal) => {
            context.signal.throwIfAborted();
            attempt = context.beginEmbeddingAttempt(EMBED_MODEL);
            const response = await r.fetch(url, { ...init, signal });
            context.signal.throwIfAborted();
            attempt.observe(metadata({}, response.headers.get('x-generation-id')));
            const payload = await response.json().catch(() => ({}));
            context.signal.throwIfAborted();
            const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
            attempt.observe(metadata(data, response.headers.get('x-generation-id')));
            if (response.ok) {
              const vectors = data.data as { index: unknown; embedding: unknown }[];
              if (
                !servedModelMatches(String(data.model ?? '')) || !Array.isArray(vectors) || vectors.length !== 1 ||
                vectors[0]?.index !== 0 ||
                !Array.isArray(vectors[0].embedding) || vectors[0].embedding.length !== EMBED_DIMS ||
                !vectors[0].embedding.every((v) => typeof v === 'number' && Number.isFinite(v))
              ) throw new Error('Invalid query embedding');
            }
            signal.throwIfAborted();
            attempt.finish(response.ok ? 'success' : 'error');
            return new Response(JSON.stringify(data), {
              status: response.status,
              headers: { 'content-type': 'application/json' },
            });
          },
          r.timeoutMs,
          context.signal,
        );
      } catch (error) {
        attempt?.finish(context.signal.aborted ? 'aborted' : 'error');
        throw error;
      }
    },
    sleep: (ms) =>
      bounded(
        (signal) =>
          r.sleep ? r.sleep(ms, signal) : new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              signal.removeEventListener('abort', abort);
              resolve();
            }, ms);
            const abort = () => {
              clearTimeout(timer);
              reject(signal.reason);
            };
            signal.addEventListener('abort', abort, { once: true });
          }),
        Math.max(ms + 100, r.timeoutMs),
        context.signal,
      ),
  }, [query]);
  context.signal.throwIfAborted();
  return { vector: result.vectors[0], model: result.model };
}
export function createDependencies(req: Request, overrides: Partial<Runtime> = {}): HandlerDeps {
  const r = runtime(overrides);
  let owner: string | null = null;
  let asCaller: SupabaseClient | null = null;
  const caller = () => {
    if (!owner || !asCaller) throw new HttpError(401, 'Sign in required');
    return asCaller;
  };
  const service = () => {
    caller();
    return r.serviceClient();
  };
  const observedCancellations = new Map<string, string>();
  async function query<T>(
    run: (signal: AbortSignal) => PromiseLike<{ data: T; error: unknown }>,
    signal?: AbortSignal,
  ): Promise<T> {
    const result = await bounded(run, r.timeoutMs, signal);
    if (result.error) {
      // PostgREST reports failures as a value rather than a throw, so this
      // branch never reached the catch above and wrote nothing anywhere.
      const err = result.error as { message?: string; code?: string; details?: string; hint?: string };
      log('research.query_failed', {
        code: err?.code ?? null,
        message: String(err?.message ?? '').slice(0, 300),
        details: String(err?.details ?? '').slice(0, 200),
        hint: String(err?.hint ?? '').slice(0, 200),
      });
      throw new HttpError(503, 'Research service unavailable');
    }
    return result.data;
  }
  const persistence = rpcTurnStore({
    rpc: (fn, args) => {
      if (!owner || args.p_user_id !== owner) throw new HttpError(403, 'Turn owner mismatch');
      return bounded((signal) => service().rpc(fn, args).abortSignal(signal), r.timeoutMs);
    },
  });
  return {
    requireUser: async (request) => {
      const verified = await requireUser(request, async (token) => {
        asCaller = r.userClient(token);
        const response = await bounded(() => asCaller!.auth.getUser(token), r.timeoutMs);
        return response.error ? null : response.data.user;
      });
      owner = verified.userId;
      return verified;
    },
    persistence,
    models: async () =>
      await query((signal) =>
        caller().from('ai_models').select('model_id,label,efforts,is_default,tier,params').eq('enabled', true).order(
          'sort_order',
          { ascending: true },
        ).abortSignal(signal)
      ) ?? [],
    pricing: async (model) => {
      const row = await query((signal) =>
        service().from('model_pricing').select('prompt_usd,completion_usd').eq('model_id', model).abortSignal(signal)
          .maybeSingle()
      );
      return row ? { prompt_usd: number(row.prompt_usd), completion_usd: number(row.completion_usd) } : null;
    },
    persona: async (userId) => {
      if (userId !== owner) throw new HttpError(403, 'Turn owner mismatch');
      const row = await query((signal) =>
        caller().from('user_profiles').select('persona').eq('user_id', userId).abortSignal(signal).maybeSingle()
      );
      return await bounded(() => r.readPersona(promptFile(row?.persona) ?? 'analyst.md'), r.timeoutMs);
    },
    catalogue: deskCatalogBlock,
    db: {
      recentMessages: async (conversationId, excluded) => {
        const data = await query((signal) => {
          let q = caller().from('chat_messages').select('role,content,created_at').eq('conversation_id', conversationId)
            .eq('user_id', owner!);
          for (const id of excluded) q = q.neq('id', id);
          return q.order('created_at', { ascending: false }).limit(40).abortSignal(signal);
        });
        return (data ?? []).reverse().map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: String(m.content ?? ''),
        }));
      },
      cancelRequestedSince: async (id, since) => {
        const row = await query((signal) =>
          caller().from('chat_cancellations').select('cancel_requested_at').eq('conversation_id', id).eq(
            'user_id',
            owner!,
          ).abortSignal(signal).maybeSingle()
        );
        const at = row?.cancel_requested_at;
        if (typeof at === 'string' && Date.parse(at) >= Date.parse(since)) {
          observedCancellations.set(id, at);
          return true;
        }
        return false;
      },
      clearCancellation: async (id) => {
        const timestamp = observedCancellations.get(id);
        if (!timestamp) return;
        await query((signal) =>
          caller().from('chat_cancellations').delete().eq('conversation_id', id).eq('user_id', owner!).eq(
            'cancel_requested_at',
            timestamp,
          ).abortSignal(signal)
        );
        if (observedCancellations.get(id) === timestamp) observedCancellations.delete(id);
      },
      resolveDocumentIds: async (keys) =>
        keys.length
          ? (await query((signal) =>
            caller().from('documents').select('id').in('metadata->>document_key', keys).abortSignal(signal)
          ) ?? []).map((d) => d.id)
          : [],
      findDeskRow: async (tier, feature, key) =>
        await query((signal) =>
          caller().from('desk_rows').select('tier,feature,row_key,row,record_text,document_key,snapshot_at').eq(
            'tier',
            tier,
          ).eq('feature', feature).eq('row_key', key).abortSignal(signal).maybeSingle()
        ) as DeskRow | null,
    },
    telemetry: {
      logModelCall: async (row) => {
        if (row.user_id !== owner) throw new HttpError(403, 'Turn owner mismatch');
        const data = await query((signal) =>
          service().from('model_call_logs').insert(row).select('id').abortSignal(signal).single()
        );
        return data?.id ?? null;
      },
      logTurnTraces: async (rows) => {
        if (rows.some((row) => row.user_id !== owner)) throw new HttpError(403, 'Turn owner mismatch');
        if (rows.length) await query((signal) => service().from('chat_turn_traces').insert(rows).abortSignal(signal));
      },
    },
    stream: (request) => streamChat({ fetch: r.fetch, apiKey: r.env('OPENROUTER_API_KEY') ?? '' }, request),
    searchDocuments: async (args, ids, context) => {
      caller();
      if (!context) throw new Error('Retrieval context required');
      return await search({
        embed: (q) => embedQuery(q, context, r, r.env('OPENROUTER_API_KEY') ?? ''),
        rpc: (fn, a) => bounded((signal) => caller().rpc(fn, a).abortSignal(signal), r.timeoutMs, context.signal),
      }, { query: args.query, deskTier: args.desk_tier, documentIds: ids });
    },
    searchDeskRows: async (args, context) => {
      caller();
      if (!context) throw new Error('Retrieval context required');
      return await executeSearchDeskRows({
        rpc: (fn, a) => bounded((signal) => caller().rpc(fn, a).abortSignal(signal), r.timeoutMs, context.signal),
      }, args);
    },
    repairModel: r.env('AI_REPAIR_MODEL') ?? '',
    headers: corsHeaders(req),
    waitUntil: r.waitUntil,
    today: () =>
      new Date().toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }) + ' (IST)',
  };
}
export function createResearchHandler(overrides: Partial<Runtime> = {}) {
  return async (req: Request): Promise<Response> => {
    const pre = preflight(req);
    if (pre) return pre;
    try {
      return await handleResearchChat(req, createDependencies(req, overrides));
    } catch (error) {
      return errorResponse(error, corsHeaders(req));
    }
  };
}
if (import.meta.main) Deno.serve(createResearchHandler());
