import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const fake=vi.hoisted(()=>({ensure:vi.fn(()=>({chats:[],activeId:''})),research:null}));
function methods(){return {activeAiChat:()=>null,addChatAttachments(){},appendAiMessage(){},createAiChat(){},deleteAiChat(){},ensureAiChat:fake.ensure,setActiveAiChat(){},setChatAttachments(){},setChatRole(){},subscribeAiChats:()=>()=>{}};}
vi.mock('../lib/aiThreads.js',()=>({...methods(),hydrateConversations(){},reconcileTurn(){}}));
vi.mock('./useResearchThread.js',()=>({default:()=>fake.research}));
import AiPanel from './AiPanel.jsx';
it('places attachments by the composer and uses one submit position while running',()=>{
 const chat={id:'c',attachments:[{id:'a',kind:'file',title:'Evidence.txt'}]};
 fake.research={...fake.research,ready:true,loading:false,locked:true,canStop:true,submitting:true,store:{chats:[chat],activeId:'c'},messages:[{id:'u',role:'user',content:'Question'}]};
 const html=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(html.indexOf('ai-attachment-tray')).toBeGreaterThan(html.indexOf('ai-v2-foot'));
 expect(html).not.toContain('>Attach files</button>');
 expect(html).not.toContain('Drag a row from the table');
 expect(html.match(/class="ai-v2-send/g)).toHaveLength(1);
 expect(html).toContain('aria-label="Stop"');
});
it('shows attachment processing and save failure recovery, and disables locked removal',()=>{
 const chat={id:'c',attachments:[{id:'a',kind:'file',title:'Evidence.txt'}]};
 fake.research={...fake.research,ready:true,loading:false,locked:true,attaching:true,store:{chats:[chat],activeId:'c',persistenceError:'Changes could not be saved. Try Reload.'}};
 const html=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(html).toContain('Processing attachments…');
 expect(html).toMatch(/aria-label="Remove Evidence.txt"[^>]*disabled=""/);
 expect(html).toMatch(/role="alert">Changes could not be saved/);
 expect(html).toMatch(/<button[^>]*>Reload<\/button>/);
 expect(html).not.toContain('aria-label="Stop"');
});
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
// thinking-display spec §1 (owner decision 2026-10-02, ADR 0007 §2 amended): one indicator from
// Send. The NyAI card covered the client's identity re-check and then gave way to a differently
// sized ticker; now the ticker itself opens at once on "Starting…" and stays until the answer.
it('a live research turn shows one thinking indicator, the ticker, from Send to the answer', () => {
 const ready = { ...fake.research, ready: true, loading: false, locked: false };
 const asked = [{ id: 'u1', role: 'user', content: 'What penalties apply?', at: Date.now() }];
 fake.research = { ...ready, submitting: true, live: false, stream: null, messages: asked };
 const submitted = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(submitted).toContain('ai-ticker active');
 expect(submitted).toContain('Starting…');
 expect(submitted).not.toContain('nyai-thinking');

 fake.research = { ...ready, live: true, stream: { isPending: true, isStreaming: false, streamingText: '' } };
 const pending = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(pending).toContain('ai-ticker active');
 expect(pending).not.toContain('nyai-thinking');

 fake.research = { ...ready, live: true, stream: { isPending: false, isStreaming: true, streamingText: '' } };
 expect(renderToStaticMarkup(<AiPanel lang="en" />).match(/class="ai-ticker active"/g)).toHaveLength(1);

 fake.research = { ...ready, live: true, stream: { isPending: false, isStreaming: true, streamingText: 'Here is the analysis from the record.' } };
 const streamHtml = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(streamHtml).toContain('ai-ticker active');
 expect(streamHtml).toContain('Here is the analysis from the record.');
});

// F131 §3: the live turn draws the same source strip as the saved one, between the thinking notes
// and the answer. Pages found so far fill it while the turn searches; the terminal list replaces them.
describe('the web-source strip on the turn in flight', () => {
 const livePages = [
  { url: 'https://reuters.com/a', title: 'R', domain: 'reuters.com' },
  { url: 'https://pib.gov.in/b', title: 'P', domain: 'pib.gov.in' },
 ];
 const finalPages = [{ url: 'https://pib.gov.in/b', title: 'P', domain: 'pib.gov.in', cited: true }];
 const flight = (stream) => {
  fake.research = { ...fake.research, ready: true, loading: false, locked: false, live: true, stream };
  return renderToStaticMarkup(<AiPanel lang="en" />);
 };

 it('fills from the live pages while the turn searches, after the ticker and before the answer', () => {
  const html = flight({ isPending: true, isStreaming: true, streamingText: 'STREAMED_ANSWER', webSources: [], webLive: livePages,
   activity: [{ type: 'tool', name: 'web_search', phase: 'start', step: 1 }] });
  expect(html).toContain('class="ai-web-strip searching"');
  expect(html).toContain('Searching the web…');
  expect(html).toContain('2 pages so far');
  expect(html).toContain('src="/api/site-icon?domain=reuters.com"');
  expect(html.indexOf('ai-ticker active')).toBeLessThan(html.indexOf('ai-web-strip'));
  expect(html.indexOf('ai-web-strip')).toBeLessThan(html.indexOf('STREAMED_ANSWER'));
 });

 it('shows the terminal webSources in place of the live pages, with the search count, no longer searching', () => {
  const html = flight({ isPending: true, isStreaming: true, streamingText: 'Answer', webSources: finalPages, webLive: livePages,
   activity: [{ type: 'tool', name: 'web_search', phase: 'end', step: 1, resultCount: 2, searches: 2 }] });
  expect(html).toContain('class="ai-web-strip"');
  expect(html).toContain('From the web · unofficial');
  expect(html).toContain('2 searches · 1 source');
  expect(html).not.toContain('domain=reuters.com');
 });

 it('shows nothing for a turn with no pages, and drops live pages once the turn ends without a list', () => {
  expect(flight({ isPending: true, isStreaming: true, streamingText: 'Answer', webSources: [], webLive: [] })).not.toContain('ai-web-strip');
  expect(flight({ isPending: true, isStreaming: true, streamingText: 'Answer' })).not.toContain('ai-web-strip');
  expect(flight({ isPending: false, isStreaming: false, streamingText: 'Answer', webSources: [], webLive: livePages })).not.toContain('ai-web-strip');
 });
});

it('a failed research turn leaves no running indicator and shows the error', () => {
 const ready = { ...fake.research, ready: true, loading: false, locked: false };
 fake.research = {
   ...ready,
   live: false,
   submitting: false,
   error: 'research-chat HTTP 503: OpenRouter API gateway unavailable',
   stream: { isPending: false, isStreaming: false, error: 'research-chat HTTP 503: OpenRouter API gateway unavailable' },
 };
 const errorHtml = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(errorHtml).not.toContain('ai-ticker active');
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
 expect(doneHtml).not.toContain('ai-ticker active');
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
// Since side-panel T4 the side panel's expand mode hosts the viewer: the chat portals it into the
// pane the panel hands it (viewerSlot). Standalone (no viewerSlot) it follows the chat, outside it.
it('the viewer sits outside the chat: standalone it follows it; hosted, it waits for the panel\'s pane',()=>{
 const ready={...fake.research,ready:true,loading:false,locked:false};
 fake.research={...ready,viewer:null};
 const shut=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(shut).toMatch(/^<div class="ai-shell /);
 expect(shut).not.toContain('ai-work-surface');
 fake.research={...ready,viewer:{kind:'list',source:null}};
 const open=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(open).toMatch(/^<div class="ai-shell /);
 expect(open).toContain('<div class="ai-work-surface"');
 // The surface is not inside the chat's own markup.
 const chatEnd=open.lastIndexOf('<div class="ai-work-surface"');
 expect(open.slice(0,chatEnd)).not.toContain('ai-work-surface');
 // Hosted, before the panel's pane exists, it renders nowhere rather than inline.
 expect(renderToStaticMarkup(<AiPanel lang="en" viewerSlot={null}/>)).not.toContain('ai-work-surface');
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
// Revision 5 point 1: a click outside the open citation closes both the citation and the chat. Since
// side-panel T4 the panel's expand mode listens for the click and calls what the chat reports.
it('a click outside the open citation closes the citation and then the chat',async()=>{
 const {closeCitationAndChat}=await import('./AiPanel.jsx');
 const calls=[];
 closeCitationAndChat(()=>calls.push('closeViewer'),()=>calls.push('onClose'))();
 expect(calls).toEqual(['closeViewer','onClose']);
 // With no chat to close (no onClose), only the citation closes.
 calls.length=0;closeCitationAndChat(()=>calls.push('closeViewer'),undefined)();
 expect(calls).toEqual(['closeViewer']);
});
// The attachedKeys separator was a literal NUL byte, which made grep treat the file as binary.
it('AiPanel.jsx contains no literal NUL byte',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('./AiPanel.jsx',import.meta.url));
 expect(source.includes(0)).toBe(false);
});
// F46: a live answer was headed by the admin label ("Gemini - Flash") and the same answer, once
// saved, by the raw id ("google/gemini-3.8-flash"), because only the ids are stored. Both now
// show the registry label; an id the registry no longer lists still shows as itself.
it('saved model labels appear inside the accordion, without standalone model headings',()=>{
 const registry={models:[{model_id:'google/gemini-3.8-flash',label:'Gemini - Flash',is_default:true},{model_id:'anthropic/claude-sonnet-5',label:'Claude - Sonnet'}],roles:[]};
 const saved={id:'a1',role:'assistant',content:'Answer',sources:[],model:'anthropic/claude-sonnet-5',model_requested:'google/gemini-3.8-flash',model_served:'anthropic/claude-sonnet-5',timing:{total_ms:2000,writing_ms:500}};
 const retired={id:'a2',role:'assistant',content:'Older',sources:[],model:'old/model-x',model_served:'old/model-x',timing:{total_ms:900}};
 fake.research={...fake.research,ready:true,loading:false,locked:false,registry,messages:[saved,retired]};
 const html=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(html).not.toContain('<span>Claude - Sonnet</span>');
 expect(html).not.toContain('<span>anthropic/claude-sonnet-5</span>');
 expect(html).toContain('Claude - Sonnet ·');
 expect(html).toContain('old/model-x ·');
});
// thinking-display §1: the clock starts at Send, not at an earlier question (a retried turn
// reuses its old question).
it('the in-flight clock never counts from an earlier question', () => {
 const ready = { ...fake.research, ready: true, loading: false, locked: false };
 const old = Date.now() - 3 * 60 * 60 * 1000;
 fake.research = { ...ready, submitting: true, live: false, stream: null, messages: [
   { id: 'u0', role: 'user', content: 'Earlier question', at: old },
 ] };
 const html = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(html).toContain('Starting…');
 expect(html).toMatch(/class="ai-ticker-clock">0:0\d</);
});

// V7 of thinking-display: as the answer was saved, the transport cleared the stream a moment
// before `submitting` dropped, so the in-flight block rendered empty ("Starting…") beside the
// saved answer for one frame. Once the answer is the last message, nothing is in flight.
it('a saved answer never sits beside an empty in-flight indicator', () => {
 const ready = { ...fake.research, ready: true, loading: false, locked: false };
 fake.research = { ...ready, submitting: true, live: false, stream: null, messages: [
   { id: 'u1', role: 'user', content: 'Q', at: Date.now() - 16000 },
   { id: 'a1', role: 'assistant', content: 'Saved answer', at: Date.now(), timing: { total_ms: 13000 }, activity: [] },
 ] };
 const html = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(html).toContain('Saved answer');
 expect(html).not.toContain('ai-ticker active');
 expect(html).not.toContain('Starting…');
});
// panel-loading spec C: one reveal. While the thread loads, its area holds a placeholder rather
// than an empty thread, the model button a fixed placeholder rather than "No approved models", and
// the question row keeps its room (hidden) while busy, so nothing shifts when the answer settles.
it('C: loading shows a placeholder thread and model button, never an empty chat or "No approved models"', () => {
 const html = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(html).toContain('ai-thread-skeleton');
 expect(html).not.toContain('Chat is empty');
 expect(html).not.toContain('No approved models');
 expect(html).toContain('ai-v2-model-name pending');
});
it('C: the question row keeps its room while a turn runs', () => {
 const ready = { ...fake.research, ready: true, loading: false, locked: true, submitting: true,
   messages: [{ id: 'a1', role: 'assistant', content: 'Answer', followUps: ['What next?'] }] };
 fake.research = ready;
 const html = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(html).toMatch(/class="ai-suggest ai-v2-suggest is-held"[^>]*aria-hidden="true"/);
 fake.research = { ...ready, locked: false, submitting: false };
 expect(renderToStaticMarkup(<AiPanel lang="en" />)).not.toContain('is-held');
});
// panel-loading spec C, found in the browser run: the store emitted the thread one frame before
// `ready`, so messages drew under the placeholder for 16 ms. The thread waits for ready too.
it('C: no message is drawn until the panel is ready', () => {
 fake.research = { ...fake.research, ready: false, loading: true, messages: [{ id: 'u1', role: 'user', content: 'Early question' }] };
 const html = renderToStaticMarkup(<AiPanel lang="en" />);
 expect(html).toContain('ai-thread-skeleton');
 expect(html).not.toContain('Early question');
});
// side-panel amendment 2: in the side panel AI's actions move into the panel's tab bar (portalled
// into actionsSlot), so the chat has no header row of its own; standalone it keeps its header.
it('embedded in the side panel, the chat renders no header row of its own; standalone it does',()=>{
 const ready={...fake.research,ready:true,loading:false,locked:false,viewer:null};
 fake.research=ready;
 expect(renderToStaticMarkup(<AiPanel lang="en" embedded actionsSlot={null}/>)).not.toContain('ai-v2-head');
 expect(renderToStaticMarkup(<AiPanel lang="en" embedded/>)).toContain('class="ai-v2-head embedded"');
 expect(renderToStaticMarkup(<AiPanel lang="en"/>)).toContain('class="ai-v2-head"');
});
// chat-attach-fixes: Reload shows only when something calls for it; the attach note is a status line.
it('Reload appears only when needed, and the attach note shows under the chips',()=>{
 const ready={...fake.research,ready:true,loading:false,locked:false,viewer:null,error:'',storedRunning:false,cancelRequested:false,attachNotice:''};
 fake.research=ready;
 expect(renderToStaticMarkup(<AiPanel lang="en"/>)).not.toMatch(/>Reload</);
 for(const state of [{storedRunning:true},{error:'The saved result could not be loaded. Try Reload.'},{cancelRequested:true}]){
  fake.research={...ready,...state};
  expect(renderToStaticMarkup(<AiPanel lang="en"/>)).toMatch(/>Reload</);
 }
 fake.research={...ready,attachNotice:'Already attached: notes.txt'};
 expect(renderToStaticMarkup(<AiPanel lang="en"/>)).toMatch(/role="status"[^>]*>Already attached: notes\.txt</);
});
it('shares dictation beside Send and disables it while the chat is locked', () => {
 fake.research={...fake.research,ready:true,loading:false,locked:false};
 const idle=renderToStaticMarkup(<AiPanel lang="en"/>);
 expect(idle).toMatch(/class="dictation-button" aria-label="Dictate text"/);
 expect(idle.indexOf('dictation-control')).toBeGreaterThan(idle.indexOf('ai-v2-comp-act'));
 fake.research={...fake.research,locked:true};
 expect(renderToStaticMarkup(<AiPanel lang="en"/>)).toMatch(/class="dictation-button" disabled="" aria-label="Dictate text"/);
});

// F130 review finding 8: the globe predicts from exactly what the next send carries.
it('the web prediction counts only the records the request will send', async () => {
 const {webPredictionRecords}=await import('./AiPanel.jsx');
 const {webDefaultFor}=await import('../lib/corpusCoverage.js');
 // A row chip with no text is dropped by requestAttachments, so it is not a record in scope.
 const textless={id:'a',kind:'row',title:'Empty row',preview:{}};
 const {attachments,selectedRecord}=webPredictionRecords([textless],null);
 expect(attachments).toEqual([]);
 expect(selectedRecord).toBe(null);
 expect(webDefaultFor({focus:'attached',attachments,indexedKeys:new Set()})).toEqual({on:false,reason:'no-record'});
 // A chip with text is kept, key and all.
 const bill={id:'b',kind:'row',title:'Bill',text:'Record: Bill',document_key:'bill:2026:156'};
 expect(webPredictionRecords([bill],null).attachments).toEqual([expect.objectContaining({kind:'row',document_key:'bill:2026:156'})]);
});

it('the web prediction counts a selected row whenever the send would pin it, with or without a module name', async () => {
 const {webPredictionRecords}=await import('./AiPanel.jsx');
 const row={bill_name:'THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026',bill_number:'156',house:'Lok Sabha'};
 // No module name: the row is pinned and sent as an attachment, so it is in scope.
 expect(webPredictionRecords([],row).selectedRecord).toEqual({kind:'row',document_key:'bill:2026:156'});
 // Already pinned: counted once, through the chip.
 const pinned=[{id:'p',kind:'row',title:row.bill_name,text:'Record',document_key:'bill:2026:156'}];
 expect(webPredictionRecords(pinned,row).selectedRecord).toBe(null);
 // A row with nothing to send, or a source-status row, is never pinned.
 expect(webPredictionRecords([],{}).selectedRecord).toBe(null);
 expect(webPredictionRecords([],{...row,status:'source_status'}).selectedRecord).toBe(null);
 // A keyless row is still a record.
 expect(webPredictionRecords([],{name:'Raja A',party:'DMK'}).selectedRecord).toEqual({kind:'row'});
});
