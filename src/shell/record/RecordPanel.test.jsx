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

// F123 (owner 2026-10-15): every record panel has a stored AI brief, written the first time anyone
// opens the record and labelled with the date it was written. The box says plainly when it is
// being written, when it is not available, and when it failed; it never shows template text as AI.
// Owner 2026-10-15: it has the blue "Niyantran analysis" box's format and styling (.rd-ai): a lead
// brief, "Why it matters", "Watch for" and tag chips.
describe('RecordPanel AI brief', () => {
  const html = (brief) => renderToStaticMarkup(<RecordPanel model={model()} brief={brief} />);
  const READY = {
    state: 'ready',
    format: 2,
    brief: 'The front remains attritional and is rated critical.',
    why: 'The register rates its intensity as critical; it states no casualty figure.',
    watch: 'The record names no next step.',
    tags: ['Eastern Europe', 'Critical'],
    model: 'anthropic/claude-haiku-5.5',
    writtenAt: '2026-10-15T06:30:00Z',
  };
  const OLD = {
    state: 'ready',
    format: 1,
    headline: 'The front remains attritional',
    points: ['Fighting is largely static.', 'Drones define the fighting.', 'No casualty figure is recorded.'],
    model: 'anthropic/claude-haiku-5.5',
    writtenAt: '2026-10-15T06:30:00Z',
  };
  // Walks rendered elements; with `expand`, a function component inside is rendered and walked too.
  const walk = (node, test, out = [], expand = false) => {
    if (!node || typeof node !== 'object') return out;
    if (test(node)) out.push(node);
    if (expand && typeof node.type === 'function') return walk(node.type(node.props), test, out, expand);
    for (const child of [].concat(node.props?.children ?? [])) walk(child, test, out, expand);
    return out;
  };
  const cardNodes = (brief, test) => {
    const [card] = walk(RecordPanel({ model: model(), brief }), (n) => n.type?.name === 'BriefCard');
    return walk(card, test, [], true);
  };

  it('shows the brief, labelled "AI brief · written <date>", in About', () => {
    const out = html(READY);
    expect(out).toContain('✦ Niyantran analysis');
    expect(out).toContain('AI brief · written 15 Oct 2026');
    expect(out.indexOf('Niyantran analysis')).toBeGreaterThan(out.indexOf('02 · About this front'));
    expect(out).not.toMatch(/saved earlier|AI Research|Saved AI brief/);
  });

  it('has the analysis box format: lead brief, Why it matters, Watch for and tag chips, in the .rd-ai styling', () => {
    const out = html(READY);
    expect(out).toMatch(/<div class="rd-ai[ "]/);
    expect(out).toMatch(/class="rd-sec-label">✦ Niyantran analysis/);
    expect(out).toContain(`<div class="rd-ai-brief">${READY.brief}</div>`);
    expect(out).toContain(`<div class="rd-ai-sub"><span>Why it matters</span>${READY.why}</div>`);
    expect(out).toContain(`<div class="rd-ai-sub"><span>Watch for</span>${READY.watch}</div>`);
    expect(out).toContain('<div class="rd-ai-tags"><span class="rd-ai-tag">Eastern Europe</span><span class="rd-ai-tag">Critical</span></div>');
    expect(out).not.toContain('rp-brief-pts');
  });

  it('leaves out an empty Watch for and absent tags', () => {
    const out = html({ ...READY, watch: '', tags: [] });
    expect(out).toContain('Why it matters');
    expect(out).not.toContain('Watch for');
    expect(out).not.toContain('rd-ai-tags');
  });

  it('shows a brief stored before the format change (headline and points) until it is regenerated', () => {
    const out = html(OLD);
    expect(out).toContain('AI brief · written 15 Oct 2026');
    expect(out).toContain(`<div class="rd-ai-brief"><b>${OLD.headline}</b></div>`);
    expect(out).toContain('<ul class="rd-ai-bullets">');
    for (const p of OLD.points) expect(out).toContain(`<li>${p}</li>`);
  });

  it('dates the brief in India time', () => {
    expect(html({ ...READY, writtenAt: '2026-10-15T20:00:00Z' })).toContain('AI brief · written 16 Oct 2026');
  });

  it('says when it is writing, when it is not available, and when it failed', () => {
    expect(html({ state: 'loading' })).toContain('Writing AI brief…');
    expect(html({ state: 'pending' })).toContain('Writing AI brief…');
    expect(html({ state: 'unavailable' })).toContain('AI brief not available yet');
    expect(html({ state: 'error' })).toContain('AI brief unavailable right now');
    for (const state of ['loading', 'pending', 'unavailable', 'error']) {
      expect(html({ state })).not.toContain('AI brief · written');
      expect(html({ state })).toMatch(/<div class="rd-ai[ "]/);
    }
  });

  it('shows no brief box when the panel is given no brief state, or none to show', () => {
    expect(html(undefined)).not.toContain('Niyantran analysis');
    expect(html({ state: 'none' })).not.toContain('Niyantran analysis');
  });

  it('keys the points and tags by position, so two equal ones are two distinct items', () => {
    const lis = cardNodes({ ...OLD, points: ['No figure is recorded.', 'No figure is recorded.'] }, (n) => n.type === 'li');
    expect(lis).toHaveLength(2);
    expect(new Set(lis.map((i) => i.key)).size).toBe(2);
    const tags = cardNodes({ ...READY, tags: ['Critical', 'Critical'] }, (n) => n.props?.className === 'rd-ai-tag');
    expect(tags).toHaveLength(2);
    expect(new Set(tags.map((i) => i.key)).size).toBe(2);
  });

  it('opens About for the brief even when the model has no About content', () => {
    const out = renderToStaticMarkup(<RecordPanel model={model({ about: { label: '02 · About' } })} brief={{ state: 'unavailable' }} />);
    expect(out).toContain('02 · About');
    expect(out).toContain('AI brief not available yet');
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
