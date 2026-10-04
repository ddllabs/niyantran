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
