import {afterEach,beforeEach,expect,it,vi} from 'vitest';
// F262: the History list confirms a deletion only after the user asks for one.
// Same harness as AiPanel.scope.test.jsx: useState is replaced by persistent
// slots so the panel function can be called again after each handler runs.
const h=vi.hoisted(()=>({slots:[],i:0,research:null}));
vi.mock('react',async original=>{
 const real=await original();
 const slot=make=>{const i=h.i++;if(!(i in h.slots))h.slots[i]=make();return h.slots[i];};
 return {...real,useState:init=>{const s=slot(()=>({value:typeof init==='function'?init():init}));return[s.value,next=>{s.value=typeof next==='function'?next(s.value):next;}];},
 useRef:init=>slot(()=>({current:init})),useMemo:fn=>fn(),useCallback:fn=>fn,useEffect:()=>{},useLayoutEffect:()=>{},useSyncExternalStore:(_subscribe,_read,readServer)=>readServer()};
});
vi.mock('./useResearchThread.js',()=>({default:()=>h.research}));
vi.mock('./usePanelPopovers.js',()=>({default:()=>{}}));
import AiPanel from './AiPanel.jsx';
function nodes(node){if(!node||typeof node!=='object')return[];return[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
function label(node){if(typeof node==='string')return node;if(!node||typeof node!=='object')return '';return[node?.props?.children].flat(Infinity).map(label).join('');}
const render=()=>{h.i=0;return nodes(AiPanel({lang:'en'}));};
const byLabel=(tree,text)=>tree.find(n=>n.type==='button'&&n.props['aria-label']===text);
const row=(tree,id)=>tree.find(n=>n.type==='li'&&n.props['data-chat-id']===id);
const confirming=(tree,id)=>row(tree,id)?.props.className==='ai-v2-history-confirm';
const openHistory=()=>byLabel(render(),'Chat history').props.onClick();
const press=(tree,id,name)=>nodes(row(tree,id)).find(n=>n.type==='button'&&(n.props['aria-label']===name||label(n)===name)).props.onClick({stopPropagation(){}});
const saved={id:'c1',title:'Saved research',messages:[{id:'m1'},{id:'m2'}],attachments:[]};
const unsent={id:'',title:'New research',messages:[],attachments:[]};
let deleteChat;
afterEach(()=>vi.unstubAllGlobals());
beforeEach(()=>{
 h.slots=[];h.i=0;deleteChat=vi.fn();
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{}});
 h.research={store:{chats:[unsent,saved],activeId:'',loaded:true},ready:true,loading:false,locked:false,registry:{models:[],roles:[]},choice:{modelId:'',effort:'off'},draft:'',error:'',viewer:null,messages:[],sources:[],identityVersion:0,
 actions:{deleteChat,selectChat:vi.fn(),send:vi.fn(async()=>{}),reportError:vi.fn()}};
});
it('F262 opening History from an unsent new chat asks nothing about deleting it',()=>{
 openHistory();
 const tree=render();
 expect(row(tree,'')).toBeDefined();
 expect(confirming(tree,'')).toBe(false);
 expect(confirming(tree,'c1')).toBe(false);
 expect(tree.map(label).join(' ')).not.toContain('Delete “New research”');
});
it('Delete on a saved chat asks, with its message count, and does not delete yet',()=>{
 openHistory();
 press(render(),'c1','Delete');
 const tree=render();
 expect(confirming(tree,'c1')).toBe(true);
 expect(label(row(tree,'c1'))).toContain('Delete “Saved research” and its 2 messages? This cannot be undone.');
 expect(confirming(tree,'')).toBe(false);
 expect(deleteChat).not.toHaveBeenCalled();
});
it('Cancel clears the confirmation and deletes nothing',()=>{
 openHistory();
 press(render(),'c1','Delete');
 press(render(),'c1','Cancel');
 const tree=render();
 expect(confirming(tree,'c1')).toBe(false);
 expect(deleteChat).not.toHaveBeenCalled();
});
it('confirming deletes that chat and clears the confirmation',()=>{
 openHistory();
 press(render(),'c1','Delete');
 press(render(),'c1','Delete');
 expect(deleteChat).toHaveBeenCalledExactlyOnceWith('c1');
 expect(confirming(render(),'c1')).toBe(false);
});
it('an explicit Delete on the unsent chat still asks first',()=>{
 openHistory();
 press(render(),'','Delete');
 expect(confirming(render(),'')).toBe(true);
 expect(deleteChat).not.toHaveBeenCalled();
});
