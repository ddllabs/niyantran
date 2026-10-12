import { describe, expect, it } from 'vitest';
import { countryPosition } from '../geoLookup.js';
import { contractProblems } from '../modelContract.js';
import growthIndicators from './growthIndicators.js';
import globalTrade from './globalTrade.js';

/**
 * F121 batch 2: Growth Indicators and Global Trade (World Bank open data).
 *
 * Live data is not in the repository, so these fixtures copy the row shapes the loaders return
 * (the values are test values; the shapes are exact):
 *  - growth rows: server/resourcesApi.mjs lines 105-113 (loadGrowth). title and country are the
 *    World Bank country name, year is GDP growth's latest year, gdp_growth is a one-decimal
 *    string, inflation and unemployment are a one-decimal string or the literal "—".
 *  - trade rows: server/resourcesApi.mjs lines 131-139 (loadTrade). exports_bn is en-IN grouped
 *    US$ billions or '', exports_raw is the API number, trade_gdp is a one-decimal string or "—".
 * Rows are deliberately out of order: the loaders sort, but the adapters must not rely on it.
 */
const GROWTH_URL = 'https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG';
const growth = (country, year, gdp, cpi, uem) => ({ title: country, country, year, gdp_growth: gdp, inflation: cpi, unemployment: uem, source_url: GROWTH_URL });
const growthRows = [
  growth('India', '2025', '7.4', '4.2', '4.9'),
  growth('Germany', '2024', '-0.5', '2.3', '3.1'),
  growth('Turkiye', '2025', '10.2', '58.5', '8.4'), // "10.2" sorts before "7.4" as text
  growth('Korea, Rep.', '2025', '1.3', '—', '—'), // both optional series missing
  growth('United States', '2025', '2.1', '—', '4.2'),
  growth('Russian Federation', '2025', '1.3', '8.5', '2.6'), // ties Korea, Rep. on GDP growth
  growth('Japan', '2025', '-0.3', '2.7', '2.5'),
];

const TRADE_URL = 'https://data.worldbank.org/indicator/TX.VAL.MRCH.CD.WT';
const trade = (country, year, raw, share) => ({
  title: country,
  country,
  year,
  exports_bn: Number.isFinite(raw / 1e9) ? (raw / 1e9).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '',
  exports_raw: raw,
  trade_gdp: share,
  source_url: TRADE_URL,
});
const tradeRows = [
  trade('India', '2025', 4.37e11, '45.2'),
  trade('China', '2025', 3.577e12, '37.0'),
  trade('Korea, Rep.', '2025', 6.84e11, '77.6'), // ties Italy on exports
  trade('Germany', '2025', 1.688e12, '86.9'),
  trade('Italy', '', 6.84e11, '63.4'), // no year on record
  trade('United States', '2025', 2.065e12, '—'), // trade share missing
  trade('Japan', '2025', 7.43e11, '—'),
];

const ctx = (rows) => ({ rows, feed: { rows } });
const pick = (rows, country) => rows.find((r) => r.country === country);

/** Every string anywhere in a model. */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** No rendered string may show a missing value as a dash, a bracket token, or a leaked JS value. */
function leaks(model) {
  return strings(model).filter((s) => /—|\[|undefined|NaN|null/.test(s));
}

describe.each([
  ['Growth Indicators', growthIndicators, growthRows, 'GDP growth'],
  ['Global Trade', globalTrade, tradeRows, 'Merchandise exports'],
])('%s adapter (shared behaviour)', (name, adapter, rows, headline) => {
  it('honours the panel contract for every fixture row', () => {
    for (const row of rows) expect(contractProblems(adapter(row, ctx(rows))), row.country).toEqual([]);
  });

  it('never renders a dash, bracket, undefined or NaN, for any row', () => {
    for (const row of rows) expect(leaks(adapter(row, ctx(rows))), row.country).toEqual([]);
  });

  it('survives a bare row with no context', () => {
    const model = adapter(rows[0]);
    expect(contractProblems(model)).toEqual([]);
    expect(leaks(model)).toEqual([]);
  });

  it('names the provider and calls the series annual, never forecast, monthly or live', () => {
    const model = adapter(rows[0], ctx(rows));
    expect(model.footer.ask).toBe('Ask AI about this economy');
    expect(model.footer.provenance.source).toBe('World Bank open data (World Development Indicators)');
    expect(model.footer.note).toMatch(/annual/i);
    expect(model.footer.note).toMatch(/not forecasts or nowcasts/i);
    expect(model.footer.note).not.toMatch(/\b(live|real-time)\b/i);
  });

  it('draws a map exactly when the country lookup knows the country, and never otherwise', () => {
    for (const row of rows) {
      const model = adapter(row, ctx(rows));
      const where = countryPosition(row.country);
      if (where) {
        expect(model.glance.visual2, row.country).toMatchObject({ type: 'map', points: [{ lat: where.lat, lon: where.lon, approximate: true, main: true, label: row.country }] });
        expect(model.glance.visual2.caption).toMatch(/approximate|country level/i);
      } else {
        expect(model.glance.visual2, row.country).toBeUndefined();
      }
    }
    expect(adapter(pick(rows, 'India'), ctx(rows)).glance.visual2).toBeDefined();
    const unknown = { ...rows[0], country: 'Narnia', title: 'Narnia' };
    expect(adapter(unknown, ctx(rows)).glance.visual2).toBeUndefined();
  });

  it('does not repeat the board in the tiles: only the headline series is both', () => {
    for (const row of rows) {
      const model = adapter(row, ctx(rows));
      const boardLabels = model.glance.visual.rows.map((r) => r.label);
      const repeated = model.glance.tiles.map((t) => t.label).filter((l) => boardLabels.includes(l) && l !== headline);
      expect(repeated, row.country).toEqual([]);
      expect(model.glance.tiles.map((t) => t.label)).toContain(headline);
    }
  });

  it('has no About row that repeats the title', () => {
    for (const row of rows) {
      const model = adapter(row, ctx(rows));
      expect(model.about.rows.map(([k]) => k), row.country).not.toContain('Economy');
    }
  });

  it('puts the board in the first visual slot, ahead of the map', () => {
    const model = adapter(pick(rows, 'India'), ctx(rows));
    expect(model.glance.visual).toMatchObject({ type: 'board', title: 'Latest published values' });
  });
});

describe('Growth Indicators panel', () => {
  const model = (country, rows = growthRows) => growthIndicators(pick(rows, country), ctx(rows));

  it('leads with GDP growth, its rank and the latest year; the board carries the series', () => {
    const m = model('India');
    expect(m.title).toBe('India');
    expect(m.meta).toEqual(['Growth indicators', '2025']);
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['GDP growth', 'Rank on GDP growth', 'Latest year']);
    expect(m.glance.tiles.map((t) => t.value)).toEqual(['7.4%', '2nd of 7', '2025']);
    expect(m.links).toEqual([{ label: 'World Bank: GDP growth series', href: GROWTH_URL }]);
  });

  it('lists one board row per series, with its value and unit', () => {
    const rows = model('India').glance.visual.rows;
    expect(rows.map((r) => r.label)).toEqual(['GDP growth', 'Inflation', 'Unemployment']);
    expect(rows.map((r) => r.value)).toEqual(['7.4%', '4.2%', '4.9%']);
    expect(rows[0].note).toMatch(/annual/i);
    expect(rows[0].note).toMatch(/2025/);
  });

  it('tones only a fall in output: negative GDP growth is red, everything else is untoned', () => {
    const japan = model('Japan');
    expect(japan.glance.tiles[0]).toMatchObject({ value: '-0.3%', tone: 'red' });
    expect(japan.glance.visual.rows[0]).toMatchObject({ value: '-0.3%', tone: 'red' });
    const india = model('India');
    expect(india.glance.tiles.every((t) => !t.tone)).toBe(true);
    expect(india.glance.visual.rows.every((r) => !r.tone)).toBe(true);
    expect(japan.glance.tiles.slice(1).every((t) => !t.tone)).toBe(true);
    expect(japan.glance.tiles[1].value).toBe('6th of 7');
    // Weak or zero growth is not a fall, and high inflation is not toned either: no judgements.
    for (const country of ['United States', 'Korea, Rep.', 'Turkiye']) {
      const m = model(country);
      expect(m.glance.tiles.every((t) => !t.tone), country).toBe(true);
      expect(m.glance.visual.rows.every((r) => !r.tone), country).toBe(true);
    }
    const flat = growthIndicators({ ...pick(growthRows, 'India'), gdp_growth: '0.0' }, ctx(growthRows));
    expect(flat.glance.tiles[0].tone).toBeUndefined();
    const dip = growthIndicators({ ...pick(growthRows, 'India'), gdp_growth: '-0.0' }, ctx(growthRows));
    expect(dip.glance.tiles[0].tone).toBeUndefined();
  });

  it('says "Not on record" for missing inflation and unemployment, never a dash', () => {
    const m = model('Korea, Rep.');
    expect(m.glance.tiles.map((t) => t.value)).toEqual(['1.3%', 'joint 4th of 7', '2025']);
    expect(m.glance.visual.rows.map((r) => r.value)).toEqual(['1.3%', 'Not on record', 'Not on record']);
    expect(leaks(m)).toEqual([]);
    const us = model('United States');
    expect(us.glance.visual.rows.map((r) => r.value)).toEqual(['2.1%', 'Not on record', '4.2%']);
  });

  it('does not claim the three series share the year, and the caption says so', () => {
    const m = model('India');
    expect(m.glance.visual.caption).toMatch(/one year/i);
    expect(m.glance.visual.caption).toMatch(/not (asserted|claimed) to share/i);
    // Only GDP growth is dated; the other two rows carry a unit, not the year.
    expect(m.glance.visual.rows[1].note).not.toMatch(/2025/);
    expect(m.glance.visual.rows[2].note).not.toMatch(/2025/);
    expect(m.glance.tiles[2].sub).toMatch(/GDP growth/);
  });

  it('ranks GDP growth numerically, whatever the row order', () => {
    expect(model('Turkiye').touches.nodes.right).toMatchObject({ l1: '1st of 7', l2: 'on GDP growth' });
    expect(model('India').touches.nodes.right.l1).toBe('2nd of 7');
    expect(model('United States').touches.nodes.right.l1).toBe('3rd of 7');
    expect(model('Germany').touches.nodes.right.l1).toBe('7th of 7');
    // Same answer from a reversed copy of the rows.
    const reversed = [...growthRows].reverse();
    expect(model('India', reversed).touches.nodes.right.l1).toBe('2nd of 7');
    expect(model('Turkiye', reversed).touches.nodes.right.l1).toBe('1st of 7');
  });

  it('calls a tie joint, for both rows in it', () => {
    expect(model('Korea, Rep.').touches.nodes.right.l1).toBe('joint 4th of 7');
    expect(model('Russian Federation').touches.nodes.right.l1).toBe('joint 4th of 7');
  });

  it('counts other economies whose latest year is the same, excluding itself', () => {
    expect(model('India').touches.nodes.far).toMatchObject({ l1: '5 other economies', l2: 'also 2025' });
    expect(model('Germany').touches.nodes.far).toBeUndefined(); // the only 2024 row
  });

  it('has the spec lanes, a centre node for the economy, and the country on the left', () => {
    const t = model('India').touches;
    expect(t.lanes).toEqual(['ECONOMY', 'SERIES', 'RANK', 'SAME YEAR']);
    expect(t.nodes.left).toEqual({ l1: 'India' });
    expect(t.nodes.center).toMatchObject({ code: 'G', l1: 'This economy' });
    expect(t.links.some((l) => /3 others|rank/i.test(`${l.title} ${l.detail}`))).toBe(true);
  });

  it('omits the rank when there is nothing to compare, or the row has no GDP growth', () => {
    expect(growthIndicators(growthRows[0], ctx([growthRows[0]])).touches.nodes.right).toBeUndefined();
    expect(growthIndicators(growthRows[0]).touches.nodes.right).toBeUndefined();
    const noGdp = { ...pick(growthRows, 'India'), gdp_growth: '' };
    const m = growthIndicators(noGdp, ctx(growthRows));
    expect(m.touches.nodes.right).toBeUndefined();
    expect(m.glance.tiles.map((t) => t.value)).toEqual(['Not on record', 'Not on record', '2025']);
    expect(contractProblems(m)).toEqual([]);
  });

  it('works when the selection is a copy of its feed row', () => {
    const copy = { ...pick(growthRows, 'India') };
    const m = growthIndicators(copy, ctx(growthRows));
    expect(m.touches.nodes.right.l1).toBe('2nd of 7');
    expect(m.touches.nodes.far.l1).toBe('5 other economies');
  });

  it('writes the as-of as the data year, or flags that it is not on record', () => {
    expect(model('India').footer.provenance).toMatchObject({ asOf: '2025 (latest published year)' });
    expect(model('India').footer.provenance.flags || []).not.toContain('as-of not on record');
    const noYear = growthIndicators({ ...pick(growthRows, 'India'), year: '' }, ctx(growthRows));
    expect(noYear.footer.provenance.asOf || '').toBe('');
    expect(noYear.footer.provenance.flags).toContain('as-of not on record');
    expect(noYear.glance.tiles[2].value).toBe('Not on record');
    expect(noYear.touches.nodes.far).toBeUndefined();
    expect(contractProblems(noYear)).toEqual([]);
  });

  it('treats a year that is not a four-digit year as not on record', () => {
    const junk = growthIndicators({ ...pick(growthRows, 'India'), year: 'n/a' }, ctx(growthRows));
    expect(junk.meta).toEqual(['Growth indicators']);
    expect(junk.glance.tiles[2].value).toBe('Not on record');
    expect(junk.footer.provenance.flags).toContain('as-of not on record');
    expect(strings(junk).some((s) => /n\/a/.test(s))).toBe(false);
  });
});

describe('Global Trade panel', () => {
  const model = (country, rows = tradeRows) => globalTrade(pick(rows, country), ctx(rows));

  it('leads with exports, export rank and the latest year; the board carries both series', () => {
    const m = model('Germany');
    expect(m.title).toBe('Germany');
    expect(m.meta).toEqual(['Global trade', '2025']);
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Merchandise exports', 'Export rank', 'Latest year']);
    expect(m.glance.tiles.map((t) => t.value)).toEqual(['US$ 1,688 bn', '3rd of 7', '2025']);
    expect(m.links).toEqual([{ label: 'World Bank: merchandise exports series', href: TRADE_URL }]);
  });

  it('lists the two series on the board', () => {
    const rows = model('Germany').glance.visual.rows;
    expect(rows.map((r) => r.label)).toEqual(['Merchandise exports', 'Trade share of GDP']);
    expect(rows.map((r) => r.value)).toEqual(['US$ 1,688 bn', '86.9%']);
    expect(rows[0].note).toMatch(/current US\$/);
    expect(model('Germany').glance.visual.caption).toMatch(/one year/i);
  });

  it('applies no tone: exports and trade share are not good or bad in themselves', () => {
    for (const row of tradeRows) {
      const m = globalTrade(row, ctx(tradeRows));
      expect(m.glance.tiles.every((t) => !t.tone), row.country).toBe(true);
      expect(m.glance.visual.rows.every((r) => !r.tone), row.country).toBe(true);
    }
  });

  it('says "Not on record" for a missing trade share, never a dash', () => {
    const m = model('United States');
    expect(m.glance.tiles.map((t) => t.value)).toEqual(['US$ 2,065 bn', '2nd of 7', '2025']);
    expect(m.glance.visual.rows.map((r) => r.value)).toEqual(['US$ 2,065 bn', 'Not on record']);
    expect(m.touches.nodes.far).toBeUndefined();
    expect(leaks(m)).toEqual([]);
  });

  it('says "Not on record" for missing exports and gives no rank', () => {
    const blank = { ...pick(tradeRows, 'India'), exports_bn: '', exports_raw: 'n/a' };
    const m = globalTrade(blank, ctx(tradeRows));
    expect(m.glance.tiles.map((t) => t.value)).toEqual(['Not on record', 'Not on record', '2025']);
    expect(m.glance.visual.rows.map((r) => r.value)).toEqual(['Not on record', '45.2%']);
    expect(m.touches.nodes.right).toBeUndefined();
    expect(m.touches.nodes.center.l2 || '').not.toMatch(/US\$/);
    expect(contractProblems(m)).toEqual([]);
    expect(leaks(m)).toEqual([]);
  });

  it('ranks exports numerically on exports_raw, whatever the row order or the grouped text', () => {
    // "1,688" and "3,577" sort after "437" as text; the rank must not.
    expect(model('China').touches.nodes.right).toMatchObject({ l1: '1st of 7', l2: 'on merchandise exports' });
    expect(model('United States').touches.nodes.right.l1).toBe('2nd of 7');
    expect(model('Germany').touches.nodes.right.l1).toBe('3rd of 7');
    expect(model('Japan').touches.nodes.right.l1).toBe('4th of 7');
    expect(model('India').touches.nodes.right.l1).toBe('7th of 7');
    const reversed = [...tradeRows].reverse();
    expect(model('China', reversed).touches.nodes.right.l1).toBe('1st of 7');
    expect(model('India', reversed).touches.nodes.right.l1).toBe('7th of 7');
    expect(model('India', reversed).glance.tiles[1].value).toBe('7th of 7');
  });

  it('calls a tie joint, for both rows in it', () => {
    expect(model('Korea, Rep.').touches.nodes.right.l1).toBe('joint 5th of 7');
    expect(model('Italy').touches.nodes.right.l1).toBe('joint 5th of 7');
  });

  it('has the spec lanes, with the trade share of GDP on the far node', () => {
    const t = model('Germany').touches;
    expect(t.lanes).toEqual(['ECONOMY', 'EXPORTS', 'RANK', 'OPENNESS']);
    expect(t.nodes.left).toEqual({ l1: 'Germany' });
    expect(t.nodes.center).toMatchObject({ code: 'T', l1: 'This economy', l2: 'US$ 1,688 bn' });
    expect(t.nodes.far).toMatchObject({ l1: '86.9% of GDP', l2: 'trade share' });
  });

  it('works when the selection is a copy of its feed row', () => {
    const m = globalTrade({ ...pick(tradeRows, 'Germany') }, ctx(tradeRows));
    expect(m.touches.nodes.right.l1).toBe('3rd of 7');
    expect(globalTrade(tradeRows[0]).touches.nodes.right).toBeUndefined();
    expect(globalTrade(tradeRows[0], ctx([tradeRows[0]])).touches.nodes.right).toBeUndefined();
  });

  it('writes the as-of as the data year, or flags that it is not on record', () => {
    expect(model('Germany').footer.provenance).toMatchObject({ asOf: '2025 (latest published year)' });
    const italy = model('Italy');
    expect(italy.footer.provenance.asOf || '').toBe('');
    expect(italy.footer.provenance.flags).toContain('as-of not on record');
    expect(italy.meta).toEqual(['Global trade']);
    expect(italy.glance.tiles[2].value).toBe('Not on record');
    expect(italy.glance.tiles[1].value).toBe('joint 5th of 7');
    expect(contractProblems(italy)).toEqual([]);
    const junk = globalTrade({ ...pick(tradeRows, 'Germany'), year: 'n/a' }, ctx(tradeRows));
    expect(junk.meta).toEqual(['Global trade']);
    expect(junk.footer.provenance.flags).toContain('as-of not on record');
    expect(strings(junk).some((s) => /n\/a/.test(s))).toBe(false);
  });
});
