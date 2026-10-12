import { describe, expect, it } from 'vitest';
import chokepoints from '../../data/chokepoints.json';
import { REGION_CHOKEPOINTS, chokepointsForRegion, originCountry, othersSharing } from './touchRules.js';

// F121: "what it touches" is computed from held data by documented rules, never invented.
describe('touch rules', () => {
  const names = new Set(chokepoints.points.map((p) => p.name));

  it('maps regions only to chokepoints that exist on the chokepoint board', () => {
    for (const [region, list] of Object.entries(REGION_CHOKEPOINTS)) {
      for (const name of list) expect(names.has(name), `${region} → ${name}`).toBe(true);
    }
  });

  it('lists the chokepoints of a mapped region, and none for an unmapped one', () => {
    expect(chokepointsForRegion('Eastern Europe')).toEqual(['Kerch Strait', 'Turkish Straits (Bosphorus)']);
    expect(chokepointsForRegion('Central Asia')).toEqual([]);
    expect(chokepointsForRegion(undefined)).toEqual([]);
  });

  it('reads the origin country from the vendor field, and nothing when it is not stated', () => {
    expect(originCountry('Dassault Aviation, France')).toBe('France');
    expect(originCountry('General Atomics, USA')).toBe('USA');
    expect(originCountry('Foreign OEM + Mazagon Dock, India')).toBe('India');
    expect(originCountry('Naval Group + Mazagon Dock')).toBeNull();
    expect(originCountry('')).toBeNull();
    expect(originCountry('Iranian Navy')).toBeNull();
    expect(originCountry('Indian Navy, USAF')).toBeNull();
  });

  it('counts the other records sharing a value, case-insensitively, excluding the record itself', () => {
    const rows = [{ id: 1, region: 'Middle East' }, { id: 2, region: 'middle east' }, { id: 3, region: 'Europe' }];
    expect(othersSharing(rows, rows[0], 'region')).toBe(1);
    expect(othersSharing(rows, rows[2], 'region')).toBe(0);
    expect(othersSharing(rows, { region: '' }, 'region')).toBe(0);
  });

  it('does not count the record itself when the selection is a copy of its row', () => {
    const rows = [{ id: 'a', title: 'A', region: 'Europe' }, { id: 'b', title: 'B', region: 'Europe' }];
    expect(othersSharing(rows, { ...rows[0] }, 'region')).toBe(1);
  });
});
