import { expect, it, vi } from 'vitest';
import { navigationMatches, recordMatches } from './commandSearch.js';
const tabs = [{id:'national',tier:'national',label:'National'}];
const modules = [{htmlTier:'national',htmlFeature:'Bill Passage',bucket:'Legislation'}, {htmlTier:'judiciary',htmlFeature:'Bill Court',bucket:'Law'}];
it('groups desk and module matches and excludes inaccessible destinations',()=>{
 expect(navigationMatches('national', tabs, modules).map(x=>x.kind)).toEqual(['desk','module']);
 expect(navigationMatches('bill',tabs,modules).map(x=>x.title)).toEqual(['Bill Passage']);
});
it('uses caller RPC, cancellation, accessible tiers and labels exact record destination',async()=>{
 const signal = new AbortController().signal;
 const abortSignal = vi.fn(async()=>({data:[{tier:'national',feature:'Bill Passage',row_key:'b',row:{bill_name:'Anti-Doping'},snapshot_at:'2026-10-04'}],error:null}));
 const client = {rpc:vi.fn(()=>({abortSignal}))};
 const hits=await recordMatches('doping',tabs,modules,signal,client);
 expect(client.rpc).toHaveBeenCalledWith('search_desk_rows', expect.objectContaining({p_tier:'national',p_query:'doping'}));
 expect(abortSignal).toHaveBeenCalledWith(signal);
 expect(hits[0]).toMatchObject({kind:'record',title:'Anti-Doping',tab:'national',feature:'Bill Passage',row_key:'b'});
});
it('does not silently report a failed record lookup as no results',async()=>{
 const client={rpc:()=>({abortSignal:async()=>({data:null,error:{message:'network'}})})};
 await expect(recordMatches('bill',tabs,modules,new AbortController().signal,client)).rejects.toThrow(/Record search/);
});

// F134: a record result is dragged into AI research as the row the search returned.
it('keeps the row (and its document key) on a record hit so it can be dragged into AI',async()=>{
 const row = {bill_name:'Anti-Doping',status:'Passed'};
 const client = {rpc:vi.fn(()=>({abortSignal:async()=>({data:[{tier:'national',feature:'Bill Passage',row_key:'b',row,document_key:'doc-1',snapshot_at:'2026-10-04'}],error:null})}))};
 const [hit]=await recordMatches('doping',tabs,modules,new AbortController().signal,client);
 expect(hit.row).toEqual(row);
 expect(hit.document_key).toBe('doc-1');
});
it('gives a module hit its catalogue tier so a dragged module can load its feed',()=>{
 const [, module]=navigationMatches('national',tabs,modules);
 expect(module).toMatchObject({kind:'module',tab:'national',tier:'national',feature:'Bill Passage'});
});
it('preserves successful desks when another desk fails',async()=>{
 const two=[...tabs,{id:'state',tier:'local',label:'State'}];
 const client={rpc:(_name,args)=>({abortSignal:async()=>args.p_tier==='state'?{error:{message:'down'}}:{data:[{tier:'national',feature:'Bill Passage',row_key:'b',row:{title:'Bill'}}]}})};
 const found=await recordMatches('bill',two,modules,new AbortController().signal,client);
 expect(found).toHaveLength(1); expect(found.coverage.failed).toEqual(['State']);
});
it('does not lose later desks to a global first-sixteen cutoff',async()=>{
 const many=Array.from({length:8},(_,i)=>({id:`d${i}`,tier:`d${i}`,label:`Desk ${i}`}));
 const mods=many.map(t=>({htmlTier:t.tier,htmlFeature:'Records',bucket:'Section'}));
 const client={rpc:(_name,args)=>({abortSignal:async()=>({data:Array.from({length:8},(_,i)=>({tier:args.p_tier,feature:'Records',row_key:String(i),row:{title:'Article '+i},total:100}))})})};
 const found=await recordMatches('article',many,mods,new AbortController().signal,client);
 expect(new Set(found.map(h=>h.tab)).size).toBe(8);
 expect(found.coverage.truncated).toBe(true);
});
