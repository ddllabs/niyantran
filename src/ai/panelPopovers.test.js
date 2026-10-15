import { expect, it, vi } from 'vitest';
const hooks=vi.hoisted(()=>({effects:[],refs:[],index:0}));
vi.mock('react',async original=>({...await original(),useEffect:fn=>hooks.effects.push(fn),
 useRef:value=>{const i=hooks.index++;return hooks.refs[i] ||= {current:value};}}));
import usePanelPopovers, { wireHistoryPopover, wirePopoverEscape } from './usePanelPopovers.js';
import { escapeAction } from '../shell/SidePanel.jsx';

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

// F200: a document whose keydown listeners run as the browser would for a key pressed on the page:
// capture listeners first, then the bubbling ones, until one stops the event.
function fakeDocument(){
 const doc={body:{},activeElement:null,listeners:[],
  addEventListener(type,fn,capture){doc.listeners.push({type,fn,capture:Boolean(capture)});},
  removeEventListener(type,fn,capture){doc.listeners=doc.listeners.filter(l=>!(l.type===type&&l.fn===fn&&l.capture===Boolean(capture)));},
  press(key){const event={key,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};
   for(const phase of [true,false])for(const l of doc.listeners.filter(x=>x.type==='keydown'&&x.capture===phase)){if(event.stopped)break;l.fn(event);}
   return event;}};
 doc.activeElement=doc.body;
 return doc;
}
function modelMenu(doc){
 const trigger={focus:vi.fn(()=>{doc.activeElement=trigger;})};
 const root={contains:node=>node===trigger,querySelector:()=>trigger,addEventListener(){},removeEventListener(){}};
 return {root,trigger};
}

it('Escape with the model menu open and focus outside it closes the menu, not the panel; the next Escape is the panel\'s',()=>{
 const doc=fakeDocument(); vi.stubGlobal('document',doc);
 // The panel's own Escape (SidePanel, F135): a document listener that closes AI unless the key was taken.
 const panel=vi.fn(); doc.addEventListener('keydown',e=>{if(e.key==='Escape')panel(escapeAction({aiActive:true,modalOpen:e.defaultPrevented}));});
 const {root,trigger}=modelMenu(doc); const setModelOpen=vi.fn();
 hooks.refs=[]; hooks.index=0; hooks.effects=[];
 usePanelPopovers({modelOpen:true,modelRef:{current:root},setModelOpen,focusRef:{current:null},historyRef:{current:null}});
 const cleanups=hooks.effects.map(fn=>fn()).filter(Boolean);
 // Focus is on the page (a click on a button leaves it there in Safari), not in the menu.
 const first=doc.press('Escape');
 expect(setModelOpen).toHaveBeenCalledWith(false);
 expect(first.defaultPrevented).toBe(true);
 expect(panel).not.toHaveBeenCalledWith('close-ai');
 expect(trigger.focus).toHaveBeenCalledOnce();
 // The menu has closed: its listeners go, and the next Escape reaches the panel and closes it.
 cleanups.forEach(fn=>fn());
 doc.press('Escape');
 expect(panel).toHaveBeenLastCalledWith('close-ai');
 vi.unstubAllGlobals();
});

it('Escape for an open popover leaves focus in the composer, and leaves a focused popover to its own keys',()=>{
 const doc=fakeDocument(); const {root,trigger}=modelMenu(doc); const close=vi.fn();
 const composer={}; doc.activeElement=composer;
 const dispose=wirePopoverEscape({doc,layers:[false,{root,close}]});
 expect(doc.press('Enter').defaultPrevented).toBe(false);
 const e=doc.press('Escape'); expect(close).toHaveBeenCalledOnce(); expect(e.stopped).toBe(true);
 expect(doc.activeElement).toBe(composer); expect(trigger.focus).not.toHaveBeenCalled();
 // Focus inside the popover: the popover's own Escape listener handles it (and restores the trigger).
 doc.activeElement=trigger; const inside=doc.press('Escape'); expect(close).toHaveBeenCalledOnce(); expect(inside.defaultPrevented).toBe(false);
 dispose(); expect(doc.listeners).toHaveLength(0);
});
