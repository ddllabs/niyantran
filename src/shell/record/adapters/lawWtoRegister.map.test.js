import { describe, expect, it, vi } from 'vitest';

// The EU guard must hold even if the map lookup ever learns a position for the EU: mock a lookup
// that places every name, and the EU is still not a place.
vi.mock('../geoLookup.js', () => ({ countryPosition: () => ({ lat: 50, lon: 4, approximate: true }) }));
const { positionOf } = await import('./lawWtoRegister.js');

describe('WTO register map', () => {
  it('never places the European Union or the European Communities', () => {
    expect(positionOf('European Union')).toBeNull();
    expect(positionOf('European Communities')).toBeNull();
    expect(positionOf('France')).toEqual({ lat: 50, lon: 4, approximate: true });
  });
});
