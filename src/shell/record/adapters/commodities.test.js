import { describe, expect, it } from 'vitest';
import pack from '../../../data/commodities.json';
import { commoditiesFromPack } from '../../../lib/globalResources.js';
import { contractProblems } from '../modelContract.js';
import { othersSharing } from '../touchRules.js';
import commodities from './commodities.js';

const rows = commoditiesFromPack(pack);
const ctx = (list = rows, feed = {}) => ({ rows: list, feed });
const withMeta = ctx(rows, { meta: { asOf: pack.meta.asOf } });
const byName = (name) => rows.find((r) => r.commodity === name);

/** Every string anywhere in a model, so a banned word cannot hide in a nested field. */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

// F121 batch 2, T14: Global Commodities. The levels are illustrative pack values, not market prices.
describe('Global Commodities adapter', () => {
  it('has real rows to test on', () => {
    expect(rows.length).toBe(24);
  });

  it('honours the panel contract for every real row, with and without feed metadata', () => {
    for (const row of rows) {
      expect(contractProblems(commodities(row, withMeta)), row.commodity).toEqual([]);
      expect(contractProblems(commodities(row, ctx())), row.commodity).toEqual([]);
    }
  });

  it('leads with level, change, group and as-of', () => {
    const model = commodities(byName('Brent crude'), withMeta);
    expect(model.title).toBe('Brent crude');
    expect(model.meta).toEqual(['Commodity benchmark', 'Energy']);
    expect(model.glance.tiles.map((t) => t.label)).toEqual(['Level (illustrative)', 'Change', 'Group', 'As of']);
    expect(model.glance.tiles.map((t) => t.value)).toEqual(['$90.4', '+4.1%', 'Energy', 'Jul 2026']);
  });

  it('shows the level string exactly as given, in every unit', () => {
    for (const row of rows) {
      const model = commodities(row, withMeta);
      expect(model.glance.tiles[0].value, row.commodity).toBe(row.level);
      expect(model.about.rows.find(([k]) => k === 'Level')[1], row.commodity).toBe(row.level);
    }
    expect(commodities(byName('TTF nat gas'), withMeta).glance.tiles[0].value).toBe('€34/MWh');
  });

  it('badges the move from the change string only when it parses', () => {
    expect(commodities(byName('Brent crude'), withMeta).badge).toEqual({ text: 'Up 4.1%', tone: 'green' });
    expect(commodities(byName('Nickel'), withMeta).badge).toEqual({ text: 'Down 1.2%', tone: 'red' });
    expect(commodities({ ...byName('Copper'), change: '0.0%' }, withMeta).badge).toEqual({ text: 'Flat', tone: 'grey' });
    expect(commodities({ ...byName('Copper'), change: '−1.5%' }, withMeta).badge).toEqual({ text: 'Down 1.5%', tone: 'red' });
    for (const change of ['', 'n/a', '4.1%', '+abc%', '+4.1']) {
      const model = commodities({ ...byName('Copper'), change }, withMeta);
      expect(model.badge, `change "${change}"`).toBeUndefined();
    }
  });

  it('keeps the change tile and touch lane as the change string, toned by direction', () => {
    const down = commodities(byName('Palladium'), withMeta);
    expect(down.glance.tiles[1]).toMatchObject({ label: 'Change', value: '-0.7%', tone: 'red' });
    expect(down.touches.nodes.right.l1).toBe('-0.7%');
    const noChange = commodities({ ...byName('Copper'), change: '' }, withMeta);
    expect(noChange.glance.tiles.map((t) => t.label)).not.toContain('Change');
    expect(noChange.touches.nodes.right).toBeUndefined();
    expect(contractProblems(noChange)).toEqual([]);
  });

  it('lists on the board only benchmarks of the same group, the selected one first', () => {
    for (const row of rows) {
      const board = commodities(row, withMeta).glance.visual;
      expect(board.type, row.commodity).toBe('board');
      const expected = rows.filter((r) => r.group === row.group).map((r) => r.commodity);
      expect(board.rows.map((r) => r.label).sort(), row.commodity).toEqual([...expected].sort());
      expect(board.rows[0].label, row.commodity).toBe(row.commodity);
      expect(board.rows[0].note, row.commodity).toMatch(/this benchmark/i);
      expect(board.rows.slice(1).every((r) => !/this benchmark/i.test(r.note || '')), row.commodity).toBe(true);
    }
    const gold = commodities(byName('Gold'), withMeta).glance.visual;
    expect(gold.rows.map((r) => r.label)).toEqual(['Gold', 'Silver', 'Platinum', 'Palladium']);
    expect(gold.rows.map((r) => r.label)).not.toContain('Brent crude');
  });

  it('writes each board row as level, change note and a tone from the change sign', () => {
    const board = commodities(byName('Gold'), withMeta).glance.visual;
    expect(board.title).toBe('Benchmark board');
    expect(board.rows[1]).toEqual({ label: 'Silver', value: '$33/oz', note: '+1.4%', tone: 'green' });
    expect(board.rows[3]).toMatchObject({ label: 'Palladium', value: '$1,040/oz', tone: 'red' });
    expect(board.rows[0]).toMatchObject({ label: 'Gold', value: '$2,720/oz', tone: 'green' });
  });

  it('captions the board as illustrative pack levels for the pack month', () => {
    const board = commodities(byName('Gold'), withMeta).glance.visual;
    expect(board.caption).toMatch(/illustrative/i);
    expect(board.caption).toContain('Jul 2026');
  });

  it('draws no board when the benchmark has no group-mates, instead of a one-row board', () => {
    const alone = commodities(byName('Gold'), ctx([byName('Gold'), byName('Brent crude')]));
    expect(alone.glance.visual).toBeUndefined();
    expect(contractProblems(alone)).toEqual([]);
    expect(commodities(byName('Gold'), ctx([])).glance.visual).toBeUndefined();
  });

  it('says plainly the levels are illustrative: amber callout and a provenance flag', () => {
    for (const row of rows) {
      const model = commodities(row, withMeta);
      expect(model.glance.callout.tone, row.commodity).toBe('amber');
      expect(model.glance.callout.text, row.commodity).toMatch(/illustrative/i);
      expect(model.footer.provenance.flags, row.commodity).toContain('illustrative levels');
    }
  });

  it('never names a licence-gated provider, or calls a level live, spot or a price today', () => {
    for (const row of rows) {
      for (const text of strings(commodities(row, withMeta))) expect(text, row.commodity).not.toMatch(/trading economics|cme|barchart|live price|spot/i);
    }
  });

  it('does not credit the World Bank as the source of the levels', () => {
    const model = commodities(byName('Brent crude'), withMeta);
    expect(model.footer.provenance.source).not.toMatch(/world bank/i);
    expect(model.footer.provenance.source).toMatch(/benchmark pack/i);
    // The row's own https link stays available as a reference, labelled as one.
    expect(model.links).toEqual([{ label: 'Background: World Bank commodity markets', href: 'https://www.worldbank.org/en/research/commodity-markets' }]);
    expect(commodities({ ...byName('Brent crude'), source_url: 'http://example.org' }, withMeta).links).toEqual([]);
  });

  it('shows no dash placeholder, bracket token, undefined or NaN, on real or sparse rows', () => {
    const sparse = [{}, { title: 'Mystery' }, { commodity: 'Mystery', group: 'Energy' }, { title: 'Mystery', level: '$1', pct: 0 }];
    for (const row of [...rows, ...sparse]) {
      const model = commodities(row, row === rows[0] ? withMeta : ctx([row, ...rows]));
      for (const text of strings(model)) expect(text, row.commodity || row.title || '(empty row)').not.toMatch(/—|\[|undefined|NaN/);
      expect(contractProblems(model), row.commodity || row.title || '(empty row)').toEqual([]);
    }
  });

  it('does not use pct, whose only established meaning is a display bar length', () => {
    const model = commodities(byName('Brent crude'), withMeta);
    expect(JSON.stringify(model)).not.toMatch(/"pct"/);
    // Same model whatever pct says: nothing in the panel depends on it.
    expect(commodities({ ...byName('Brent crude'), pct: 3 }, withMeta)).toEqual(model);
  });

  it('states the as-of as the pack month, from the feed or from the pack itself', () => {
    const row = byName('Brent crude');
    expect(commodities(row, withMeta).footer.provenance.asOf).toBe('Jul 2026');
    expect(commodities(row, ctx()).footer.provenance.asOf).toBe('Jul 2026');
    expect(commodities(row, { rows }).footer.provenance.asOf).toBe('Jul 2026');
    expect(commodities(row, ctx(rows, { meta: {} })).footer.provenance.asOf).toBe('Jul 2026');
    expect(commodities(row).footer.provenance.asOf).toBe('Jul 2026');
    // The feed wins when it carries a date.
    const later = commodities(row, ctx(rows, { meta: { asOf: '2026-08' } }));
    expect(later.footer.provenance.asOf).toBe('Aug 2026');
    expect(later.glance.tiles[3].value).toBe('Aug 2026');
    expect(later.glance.visual.caption).toContain('Aug 2026');
    expect(later.footer.provenance.flags).toEqual(['illustrative levels']);
  });

  it('uses the touch lanes group, benchmark, move and same group', () => {
    const model = commodities(byName('Brent crude'), withMeta);
    expect(model.touches.lanes).toEqual(['GROUP', 'BENCHMARK', 'MOVE', 'SAME GROUP']);
    expect(model.touches.nodes.left).toMatchObject({ l1: 'Energy' });
    expect(model.touches.nodes.center).toMatchObject({ code: 'C', l1: 'This benchmark' });
    expect(model.touches.nodes.right.l1).toBe('+4.1%');
    expect(model.touches.nodes.far.l1).toBe('5 other benchmarks');
  });

  it('counts other benchmarks of the group without counting the selection, even a copy of it', () => {
    for (const row of rows) {
      const expected = rows.filter((r) => r.group === row.group).length - 1;
      const copy = { ...row };
      for (const selected of [row, copy]) {
        const model = commodities(selected, withMeta);
        expect(othersSharing(rows, selected, 'group'), row.commodity).toBe(expected);
        expect(model.touches.nodes.far.l1, row.commodity).toBe(`${expected} other benchmarks`);
        expect(model.glance.visual.rows.length, row.commodity).toBe(expected + 1);
        expect(model.glance.visual.rows.filter((r) => r.label === row.commodity), row.commodity).toHaveLength(1);
        expect(model.touches.links[0].detail, row.commodity).toMatch(new RegExp(`^${expected} more`));
      }
    }
  });

  it('has no far node when the benchmark is alone in its group', () => {
    const model = commodities(byName('Gold'), ctx([byName('Gold')]));
    expect(model.touches.nodes.far).toBeUndefined();
    expect(model.touches.links).toEqual([]);
  });

  it('closes with Ask AI, a pack source and a note that the levels are illustrative', () => {
    const model = commodities(byName('Copper'), withMeta);
    expect(model.footer.ask).toBe('Ask AI about this benchmark');
    expect(model.footer.provenance.source).toMatch(/benchmark pack/i);
    expect(model.footer.note).toMatch(/illustrative/i);
    expect(model.about.label).toBe('02 · About this benchmark');
    expect(model.about.rows).toEqual([['Group', 'Base metals'], ['Level', '$9,850/t'], ['Change', '+1.9%']]);
  });

  it('omits an absent change from About and leaves the level as Not on record when missing', () => {
    const model = commodities({ commodity: 'Copper', group: 'Base metals', level: '', change: '' }, withMeta);
    expect(model.about.rows).toEqual([['Group', 'Base metals']]);
    expect(model.glance.tiles[0].value).toBe('Not on record');
  });
});
