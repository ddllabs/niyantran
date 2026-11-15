// Shared fakes for the factcheck tests: a recording set of dependencies, an in-memory claim store
// with the same conditional semantics as the real one, a WAV builder and request builders.

import type { ModelCallRow } from './modelCall.ts';
import type {
  CheckResult,
  ClaimInsert,
  ClaimRow,
  ClaimStore,
  FactcheckDeps,
  HeldPatch,
  RpcResult,
  SessionRow,
} from './types.ts';

export const USER = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER = '99999999-9999-4999-8999-999999999999';
export const SESSION = '22222222-2222-4222-8222-222222222222';
export const TOKEN = 'hdr.payload-SECRET-TOKEN.sig';
export const KEY = 'sk-or-test-KEY-0123456789';
export const ORIGIN = 'http://localhost:5173';
export const NOW = Date.parse('2026-11-16T10:00:20.000Z');

// ---- WAV -------------------------------------------------------------------------------------

export interface WavOptions {
  samples?: Int16Array;
  seconds?: number;
  rate?: number;
  channels?: number;
  bits?: number;
  format?: number;
  magic?: string;
  wave?: string;
  /** Overrides the data chunk's declared size. */
  dataSize?: number;
  /** Overrides the RIFF size field. */
  riffSize?: number;
  extraBytes?: number;
  truncateTo?: number;
}

export function tone(count: number, amplitude = 8000): Int16Array {
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = Math.round(Math.sin(i / 7) * amplitude);
  return out;
}

export function wav(o: WavOptions = {}): Uint8Array {
  const rate = o.rate ?? 16000;
  const channels = o.channels ?? 1;
  const bits = o.bits ?? 16;
  const samples = o.samples ?? tone(Math.round((o.seconds ?? 2) * rate));
  const dataLen = samples.length * 2;
  const bytes = new Uint8Array(44 + dataLen + (o.extraBytes ?? 0));
  const v = new DataView(bytes.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  tag(0, o.magic ?? 'RIFF');
  v.setUint32(4, o.riffSize ?? bytes.length - 8, true);
  tag(8, o.wave ?? 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, o.format ?? 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * (bits / 8), true);
  v.setUint16(32, channels * (bits / 8), true);
  v.setUint16(34, bits, true);
  tag(36, 'data');
  v.setUint32(40, o.dataSize ?? dataLen, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i], true);
  return o.truncateTo !== undefined ? bytes.slice(0, o.truncateTo) : bytes;
}

// ---- requests --------------------------------------------------------------------------------

export function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/factcheck', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export function transcribeRequest(
  file: Uint8Array | null = wav(),
  fields: Record<string, string> = {},
  headers: Record<string, string> = {},
): Request {
  const form = new FormData();
  form.append('action', 'transcribe');
  form.append('session_id', SESSION);
  form.append('seq', '3');
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.append('file', new Blob([file as BlobPart], { type: 'audio/wav' }), 'piece.wav');
  return new Request('http://localhost/factcheck', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, origin: ORIGIN, ...headers },
    body: form,
  });
}

// ---- model responses -------------------------------------------------------------------------

export function chatPayload(content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gen-abc',
    model: 'served/model',
    provider: 'SomeProvider',
    choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, cost: 0.0054 },
    ...extra,
  };
}

/** A sonar reply in the fixed plain-text format. */
export const checkReply = (label: string, reason: string, extra: Record<string, unknown> = {}) =>
  chatPayload(`LABEL: ${label}\nREASON: ${reason}`, extra);

export const extraction = (claims: unknown[] = [], ledger_updates: unknown[] = []) => ({
  claims,
  ledger_updates,
});

export const modelClaim = (o: Record<string, unknown> = {}) => ({
  quote: 'देश में अपराध घटा है',
  claim_en: 'Crime in India fell by 20 percent in 2025.',
  claimant: 'Home Minister',
  reported_by: 'the anchor',
  kind: 'claim',
  checkable: true,
  needs_context: false,
  resolves_id: null,
  ...o,
});

// ---- the in-memory claim store ---------------------------------------------------------------

export class MemStore implements ClaimStore {
  sessions: SessionRow[] = [{
    id: SESSION,
    user_id: USER,
    video_id: 'RJfqzUWZ0Bw',
    channel_id: 'aaj-tak',
    video_kind: 'live',
  }];
  rows: ClaimRow[] = [];
  insertedCount = 0;
  nextId = 1;
  ops: string[] = [];
  /** Scoped lookups seen, to prove claims are always read by id AND session AND user. */
  scopes: { op: string; userId: string; sessionId: string; claimId?: string }[] = [];
  failInsert = false;

  id(): string {
    return `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
  }
  add(o: Partial<ClaimRow> = {}): ClaimRow {
    const row: ClaimRow = {
      id: this.id(),
      session_id: SESSION,
      user_id: USER,
      quote: 'q',
      claim_en: 'A stored claim.',
      claimant: null,
      reported_by: null,
      kind: 'claim',
      status: 'pending',
      verdict: null,
      reason: null,
      sources: [],
      checked_at: null,
      spoken_at: '2026-11-16T09:00:00.000Z',
      ...o,
    };
    this.rows.push(row);
    return row;
  }
  // deno-lint-ignore require-await
  async session(userId: string, sessionId: string) {
    this.ops.push('session');
    return this.sessions.find((s) => s.id === sessionId && s.user_id === userId) ?? null;
  }
  // deno-lint-ignore require-await
  async claims(userId: string, sessionId: string, limit: number) {
    this.ops.push('claims');
    this.scopes.push({ op: 'claims', userId, sessionId });
    return this.rows.filter((r) => r.session_id === sessionId && r.user_id === userId).slice(-limit).reverse();
  }
  // deno-lint-ignore require-await
  async insertClaims(rows: ClaimInsert[]) {
    this.ops.push('insert');
    if (this.failInsert) throw new Error('insert failed');
    const out: ClaimRow[] = [];
    for (const r of rows) {
      this.insertedCount++;
      const row: ClaimRow = { ...r, id: this.id(), verdict: null, reason: null, sources: [], checked_at: null };
      this.rows.push(row);
      out.push(row);
    }
    return out;
  }
  find(userId: string, sessionId: string, claimId: string) {
    return this.rows.find((r) => r.id === claimId && r.session_id === sessionId && r.user_id === userId);
  }
  // deno-lint-ignore require-await
  async updateHeld(userId: string, sessionId: string, claimId: string, patch: HeldPatch) {
    this.ops.push('updateHeld');
    this.scopes.push({ op: 'updateHeld', userId, sessionId, claimId });
    const row = this.find(userId, sessionId, claimId);
    if (!row || row.status !== 'needs_context') return null;
    Object.assign(row, patch);
    return { ...row };
  }
  // deno-lint-ignore require-await
  async claim(userId: string, sessionId: string, claimId: string) {
    this.ops.push('claim');
    this.scopes.push({ op: 'claim', userId, sessionId, claimId });
    const row = this.find(userId, sessionId, claimId);
    return row ? { ...row } : null;
  }
  // deno-lint-ignore require-await
  async lockForCheck(userId: string, sessionId: string, claimId: string, at: string, staleBefore: string) {
    this.ops.push('lock');
    this.scopes.push({ op: 'lock', userId, sessionId, claimId });
    const row = this.find(userId, sessionId, claimId);
    if (!row || row.status !== 'pending') return false;
    if (row.checked_at !== null && row.checked_at >= staleBefore) return false;
    row.checked_at = at;
    return true;
  }
  // deno-lint-ignore require-await
  async releaseCheck(userId: string, sessionId: string, claimId: string) {
    this.ops.push('release');
    const row = this.find(userId, sessionId, claimId);
    if (row && row.status === 'pending') row.checked_at = null;
  }
  // deno-lint-ignore require-await
  async finishCheck(userId: string, sessionId: string, claimId: string, r: CheckResult) {
    this.ops.push('finish');
    this.scopes.push({ op: 'finish', userId, sessionId, claimId });
    const row = this.find(userId, sessionId, claimId);
    if (!row || row.status !== 'pending') return null;
    Object.assign(row, r);
    return { ...row };
  }
}

// ---- the recording dependencies --------------------------------------------------------------

export interface Models {
  transcribe?: (form: FormData) => unknown;
  extract?: (body: Record<string, unknown>) => unknown;
  check?: (body: Record<string, unknown>) => unknown;
}

export interface Harness {
  deps: FactcheckDeps;
  store: MemStore;
  events: string[];
  rpcCalls: { name: string; args: Record<string, unknown> }[];
  fetches: { url: string; model: string; body: unknown }[];
  logRows: ModelCallRow[];
  rpcResult: Record<string, RpcResult>;
  models: Models;
  admin: { value: boolean; tokens: string[] };
}

export function harness(overrides: Partial<FactcheckDeps> = {}): Harness {
  const store = new MemStore();
  const events: string[] = [];
  const rpcCalls: Harness['rpcCalls'] = [];
  const fetches: Harness['fetches'] = [];
  const logRows: ModelCallRow[] = [];
  const admin = { value: true, tokens: [] as string[] };
  const rpcResult: Record<string, RpcResult> = {
    factcheck_touch: { data: { ok: true, seconds_left: 240 }, error: null },
    factcheck_start: {
      data: {
        ok: true,
        session_id: SESSION,
        credits_per_minute: 500,
        credits_held: 2500,
        ends_at: '2026-11-16T10:05:00Z',
      },
      error: null,
    },
    factcheck_settle: {
      data: { ok: true, repeated: false, minutes_used: 2, credits_charged: 1000, balance: 4000 },
      error: null,
    },
  };
  const models: Models = {
    transcribe: () => ({ text: ' नमस्ते दर्शकों ', usage: { cost: 0.0004, seconds: 10 }, id: 'gen-t' }),
    extract: () => chatPayload(extraction()),
    check: () => checkReply('Supported', 'Official data confirm it.', { citations: ['https://example.org/a'] }),
  };
  const asResponse = (v: unknown) => (v instanceof Response ? v : new Response(JSON.stringify(v), { status: 200 }));
  const deps: FactcheckDeps = {
    verify: (token) => {
      events.push('verify');
      return Promise.resolve(token === TOKEN ? { id: USER } : null);
    },
    active: () => {
      events.push('active');
      return Promise.resolve(true);
    },
    isAdmin: (token) => {
      events.push('isAdmin');
      admin.tokens.push(token);
      return Promise.resolve(admin.value);
    },
    rpc: (name, args) => {
      events.push(`rpc:${name}`);
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult[name]);
    },
    store: new Proxy(store, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          events.push(`store:${String(prop)}`);
          return value.apply(target, args);
        };
      },
    }),
    apiKey: KEY,
    fetch: async (url, init) => {
      if (url.endsWith('/audio/transcriptions')) {
        const form = init.body as FormData;
        events.push('fetch:transcribe');
        fetches.push({ url, model: String(form.get('model')), body: form });
        return asResponse(await models.transcribe!(form));
      }
      const body = JSON.parse(String(init.body));
      events.push(`fetch:chat:${body.model}`);
      fetches.push({ url, model: body.model, body });
      const handler = body.model === 'perplexity/sonar' ? models.check : models.extract;
      return asResponse(await handler!(body));
    },
    logModelCall: (row) => {
      logRows.push(row);
      return Promise.resolve();
    },
    now: () => NOW,
    origins: [ORIGIN],
    ...overrides,
  };
  return { deps, store, events, rpcCalls, fetches, logRows, rpcResult, models, admin };
}

/** Runs f with console.log captured, returns what was logged. */
export async function captureLogs<T>(f: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    return { result: await f(), lines };
  } finally {
    console.log = original;
  }
}
