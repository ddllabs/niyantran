import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RecordPanel from './RecordPanel.jsx';

const model = (over = {}) => ({
  title: 'Russia–Ukraine War',
  meta: ['Eastern Europe', 'Interstate war'],
  badge: { text: 'Active', tone: 'red' },
  links: [{ label: 'Source record', href: 'https://example.org/a' }, { label: 'Bad', href: 'javascript:alert(1)' }],
  glance: {
    tiles: [
      { label: 'Intensity', value: 'Critical', sub: 'as classified', tone: 'red' },
      { label: 'Trend', value: 'Escalating', tone: 'amber' },
    ],
    callout: { tone: 'amber', text: 'Intensity is an editorial classification, not an event count.' },
  },
  about: { label: '02 · About this front', rows: [['Began', 'February 2022']], cards: [{ heading: 'Latest development', body: 'Attritional front.' }] },
  touches: {
    label: '03 · Front & what it touches',
    lanes: ['REGION', 'FRONT', 'CHOKEPOINTS', 'SAME REGION'],
    nodes: { left: { l1: 'Eastern Europe' }, center: { code: 'F', l1: 'This front', l2: 'Active' }, right: { l1: 'Kerch Strait', l2: '+1 more' } },
    links: [{ title: 'Chokepoints in play', detail: '2 on the board', to: { tab: 'global', feature: 'Maritime Choke-Points' } }],
  },
  footer: { ask: 'Ask AI about this front', provenance: { source: 'Open Fronts conflict register', asOf: '07 Sep 2026', flags: ['provenance unconfirmed'] }, note: 'A register describes a contested reality.' },
  ...over,
});

// F121: one panel renders every Global record from a model; a part the model lacks is omitted.
describe('RecordPanel', () => {
  it('renders the five parts in order', () => {
    const html = renderToStaticMarkup(<RecordPanel model={model()} />);
    const order = ['rp-head', '01 · At a glance', '02 · About this front', '03 · Front &amp; what it touches', 'rp-footer'];
    let at = -1;
    for (const part of order) {
      const i = html.indexOf(part);
      expect(i, part).toBeGreaterThan(at);
      at = i;
    }
    expect(html).toContain('<h2 class="rp-title">Russia–Ukraine War</h2>');
    expect(html).toContain('class="rp-badge rp-red">Active</span>');
    expect(html).toContain('<b>Source</b> Open Fronts conflict register');
    expect(html).toContain('<span class="rp-flag">provenance unconfirmed</span>');
  });

  it('shows only https or in-app links, and never claims to be live', () => {
    const html = renderToStaticMarkup(<RecordPanel model={model()} />);
    expect(html).toContain('href="https://example.org/a"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toMatch(/>LIVE</);
    expect(html).toContain('href="/#/global/Maritime%20Choke-Points"');
  });

  it('writes "None on record" for a touch lane with nothing behind it', () => {
    const html = renderToStaticMarkup(<RecordPanel model={model()} />);
    expect(html).toContain('None on record');
    expect(html).toContain('3 nodes on record');
  });

  it('omits about rows, touches and the callout when the model has none', () => {
    const html = renderToStaticMarkup(<RecordPanel model={model({ touches: undefined, glance: { tiles: model().glance.tiles }, about: { label: '02 · About' } })} />);
    expect(html).not.toContain('rp-touches');
    expect(html).not.toContain('rp-callout');
    expect(html).not.toContain('rp-kv');
  });

  it('ignores a visual whose type names an inherited property rather than a registered visual', () => {
    for (const type of ['toString', 'constructor']) {
      const html = renderToStaticMarkup(<RecordPanel model={model({ glance: { ...model().glance, visual: { type, title: 'x' } } })} />);
      expect(html).toContain('rp-tiles');
      expect(html).not.toContain('[object');
    }
  });

  it('asks AI and closes through its handlers', () => {
    const onAsk = vi.fn();
    const onClose = vi.fn();
    const find = (node, cls) => {
      if (!node || typeof node !== 'object') return null;
      if (node.props?.className === cls) return node;
      for (const child of [].concat(node.props?.children ?? [])) {
        const hit = find(child, cls);
        if (hit) return hit;
      }
      return null;
    };
    const tree = RecordPanel({ model: model(), onAsk, onClose });
    find(tree, 'rp-ask').props.onClick();
    find(tree, 'rp-close').props.onClick();
    expect(onAsk).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
