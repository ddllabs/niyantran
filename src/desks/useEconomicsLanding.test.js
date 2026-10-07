import { describe, it, expect } from 'vitest';
import { loadEconomicsSummaries } from './useEconomicsLanding.js';
import { ECONOMICS_PRESENTATION } from './landing/economicsPresentation.js';
const features = ECONOMICS_PRESENTATION.groups.flatMap(group => group.modules.map(module => module.feature));
describe('Economics summary loading', () => {
  it('bounds requests and distinguishes zero, unavailable, provider errors and malformed data', async () => {
    let active = 0, peak = 0; const shown = [];
    await loadEconomicsSummaries({features, onSummary:summary=>shown.push(summary), fetcher:async url=>{
      active++; peak=Math.max(peak,active); await new Promise(resolve=>setTimeout(resolve,2)); active--;
      const feature=new URL(url,'http://localhost').searchParams.get('feature');
      const unavailable=feature==='Election Forecast Aggregator';
      if(feature===features[1]) throw new Error('offline');
      return {ok:true,json:async()=>({ok:true,version:1,feature,resourceKey:feature,count:unavailable?null:0,availability:unavailable?'unavailable':'empty',sourceMode:'unknown'})};
    }});
    expect(peak).toBe(3); expect(shown).toHaveLength(11);
    expect(shown.find(s=>s.feature===features[0]).count).toBe(0);
    expect(shown.find(s=>s.feature===features[1]).availability).toBe('error');
    expect(shown.find(s=>s.feature==='Election Forecast Aggregator').availability).toBe('unavailable');
  });
  it('retains useful validated 502 coverage but rejects wrong identities and false counts', async () => {
    const feature=features[0], body={ok:false,version:1,feature,resourceKey:feature,count:null,availability:'error',limitations:'Quote source unavailable'};
    const run=async payload=>{const shown=[];await loadEconomicsSummaries({features:[feature],onSummary:s=>shown.push(s),fetcher:async()=>({ok:false,json:async()=>payload})});return shown[0];};
    expect(await run(body)).toMatchObject(body);
    for(const payload of [{...body,resourceKey:features[1]},{...body,feature:features[1]},{...body,count:144},{...body,version:2}]) expect((await run(payload)).limitations).toBeUndefined();
  });
  it('does not publish results or start queued requests after abort', async () => {
    const controller=new AbortController(), shown=[];let requests=0;
    await loadEconomicsSummaries({features,signal:controller.signal,onSummary:s=>shown.push(s),fetcher:async()=>{requests++;controller.abort();throw new Error('abort');}});
    expect(requests).toBe(1);expect(shown).toEqual([]);
  });
});
