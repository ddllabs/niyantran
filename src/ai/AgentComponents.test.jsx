import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ActivityTicker from './ActivityTicker.jsx';
import ModelPicker, { costHint, effortsFor, groupByVendor } from './ModelPicker.jsx';
import WorkSurface from './WorkSurface.jsx';
import CitationBubble from './CitationBubble.jsx';

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

const MODELS = [
  { model_id: 'google/gemini-3.5-flash-lite', label: 'Gemini - Lite', vendor: 'google', tier: 1, efforts: ['low', 'medium', 'high'], is_default: true },
  { model_id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek - Flash', vendor: 'deepseek', tier: 1, efforts: ['low'], is_default: false },
  { model_id: 'anthropic/claude-sonnet-5', label: 'Claude - Sonnet', vendor: 'anthropic', tier: 3, efforts: ['low', 'medium', 'high'], is_default: false },
];

describe('ActivityTicker', () => {
  const activity = [
    { type: 'activity', text: 'Searching relevant sources.' },
    { type: 'tool', name: 'search_desk_rows', phase: 'end', step: 1, input: { tier: 'national', feature: 'Bill Passage Probability Index' }, resultCount: 20, latencyMs: 320 },
  ];

  it('while active it is expanded and shows the latest step', () => {
    const html = renderToStaticMarkup(<ActivityTicker activity={activity} active />);
    expect(html).toContain('ai-ticker active');
    expect(html).toContain('Looked up · 20 rows');
    expect(html).toContain('Searching relevant sources.');
    expect(html).toContain('320ms');
  });

  it('when done it collapses and reports the buckets and a model swap', () => {
    const html = renderToStaticMarkup(
      <ActivityTicker
        activity={activity}
        timing={{ search_ms: 320, reasoning_ms: 1200, writing_ms: 800, total_ms: 2320 }}
        usage={{ reasoning_tokens: 256 }}
        model={{ requested: 'google/gemini-3.5-flash-lite', served: 'deepseek/deepseek-v4-flash' }}
      />,
    );
    expect(html).not.toContain('ai-ticker active');
    expect(html).toContain('searched 320ms');
    expect(html).toContain('thought 1.2s');
    expect(html).toContain('Answered by deepseek/deepseek-v4-flash');
  });

  it('a search for a phrase names the phrase; nothing at all renders nothing', () => {
    const html = renderToStaticMarkup(<ActivityTicker activity={[{ type: 'tool', name: 'search_documents', phase: 'start', step: 1, input: { query: 'committee stage' } }]} active />);
    expect(html).toContain('Searching documents for “committee stage”');
    expect(renderToStaticMarkup(<ActivityTicker activity={[]} />)).toBe('');
  });
});

describe('ModelPicker', () => {
  it('groups by vendor, hints at cost, and limits reasoning to what the model accepts', () => {
    expect(groupByVendor(MODELS).map((g) => g.vendor)).toEqual(['google', 'deepseek', 'anthropic']);
    expect(costHint(MODELS[0])).toBe('•');
    expect(costHint(MODELS[2])).toBe('•••');
    expect(effortsFor(MODELS, 'deepseek/deepseek-v4-flash')).toEqual(['off', 'low']);
    expect(effortsFor(MODELS, 'google/gemini-3.5-flash-lite')).toEqual(['off', 'low', 'medium', 'high']);
  });

  it('open, it lists every enabled model and only the chosen one\'s efforts', () => {
    const html = renderToStaticMarkup(<ModelPicker models={MODELS} roles={[{ role_id: 'DEFAULT_ANALYST', label: 'Default analyst', hint: 'Everyday', model_id: MODELS[0].model_id }]} value={{ modelId: 'deepseek/deepseek-v4-flash', effort: 'off' }} open />);
    for (const m of MODELS) expect(html).toContain(m.label);
    expect(html).toContain('Default analyst');
    expect(html).toContain('Low');
    expect(html).not.toContain('>Medium<');
    expect(html).not.toContain('>High<');
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
});

// R4: the ticker must not claim work the turn did not do. A real production
// turn displayed "Searching relevant sources." with search_ms 0 and a single
// `answer` step, and "thought 9.9s" with reasoning_tokens 0.
it('reports thinking only when the model produced reasoning tokens', () => {
  const timing = { search_ms: 0, reasoning_ms: 9874, writing_ms: 2061, total_ms: 11935 };
  const thought = renderToStaticMarkup(<ActivityTicker timing={timing} usage={{ reasoning_tokens: 512 }} />);
  expect(thought).toContain('thought 9.9s');
  expect(thought).not.toContain('waited');

  const waited = renderToStaticMarkup(<ActivityTicker timing={timing} usage={{ reasoning_tokens: 0 }} />);
  expect(waited).toContain('waited 9.9s');
  expect(waited).not.toContain('thought');

  // No usage at all is the same claim-nothing case.
  expect(renderToStaticMarkup(<ActivityTicker timing={timing} />)).toContain('waited 9.9s');
});

it('legacy hidden reasoning and unknown events never become public activity or tools',()=>{
 const html=renderToStaticMarkup(<ActivityTicker active activity={[{type:'reasoning',text:'PRIVATE reasoning'}, {type:'unknown',text:'PRIVATE unknown'}, {type:'tool',name:'delete_all',phase:'start',input:{query:'PRIVATE tool'}}, {type:'activity',text:'Writing the answer.'}]} />);
 expect(html).toContain('Writing the answer.');expect(html).not.toContain('PRIVATE');expect(html).not.toContain('Looking up');
});
it('only timing can render a completed summary without making unsupported failover claims',()=>{
 const html=renderToStaticMarkup(<ActivityTicker timing={{writing_ms:800}} model={{requested:'a',served:'b'}} />);
 expect(html).toContain('800ms');expect(html).toContain('b');expect(html).not.toContain('unavailable');
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
 const changes=[];const tree=ModelPicker({models:MODELS,roles:[{role_id:'FAST',label:'Fast',model_id:MODELS[1].model_id}],value:{modelId:MODELS[0].model_id,effort:'high'},open:true,onChange:v=>changes.push(v)});
 const nodes=elements(tree);nodes.find(n=>n.type==='button'&&n.props?.className?.startsWith('ai-v2-role')).props.onClick();
 nodes.find(n=>n.props?.className?.startsWith('ai-v2-model-opt')&&n.props.children[1].props.children[0].props.children==='DeepSeek - Flash').props.onClick();
 // Both paths land on the same value, and that value is now the default rather
 // than 'off': an effort the new model does not accept is an absent choice, not
 // a request for no reasoning.
 expect(changes).toEqual([{modelId:MODELS[1].model_id,effort:'low'},{modelId:MODELS[1].model_id,effort:'low'}]);
});
it('effort clicks on a fallback selection include the actual allowed model',()=>{
 const change=[];const tree=ModelPicker({models:MODELS,value:{modelId:'removed',effort:'bogus'},open:true,onChange:v=>change.push(v)});
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
 expect(renderToStaticMarkup(<ActivityTicker model={{requested:'first',served:'served-model'}}/>)).toContain('Answered by served-model');
});
