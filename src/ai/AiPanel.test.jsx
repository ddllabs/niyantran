import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
const fake=vi.hoisted(()=>({server:true,ensure:vi.fn(()=>({chats:[],activeId:''})),research:null}));
function methods(){return {activeAiChat:()=>null,addChatAttachments(){},appendAiMessage(){},createAiChat(){},deleteAiChat(){},ensureAiChat:fake.ensure,setActiveAiChat(){},setChatAttachments(){},setChatRole(){},subscribeAiChats:()=>()=>{}};}
vi.mock('../lib/aiChatStore.js',methods);
vi.mock('../lib/aiThreads.js',()=>({...methods(),get serverThreads(){return fake.server},hydrateConversations(){},reconcileTurn(){}}));
vi.mock('./useResearchThread.js',()=>({default:()=>fake.research}));
import AiPanel from './AiPanel.jsx';
beforeEach(()=>{fake.server=true;fake.ensure.mockClear();fake.research={store:{chats:[],activeId:'',loaded:false},ready:false,loading:true,locked:true,registry:{models:[],roles:[]},choice:{modelId:'',effort:'off'},draft:'',error:'',viewer:null,messages:[],sources:[],actions:{},identityVersion:0};});
it('research panel does not create an empty draft during render before verified hydration',()=>{
 const html=renderToStaticMarkup(<AiPanel lang="en"/>);expect(fake.ensure).not.toHaveBeenCalled();expect(html).toContain('Loading research');
});
it('legacy panel retains the existing store and composer path',()=>{
 fake.server=false;const html=renderToStaticMarkup(<AiPanel lang="en"/>);expect(fake.ensure).toHaveBeenCalledOnce();expect(html).toContain('Ask a question about your files...');expect(html).not.toContain('Recover answer');
});
it('malformed saved text sources never render trusted-looking document chips',()=>{
 fake.research={...fake.research,ready:true,loading:false,locked:false,messages:[{id:'m',role:'assistant',content:'Plain answer',sources:[{id:1,kind:'text',chunk_id:'c',document_id:'d',title:'FORGED_SOURCE'}]}]};
 expect(renderToStaticMarkup(<AiPanel lang="en"/>)).not.toContain('FORGED_SOURCE');
});
// The streaming spec says clicking a citation "opens the layer with that source
// and turns the button on". It opened the layer and left the button unlit,
// because the class was bound to the legacy `workMode` flag that the research
// path never writes. The surface also covered the toolbar, so a lit button
// would have been hidden anyway - hence the reachability half of this test.
it('opening a source lights the Work mode tab and leaves the tab reachable',()=>{
 const ready={...fake.research,ready:true,loading:false,locked:false};
 fake.research={...ready,viewer:{kind:'list',source:null}};
 const open=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(open).toMatch(/class="ai-v2-work on"[^>]*aria-pressed="true"/);
 expect(open).toContain('ai-work-surface');
 expect(open).not.toMatch(/class="ai-panel-background"[^>]*inert/);
 expect(open).toMatch(/class="ai-v2-body"[^>]*inert/);
 fake.research={...ready,viewer:null};
 const shut=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(shut).toMatch(/class="ai-v2-work"[^>]*aria-pressed="false"/);
 expect(shut).not.toContain('ai-work-surface');
});
// Every assistant turn saves up to three follow-ups and the panel read only the
// live stream's, so they vanished on reload and on any turn but the newest.
it('follow-ups come from the saved message when no turn is streaming, and the live set wins while one is',()=>{
 const saved={id:'m',role:'assistant',content:'Answer',sources:[],followUps:['Saved question?']};
 const ready={...fake.research,ready:true,loading:false,locked:false,messages:[saved]};
 fake.research=ready;
 const reloaded=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(reloaded).toContain('Saved question?');
 expect(reloaded).toContain('Follow-up questions');
 fake.research={...ready,stream:{followUps:['Live question?']}};
 const live=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(live).toContain('Live question?');
 expect(live).not.toContain('Saved question?');
 // In the foot, not the body. The body is the scroller, and .ai-v2-history is
 // laid out at its full height inside it, so a row after the thread is only
 // reachable by scrolling to the end of the answer — and while the thread was
 // a shrinkable flex item it painted straight over that row.
 expect(live.indexOf('ai-v2-foot')).toBeLessThan(live.indexOf('ai-v2-suggest'));
 expect(live.indexOf('ai-v2-suggest')).toBeLessThan(live.indexOf('ai-v2-composer'));
});
it('research selection keeps canonical identity and rejects a bounded row that would name another record',async()=>{
 const {researchSelection}=await import('./AiPanel.jsx');
 const row={commodity:'Copper',price:'123'};
 expect(researchSelection(row)).toEqual(row);
 expect(()=>researchSelection({commodity:'Copper',description:'x'.repeat(700)})).toThrow(/cannot be matched/i);
 const longUrl={title:'T'.repeat(700),source_url:'https://example.test/'+ 'x'.repeat(600)};
 expect(researchSelection(longUrl).source_url).toHaveLength(500);
});
// The chip in the reported chat was the Bill Passage module, and the bill it
// was asked about was only a table selection - so after a reload the chat
// scoped to nothing while looking as if a bill were attached.
it('a row is pinned once per bill, and two bills sharing a number are two bills',async()=>{
 const {rowIsPinned}=await import('./AiPanel.jsx');
 const y2007={bill_name:'The Competition (Amendment) Bill, 2007',bill_number:'70',date_introduced:'2007-08-28'};
 const y2010={bill_name:'The Other Bill, 2010',bill_number:'70',date_introduced:'2010-03-01'};
 const pinned=[{kind:'row',title:y2007.bill_name,document_key:'bill:2007:70',preview:{bill_number:'70'}}];
 expect(rowIsPinned(pinned,y2007)).toBe(true);
 expect(rowIsPinned(pinned,y2010)).toBe(false);
 // A module chip under the same desk is not the row.
 expect(rowIsPinned([{kind:'feed',title:'Bill Passage Probability Index'}],y2007)).toBe(false);
 // Rows without a document key still match on the desk identity.
 expect(rowIsPinned([{kind:'row',title:'Copper',preview:{id:'cu'}}],{id:'cu',commodity:'Copper'})).toBe(true);
 expect(rowIsPinned([],y2007)).toBe(false);
});
it('a module chip says it is a module; a bill chip does not',()=>{
 const chat={id:'c1',title:'t',messages:[],attachments:[{id:'a1',kind:'feed',title:'Bill Passage Probability Index'},{id:'a2',kind:'row',title:'The Competition (Amendment) Bill, 2007'}]};
 fake.research={...fake.research,ready:true,loading:false,locked:false,store:{chats:[chat],activeId:'c1',loaded:true}};
 const html=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(html).toMatch(/<li class="module">[\s\S]*?Bill Passage Probability Index[\s\S]*?ai-v2-file-cover module[^>]*>Module</);
 expect(html.match(/ai-v2-file-cover module/g)).toHaveLength(1);
});
