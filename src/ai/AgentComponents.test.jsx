import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ActivityTicker from './ActivityTicker.jsx';
import AiMarkdown from './AiMarkdown.jsx';
import ModelPicker, { costHint, effortsFor, groupByVendor } from './ModelPicker.jsx';
import WorkSurface from './WorkSurface.jsx';

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

describe('AiMarkdown with citations', () => {
  it('renders a resolved marker as a bubble and keeps the prose', () => {
    const html = renderToStaticMarkup(<AiMarkdown text="It reached **committee** [1] on 12 March." sources={[TEXT_SOURCE]} />);
    expect(html).toContain('<strong>committee</strong>');
    expect(html).toContain('cite-bubble');
    expect(html).toContain('>1</button>');
    expect(html).toContain('The Delimitation Bill, 2026');
    expect(html).not.toContain('[1]');
  });

  it('a row citation is marked as one so it can open the record', () => {
    const html = renderToStaticMarkup(<AiMarkdown text="The row says Lok Sabha [2]." sources={[ROW_SOURCE]} />);
    expect(html).toContain('cite-bubble row');
    expect(html).toContain('THE DELIMITATION BILL, 2026.');
  });

  it('while streaming an unresolved marker holds a placeholder; when finished it is dropped', () => {
    const streaming = renderToStaticMarkup(<AiMarkdown text="Pending [3]." sources={[]} streaming />);
    expect(streaming).toContain('placeholder');
    const finished = renderToStaticMarkup(<AiMarkdown text="Pending [3]." sources={[]} />);
    expect(finished).not.toContain('placeholder');
    expect(finished).not.toContain('[3]');
    expect(finished).toContain('Pending');
  });

  it('markers inside headings and list items become bubbles too', () => {
    const html = renderToStaticMarkup(<AiMarkdown text={'## Finding [1]\n\n- One point [1]\n- Another'} sources={[TEXT_SOURCE]} />);
    expect(html.match(/cite-bubble/g)).toHaveLength(2);
    expect(html).toContain('<h4>');
    expect(html).toContain('<li>');
  });

  it('the legacy call renders exactly as before, leaving brackets alone', () => {
    const html = renderToStaticMarkup(<AiMarkdown text="See clause [3] of the Act." />);
    expect(html).toContain('See clause [3] of the Act.');
    expect(html).not.toContain('cite-bubble');
  });
});

describe('ActivityTicker', () => {
  const activity = [
    { type: 'reasoning', text: 'The question asks for a count.' },
    { type: 'tool', name: 'search_desk_rows', phase: 'end', step: 1, input: { tier: 'national', feature: 'Bill Passage Probability Index' }, resultCount: 20, latencyMs: 320 },
  ];

  it('while active it is expanded and shows the latest step', () => {
    const html = renderToStaticMarkup(<ActivityTicker activity={activity} active />);
    expect(html).toContain('ai-ticker active');
    expect(html).toContain('Looked up · 20 rows');
    expect(html).toContain('The question asks for a count.');
    expect(html).toContain('320ms');
  });

  it('when done it collapses and reports the buckets and a model swap', () => {
    const html = renderToStaticMarkup(
      <ActivityTicker
        activity={activity}
        timing={{ search_ms: 320, reasoning_ms: 1200, writing_ms: 800, total_ms: 2320 }}
        model={{ requested: 'google/gemini-3.5-flash-lite', served: 'deepseek/deepseek-v4-flash' }}
      />,
    );
    expect(html).not.toContain('ai-ticker active');
    expect(html).toContain('searched 320ms');
    expect(html).toContain('thought 1.2s');
    expect(html).toContain('unavailable → deepseek/deepseek-v4-flash');
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
