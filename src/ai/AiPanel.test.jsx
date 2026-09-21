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
it('research selection keeps canonical identity and rejects a bounded row that would name another record',async()=>{
 const {researchSelection}=await import('./AiPanel.jsx');
 const row={commodity:'Copper',price:'123'};
 expect(researchSelection(row)).toEqual(row);
 expect(()=>researchSelection({commodity:'Copper',description:'x'.repeat(700)})).toThrow(/cannot be matched/i);
 const longUrl={title:'T'.repeat(700),source_url:'https://example.test/'+ 'x'.repeat(600)};
 expect(researchSelection(longUrl).source_url).toHaveLength(500);
});
