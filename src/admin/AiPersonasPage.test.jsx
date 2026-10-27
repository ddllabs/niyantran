import { beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [], index: 0 }));
vi.mock('react', async original => ({ ...await original(), useEffect: () => {}, useRef: value => ({current:value}),
  useState(initial) { const i=hooks.index++; if (!(i in hooks.states)) hooks.states[i]=typeof initial==='function'?initial():initial;
    return [hooks.states[i],value=>{hooks.states[i]=typeof value==='function'?value(hooks.states[i]):value;}]; },
}));
vi.mock('../lib/adminPersonas.js', async original => ({ ...await original(), adminPersonas: vi.fn() }));
import { adminPersonas } from '../lib/adminPersonas.js';
import { AiPersonasPage } from './AiPersonasPage.jsx';
const state={persona:'upsc_aspirant',generation:1,draft_id:'v1',active_id:'v1',draft_text:'Original',active_text:'Original'};
const data={states:[state],history:[]};
function nodes(tree,predicate) {
  if (!tree || typeof tree!=='object')return [];
  if(Array.isArray(tree))return tree.flatMap(t=>nodes(t,predicate));
  return [...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];
}
function render(){hooks.index=0;return AiPersonasPage();}
function button(tree,text){return nodes(tree,n=>n.type==='button'&&n.props.children===text)[0];}
function textarea(tree){return nodes(tree,n=>n.type==='textarea')[0];}
beforeEach(()=>{hooks.states=[data,{student:'Original'},'student',false,'','',''];vi.clearAllMocks();});
describe('persona editor publication boundary',()=>{
  it('allows typing, clearing and pasting without publishing or trimming',()=>{
    for(const value of ['', '  Pasted π\n ']){
      textarea(render()).props.onChange({target:{value}});
      const tree=render();expect(textarea(tree).props.value).toBe(value);
      expect(textarea(tree).props.disabled).toBe(false);
      expect(button(tree,'Publish for my account').props.disabled).toBe(true);
    }
    expect(adminPersonas).not.toHaveBeenCalled();
  });
  it('saves exact draft with revision protection, then enables a separate publication',async()=>{
    const exact='  Draft π\n ';
    textarea(render()).props.onChange({target:{value:exact}});
    adminPersonas.mockResolvedValue({...data,states:[{...state,generation:2,draft_id:'v2',draft_text:exact}]});
    await button(render(),'Save draft').props.onClick();
    expect(adminPersonas).toHaveBeenCalledWith({action:'save',persona:'upsc_aspirant',expected:1,text:exact});
    expect(button(render(),'Publish for my account').props.disabled).toBe(false);
    await button(render(),'Publish for my account').props.onClick();
    expect(adminPersonas).toHaveBeenLastCalledWith({action:'publish',persona:'upsc_aspirant',expected:2});
  });
  it('retains unsaved wording on conflict and when reloading server versions',async()=>{
    textarea(render()).props.onChange({target:{value:'My edits'}});
    adminPersonas.mockRejectedValueOnce(new Error('Version conflict'));
    await button(render(),'Save draft').props.onClick();
    expect(textarea(render()).props.value).toBe('My edits');
    adminPersonas.mockResolvedValueOnce({...data,states:[{...state,generation:2,draft_text:'Other edit'}]});
    await button(render(),'Reload server versions').props.onClick();
    expect(textarea(render()).props.value).toBe('My edits');
    expect(button(render(),'Publish for my account').props.disabled).toBe(true);
  });
});
