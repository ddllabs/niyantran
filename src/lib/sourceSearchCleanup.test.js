import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
const realRead = fs.readFileSync.bind(fs);
const inventory = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(realRead(new URL('../../docs/research/2026-10-17-unused-search-inventory.md', import.meta.url), 'utf8'))[1]);
const registry = JSON.parse(realRead(new URL('../data/source-registry.json',import.meta.url),'utf8'));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();vi.resetModules();});
it('removes only inventoried duplicate fields while retaining the canonical source', () => {
  const features=JSON.parse(realRead(new URL('../data/html-feature-map.json',import.meta.url),'utf8'));
  for(const entry of inventory){
    const f=features.find(f=>`${f.htmlTier}:${f.htmlFeature}`===entry.id);
    expect(f).not.toHaveProperty('source');
    expect(registry.find(r=>r.key===entry.registryKey)).toMatchObject({primaryFeedUrl:entry.old,sourceUrls:entry.old});
  }
});
it('duplicate removal preserves every inventoried module request, answer and provenance', async () => {
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  const run=async restoreDuplicates=>{
    const calls=[];
    vi.stubGlobal('fetch',vi.fn(async input=>{calls.push(String(input));return new Response('',{status:404});}));
    vi.spyOn(fs,'readFileSync').mockImplementation((file,...rest)=>{
      const text=realRead(file,...rest);
      if(!String(file).endsWith('html-feature-map.json')||!restoreDuplicates)return text;
      return JSON.stringify(JSON.parse(text).map(f=>{
        const old=inventory.find(x=>x.id===`${f.htmlTier}:${f.htmlFeature}`);
        return old?{...f,source:old.old}:f;
      }));
    });
    const {serveFeatureFeed,resetFeedCache}=await import('../../server/featureFeed.mjs');
    const results=[];
    for(const entry of inventory){
      resetFeedCache();calls.length=0;
      const [tier,feature]=entry.id.split(/:(.*)/s);
      const body=await serveFeatureFeed(new URLSearchParams({tier,feature}));
      results.push({id:entry.id,calls:[...calls],digest:createHash('sha256').update(JSON.stringify(body)).digest('hex')});
    }
    vi.restoreAllMocks();vi.resetModules();return results;
  };
  expect(await run(false)).toEqual(await run(true));
},30000);
