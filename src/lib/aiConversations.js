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

const EVENT = 'niy-ai-chats';
const PINS_KEY = 'niyantranAiPins';
const MAX_CHATS = 40;
const MAX_ATTACH = 12;

let client = supabase;
let state = { chats: [], activeId: '', loaded: false };

/** Swap the Supabase client (tests pass a fake). */
export function useClient(next) {
  client = next;
}

function emit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

function readPins() {
  try {
    return JSON.parse(localStorage.getItem(PINS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writePins(pins) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
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
    attachments: pins[row.id] || [],
    loaded: false,
  };
}

function put(next) {
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
  return state;
}

export function subscribeAiChats(fn) {
  if (typeof window === 'undefined') return () => {};
  const on = () => fn(state);
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}

export function activeAiChat() {
  return state.chats.find((c) => c.id === state.activeId) || null;
}

/** Read the user's conversations, newest first, and load the active one's messages. */
export async function hydrateConversations() {
  const { data, error } = await client.from('conversations').select('id, title, created_at, last_message_at').order('last_message_at', { ascending: false, nullsFirst: false }).limit(MAX_CHATS);
  if (error) throw new Error(error.message);
  const pins = readPins();
  const chats = (data || []).map((r) => toChat(r, pins));
  put({ chats, activeId: chats.some((c) => c.id === state.activeId) ? state.activeId : chats[0]?.id || '', loaded: true });
  if (state.activeId) await loadMessages(state.activeId);
  return state;
}

export async function loadMessages(conversationId) {
  if (!conversationId) return state;
  const { data, error } = await client
    .from('chat_messages')
    .select('id, role, content, sources, follow_ups, activity, model_served, status, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const messages = (data || []).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content || '',
    sources: m.sources || [],
    followUps: m.follow_ups || [],
    activity: m.activity || [],
    model: m.model_served || '',
    status: m.status || 'complete',
    error: m.status === 'error',
    at: Date.parse(m.created_at || '') || Date.now(),
  }));
  return patchChat(conversationId, { messages, loaded: true });
}

export function ensureAiChat() {
  if (!state.activeId && state.chats.length) put({ activeId: state.chats[0].id });
  return state;
}

/**
 * A new conversation exists locally until its first turn: the server creates
 * the row when the turn is sent, so nothing empty is ever persisted.
 */
export function createAiChat(partial = {}) {
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
  };
  return put({ chats: [chat, ...state.chats.filter((c) => !c.draft)], activeId: '' });
}

export function setActiveAiChat(id) {
  put({ activeId: id });
  if (id && !state.chats.find((c) => c.id === id)?.loaded) loadMessages(id).catch(() => {});
  return state;
}

export function renameAiChat(id, title) {
  const next = String(title || '').slice(0, 80);
  patchChat(id, { title: next, updatedAt: Date.now() });
  if (id) client.from('conversations').update({ title: next }).eq('id', id).then(null, () => {});
  return state;
}

export function deleteAiChat(id) {
  const pins = readPins();
  delete pins[id];
  writePins(pins);
  const chats = state.chats.filter((c) => c.id !== id);
  put({ chats, activeId: state.activeId === id ? chats[0]?.id || '' : state.activeId });
  if (id) client.from('conversations').delete().eq('id', id).then(null, () => {});
  return state;
}

export function setChatRole(id, roleId) {
  return patchChat(id, { roleId, updatedAt: Date.now() });
}

export function setChatAttachments(id, attachments) {
  const list = (attachments || []).slice(0, MAX_ATTACH);
  const pins = readPins();
  pins[id || 'draft'] = list;
  writePins(pins);
  return patchChat(id, { attachments: list, updatedAt: Date.now() });
}

export function addChatAttachments(id, incoming) {
  const chat = state.chats.find((c) => c.id === id) || state.chats[0];
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
  const chat = state.chats.find((c) => c.id === id) || state.chats.find((c) => c.draft) || state.chats[0];
  if (!chat) return state;
  const local = { ...message, id: message.id || `local_${Date.now().toString(36)}`, at: Date.now(), pending: true };
  const title = (!chat.title || chat.title === 'New research') && message.role === 'user'
    ? String(message.content || 'Research').replace(/\s+/g, ' ').slice(0, 48)
    : chat.title;
  return patchChat(chat.id, (c) => ({ title, messages: [...(c.messages || []), local], updatedAt: Date.now() }));
}

export function patchAiMessage(id, messageId, patch) {
  return patchChat(id, (c) => ({ messages: (c.messages || []).map((m) => (m.id === messageId ? { ...m, ...patch } : m)) }));
}

/**
 * After a turn: adopt the server's conversation id for a draft chat, then
 * re-read the stored messages so the answer, its sources and its activity are
 * the persisted ones rather than the streamed copy.
 */
export async function reconcileTurn(conversationId) {
  if (!conversationId) return state;
  const draft = state.chats.find((c) => c.draft);
  const known = state.chats.some((c) => c.id === conversationId);
  if (draft && !known) {
    put({
      chats: state.chats.map((c) => (c === draft ? { ...c, id: conversationId, draft: false } : c)),
      activeId: conversationId,
    });
    const pins = readPins();
    if (pins.draft) {
      pins[conversationId] = pins.draft;
      delete pins.draft;
      writePins(pins);
    }
  } else if (draft) {
    // The turn landed in a conversation already in the list, so the draft has
    // served its purpose and would otherwise sit there as a second empty chat.
    put({ chats: state.chats.filter((c) => c !== draft), activeId: conversationId });
  } else if (state.activeId !== conversationId && known) {
    put({ activeId: conversationId });
  }
  return await loadMessages(conversationId);
}

/** Test seam: reset the cache between cases. */
export function resetConversations() {
  state = { chats: [], activeId: '', loaded: false };
}
