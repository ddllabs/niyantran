import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from './supabaseClient.js';
import * as research from './researchChat.js';
import { invalidateLocalSession, resumeLocalIdentityAfterSignIn } from './userStore.js';
import { clearStream, createTextCoalescer, readSseFrames, sendTurn, streamState } from './researchChat.js';

const auth = vi.hoisted(() => ({ id: 'owner-a', callback: null, expires: false, cancellation: null, writes: [] }));
vi.mock('./supabaseClient.js', () => ({
  functionsUrl: () => 'https://fake.invalid/research-chat', accessToken: async () => 'retained-token',
  supabase: {
    auth: {
      onAuthStateChange: fn => { auth.callback = fn; return {data:{subscription:{unsubscribe(){}}}}; },
      getSession: async () => ({data:{session:auth.id ? {access_token:`token-${auth.id}`, user:{id:auth.id}, expires_at:Date.now()/1000+(auth.expires?-1:3600)} : null}}),
      getUser: async () => ({data:{user:auth.id ? {id:auth.id,email:`${auth.id}@example.invalid`} : null}}),
    },
    rpc: async () => ({data:{user_id:auth.id,status:'active'}}),
    from: table => ({upsert: async row => {auth.writes.push({table,row});return auth.cancellation || {error:null};}}),
  },
}));
function switchAccount(id) { auth.id=id;auth.callback?.(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id}}:null); }
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const frame=value=>new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
beforeEach(async()=>{
 vi.stubGlobal('window',new EventTarget());vi.stubGlobal('sessionStorage',{getItem:()=>null,setItem(){},removeItem(){}});
 auth.expires=false;auth.cancellation=null;auth.writes=[];switchAccount('owner-a');
 await resumeLocalIdentityAfterSignIn({access_token:'token-owner-a',user:{id:'owner-a'},expires_at:Date.now()/1000+3600});
});
afterEach(()=>{switchAccount(null);vi.unstubAllGlobals();vi.restoreAllMocks();});

/** An SSE Response whose body arrives in awkward chunks. */
function sse(payloads, chunkSize = 9) {
  const text = payloads.map((p) => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
  return new Response(body, { status: 200 });
}

async function collect(gen) {
  const out = [];
  for await (const f of gen) out.push(f);
  return out;
}

/** Run every queued animation frame synchronously. */
function frameQueue() {
  const queue = [];
  return { schedule: (fn) => queue.push(fn), run: () => queue.splice(0).forEach((fn) => fn()), get length() { return queue.length; } };
}

describe('readSseFrames', () => {
  it('frames across chunk boundaries, skips malformed frames and ends on [DONE]', async () => {
    const got = await collect(readSseFrames(sse([{ conversation: { id: 'c1', title: 'T' } }, 'not json', { chunk: 'Hello' }, { done: { message_id: 'm1' } }], 5)));
    expect(got).toEqual([{ conversation: { id: 'c1', title: 'T' } }, { chunk: 'Hello' }, { done: { message_id: 'm1' } }]);
  });

  it('stops at [DONE] and ignores anything after it', async () => {
    const body = 'data: {"chunk":"a"}\n\ndata: [DONE]\n\ndata: {"chunk":"never"}\n\n';
    const got = await collect(readSseFrames(new Response(body)));
    expect(got).toEqual([{ chunk: 'a' }]);
  });

  it('a response with no body yields nothing', async () => {
    expect(await collect(readSseFrames({ body: null }))).toEqual([]);
  });
});

describe('createTextCoalescer', () => {
  it('commits once per frame however many deltas arrived', () => {
    const q = frameQueue();
    const commits = [];
    const c = createTextCoalescer((t) => commits.push(t), q.schedule);
    c.push('He');
    c.push('llo ');
    c.push('there');
    expect(commits).toEqual([]);
    q.run();
    expect(commits).toEqual(['Hello there']);
    c.push('!');
    q.run();
    expect(commits).toEqual(['Hello there', 'Hello there!']);
  });

  it('patch rewrites from an offset and flush commits immediately', () => {
    const q = frameQueue();
    const commits = [];
    const c = createTextCoalescer((t) => commits.push(t), q.schedule);
    c.push('It reached committee [7].');
    q.run();
    c.patch(21, '[1].');
    c.flush();
    expect(commits.at(-1)).toBe('It reached committee [1].');
    expect(c.text).toBe('It reached committee [1].');
  });
});

describe('sendTurn', () => {
  const body = { message: 'hi', turn_key: 't1', focus: 'broad' };
  beforeEach(() => clearStream('new'));
  afterEach(() => vi.restoreAllMocks());

  it('streams text into the state, records sources and follow-ups, and ends not streaming', async () => {
    const q = frameQueue();
    const send = () =>
      Promise.resolve(
        sse([
          { conversation: { id: 'conv-9', title: 'Bills' } },
          { reasoning: 'Looking at the desk rows.' },
          { tool: { name: 'search_desk_rows', phase: 'start', step: 1, input: { tier: 'national' } } },
          { tool: { name: 'search_desk_rows', phase: 'end', step: 1, resultCount: 20 } },
          { chunk: 'There are ' },
          { chunk: '**412** bills [1].' },
          { sources: [{ id: 1, kind: 'row', row_key: 'k', title: 'A bill' }] },
          { followUpQuestions: ['Which ministries introduced them?'] },
          { timing: { search_ms: 5, reasoning_ms: 1, writing_ms: 2, total_ms: 8 } },
          { done: { message_id: 'msg-3' } },
        ]),
      );
    const result = await sendTurn(body, { send, schedule: q.schedule });
    q.run();
    expect(result).toMatchObject({ conversationId: 'conv-9', messageId: 'msg-3' });
    const s = streamState('conv-9');
    expect(s.isStreaming).toBe(false);
    expect(s.streamingText).toBe('There are **412** bills [1].');
    expect(s.sources).toHaveLength(1);
    expect(s.followUps).toEqual(['Which ministries introduced them?']);
    expect(s.activity.filter((a) => a.type === 'activity')).toHaveLength(1);
    const tool = s.activity.find((a) => a.type === 'tool');
    expect(tool).toMatchObject({ step: 1, phase: 'end', resultCount: 20 });
    clearStream('conv-9');
  });

  it('a patch frame rewrites the streamed answer from its offset', async () => {
    const q = frameQueue();
    const send = () =>
      // The server patches from the first character that differs, as it does
      // when the ladder renumbers a marker the reader has already seen.
      Promise.resolve(sse([{ conversation: { id: 'c-p', title: 'T' } }, { chunk: 'Cited [7] here.' }, { patch: { from: 7, text: '1] here.' } }, { sources: [] }, { done: { message_id: 'm' } }]));
    await sendTurn({ ...body, conversation_id: undefined }, { send, schedule: q.schedule });
    q.run();
    expect(streamState('c-p').streamingText).toBe('Cited [1] here.');
    clearStream('c-p');
  });

  it('a complete terminal replay retains the duplicate marker and saved answer', async () => {
    const send = () => Promise.resolve(sse([{conversation:{id:'duplicate-c',title:'Replay'}},{ duplicate: true },{patch:{from:0,text:'Saved answer'}},{sources:[]},{done:{message_id:'saved'}}]));
    const r = await sendTurn(body, { send, schedule: frameQueue().schedule });
    expect(r.error).toBeFalsy();
    expect(streamState('new').isStreaming).toBe(false);
  });

  it('an error frame and a non-2xx response both land in the state', async () => {
    const send = () => Promise.resolve(sse([{ conversation: { id: 'c-e', title: 'T' } }, { error: 'the model could not be reached', code: 'error' }, { done: { message_id: 'failed-message' } }]));
    await sendTurn(body, { send, schedule: frameQueue().schedule });
    expect(streamState('c-e').error).toBe('the model could not be reached');
    clearStream('c-e');

    const refused = () => Promise.resolve(new Response(JSON.stringify({ error: 'unknown or disabled model' }), { status: 400 }));
    const r = await sendTurn(body, { send: refused, schedule: frameQueue().schedule });
    expect(r.error).toBe('unknown or disabled model');
  });

  it('a stream that goes silent is given up on rather than hanging the composer', async () => {
    const send = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('data: {"conversation":{"id":"c-s","title":"T"}}\n\n'));
              // and then nothing, ever
            },
          }),
          { status: 200 },
        ),
      );
    const r = await sendTurn(body, { send, schedule: frameQueue().schedule, timeoutMs: 20 });
    expect(r.aborted).toBe(true);
    expect(r.endReason).toBe('timeout');
    expect(streamState('c-s').isStreaming).toBe(false);
    expect(streamState('c-s').error).toMatch(/stopped arriving/);
    clearStream('c-s');
  });
});


describe('D7 ownership and durable outcomes',()=>{
 const body={message:'Question',turn_key:'original-key',focus:'broad',selection:{tier:'national',feature:'Bills',row:{title:'Bill'}},attachments:[{kind:'file',title:'Private input',text:'Exact input'}]};
 it('logout clears private state, aborts the reader and prevents late coalesced frames',async()=>{
  const q=frameQueue(); let wire;const started=deferred();let cancelled=0;
  const pending=sendTurn(body,{send:async()=>new Response(new ReadableStream({start(c){wire=c;c.enqueue(frame({conversation:{id:'a',title:'A'}}));c.enqueue(frame({chunk:'PRIVATE A'}));started.resolve();},cancel(){cancelled++;}})),schedule:q.schedule});
  await started.promise;await vi.waitFor(()=>expect(research.streamState('a').conversationId).toBe('a'));
  invalidateLocalSession();q.run();const result=await pending;
  expect(research.streamState('a').streamingText).toBe('');expect(research.streamState('new').streamingText).toBe('');expect(cancelled).toBe(1);expect(result.error).toBeTruthy();
 });
 it('first conversation keeps a draft alias and invokes the adoption callback before completion',async()=>{
  let wire;const observed=[];
  const pending=sendTurn(body,{send:async()=>new Response(new ReadableStream({start(c){wire=c;c.enqueue(frame({conversation:{id:'new-id',title:'New'}}));c.enqueue(frame({chunk:'Visible partial'}));}})),schedule:fn=>fn(),onConversation:c=>observed.push(c)});
  await vi.waitFor(()=>expect(streamState('new-id').streamingText).toBe('Visible partial'));
  expect(streamState('new')).toBe(streamState('new-id'));expect(observed).toEqual([{id:'new-id',title:'New'}]);
  wire.enqueue(frame({sources:[]}));wire.enqueue(frame({done:{message_id:'m'}}));wire.close();await pending;
 });
 it('an overlapping send cannot replace pending state or issue a second fetch',async()=>{
  let wire;const send=vi.fn(async()=>new Response(new ReadableStream({start:c=>{wire=c}})));
  const pending=sendTurn(body,{send});await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(1));
  const duplicate=await sendTurn({...body,turn_key:'paid-new-key'},{send});expect(send).toHaveBeenCalledTimes(1);expect(duplicate.errorCode).toBe('turn_pending');
  wire.close();await pending;
 });
 it.each(['eof','done-marker','duplicate-only','done-only'])('%s without durable terminal evidence remains unknown and blocks a new execution',async kind=>{
  const payload=kind==='eof'?new Response(frame({chunk:'partial'})):sse(kind==='duplicate-only'?[{duplicate:true}]:kind==='done-only'?[{done:{message_id:'x'}}]:[{chunk:'partial'}]);
  const send=vi.fn(async()=>payload);const result=await sendTurn(body,{send,schedule:fn=>fn()});
  expect(result.error).toBeTruthy();expect(streamState('new')).toMatchObject({status:'unknown',isPending:true,isStreaming:false});
  await sendTurn({...body,turn_key:'new-key'},{send});expect(send).toHaveBeenCalledTimes(1);
 });
 it('HTTP202 is running JSON and replays retain immutable request input and the original key',async()=>{
  const sent=[];const input=structuredClone(body);const send=vi.fn(async({body:b})=>{sent.push(structuredClone(b));return new Response(JSON.stringify({status:'running',conversation_id:'running-c',message_id:'reserved',execution_expires_at:new Date(Date.now()+60_000).toISOString()}),{status:202});});
  await sendTurn(input,{send});input.attachments[0].text='Changed caller copy';
  expect(streamState('running-c')).toMatchObject({status:'running',isPending:true,isStreaming:false});
  expect(typeof research.retryRequest).toBe('function');expect(typeof research.retryTurn).toBe('function');
  const copy=research.retryRequest('running-c');copy.selection.row.title='Changed returned copy';
  for(let i=0;i<4;i++)await research.retryTurn('running-c',{send});
  expect(send).toHaveBeenCalledTimes(5);expect(sent.every(b=>JSON.stringify(b)===JSON.stringify(body))).toBe(true);
  expect(streamState('running-c')).toMatchObject({isPending:true,retryable:true,retryCount:4});
 });
 it('retry bodies and callbacks are discarded on account changes while awaiting a response',async()=>{
  const response=deferred();const started=deferred();const callback=vi.fn();
  const pending=sendTurn(body,{send:async()=>{started.resolve();return response.promise;},onConversation:callback});await started.promise;
  switchAccount('owner-b');response.resolve(sse([{conversation:{id:'A-late',title:'A'}},{chunk:'private'},{sources:[]},{done:{message_id:'m'}}]));await pending;
  expect(callback).not.toHaveBeenCalled();expect(streamState('A-late').streamingText).toBe('');
  expect(research.retryRequest?.('new')).toBeNull();
 });
 it('Stop queues before the first conversation and successful writes mean requested, not cancelled',async()=>{
  let wire;const started=deferred();
  const pending=sendTurn(body,{send:async()=>new Response(new ReadableStream({start:c=>{wire=c;started.resolve();}}))});await started.promise;
  await research.stopTurn('new');expect(auth.writes).toEqual([]);
  wire.enqueue(frame({conversation:{id:'stop-c',title:'Stop'}}));await vi.waitFor(()=>expect(auth.writes).toHaveLength(1));
  expect(auth.writes[0].row).toMatchObject({conversation_id:'stop-c',user_id:'owner-a'});
  expect(streamState('stop-c')).toMatchObject({cancelRequested:true,isStreaming:true});
  wire.enqueue(frame({error:'Turn cancelled.',code:'cancelled'}));wire.enqueue(frame({done:{message_id:'cancelled-result'}}));wire.close();await pending;
  expect(streamState('stop-c')).toMatchObject({status:'cancelled',errorCode:'cancelled',isPending:false});
 });
 it('Stop errors remain visible and may be retried without aborting the reader',async()=>{
  auth.cancellation={error:{message:'write denied'}};let wire;const started=deferred();
  const pending=sendTurn({...body,conversation_id:'stop-failure'},{send:async()=>new Response(new ReadableStream({start:c=>{wire=c;c.enqueue(frame({conversation:{id:'stop-failure',title:'Stop'}}));started.resolve();}}))});await started.promise;
  await vi.waitFor(()=>expect(streamState('stop-failure').conversation).toBeDefined());
  await research.stopTurn('stop-failure');expect(streamState('stop-failure')).toMatchObject({cancelRequested:false,isStreaming:true});expect(streamState('stop-failure').cancelError).toBeTruthy();
  auth.cancellation=null;await research.stopTurn('stop-failure');expect(auth.writes).toHaveLength(2);expect(streamState('stop-failure').cancelRequested).toBe(true);
  wire.enqueue(frame({error:'Cancelled',code:'cancelled'}));wire.enqueue(frame({done:{message_id:'m'}}));wire.close();await pending;
 });
 it.each(['error','cancelled','interrupted','truncated'])('preserves saved %s status and its code',async status=>{
  const frames=[{conversation:{id:'saved-c',title:'Saved'}},{patch:{from:0,text:'Saved partial'}}];
  if(status==='truncated')frames.push({sources:[]},{truncated:{reason:'length',continuations:2}});else frames.push({error:'Saved error',code:status});
  frames.push({done:{message_id:'saved-id'}});await sendTurn(body,{send:async()=>sse(frames),schedule:fn=>fn()});
  expect(streamState('saved-c')).toMatchObject({status,isPending:false,messageId:'saved-id'});
  expect(streamState('saved-c').errorCode).toBe(status);
 });
 it.each([409,410])('HTTP%s keeps its durable rejection code and never offers automatic replay',async status=>{
  await sendTurn(body,{send:async()=>new Response(JSON.stringify({error:status===409?'turn_conflict':'turn_deleted',code:status===409?'turn_conflict':'turn_deleted'}),{status})});
  expect(streamState('new')).toMatchObject({errorCode:status===409?'turn_conflict':'turn_deleted',retryable:false,isPending:false});
 });
});


it('CRLF and split UTF-8 are decoded without losing the public frame',async()=>{
 const bytes=new TextEncoder().encode('data: {"chunk":"विधेयक 📄"}\r\n\r\ndata: [DONE]\r\n\r\n');let i=0;
 const response=new Response(new ReadableStream({pull(c){if(i===bytes.length)c.close();else c.enqueue(bytes.slice(i,++i));}}));
 expect(await collect(readSseFrames(response))).toEqual([{chunk:'विधेयक 📄'}]);
});
it('flushed or disposed coalescers cannot publish a queued callback again',()=>{
 const q=frameQueue();const commit=vi.fn();const c=createTextCoalescer(commit,q.schedule);c.push('one');c.flush();q.run();expect(commit).toHaveBeenCalledTimes(1);
 c.push('two');c.dispose();q.run();expect(commit).toHaveBeenCalledTimes(1);
});
it('a response arriving after account invalidation is cancelled even if fetch ignored abort',async()=>{
 const response=deferred();const started=deferred();let cancelled=0;
 const pending=sendTurn({message:'A',turn_key:'late-body',focus:'broad'},{send:async()=>{started.resolve();return response.promise;}});await started.promise;
 switchAccount('owner-b');await pending;
 response.resolve(new Response(new ReadableStream({cancel(){cancelled++;}})));
 await vi.waitFor(()=>expect(cancelled).toBe(1));
});
it('manual replay is single-flight even during its initial identity verification',async()=>{
 const running=()=>new Response(JSON.stringify({status:'running',conversation_id:'single',message_id:'m',execution_expires_at:new Date(Date.now()+60_000).toISOString()}),{status:202});
 const body={message:'Question',turn_key:'single-key',focus:'broad'};await sendTurn(body,{send:async()=>running()});
 const send=vi.fn(async()=>running());const first=research.retryTurn('single',{send});const second=research.retryTurn('single',{send});await Promise.all([first,second]);
 expect(send).toHaveBeenCalledTimes(1);expect(streamState('single').retryCount).toBe(1);
});
it('clearStream detaches without erasing the pending execution lock or claiming Stop',async()=>{
 let wire;const started=deferred();const send=vi.fn(async()=>new Response(new ReadableStream({start:c=>{wire=c;started.resolve();}})));
 const body={message:'Question',turn_key:'clear-key',focus:'broad'};const pending=sendTurn(body,{send});await started.promise;clearStream('new');await pending;
 expect(streamState('new')).toMatchObject({isPending:true,status:'unknown'});expect(auth.writes).toEqual([]);
 await sendTurn({...body,turn_key:'new-paid-key'},{send});expect(send).toHaveBeenCalledTimes(1);
});
it('saveFailed plus done does not report a durable successful answer',async()=>{
 await sendTurn({message:'Question',turn_key:'save-key',focus:'broad'},{send:async()=>sse([{conversation:{id:'save-c'}},{chunk:'Visible'},{sources:[]},{saveFailed:{detail:'failed'}},{done:{message_id:'m'}}]),schedule:fn=>fn()});
 expect(streamState('save-c')).toMatchObject({isPending:true,status:'unknown',errorCode:'save_failed'});
});
it('silence aborts an uncooperative fetch and retains unknown status without issuing cancellation',async()=>{
 const pending=sendTurn({message:'Question',turn_key:'silent-fetch',focus:'broad'},{send:()=>new Promise(()=>{}),timeoutMs:15});
 await pending;expect(streamState('new')).toMatchObject({status:'unknown',isPending:true,isStreaming:false});expect(auth.writes).toEqual([]);
});
it('an authoritative running expiry permits an explicit new turn, without auto-sending one',async()=>{
 const expiry=Date.now()+1000;const send=vi.fn(async()=>new Response(JSON.stringify({status:'running',conversation_id:'expired-c',message_id:'m',execution_expires_at:new Date(expiry).toISOString()}),{status:202}));
 await sendTurn({message:'Question',turn_key:'expires-key',focus:'broad'},{send});const clock=vi.spyOn(Date,'now').mockReturnValue(expiry+1);
 expect(streamState('expired-c')).toMatchObject({status:'interrupted',isPending:false});expect(send).toHaveBeenCalledTimes(1);clock.mockRestore();
});

it('a Stop awaiting identity verification cannot write after terminal completion',async()=>{
 let wire;const ready=deferred();const pending=sendTurn({conversation_id:'stop-race',message:'Question',turn_key:'stop-race-key',focus:'broad'},{send:async()=>new Response(new ReadableStream({start(c){wire=c;c.enqueue(frame({conversation:{id:'stop-race'}}));ready.resolve();}})),schedule:fn=>fn()});
 await ready.promise;await vi.waitFor(()=>expect(streamState('stop-race').conversation).toBeDefined());
 const verification=deferred();const started=deferred();vi.spyOn(supabase,'rpc').mockImplementationOnce(()=>{started.resolve();return verification.promise;});
 const stop=research.stopTurn('stop-race');await started.promise;
 wire.enqueue(frame({chunk:'Completed answer'}));wire.enqueue(frame({sources:[]}));wire.enqueue(frame({done:{message_id:'finished'}}));wire.close();await pending;
 verification.resolve({data:{user_id:'owner-a',status:'active'}});await stop;
 expect(auth.writes).toEqual([]);expect(streamState('stop-race').status).toBe('complete');
});
it('a late same-owner coalesced commit cannot overwrite the final patch',async()=>{
 let wire;const q=frameQueue();const pending=sendTurn({message:'Question',turn_key:'coalesced-race',focus:'broad'},{send:async()=>new Response(new ReadableStream({start(c){wire=c;c.enqueue(frame({conversation:{id:'coalesced-c'}}));c.enqueue(frame({chunk:'Old text'}));}})),schedule:q.schedule});
 await vi.waitFor(()=>expect(q.length).toBe(1));const old=deferred();vi.spyOn(supabase.auth,'getSession').mockImplementationOnce(()=>old.promise);q.run();
 wire.enqueue(frame({patch:{from:0,text:'Final text'}}));wire.enqueue(frame({sources:[]}));wire.enqueue(frame({done:{message_id:'m'}}));wire.close();await pending;
 expect(streamState('coalesced-c').streamingText).toBe('Final text');
 old.resolve({data:{session:{access_token:'token-owner-a',user:{id:'owner-a'},expires_at:Date.now()/1000+3600}}});await new Promise(r=>setTimeout(r,0));
 expect(streamState('coalesced-c').streamingText).toBe('Final text');
});
it('an errored SSE body releases its reader lock',async()=>{
 const response=new Response(new ReadableStream({start(c){c.error(Error('broken'));}}));
 await expect(collect(readSseFrames(response))).rejects.toThrow('broken');expect(response.body.locked).toBe(false);
});

it('more than three manual unknown-outcome replays can still recover the original execution',async()=>{
 const body={message:'Original',turn_key:'unchanged-key',focus:'broad',attachments:[{text:'Private'}]};const sent=[];
 const unknown=async({body:b})=>{sent.push(b);return new Response(null,{status:503});};
 await sendTurn(body,{send:unknown});
 for(let i=0;i<5;i++)await research.retryTurn('new',{send:unknown});
 expect(streamState('new')).toMatchObject({status:'unknown',isPending:true,retryable:true,retryCount:5});
 await research.retryTurn('new',{send:async({body:b})=>{sent.push(b);return sse([{conversation:{id:'recovered'}},{chunk:'Saved answer'},{sources:[]},{done:{message_id:'original-message'}}]);},schedule:fn=>fn()});
 expect(sent).toHaveLength(7);expect(sent.every(b=>JSON.stringify(b)===JSON.stringify(body))).toBe(true);
 expect(streamState('recovered')).toMatchObject({status:'complete',isPending:false,messageId:'original-message'});
});
it('Stop during initial verification queues without writing until a verified conversation exists',async()=>{
 let wire;const send=vi.fn(async()=>new Response(new ReadableStream({start(c){wire=c;}})));
 const pending=sendTurn({message:'Question',turn_key:'early-stop',focus:'broad'},{send});
 expect(await research.stopTurn('new')).toMatchObject({queued:true,cancelRequested:false});expect(auth.writes).toEqual([]);
 await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(1));wire.enqueue(frame({conversation:{id:'early-stop-c'}}));
 await vi.waitFor(()=>expect(auth.writes).toHaveLength(1));expect(auth.writes[0].row.user_id).toBe('owner-a');
 wire.enqueue(frame({error:'Cancelled',code:'cancelled'}));wire.enqueue(frame({done:{message_id:'m'}}));wire.close();await pending;
});
it('a conflict rejects this intent and permits only an explicit new submission',async()=>{
 const send=vi.fn(async()=>new Response(JSON.stringify({error:'Conflicting intent',code:'turn_conflict'}),{status:409}));
 await sendTurn({message:'Conflicting',turn_key:'old-key',focus:'broad'},{send});
 expect(streamState('new')).toMatchObject({errorCode:'turn_conflict',isPending:false,retryable:false});
 await research.retryTurn('new',{send});expect(send).toHaveBeenCalledTimes(1);
 await sendTurn({message:'Explicit new request',turn_key:'new-key',focus:'broad'},{send});expect(send).toHaveBeenCalledTimes(2);
});

it('review: confirmed saved terminal survives a later transport error', async () => {
 let wire;
 const pending=sendTurn({message:'Question',turn_key:'confirmed-terminal'},{send:async()=>new Response(new ReadableStream({start(c){wire=c;for(const f of [{conversation:{id:'terminal-c'}},{chunk:'Saved answer'},{sources:[]},{done:{message_id:'saved-m'}}])c.enqueue(frame(f));}})),schedule:fn=>fn()});
 await vi.waitFor(()=>expect(streamState('terminal-c').status).toBe('complete'));
 expect(streamState('terminal-c').status).toBe('complete');
 wire.error(Error('network close after saved result'));
 await pending;
 expect(streamState('terminal-c')).toMatchObject({status:'complete',isPending:false,retryable:false,messageId:'saved-m'});
});
it('review: timeout still settles when a frame identity check never resolves', async()=>{
 let wire;
 const pending=sendTurn({message:'Question',turn_key:'blocked-recheck'},{send:async()=>new Response(new ReadableStream({start(c){wire=c;c.enqueue(frame({conversation:{id:'blocked-c'}}));}})),timeoutMs:30,schedule:fn=>fn()});
 await vi.waitFor(()=>expect(streamState('blocked-c').conversationId).toBe('blocked-c'),{interval:1});
 const gate=deferred();vi.spyOn(supabase.auth,'getSession').mockImplementationOnce(()=>gate.promise);
 wire.enqueue(frame({chunk:'Some text'}));
 const outcome=await Promise.race([pending.then(()=> 'settled'),new Promise(r=>setTimeout(()=>r('hung'),100))]);
 gate.resolve({data:{session:{access_token:'token-owner-a',user:{id:'owner-a'},expires_at:Date.now()/1000+3600}}});
 await pending;
 expect(outcome).toBe('settled');
});

it('review: a stalled identity check publishes no queued private frame and remains replayable after timeout',async()=>{
 let wire;const q=frameQueue();const pending=sendTurn({message:'Question',turn_key:'blocked-publish'},{send:async()=>new Response(new ReadableStream({start(c){wire=c;c.enqueue(frame({conversation:{id:'publish-c'}}));}})),timeoutMs:30,schedule:q.schedule});
 await vi.waitFor(()=>expect(streamState('publish-c').conversationId).toBe('publish-c'),{interval:1});
 wire.enqueue(frame({chunk:'UNVERIFIED PRIVATE FRAME'}));await vi.waitFor(()=>expect(q.length).toBe(1),{interval:1});
 const gate=deferred();vi.spyOn(supabase.auth,'getSession').mockImplementation(()=>gate.promise);q.run();
 await pending;expect(streamState('publish-c')).toMatchObject({streamingText:'',isStreaming:false,isPending:true,status:'unknown',retryable:true});
 expect(research.retryRequest('publish-c').turn_key).toBe('blocked-publish');
 gate.resolve({data:{session:{access_token:'token-owner-a',user:{id:'owner-a'},expires_at:Date.now()/1000+3600}}});
 await new Promise(r=>setTimeout(r,0));expect(streamState('publish-c').streamingText).toBe('');
 vi.restoreAllMocks();await research.retryTurn('publish-c',{send:async()=>sse([{conversation:{id:'publish-c'}},{chunk:'Saved'},{sources:[]},{done:{message_id:'saved'}}]),schedule:fn=>fn()});
 expect(streamState('publish-c')).toMatchObject({status:'complete',isPending:false});
});
it('review: a hanging reader cancellation cannot hold a confirmed terminal operation open',async()=>{
 const pending=sendTurn({message:'Question',turn_key:'cancel-cleanup'},{send:async()=>new Response(new ReadableStream({start(c){for(const f of [{conversation:{id:'cleanup-c'}},{chunk:'Saved'},{sources:[]},{done:{message_id:'m'}}])c.enqueue(frame(f));},cancel(){return new Promise(()=>{});}})),schedule:fn=>fn(),timeoutMs:30});
 expect(await Promise.race([pending.then(()=>true),new Promise(r=>setTimeout(()=>r(false),100))])).toBe(true);
 expect(streamState('cleanup-c')).toMatchObject({status:'complete',isStreaming:false,isPending:false});
});
