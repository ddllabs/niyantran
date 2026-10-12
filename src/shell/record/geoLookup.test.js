import { describe, expect, it } from 'vitest';
import warTracker from '../../../public/data/embedded_csv/geopolitics_war_tracker.json';
import infra from '../../data/infra-projects.json';
import procurement from '../../../public/data/embedded_csv/geopolitics_defense_procurement.json';
import { countryPosition, regionPosition } from './geoLookup.js';
import { originCountry } from './touchRules.js';

// F121: maps place a record honestly. Region- and country-level positions are approximate by
// construction, so every one of them says so; an unknown place returns nothing, never a guess.
describe('approximate positions', () => {
  it('places every Open Fronts region, marked approximate', () => {
    for (const region of new Set(warTracker.map((r) => r.region))) {
      const pos = regionPosition(region);
      expect(pos, region).toMatchObject({ approximate: true });
      expect(pos.lat).toBeGreaterThanOrEqual(-90);
      expect(pos.lat).toBeLessThanOrEqual(90);
      expect(pos.lon).toBeGreaterThanOrEqual(-180);
      expect(pos.lon).toBeLessThanOrEqual(180);
    }
  });

  it('places every country the batch 1 registers name', () => {
    const countries = new Set([
      ...infra.projects.map((p) => p.country),
      ...procurement.map((r) => originCountry(r.vendor_or_origin)).filter(Boolean),
    ]);
    for (const country of countries) expect(countryPosition(country), country).toMatchObject({ approximate: true });
  });

  it('returns null for an unknown or empty place', () => {
    expect(regionPosition('Atlantis')).toBeNull();
    expect(countryPosition('')).toBeNull();
    expect(countryPosition(undefined)).toBeNull();
  });
});
