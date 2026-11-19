// F366: the fact-check panel is open by default, so its start screen opens on its own once per thing played.
import { describe, expect, it } from 'vitest';
import { shouldAutoChoose } from './autoChoose.js';

const view = (over = {}) => ({ flag: { available: true }, ready: true, supported: true, session: { status: 'idle' }, ...over });
const ok = { view: view(), playable: true, key: 'live:dd-news', done: null };

describe('shouldAutoChoose', () => {
  it('opens the start screen for something playable that has not been opened yet', () => {
    expect(shouldAutoChoose(ok)).toBe(true);
  });
  it('does it once per key, so Cancel is respected', () => {
    expect(shouldAutoChoose({ ...ok, done: 'live:dd-news' })).toBe(false);
    expect(shouldAutoChoose({ ...ok, done: 'live:other' })).toBe(true);
  });
  it('waits for everything the entry button waits for', () => {
    expect(shouldAutoChoose({ ...ok, view: null })).toBe(false);
    expect(shouldAutoChoose({ ...ok, view: view({ flag: { available: false } }) })).toBe(false);
    expect(shouldAutoChoose({ ...ok, view: view({ ready: false }) })).toBe(false);
    expect(shouldAutoChoose({ ...ok, view: view({ supported: false }) })).toBe(false);
    expect(shouldAutoChoose({ ...ok, playable: false })).toBe(false);
    expect(shouldAutoChoose({ ...ok, key: null })).toBe(false);
  });
  it('never interrupts a session in any other state', () => {
    for (const status of ['choosing', 'sharing', 'starting', 'running', 'ending', 'ended', 'error']) {
      expect(shouldAutoChoose({ ...ok, view: view({ session: { status } }) }), status).toBe(false);
    }
  });
});
