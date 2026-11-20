// F360 T2: the REAL usePastSessions hook with real effects (hookHarness.js) over a recording fake client.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness } from '../hookHarness.js';
import { fakePastClient } from './pastSessionsFake.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
const { usePastSessions } = await import('./usePastSessions.js');

const session = (n, over = {}) => ({
  id: `s${n}`, video_id: 'v', channel_id: 'dd-news', video_kind: 'live', started_at: '2026-11-18T10:00:00Z',
  minutes_used: 5, credits_charged: 2500, status: 'settled', ...over,
});
const claim = (id, over = {}) => ({ id, session_id: 's1', spoken_at: '2026-11-18T10:00:00Z', checked_at: '2026-11-18T10:01:00Z', supersedes: null, hidden_at: null, claim_en: id, ...over });
const RAW = 'FATAL: password authentication failed';

// Answers by table and by whether the call deleted; `state` can be changed between steps.
function world(state = {}) {
  const w = {
    sessions: [session(1)], claims: [claim('a')], sessionsError: false, claimsError: false, hold: null, deleteGate: null, deleteOk: true, deleted: [], ...state,
  };
  w.client = fakePastClient(async ({ table, calls }) => {
    if (table === 'factcheck_sessions' && calls.some((c) => c[0] === 'delete')) {
      if (w.deleteGate) await w.deleteGate;
      if (!w.deleteOk) return { error: { message: RAW } };
      const id = calls.find((c) => c[0] === 'eq' && c[1] === 'id')[2];
      w.deleted.push(id);
      w.sessions = w.sessions.filter((s) => s.id !== id);
      return { data: [{ id }] };
    }
    if (table === 'factcheck_sessions') {
      const offset = calls.find((c) => c[0] === 'range')[1];
      const answer = w.sessionsError ? { error: { message: RAW } } : { data: w.sessions };
      return offset > 0 && w.hold ? w.hold.then(() => answer) : answer;
    }
    return w.claimsError ? { error: { message: RAW } } : { data: w.claims };
  });
  return w;
}
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
let props;
const render = () => harness.render(usePastSessions, props);
const settle = async () => { render(); await flush(); return render(); };

beforeEach(() => { harness.reset(); props = {}; });

describe('loading the list', () => {
  it('starts loading, then shows the rows', async () => {
    const w = world(); props = { client: w.client };
    expect(render().phase).toBe('loading');
    const s = await settle();
    expect(s.phase).toBe('ready');
    expect(s.rows.map((r) => r.id)).toEqual(['s1']);
    expect(s.hasMore).toBe(false);
  });

  it('is empty when there are no settled sessions', async () => {
    const w = world({ sessions: [] }); props = { client: w.client };
    const s = await settle();
    expect(s.phase).toBe('ready');
    expect(s.rows).toEqual([]);
  });

  it('is an error state with no server text, and Try again loads it', async () => {
    const w = world({ sessionsError: true }); props = { client: w.client };
    const s = await settle();
    expect(s.phase).toBe('error');
    expect(JSON.stringify(s)).not.toContain('password');
    w.sessionsError = false;
    s.retry();
    const after = await settle();
    expect(after.phase).toBe('ready');
    expect(after.rows).toHaveLength(1);
  });

  it('Show more asks for the next page and appends it; a failure keeps the rows and says so', async () => {
    const w = world({ sessions: Array.from({ length: 21 }, (_, i) => session(i)) }); props = { client: w.client };
    let s = await settle();
    expect(s.rows).toHaveLength(20);
    expect(s.hasMore).toBe(true);
    w.sessions = [session(30)];
    s.showMore();
    s = await settle();
    expect(s.rows).toHaveLength(21);
    expect(s.hasMore).toBe(false);
    const ranges = w.client.log.map((e) => e.calls.find((c) => c[0] === 'range')).filter(Boolean);
    expect(ranges[1].slice(1)).toEqual([20, 40]);

    const w2 = world({ sessions: Array.from({ length: 21 }, (_, i) => session(i)) }); props = { client: w2.client };
    harness.reset();
    s = await settle();
    w2.sessionsError = true;
    s.showMore();
    s = await settle();
    expect(s.rows).toHaveLength(20);
    expect(s.moreFailed).toBe(true);
  });
});

describe('reload when a session ends (D9)', () => {
  it('reloads once when the page session goes from running to ended', async () => {
    const w = world(); props = { client: w.client, sessionStatus: 'running' };
    await settle();
    const before = w.client.log.length;
    props = { client: w.client, sessionStatus: 'ended' };
    w.sessions = [session(1), session(2)];
    const s = await settle();
    expect(w.client.log.length).toBe(before + 1);
    expect(s.rows).toHaveLength(2);
    props = { client: w.client, sessionStatus: 'ended' };
    await settle();
    expect(w.client.log.length).toBe(before + 1);
  });

  it('does not reload for other changes, or when mounted already ended', async () => {
    const w = world(); props = { client: w.client, sessionStatus: 'ended' };
    await settle();
    expect(w.client.log).toHaveLength(1);
    props = { client: w.client, sessionStatus: 'idle' };
    await settle();
    props = { client: w.client, sessionStatus: 'starting' };
    await settle();
    expect(w.client.log).toHaveLength(1);
  });

  it('keeps showing the rows while reloading', async () => {
    const w = world(); props = { client: w.client, sessionStatus: 'running' };
    await settle();
    props = { client: w.client, sessionStatus: 'error' };
    expect(render().rows).toHaveLength(1);
  });
});

describe('opening a row', () => {
  it('loads that session claims only when opened, and closing then reopening does not fetch again', async () => {
    const w = world(); props = { client: w.client };
    let s = await settle();
    expect(w.client.log.filter((e) => e.table === 'factcheck_claims')).toHaveLength(0);
    s.toggle('s1');
    s = render();
    expect(s.openId).toBe('s1');
    expect(s.details.s1.phase).toBe('loading');
    s = await settle();
    expect(s.details.s1.phase).toBe('ready');
    expect(s.details.s1.claims.map((c) => c.id)).toEqual(['a']);
    s.toggle('s1');
    expect(render().openId).toBe(null);
    render().toggle('s1');
    await settle();
    expect(w.client.log.filter((e) => e.table === 'factcheck_claims')).toHaveLength(1);
  });

  it('a claims failure is an error with no server text, and Try again loads it', async () => {
    const w = world({ claimsError: true }); props = { client: w.client };
    let s = await settle();
    s.toggle('s1');
    s = await settle();
    expect(s.details.s1.phase).toBe('error');
    expect(JSON.stringify(s.details)).not.toContain('password');
    w.claimsError = false;
    s.retryDetail('s1');
    s = await settle();
    expect(s.details.s1.phase).toBe('ready');
  });
});

describe('deleting', () => {
  it('needs two steps: ask, then confirm; cancel leaves the row', async () => {
    const w = world(); props = { client: w.client };
    let s = await settle();
    s.askDelete('s1');
    s = render();
    expect(s.removal).toEqual({ id: 's1', phase: 'confirm' });
    expect(w.deleted).toEqual([]);
    s.cancelDelete();
    s = render();
    expect(s.removal).toBe(null);
    expect(s.rows).toHaveLength(1);
    expect(w.deleted).toEqual([]);
  });

  it('confirm deletes the session, removes the row, and announces it', async () => {
    const w = world(); props = { client: w.client };
    let s = await settle();
    s.toggle('s1');
    s = await settle();
    s.askDelete('s1');
    render().confirmDelete('s1');
    s = await settle();
    expect(w.deleted).toEqual(['s1']);
    expect(s.rows).toEqual([]);
    expect(s.openId).toBe(null);
    expect(s.removal).toBe(null);
    expect(s.notice).toBe('deleted');
  });

  it('a failed delete keeps the row and shows a plain error', async () => {
    const w = world({ deleteOk: false }); props = { client: w.client };
    let s = await settle();
    s.askDelete('s1');
    render().confirmDelete('s1');
    s = await settle();
    expect(s.rows).toHaveLength(1);
    expect(s.removal).toEqual({ id: 's1', phase: 'error' });
    expect(JSON.stringify(s)).not.toContain('password');
  });

  it('a recorded session cannot be asked about or deleted', async () => {
    const w = world({ sessions: [session(1, { video_kind: 'recorded' })] }); props = { client: w.client };
    let s = await settle();
    s.askDelete('s1');
    s = render();
    expect(s.removal).toBe(null);
    s.confirmDelete('s1');
    await settle();
    expect(w.client.log.some((e) => e.calls.some((c) => c[0] === 'delete'))).toBe(false);
  });

  it('confirm without a prior ask does nothing', async () => {
    const w = world(); props = { client: w.client };
    const s = await settle();
    s.confirmDelete('s1');
    await settle();
    expect(w.deleted).toEqual([]);
  });
});

describe('unmounting', () => {
  it('makes no state change after unmount', async () => {
    const w = world(); props = { client: w.client };
    render();
    harness.unmount();
    harness.dirty = false;
    await flush();
    expect(harness.dirty).toBe(false);
  });
});

describe('fix round (I2, M1 to M3)', () => {
  const many = (n, from = 0) => Array.from({ length: n }, (_, i) => session(from + i));

  it('I2: Show more works again after a reload overtook one in flight', async () => {
    let release;
    const w = world({ sessions: many(21), hold: new Promise((r) => { release = r; }) });
    props = { client: w.client, sessionStatus: 'running' };
    let s = await settle();
    s.showMore();
    s = render();
    expect(s.moreBusy).toBe(true);
    props = { client: w.client, sessionStatus: 'ended' };
    s = await settle();
    release();
    s = await settle();
    expect(s.moreBusy).toBe(false);
    w.hold = null;
    w.sessions = many(3, 100);
    s.showMore();
    s = await settle();
    expect(s.rows.length).toBeGreaterThan(20);
  });

  it('M1: a page that repeats the last row of the one before adds it once', async () => {
    const w = world({ sessions: many(21) }); props = { client: w.client };
    let s = await settle();
    w.sessions = [session(19), session(40)];
    s.showMore();
    s = await settle();
    expect(s.rows.map((r) => r.id).filter((id) => id === 's19')).toHaveLength(1);
    expect(s.rows).toHaveLength(21);
  });

  it('M2: asking about a second session does nothing while a delete is running', async () => {
    let release;
    const w = world({ sessions: [session(1), session(2)], deleteGate: new Promise((r) => { release = r; }) }); props = { client: w.client };
    let s = await settle();
    s.askDelete('s1');
    render().confirmDelete('s1');
    s = render();
    expect(s.removal).toEqual({ id: 's1', phase: 'busy' });
    s.askDelete('s2');
    expect(render().removal).toEqual({ id: 's1', phase: 'busy' });
    release();
    await settle();
  });

  it('M3: details are cleared on reload, so reopening fetches again', async () => {
    const w = world(); props = { client: w.client, sessionStatus: 'running' };
    let s = await settle();
    s.toggle('s1');
    s = await settle();
    s.toggle('s1');
    render();
    const claimFetches = () => w.client.log.filter((e) => e.table === 'factcheck_claims').length;
    expect(claimFetches()).toBe(1);
    props = { client: w.client, sessionStatus: 'ended' };
    s = await settle();
    expect(s.details).toEqual({});
    s.toggle('s1');
    await settle();
    expect(claimFetches()).toBe(2);
  });

  it('M3: a row still open at a reload is fetched again', async () => {
    const w = world(); props = { client: w.client, sessionStatus: 'running' };
    let s = await settle();
    s.toggle('s1');
    await settle();
    props = { client: w.client, sessionStatus: 'ended' };
    s = await settle();
    s = await settle();
    expect(s.openId).toBe('s1');
    expect(s.details.s1.phase).toBe('ready');
    expect(w.client.log.filter((e) => e.table === 'factcheck_claims')).toHaveLength(2);
  });
});

describe('closing a row cancels its delete confirmation', () => {
  it('closing the row, or opening another, drops a pending question', async () => {
    const w = world({ sessions: [session(1), session(2)] }); props = { client: w.client };
    let s = await settle();
    s.toggle('s1');
    s = await settle();
    s.askDelete('s1');
    expect(render().removal).toEqual({ id: 's1', phase: 'confirm' });
    render().toggle('s1');
    s = render();
    expect(s.openId).toBe(null);
    expect(s.removal).toBe(null);
    s.toggle('s1');
    await settle();
    render().askDelete('s1');
    render().toggle('s2');
    expect(render().removal).toBe(null);
    expect(w.deleted).toEqual([]);
  });
  it('does not drop a delete that is already running', async () => {
    let release;
    const w = world({ deleteGate: new Promise((r) => { release = r; }) }); props = { client: w.client };
    let s = await settle();
    s.toggle('s1');
    await settle();
    render().askDelete('s1');
    render().confirmDelete('s1');
    render().toggle('s1');
    expect(render().removal).toEqual({ id: 's1', phase: 'busy' });
    release();
    await settle();
  });
});

describe('review 1: an opened session whose claim may still be answered is read once more, never polled', () => {
  const pending = (id) => claim(id, { status: 'pending', verdict: null, checked_at: null });
  const claimReads = (w) => w.client.log.filter((q) => q.table === 'factcheck_claims').length;
  const settle = async () => { render(); await vi.advanceTimersByTimeAsync(0); return render(); }; // fake timers: no real setTimeout
  const endedAgo = (ms) => new Date(Date.now() - ms).toISOString();

  it('opens with Checking, then re-reads once when the margin has passed and shows Not checked', async () => {
    vi.useFakeTimers();
    try {
      const w = world({ sessions: [session(1, { ended_at: endedAgo(10000) })], claims: [pending('a')] }); props = { client: w.client };
      let s = await settle();
      s.toggle('s1');
      s = await settle();
      expect(s.details.s1.claims[0].status).toBe('pending');
      expect(claimReads(w)).toBe(1);
      // Not yet: the margin is 165 s and 10 s have passed.
      await vi.advanceTimersByTimeAsync(100000);
      expect(claimReads(w)).toBe(1);
      await vi.advanceTimersByTimeAsync(60000);
      s = await settle();
      expect(claimReads(w)).toBe(2);
      expect(s.details.s1.phase).toBe('ready'); // it did not flash back to loading
      expect(s.details.s1.claims[0].status).toBe('unchecked');
      // And never again.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(claimReads(w)).toBe(2);
    } finally { vi.useRealTimers(); }
  });

  it('does not schedule a second read for a session that is already past the margin', async () => {
    vi.useFakeTimers();
    try {
      const w = world({ sessions: [session(1, { ended_at: endedAgo(10 * 60 * 1000) })], claims: [pending('a')] }); props = { client: w.client };
      let s = await settle();
      s.toggle('s1');
      s = await settle();
      expect(s.details.s1.claims[0].status).toBe('unchecked');
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(claimReads(w)).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('a timer waiting at unmount does nothing', async () => {
    vi.useFakeTimers();
    try {
      const w = world({ sessions: [session(1, { ended_at: endedAgo(10000) })], claims: [pending('a')] }); props = { client: w.client };
      let s = await settle();
      s.toggle('s1');
      await settle();
      harness.unmount();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(claimReads(w)).toBe(1);
    } finally { vi.useRealTimers(); }
  });
});
