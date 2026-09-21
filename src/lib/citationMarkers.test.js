import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/citations.json';
import { parseCitationIds, splitCitationMarkers } from './citationMarkers.js';

describe('citationMarkers (client mirror)', () => {
  it('splits every fixture line into the same markers the server expands to', () => {
    for (const c of fixture) {
      expect(splitCitationMarkers(c.text), c.name).toEqual(c.markers);
      const joined = c.markers.map((m) => (typeof m === 'string' ? m : `[${m.citation}]`)).join('');
      expect(joined, c.name).toBe(c.expanded);
    }
  });

  it('applies the same limits as the server', () => {
    expect(parseCitationIds('1-6')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseCitationIds('1-7')).toEqual([]);
    expect(parseCitationIds('99')).toEqual([99]);
    expect(parseCitationIds('100')).toEqual([]);
  });

  it('returns a single string for text without markers and nothing for empty input', () => {
    expect(splitCitationMarkers('plain')).toEqual(['plain']);
    expect(splitCitationMarkers('')).toEqual([]);
    expect(splitCitationMarkers(null)).toEqual([]);
  });
});
