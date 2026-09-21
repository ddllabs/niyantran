/**
 * Conversations on the server (streaming spec §G), exported under the same
 * names and the same synchronous signatures as `aiChatStore.js` so the panel
 * can switch stores with one import. Reads go through the Supabase client
 * under row-level security, so a user only ever sees their own.
 *
 * The cache is what the panel renders; writes are optimistic and persisted in
 * the background. Message rows are the server's: the user turn is shown
 * immediately, and after a turn finishes the conversation is re-read so the
 * stored assistant row (with its sources and activity) replaces the local one.
 *
 * Attachments stay in the browser: they are per-turn inputs, and the schema
 * has no column for them.
 */
import { supabase } from './supabaseClient.js';
import { verifiedLocalIdentity, localIdentityIsCurrent, subscribeLocalIdentity } from './userStore.js';

const EVENT = 'niy-ai-chats';
const PINS_KEY = 'niyantranAiPins';
const MAX_CHATS = 40;
const MAX_ATTACH = 12;

let client = supabase;
let state = { chats: [], activeId: '', loaded: false };
let owner = null;
let generation = 0;
let watching = false;
let listSequence = 0;
let draftSequence = 0;
const messageSequences = new Map();

function clearIdentity() {
  owner = null;
  generation++;
  state = { chats: [], activeId: '', loaded: false };
  messageSequences.clear();
  emit();
}
function watchIdentity() {
  if (watching) return;
  watching = true;
  subscribeLocalIdentity(clearIdentity);
}
function currentOwner() {
  watchIdentity();
  if (owner && owner.expiresAt <= Date.now()) clearIdentity();
  return owner;
}
function scope() {
  return currentOwner() ? { identity: owner, generation, client } : null;
}
function bound(snapshot) {
  return Boolean(snapshot && currentOwner() === snapshot.identity
    && generation === snapshot.generation && client === snapshot.client);
}
async function current(snapshot) {
  return bound(snapshot) && await localIdentityIsCurrent(snapshot.identity) && bound(snapshot);
}
async function verifiedScope(snapshot = null) {
  watchIdentity();
  const identity = await verifiedLocalIdentity();
  if (!identity || (snapshot && !bound(snapshot))) return null;
  const verifiedGeneration = generation;
  if (!await localIdentityIsCurrent(identity) || generation !== verifiedGeneration) return null;
  if (snapshot && (!bound(snapshot) || identity.id !== snapshot.identity.id
      || identity.epoch !== snapshot.identity.epoch || identity.token !== snapshot.identity.token)) return null;
  if (owner && (owner.id !== identity.id || owner.epoch !== identity.epoch || owner.token !== identity.token)) clearIdentity();
  owner ??= identity;
  return scope();
}

// Synchronous edits are optimistic, but their background writes reverify the
// captured B4 identity before using the SDK, whose current account can change.
async function persist(snapshot, write) {
  try {
    if (await verifiedScope(snapshot) && await current(snapshot) && bound(snapshot)) await write(snapshot.client, snapshot.identity.id);
  } catch { /* optimistic cache is reconciled by the next authoritative read */ }
}


/** Swap the Supabase client (tests pass a fake). */
export function useClient(next) {
  clearIdentity();
  client = next;
}

function emit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

function pinsKey() { return currentOwner() ? `${PINS_KEY}:user:${encodeURIComponent(owner.id)}` : null; }

function readPins() {
  try {
    const key = pinsKey();
    if (!key) return {};
    const pins = JSON.parse(localStorage.getItem(key) || '{}');
    return pins && typeof pins === 'object' && !Array.isArray(pins) ? pins : {};
  } catch {
    return {};
  }
}

function writePins(pins) {
  try {
    const key = pinsKey();
    if (key) localStorage.setItem(key, JSON.stringify(pins));
  } catch {
    /* a private window simply keeps no pins */
  }
}

function toChat(row, pins) {
  return {
    id: row.id,
    title: row.title || 'New research',
    roleId: 'AUTO',
    createdAt: Date.parse(row.created_at || '') || Date.now(),
    updatedAt: Date.parse(row.last_message_at || row.created_at || '') || Date.now(),
    messages: [],
    attachments: Array.isArray(pins[row.id]) ? pins[row.id].slice(0, MAX_ATTACH) : [],
    loaded: false,
  };
}

function put(next) {
  if (!currentOwner()) return state;
  state = { ...state, ...next };
  emit();
  return state;
}

function patchChat(id, patch) {
  return put({
    chats: state.chats.map((c) => (c.id === id ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)),
  });
}

export function loadAiState() {
  currentOwner();
  // Time passing alone must not make a stopped execution look restartable.
  const chats = state.chats.map(chat => {
    const messages = chat.messages.map(expireMessage);
    return messages.some((message, index) => message !== chat.messages[index]) ? { ...chat, messages } : chat;
  });
  if (chats.some((chat, index) => chat !== state.chats[index])) state = { ...state, chats };
  return state;
}
function expireMessage(message) {
  if (message.status !== 'running') return message;
  const expires = Date.parse(message.execution_expires_at);
  return Number.isFinite(expires) && expires > Date.now() ? message
    : { ...message, status: 'interrupted', error: true, error_message: message.error_message || 'Execution interrupted.' };
}

export function subscribeAiChats(fn) {
  watchIdentity();
  if (typeof window === 'undefined') return () => {};
  const on = () => fn(loadAiState());
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}

export function activeAiChat() {
  const view = loadAiState();
  return view.chats.find((c) => c.id === view.activeId) || null;
}

/** Read the user's conversations, newest first, and load the active one's messages. */
export async function hydrateConversations() {
  const sequence = ++listSequence;
  const original = scope();
  const requestClient = client;
  const snapshot = await verifiedScope(original);
  if (!snapshot || !bound(snapshot) || sequence !== listSequence || requestClient !== client) return loadAiState();
  const { data, error } = await Promise.resolve(snapshot.client.from('conversations').select('id, title, created_at, last_message_at')
    .eq('user_id', snapshot.identity.id).order('last_message_at', { ascending: false, nullsFirst: false }).limit(MAX_CHATS)).catch(error => ({ error }));
  if (!await current(snapshot) || !bound(snapshot) || sequence !== listSequence) return loadAiState();
  if (error) throw new Error(error.message);
  const pins = readPins();
  const chats = (data || []).map((r) => {
    const previous = state.chats.find(c => c.id === r.id);
    return { ...toChat(r, pins), ...(previous ? { messages: previous.messages, draftId: previous.draftId } : {}) };
  });
  const draft = state.chats.find(c => c.draft);
  if (draft) chats.unshift(draft);
  put({ chats, activeId: chats.some((c) => c.id === state.activeId) ? state.activeId : chats[0]?.id || '', loaded: true });
  if (state.activeId) await loadMessages(state.activeId);
  return loadAiState();
}

export async function loadMessages(conversationId) {
  const snapshot = scope();
  if (!conversationId || !snapshot || !state.chats.some(c => c.id === conversationId)) return loadAiState();
  const sequence = (messageSequences.get(conversationId) || 0) + 1;
  messageSequences.set(conversationId, sequence);
  if (!await verifiedScope(snapshot) || !bound(snapshot)) return loadAiState();
  const { data, error } = await Promise.resolve(snapshot.client.from('chat_messages')
    .select('id, role, content, sources, follow_ups, activity, timing, model_requested, model_served, reasoning_effort, status, error_message, execution_expires_at, turn_key, created_at')
    .eq('conversation_id', conversationId).eq('user_id', snapshot.identity.id)
    .order('created_at', { ascending: true })).catch(error => ({ error }));
  if (!await current(snapshot) || !bound(snapshot) || messageSequences.get(conversationId) !== sequence) return loadAiState();
  if (error) throw new Error(error.message);
  const messages = (data || []).map((m) => expireMessage({
    id: m.id, role: m.role, content: m.content || '', sources: m.sources || [],
    followUps: m.follow_ups || [], activity: m.activity || [], model: m.model_served || m.model_requested || '',
    timing: m.timing ?? null, model_requested: m.model_requested ?? null,
    model_served: m.model_served ?? null, reasoning_effort: m.reasoning_effort ?? null,
    status: m.status || 'complete', error: m.status === 'error' || m.status === 'interrupted',
    error_message: m.error_message ?? null, execution_expires_at: m.execution_expires_at ?? null,
    turn_key: m.turn_key ?? null, at: Date.parse(m.created_at || '') || Date.now(),
  }));
  return patchChat(conversationId, c => ({
    messages: [...messages, ...c.messages.filter(local => local.pending && !messages.some(saved =>
      saved.id === local.id || (saved.role === local.role && (local.turn_key
        ? saved.turn_key === local.turn_key : saved.content === local.content))))],
    loaded: true,
  }));
}

export function ensureAiChat() {
  if (!currentOwner()) return state;
  if (!state.activeId && state.chats.length) put({ activeId: state.chats[0].id });
  return state;
}

/**
 * A new conversation exists locally until its first turn: the server creates
 * the row when the turn is sent, so nothing empty is ever persisted.
 */
export function createAiChat(partial = {}) {
  if (!currentOwner()) return state;
  listSequence++;
  const chat = {
    id: '',
    title: partial.title || 'New research',
    roleId: partial.roleId || 'AUTO',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    attachments: [],
    loaded: true,
    draft: true,
    draftId: ++draftSequence,
  };
  return put({ chats: [chat, ...state.chats.filter((c) => !c.draft)], activeId: '' });
}

export function setActiveAiChat(id) {
  if (!currentOwner() || !state.chats.some(c => c.id === id)) return state;
  put({ activeId: id });
  if (id && !state.chats.find((c) => c.id === id)?.loaded) loadMessages(id).catch(() => {});
  return state;
}

export function renameAiChat(id, title) {
  const snapshot = scope();
  if (!snapshot || !state.chats.some(c => c.id === id)) return state;
  listSequence++;
  const next = String(title || '').slice(0, 80);
  patchChat(id, { title: next, updatedAt: Date.now() });
  if (id) void persist(snapshot, (db, ownerId) => db.from('conversations').update({ title: next }).eq('id', id).eq('user_id', ownerId));
  return state;
}

export function deleteAiChat(id) {
  const snapshot = scope();
  if (!snapshot || !state.chats.some(c => c.id === id)) return state;
  listSequence++;
  const pins = readPins();
  delete pins[id || 'draft'];
  writePins(pins);
  const chats = state.chats.filter((c) => c.id !== id);
  put({ chats, activeId: state.activeId === id ? chats[0]?.id || '' : state.activeId });
  if (id) void persist(snapshot, (db, ownerId) => db.from('conversations').delete().eq('id', id).eq('user_id', ownerId));
  return state;
}

export function setChatRole(id, roleId) {
  return patchChat(id, { roleId, updatedAt: Date.now() });
}

export function setChatAttachments(id, attachments) {
  if (!currentOwner() || !state.chats.some(c => c.id === id)) return state;
  const list = (attachments || []).slice(0, MAX_ATTACH);
  const pins = readPins();
  pins[id || 'draft'] = list;
  writePins(pins);
  return patchChat(id, { attachments: list, updatedAt: Date.now() });
}

export function addChatAttachments(id, incoming) {
  const chat = currentOwner() && state.chats.find((c) => c.id === id);
  if (!chat) return state;
  const seen = new Set((chat.attachments || []).map((a) => a.id || `${a.kind}:${a.title}:${a.url || ''}`));
  const extra = [];
  for (const a of incoming || []) {
    const key = a.id || `${a.kind}:${a.title}:${a.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({ ...a, id: a.id || `a_${Math.random().toString(36).slice(2, 10)}` });
  }
  return setChatAttachments(chat.id, [...(chat.attachments || []), ...extra]);
}

/** Optimistic: the server persists the real row and `reconcile` replaces this one. */
export function appendAiMessage(id, message) {
  const chat = currentOwner() && state.chats.find((c) => c.id === id);
  if (!chat) return state;
  listSequence++;
  const local = { ...message, id: message.id || `local_${Date.now().toString(36)}`, at: Date.now(), pending: true };
  const title = (!chat.title || chat.title === 'New research') && message.role === 'user'
    ? String(message.content || 'Research').replace(/\s+/g, ' ').slice(0, 48)
    : chat.title;
  return patchChat(chat.id, (c) => ({ title, messages: [...(c.messages || []), local], updatedAt: Date.now() }));
}

export function patchAiMessage(id, messageId, patch) {
  return patchChat(id, (c) => ({ messages: (c.messages || []).map((m) => (m.id === messageId ? { ...m, ...patch } : m)) }));
}

/** Capture at send time; pass the same context to first-frame adoption and
 * final reconciliation. It contains no Auth token and is invalid after any
 * identity change, client replacement, or replacement of the originating draft. */
export function captureConversationContext(id = state.activeId) {
  const chat = currentOwner() && state.chats.find(c => c.id === id);
  return chat ? Object.freeze({ ownerId: owner.id, generation, chatId: chat.id, draftId: chat.draftId }) : null;
}
function contextChat(context) {
  if (!context || !currentOwner() || context.ownerId !== owner.id || context.generation !== generation) return null;
  return state.chats.find(c => context.draftId ? c.draftId === context.draftId : c.id === context.chatId) || null;
}

/** First conversation SSE frame, before the answer or turn-end reconciliation. */
export function adoptConversation(conversation, context) {
  const chat = contextChat(context);
  const id = conversation?.id;
  if (!chat || typeof id !== 'string' || !id || (!chat.draft && chat.id !== id)) return loadAiState();
  const known = state.chats.find(c => c.id === id && c !== chat);
  const adopted = { ...chat, ...(known || {}), id, draft: false, draftId: chat.draftId,
    title: conversation.title || known?.title || chat.title,
    messages: [...(known?.messages || []), ...chat.messages], attachments: chat.attachments };
  if (!chat.draft) return loadAiState();
  listSequence++;
  const pins = readPins();
  pins[id] = chat.attachments;
  delete pins.draft;
  writePins(pins);
  return put({ chats: state.chats.filter(c => c !== known).map(c => c === chat ? adopted : c),
    activeId: state.activeId === chat.id ? id : state.activeId });
}

/** Reconcile the originating turn only; never adopt whatever draft is current. */
export async function reconcileTurn(conversationId, context) {
  if (context !== undefined) {
    if (!contextChat(context)) return loadAiState();
    adoptConversation({ id: conversationId }, context);
    if (contextChat(context)?.id !== conversationId) return loadAiState();
  } else if (!currentOwner() || !state.chats.some(c => c.id === conversationId && !c.draft)) return loadAiState();
  return await loadMessages(conversationId);
}

/** Test seam: reset the cache between cases, invalidating in-flight work too. */
export function resetConversations() {
  listSequence++;
  clearIdentity();
}
