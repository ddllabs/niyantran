import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
const fake=vi.hoisted(()=>({ensure:vi.fn(()=>({chats:[],activeId:''})),research:null}));
function methods(){return {activeAiChat:()=>null,addChatAttachments(){},appendAiMessage(){},createAiChat(){},deleteAiChat(){},ensureAiChat:fake.ensure,setActiveAiChat(){},setChatAttachments(){},setChatRole(){},subscribeAiChats:()=>()=>{}};}
vi.mock('../lib/aiThreads.js',()=>({...methods(),hydrateConversations(){},reconcileTurn(){}}));
vi.mock('./useResearchThread.js',()=>({default:()=>fake.research}));
import AiPanel from './AiPanel.jsx';
beforeEach(()=>{fake.ensure.mockClear();fake.research={store:{chats:[],activeId:'',loaded:false},ready:false,loading:true,locked:true,registry:{models:[],roles:[]},choice:{modelId:'',effort:'off'},draft:'',error:'',viewer:null,messages:[],sources:[],actions:{},identityVersion:0};});
it('research panel does not create an empty draft during render before verified hydration',()=>{
 const html=renderToStaticMarkup(<AiPanel lang="en"/>);expect(fake.ensure).not.toHaveBeenCalled();expect(html).toContain('Loading research');
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
 // R6 decision 7: the viewer now opens beside the chat, not over it, so the thread stays usable.
 expect(open).not.toMatch(/class="ai-v2-body"[^>]*inert/);
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
// A turn in flight showed the NyAI card under the activity ticker ("Thinking
// through your question..."), two thinking indicators at once. The card now
// covers only the wait before the stream opens; the ticker takes over after.
it('a live research turn shows one thinking indicator at a time', () => {
 const ready = { ...fake.research, ready: true, loading: false, locked: false };
 fake.research = {
   ...ready,
   live: true,
   stream: { isPending: true, isStreaming: false, streamingText: '' },
 };
 const thinkingHtml = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(thinkingHtml).toContain('nyai-thinking');
 expect(thinkingHtml).toContain('NyAI is thinking');
 expect(thinkingHtml).not.toContain('ai-ticker');

 fake.research = {
   ...ready,
   live: true,
   stream: { isPending: false, isStreaming: true, streamingText: '' },
 };
 const openHtml = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(openHtml).toContain('ai-ticker');
 expect(openHtml).not.toContain('nyai-thinking');

 fake.research = {
   ...ready,
   live: true,
   stream: { isPending: false, isStreaming: true, streamingText: 'Here is the analysis from the record.' },
 };
 const streamHtml = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(streamHtml).not.toContain('nyai-thinking');
 expect(streamHtml).toContain('Here is the analysis from the record.');
});

it('removes NyAiThinking and renders error message when research turn fails or backend is unavailable', () => {
 const ready = { ...fake.research, ready: true, loading: false, locked: false };
 fake.research = {
   ...ready,
   live: false,
   submitting: false,
   error: 'research-chat HTTP 503: OpenRouter API gateway unavailable',
   stream: { isPending: false, isStreaming: false, error: 'research-chat HTTP 503: OpenRouter API gateway unavailable' },
 };
 const errorHtml = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(errorHtml).not.toContain('nyai-thinking');
 expect(errorHtml).toContain('OpenRouter API gateway unavailable');
 expect(errorHtml).toMatch(/class="ai-foot warn"[^>]*role="alert"/);
});

it('does not leave orphaned thinking state when research completes', () => {
 const ready = { ...fake.research, ready: true, loading: false, locked: false };
 fake.research = {
   ...ready,
   live: false,
   submitting: false,
   messages: [{ id: 'm1', role: 'assistant', content: 'Final verified answer' }],
   stream: { isPending: false, isStreaming: false, status: 'complete' },
 };
 const doneHtml = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(doneHtml).not.toContain('nyai-thinking');
 expect(doneHtml).toContain('Final verified answer');
});



// retrieval-scope (spec "Browser"): "Ask about this document" attaches a
// pointer to a corpus document. It must reach research-chat as
// {kind, title, document_id} with no text - the chip is never corpus content -
// and must not be dropped by the filter that removes text-less chips.
const CITED={id:1,kind:'text',chunk_id:'c1',document_id:'0b6c1c62-3a8e-4a57-9d55-2f0c7a1e9b10',title:'SEBI Circular on Mutual Funds',desk_feature:'Regulatory Circulars',char_from:0,char_to:40,text_hash:'h',source_kind:'document'};
it('a document chip is forwarded with its document id and without text',async()=>{
 const {requestAttachments}=await import('./AiPanel.jsx');
 const out=requestAttachments([
  {id:'a1',kind:'document',title:CITED.title,document_id:CITED.document_id,feature:'Regulatory Circulars'},
  {id:'a2',kind:'row',title:'Bill',text:'row text',document_key:'bill:2007:70'},
 ]);
 expect(out[0]).toEqual({kind:'document',title:CITED.title,document_id:CITED.document_id});
 expect(out[0]).not.toHaveProperty('text');
 expect(out[1]).toMatchObject({kind:'row',title:'Bill',text:'row text',document_key:'bill:2007:70'});
 // A document chip that names no document is not sent at all.
 expect(requestAttachments([{id:'a3',kind:'document',title:'x'}])).toEqual([]);
});
function attachSpy(ok=true){const got=[];return {got,attach:async(fn)=>{if(!ok)return false;got.push(...await fn());return true;}};}
it('asking about a document attaches a text-less document chip',async()=>{
 const {askAboutDocument}=await import('./AiPanel.jsx');
 const spy=attachSpy();
 await askAboutDocument(CITED,{attach:spy.attach,focus:'attached'});
 expect(spy.got).toEqual([{kind:'document',title:CITED.title,document_id:CITED.document_id,feature:'Regulatory Circulars'}]);
 expect(spy.got[0]).not.toHaveProperty('text');
});
// Owner decision 2: from broad or desk the focus moves to attached, with a
// notice saying why; a focus that already confines is left as it is.
it('asking about a document moves broad and desk focus to attached, with a notice',async()=>{
 const {askAboutDocument}=await import('./AiPanel.jsx');
 for(const focus of ['broad','desk']){
  const r=await askAboutDocument(CITED,{attach:attachSpy().attach,focus});
  expect(r.focus).toBe('attached');
  expect(r.notice).toBe('Focus set to Attached so questions search only the attached documents.');
 }
 for(const focus of ['attached','selection']){
  const r=await askAboutDocument(CITED,{attach:attachSpy().attach,focus});
  expect(r.focus).toBe(focus);
  expect(r.notice).not.toMatch(/Focus set/);
 }
});
it('the notice counts the attached documents the search is shared with',async()=>{
 const {askAboutDocument}=await import('./AiPanel.jsx');
 const other={id:'a1',kind:'document',title:'Other',document_id:'d-other'};
 const bill={id:'a2',kind:'row',title:'Bill',document_key:'bill:2007:70'};
 const r=await askAboutDocument(CITED,{attach:attachSpy().attach,focus:'broad',attachments:[other,bill],indexed:new Set(['bill:2007:70'])});
 expect(r.notice).toBe('Focus set to Attached so questions search only the attached documents. Searching 3 attached documents.');
 // The same document attached twice is one document; a row with no indexed text confines nothing.
 const same={id:'a3',kind:'document',title:CITED.title,document_id:CITED.document_id};
 const one=await askAboutDocument(CITED,{attach:attachSpy().attach,focus:'attached',attachments:[same,bill],indexed:new Set()});
 expect(one.notice).toBe('Document attached.');
 const two=await askAboutDocument(CITED,{attach:attachSpy().attach,focus:'attached',attachments:[other]});
 expect(two.notice).toBe('Document attached. Searching 2 attached documents.');
});
it('a locked thread attaches nothing and leaves focus alone',async()=>{
 const {askAboutDocument}=await import('./AiPanel.jsx');
 expect(await askAboutDocument(CITED,{attach:attachSpy(false).attach,focus:'broad'})).toBeNull();
 const spy=attachSpy();
 expect(await askAboutDocument({...CITED,document_id:''},{attach:spy.attach,focus:'broad'})).toBeNull();
 expect(spy.got).toEqual([]);
});
it('the reader offers the button, and turns it off while the thread is locked',()=>{
 const ready={...fake.research,ready:true,loading:false,locked:false,viewer:{kind:'text',source:CITED},actions:{attach:async()=>true}};
 fake.research=ready;
 const open=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(open).toMatch(/<button[^>]*>Ask about this document<\/button>/);
 expect(open).not.toMatch(/<button[^>]*disabled=""[^>]*>Ask about this document/);
 fake.research={...ready,locked:true};
 expect(renderToStaticMarkup(<AiPanel lang="en"/>)).toMatch(/<button[^>]*disabled=""[^>]*>Ask about this document/);
});
it('a document chip shows its title, a document marker and full text',()=>{
 const chat={id:'c1',title:'t',messages:[],attachments:[{id:'a1',kind:'document',title:CITED.title,document_id:CITED.document_id}]};
 fake.research={...fake.research,ready:true,loading:false,locked:false,store:{chats:[chat],activeId:'c1',loaded:true}};
 const html=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(html).toMatch(/SEBI Circular on Mutual Funds<\/span><em class="ai-v2-file-cover document"[^>]*>Document<\/em><em class="ai-v2-file-cover full"[^>]*>Full text</);
});
// Decision 3: desk focus now filters documents to the open module.
it('the desk focus is labelled "Desk", with a hint that documents are limited to the module',async()=>{
 const {FOCUS_OPTS}=await import('./AiPanel.jsx');
 const desk=FOCUS_OPTS.find(o=>o.id==='desk');
 expect(desk.en).toBe('Desk');
 expect(desk.hint).toMatch(/document searches are limited to this module/i);
 vi.stubGlobal('localStorage',{getItem:()=> 'desk',setItem(){}});
 try{
  fake.research={...fake.research,ready:true,loading:false,locked:false};
  const html=renderToStaticMarkup(<AiPanel lang="en"/>);
  expect(html).toContain('<span class="ai-v2-tool-v">Desk</span>');
  expect(html).not.toContain('Desk sample');
 }finally{vi.unstubAllGlobals();}
});
// D9 (admin-upload Amendment A): an admin links, unlinks or deletes a record's
// document while the chat is open. The badge asked once per session, so it kept
// saying "Record only" (or "Full text") until a reload. Now a newly attached key
// is re-queried at once, and attached keys are re-checked every COVERAGE_TTL_MS.
it('coverage: attaching re-queries at once, then re-checks every lifetime until nothing keyed is attached',async()=>{
 const {watchCoverage}=await import('./AiPanel.jsx');
 vi.useFakeTimers();
 try{
  const refresh=vi.fn(async(keys)=>new Set(keys));const recheck=vi.fn(async()=>new Set());const answers=[];
  expect(watchCoverage('',(s)=>answers.push(s),{refresh,recheck,every:60_000})).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
  // The panel joins the attached keys with U+0000 (a key may hold a space).
  const stop=watchCoverage('bill:2025:XLV\u0000bill:2024:XX',(s)=>answers.push(s),{refresh,recheck,every:60_000});
  expect(refresh).toHaveBeenCalledWith(['bill:2025:XLV','bill:2024:XX']);
  await vi.advanceTimersByTimeAsync(59_999);
  expect(recheck).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(recheck).toHaveBeenCalledTimes(1);
  expect(recheck).toHaveBeenCalledWith(['bill:2025:XLV','bill:2024:XX']);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(recheck).toHaveBeenCalledTimes(2);
  expect(answers.map((s)=>[...s])).toEqual([['bill:2025:XLV','bill:2024:XX'],[],[]]);
  stop();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(recheck).toHaveBeenCalledTimes(2);
 }finally{vi.useRealTimers();}
});
it('coverage: an answer that lands after the attachments changed is dropped, and a failed lookup changes nothing',async()=>{
 const {watchCoverage}=await import('./AiPanel.jsx');
 let settle;const refresh=vi.fn(()=>new Promise((r)=>{settle=r;}));const answers=[];
 const stop=watchCoverage('k1',(s)=>answers.push(s),{refresh,recheck:vi.fn(),every:60_000});
 stop();settle(new Set(['k1']));await Promise.resolve();await Promise.resolve();
 expect(answers).toEqual([]);
 const stop2=watchCoverage('k2',(s)=>answers.push(s),{refresh:vi.fn(async()=>{throw new Error('down');}),recheck:vi.fn(),every:60_000});
 await Promise.resolve();await Promise.resolve();
 expect(answers).toEqual([]);
 stop2();
});
// R6 decision 7 (docs/specs/2026-10-01-rag-v2-citations-pdf.md): the citation overlay hosts the
// viewer beside the chat instead of the work surface over it.
it('the overlay hosts the viewer: closed, the chat alone; open, the chat left and the viewer right, outside the chat',()=>{
 const ready={...fake.research,ready:true,loading:false,locked:false};
 fake.research={...ready,viewer:null};
 const shut=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(shut).toMatch(/^<div class="cov"><div class="cov-chat"><div class="ai-shell /);
 expect(shut).not.toContain('cov-viewer');
 fake.research={...ready,viewer:{kind:'list',source:null}};
 const open=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(open).toMatch(/^<div class="cov is-open"><div class="cov-chat"><div class="ai-shell /);
 expect(open).toMatch(/<div class="cov-viewer"><div class="ai-work-surface"/);
 // The surface is no longer inside the chat's grid.
 expect(open.slice(0,open.indexOf('<div class="cov-viewer">'))).not.toContain('ai-work-surface');
});
it('WorkSurface still receives the same props from the new host',async()=>{
 const seen=[];
 vi.resetModules();
 vi.doMock('./WorkSurface.jsx',()=>({default:(props)=>{seen.push(props);return null;}}));
 const {default:Panel}=await import('./AiPanel.jsx');
 const viewer={kind:'list',source:null};const sources=[{kind:'text',id:1}];
 fake.research={...fake.research,ready:true,loading:false,locked:true,viewer,sources,actions:{openSource(){},closeViewer(){}}};
 renderToStaticMarkup(<Panel lang="en"/>);
 vi.doUnmock('./WorkSurface.jsx');
 expect(seen).toHaveLength(1);
 const props=seen[0];
 expect(Object.keys(props).sort()).toEqual(['locked','onAskAboutDocument','onClose','onOpen','sources','viewer']);
 expect(props.viewer).toBe(viewer);
 expect(props.sources).toBe(sources);
 expect(props.locked).toBe(true);
 for (const k of ['onOpen','onClose','onAskAboutDocument']) expect(typeof props[k]).toBe('function');
});
// The attachedKeys separator was a literal NUL byte, which made grep treat the file as binary.
it('AiPanel.jsx contains no literal NUL byte',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('./AiPanel.jsx',import.meta.url));
 expect(source.includes(0)).toBe(false);
});
