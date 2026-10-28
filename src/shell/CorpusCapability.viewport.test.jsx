import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ index: 0, slots: [], effects: [] }));
const coverage = vi.hoisted(() => ({ observe: vi.fn(), stop: vi.fn() }));
vi.mock('../lib/corpusCoverage.js', () => ({
  observeCoverage: coverage.observe, publicCorpusCapability: () => 'record', subscribeCoverage: () => () => {},
}));
vi.mock('react', async original => ({ ...await original(),
  useRef: value => { const i=hooks.index++; hooks.slots[i] ??= {current:value}; return hooks.slots[i]; },
  useState: value => { const i=hooks.index++; if (!(i in hooks.slots)) hooks.slots[i]=value; return [hooks.slots[i], next=>{hooks.slots[i]=next;}]; },
  useCallback: fn => fn,
  useSyncExternalStore: (_subscribe,snapshot) => snapshot(),
  useEffect: (fn,deps) => {
    const i=hooks.index++; const old=hooks.slots[i];
    if (!old || deps.some((value,n)=>!Object.is(value,old.deps[n]))) {
      hooks.effects.push(()=>{ old?.cleanup?.(); hooks.slots[i]={deps,cleanup:fn()}; });
    }
  },
}));
import CorpusCapability from './CorpusCapability.jsx';
const feed={tier:'national',feature:'Questions'};
let observers;
function render(row) {
 hooks.index=0;
 const tree=CorpusCapability({row,feed});
 if (tree) tree.props.ref.current={};
 for (const effect of hooks.effects.splice(0)) effect();
 return tree;
}
beforeEach(()=>{
 hooks.index=0; hooks.slots=[]; hooks.effects=[]; observers=[];
 coverage.observe.mockReset().mockImplementation(keys=>keys.length ? coverage.stop : null); coverage.stop.mockReset();
 vi.stubGlobal('IntersectionObserver',class {
  constructor(callback) { this.callback=callback; this.observe=vi.fn(); this.disconnect=vi.fn(); observers.push(this); }
 });
});
afterEach(()=>{ for(const slot of hooks.slots) slot?.cleanup?.(); vi.unstubAllGlobals(); });

it('F264 a placeholder that becomes a real record starts observing only after entering view',()=>{
 expect(render(null)).toBeNull();
 const row={id:'one',title:'Question'};
 expect(render(row).props.children).toBe('Record only');
 expect(observers).toHaveLength(1);
 expect(observers[0].observe).toHaveBeenCalledTimes(1);
 expect(coverage.observe.mock.calls.flatMap(([keys])=>keys)).toEqual([]);
 observers[0].callback([{isIntersecting:true}]); render(row);
 expect(coverage.observe).toHaveBeenLastCalledWith(['desk-record:["national","Questions","one"]']);
 observers[0].callback([{isIntersecting:false}]); render(row);
 expect(coverage.stop).toHaveBeenCalledTimes(1);
});

it('F264 changing visible identity releases the old key and observes the exact new tuple',()=>{
 render({id:'one'}); observers[0].callback([{isIntersecting:true}]); render({id:'one'});
 render({id:'two'});
 expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
 expect(coverage.stop).toHaveBeenCalledTimes(1);
 expect(coverage.observe).toHaveBeenLastCalledWith(['desk-record:["national","Questions","two"]']);
});
