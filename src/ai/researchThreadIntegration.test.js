/**
 * F198: the research thread over the real stores (aiConversations, researchChat, userStore), with
 * only the Supabase client and the network faked. On production (D3) a finished answer left the
 * thread while it was saved, and the next send failed "Your research session changed." until
 * Reload. Changing the model is not what does it (the first test); supabase-js announcing the same
 * account again (a tab refocus, a token refresh) while the thread checks the account is.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ id: 'owner-a', token: 'token-1', expiresAt: 0, callback: null, tables: null, onGetUser: null, onChunk: null }));
vi.mock('../lib/supabaseClient.js', () => {
  function builder(table) {
    const filters = [];
    let order = null, limit = Infinity;
    const run = () => {
      let rows = (auth.tables[table] || []).filter(r => filters.every(f => f(r)));
      if (order) rows = [...rows].sort((a, b) => (a[order] < b[order] ? -1 : a[order] > b[order] ? 1 : 0));
      return rows.slice(0, limit);
    };
    const q = {
      select: () => q, abortSignal: () => q,
      eq(col, v) { filters.push(r => r[col] === v); return q; },
      gt(col, v) { filters.push(r => r[col] > v); return q; },
      order(col) { order = col; return q; },
      limit(n) { limit = n; return q; },
      maybeSingle: () => Promise.resolve({ data: run()[0] || null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: run(), error: null }).then(resolve, reject),
    };
    return q;
  }
  return {
    functionsUrl: () => 'https://fake.invalid/research-chat',
    supabase: {
      auth: {
        onAuthStateChange: fn => { auth.callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
        getSession: async () => ({ data: { session: auth.id ? { access_token: auth.token, user: { id: auth.id }, expires_at: auth.expiresAt / 1000 } : null } }),
        getUser: async () => { auth.onGetUser?.(); return { data: { user: auth.id ? { id: auth.id, email: `${auth.id}@example.invalid` } : null } }; },
      },
      rpc: async () => ({ data: { user_id: auth.id, status: 'active' } }),
      from: builder,
    },
  };
});
import { supabase } from '../lib/supabaseClient.js';
import { resumeLocalIdentityAfterSignIn } from '../lib/userStore.js';
import { resetConversations, useClient } from '../lib/aiConversations.js';
import { createResearchThread } from './useResearchThread.js';

const MODELS = [
  { model_id: 'google/lite', label: 'Gemini Lite', is_default: true, efforts: ['minimal', 'low', 'medium', 'high'] },
  { model_id: 'google/flash', label: 'Gemini Flash', efforts: ['low', 'medium', 'high'] },
];
let clock = Date.parse('2026-10-15T10:00:00Z');
const stamp = () => new Date(clock++).toISOString();
let turns = 0;

/** The turn's frames, one per read; `auth.onChunk(i)` runs before frame i is handed over. */
function sse(frames) {
  const chunks = [...frames.map(f => `data: ${JSON.stringify(f)}\n\n`), 'data: [DONE]\n\n'];
  let i = 0;
  return new Response(new ReadableStream({
    async pull(c) {
      if (i >= chunks.length) { c.close(); return; }
      await auth.onChunk?.(i);
      c.enqueue(new TextEncoder().encode(chunks[i++]));
    },
  }), { status: 200 });
}
/** research-chat: saves the question and a complete answer, then streams the turn. */
async function server(_url, init) {
  const body = JSON.parse(init.body);
  const n = ++turns;
  const conversationId = body.conversation_id || 'conv-1';
  if (!auth.tables.conversations.some(c => c.id === conversationId)) {
    auth.tables.conversations.push({ id: conversationId, user_id: auth.id, title: 'T', created_at: stamp(), last_message_at: stamp(), web_search: null });
  }
  const messageId = `answer-${n}`;
  auth.tables.chat_messages.push(
    { id: `question-${n}`, user_id: auth.id, conversation_id: conversationId, role: 'user', content: body.message, turn_key: body.turn_key, status: 'complete', created_at: stamp() },
    { id: messageId, user_id: auth.id, conversation_id: conversationId, role: 'assistant', content: `Answer ${n}`, status: 'complete',
      sources: [{ id: 1, kind: 'row', title: 'Row' }], model_requested: body.model, reasoning_effort: body.reasoning, created_at: stamp() },
  );
  return sse([{ conversation: { id: conversationId, title: 'T' } }, { sources: [{ id: 1, kind: 'row', title: 'Row' }] },
    { chunk: `Answer ${n}` }, { done: { message_id: messageId } }]);
}

/** supabase-js announcing the signed-in account: a tab refocus (SIGNED_IN) or a refresh (TOKEN_REFRESHED, new token). */
function announce(event) {
  if (event === 'TOKEN_REFRESHED') auth.token = `${auth.token}+`;
  auth.callback?.(event, auth.id ? { access_token: auth.token, user: { id: auth.id }, expires_at: auth.expiresAt / 1000 } : null);
}
/** Runs `act` once, at the `nth` account check from now (each full check asks Auth for the user once). */
function atCheck(nth, act) {
  let count = 0;
  auth.onGetUser = () => { if (++count === nth) { auth.onGetUser = null; act(); } };
}

let controller;
beforeEach(async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {}, removeItem() {} });
  const memory = new Map();
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) });
  vi.stubGlobal('fetch', vi.fn(server));
  turns = 0;
  auth.tables = { conversations: [], chat_messages: [] };
  auth.id = 'owner-a'; auth.token = 'token-1'; auth.expiresAt = Date.now() + 3600_000;
  auth.onGetUser = null; auth.onChunk = null;
  await resumeLocalIdentityAfterSignIn({ access_token: auth.token, user: { id: auth.id }, expires_at: auth.expiresAt / 1000 });
  resetConversations();
  useClient(supabase);
  controller = createResearchThread({
    choiceStorage: null,
    loadRegistry: async () => ({ models: MODELS, roles: [] }), subscribeRegistry: () => () => {},
    refreshCredits: async () => null, conversationCredits: async () => new Map(), loadCreditEstimates: async () => ({}),
  });
  await controller.start();
});
afterEach(() => { controller?.dispose(); auth.onGetUser = null; auth.onChunk = null; vi.unstubAllGlobals(); });

const thread = () => controller.getSnapshot().messages.map(m => `${m.role}: ${m.content}`);
const settle = () => new Promise(r => setTimeout(r, 20));
async function ask(message) {
  controller.setDraft(message);
  await controller.send({ message, focus: 'broad' });
  await vi.waitFor(() => expect(controller.getSnapshot().submitting).toBe(false));
  await settle();
}

it('changing the model and reasoning after an answer leaves the thread as it was, and the next send goes', async () => {
  await ask('First');
  expect(thread()).toEqual(['user: First', 'assistant: Answer 1']);
  const before = controller.getSnapshot();
  controller.setChoice({ modelId: 'google/flash', effort: 'high' });
  const after = controller.getSnapshot();
  expect(after.choice).toEqual({ modelId: 'google/flash', effort: 'high' });
  expect(thread()).toEqual(['user: First', 'assistant: Answer 1']);
  expect(after.store).toBe(before.store);
  expect(after.stream).toEqual(before.stream);
  await ask('Second');
  expect(controller.getSnapshot().error).toBe('');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ model: 'google/flash', reasoning: 'high' });
  expect(thread()).toEqual(['user: First', 'assistant: Answer 1', 'user: Second', 'assistant: Answer 2']);
});

for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED']) {
  it(`a ${event} for the same account while the finished turn is re-read keeps the saved answer on the thread`, async () => {
    // The first account check after the answer's last frame is the re-read of the conversation.
    auth.onChunk = i => { if (i === 4) atCheck(1, () => announce(event)); };
    await ask('First');
    expect(thread()).toEqual(['user: First', 'assistant: Answer 1']);
    controller.setChoice({ modelId: 'google/flash', effort: 'high' });
    expect(thread()).toEqual(['user: First', 'assistant: Answer 1']);
  });

  it(`a ${event} for the same account while a send is checked does not fail the send`, async () => {
    await ask('First');
    controller.setChoice({ modelId: 'google/flash', effort: 'high' });
    // The first full account check of a send is the transport's own, before anything is sent.
    atCheck(1, () => announce(event));
    await ask('Second');
    expect(controller.getSnapshot().error).toBe('');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(thread()).toEqual(['user: First', 'assistant: Answer 1', 'user: Second', 'assistant: Answer 2']);
  });
}

it('another account signing in while a send is checked still refuses the send', async () => {
  await ask('First');
  atCheck(1, () => { auth.id = 'owner-b'; auth.token = 'token-b'; announce('SIGNED_IN'); });
  controller.setDraft('Private to A');
  await controller.send({ message: 'Private to A', focus: 'broad' });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls.some(([, init]) => init.headers.authorization === 'Bearer token-b')).toBe(false);
});

it('a sign-out while a send is checked still refuses the send', async () => {
  await ask('First');
  atCheck(1, () => { auth.id = null; announce('SIGNED_OUT'); });
  controller.setDraft('Second');
  await controller.send({ message: 'Second', focus: 'broad' });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(1);
});
