import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import PlanChoices from './PlanChoices.jsx';
const pro={plan:'pro',status:'active'};
it('shows a Free card with no recurring or repeated welcome allowance',()=>{
 const tree=PlanChoices({ent:pro,includeFree:true,onSelect:vi.fn()});
 const html=renderToStaticMarkup(tree);expect(html).toContain('FREE');expect(html).toContain('No monthly credit allowance');expect(html).toContain('AI uses your available credits');expect(html).not.toContain('10,000');
 expect(tree.props.children).toHaveLength(4);
});
it('enables Free for paid accounts and marks Free current for free or lapsed accounts',()=>{
 for(const ent of [{plan:'free',status:'free'},{...pro,lapsed:true}]){
  const tree=PlanChoices({ent,includeFree:true,onSelect:vi.fn()});const card=tree.props.children.find(c=>c.key==='free');expect(card.props.disabled).toBe(true);expect(renderToStaticMarkup(card)).toContain('Current plan');
 }
 const onSelect=vi.fn();const tree=PlanChoices({ent:pro,includeFree:true,onSelect});const card=tree.props.children.find(c=>c.key==='free');expect(card.props.disabled).toBe(false);card.props.onClick();expect(onSelect).toHaveBeenCalledWith('free');
});
it('keeps existing paid-only consumers unchanged by default',()=>{expect(PlanChoices({ent:pro,onSelect:vi.fn()}).props.children).toHaveLength(3);});
