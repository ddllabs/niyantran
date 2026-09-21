import type { CitationSource } from '../_shared/citation.types.ts';
import type { ResearchRequest } from './validate.ts';

export const TURN_DEADLINE_MS = 120_000;
export type TerminalStatus = 'complete' | 'error' | 'cancelled' | 'truncated' | 'interrupted';
export interface TerminalResult {
  content: string;
  status: TerminalStatus;
  sources: CitationSource[];
  follow_ups: string[];
  activity: unknown[];
  model_served: string | null;
  error_message: string | null;
  usage: Record<string, unknown> | null;
  timing: { search_ms: number; reasoning_ms: number; writing_ms: number; total_ms: number } | null;
}
export interface TurnSnapshot {
  conversation: { id: string; title: string };
  user_message_id: string;
  assistant: Omit<TerminalResult, 'status'> & {
    id: string;
    status: 'running' | TerminalStatus;
    execution_expires_at: string;
  };
  server_now: string;
}
export interface ClaimedTurn extends TurnSnapshot {
  kind: 'claimed';
  execution_token: string;
  remaining_ms?: number;
}
export type TurnFailure = { kind: 'missing' | 'conflict' | 'not_found' | 'deleted' | 'forbidden' };
export type TurnState = TurnFailure | (TurnSnapshot & { kind: 'running' | 'terminal' });
export interface TurnIdentity {
  ownerId: string;
  turnKey: string;
  requestHash: string;
  conversationId?: string;
}
export interface ClaimInput extends TurnIdentity {
  message: string;
  model: string;
  effort: string | null;
  deskTier?: string;
  deskFeature?: string;
}
export interface TurnStore {
  lookup(input: TurnIdentity): Promise<TurnState>;
  claim(input: ClaimInput): Promise<ClaimedTurn | TurnState>;
  finalize(ownerId: string, turnKey: string, executionToken: string, result: TerminalResult): Promise<TurnState>;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map((
          [key, item],
        ) => [key, canonical(item)]),
    );
  }
  return value;
}
/** Hash request intent, never a model default resolved at retry time. */
export async function fingerprintRequest(request: ResearchRequest): Promise<string> {
  const { conversation_id: _parent, turn_key: _key, ...intent } = request;
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(intent)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

interface Rpc {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: { code?: string; message?: string } | null }>;
}
/** The caller supplies the EXISTING service client. Never construct an Auth
 * client here, and never pass an unverified body.user_id as ownerId. */
export function rpcTurnStore(client: Rpc): TurnStore {
  async function invoke(name: string, args: Record<string, unknown>): Promise<ClaimedTurn | TurnState> {
    const started = performance.now();
    const { data, error } = await client.rpc(name, args);
    if (error?.code === 'P0002') return { kind: 'not_found' };
    if (error?.code === '23505') return { kind: 'conflict' };
    if (error?.code === '42501') return { kind: 'forbidden' };
    if (error || !data || typeof data !== 'object' || !('kind' in data)) {
      throw new Error('Turn persistence unavailable');
    }
    const state = data as ClaimedTurn | TurnState;
    if (state.kind === 'claimed') {
      state.remaining_ms = Date.parse(state.assistant.execution_expires_at) - Date.parse(state.server_now) -
        (performance.now() - started);
    }
    return state;
  }
  const identity = (i: TurnIdentity) => ({
    p_user_id: i.ownerId,
    p_turn_key: i.turnKey,
    p_request_hash: i.requestHash,
    p_conversation_id: i.conversationId ?? null,
  });
  return {
    lookup: (input) => invoke('lookup_research_turn', identity(input)) as Promise<TurnState>,
    claim: (input) =>
      invoke('claim_research_turn', {
        ...identity(input),
        p_message: input.message,
        p_model: input.model,
        p_effort: input.effort,
        p_desk_tier: input.deskTier ?? null,
        p_desk_feature: input.deskFeature ?? null,
      }),
    finalize: (ownerId, turnKey, executionToken, result) =>
      invoke('finalize_research_turn', {
        p_user_id: ownerId,
        p_turn_key: turnKey,
        p_execution_token: executionToken,
        p_result: result,
      }) as Promise<TurnState>,
  };
}

export interface TurnExecution {
  claim: ClaimedTurn;
  signal: AbortSignal;
  /** Visible partial output only; do not checkpoint hidden provider reasoning. */
  checkpoint(value: Partial<TerminalResult>): void;
}
/** Own one bounded execution. Only this wrapper finalizes: a provider ignoring
 * abort cannot later overwrite the interrupted/error result. D4 owns transport. */
export async function executeClaimedTurn(input: {
  store: Pick<TurnStore, 'finalize'>;
  ownerId: string;
  turnKey: string;
  claim: ClaimedTurn;
  execute(context: TurnExecution): Promise<TerminalResult>;
}): Promise<TurnState> {
  const { claim } = input;
  const abort = new AbortController();
  let active = true;
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
  // Reserve five seconds of the DB's fixed deadline for final persistence.
  const remaining = Math.min(
    TURN_DEADLINE_MS,
    claim.remaining_ms ?? TURN_DEADLINE_MS,
    Date.parse(claim.assistant.execution_expires_at) - Date.parse(claim.server_now),
  );
  if (!Number.isFinite(remaining)) throw new Error('Invalid turn deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interrupted = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      interrupted = true;
      abort.abort();
      reject(new Error('Execution interrupted'));
    }, Math.max(0, remaining - 5_000));
  });
  let terminal: TerminalResult;
  try {
    if (remaining <= 5_000) {
      interrupted = true;
      throw new Error('Execution interrupted');
    }
    terminal = await Promise.race([
      Promise.resolve().then(() =>
        input.execute({
          claim,
          signal: abort.signal,
          checkpoint: (value) => {
            if (active) partial = { ...partial, ...value };
          },
        })
      ),
      deadline,
    ]);
  } catch {
    terminal = {
      ...partial,
      status: interrupted ? 'interrupted' : 'error',
      error_message: interrupted ? 'Execution interrupted.' : 'The turn failed. Please try a new turn.',
    };
  } finally {
    active = false;
    clearTimeout(timer);
    abort.abort();
  }
  return await input.store.finalize(input.ownerId, input.turnKey, claim.execution_token, terminal);
}
