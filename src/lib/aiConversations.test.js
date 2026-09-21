import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ id: 'owner-a', callback: null, expired: false, blocked: false }));
vi.mock('./supabaseClient.js', () => ({ supabase: {
  auth: {
    onAuthStateChange: (fn) => { auth.callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => ({ data: { session: auth.id ? { access_token: `token-${auth.id}`, user: { id: auth.id }, expires_at: Date.now() / 1000 + (auth.expired ? -1 : 3600) } : null } }),
    getUser: async () => ({ data: { user: auth.id ? { id: auth.id, email: `${auth.id}@example.invalid` } : null } }),
  },
  rpc: async () => ({ data: { user_id: auth.id, status: auth.blocked ? 'suspended' : 'active' } }),
} }));
import { supabase } from './supabaseClient.js';
import { invalidateLocalSession, resumeLocalIdentityAfterSignIn } from './userStore.js';
import * as conversations from './aiConversations.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function switchAccount(id) { auth.id = id; auth.callback?.(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); }

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
        const rows = (tables[table] || []).filter((r) => filters.every(([c, v]) => (c === 'user_id' ? (r.user_id || auth.id) : r[c]) === v));
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
    activity: [{ type: 'tool', name: 'search_desk_rows' }, { type: 'activity', text: 'Searching official records' }],
    model_served: 'google/gemini-3.5-flash-lite',
    status: 'complete',
    created_at: '2026-09-21T09:00:00Z',
  },
];

describe('aiConversations (server-backed thread store)', () => {
  let client;
  beforeEach(async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('sessionStorage', { getItem: () => null, removeItem() {}, setItem() {} });
    auth.expired = false; auth.blocked = false; switchAccount('owner-a');
    await resumeLocalIdentityAfterSignIn({access_token:'token-owner-a', user:{id:'owner-a'}, expires_at:Date.now()/1000+3600});
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
    expect(chat.messages[1].activity).toEqual(MESSAGES[1].activity);
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
    await reconcileTurn('c-9', conversations.captureConversationContext?.());
    const state = loadAiState();
    expect(state.activeId).toBe('c-9');
    expect(state.chats.find((c) => c.draft)).toBeUndefined();
    expect(state.chats.map((c) => c.id)).toEqual(['c-9', 'c-1', 'c-2']);
  });

  it('a draft whose turn landed in an existing conversation is dropped, not left as a second empty chat', async () => {
    await hydrateConversations();
    createAiChat();
    appendAiMessage('', { role: 'user', content: 'Follow-up' });
    await reconcileTurn('c-1', conversations.captureConversationContext?.());
    const state = loadAiState();
    expect(state.chats.map((c) => c.id)).toEqual(['c-1', 'c-2']);
    expect(state.activeId).toBe('c-1');
    expect(activeAiChat().messages.slice(0, 2).map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(activeAiChat().messages[2]).toMatchObject({content:'Follow-up',pending:true});
  });

  it('rename and delete update the cache and the server', async () => {
    await hydrateConversations();
    renameAiChat('c-1', 'Delimitation');
    expect(loadAiState().chats.find((c) => c.id === 'c-1').title).toBe('Delimitation');
    await vi.waitFor(() => expect(client.writes.some(w => w.op === 'update')).toBe(true));
    expect(client.writes.find((w) => w.op === 'update' && w.table === 'conversations').row.title).toBe('Delimitation');

    deleteAiChat('c-1');
    expect(loadAiState().chats.map((c) => c.id)).toEqual(['c-2']);
    expect(loadAiState().activeId).toBe('c-2');
    await vi.waitFor(() => expect(client.writes.some(w => w.op === 'delete')).toBe(true));
    expect(client.writes.some((w) => w.op === 'delete' && w.table === 'conversations')).toBe(true);
  });

  it('attachments live in the browser, per conversation, and survive a reload', async () => {
    await hydrateConversations();
    addChatAttachments('c-1', [{ kind: 'row', title: 'A bill' }]);
    expect(activeAiChat().attachments).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('niyantranAiPins:user:owner-a'))['c-1']).toHaveLength(1);

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
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('logout synchronously clears private cache and prevents new protected operations', async () => {
    await hydrateConversations(); addChatAttachments('c-1', [{title:'Private pin'}]);
    invalidateLocalSession();
    expect(loadAiState().chats).toEqual([]);
    createAiChat(); renameAiChat('c-1','After logout'); appendAiMessage('c-1',{content:'Late'});
    await hydrateConversations();
    expect(loadAiState().chats).toEqual([]); expect(client.writes).toEqual([]);
  });

  it('owner-specific pins survive for A but are never adopted by B or from legacy storage', async () => {
    localStorage.setItem('niyantranAiPins', JSON.stringify({'c-1':[{title:'Legacy unowned'}]}));
    await hydrateConversations(); expect(activeAiChat().attachments).toEqual([]);
    addChatAttachments('c-1',[{title:'A private'}]);
    switchAccount('owner-b'); expect(loadAiState().chats).toEqual([]);
    await hydrateConversations(); expect(activeAiChat().attachments).toEqual([]);
    switchAccount('owner-a'); await hydrateConversations();
    expect(activeAiChat().attachments[0].title).toBe('A private');
    expect(JSON.parse(localStorage.getItem('niyantranAiPins'))['c-1'][0].title).toBe('Legacy unowned');
  });

  it('late A list cannot replace a completed B hydration', async () => {
    await hydrateConversations(); const old = deferred(); const started = deferred();
    useClient({from: () => ({select(){return this},eq(){return this},order(){return this},limit(){ started.resolve(); return old.promise; }})});
    const pending = hydrateConversations(); await started.promise;
    switchAccount('owner-b'); useClient(fakeClient({conversations:[{id:'b',title:'B only'}]}));
    await hydrateConversations(); old.resolve({data:CONVERSATIONS,error:null}); await pending;
    expect(loadAiState().chats.map(c=>c.id)).toEqual(['b']);
  });

  it('late A messages cannot publish into B even with the same fake conversation ID', async () => {
    await hydrateConversations(); const old = deferred(); const started = deferred();
    client.from = () => ({select(){return this},eq(){return this},order(){started.resolve();return old.promise;}});
    const pending=loadMessages('c-1'); await started.promise;
    switchAccount('owner-b'); useClient(fakeClient({conversations:CONVERSATIONS,chat_messages:[]})); await hydrateConversations();
    await loadMessages('c-1'); // B can refresh repeatedly while A remains in flight.
    old.resolve({data:MESSAGES,error:null}); await pending;
    expect(activeAiChat().messages).toEqual([]);
  });

  it('queued A rename or delete is not sent with B credentials', async () => {
    await hydrateConversations(); renameAiChat('c-1','A rename'); deleteAiChat('c-2'); switchAccount('owner-b');
    await new Promise(r=>setTimeout(r,0)); expect(client.writes).toEqual([]);
  });

  it('first conversation frame adopts a captured draft immediately and preserves optimistic text and pins', async () => {
    await hydrateConversations(); createAiChat(); appendAiMessage('',{role:'user',content:'Question',turn_key:'t'}); addChatAttachments('',[{title:'Pin'}]);
    expect(typeof conversations.captureConversationContext).toBe('function');
    const context=conversations.captureConversationContext();
    conversations.adoptConversation({id:'new-server',title:'Server title'},context);
    expect(activeAiChat()).toMatchObject({id:'new-server',draft:false,title:'Server title'});
    expect(activeAiChat().messages[0].content).toBe('Question'); expect(activeAiChat().attachments[0].title).toBe('Pin');
    expect(JSON.parse(localStorage.getItem('niyantranAiPins:user:owner-a'))['new-server']).toHaveLength(1);
  });

  it('late first frame and reconciliation cannot adopt the next account draft', async () => {
    await hydrateConversations(); createAiChat(); const context=conversations.captureConversationContext?.();
    switchAccount('owner-b'); await hydrateConversations(); createAiChat({title:'B draft'});
    expect(typeof conversations.adoptConversation).toBe('function');
    conversations.adoptConversation({id:'A-server'},context); await reconcileTurn('A-server',context);
    expect(activeAiChat()).toMatchObject({id:'',title:'B draft',draft:true});
  });

  it('reload retains D3 lifecycle/error/source fields and renders expired running as interrupted without writes', async () => {
    const rows=['running','interrupted','truncated','error','cancelled'].map((status,i)=>({...MESSAGES[1],id:`m-${i}`,status,error_message:`detail-${status}`,turn_key:'t',execution_expires_at:new Date(Date.now()+60_000).toISOString()}));
    rows.push({...rows[0],id:'expired',execution_expires_at:new Date(Date.now()-1000).toISOString()});
    useClient(fakeClient({conversations:CONVERSATIONS,chat_messages:rows})); await hydrateConversations();
    const messages=activeAiChat().messages;
    expect(messages.map(m=>m.status)).toEqual(['running','interrupted','truncated','error','cancelled','interrupted']);
    expect(messages[0]).toMatchObject({turn_key:'t',execution_expires_at:rows[0].execution_expires_at,error_message:'detail-running'});
    expect(messages[3]).toMatchObject({error:true,error_message:'detail-error',sources:rows[3].sources,activity:rows[3].activity});
    expect(client.writes).toEqual([]);
  });

  it('expired or suspended identity fails closed and cannot expose cached data', async () => {
    await hydrateConversations(); auth.expired=true; await hydrateConversations(); expect(loadAiState().chats).toEqual([]);
    auth.expired=false; auth.blocked=true; await hydrateConversations(); expect(loadAiState().chats).toEqual([]);
  });

  it('replacement draft cannot be adopted by an earlier draft context for the same owner', async () => {
    await hydrateConversations(); createAiChat({title:'First'}); const context=conversations.captureConversationContext();
    createAiChat({title:'Second'}); conversations.adoptConversation({id:'first-server'},context);
    expect(activeAiChat()).toMatchObject({id:'',title:'Second',draft:true});
  });

  it('optimistic user rows reconcile by turn key without duplicate or lost pending rows', async () => {
    await hydrateConversations(); appendAiMessage('c-1',{role:'user',content:'New question',turn_key:'new-turn'});
    const rows=[...MESSAGES]; client.from = fakeClient({conversations:CONVERSATIONS,chat_messages:rows}).from;
    await loadMessages('c-1'); expect(activeAiChat().messages.at(-1)).toMatchObject({pending:true,turn_key:'new-turn'});
    rows.push({id:'server-user',conversation_id:'c-1',role:'user',content:'New question',turn_key:'new-turn'});
    await loadMessages('c-1'); expect(activeAiChat().messages.filter(m=>m.turn_key==='new-turn')).toEqual([expect.objectContaining({id:'server-user'})]);
    expect(activeAiChat().messages.at(-1).pending).toBeUndefined();
  });

  it('same-account older message response cannot replace a newer completed read', async () => {
    await hydrateConversations(); const old=deferred(); const started=deferred(); let calls=0;
    client.from=()=>({select(){return this},eq(){return this},order(){calls++;if(calls===1){started.resolve();return old.promise;}return Promise.resolve({data:[{id:'new',content:'Newest',role:'assistant',status:'complete'}],error:null});}});
    const pending=loadMessages('c-1'); await started.promise; await loadMessages('c-1');
    old.resolve({data:MESSAGES,error:null}); await pending; expect(activeAiChat().messages.map(m=>m.id)).toEqual(['new']);
  });

  it('late A transport failure is ignored after B replaces its cache', async () => {
    await hydrateConversations(); let reject; const old=new Promise((_,r)=>{reject=r}); const started=deferred();
    client.from=()=>({select(){return this},eq(){return this},order(){started.resolve();return old;}});
    const pending=loadMessages('c-1'); await started.promise;
    switchAccount('owner-b'); useClient(fakeClient({conversations:CONVERSATIONS,chat_messages:[]})); await hydrateConversations();
    reject(Error('A private failure')); await expect(pending).resolves.toMatchObject({chats:expect.any(Array)});
    expect(activeAiChat().messages).toEqual([]);
  });

  it('a pending list read cannot resurrect a deleted conversation or undo its rename', async () => {
    await hydrateConversations(); const old=deferred(); const started=deferred(); const original=client.from;
    client.from=table=>table==='conversations'?{select(){return this},eq(){return this},order(){return this},limit(){started.resolve();return old.promise;},update(){return original(table).update(...arguments)},delete(){return original(table).delete()}}:original(table);
    const pending=hydrateConversations(); await started.promise; deleteAiChat('c-1'); renameAiChat('c-2','Changed title');
    old.resolve({data:CONVERSATIONS,error:null}); await pending;
    expect(loadAiState().chats.map(c=>[c.id,c.title])).toEqual([['c-2','Changed title']]);
  });

  it('running state expires on a subsequent cache read without a network request or restart', async () => {
    const expires=Date.now()+60_000;
    useClient(fakeClient({conversations:CONVERSATIONS,chat_messages:[{...MESSAGES[1],status:'running',execution_expires_at:new Date(expires).toISOString()}]}));
    await hydrateConversations(); expect(activeAiChat().messages[0].status).toBe('running');
    const now=vi.spyOn(Date,'now').mockReturnValue(expires+1);
    expect(activeAiChat().messages[0].status).toBe('interrupted'); now.mockRestore();
  });

  it('rename and delete retain explicit owner filters with successful verified writes', async () => {
    await hydrateConversations(); renameAiChat('c-1','New title'); deleteAiChat('c-2');
    await vi.waitFor(()=>expect(client.writes).toHaveLength(2));
    for(const write of client.writes) expect(write.filters).toContainEqual(['user_id','owner-a']);
  });

  it('replacing the client clears private cache synchronously and invalidates prior draft contexts', async () => {
    await hydrateConversations(); createAiChat(); const context=conversations.captureConversationContext();
    useClient(fakeClient({})); expect(loadAiState().chats).toEqual([]);
    conversations.adoptConversation({id:'old-server'},context); expect(loadAiState().chats).toEqual([]);
  });

  it('expiry projection preserves unchanged references and never mutates previously returned snapshots', async () => {
    const expires=Date.now()+60_000;
    useClient(fakeClient({conversations:CONVERSATIONS,chat_messages:[{...MESSAGES[1],status:'running',execution_expires_at:new Date(expires).toISOString()}]}));
    await hydrateConversations(); const previous=loadAiState(); const messages=previous.chats[0].messages;
    expect(loadAiState()).toBe(previous); expect(loadAiState().chats[0].messages).toBe(messages);
    const clock=vi.spyOn(Date,'now').mockReturnValue(expires+1); const next=loadAiState();
    expect(next).not.toBe(previous); expect(previous.chats[0].messages[0].status).toBe('running');
    expect(next.chats[0].messages[0].status).toBe('interrupted'); expect(loadAiState()).toBe(next); clock.mockRestore();
  });

  it('reload retains durable timing and requested/served model and effort fields', async () => {
    const row={...MESSAGES[1],timing:{total_ms:1200,search_ms:300,reasoning_ms:400,writing_ms:500},model_requested:'requested-model',reasoning_effort:'high'};
    useClient(fakeClient({conversations:CONVERSATIONS,chat_messages:[row]})); await hydrateConversations();
    expect(activeAiChat().messages[0]).toMatchObject({timing:row.timing,model_requested:'requested-model',model_served:row.model_served,reasoning_effort:'high'});
  });

  it('account change at the final verification await cannot bind an old owner or issue a query', async () => {
    const original=supabase.auth.getSession; let checks=0;
    vi.spyOn(supabase.auth,'getSession').mockImplementation(async()=>{
      const result=await original(); checks++;
      if(checks===3) queueMicrotask(()=>queueMicrotask(()=>switchAccount('owner-b')));
      return result;
    });
    const from=vi.spyOn(client,'from');
    await hydrateConversations();
    expect(from).not.toHaveBeenCalled(); expect(loadAiState().chats).toEqual([]);
  });

});


it('aiThreads preserves the legacy store and makes recovery-only APIs no-ops', async () => {
  vi.doMock('./aiBackend.js', () => ({ aiBackend: () => 'legacy' }));
  const threads = await import('./aiThreads.js');
  const legacy = await import('./aiChatStore.js');
  expect(threads.serverThreads).toBe(false);
  for (const name of ['loadAiState','createAiChat','appendAiMessage','renameAiChat','deleteAiChat']) {
    expect(threads[name]).toBe(legacy[name]);
  }
  expect(threads.captureConversationContext()).toBeNull();
  expect(threads.adoptConversation({id:'ignored'}, null)).toEqual(legacy.loadAiState());
  vi.doUnmock('./aiBackend.js');
});
