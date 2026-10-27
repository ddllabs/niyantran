import {afterEach,beforeEach,expect,it,vi} from 'vitest';
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
const selected={id:'234',subject:'Question subject',source_url:'https://example.gov/answer.pdf'};
const props={selected,tab:'national',featureName:'Parliamentary Question Database',lang:'en'};
const render=()=>{h.i=0;return AiPanel(props);};
afterEach(()=>vi.unstubAllGlobals());
beforeEach(()=>{
 h.slots=[];h.i=0;
 vi.stubGlobal('localStorage',{getItem:()=> 'broad',setItem:()=>{}});
 const chat={id:'c1',attachments:[]};
 h.research={store:{chats:[chat],activeId:'c1',loaded:true},ready:true,loading:false,locked:false,registry:{models:[],roles:[]},choice:{modelId:'',effort:'off'},draft:'Tell me about this document',error:'',viewer:null,messages:[],sources:[],identityVersion:0,
 actions:{send:vi.fn(async()=>{}),attach:vi.fn(async fn=>{chat.attachments.push(...await fn());return true;}),reportError:vi.fn()}};
});
it('F257 the real composer submits Attached when auto-pinning a record under saved Broad focus',async()=>{
 const form=nodes(render()).find(n=>n.type==='form');
 await form.props.onSubmit({preventDefault(){}});
 expect(h.research.actions.send).toHaveBeenCalledOnce();
 expect(h.research.actions.send.mock.calls[0][0]).toMatchObject({focus:'attached',selection:{tier:'national',feature:props.featureName,row:{id:'234'}}});
 expect(h.research.store.chats[0].attachments[0].row_key).toBe('234');
});
it('F257 the real composer preserves Broad chosen explicitly for this current record',async()=>{
 let tree=render();
 nodes(tree).find(n=>n.props?.className==='ai-v2-tool-btn').props.onClick();
 tree=render();
 const broad=nodes(tree).find(n=>n.props?.role==='menuitemradio'&&label(n).includes('Broad'));
 expect(broad).toBeTruthy();broad.props.onClick();
 const form=nodes(render()).find(n=>n.type==='form');
 await form.props.onSubmit({preventDefault(){}});
 expect(h.research.actions.send.mock.calls[0][0].focus).toBe('broad');
});

it('F261 suggestions use the subject of a saved Parliamentary attachment',()=>{
 h.research.store.chats[0].attachments=[{kind:'row',title:'Member Name',feature:props.featureName,preview:{subject:'Flood management'}}];
 const follow=nodes(render()).find(n=>Array.isArray(n.props?.questions));
 expect(follow.props.questions.join(' ')).toContain('Flood management');expect(follow.props.questions.join(' ')).not.toContain('Member Name');
});
