import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/citations.json';
import { splitCitationMarkers } from './citationMarkers.js';

// The same fixture nter.pro's website and research-chat test against (copied from
// ddllabs/niyantran/src/lib/__fixtures__/citations.json), so answers draw the same bubbles in the app.
describe('citation markers match nter.pro', () => {
  it('splits every fixture line exactly as the website does', () => {
    for (const c of fixture) expect(splitCitationMarkers(c.text), c.name).toEqual(c.markers);
  });
});
