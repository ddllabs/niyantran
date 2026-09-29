// F26: point names and statuses come from desk feeds, which are untrusted text.
// The tooltip must show them as text, never parse them as HTML.
import { describe, expect, it } from 'vitest';
import { fillGeoTip } from './geoTip.js';

function fakeTip() {
  const created = [];
  const doc = { createElement: (tag) => { const el = { tag, textContent: '' }; created.push(el); return el; } };
  const tip = {
    ownerDocument: doc,
    nodes: null,
    replaceChildren(...nodes) { this.nodes = nodes; },
    set innerHTML(v) { throw Error(`innerHTML written: ${v}`); },
  };
  return { tip, created };
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
