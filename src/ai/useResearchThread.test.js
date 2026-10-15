import {describe,expect,it,vi} from 'vitest';
import {bindOpenConversation,createResearchThread,normalizeResearchChoice} from './useResearchThread.js';
import {OPEN_CONVERSATION_EVENT} from '../lib/creditsStore.js';
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
 // F111: the credits store reads the network; a test that does not care gets quiet stand-ins.
 refreshCredits:vi.fn(async()=>null),conversationCredits:vi.fn(async()=>new Map()),loadCreditEstimates:vi.fn(async()=>({})),
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

// F130 T4a: the web-search override and the server's decision (web-search spec §1, §6).
function webFixture(){
 const f=fixture();
 f.deps.setChatWebSearch=vi.fn((id,value)=>{const s=f.getState();f.setState({...s,chats:s.chats.map(c=>c.id===id?{...c,webSearch:typeof value==='boolean'?value:null}:c)});});
 const controller=createResearchThread(f.deps);
 return{...f,controller};
}
const savedChat=(id,webSearch,extra={})=>({id,attachments:[],messages:[],webSearch,...extra});
it('a new conversation starts automatic and sends no web_search',async()=>{
 const f=webFixture();await f.controller.start();
 expect(f.controller.getSnapshot().webSearch).toBe(null);
 await f.controller.send({message:'Q',turn_key:'auto',focus:'attached'});
 expect('web_search' in f.sent[0]).toBe(false);
});
it('setWebSearch records the override on the active conversation and sends it with the next turn',async()=>{
 const f=webFixture();await f.controller.start();
 expect(f.controller.setWebSearch).toBeTypeOf('function');
 f.controller.setWebSearch(false);
 expect(f.deps.setChatWebSearch).toHaveBeenCalledWith('',false);
 expect(f.controller.getSnapshot().webSearch).toBe(false);
 await f.controller.send({message:'Q',turn_key:'off'});
 expect(f.sent[0].web_search).toBe(false);
});
it('an override of true is sent as true, and is not dropped as falsy',async()=>{
 const f=webFixture();await f.controller.start();f.controller.setWebSearch(true);
 await f.controller.send({message:'Q',turn_key:'on'});
 expect(f.sent[0].web_search).toBe(true);
});
it('the override starts from the loaded conversation and switching conversations switches it',async()=>{
 const f=webFixture();await f.controller.start();
 f.setState({activeId:'on',loaded:true,chats:[savedChat('on',true),savedChat('off',false),savedChat('auto',null),savedChat('old',undefined)]});
 expect(f.controller.getSnapshot().webSearch).toBe(true);
 await f.controller.selectChat('off');expect(f.controller.getSnapshot().webSearch).toBe(false);
 await f.controller.selectChat('auto');expect(f.controller.getSnapshot().webSearch).toBe(null);
 await f.controller.selectChat('old');expect(f.controller.getSnapshot().webSearch).toBe(null);
 await f.controller.selectChat('on');
 await f.controller.send({message:'Q',turn_key:'reopened'});
 expect(f.sent[0]).toMatchObject({web_search:true,conversation_id:'on'});
 await f.controller.selectChat('auto');
 await f.controller.send({message:'Q2',turn_key:'auto-again'});
 expect('web_search' in f.sent[1]).toBe(false);
});
it('a conversation that was automatic sends nothing even if the caller supplied a value',async()=>{
 const f=webFixture();await f.controller.start();
 await f.controller.send({message:'Q',turn_key:'stray',web_search:true});
 expect('web_search' in f.sent[0]).toBe(false);
});
it('the override cannot be changed while a turn is locked',async()=>{
 const f=webFixture();await f.controller.start();
 f.setState({activeId:'run',loaded:true,chats:[savedChat('run',null,{messages:[{role:'assistant',id:'m',status:'running',execution_expires_at:new Date(Date.now()+60000).toISOString()}]})]});
 expect(f.controller.getSnapshot().locked).toBe(true);
 expect(f.controller.setWebSearch(true)).toBe(false);
 expect(f.deps.setChatWebSearch).not.toHaveBeenCalled();
});
it('keeps the server decision for the turn in flight and nothing once the stream is gone',async()=>{
 const f=webFixture();await f.controller.start();
 f.setState({activeId:'c',loaded:true,chats:[savedChat('c',null)]});
 expect(f.controller.getSnapshot().web).toBe(null);
 const decision={offered:true,mode:'auto',reason:'module-without-documents'};
 f.setStreams({c:{conversationId:'c',status:'streaming',isStreaming:true,isPending:true,streamingText:'',sources:[],web:decision}});
 expect(f.controller.getSnapshot().web).toEqual(decision);
 f.setStreams({});
 expect(f.controller.getSnapshot().web).toBe(null);
});
it('webSources come from the stream while it holds some, then from the latest saved answer',async()=>{
 const f=webFixture();await f.controller.start();
 const saved=[{url:'https://saved.example/',title:'Saved',domain:'saved.example',cited:true}];
 const live=[{url:'https://live.example/',title:'Live',domain:'live.example',cited:false}];
 f.setState({activeId:'c',loaded:true,chats:[savedChat('c',null,{messages:[{id:'m1',role:'assistant',content:'A',status:'complete',webSources:saved}]})]});
 expect(f.controller.getSnapshot().webSources).toEqual(saved);
 f.setStreams({c:{conversationId:'c',status:'streaming',isStreaming:true,isPending:true,streamingText:'x',sources:[],webSources:live}});
 expect(f.controller.getSnapshot().webSources).toEqual(live);
});
// F131 §2: the pages found so far, from the stream only; nothing once the stream is gone.
it('webLive comes from the turn in flight only',async()=>{
 const f=webFixture();await f.controller.start();
 f.setState({activeId:'c',loaded:true,chats:[savedChat('c',null,{messages:[{id:'m1',role:'assistant',content:'A',status:'complete',webSources:[{url:'https://saved.example/',title:'S',domain:'saved.example',cited:true}]}]})]});
 expect(f.controller.getSnapshot().webLive).toEqual([]);
 const live=[{url:'https://live.example/',title:'Live',domain:'live.example'}];
 f.setStreams({c:{conversationId:'c',status:'streaming',isStreaming:true,isPending:true,streamingText:'',sources:[],webSources:[],webLive:live}});
 expect(f.controller.getSnapshot().webLive).toEqual(live);
 f.setStreams({});
 expect(f.controller.getSnapshot().webLive).toEqual([]);
});
it('the finished assistant message keeps its webSources after reconciliation',async()=>{
 const f=webFixture();await f.controller.start();
 const pages=[{url:'https://a.example/',title:'A',domain:'a.example',cited:true}];
 f.deps.reconcileTurn.mockImplementation(async()=>{const s={...f.getState(),activeId:'server-c',chats:[savedChat('server-c',null,{messages:[{id:'m',role:'assistant',content:'Done',status:'complete',webSources:pages}]})]};f.setState(s);return s;});
 await f.controller.send({message:'Q',turn_key:'reload'});
 expect(f.controller.getSnapshot().messages.find(m=>m.role==='assistant').webSources).toEqual(pages);
});

// F111 task 4a (spec §8): a refused turn tells the composer why, and the balance is re-read.
const refusal=(errorCode,error)=>({conversationId:'server-c',isPending:false,status:'error',retryable:errorCode==='credits_unavailable',error,errorCode,messageId:''});
it('the view names the verified account, for the credits it shows',async()=>{
 const f=fixture();expect(f.controller.getSnapshot().ownerId).toBe('');await f.controller.start();expect(f.controller.getSnapshot().ownerId).toBe('a');
 f.signOut();expect(f.controller.getSnapshot().ownerId).toBe('');
});
it('a 402 credits_exhausted refusal sets the blocked state, re-reads the balance, and the next send clears it',async()=>{
 const f=fixture();await f.controller.start();
 f.deps.sendTurn.mockImplementationOnce(async()=>refusal('credits_exhausted','You have no AI credits left to start an answer.'));
 await f.controller.send({message:'Q1',turn_key:'k1'});
 expect(f.controller.getSnapshot().creditBlock).toBe('credits_exhausted');expect(f.deps.refreshCredits).toHaveBeenCalled();
 let release;f.deps.sendTurn.mockImplementationOnce(()=>new Promise(r=>release=r));
 const second=f.controller.send({message:'Q2',turn_key:'k2'});await vi.waitFor(()=>expect(f.deps.sendTurn).toHaveBeenCalledTimes(2));
 expect(f.controller.getSnapshot().creditBlock).toBe('');
 release({conversationId:'server-c',isPending:false,status:'complete',messageId:'m'});await second;
});
it('a 503 credits_unavailable refusal is its own state, never the blocked one',async()=>{
 const f=fixture();await f.controller.start();
 f.deps.sendTurn.mockImplementationOnce(async()=>refusal('credits_unavailable','AI credits could not be checked.'));
 await f.controller.send({message:'Q1',turn_key:'k1'});
 expect(f.controller.getSnapshot().creditBlock).toBe('credits_unavailable');expect(f.deps.refreshCredits).toHaveBeenCalled();
});
it('another error leaves the credit state alone, and an account change clears it',async()=>{
 const f=fixture();await f.controller.start();
 f.deps.sendTurn.mockImplementationOnce(async()=>refusal('turn_conflict','Conflicting'));
 await f.controller.send({message:'Q1',turn_key:'k1'});expect(f.controller.getSnapshot().creditBlock).toBe('');
 f.deps.sendTurn.mockImplementationOnce(async()=>refusal('credits_exhausted','none'));
 await f.controller.send({message:'Q2',turn_key:'k2'});expect(f.controller.getSnapshot().creditBlock).toBe('credits_exhausted');
 f.changeOwner();expect(f.controller.getSnapshot().creditBlock).toBe('');
});
it('re-reads the balance after a turn that ends with no credits frame to come, and not before one',async()=>{
 const f=fixture();await f.controller.start();expect(f.deps.refreshCredits).not.toHaveBeenCalled();
 // A failed or interrupted turn may never reach `done`, so no frame will refresh the balance for it.
 for(const[i,status]of['error','interrupted'].entries()){
  f.deps.sendTurn.mockImplementationOnce(async()=>({conversationId:'server-c',isPending:false,status,retryable:false,error:'x',errorCode:status,messageId:''}));
  await f.controller.send({message:'Q'+i,turn_key:'k'+i});expect(f.deps.refreshCredits).toHaveBeenCalledTimes(i+1);
 }
});
it('leaves the re-read to the credits frame for a turn that ended at done (complete, stopped, truncated), review R M3',async()=>{
 const f=fixture();await f.controller.start();
 for(const[i,status]of['complete','cancelled','truncated'].entries()){
  f.deps.sendTurn.mockImplementationOnce(async()=>({conversationId:'server-c',isPending:false,status,retryable:false,error:'',errorCode:'',messageId:'m'+i}));
  await f.controller.send({message:'Q'+i,turn_key:'k'+i});
 }
 expect(f.deps.refreshCredits).not.toHaveBeenCalled();
});
it('a refusal records which error it was, and whether the credits are held by a running answer, until the next send',async()=>{
 const f=fixture();await f.controller.start();
 f.deps.sendTurn.mockImplementationOnce(async()=>({...refusal('credits_exhausted','Your credits are in use by an answer that is still running. Try again when it finishes.'),held:true}));
 await f.controller.send({message:'Q1',turn_key:'k1'});
 expect(f.controller.getSnapshot()).toMatchObject({creditBlock:'credits_exhausted',creditHeld:true,creditError:'Your credits are in use by an answer that is still running. Try again when it finishes.'});
 f.deps.sendTurn.mockImplementationOnce(async()=>refusal('credits_exhausted','You have no AI credits left to start an answer.'));
 await f.controller.send({message:'Q2',turn_key:'k2'});
 expect(f.controller.getSnapshot()).toMatchObject({creditBlock:'credits_exhausted',creditHeld:false,creditError:'You have no AI credits left to start an answer.'});
 let release;f.deps.sendTurn.mockImplementationOnce(()=>new Promise(r=>release=r));
 const third=f.controller.send({message:'Q3',turn_key:'k3'});await vi.waitFor(()=>expect(f.deps.sendTurn).toHaveBeenCalledTimes(3));
 expect(f.controller.getSnapshot()).toMatchObject({creditBlock:'',creditHeld:false,creditError:''});
 release({conversationId:'server-c',isPending:false,status:'complete',messageId:'m'});await third;
});
it('another error never becomes the credits error, and an account change clears it',async()=>{
 const f=fixture();await f.controller.start();
 f.deps.sendTurn.mockImplementationOnce(async()=>refusal('turn_conflict','Conflicting'));
 await f.controller.send({message:'Q1',turn_key:'k1'});expect(f.controller.getSnapshot().creditError).toBe('');
 f.deps.sendTurn.mockImplementationOnce(async()=>refusal('credits_exhausted','none'));
 await f.controller.send({message:'Q2',turn_key:'k2'});expect(f.controller.getSnapshot().creditError).toBe('none');
 f.changeOwner();expect(f.controller.getSnapshot()).toMatchObject({creditError:'',creditHeld:false});
});
it('a balance read that fails never fails the turn',async()=>{
 const f=fixture();await f.controller.start();f.deps.refreshCredits.mockRejectedValue(new Error('offline'));
 expect(await f.controller.send({message:'Q',turn_key:'k'})).toBe(true);expect(f.controller.getSnapshot().error).toBe('');
});

// F111 task 4b (spec §8): each answer's credits, from the turn's own frame and from the saved record.
describe('credits on each answer',()=>{
 const savedState=()=>({chats:[{id:'saved',messages:[{id:'m1',role:'assistant',content:'A',status:'complete'}],attachments:[]}],activeId:'saved',loaded:true});
 function withCallback(f){let opts;f.deps.sendTurn.mockImplementation(async(_b,o)=>{opts=o;await o.onConversation({id:'server-c'});return{conversationId:'server-c',isPending:false,status:'complete',messageId:'m'}});return()=>opts}
 it('records the credits of the frame against the answer, and re-reads the balance there, once',async()=>{
  const f=fixture();await f.controller.start();const opts=withCallback(f);
  await f.controller.send({message:'Q',turn_key:'k'});expect(f.deps.refreshCredits).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().answerCredits).toEqual({});
  await opts().onCredits({conversationId:'server-c',messageId:'m',credits:38.25});
  expect(f.controller.getSnapshot().answerCredits).toEqual({m:38.25});expect(f.deps.refreshCredits).toHaveBeenCalledTimes(1);
 });
 it('with no credits in the frame, asks the record once and shows nothing for what it does not hold',async()=>{
  const f=fixture();await f.controller.start();const opts=withCallback(f);await f.controller.send({message:'Q',turn_key:'k'});
  await opts().onCredits({conversationId:'server-c',messageId:'m',credits:null});
  expect(f.deps.conversationCredits).toHaveBeenCalledWith('server-c');expect(f.controller.getSnapshot().answerCredits).toEqual({});
  f.deps.conversationCredits.mockResolvedValueOnce(new Map([['m',12]]));
  await opts().onCredits({conversationId:'server-c',messageId:'m',credits:null});
  await vi.waitFor(()=>expect(f.controller.getSnapshot().answerCredits).toEqual({m:12}));
 });
 it('ignores a frame that arrives after the account changed',async()=>{
  const f=fixture();await f.controller.start();const opts=withCallback(f);await f.controller.send({message:'Q',turn_key:'k'});
  f.changeOwner();await vi.waitFor(()=>expect(f.controller.getSnapshot().ready).toBe(true));
  await opts().onCredits({conversationId:'server-c',messageId:'m',credits:38});
  expect(f.controller.getSnapshot().answerCredits).toEqual({});
 });
 it('loads the saved credits of the open conversation after a reload, but asks nothing for a new draft',async()=>{
  const f=fixture();f.deps.hydrateConversations.mockImplementation(async()=>savedState());f.deps.conversationCredits.mockResolvedValue(new Map([['m1',5]]));
  await f.controller.start();await vi.waitFor(()=>expect(f.controller.getSnapshot().answerCredits).toEqual({m1:5}));
  expect(f.deps.conversationCredits).toHaveBeenCalledWith('saved');
  const g=fixture();await g.controller.start();expect(g.deps.conversationCredits).not.toHaveBeenCalled();
 });
 it('loads them again when a conversation is opened or reloaded, and drops them with the account',async()=>{
  const f=fixture();await f.controller.start();f.setState(savedState());
  f.deps.conversationCredits.mockResolvedValue(new Map([['m1',7]]));
  await f.controller.selectChat('saved');await vi.waitFor(()=>expect(f.controller.getSnapshot().answerCredits).toEqual({m1:7}));
  f.deps.conversationCredits.mockResolvedValue(new Map([['m1',8]]));
  await f.controller.reload();await vi.waitFor(()=>expect(f.controller.getSnapshot().answerCredits).toEqual({m1:8}));
  f.changeOwner();expect(f.controller.getSnapshot().answerCredits).toEqual({});
 });
 it('a failed read of the record changes nothing',async()=>{
  const f=fixture();f.deps.hydrateConversations.mockImplementation(async()=>savedState());f.deps.conversationCredits.mockRejectedValue(new Error('offline'));
  await f.controller.start();await Promise.resolve();expect(f.controller.getSnapshot()).toMatchObject({ready:true,answerCredits:{},error:''});
 });
});

// F149: Plan & billing asks for a saved conversation; the thread opens it once it can.
describe('opening a conversation from Plan & billing (F149)',()=>{
 const two=()=>({chats:[{id:'c1',messages:[],attachments:[],loaded:true},{id:'c2',messages:[],attachments:[],loaded:true}],activeId:'c1',loaded:true});
 it('selects the saved chat it is asked for',async()=>{
  const f=fixture();f.setState(two());await f.controller.start();
  expect(await f.controller.openConversation('c2')).toBe(true);expect(f.controller.getSnapshot().store.activeId).toBe('c2');
  expect(f.controller.getSnapshot().error).toBe('');
 });
 it('keeps a request made before the thread is ready, and applies it when it is',async()=>{
  const f=fixture();f.setState(two());const started=f.controller.start();
  expect(await f.controller.openConversation('c2')).toBe(false);
  await started;await vi.waitFor(()=>expect(f.controller.getSnapshot().store.activeId).toBe('c2'));
 });
 it('says so plainly, and changes nothing, when the conversation is not among the recent chats',async()=>{
  const f=fixture();f.setState(two());await f.controller.start();
  expect(await f.controller.openConversation('old')).toBe(false);
  expect(f.controller.getSnapshot().store.activeId).toBe('c1');expect(f.controller.getSnapshot().error).toMatch(/not in your recent chats/i);
 });
 it('does not switch chats while an answer is running, and says to wait',async()=>{
  const f=fixture();f.setState(two());await f.controller.start();
  let release;f.deps.sendTurn.mockImplementationOnce(()=>new Promise(r=>release=r));
  const sending=f.controller.send({message:'Q',turn_key:'k'});await vi.waitFor(()=>expect(f.deps.sendTurn).toHaveBeenCalled());
  expect(await f.controller.openConversation('c2')).toBe(false);
  expect(f.controller.getSnapshot().store.activeId).toBe('c1');expect(f.controller.getSnapshot().error).toMatch(/finish/i);
  release({conversationId:'c1',isPending:false,status:'complete',messageId:'m'});await sending;
 });
 it('forgets a request when the account changes',async()=>{
  const f=fixture();f.setState(two());const started=f.controller.start();await f.controller.openConversation('c2');
  f.signOut();await started;expect(f.controller.getSnapshot().store.activeId).not.toBe('c2');
 });
 it('bindOpenConversation takes a request made before it was bound, follows the event, and stops',()=>{
  const target=new EventTarget();const opened=[];let wanted='early';
  const take=vi.fn(()=>{const id=wanted;wanted='';return id});
  const stop=bindOpenConversation({openConversation:id=>opened.push(id)},{target,take});
  expect(opened).toEqual(['early']);
  target.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT,{detail:{conversationId:'c9'}}));
  expect(opened).toEqual(['early','c9']);expect(take).toHaveBeenCalledTimes(2);
  target.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT,{detail:{}}));expect(opened).toEqual(['early','c9']);
  stop();target.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT,{detail:{conversationId:'c10'}}));expect(opened).toEqual(['early','c9']);
 });
});

// F150: a 403 model_requires_plan (a stale plan) is shown plainly and the default model takes over.
describe('a model that needs a paid plan (F150)',()=>{
 it('names the refusal, falls back to the default model and remembers it, and the next send clears it',async()=>{
  const f=fixture();const storage=memoryStorage({niyResearchChoice:JSON.stringify({modelId:'model/deep',effort:'high'})});
  const controller=createResearchThread({...f.deps,loadRegistry:twoModels,choiceStorage:storage});await controller.start();
  expect(controller.getSnapshot().choice.modelId).toBe('model/deep');
  f.deps.sendTurn.mockImplementationOnce(async()=>refusal('model_requires_plan','This model is available on paid plans.'));
  await controller.send({message:'Q1',turn_key:'k1'});
  expect(controller.getSnapshot()).toMatchObject({planBlock:'model_requires_plan',error:'This model is available on paid plans.',choice:{modelId:'model/default',effort:'low'}});
  expect(JSON.parse(storage.values.get('niyResearchChoice'))).toEqual({modelId:'model/default',effort:'low'});
  expect(controller.getSnapshot().creditBlock).toBe('');
  f.deps.sendTurn.mockImplementationOnce(async(body)=>({conversationId:'server-c',isPending:false,status:'complete',messageId:'m',model:body.model}));
  await controller.send({message:'Q2',turn_key:'k2'});
  expect(f.sent.at(-1)?.model??f.deps.sendTurn.mock.calls.at(-1)[0].model).toBe('model/default');
  expect(controller.getSnapshot().planBlock).toBe('');
 });
 it('leaves other refusals alone',async()=>{
  const f=fixture();await f.controller.start();
  f.deps.sendTurn.mockImplementationOnce(async()=>refusal('http_400','Bad request'));
  await f.controller.send({message:'Q',turn_key:'k'});
  expect(f.controller.getSnapshot().planBlock).toBe('');
 });
});

// F151: what a typical answer costs, per model, read once the thread is ready.
describe('credit estimates for the picker (F151)',()=>{
 it('loads them after the thread is ready',async()=>{
  const f=fixture();f.deps.loadCreditEstimates.mockResolvedValue({'model/default':4});
  await f.controller.start();await vi.waitFor(()=>expect(f.controller.getSnapshot().estimates).toEqual({'model/default':4}));
 });
 it('a failed or empty read leaves none and never stops the thread',async()=>{
  const f=fixture();f.deps.loadCreditEstimates.mockRejectedValue(new Error('offline'));
  await f.controller.start();await Promise.resolve();
  expect(f.controller.getSnapshot()).toMatchObject({ready:true,error:'',estimates:{}});
 });
 it('drops them on sign-out',async()=>{
  const f=fixture();f.deps.loadCreditEstimates.mockResolvedValue({'model/default':4});
  await f.controller.start();await vi.waitFor(()=>expect(f.controller.getSnapshot().estimates).toEqual({'model/default':4}));
  f.signOut();expect(f.controller.getSnapshot().estimates).toEqual({});
 });
});

// F66 (F171 B3): after a dropped connection the turn's outcome is unknown. Stop stayed on screen
// though nothing was running, and the saved answer was checked once only.
it('a dropped connection with nothing running offers no Stop button',async()=>{
 const f=fixture();await f.controller.start();
 f.setStreams({new:{isStreaming:false,isPending:true,status:'unknown',errorCode:'connection_lost',error:'The connection dropped.',sources:[]}});
 expect(f.controller.getSnapshot().canStop).toBe(false);
 expect(f.controller.getSnapshot().locked).toBe(true);
});
it('an acknowledged turn keeps Stop after a dropped connection: the server may still be writing it',async()=>{
 const f=fixture();await f.controller.start();
 f.setStreams({new:{isStreaming:false,isPending:true,status:'unknown',errorCode:'connection_lost',error:'The connection dropped.',messageId:'m1',sources:[]}});
 expect(f.controller.getSnapshot().canStop).toBe(true);
});
it('after a dropped connection the saved answer is checked again until it is there',async()=>{
 vi.useFakeTimers();
 try{
  const f=fixture();await f.controller.start();
  f.deps.sendTurn.mockImplementation(async(body,opts)=>{await opts.onConversation({id:'server-c'});return{conversationId:'server-c',isPending:true,status:'unknown',errorCode:'connection_lost',error:'The connection dropped.',messageId:'m'}});
  f.deps.reconcileSavedTurn.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
  await f.controller.send({message:'Q',turn_key:'k'});
  const first=f.deps.reconcileSavedTurn.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.deps.reconcileSavedTurn.mock.calls.length).toBeGreaterThan(first);
  const calls=f.deps.reconcileSavedTurn.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000);
  expect(f.deps.reconcileSavedTurn.mock.calls.length).toBe(calls); // stops once the answer is there
 }finally{vi.useRealTimers();}
});
it('when the saved answer never arrives the reader is told what to do',async()=>{
 vi.useFakeTimers();
 try{
  const f=fixture();await f.controller.start();
  f.deps.sendTurn.mockImplementation(async(body,opts)=>{await opts.onConversation({id:'server-c'});return{conversationId:'server-c',isPending:true,status:'unknown',errorCode:'connection_lost',error:'The connection dropped.',messageId:'m'}});
  f.deps.reconcileSavedTurn.mockResolvedValue(false);
  await f.controller.send({message:'Q',turn_key:'k'});
  await vi.advanceTimersByTimeAsync(26*5000);
  expect(f.controller.getSnapshot().error).toBe('Still not saved. Use Recover answer or Reload.');
 }finally{vi.useRealTimers();}
});

// F178 (F171 review): the saved-answer re-check is one loop per conversation. A second drop, a new
// turn or a dispose used to leave an earlier loop running beside it.
describe('one saved-answer re-check loop per conversation (F178)',()=>{
 const dropped=async(body,opts)=>{await opts.onConversation({id:'server-c'});return{conversationId:'server-c',isPending:true,status:'unknown',errorCode:'connection_lost',error:'The connection dropped.',messageId:'m'}};
 const complete=async(body,opts)=>{await opts.onConversation({id:'server-c'});return{conversationId:'server-c',isPending:false,status:'complete',messageId:'m2'}};
 it('a new turn in the conversation stops the loop of the earlier one',async()=>{
  vi.useFakeTimers();
  try{
   const f=fixture();await f.controller.start();
   f.deps.sendTurn.mockImplementationOnce(dropped);f.deps.reconcileSavedTurn.mockResolvedValue(false);
   await f.controller.send({message:'Q1',turn_key:'k1'});
   expect(vi.getTimerCount()).toBe(1);
   f.deps.sendTurn.mockImplementationOnce(complete);
   await f.controller.send({message:'Q2',turn_key:'k2'});
   const calls=f.deps.reconcileSavedTurn.mock.calls.length;
   expect(vi.getTimerCount()).toBe(0);
   await vi.advanceTimersByTimeAsync(60000);
   expect(f.deps.reconcileSavedTurn.mock.calls.length).toBe(calls);
  }finally{vi.useRealTimers();}
 });
 it('a second drop in the same conversation leaves one loop, not two',async()=>{
  vi.useFakeTimers();
  try{
   const f=fixture();await f.controller.start();
   f.deps.sendTurn.mockImplementation(dropped);f.deps.reconcileSavedTurn.mockResolvedValue(false);
   await f.controller.send({message:'Q1',turn_key:'k1'});
   await f.controller.send({message:'Q2',turn_key:'k2'});
   expect(vi.getTimerCount()).toBe(1);
   const before=f.deps.reconcileSavedTurn.mock.calls.length;
   await vi.advanceTimersByTimeAsync(5000);
   expect(f.deps.reconcileSavedTurn.mock.calls.length-before).toBe(1);
  }finally{vi.useRealTimers();}
 });
 it('starting a loop for a conversation cancels the one it already has, whichever way the turn was sent',async()=>{
  vi.useFakeTimers();
  try{
   const f=fixture();await f.controller.start();
   f.deps.sendTurn.mockImplementation(dropped);f.deps.reconcileSavedTurn.mockResolvedValue(false);
   await f.controller.send({message:'Q1',turn_key:'k1'});
   // A new draft whose reply lands in the same conversation: execute cancels the draft's (empty) id, not this one.
   f.deps.createAiChat();
   await f.controller.send({message:'Q2',turn_key:'k2'});
   expect(vi.getTimerCount()).toBe(1);
  }finally{vi.useRealTimers();}
 });
 it('dispose stops the loop',async()=>{
  vi.useFakeTimers();
  try{
   const f=fixture();await f.controller.start();
   f.deps.sendTurn.mockImplementation(dropped);f.deps.reconcileSavedTurn.mockResolvedValue(false);
   await f.controller.send({message:'Q1',turn_key:'k1'});
   expect(vi.getTimerCount()).toBe(1);
   f.controller.dispose();
   expect(vi.getTimerCount()).toBe(0);
  }finally{vi.useRealTimers();}
 });
});

// F206 (owner 2026-10-16): opening AI after the page changed (a desk, a module, a record) starts a new
// chat; a chat chosen from history, one opened from the credits page, a sent turn or a new chat stays.
describe('a fresh chat by default',()=>{
 const saved=()=>({chats:[{id:'c1',title:'Old',messages:[{role:'user',content:'Q'}],attachments:[]}],activeId:'c1',loaded:true});
 const ready=async()=>{const f=fixture();f.setState(saved());f.deps.hydrateConversations.mockImplementation(async()=>f.getState());await f.controller.start();return f};
 it('starts a new chat the first time AI opens, without creating a server row',async()=>{
  const f=await ready();expect(f.controller.getSnapshot().chat.id).toBe('c1');
  expect(f.controller.freshIfStale()).toBe(true);
  expect(f.deps.createAiChat).toHaveBeenCalledOnce();expect(f.controller.getSnapshot().chat.draft).toBe(true);expect(f.sent).toEqual([]);
  expect(f.controller.freshIfStale()).toBe(false);expect(f.deps.createAiChat).toHaveBeenCalledOnce();
 });
 it('starts another after the page changes, and only once per change',async()=>{
  const f=await ready();f.controller.freshIfStale();await f.controller.send({message:'Q2',turn_key:'k2'});
  expect(f.controller.freshIfStale()).toBe(false);
  f.controller.contextChanged();expect(f.controller.freshIfStale()).toBe(true);expect(f.deps.createAiChat).toHaveBeenCalledTimes(2);
 });
 it('keeps an untouched new chat rather than making another',async()=>{
  const f=await ready();f.controller.freshIfStale();f.controller.contextChanged();
  expect(f.controller.freshIfStale()).toBe(false);expect(f.deps.createAiChat).toHaveBeenCalledOnce();
 });
 it('keeps a chat the reader chose from history or the credits page asked for',async()=>{
  const f=await ready();await f.controller.selectChat('c1');expect(f.controller.freshIfStale()).toBe(false);
  f.controller.contextChanged();await f.controller.openConversation('c1');expect(f.controller.freshIfStale()).toBe(false);
  expect(f.controller.getSnapshot().chat.id).toBe('c1');
 });
 it('never replaces a chat while an answer is running',async()=>{
  const f=await ready();f.setStreams({c1:{isPending:true,isStreaming:true,status:'streaming',sources:[]}});
  expect(f.controller.freshIfStale()).toBe(false);expect(f.controller.getSnapshot().chat.id).toBe('c1');
 });
});
