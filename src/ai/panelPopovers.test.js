import { expect, it, vi } from 'vitest';
const hooks=vi.hoisted(()=>({effects:[],refs:[],index:0}));
vi.mock('react',async original=>({...await original(),useEffect:fn=>hooks.effects.push(fn),
 useRef:value=>{const i=hooks.index++;return hooks.refs[i] ||= {current:value};}}));
import usePanelPopovers, { wireHistoryPopover } from './usePanelPopovers.js';

it('confirmation focuses Cancel and cancellation restores the same row delete control',()=>{
 hooks.refs=[]; hooks.index=0; hooks.effects=[];
 const cancel={focus:vi.fn()},remove={focus:vi.fn()};
 const row={dataset:{chatId:'c'},querySelector:selector=>selector.includes('danger')?cancel:remove};
 const dialog={querySelectorAll:()=>[row]};
 const props={historyOpen:true,historyRef:{current:{querySelector:()=>dialog}},pendingDelete:'c'};
 usePanelPopovers(props); hooks.effects[2](); expect(cancel.focus).toHaveBeenCalledOnce();
 hooks.index=0; hooks.effects=[];
 usePanelPopovers({...props,pendingDelete:''}); hooks.effects[2](); expect(remove.focus).toHaveBeenCalledOnce();
});

it.each([false,true])('an empty history dismisses on Tab (shift=%s)',shiftKey=>{
 let keydown; const doc={activeElement:null,body:{}};
 const close=vi.fn(),trigger={focus:vi.fn()},dialog={focus(){doc.activeElement=this;},querySelectorAll:()=>[],
  addEventListener:(_,fn)=>{keydown=fn;},removeEventListener(){},contains:()=>false};
 wireHistoryPopover({dialog,trigger,doc,close});
 const event={key:'Tab',shiftKey,preventDefault:vi.fn()}; keydown(event);
 expect(close).toHaveBeenCalledOnce(); expect(trigger.focus).toHaveBeenCalledOnce();
 expect(event.preventDefault).toHaveBeenCalledOnce();
});

it('history focuses its first action, dismisses at keyboard boundaries and restores its trigger',()=>{
 const doc={activeElement:null,body:{}};
 const item=()=>({focus:vi.fn(function(){doc.activeElement=this;})});
 const first=item(), last=item(), trigger=item(), close=vi.fn();
 let keydown;
 const dialog={querySelectorAll:()=>[first,last],contains:node=>[first,last].includes(node),
  addEventListener:(_,fn)=>{keydown=fn;},removeEventListener:vi.fn()};
 const dispose=wireHistoryPopover({dialog,trigger,doc,close});
 expect(doc.activeElement).toBe(first);
 const event={key:'Escape',preventDefault:vi.fn(),stopPropagation:vi.fn()};
 keydown(event); expect(close).toHaveBeenCalledOnce(); expect(doc.activeElement).toBe(trigger);
 expect(event.stopPropagation).toHaveBeenCalledOnce();
 last.focus(); keydown({key:'Tab',shiftKey:false}); expect(close).toHaveBeenCalledTimes(2);
 first.focus(); dispose(); expect(doc.activeElement).toBe(trigger);
 expect(dialog.removeEventListener).toHaveBeenCalledWith('keydown',keydown);
});
