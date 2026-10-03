import {expect,it,vi} from 'vitest';
import {createResearchThread,normalizeResearchChoice} from './useResearchThread.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
function fixture(){
 let owner={id:'a',epoch:1,token:'a',expiresAt:Date.now()+60000};let listener;let state={chats:[],activeId:'',loaded:false};let callback;let streamListener;let streams={};let sent=[];let append=[];let reconciled=[];let adopted=[];
 const context=()=>({ownerId:owner.id,generation:owner.epoch,chatId:state.activeId,draftId:state.chats.find(c=>c.id===state.activeId)?.draftId});
 const deps={
 verifiedLocalIdentity:vi.fn(async()=>owner),localIdentityIsCurrent:vi.fn(async i=>i===owner),subscribeLocalIdentity:fn=>{listener=fn;return()=>{}},
 hydrateConversations:vi.fn(async()=>{state={...state,loaded:true};return state}),loadAiState:()=>state,subscribeAiChats:fn=>{callback=fn;return()=>{}},
 createAiChat:vi.fn(()=>{state={...state,chats:[{id:'',draft:true,draftId:1,messages:[],attachments:[],title:'New research'}],activeId:''};callback?.(state);return state}),
 activeAiChat:()=>state.chats.find(c=>c.id===state.activeId),captureConversationContext:()=>context(),
 appendAiMessage:(id,m)=>{append.push(m);state.chats.find(c=>c.id===id).messages.push(m);callback?.(state)},
 adoptConversation:(c,ctx)=>{adopted.push(ctx);const chat=state.chats.find(c=>c.draftId===ctx.draftId);if(chat){chat.id=c.id;chat.draft=false;state.activeId=c.id;}callback?.(state);return state},
 reconcileTurn:vi.fn(async(id,ctx)=>{reconciled.push(ctx);return state}),
 streamState:id=>streams[id||'new']||{isStreaming:false,isPending:false,status:'idle',sources:[]},subscribeStream:fn=>{streamListener=fn;return()=>{}},retryRequest:()=>null,clearStream:vi.fn(),
 sendTurn:vi.fn(async(body,opts)=>{sent.push(body);await opts.onConversation({id:'server-c'});return{conversationId:'server-c',isPending:false,status:'complete',messageId:'m'}}),
 retryTurn:vi.fn(),reconcileSavedTurn:vi.fn(async()=>false),recordChatCancellation:vi.fn(async()=>({cancelRequested:true})),stopTurn:vi.fn(async()=>({cancelRequested:true})),
 loadRegistry:async()=>({models:[{model_id:'model/default',is_default:true,efforts:['low']}],roles:[]}),subscribeRegistry:()=>()=>{},
 setActiveAiChat:id=>{state.activeId=id;callback?.(state);return state},loadMessages:async()=>state,deleteAiChat:vi.fn(),addChatAttachments:vi.fn(),
 };
 const controller=createResearchThread(deps);
 return{controller,deps,sent,append,reconciled,adopted,setStreams:v=>{streams=v;streamListener?.()},changeOwner(id='b'){owner={id,epoch:owner.epoch+1,token:id,expiresAt:Date.now()+60000};state={chats:[],activeId:'',loaded:false};listener?.(id,'TOKEN_REFRESHED')},
 // F43: supabase-js re-announces the same account on every tab refocus; userStore bumps the epoch, so the held identity goes stale.
 refocus(event='SIGNED_IN'){owner={...owner,epoch:owner.epoch+1};listener?.(owner.id,event)},signOut(){owner=null;listener?.(null,'SIGNED_OUT')},getState:()=>state,setState:s=>{state=s;callback?.(state)}};
}
it('hydrates the verified owner before creating a local empty draft',async()=>{
 const f=fixture();const gate=deferred();f.deps.hydrateConversations.mockImplementation(()=>gate.promise);const start=f.controller.start();
 await Promise.resolve();expect(f.deps.createAiChat).not.toHaveBeenCalled();
 gate.resolve({chats:[],activeId:'',loaded:true});await start;expect(f.deps.createAiChat).toHaveBeenCalledOnce();expect(f.controller.getSnapshot().ready).toBe(true);
});
it('an unauthenticated hydration never creates a draft or fetches private conversations',async()=>{
 const f=fixture();f.deps.verifiedLocalIdentity.mockResolvedValue(null);await f.controller.start();expect(f.deps.hydrateConversations).not.toHaveBeenCalled();expect(f.deps.createAiChat).not.toHaveBeenCalled();expect(f.controller.getSnapshot().ready).toBe(false);
});
it('model choices normalize to the same allowed fallback and efforts as the picker',()=>{
 // An effort the fallback model cannot take is dropped to the default, not to
 // 'off'. 'off' is still reachable, but only when the model offers it.
 const optional=[{model_id:'m',is_default:true,efforts:['off','low']}];
 expect(normalizeResearchChoice(optional,{modelId:'gone',effort:'high'})).toEqual({modelId:'m',effort:'low'});
 expect(normalizeResearchChoice(optional,{modelId:'m',effort:'off'})).toEqual({modelId:'m',effort:'off'});
 // A model that mandates reasoning carries no 'off' rung, so asking for it by
 // name gets the cheapest real one rather than a request the model refuses.
 expect(normalizeResearchChoice([{model_id:'m',is_default:true,efforts:['minimal','low']}],{modelId:'m',effort:'off'})).toEqual({modelId:'m',effort:'minimal'});
 // The cheapest rung is per model: DeepSeek's ladder starts at 'high', so
 // 'low' is not a quieter request there - it is not a request the model takes.
 expect(normalizeResearchChoice([{model_id:'d',is_default:true,efforts:['off','high','xhigh']}],{modelId:'d',effort:'low'})).toEqual({modelId:'d',effort:'high'});
});

it('send preserves one original key and the captured context through first-frame adoption and final reconcile',async()=>{
 const f=fixture();await f.controller.start();f.controller.setDraft('Question');await f.controller.send({message:'Question',turn_key:'original',focus:'broad'});
 expect(f.append).toEqual([{role:'user',content:'Question',turn_key:'original'}]);expect(f.sent[0]).toMatchObject({turn_key:'original',model:'model/default'});
 expect(f.adopted[0]).toEqual(f.reconciled[0]);expect(f.controller.getSnapshot().chat.id).toBe('server-c');expect(f.controller.getSnapshot().draft).toBe('');
});
it('initial identity recheck locks duplicate send and replacement draft before the transport exists',async()=>{
 const f=fixture();await f.controller.start();const gate=deferred();f.deps.localIdentityIsCurrent.mockImplementationOnce(()=>gate.promise);let release;
 f.deps.sendTurn.mockImplementation(()=>new Promise(r=>release=r));
 const first=f.controller.send({message:'One',turn_key:'one'});await Promise.resolve();
 expect(f.controller.getSnapshot().locked).toBe(true);expect(f.controller.newChat()).toBe(false);
 expect(await f.controller.send({message:'Two',turn_key:'two'})).toBe(false);
 gate.resolve(true);
 await vi.waitFor(()=>expect(f.deps.sendTurn).toHaveBeenCalledOnce());release({isPending:true,status:'unknown'});await first;
 expect(f.append).toHaveLength(1);
});
it('identity changes synchronously erase private draft/viewer/errors and hydrate again',async()=>{
 const f=fixture();await f.controller.start();f.controller.setDraft('Private A');f.controller.openSource({id:1});
 f.changeOwner();expect(f.controller.getSnapshot()).toMatchObject({draft:'',viewer:null,ready:false});expect(f.controller.getSnapshot().store.chats).toEqual([]);
 await vi.waitFor(()=>expect(f.controller.getSnapshot().ready).toBe(true));expect(f.deps.hydrateConversations).toHaveBeenCalledTimes(2);
});
it('late old-owner conversation callbacks and finally cannot alter the next owner',async()=>{
 const f=fixture();await f.controller.start();const gate=deferred();let opts;
 f.deps.sendTurn.mockImplementation((_body,o)=>{opts=o;return gate.promise});const pending=f.controller.send({message:'A private',turn_key:'a-key'});
 await vi.waitFor(()=>expect(opts).toBeDefined());f.changeOwner();await vi.waitFor(()=>expect(f.controller.getSnapshot().ready).toBe(true));f.controller.setDraft('B private');
 await opts.onConversation({id:'late-a'});gate.resolve({conversationId:'late-a',isPending:false});await pending;
 expect(f.adopted).toEqual([]);expect(f.reconciled).toEqual([]);expect(f.controller.getSnapshot().draft).toBe('B private');
});
it('stored unexpired running turns lock sending and use verified cancellation without reconstructing a request',async()=>{
 const f=fixture();await f.controller.start();f.setState({chats:[{id:'saved',messages:[{role:'assistant',id:'m',status:'running',execution_expires_at:new Date(Date.now()+60000).toISOString()}],attachments:[]}],activeId:'saved',loaded:true});
 expect(f.controller.getSnapshot().locked).toBe(true);expect(f.controller.getSnapshot().recoverable).toBe(false);
 expect(await f.controller.send({message:'No new turn'})).toBe(false);await f.controller.stop();
 expect(f.deps.recordChatCancellation).toHaveBeenCalledWith('saved');expect(f.deps.sendTurn).not.toHaveBeenCalled();expect(f.controller.getSnapshot().cancelRequested).toBe(true);
});
it('unknown recovery uses retryTurn and appends no second optimistic user message',async()=>{
 const f=fixture();f.deps.retryRequest=()=>({turn_key:'old'});
 // Construct after replacing the dependency so the retained request is observable.
 const c=createResearchThread(f.deps);await c.start();f.setStreams({new:{status:'unknown',isPending:true,isStreaming:false,retryable:true,streamingText:'Partial',sources:[]}});
 f.deps.retryTurn.mockResolvedValue({isPending:true,status:'running'});await c.recover();expect(f.deps.retryTurn).toHaveBeenCalledOnce();expect(f.append).toEqual([]);
});
it('idle empty stream sources fall back to the latest saved evidence',async()=>{
 const f=fixture();await f.controller.start();f.setState({activeId:'saved',loaded:true,chats:[{id:'saved',attachments:[],messages:[{id:'m',role:'assistant',content:'Saved',status:'complete',sources:[{id:1}]}]}]});
 expect(f.controller.getSnapshot().sources).toEqual([{id:1}]);
 f.setStreams({saved:{status:'complete',messageId:'m',streamingText:'Saved',sources:[]}});expect(f.controller.getSnapshot().live).toBe(false);expect(f.controller.getSnapshot().messages).toHaveLength(1);
});
it('rejected Stop writes stay visible and retryable rather than confirming cancellation',async()=>{
 const f=fixture();await f.controller.start();f.setState({activeId:'saved',loaded:true,chats:[{id:'saved',messages:[{role:'assistant',status:'running',execution_expires_at:new Date(Date.now()+60000).toISOString()}]}]});
 f.deps.recordChatCancellation.mockResolvedValueOnce({cancelRequested:false,cancelError:'Try Stop again'});await f.controller.stop();expect(f.controller.getSnapshot()).toMatchObject({cancelRequested:false,cancelError:'Try Stop again'});
 await f.controller.stop();expect(f.controller.getSnapshot().cancelRequested).toBe(true);
});

it('Stop before the send preflight finishes queues until the transport operation exists',async()=>{
 const f=fixture();await f.controller.start();const verification=deferred();const result=deferred();
 f.deps.localIdentityIsCurrent.mockImplementationOnce(()=>verification.promise);f.deps.sendTurn.mockImplementation(()=>result.promise);
 const pending=f.controller.send({message:'Question',turn_key:'queued'});await f.controller.stop();
 expect(f.deps.stopTurn).not.toHaveBeenCalled();expect(f.controller.getSnapshot().cancelRequested).toBe(true);
 verification.resolve(true);await vi.waitFor(()=>expect(f.deps.stopTurn).toHaveBeenCalledOnce());
 result.resolve({status:'unknown',isPending:true});await pending;
});
it('dispose clears private state before a remount can verify a possibly different owner',async()=>{
 const f=fixture();await f.controller.start();f.controller.setDraft('Private A');f.controller.openSource({title:'Private evidence'});
 f.controller.dispose();const gate=deferred();f.deps.verifiedLocalIdentity.mockImplementation(()=>gate.promise);
 const remount=f.controller.start();expect(f.controller.getSnapshot()).toMatchObject({ready:false,draft:'',viewer:null});expect(f.controller.getSnapshot().store.chats).toEqual([]);
 gate.resolve(null);await remount;expect(f.controller.getSnapshot().ready).toBe(false);
});
it('a saved terminal result clears requested Stop rather than showing Stopping forever',async()=>{
 const f=fixture();await f.controller.start();const gate=deferred();f.deps.sendTurn.mockImplementation(()=>gate.promise);
 const pending=f.controller.send({message:'Question',turn_key:'stop-key'});await vi.waitFor(()=>expect(f.deps.sendTurn).toHaveBeenCalledOnce());await f.controller.stop();
 expect(f.controller.getSnapshot().cancelRequested).toBe(true);gate.resolve({status:'cancelled',isPending:false});await pending;expect(f.controller.getSnapshot().cancelRequested).toBe(false);
});
it('a new draft never displays a terminal answer retained under a previous conversation alias',async()=>{
 const f=fixture();await f.controller.start();f.setState({activeId:'old',loaded:true,chats:[{id:'old',messages:[],attachments:[]}]});
 f.setStreams({new:{conversationId:'old',status:'complete',streamingText:'Private old answer',sources:[{id:1}],isPending:false}});
 f.controller.newChat();expect(f.controller.getSnapshot().live).toBe(false);expect(f.controller.getSnapshot().sources).toEqual([]);
});
it('model normalization rejects whitespace identifiers just like the displayed picker',()=>{
 expect(normalizeResearchChoice([{model_id:'  ',is_default:true},{model_id:'good'}],{})).toEqual({modelId:'good',effort:'off'});
});
it('loading an already terminal conversation does not allow a spurious cancellation write',async()=>{
 const f=fixture();await f.controller.start();f.setState({activeId:'saved',loaded:true,chats:[{id:'saved',messages:[{role:'assistant',status:'complete',content:'Done'}]}]});
 const gate=deferred();f.deps.loadMessages=()=>gate.promise;
 const c=createResearchThread(f.deps);await c.start();const reload=c.reload();await c.stop();expect(f.deps.recordChatCancellation).not.toHaveBeenCalled();gate.resolve(f.controller.getSnapshot().store);await reload;
});
it('verified saved reconciliation retires an open transport without applying its later aborted result',async()=>{
 const f=fixture();f.deps.reconcileSavedTurn=vi.fn(async()=>true);const c=createResearchThread(f.deps);await c.start();
 const gate=deferred();let options;f.deps.sendTurn.mockImplementation((_body,o)=>{options=o;return gate.promise});
 const sending=c.send({message:'Question',turn_key:'late'});await vi.waitFor(()=>expect(options).toBeDefined());await options.onConversation({id:'server-c'});
 f.setState({activeId:'server-c',loaded:true,chats:[{id:'server-c',draftId:1,messages:[{id:'m',role:'assistant',turn_key:'late',status:'complete',content:'Saved answer'}]}]});
 await c.reload();expect(c.getSnapshot().submitting).toBe(false);
 gate.resolve({error:'Your research session changed.',errorCode:'identity_changed'});await sending;
 expect(c.getSnapshot().error).toBe('');expect(c.getSnapshot().messages[0].content).toBe('Saved answer');
});
it('a reconciliation fence covers transport abortion before the verified settlement promise resolves',async()=>{
 const f=fixture();const transport=deferred(),verification=deferred();let options;
 f.deps.sendTurn.mockImplementation((_body,o)=>{options=o;return transport.promise});
 f.deps.reconcileSavedTurn=vi.fn(async()=>{transport.resolve({error:'Your research session changed.',errorCode:'identity_changed'});return verification.promise});
 const c=createResearchThread(f.deps);await c.start();const send=c.send({message:'Q',turn_key:'fenced'});
 await vi.waitFor(()=>expect(options).toBeDefined());await options.onConversation({id:'server-c'});
 f.setState({activeId:'server-c',loaded:true,chats:[{id:'server-c',draftId:1,messages:[{id:'m',role:'assistant',turn_key:'fenced',status:'complete',content:'Saved'}]}]});
 const reload=c.reload();await vi.waitFor(()=>expect(f.deps.reconcileSavedTurn).toHaveBeenCalledOnce());
 expect(c.getSnapshot().error).toBe('');verification.resolve(true);await Promise.all([reload,send]);expect(c.getSnapshot()).toMatchObject({error:'',submitting:false});
});
it('a reconciliation that finds no saved row still surfaces the transport result it fenced',async()=>{
 const f=fixture();const transport=deferred(),verification=deferred();let options;
 f.deps.sendTurn.mockImplementation((_body,o)=>{options=o;return transport.promise});
 f.deps.reconcileSavedTurn=vi.fn(async()=>{transport.resolve({error:'Your research session changed.',errorCode:'identity_changed'});return verification.promise});
 const c=createResearchThread(f.deps);await c.start();const send=c.send({message:'Q',turn_key:'unsaved'});
 await vi.waitFor(()=>expect(options).toBeDefined());await options.onConversation({id:'server-c'});
 f.setState({activeId:'server-c',loaded:true,chats:[{id:'server-c',draftId:1,messages:[],attachments:[]}]});
 const reload=c.reload();await vi.waitFor(()=>expect(f.deps.reconcileSavedTurn).toHaveBeenCalledOnce());
 verification.resolve(false);await Promise.all([reload,send]);
 expect(c.getSnapshot()).toMatchObject({error:'Your research session changed.',submitting:false,locked:false});
});
it('a failed reconciliation read leaves a truthful message and an unlocked composer',async()=>{
 const f=fixture();const transport=deferred();let options;
 f.deps.sendTurn.mockImplementation((_body,o)=>{options=o;return transport.promise});
 f.deps.reconcileSavedTurn=vi.fn(async()=>{transport.resolve({error:'Your research session changed.',errorCode:'identity_changed'});throw new Error('Saved result read failed')});
 const c=createResearchThread(f.deps);await c.start();const send=c.send({message:'Q',turn_key:'unread'});
 await vi.waitFor(()=>expect(options).toBeDefined());await options.onConversation({id:'server-c'});
 f.setState({activeId:'server-c',loaded:true,chats:[{id:'server-c',draftId:1,messages:[],attachments:[]}]});
 await Promise.all([c.reload(),send]);
 expect(['Your research session changed.','The saved result could not be loaded. Try Reload.']).toContain(c.getSnapshot().error);
 expect(c.getSnapshot()).toMatchObject({submitting:false,loading:false,locked:false});
 expect(f.deps.sendTurn).toHaveBeenCalledOnce();expect(f.deps.retryTurn).not.toHaveBeenCalled();
});

// F14: the reader's model and effort survive a reload, per browser, and a
// broken or blocked storage never stops the thread.
function memoryStorage(initial={}){const values=new Map(Object.entries(initial));return{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),values}}
const twoModels=async()=>({models:[{model_id:'model/default',is_default:true,efforts:['low']},{model_id:'model/deep',efforts:['low','high']}],roles:[]});
it('restores a saved model and effort after a reload',async()=>{
 const f=fixture();const storage=memoryStorage({niyResearchChoice:JSON.stringify({modelId:'model/deep',effort:'high'})});
 const controller=createResearchThread({...f.deps,loadRegistry:twoModels,choiceStorage:storage});await controller.start();
 expect(controller.getSnapshot().choice).toEqual({modelId:'model/deep',effort:'high'});
});
it('saves the normalised choice when the reader changes it',async()=>{
 const f=fixture();const storage=memoryStorage();
 const controller=createResearchThread({...f.deps,loadRegistry:twoModels,choiceStorage:storage});await controller.start();
 controller.setChoice({modelId:'model/deep',effort:'high'});
 expect(JSON.parse(storage.values.get('niyResearchChoice'))).toEqual({modelId:'model/deep',effort:'high'});
 controller.setChoice({modelId:'model/gone',effort:'high'});
 expect(JSON.parse(storage.values.get('niyResearchChoice'))).toEqual({modelId:'model/default',effort:'low'});
});
it('falls back to the default when the saved model is gone or storage throws',async()=>{
 const f=fixture();
 const gone=createResearchThread({...f.deps,loadRegistry:twoModels,choiceStorage:memoryStorage({niyResearchChoice:JSON.stringify({modelId:'model/removed',effort:'high'})})});await gone.start();
 expect(gone.getSnapshot().choice).toEqual({modelId:'model/default',effort:'low'});
 const throwing={getItem:()=>{throw new Error('blocked')},setItem:()=>{throw new Error('blocked')}};
 const blocked=createResearchThread({...fixture().deps,loadRegistry:twoModels,choiceStorage:throwing});await blocked.start();
 expect(blocked.getSnapshot().choice).toEqual({modelId:'model/default',effort:'low'});
 expect(()=>blocked.setChoice({modelId:'model/deep',effort:'high'})).not.toThrow();
 expect(blocked.getSnapshot().choice).toEqual({modelId:'model/deep',effort:'high'});
});

// F43: an unsent chat lost its attachments whenever its tab regained focus.
function attachable(f){f.deps.addChatAttachments.mockImplementation((id,list)=>{const s=f.getState();f.setState({...s,chats:s.chats.map(c=>c.id===id?{...c,attachments:[...c.attachments,...list]}:c)})});}
it('a same-account SIGNED_IN on tab refocus keeps the unsent draft, its attachments and the viewer',async()=>{
 const f=fixture();attachable(f);await f.controller.start();
 expect(await f.controller.attach(async()=>[{kind:'row',title:'Dropped row'}])).toBe(true);
 f.controller.setDraft('Unsent question');f.controller.openSource({title:'Evidence'});const version=f.controller.getSnapshot().identityVersion;
 f.refocus();
 expect(f.controller.getSnapshot()).toMatchObject({ready:true,draft:'Unsent question',viewer:{source:{title:'Evidence'}},identityVersion:version});
 expect(f.controller.getSnapshot().chat.attachments.map(a=>a.title)).toEqual(['Dropped row']);
 await vi.waitFor(()=>expect(f.deps.verifiedLocalIdentity).toHaveBeenCalledTimes(2));
 expect(f.deps.hydrateConversations).toHaveBeenCalledOnce();
 // The re-verified identity is the one later work runs under: a send succeeds.
 expect(await f.controller.send({message:'Unsent question',turn_key:'k'})).toBe(true);expect(f.deps.sendTurn).toHaveBeenCalledOnce();
});
it('a token refresh for the same account is re-checked quietly too',async()=>{
 const f=fixture();attachable(f);await f.controller.start();await f.controller.attach(async()=>[{title:'Dropped row'}]);f.controller.setDraft('Unsent');
 f.refocus('TOKEN_REFRESHED');expect(f.controller.getSnapshot()).toMatchObject({ready:true,draft:'Unsent'});
 await vi.waitFor(()=>expect(f.deps.verifiedLocalIdentity).toHaveBeenCalledTimes(2));
 expect(f.controller.getSnapshot().chat.attachments).toHaveLength(1);expect(f.deps.hydrateConversations).toHaveBeenCalledOnce();
});
it('a turn in flight across a refocus still reconciles and unlocks',async()=>{
 const f=fixture();await f.controller.start();const gate=deferred();let opts;
 f.deps.sendTurn.mockImplementation((_body,o)=>{opts=o;return gate.promise});const pending=f.controller.send({message:'Q',turn_key:'q'});
 await vi.waitFor(()=>expect(opts).toBeDefined());f.refocus();
 await opts.onConversation({id:'server-c'});gate.resolve({conversationId:'server-c',isPending:false,status:'complete',messageId:'m'});await pending;
 expect(f.reconciled).toHaveLength(1);expect(f.controller.getSnapshot().submitting).toBe(false);
});
it('a failed same-account re-check still clears the thread',async()=>{
 const f=fixture();attachable(f);await f.controller.start();await f.controller.attach(async()=>[{title:'Dropped row'}]);f.controller.setDraft('Unsent');
 f.deps.verifiedLocalIdentity.mockResolvedValue(null);f.refocus();
 await vi.waitFor(()=>expect(f.controller.getSnapshot().ready).toBe(false));
 expect(f.controller.getSnapshot()).toMatchObject({draft:'',viewer:null,store:{chats:[]}});
});
it('a sign-out after attaching still clears the thread synchronously',async()=>{
 const f=fixture();attachable(f);await f.controller.start();await f.controller.attach(async()=>[{title:'Dropped row'}]);f.controller.setDraft('Unsent');
 f.signOut();
 expect(f.controller.getSnapshot()).toMatchObject({ready:false,draft:'',viewer:null,store:{chats:[]},error:'Sign in to use AI research.'});
});
it('another account after attaching still clears the thread synchronously',async()=>{
 const f=fixture();attachable(f);await f.controller.start();await f.controller.attach(async()=>[{title:'Dropped row'}]);f.controller.setDraft('Unsent');
 f.changeOwner('b');
 expect(f.controller.getSnapshot()).toMatchObject({ready:false,draft:'',store:{chats:[]}});
});
// panel-loading spec B: the controller verifies the account once on open and hands that identity to
// the conversation read, instead of letting it (and its message load) verify twice more.
it('B: opening hands the identity it just verified to the conversation read',async()=>{
 const f=fixture();await f.controller.start();
 expect(f.deps.verifiedLocalIdentity).toHaveBeenCalledOnce();
 expect(f.deps.hydrateConversations).toHaveBeenCalledWith(expect.objectContaining({id:'a',token:'a'}));
});
// chat-attach-fixes: an attach that skips anything already attached says so, until the next attach or send.
it('an attach that skips duplicates names them, and the next attach clears the note',async()=>{
 const f=fixture();attachable(f);await f.controller.start();
 await f.controller.attach(async()=>[{kind:'file',title:'notes.txt',fingerprint:'11:aa'}]);
 expect(f.controller.getSnapshot().attachNotice).toBe('');
 await f.controller.attach(async()=>[{kind:'file',title:'notes.txt',fingerprint:'11:aa'},{kind:'row',title:'A bill',document_key:'bill:1:1'}]);
 expect(f.controller.getSnapshot().attachNotice).toBe('Already attached: notes.txt');
 expect(f.deps.addChatAttachments).toHaveBeenLastCalledWith(expect.anything(),[expect.objectContaining({title:'A bill'})]);
 await f.controller.attach(async()=>[{kind:'row',title:'C',document_key:'bill:1:3'}]);
 expect(f.controller.getSnapshot().attachNotice).toBe('');
});


// F60: attachment work is visible and serialized independently of research execution.
it('locks while materializing attachments without offering a spurious Stop', async () => {
 const f=fixture();attachable(f);await f.controller.start();const gate=deferred();
 const attaching=f.controller.attach(()=>gate.promise);
 expect(f.controller.getSnapshot()).toMatchObject({attaching:true,locked:true,canStop:false});
 const second=vi.fn(async()=>[]);
 expect(await f.controller.attach(second)).toBe(false);expect(second).not.toHaveBeenCalled();
 expect(await f.controller.send({message:'Wait'})).toBe(false);
 expect(f.controller.newChat()).toBe(false);
 gate.resolve([{kind:'row',title:'Ready'}]);await attaching;
 expect(f.controller.getSnapshot()).toMatchObject({attaching:false,locked:false});
 expect(f.controller.getSnapshot().chat.attachments.map(a=>a.title)).toEqual(['Ready']);
});
it('names duplicates and overflow while admitting only remaining attachment slots', async () => {
 const f=fixture();attachable(f);await f.controller.start();
 const existing=Array.from({length:11},(_,i)=>({kind:'row',title:`Existing ${i}`,document_key:`bill:1:${i}`}));
 await f.controller.attach(async()=>existing);
 await f.controller.attach(async()=>[existing[0],{kind:'row',title:'Admitted',document_key:'bill:2:1'},{kind:'row',title:'Omitted.pdf',document_key:'bill:2:2'}]);
 expect(f.controller.getSnapshot().chat.attachments).toHaveLength(12);
 expect(f.controller.getSnapshot().attachNotice).toBe('Already attached: Existing 0. Attachment limit (12): not added: Omitted.pdf');
 await f.controller.attach(async()=>[{kind:'row',title:'Another',document_key:'bill:2:3'}]);
 expect(f.controller.getSnapshot().attachNotice).toBe('Attachment limit (12): not added: Another');
});
it('releases attachment processing after failure with fixed copy', async () => {
 const f=fixture();await f.controller.start();
 await f.controller.attach(async()=>{throw new Error('private file detail');});
 expect(f.controller.getSnapshot()).toMatchObject({attaching:false,locked:false,error:'The attachment could not be loaded.'});
});
it('account changes erase attachment notices and ignore late attachment work', async () => {
 const f=fixture();attachable(f);await f.controller.start();
 const row={kind:'row',title:'A private item',document_key:'bill:1:1'};
 await f.controller.attach(async()=>[row]);await f.controller.attach(async()=>[row]);
 const gate=deferred();const pending=f.controller.attach(()=>gate.promise);
 f.changeOwner('b');
 expect(f.controller.getSnapshot()).toMatchObject({attaching:false,attachNotice:''});
 await vi.waitFor(()=>expect(f.controller.getSnapshot().ready).toBe(true));
 gate.resolve([row]);expect(await pending).toBe(false);
 expect(f.controller.getSnapshot()).toMatchObject({attaching:false,attachNotice:''});
 expect(f.controller.getSnapshot().chat.attachments).toEqual([]);
});
it('Reload after a failed history write refreshes the authoritative conversation list, even after the last deletion', async () => {
 const f=fixture();await f.controller.start();
 f.setState({activeId:'',loaded:true,chats:[],persistenceError:'Conversation changes could not be saved.'});
 await f.controller.reload();
 expect(f.deps.hydrateConversations).toHaveBeenCalledTimes(2);
 expect(f.controller.getSnapshot().chat.draft).toBe(true);
});
