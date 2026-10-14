import { describe, expect, it } from 'vitest';
import { connectionMessage } from './researchChat.js';

// F66 (F171 B3): the browser's own words ("Failed to fetch", "Load failed", "NetworkError…") were
// shown to the reader when the connection dropped mid-answer.
describe('connectionMessage', () => {
  it.each([new TypeError('Failed to fetch'), new TypeError('Load failed'), new TypeError('NetworkError when attempting to fetch resource.'), new Error('network error')])('%s reads plainly', (err) => {
    const text = connectionMessage(err);
    expect(text).toBe('The connection dropped. The answer may still be finishing; it will appear here once it is saved.');
  });
  it('keeps a message the app wrote itself', () => {
    expect(connectionMessage(new Error('The connection ended before a saved result was confirmed. Reload or replay this turn.'))).toMatch(/^The connection ended/);
  });
});
