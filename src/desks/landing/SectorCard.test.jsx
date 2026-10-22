import {beforeEach, describe, expect, it, vi} from 'vitest';
import {SectorCard} from './DeskLandingFrame.jsx';
import {GLOBAL_PRESENTATION} from './globalPresentation.js';
const hooks = vi.hoisted(() => ({refs:[],index:0,effects:[]}));
vi.mock('react', async original => ({...await original(),useRef: initial => {const i=hooks.index++;return hooks.refs[i] ||= {current:initial}},useEffect: run => hooks.effects.push(run)}));
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {const match=find(child,predicate);if(match)return match;}
  return null;
};
const group=GLOBAL_PRESENTATION.groups[0];
const render = (open,onToggle=vi.fn(),onFeature=vi.fn(),cardGroup=group) => {
  hooks.index=0;hooks.effects=[];
  return SectorCard({presentation:GLOBAL_PRESENTATION,group:cardGroup,summaries:{},onFeature,id:'security',index:0,open,onToggle});
};
beforeEach(()=>{hooks.refs=[]});
describe('sector interactions',()=>{
  it('provides a background close target separate from module navigation',()=>{
    const toggle=vi.fn(),navigate=vi.fn();const card=render(true,toggle,navigate);
    const background=find(card,n=>n.props?.className==='sector-dismiss');
    expect(background).not.toBeNull();
    background.props.onClick();
    expect(toggle).toHaveBeenCalledWith(null);
    expect(navigate).not.toHaveBeenCalled();
    expect(background.props.tabIndex).toBe(-1);
  });
  it('opens its own sector and transfers focus to a module; Escape closes and restores focus',()=>{
    const toggle=vi.fn(),frontFocus=vi.fn(),linkFocus=vi.fn();
    const closed=render(false,toggle);
    hooks.refs[0].current={focus:frontFocus};hooks.refs[1].current={querySelector:()=>({focus:linkFocus})};
    hooks.effects.forEach(run=>run());
    find(closed,n=>n.props?.className==='sector-card sector-front').props.onClick();
    expect(toggle).toHaveBeenCalledWith(group.id);
    const opened=render(true,toggle);hooks.effects.forEach(run=>run());
    expect(linkFocus).toHaveBeenCalledWith({preventScroll:true});
    expect(find(opened,n=>n.props?.className==='sector-card sector-front').props.inert).toBe(true);
    expect(find(opened,n=>n.props?.className==='sector-back').props.inert).toBe(false);
    opened.props.onKeyDown({key:'Escape',stopPropagation:vi.fn()});
    expect(toggle).toHaveBeenLastCalledWith(null);
    render(false,toggle);hooks.effects.forEach(run=>run());
    expect(frontFocus).toHaveBeenCalledWith({preventScroll:true});
  });
  it('keeps primary module navigation and leaves modified clicks to the browser',()=>{
    const navigate=vi.fn();const card=render(true,vi.fn(),navigate);const link=find(card,n=>n.type==='a');
    const normal={button:0,preventDefault:vi.fn()};link.props.onClick(normal);
    expect(navigate).toHaveBeenCalledWith(group.modules[0].feature);expect(normal.preventDefault).toHaveBeenCalledOnce();
    navigate.mockClear();
    for(const keys of [{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true},{button:1}]){const event={button:0,preventDefault:vi.fn(),...keys};link.props.onClick(event);expect(event.preventDefault).not.toHaveBeenCalled();}
    expect(navigate).not.toHaveBeenCalled();
  });
});

it('exposes every module in a keyboard-scrollable region without expansion controls',()=>{
  const large={...group,modules:Array.from({length:11},(_,i)=>({...group.modules[0],feature:`module-${i}`}))};
  const card=render(true,vi.fn(),vi.fn(),large);
  const list=find(card,n=>n.props?.className==='sector-modules');
  expect(list.props.role).toBe('region');
  expect(list.props.tabIndex).toBe(0);
  expect(list.props.children.flat().length).toBe(11);
  expect(find(card,n=>n.type==='a'&&n.props.hidden)).toBeNull();
  expect(find(card,n=>n.props?.className==='sector-more')).toBeNull();
});
