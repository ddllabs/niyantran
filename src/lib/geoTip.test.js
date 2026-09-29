// F26: point names and statuses come from desk feeds, which are untrusted text.
// The tooltip must show them as text, never parse them as HTML.
import { describe, expect, it } from 'vitest';
import { fillGeoTip, fillSiteLabel } from './geoTip.js';

function fakeTip() {
  // Every fake element throws if innerHTML is written.
  const el = (tag) => ({
    tag, textContent: '', nodes: null,
    replaceChildren(...nodes) { this.nodes = nodes; },
    set innerHTML(v) { throw Error(`innerHTML written: ${v}`); },
  });
  const doc = { createElement: el };
  const tip = el('div');
  tip.ownerDocument = doc;
  return { tip };
}

describe('fillGeoTip', () => {
  it('shows a hostile name as text', () => {
    const { tip } = fakeTip();
    const name = '<img src=x onerror=alert(1)>';
    fillGeoTip(tip, { name, statusL: '<b>Escalating</b>', intensity: 3 });
    const [bold, br, line] = tip.nodes;
    expect(bold).toMatchObject({ tag: 'b', textContent: name });
    expect(br).toMatchObject({ tag: 'br' });
    expect(line).toBe('<b>Escalating</b> · 3');
  });

  it('keeps the old layout for missing fields', () => {
    const { tip } = fakeTip();
    fillGeoTip(tip, { name: 'Hormuz' });
    expect(tip.nodes[2]).toBe(' · ');
  });
});

describe('fillSiteLabel', () => {
  it('shows hostile site fields as text inside the hover span', () => {
    const { tip: button } = fakeTip();
    const name = '<img src=x onerror=alert(1)>';
    fillSiteLabel(button, { name, country: '<i>Iran</i>', facilityKind: 'enrichment' });
    const [span] = button.nodes;
    expect(span.tag).toBe('span');
    const [first, br, line] = span.nodes;
    expect(first).toBe(name);
    expect(br).toMatchObject({ tag: 'br' });
    expect(line).toBe('<i>Iran</i> · enrichment');
  });

  it('falls back to kind when facilityKind is missing', () => {
    const { tip: button } = fakeTip();
    fillSiteLabel(button, { name: 'Natanz', country: 'Iran', kind: 'plant' });
    expect(button.nodes[0].nodes[2]).toBe('Iran · plant');
  });
});
