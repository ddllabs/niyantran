// F360 T3: focus handling of the delete confirmation and the heading, with real effects (hookHarness.js).
// Every ref is an element stand-in that records focus().
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../../lib/supabaseClient.js', () => ({ supabase: {}, accessToken: async () => null, functionsUrl: () => '' }));
const { DeleteControl, PastSessionsView } = await import('./PastSessions.jsx');

const focused = [];
beforeEach(() => {
  harness.reset(); focused.length = 0;
  let n = 0;
  harness.refFactory = () => { const id = `ref${n += 1}`; return { focus: () => focused.push(id) }; };
});
const noop = () => {};
const session = { id: 's1', video_kind: 'live' };
const control = (removal) => harness.render(DeleteControl, { session, removal, onAsk: noop, onCancel: noop, onConfirm: noop });

describe('delete confirmation focus', () => {
  it('moves focus to Keep when the question opens, and back to Delete when it closes', () => {
    control(null);
    expect(focused).toEqual([]);
    control({ id: 's1', phase: 'confirm' });
    expect(focused).toHaveLength(1);
    const keepRef = focused[0];
    control({ id: 's1', phase: 'confirm' }); // a re-render does not take focus again
    expect(focused).toEqual([keepRef]);
    control(null);
    expect(focused).toHaveLength(2);
    expect(focused[1]).not.toBe(keepRef);
  });

  it('does not take focus for a different session being asked about', () => {
    control({ id: 'other', phase: 'confirm' });
    expect(focused).toEqual([]);
  });
});

describe('the heading', () => {
  const past = (notice) => ({ phase: 'ready', rows: [], hasMore: false, notice, retry: noop });
  it('takes focus once after a deletion, not otherwise', () => {
    harness.render(PastSessionsView, { past: past(''), channels: [] });
    expect(focused).toEqual([]);
    harness.render(PastSessionsView, { past: past('deleted'), channels: [] });
    expect(focused).toHaveLength(1);
    harness.render(PastSessionsView, { past: past('deleted'), channels: [] });
    expect(focused).toHaveLength(1);
  });
});
