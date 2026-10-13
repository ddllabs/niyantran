import { describe, expect, it } from 'vitest';
import commodities from '../data/commodities.json';
import leaders from '../data/leaders.json';
import { commodityGroups } from './commodityGroups.js';
import { money } from './globalAid.js';
import { leadersFromPack } from './globalResources.js';
import { issuerTokens } from './sanctions.js';

// F122 G1: correctness bugs on the Global desk.

describe('Commodities search (commodityGroups)', () => {
  const feed = { rows: commodities.groups.flatMap((g) => g.items.map(([commodity, level, change, pct]) => ({ commodity, level, change, pct, group: g.g }))), meta: { groups: commodities.groups } };

  it('returns every group when nothing is searched', () => {
    expect(commodityGroups(feed, { q: '' })).toEqual(commodities.groups);
  });

  it('filters the pack groups by the search text, by commodity or by group', () => {
    const brent = commodityGroups(feed, { q: 'brent' });
    expect(brent).toEqual([{ g: 'Energy', items: [commodities.groups[0].items[0]] }]);
    const energy = commodityGroups(feed, { q: 'energy' });
    expect(energy).toEqual([commodities.groups[0]]);
    expect(commodityGroups(feed, { q: 'no such commodity' })).toEqual([]);
  });

  it('applies a chart filter the same way', () => {
    const only = commodityGroups(feed, { q: '', vizFilter: { col: 'group', value: 'Energy' } });
    expect(only.map((g) => g.g)).toEqual(['Energy']);
  });
});

describe('Global Aid money()', () => {
  it('trims trailing zeros after the decimal point', () => {
    expect(money(2.5e9)).toBe('$2.5B');
    expect(money(2e9)).toBe('$2B');
    expect(money(2.05e9)).toBe('$2.05B');
    expect(money(12.3e9)).toBe('$12.3B');
    expect(money(12e9)).toBe('$12B');
    expect(money(250e6)).toBe('$250M');
    expect(money(2.5e6)).toBe('$2.5M');
    expect(money(2e6)).toBe('$2M');
  });
});

describe('Sanctions issuerTokens', () => {
  it('matches whole tokens, so "AUS" is Australia only', () => {
    expect(issuerTokens({ issuer: 'AUS' })).toEqual(['Australia']);
    expect(issuerTokens({ issuer: 'US · EU · UK' })).toEqual(['US', 'EU', 'UK']);
    expect(issuerTokens({ issuer: 'OFAC' })).toEqual(['US']);
    expect(issuerTokens({ issuer: 'S. Korea · Japan' })).toEqual(['Japan', 'South Korea']);
    expect(issuerTokens({ issuer: 'MINUSMA' })).toEqual(['Other']);
  });
});

describe('Heads of State rows (leadersFromPack)', () => {
  it('drops a pointer row whose target is already in the pack, and nothing else', () => {
    const rows = leadersFromPack(leaders);
    expect(rows.filter((r) => r.country === 'Ukraine').map((r) => r.name)).toEqual(['Volodymyr Zelensky']);
    expect(rows).toHaveLength(leaders.leaders.filter((p) => String(p.name || '').trim()).length - 1);
  });

  it('keeps a pointer row whose target is missing', () => {
    const rows = leadersFromPack({ leaders: [{ id: 'xx2', name: 'Ruritania (see Rudolf)', country: 'Ruritania', role: 'King' }] });
    expect(rows).toHaveLength(1);
  });
});
