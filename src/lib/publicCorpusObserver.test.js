import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ rpc: vi.fn(), auth: null }));
vi.mock('./supabaseClient.js', () => ({ supabase: {
  rpc: db.rpc,
  auth: { onAuthStateChange: callback => { db.auth = callback; return { data: { subscription: {} } }; } },
} }));
import { COVERAGE_TTL_MS, corpusCapabilityPending, indexedDocumentKeys, observeCoverage, publicCorpusCapability, refreshCoverage, resetCoverageCache } from './corpusCoverage.js';
const key = n => `desk-record:["national","Questions","${n}"]`;
const result = keys => ({ data: keys.map(document_key => ({ document_key, document_id: 'ready', coverage: 'full' })), error: null });
let stops = [];
let releaseTransports = [];
beforeEach(() => { vi.useFakeTimers(); resetCoverageCache(); db.rpc.mockReset(); releaseTransports=[]; });
afterEach(async () => {
 for (const stop of stops) stop?.(); stops=[];
 resetCoverageCache();
 for(const release of releaseTransports) release();
 await vi.advanceTimersByTimeAsync(0);
 vi.useRealTimers();
});
const observe = keys => { const stop = observeCoverage(keys); stops.push(stop); return stop; };

it('F264 mounts share deduplicated 24-key batches with at most two concurrent requests', async () => {
  let active = 0; let max = 0;
  db.rpc.mockImplementation(async (_rpc, { p_keys }) => {
    active += 1; max = Math.max(max, active);
    await Promise.resolve(); active -= 1;
    return result(p_keys);
  });
  for (let i = 0; i < 100; i += 1) observe([key(i)]);
  observe([key(1), key(2)]);
  await vi.advanceTimersByTimeAsync(0);
  expect(db.rpc).toHaveBeenCalledTimes(5);
  expect(db.rpc.mock.calls.every(([, request]) => request.p_keys.length <= 24)).toBe(true);
  expect(db.rpc.mock.calls.flatMap(([, request]) => request.p_keys)).toHaveLength(100);
  expect(max).toBe(2);
});

it('F264 overlapping observers during pending work do not duplicate RPCs or spin timers', async () => {
  let finish;
  db.rpc.mockImplementation((_rpc, { p_keys }) => new Promise(resolve => { finish = () => resolve(result(p_keys)); }));
  observe([key(1)]);
  await vi.advanceTimersByTimeAsync(0);
  observe([key(1)]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(db.rpc).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1); // Only the bounded transport deadline; no polling timer.
  finish(); await vi.advanceTimersByTimeAsync(0);
  expect(publicCorpusCapability({ document_key: key(1) })).toBe('full');
  // Expiry is measured from request start, not the delayed response.
  await vi.advanceTimersByTimeAsync(COVERAGE_TTL_MS - 5000);
  expect(publicCorpusCapability({ document_key: key(1) })).toBe('record');
  expect(db.rpc).toHaveBeenCalledTimes(2);
  finish(); await vi.advanceTimersByTimeAsync(0);
});

it('F264 auth invalidation exists before the first observer and blocks earlier-session replies', async () => {
  let finish;
  db.rpc.mockImplementationOnce((_rpc, { p_keys }) => new Promise(resolve => { finish = () => resolve(result(p_keys)); }));
  const first = refreshCoverage([key(1)]);
  expect(db.auth).toBeTypeOf('function');
  db.auth('SIGNED_OUT', null);
  finish(); await first;
  expect(publicCorpusCapability({ document_key: key(1) })).toBe('record');
  db.rpc.mockImplementation(async (_rpc, { p_keys }) => result(p_keys));
  observe([key(1)]); await vi.advanceTimersByTimeAsync(0);
  expect(publicCorpusCapability({ document_key: key(1) })).toBe('full');
  db.auth('SIGNED_IN', { user: { id: 'other' } });
  expect(publicCorpusCapability({ document_key: key(1) })).toBe('record');
});

it('F264 unmounting all records removes polling; remounting fresh records reuses evidence', async () => {
  db.rpc.mockImplementation(async (_rpc, { p_keys }) => result(p_keys));
  const stop = observe([key(1)]);
  await vi.advanceTimersByTimeAsync(0); stop();
  expect(vi.getTimerCount()).toBe(0);
  observe([key(1)]); await vi.advanceTimersByTimeAsync(0);
  expect(db.rpc).toHaveBeenCalledTimes(1);
});

it('F264 direct lookup, refresh and badge observers share the same in-flight request', async () => {
 let finish;
 db.rpc.mockImplementation((_rpc,{p_keys})=>new Promise(resolve=>{finish=()=>resolve(result(p_keys));}));
 const refresh=refreshCoverage([key(1)]);
 const read=indexedDocumentKeys([key(1)]);
 observe([key(1)]); await vi.advanceTimersByTimeAsync(0);
 expect(db.rpc).toHaveBeenCalledTimes(1);
 finish(); await Promise.all([refresh,read]); await vi.advanceTimersByTimeAsync(0);
 expect(publicCorpusCapability({document_key:key(1)})).toBe('full');
});

it('F264 disjoint viewport mounts share a global two-RPC limit while previous batches are pending',async()=>{
 let active=0; let max=0; const finishes=[];
 db.rpc.mockImplementation((_rpc,{p_keys})=>new Promise(resolve=>{
  active+=1; max=Math.max(max,active);
  finishes.push(()=>{active-=1;resolve(result(p_keys));});
 }));
 observe(Array.from({length:48},(_,i)=>key(i)));
 await vi.advanceTimersByTimeAsync(0);
 expect(active).toBe(2);
 observe(Array.from({length:48},(_,i)=>key(i+48)));
 await vi.advanceTimersByTimeAsync(0);
 expect(max).toBe(2);
 while(finishes.length) { finishes.shift()(); await vi.advanceTimersByTimeAsync(0); }
 expect(db.rpc).toHaveBeenCalledTimes(4);
 expect(max).toBe(2);
});

it('F264 queued observer keys are filtered on unmount and can be requested again immediately',async()=>{
 const finishes=[];
 db.rpc.mockImplementation((_rpc,{p_keys})=>new Promise(resolve=>{finishes.push(()=>resolve(result(p_keys)));}));
 const occupying=refreshCoverage(Array.from({length:48},(_,i)=>key(i)));
 const stop=observe([key(100)]); await vi.advanceTimersByTimeAsync(0);
 expect(db.rpc).toHaveBeenCalledTimes(2);
 stop();
 while(finishes.length) {finishes.shift()();await vi.advanceTimersByTimeAsync(0);}
 await occupying;
 expect(db.rpc).toHaveBeenCalledTimes(2);
 observe([key(100)]); await vi.advanceTimersByTimeAsync(0);
 expect(db.rpc).toHaveBeenCalledTimes(3);
 finishes.shift()(); await vi.advanceTimersByTimeAsync(0);
 expect(publicCorpusCapability({document_key:key(100)})).toBe('full');
});

it('F264 caller changes discard queued earlier-session batches while current-session observers recover',async()=>{
 const finishes=[];
 db.rpc.mockImplementation((_rpc,{p_keys})=>new Promise(resolve=>{finishes.push(()=>resolve(result(p_keys)));}));
 const occupying=refreshCoverage(Array.from({length:48},(_,i)=>key(i)));
 observe([key(100)]); await vi.advanceTimersByTimeAsync(0);
 expect(db.rpc).toHaveBeenCalledTimes(2);
 db.auth('SIGNED_IN',{user:{id:'new-caller'}}); await vi.advanceTimersByTimeAsync(0);
 expect(db.rpc).toHaveBeenCalledTimes(3); // Aborting old transports immediately frees current-caller slots.
 while(finishes.length) {finishes.shift()();await vi.advanceTimersByTimeAsync(0);}
 await occupying;
 expect(db.rpc).toHaveBeenCalledTimes(3);
 expect(db.rpc.mock.calls[2][1].p_keys).toEqual([key(100)]);
 expect(publicCorpusCapability({document_key:key(0)})).toBe('record');
 expect(publicCorpusCapability({document_key:key(100)})).toBe('full');
});

it('F264 a direct reader keeps its coalesced queued key after the originating badge unmounts',async()=>{
 const finishes=[];
 db.rpc.mockImplementation((_rpc,{p_keys})=>new Promise(resolve=>{finishes.push(()=>resolve(result(p_keys)));}));
 const occupying=refreshCoverage(Array.from({length:48},(_,i)=>key(i)));
 const stop=observe([key(100)]); await vi.advanceTimersByTimeAsync(0);
 const read=indexedDocumentKeys([key(100)]); stop();
 while(finishes.length) {finishes.shift()();await vi.advanceTimersByTimeAsync(0);}
 await occupying;
 expect(await read).toEqual(new Set([key(100)]));
 expect(db.rpc).toHaveBeenCalledTimes(3);
});

function abortableTransport(readyKey) {
 const transport={active:0,max:0,aborted:[],finishes:[]};
 releaseTransports.push(()=>{for(const finish of transport.finishes)finish();});
 db.rpc.mockImplementation((_rpc,{p_keys})=>{
  let signal;let promise;
  const start=()=>promise ||= new Promise((resolve,reject)=>{
   if(signal?.aborted){reject(new DOMException('Aborted','AbortError'));return;}
   let settled=false;
   transport.active+=1;transport.max=Math.max(transport.max,transport.active);
   const finish=(error)=>{
    if(settled)return;settled=true;transport.active-=1;
    signal?.removeEventListener('abort',abort);
    if(error)reject(error);else resolve(result(p_keys));
   };
   const abort=()=>{transport.aborted.push(...p_keys);finish(new DOMException('Aborted','AbortError'));};
   signal?.addEventListener('abort',abort,{once:true});
   transport.finishes.push(()=>finish());
   if(p_keys.includes(readyKey))queueMicrotask(()=>finish());
  });
  return {abortSignal(next){signal=next;return this;},then(resolve,reject){return start().then(resolve,reject);}};
 });
 return transport;
}

it('F264 two hung old-caller transports are physically aborted before the new caller can acquire slots',async()=>{
 const transport=abortableTransport(key(100));
 const old=refreshCoverage(Array.from({length:48},(_,i)=>key(i)));
 await vi.advanceTimersByTimeAsync(0);
 expect(transport.active).toBe(2);
 db.auth('SIGNED_IN',{user:{id:'next-caller'}});
 const current=indexedDocumentKeys([key(100)]);
 await vi.advanceTimersByTimeAsync(0);
 expect(transport.aborted).toHaveLength(48);
 expect(await current).toEqual(new Set([key(100)]));
 expect(await old).toEqual(new Set());
 expect(transport.max).toBe(2);expect(transport.active).toBe(0);
});

it('F264 hung transports time out once and release slots for a queued direct reader',async()=>{
 const transport=abortableTransport(key(100));
 const old=refreshCoverage(Array.from({length:48},(_,i)=>key(i)));
 const current=indexedDocumentKeys([key(100)]);
 await vi.advanceTimersByTimeAsync(14_999);
 expect(db.rpc).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(1);
 expect(transport.aborted).toHaveLength(48);
 expect(await current).toEqual(new Set([key(100)]));
 expect(await old).toEqual(new Set());
 expect(transport.aborted).toHaveLength(48);
 expect(transport.max).toBe(2);expect(transport.active).toBe(0);
 expect(db.rpc).toHaveBeenCalledTimes(3);
});

it('F264 a coalesced direct reader waits for a newer same-caller refresh instead of returning false absence',async()=>{
 const finishes=[];
 releaseTransports.push(()=>{for(const finish of finishes)finish();});
 db.rpc.mockImplementation((_rpc,{p_keys})=>new Promise(resolve=>{finishes.push(()=>resolve(result(p_keys)));}));
 const old=indexedDocumentKeys([key(1)]);
 const read=indexedDocumentKeys([key(1)]);
 const newer=refreshCoverage([key(1)]);
 let settled=false;read.then(()=>{settled=true;});
 finishes.shift()();await vi.advanceTimersByTimeAsync(0);
 expect(settled).toBe(false);
 finishes.shift()();await vi.advanceTimersByTimeAsync(0);
 expect(await read).toEqual(new Set([key(1)]));
 await Promise.all([old,newer]);
});

it('F264 superseding refreshes cannot extend a direct read past its original deadline',async()=>{
 const transport=abortableTransport(key(100));
 const read=indexedDocumentKeys([key(1)]);
 await vi.advanceTimersByTimeAsync(1);
 const newer=refreshCoverage([key(1)]);
 transport.finishes[0]();await vi.advanceTimersByTimeAsync(0);
 let settled=false;read.then(()=>{settled=true;});
 await vi.advanceTimersByTimeAsync(14_999);
 expect(settled).toBe(true);
 expect(await read).toEqual(new Set());
 expect(publicCorpusCapability({document_key:key(1)})).toBe('record');
 await vi.advanceTimersByTimeAsync(1);await newer;
 expect(transport.max).toBeLessThanOrEqual(2);expect(transport.active).toBe(0);
 expect(db.rpc).toHaveBeenCalledTimes(2);
});

it('F264 a completed replacement releases direct readers while the obsolete predecessor stays hung',async()=>{
 const finishes=[];
 releaseTransports.push(()=>{for(const finish of finishes)finish();});
 db.rpc.mockImplementation((_rpc,{p_keys})=>new Promise(resolve=>{finishes.push(()=>resolve(result(p_keys)));}));
 const old=indexedDocumentKeys([key(1)]);
 const read=indexedDocumentKeys([key(1)]);
 const newer=refreshCoverage([key(1)]);
 let settled=false;read.then(()=>{settled=true;});
 finishes[1]();await vi.advanceTimersByTimeAsync(0);
 expect(settled).toBe(true);
 expect(await read).toEqual(new Set([key(1)]));
 expect(await old).toEqual(new Set([key(1)]));
 await newer;
 finishes[0]();await vi.advanceTimersByTimeAsync(0);
 expect(publicCorpusCapability({document_key:key(1)})).toBe('full');
});

it('F270 an observed record leaves the pending state once its lookup answers or fails', async () => {
 const chip = { kind: 'row', document_key: key(1) };
 db.rpc.mockResolvedValueOnce(result([key(1)]));
 observe([key(1)]);
 expect(corpusCapabilityPending(chip)).toBe(true);
 await vi.advanceTimersByTimeAsync(0);
 expect(corpusCapabilityPending(chip)).toBe(false);
 expect(publicCorpusCapability(chip)).toBe('full');
 const failed = { kind: 'row', document_key: key(2) };
 db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
 observe([key(2)]);
 await vi.advanceTimersByTimeAsync(0);
 expect(corpusCapabilityPending(failed)).toBe(false);
 expect(publicCorpusCapability(failed)).toBe('record');
});
