import { beforeEach, expect, it, vi } from 'vitest';
const f=vi.hoisted(()=>({effects:[],refs:[],cursor:0,close:vi.fn(),fetch:vi.fn()}));
vi.mock('react',async original=>({...await original(),useState:initial=>[initial,()=>{}],useEffect:effect=>f.effects.push(effect),useRef:initial=>{const i=f.cursor++;return f.refs[i]||=( {current:initial} );}}));
vi.mock('../../lib/billing.js',()=>({fetchInvoiceHtml:(...args)=>f.fetch(...args)}));
import InvoicePreview from './InvoicePreview.jsx';
const box={getBoundingClientRect:()=>({left:100,right:800,top:100,bottom:800})};
const event=(x,y,target=box)=>({button:0,clientX:x,clientY:y,target,currentTarget:box});
beforeEach(()=>{f.effects=[];f.refs=[];f.cursor=0;vi.clearAllMocks();});
it('dismisses only a click that begins and ends on the backdrop',()=>{
 const tree=InvoicePreview({invoiceId:'invoice',onClose:f.close});
 expect(tree.props.onPointerDown).toBeTypeOf('function');
 tree.props.onPointerDown(event(50,50));tree.props.onClick(event(50,50));expect(f.close).toHaveBeenCalledOnce();f.close.mockClear();
 tree.props.onPointerDown(event(150,150));tree.props.onClick(event(50,50));expect(f.close).not.toHaveBeenCalled();
 tree.props.onPointerDown(event(50,50));tree.props.onClick(event(150,150));expect(f.close).not.toHaveBeenCalled();
 tree.props.onPointerDown(event(50,50));tree.props.onPointerCancel();tree.props.onClick(event(50,50));expect(f.close).not.toHaveBeenCalled();
 tree.props.onPointerDown(event(50,50,{}));tree.props.onClick(event(50,50,{}));expect(f.close).not.toHaveBeenCalled();
});
it('keeps Escape, an accessible icon close action and focus restoration',()=>{
 const tree=InvoicePreview({invoiceId:'invoice',onClose:f.close});
 const button=tree.props.children[0].props.children[1];
 expect(button.props['aria-label']).toBe('Close invoice');button.props.onClick();expect(f.close).toHaveBeenCalledOnce();
 const preventDefault=vi.fn();tree.props.onCancel({preventDefault});expect(preventDefault).toHaveBeenCalled();expect(f.close).toHaveBeenCalledTimes(2);
 const trigger={isConnected:true,focus:vi.fn()};vi.stubGlobal('document',{activeElement:trigger});
 const dialog={showModal:vi.fn(),close:vi.fn()};f.refs[0].current=dialog;
 const cleanup=f.effects[0]();expect(dialog.showModal).toHaveBeenCalled();cleanup();expect(dialog.close).toHaveBeenCalled();expect(trigger.focus).toHaveBeenCalledWith({preventScroll:true});vi.unstubAllGlobals();
});
