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

// F121 batch 3: a related record (an overlapping bloc, another facility) opens in place, as the
// retired dossier views allowed; a link with no row stays static text.
describe('RecordPanel related-record links', () => {
  const related = { title: 'Other bloc', detail: '12 common members', row: { id: 'b2', title: 'Other bloc' } };
  const withLinks = (links) => model({ touches: { ...model().touches, links } });
  const find = (node, cls, out = []) => {
    if (!node || typeof node !== 'object') return out;
    if (String(node.props?.className || '').split(' ').includes(cls)) out.push(node);
    for (const child of [].concat(node.props?.children ?? [])) find(child, cls, out);
    return out;
  };

  it('renders a link that carries a row as a button that selects that row', () => {
    const onSelect = vi.fn();
    const [button] = find(RecordPanel({ model: withLinks([related]), onSelect }), 'rp-xlink-open');
    expect(button.type).toBe('button');
    button.props.onClick();
    expect(onSelect).toHaveBeenCalledWith(related.row);
  });

  it('keeps it as static text when no selection handler is given', () => {
    const html = renderToStaticMarkup(<RecordPanel model={withLinks([related])} />);
    expect(html).not.toContain('rp-xlink-open');
    expect(html).toContain('rp-xlink-static');
  });
});

// F123 (owner 2026-10-13: keep the brief box until AI credits): the panel shows a saved AI brief
// when one exists, says plainly when none does, and never presents template text as AI.
describe('RecordPanel saved AI brief', () => {
  const html = (brief) => renderToStaticMarkup(<RecordPanel model={model()} brief={brief} />);

  it('shows the saved brief, labelled as a saved AI brief, in About', () => {
    const out = html({ busy: false, lines: ['Front remains attritional.', 'Watch the energy grid.'] });
    expect(out).toContain('✦ Niyantran analysis');
    expect(out).toContain('Saved AI brief');
    expect(out).toContain('Front remains attritional.');
    expect(out.indexOf('Niyantran analysis')).toBeGreaterThan(out.indexOf('02 · About this front'));
  });

  it('says when it is checking, when no brief is saved, and when the lookup failed', () => {
    expect(html({ busy: true, lines: [] })).toContain('Checking for a saved AI brief');
    expect(html({ busy: false, lines: [] })).toContain('No saved AI brief for this record yet');
    expect(html({ busy: false, lines: [], err: true })).toContain('Saved AI brief unavailable');
  });

  it('shows no brief box when the panel is given no brief state', () => {
    expect(html(undefined)).not.toContain('Niyantran analysis');
  });

  it('opens About for the brief even when the model has no About content', () => {
    const out = renderToStaticMarkup(<RecordPanel model={model({ about: { label: '02 · About' } })} brief={{ busy: false, lines: [] }} />);
    expect(out).toContain('02 · About');
    expect(out).toContain('No saved AI brief for this record yet');
  });
});

// F128 (Law reference): the clock tile is tinted, the health strip sits beside the source, and the
// Quick exit buttons hand their request to the host (which only drafts it in AI Research).
describe('RecordPanel Law additions', () => {
  const find = (node, cls, out = []) => {
    if (!node || typeof node !== 'object') return out;
    if (String(node.props?.className || '').split(' ').includes(cls)) out.push(node);
    for (const child of [].concat(node.props?.children ?? [])) find(child, cls, out);
    return out;
  };
  const law = model({
    glance: { tiles: [{ label: 'Process', value: 'CIRP' }, { label: 'Claims due', value: 'Closed', sub: '04 Sep 2026', tone: 'red', clock: true }] },
    quick: [{ label: 'Claim note', prompt: 'Draft a claim note for this announcement.' }, { label: 'Deadline sheet', prompt: 'Draft a deadline sheet.' }],
    footer: { ...model().footer, health: [['Rows', '434'], ['Claims date on row', '66%']] },
  });

  it('tints the clock tile only', () => {
    const html = renderToStaticMarkup(<RecordPanel model={law} />);
    expect(html.match(/rp-tile rp-clock/g)).toHaveLength(1);
    expect(html).toMatch(/rp-tile rp-clock"><span class="rp-tile-l">Claims due/);
  });

  it('renders the health strip inside the provenance line', () => {
    const html = renderToStaticMarkup(<RecordPanel model={law} />);
    const prov = html.slice(html.indexOf('rp-prov'), html.indexOf('</p>', html.indexOf('rp-prov')));
    expect(prov).toContain('<span class="rp-health">Rows <b>434</b></span>');
    expect(prov).toContain('Claims date on row <b>66%</b>');
  });

  it('renders Quick exit between About and What it touches, and hands each prompt to onQuick', () => {
    const html = renderToStaticMarkup(<RecordPanel model={law} onQuick={() => {}} />);
    expect(html.indexOf('Quick exit')).toBeGreaterThan(html.indexOf('02 · About this front'));
    expect(html.indexOf('Quick exit')).toBeLessThan(html.indexOf('rp-touches'));
    const onQuick = vi.fn();
    const buttons = find(RecordPanel({ model: law, onQuick }), 'rp-qbtn');
    expect(buttons).toHaveLength(2);
    buttons[1].props.onClick();
    expect(onQuick).toHaveBeenCalledWith('Draft a deadline sheet.');
  });

  it('omits Quick exit when the host gives no handler or the model has none', () => {
    expect(renderToStaticMarkup(<RecordPanel model={model()} onQuick={() => {}} />)).not.toContain('Quick exit');
    expect(find(RecordPanel({ model: law }), 'rp-qbtn')).toHaveLength(0);
  });
});
