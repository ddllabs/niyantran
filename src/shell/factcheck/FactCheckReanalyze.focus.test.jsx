// F363: focus moves to the start screen when "Re-analyze this block" opens it (real effects, hookHarness.js).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
const { Choose, PanelBody } = await import('./FactCheckPanel.jsx');
const { elements } = await import('../hookHarness.js');

const focused = [];
beforeEach(() => {
  harness.reset(); focused.length = 0;
  let n = 0;
  harness.refFactory = () => { const id = `ref${n += 1}`; return { focus: () => focused.push(id) }; };
});
const noop = () => {};
const view = { flag: { available: true, creditsPerMinute: 500 }, balance: 20000 };
const props = (reanalysis) => ({ view, isMuted: false, onUnmute: noop, onConfirm: noop, onCancel: noop, covered: null, onShowPart: noop, sharing: true, reanalysis });

describe('start screen focus', () => {
  it('takes focus once when it opens for a re-analysis, not again on a re-render', () => {
    harness.render(Choose, props({ stretchId: 's1', minutes: 10, fromS: 130, seek: 'pending', token: 1 }));
    expect(focused).toHaveLength(1);
    harness.render(Choose, props({ stretchId: 's1', minutes: 10, fromS: 130, seek: 'late', token: 1 }));
    expect(focused).toHaveLength(1);
  });
  it('takes focus again for a new press', () => {
    harness.render(Choose, props({ stretchId: 's1', minutes: 10, fromS: 130, seek: 'ok', token: 1 }));
    harness.render(Choose, props({ stretchId: 's2', minutes: 5, fromS: 900, seek: 'pending', token: 2 }));
    expect(focused).toHaveLength(2);
  });
  it('does not take focus for the ordinary start screen', () => {
    harness.render(Choose, props(null));
    harness.render(Choose, props(undefined));
    expect(focused).toEqual([]);
  });
});

describe('the start screen is kept when the re-analysis goes away under it', () => {
  const shared = (reanalysis) => ({ phase: 'ready', error: null, unlockCreditsPerMinute: 100, stretches: [], unlocks: {}, reports: {}, covering: null, ...(reanalysis ? { reanalysis } : {}) });
  const panel = (sh) => ({
    view: { flag: { available: true, creditsPerMinute: 500, sharing: { unlockCreditsPerMinute: 100 } }, supported: true, ready: true, announcement: '', balance: 20000, rechecks: {}, shared: sh,
      session: { status: 'choosing', transcript: [], claims: [], secondsLeft: 0, silentFor: 0, skippedPieces: 0, droppedTurns: 0, error: null } },
    isMuted: false, onUnmute: noop, onConfirm: noop, onCancel: noop, onStop: noop, onRetry: noop, onDismiss: noop,
  });
  const chooseKey = (p) => [...elements(harness.render(PanelBody, p))].find((e) => e.type === Choose)?.key;
  it('a new press starts a new start screen, but sharing going off does not remount it', () => {
    const plain = chooseKey(panel(shared(null)));
    const first = chooseKey(panel(shared({ stretchId: 's1', minutes: 10, fromS: 130, seek: 'ok', token: 7 })));
    expect(first).not.toBe(plain);
    expect(chooseKey(panel(shared(null)))).toBe(first); // re-analysis cleared: same screen, the chosen length stays
    expect(chooseKey(panel(shared({ stretchId: 's2', minutes: 5, fromS: 900, seek: 'pending', token: 8 })))).not.toBe(first);
  });
});
