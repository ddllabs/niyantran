import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeAiChat,
  addChatAttachments,
  appendAiMessage,
  createAiChat,
  deleteAiChat,
  hydrateConversations,
  loadAiState,
  loadMessages,
  reconcileTurn,
  renameAiChat,
  resetConversations,
  setActiveAiChat,
  useClient,
} from './aiConversations.js';

// The suite runs in Node; the store keeps attachments in the browser, so it
// needs somewhere to keep them. Everything else about the store is the same.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

/** A thenable query builder over in-memory tables, recording the writes. */
function fakeClient(tables) {
  const writes = [];
  function builder(table) {
    const filters = [];
    const q = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq(col, value) {
        filters.push([col, value]);
        return q;
      },
      insert(row) {
        writes.push({ table, op: 'insert', row });
        return q;
      },
      update(row) {
        writes.push({ table, op: 'update', row, filters });
        return q;
      },
      delete() {
        writes.push({ table, op: 'delete', filters });
        return q;
      },
      then(resolve) {
        const rows = (tables[table] || []).filter((r) => filters.every(([c, v]) => r[c] === v));
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return q;
  }
  return { from: builder, writes };
}

const CONVERSATIONS = [
  { id: 'c-1', title: 'Bills', created_at: '2026-09-20T10:00:00Z', last_message_at: '2026-09-21T09:00:00Z' },
  { id: 'c-2', title: 'Orders', created_at: '2026-09-19T10:00:00Z', last_message_at: '2026-09-20T09:00:00Z' },
];
const MESSAGES = [
  { id: 'm-1', conversation_id: 'c-1', role: 'user', content: 'How many bills are pending?', created_at: '2026-09-21T08:59:00Z' },
  {
    id: 'm-2',
    conversation_id: 'c-1',
    role: 'assistant',
    content: 'There are **412** [1].',
    sources: [{ id: 1, kind: 'row', row_key: 'k' }],
    follow_ups: ['Which ministries?'],
    activity: [{ type: 'tool', name: 'search_desk_rows' }],
    model_served: 'google/gemini-3.5-flash-lite',
    status: 'complete',
    created_at: '2026-09-21T09:00:00Z',
  },
];

describe('aiConversations (server-backed thread store)', () => {
  let client;
  beforeEach(() => {
    resetConversations();
    localStorage.clear();
    client = fakeClient({ conversations: CONVERSATIONS, chat_messages: MESSAGES });
    useClient(client);
  });

  it('hydrates the list and loads the active conversation with its sources and activity', async () => {
    await hydrateConversations();
    const state = loadAiState();
    expect(state.chats.map((c) => c.id)).toEqual(['c-1', 'c-2']);
    expect(state.activeId).toBe('c-1');
    const chat = activeAiChat();
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(chat.messages[1].sources).toHaveLength(1);
    expect(chat.messages[1].followUps).toEqual(['Which ministries?']);
    expect(chat.messages[1].activity).toHaveLength(1);
    expect(chat.messages[1].model).toBe('google/gemini-3.5-flash-lite');
  });

  it('a new chat exists only locally until its first turn, then adopts the server id', async () => {
    await hydrateConversations();
    createAiChat();
    expect(loadAiState().activeId).toBe('');
    expect(loadAiState().chats[0].draft).toBe(true);
    expect(client.writes.filter((w) => w.table === 'conversations' && w.op === 'insert')).toHaveLength(0);

    appendAiMessage('', { role: 'user', content: 'What stage is the Delimitation Bill at?' });
    expect(loadAiState().chats[0].title).toBe('What stage is the Delimitation Bill at?');
    expect(loadAiState().chats[0].messages[0].pending).toBe(true);

    // The server created a new conversation for this turn.
    await reconcileTurn('c-9');
    const state = loadAiState();
    expect(state.activeId).toBe('c-9');
    expect(state.chats.find((c) => c.draft)).toBeUndefined();
    expect(state.chats.map((c) => c.id)).toEqual(['c-9', 'c-1', 'c-2']);
  });

  it('a draft whose turn landed in an existing conversation is dropped, not left as a second empty chat', async () => {
    await hydrateConversations();
    createAiChat();
    appendAiMessage('', { role: 'user', content: 'Follow-up' });
    await reconcileTurn('c-1');
    const state = loadAiState();
    expect(state.chats.map((c) => c.id)).toEqual(['c-1', 'c-2']);
    expect(state.activeId).toBe('c-1');
    expect(activeAiChat().messages.map((m) => m.id)).toEqual(['m-1', 'm-2']);
  });

  it('rename and delete update the cache and the server', async () => {
    await hydrateConversations();
    renameAiChat('c-1', 'Delimitation');
    expect(loadAiState().chats.find((c) => c.id === 'c-1').title).toBe('Delimitation');
    expect(client.writes.find((w) => w.op === 'update' && w.table === 'conversations').row.title).toBe('Delimitation');

    deleteAiChat('c-1');
    expect(loadAiState().chats.map((c) => c.id)).toEqual(['c-2']);
    expect(loadAiState().activeId).toBe('c-2');
    expect(client.writes.some((w) => w.op === 'delete' && w.table === 'conversations')).toBe(true);
  });

  it('attachments live in the browser, per conversation, and survive a reload', async () => {
    await hydrateConversations();
    addChatAttachments('c-1', [{ kind: 'row', title: 'A bill' }]);
    expect(activeAiChat().attachments).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('niyantranAiPins'))['c-1']).toHaveLength(1);

    resetConversations();
    await hydrateConversations();
    expect(activeAiChat().attachments[0].title).toBe('A bill');
    expect(client.writes.some((w) => JSON.stringify(w.row || {}).includes('A bill'))).toBe(false);
  });

  it('switching conversations loads that one\'s messages', async () => {
    await hydrateConversations();
    setActiveAiChat('c-2');
    expect(loadAiState().activeId).toBe('c-2');
    await loadMessages('c-2');
    expect(loadAiState().chats.find((c) => c.id === 'c-2').loaded).toBe(true);
  });
});
