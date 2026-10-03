import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ActivityTicker, { tickerSteps } from './ActivityTicker.jsx';
import { measurementRows } from './ResearchFlow.jsx';
import ModelPicker, { costHint, effortsFor, groupByVendor } from './ModelPicker.jsx';
import WorkSurface, { AskAboutDocument } from './WorkSurface.jsx';
import CitationBubble, { isReadableCitation, sanitizeCitation } from './CitationBubble.jsx';

const TEXT_SOURCE = {
  id: 1,
  kind: 'text',
  chunk_id: 'c1',
  document_id: 'd1',
  title: 'The Delimitation Bill, 2026',
  desk_feature: 'Bill Passage Probability Index',
  char_from: 0,
  char_to: 40,
  text_hash: 'h',
  source_kind: 'document',
};
const ROW_SOURCE = {
  id: 2,
  kind: 'row',
  tier: 'national',
  feature: 'Bill Passage Probability Index',
  row_key: 'k',
  title: 'THE DELIMITATION BILL, 2026.',
  row_snapshot: { bill_name: 'THE DELIMITATION BILL, 2026.', house: 'Lok Sabha' },
  snapshot_at: '2026-09-07T18:02:04.432Z',
};

// The three ladders these models actually publish, read off OpenRouter's
// catalogue on 2026-09-22. They are deliberately different from each other:
// Gemini Lite mandates reasoning so it has no 'off' rung and starts at
// 'minimal'; DeepSeek accepts only 'high' and 'xhigh'; Claude accepts the
// whole range. A fixture where every model has the same three rungs is what
// hid the bug this replaced.
const MODELS = [
  { model_id: 'google/gemini-3.5-flash-lite', label: 'Gemini - Lite', vendor: 'google', tier: 1, efforts: ['minimal', 'low', 'medium', 'high'], is_default: true },
  { model_id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek - Flash', vendor: 'deepseek', tier: 1, efforts: ['off', 'high', 'xhigh'], is_default: false },
  { model_id: 'anthropic/claude-sonnet-5', label: 'Claude - Sonnet', vendor: 'anthropic', tier: 3, efforts: ['off', 'low', 'medium', 'high', 'xhigh', 'max'], is_default: false },
];

describe('ActivityTicker', () => {
  const activity = [
    { type: 'activity', text: 'Searching relevant sources.' },
    { type: 'tool', name: 'search_desk_rows', phase: 'end', step: 1, input: { tier: 'national', feature: 'Bill Passage Probability Index' }, resultCount: 20, latencyMs: 320 },
  ];

  it('while active it is compact and shows the latest step', () => {
    const html = renderToStaticMarkup(<ActivityTicker activity={activity} active />);
    expect(html).toContain('ai-ticker active');
    expect(html).toContain('Looked up Bill Passage Probability Index · 20 rows');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('ai-ticker-steps');
  });

  it('when done it collapses to its summary; the details report the buckets and a model swap', () => {
    const timing = { search_ms: 320, reasoning_ms: 1200, writing_ms: 800, total_ms: 2320 };
    const model = { requested: 'google/gemini-3.5-flash-lite', served: 'deepseek/deepseek-v4-flash' };
    const html = renderToStaticMarkup(<ActivityTicker activity={activity} timing={timing} usage={{ reasoning_tokens: 256 }} model={model} />);
    expect(html).not.toContain('ai-ticker active');
    expect(html).toContain('1 search · 2 s');
    const rows = measurementRows(timing);
    expect(rows).toContainEqual(['Search actions','320 ms']);
    expect(rows).toContainEqual(['Other processing','1200 ms']);
    // The actual served model is visible in the summary.
    expect(html).toContain('deepseek/deepseek-v4-flash · 1 search · 2 s');
  });

  it('a search for a phrase names the phrase; nothing at all renders nothing', () => {
    const html = renderToStaticMarkup(<ActivityTicker activity={[{ type: 'tool', name: 'search_documents', phase: 'start', step: 1, input: { query: 'committee stage' } }]} active />);
    expect(html).toContain('Searching “committee stage”…');
    expect(renderToStaticMarkup(<ActivityTicker activity={[]} />)).toBe('');
  });
});

describe('ModelPicker', () => {
  it('groups by vendor, hints at cost, and limits reasoning to what the model accepts', () => {
    expect(groupByVendor(MODELS).map((g) => g.vendor)).toEqual(['google', 'deepseek', 'anthropic']);
    expect(costHint(MODELS[0])).toBe('•');
    expect(costHint(MODELS[2])).toBe('•••');
    expect(effortsFor(MODELS, 'deepseek/deepseek-v4-flash')).toEqual(['off', 'high', 'xhigh']);
    // No 'off': this model mandates reasoning, and the list is no longer
    // prepended with a rung the model would refuse.
    expect(effortsFor(MODELS, 'google/gemini-3.5-flash-lite')).toEqual(['minimal', 'low', 'medium', 'high']);
    expect(effortsFor(MODELS, 'anthropic/claude-sonnet-5')).toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('open, it lists every enabled model and only the disclosed one\'s efforts', () => {
    const roles = [{ role_id: 'DEFAULT_ANALYST', label: 'Default analyst', hint: 'Everyday', model_id: MODELS[0].model_id }];
    const value = { modelId: 'deepseek/deepseek-v4-flash', effort: 'high' };
    // Closed: the menu is a list of models. No rung is on screen, and no model's
    // ladder is presented as if it were another's.
    const shut = renderToStaticMarkup(<ModelPicker models={MODELS} roles={roles} value={value} open />);
    for (const m of MODELS) expect(shut).toContain(m.label);
    expect(shut).toContain('Default analyst');
    expect(shut).not.toContain('ai-v2-efforts');
    // Disclosed: DeepSeek's whole ladder, and nothing from anyone else's.
    const html = renderToStaticMarkup(<ModelPicker models={MODELS} roles={roles} value={value} open effortsOpenFor="deepseek/deepseek-v4-flash" />);
    expect(html).toContain('>High<');
    expect(html).toContain('>Extra high<');
    expect(html).toContain('>No reasoning<');
    expect(html).not.toContain('>Medium<');
    expect(html).not.toContain('>Max<');
    expect(html).not.toContain('>Minimal<');
  });

  it('a model with a single rung gets no disclosure to open', () => {
    const one = [{ model_id: 'v/solo', label: 'Solo', vendor: 'v', tier: 1, efforts: ['off'], is_default: true }];
    const html = renderToStaticMarkup(<ModelPicker models={one} value={{ modelId: 'v/solo' }} open />);
    expect(html).toContain('Solo');
    expect(html).not.toContain('ai-v2-model-disclose');
  });

  it('closed, it shows the picked model and no menu', () => {
    const html = renderToStaticMarkup(<ModelPicker models={MODELS} value={{ modelId: 'anthropic/claude-sonnet-5' }} />);
    expect(html).toContain('Claude - Sonnet');
    expect(html).not.toContain('ai-v2-model-menu');
  });
});

describe('WorkSurface', () => {
  it('shows nothing until a viewer is open, then hosts the row record', () => {
    expect(renderToStaticMarkup(<WorkSurface viewer={null} />)).toBe('');
    const html = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'row', source: ROW_SOURCE }} />);
    expect(html).toContain('← Back');
    expect(html).toContain('THE DELIMITATION BILL, 2026.');
    expect(html).toContain('as captured on 2026-09-07');
  });

  it('with no source it lists the answer\'s sources, or says there are none', () => {
    const list = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'list' }} sources={[TEXT_SOURCE]} />);
    expect(list).toContain('The Delimitation Bill, 2026');
    const empty = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'list' }} sources={[]} />);
    expect(empty).toContain('cites no sources yet');
  });

  // retrieval-scope decision 1: from the reader, one click confines the next
  // questions to the document being read. Text sources only: a desk row is
  // not a document, and the source list names none in particular.
  it('offers "Ask about this document" on a text source only', () => {
    const ask = vi.fn();
    const text = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: TEXT_SOURCE }} onAskAboutDocument={ask} locked={false} />);
    expect(text).toMatch(/<button[^>]*>Ask about this document<\/button>/);
    expect(text).not.toMatch(/<button[^>]*disabled=""[^>]*>Ask about this document/);
    const row = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'row', source: ROW_SOURCE }} onAskAboutDocument={ask} locked={false} />);
    expect(row).not.toContain('Ask about this document');
    const list = renderToStaticMarkup(<WorkSurface viewer={{ kind: 'list' }} sources={[TEXT_SOURCE]} onAskAboutDocument={ask} locked={false} />);
    expect(list).not.toContain('Ask about this document');
  });

  // attach() refuses while the thread is locked, so a live button would be a
  // click that silently does nothing. Without a handler or a lock state it is
  // off too, rather than guessing the thread is free.
  it('the button is disabled while the thread is locked, or with no handler', () => {
    const disabled = /<button[^>]*disabled=""[^>]*>Ask about this document/;
    expect(renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: TEXT_SOURCE }} onAskAboutDocument={() => {}} locked />)).toMatch(disabled);
    expect(renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: TEXT_SOURCE }} locked={false} />)).toMatch(disabled);
    expect(renderToStaticMarkup(<WorkSurface viewer={{ kind: 'text', source: TEXT_SOURCE }} onAskAboutDocument={() => {}} />)).toMatch(disabled);
  });

  it('clicking it hands the citation to onAskAboutDocument, and a locked one does not', () => {
    const ask = vi.fn();
    AskAboutDocument({ citation: TEXT_SOURCE, locked: false, onAsk: ask }).props.onClick();
    expect(ask).toHaveBeenCalledWith(TEXT_SOURCE);
    ask.mockClear();
    AskAboutDocument({ citation: TEXT_SOURCE, locked: true, onAsk: ask }).props.onClick();
    expect(ask).not.toHaveBeenCalled();
  });
});

// R4: the ticker must not claim work the turn did not do. A real production
// turn displayed "Searching relevant sources." with search_ms 0 and a single
// `answer` step, and "thought 9.9s" with reasoning_tokens 0.
it('never calls residual elapsed time measured thinking', () => {
  const timing = { search_ms: 0, reasoning_ms: 9874, writing_ms: 2061, total_ms: 11935 };
  expect(measurementRows(timing)).toContainEqual(['Other processing','9874 ms']);
  expect(measurementRows(timing)).toContainEqual(['Reasoning duration','Not available']);
});

it('legacy hidden reasoning and unknown events never become public activity or tools',()=>{
 const html=renderToStaticMarkup(<ActivityTicker active activity={[{type:'reasoning',text:'PRIVATE reasoning'}, {type:'unknown',text:'PRIVATE unknown'}, {type:'tool',name:'delete_all',phase:'start',input:{query:'PRIVATE tool'}}, {type:'activity',text:'Writing the answer.'}]} />);
 expect(html).toContain('Writing the answer.');expect(html).not.toContain('PRIVATE');expect(html).not.toContain('Looking up');
});
it('only timing can render a completed summary without making unsupported failover claims',()=>{
 expect(measurementRows({writing_ms:800})).toContainEqual(['Answer generation','800 ms']);
 expect(renderToStaticMarkup(<ActivityTicker timing={{writing_ms:800}} model={{requested:'a',served:'b'}} />)).toContain('b · Answered');
});
it('efforts are known, unique, and unavailable models offer no choices',()=>{
 expect(effortsFor([{model_id:'m',efforts:['low','bogus','low','off',null]}],'m')).toEqual(['off','low']);
 expect(effortsFor([{model_id:'disabled',enabled:false,efforts:['high']}],'disabled')).toEqual([]);
 expect(effortsFor(MODELS,'missing')).toEqual([]);
});
it('disabled rows and roles cannot select an unavailable model',()=>{
 const html=renderToStaticMarkup(<ModelPicker open models={[...MODELS,{model_id:'blocked',label:'BLOCKED',enabled:false,efforts:['high']}]} roles={[{role_id:'bad',label:'Unavailable role',model_id:'not-listed'}]} value={{modelId:MODELS[0].model_id}} />);
 expect(html).not.toContain('BLOCKED');expect(html).toMatch(/disabled=""[^>]*>Unavailable role|disabled=""[\s\S]*?Unavailable role/);
});

function elements(node) {
 if(!node || typeof node!=='object')return [];
 return [node,...[].concat(node.props?.children||[]).flat(Infinity).flatMap(elements)];
}
it('role and model buttons normalize incompatible efforts identically',()=>{
 const changes=[];const tree=ModelPicker({models:MODELS,roles:[{role_id:'FAST',label:'Fast',model_id:MODELS[1].model_id}],value:{modelId:MODELS[0].model_id,effort:'medium'},open:true,onChange:v=>changes.push(v)});
 const nodes=elements(tree);nodes.find(n=>n.type==='button'&&n.props?.className?.startsWith('ai-v2-role')).props.onClick();
 nodes.find(n=>n.props?.className?.startsWith('ai-v2-model-opt')&&n.props.children[1].props.children[0].props.children==='DeepSeek - Flash').props.onClick();
 // 'medium' is a rung Gemini Lite has and DeepSeek does not. Both paths land on
 // the same value, and that value is the new model's cheapest real rung rather
 // than 'off': an effort the new model does not accept is an absent choice, not
 // a request for no reasoning. DeepSeek's ladder starts at 'high', so that is
 // what the fallback means here - not every model's floor is 'low'.
 expect(changes).toEqual([{modelId:MODELS[1].model_id,effort:'high'},{modelId:MODELS[1].model_id,effort:'high'}]);
});
// The chevron is a sibling of the row, not a child, precisely so this holds:
// inside the row it would bubble into the row's onClick, pick that model and
// close the menu - so reaching for "show me the levels" would silently change
// the model you were asking about.
it('the disclosure opens a row\'s rungs without selecting that model',()=>{
 const changes=[],opened=[];
 const tree=ModelPicker({models:MODELS,value:{modelId:MODELS[0].model_id,effort:'low'},open:true,onChange:v=>changes.push(v),onToggleEfforts:id=>opened.push(id)});
 const chevron=elements(tree).find(n=>n.props?.className==='ai-v2-model-disclose'&&String(n.props['aria-label']).includes('DeepSeek - Flash'));
 chevron.props.onClick({preventDefault(){},stopPropagation(){}});
 expect(opened).toEqual(['deepseek/deepseek-v4-flash']);
 expect(changes).toEqual([]);
 // Open, the same control closes it again rather than reopening the same row.
 const open=ModelPicker({models:MODELS,value:{modelId:MODELS[0].model_id,effort:'low'},open:true,effortsOpenFor:'deepseek/deepseek-v4-flash',onChange:v=>changes.push(v),onToggleEfforts:id=>opened.push(id)});
 elements(open).find(n=>n.props?.className==='ai-v2-model-disclose'&&String(n.props['aria-label']).includes('DeepSeek - Flash')).props.onClick({preventDefault(){},stopPropagation(){}});
 expect(opened).toEqual(['deepseek/deepseek-v4-flash','']);
 expect(changes).toEqual([]);
});
it('effort clicks on a fallback selection include the actual allowed model',()=>{
 const change=[];const tree=ModelPicker({models:MODELS,value:{modelId:'removed',effort:'bogus'},open:true,effortsOpenFor:MODELS[0].model_id,onChange:v=>change.push(v)});
 elements(tree).find(n=>n.props?.className?.startsWith('ai-v2-effort')&&n.props.children==='Low').props.onClick();
 expect(change).toEqual([{modelId:MODELS[0].model_id,effort:'low'}]);
});

it('malformed and unresolved citations never render trusted source buttons',()=>{
 for(const source of [null,{}, {...TEXT_SOURCE,document_id:''},{...TEXT_SOURCE,char_from:-1},{...TEXT_SOURCE,char_to:0},{...TEXT_SOURCE,file_name:{bad:true}},{...ROW_SOURCE,row_snapshot:{nested:{secret:'x'}}},{...ROW_SOURCE,row_snapshot:{related_links:['javascript:alert(1)']}}]){
 expect(renderToStaticMarkup(<CitationBubble n={1} source={source}/>)).toBe('');
 }
 expect(renderToStaticMarkup(<CitationBubble n={2} source={TEXT_SOURCE}/>)).toBe('');
});
it('a citation opens its validated source without navigating or bubbling',()=>{
 const calls=[];const button=CitationBubble({n:1,source:TEXT_SOURCE,onOpen:s=>calls.push(s)});let prevented=0;
 button.props.onClick({preventDefault:()=>prevented++,stopPropagation:()=>prevented++});expect(prevented).toBe(2);expect(calls).toEqual([TEXT_SOURCE]);
});
it('evidence list includes rows and text but excludes malformed sources',()=>{
 const html=renderToStaticMarkup(<WorkSurface viewer={{kind:'list'}} sources={[TEXT_SOURCE,ROW_SOURCE,{kind:'text',chunk_id:'bad',title:'BAD SOURCE'}]}/>);
 expect(html).toContain('THE DELIMITATION BILL, 2026.');expect(html).toContain('The Delimitation Bill, 2026');expect(html).not.toContain('BAD SOURCE');
});
it('invalid viewer sources show a recoverable message instead of mounting a reader',()=>{
 const html=renderToStaticMarkup(<WorkSurface viewer={{kind:'text',source:{kind:'text',chunk_id:'bad',title:'BAD'}}}/>);
 expect(html).toContain('This source is unavailable');expect(html).not.toContain('Cited source');expect(html).toContain('Back to the answer');
});
it('row evidence opts out of generated briefs while ordinary desk records retain them',async()=>{
 const {default:RowSource}=await import('./RowSource.jsx');
 const tree=RowSource({citation:ROW_SOURCE});
 const record=elements(tree).find(n=>n.type?.name==='RecordDetail');
 expect(record.props.generateBrief).toBe(false);
});

it('served model is retained even when durable timing is absent',()=>{
 expect(renderToStaticMarkup(<ActivityTicker model={{requested:'first',served:'served-model'}}/>)).toContain('served-model · Answered');
});

describe('RAG v2 optional citation fields (chunk contract, citation payload)', () => {
 const SHA = 'a'.repeat(64);
 const PDF_SOURCE = { ...TEXT_SOURCE, id: 3, source_kind: 'pdf_page', page_number: 2 };
 const BOX = { page: 2, x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.3 };
 const RICH = {
  ...PDF_SOURCE,
  extract_hash: 'e'.repeat(64),
  boxes: [BOX, { page: 3, x0: 0, y0: 0, x1: 1, y1: 1 }],
  images: [{ page: 2, sha256: SHA, mime: 'image/png' }],
  section: { heading: 'Section 4', note: 'Substituted by Act 12 of 2019' },
 };
 const MALFORMED = {
  ...PDF_SOURCE,
  extract_hash: 42,
  boxes: 'not an array',
  images: [{ page: 2, sha256: 'nothex', mime: 'image/png' }],
  section: { heading: 7, note: ['x'] },
 };

 it('saved citations without the new fields validate and sanitise exactly as before', () => {
  for (const source of [TEXT_SOURCE, ROW_SOURCE, PDF_SOURCE]) {
   expect(isReadableCitation(source)).toBe(true);
   expect(sanitizeCitation(source)).toEqual(source);
  }
  for (const source of [null, {}, { ...TEXT_SOURCE, document_id: '' }, { ...PDF_SOURCE, page_number: 0 }]) {
   expect(isReadableCitation(source)).toBe(false);
  }
 });
 it('malformed optional fields never reject a citation or hide its bubble', () => {
  expect(isReadableCitation(MALFORMED)).toBe(true);
  expect(renderToStaticMarkup(<CitationBubble n={3} source={MALFORMED}/>)).toContain('Source 3');
 });
 it('a well-formed new citation keeps every field', () => {
  expect(sanitizeCitation(RICH)).toEqual(RICH);
 });
 it('a malformed box is dropped and the rest of the citation kept', () => {
  const bad = [
   { ...BOX, x0: -0.1 }, { ...BOX, y1: 1.5 }, { ...BOX, x0: 0.95 }, { ...BOX, y0: 0.4 },
   { ...BOX, page: 0 }, { ...BOX, page: 1.5 }, { ...BOX, x1: '0.9' }, { ...BOX, y0: Number.NaN }, null,
  ];
  for (const box of bad) {
   const out = sanitizeCitation({ ...RICH, boxes: [BOX, box] });
   expect(out.boxes).toEqual([BOX]);
   expect(out).toEqual({ ...RICH, boxes: [BOX] });
  }
  expect('boxes' in sanitizeCitation({ ...RICH, boxes: [{ ...BOX, page: -1 }] })).toBe(false);
  expect('boxes' in sanitizeCitation({ ...RICH, boxes: 'nope' })).toBe(false);
 });
 it('more than twenty boxes are truncated to twenty', () => {
  const boxes = Array.from({ length: 25 }, (_, i) => ({ ...BOX, page: i + 1 }));
  const out = sanitizeCitation({ ...RICH, boxes });
  expect(out.boxes).toHaveLength(20);
  expect(out.boxes).toEqual(boxes.slice(0, 20));
 });
 it('a bad image, section or extract_hash is removed on its own', () => {
  for (const image of [{ page: 2, sha256: 'a'.repeat(63), mime: 'image/png' }, { page: 2, sha256: `${'a'.repeat(63)}g`, mime: 'image/png' },
   { page: 2, sha256: SHA, mime: 'application/pdf' }, { page: 2, sha256: SHA }, { page: 0, sha256: SHA, mime: 'image/png' }]) {
   expect(sanitizeCitation({ ...RICH, images: [...RICH.images, image] })).toEqual(RICH);
  }
  expect('images' in sanitizeCitation({ ...RICH, images: { sha256: SHA } })).toBe(false);
  expect(sanitizeCitation({ ...RICH, section: { heading: 'Section 4', note: 9 } }).section).toEqual({ heading: 'Section 4' });
  expect('section' in sanitizeCitation({ ...RICH, section: 'Section 4' })).toBe(false);
  expect('section' in sanitizeCitation({ ...RICH, section: { heading: null } })).toBe(false);
  expect(sanitizeCitation({ ...RICH, section: { heading: 'h'.repeat(250) } }).section.heading).toBe('h'.repeat(200));
  const { extract_hash: _drop, ...noHash } = RICH;
  expect(sanitizeCitation({ ...RICH, extract_hash: 42 })).toEqual(noHash);
  expect(sanitizeCitation(MALFORMED)).toEqual(PDF_SOURCE);
 });
 it('the bubble hands the reader the sanitised citation', () => {
  const calls = [];
  const button = CitationBubble({ n: 3, source: { ...RICH, boxes: [BOX, { ...BOX, x1: 2 }] }, onOpen: s => calls.push(s) });
  button.props.onClick({ preventDefault() {}, stopPropagation() {} });
  expect(calls).toEqual([{ ...RICH, boxes: [BOX] }]);
 });
});

// F46: a finished turn listed "Reviewing the question." six times and none of its six searches.
// The server saves a finished tool step without `phase` (research-chat handler.ts, the
// activity.push after the end frame); this is that exact shape, copied from a saved row.
it('a saved turn keeps its searches: a stored tool step without phase is a finished step', () => {
  const saved = [
    { type: 'activity', text: 'Reviewing the question.' },
    { type: 'activity', text: 'Searching relevant sources.' },
    { type: 'tool', name: 'search_documents', input: { query: 'sanction prosecution' }, step: 2, resultCount: 40, latencyMs: 767, status: 'ok' },
    { type: 'activity', text: 'Reviewing the question.' },
    { type: 'tool', name: 'search_desk_rows', input: { tier: 'national' }, step: 3, resultCount: 1, latencyMs: 210, status: 'ok' },
  ];
  const steps = tickerSteps(saved);
  expect(steps.filter((s) => s.type === 'tool')).toHaveLength(2);
  expect(steps.every((s) => s.type !== 'tool' || s.phase === 'end')).toBe(true);
  // The collapsed line of the finished turn counts its searches, not a stage label.
  const html = renderToStaticMarkup(<ActivityTicker activity={saved} timing={{ search_ms: 977, total_ms: 9000 }} />);
  expect(html).toContain('2 searches · 9 s');
  // A legacy row repeated its stage label every round; each line is listed once.
  expect(steps.filter((s) => s.text === 'Reviewing the question.')).toHaveLength(1);
});

it('live steps: a started search shows once, and its end replaces it', () => {
  const live = [
    { type: 'tool', name: 'search_documents', phase: 'start', step: 1, input: { query: 'q' } },
    { type: 'tool', name: 'search_documents', phase: 'end', step: 1, resultCount: 40 },
    { type: 'tool', name: 'search_documents', phase: 'start', step: 2, input: { query: 'r' } },
  ];
  expect(tickerSteps(live).map((s) => [s.step, s.phase])).toEqual([[1, 'end'], [2, 'start']]);
  // Tools outside the two searches, and unknown phases, are still dropped.
  expect(tickerSteps([{ type: 'tool', name: 'delete_all', input: {} }, { type: 'tool', name: 'search_documents', phase: 'bogus', step: 1 }])).toEqual([]);
});
