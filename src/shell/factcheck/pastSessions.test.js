// F360 T1: the data module of "Past sessions". A recording fake client stands in for Supabase.
import { describe, expect, it } from 'vitest';
import { callArgs, fakePastClient, hasCall } from './pastSessionsFake.js';
import {
  CLAIM_CAP, PAGE_SIZE, deleteLiveSession, fetchSessionClaims, listSettledSessions, newestResults,
} from './pastSessions.js';

const session = (n, over = {}) => ({
  id: `s${n}`, video_id: 'v', channel_id: 'dd-news', video_kind: 'live', started_at: '2026-11-18T10:00:00Z',
  minutes_used: 5, credits_charged: 2500, status: 'settled', ...over,
});
const claim = (id, over = {}) => ({
  id, session_id: 's1', spoken_at: '2026-11-18T10:00:00Z', checked_at: '2026-11-18T10:01:00Z', supersedes: null, hidden_at: null, status: 'checked',
  claim_en: `c ${id}`, ...over,
});
const RAW = 'FATAL: password authentication failed for user postgres';

describe('listSettledSessions', () => {
  it('asks only for settled sessions, newest first, one page and one spare row', async () => {
    const client = fakePastClient(() => ({ data: [session(1)] }));
    await listSettledSessions({ client, offset: 0 });
    const [q] = client.log;
    expect(q.table).toBe('factcheck_sessions');
    expect(hasCall(q, 'eq', 'status', 'settled')).toBe(true);
    expect(callArgs(q, 'order')).toEqual(['started_at', { ascending: false }]);
    expect(callArgs(q, 'range')).toEqual([0, PAGE_SIZE]);
    expect(PAGE_SIZE).toBe(20);
  });

  it('never filters by a user id: the signed-in session decides whose rows come back', async () => {
    const client = fakePastClient(() => ({ data: [] }));
    await listSettledSessions({ client, offset: 0 });
    expect(client.log[0].calls.filter((c) => c[0] === 'eq').map((c) => c[1])).toEqual(['status']);
  });

  it('pages: the second page starts at the offset, and a spare row means there is more', async () => {
    const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => session(i));
    const client = fakePastClient(() => ({ data: rows }));
    const out = await listSettledSessions({ client, offset: PAGE_SIZE });
    expect(callArgs(client.log[0], 'range')).toEqual([PAGE_SIZE, PAGE_SIZE * 2]);
    expect(out.ok).toBe(true);
    expect(out.rows).toHaveLength(PAGE_SIZE);
    expect(out.hasMore).toBe(true);
  });

  it('a short page has no more', async () => {
    const out = await listSettledSessions({ client: fakePastClient(() => ({ data: [session(1), session(2)] })), offset: 0 });
    expect(out).toEqual({ ok: true, rows: [session(1), session(2)], hasMore: false });
  });

  it('maps a database error to a plain failure with no server text', async () => {
    const out = await listSettledSessions({ client: fakePastClient(() => ({ error: { message: RAW, code: '28P01' } })), offset: 0 });
    expect(out).toEqual({ ok: false });
    expect(JSON.stringify(out)).not.toContain('password');
  });

  it('maps a thrown error the same way', async () => {
    const out = await listSettledSessions({ client: fakePastClient(() => { throw new Error(RAW); }), offset: 0 });
    expect(out).toEqual({ ok: false });
  });

  it('treats a malformed answer as a failure', async () => {
    const out = await listSettledSessions({ client: fakePastClient(() => ({ data: { not: 'a list' } })), offset: 0 });
    expect(out).toEqual({ ok: false });
  });
});

describe('newestResults (D6, D13)', () => {
  it('drops a row that another row names in supersedes, keeping the newest result', () => {
    const rows = [claim('a'), claim('b', { supersedes: 'a' }), claim('c', { supersedes: 'b' }), claim('d')];
    expect(newestResults(rows).map((r) => r.id)).toEqual(['c', 'd']);
  });

  it('drops hidden rows', () => {
    const rows = [claim('a'), claim('b', { hidden_at: '2026-11-18T11:00:00Z' })];
    expect(newestResults(rows).map((r) => r.id)).toEqual(['a']);
  });

  it('orders by spoken_at, then checked_at, then id', () => {
    const rows = [
      claim('z', { spoken_at: '2026-11-18T10:05:00Z' }),
      claim('b', { checked_at: '2026-11-18T10:02:00Z' }),
      claim('a', { checked_at: '2026-11-18T10:02:00Z' }),
      claim('y'),
    ];
    expect(newestResults(rows).map((r) => r.id)).toEqual(['y', 'a', 'b', 'z']);
  });

  it('does not mutate its input', () => {
    const rows = [claim('b', { supersedes: 'a' }), claim('a')];
    newestResults(rows);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('newestResults: re-check chains (I1)', () => {
  const at = (m) => `2026-11-18T10:${String(m).padStart(2, '0')}:00Z`;
  const root = (over = {}) => claim('r', { checked_at: at(1), ...over });
  const re = (id, m, over = {}) => claim(id, { supersedes: 'r', spoken_at: at(0), checked_at: at(m), ...over });
  const ids = (rows) => newestResults(rows).map((r) => r.id);

  it('one failed re-check keeps the original verdict', () => {
    expect(ids([root(), re('x', 2, { status: 'error' })])).toEqual(['r']);
  });
  it('a pending re-check keeps the original', () => {
    expect(ids([root(), re('x', 2, { status: 'pending' })])).toEqual(['r']);
  });
  it('three failures give one card, the original', () => {
    const rows = [root(), re('x', 2, { status: 'error' }), re('y', 3, { status: 'error' }), re('z', 4, { status: 'error' })];
    expect(ids(rows)).toEqual(['r']);
  });
  it('two successful re-checks show the later one', () => {
    expect(ids([root(), re('x', 2), re('y', 3)])).toEqual(['y']);
  });
  it('a later failure does not hide an earlier successful re-check', () => {
    expect(ids([root(), re('x', 2), re('y', 3, { status: 'error' })])).toEqual(['x']);
  });
  it('a hidden root drops the whole chain, even a checked successor', () => {
    expect(ids([root({ hidden_at: at(9) }), re('x', 2)])).toEqual([]);
  });
  it('a hidden single row is dropped', () => {
    expect(ids([claim('h', { hidden_at: at(9) }), claim('k')])).toEqual(['k']);
  });
  it('a re-check whose root is outside the fetched set is treated as the root of its chain, and a failed one is never shown', () => {
    expect(ids([re('x', 2)])).toEqual(['x']);
    expect(ids([re('x', 2, { status: 'error' })])).toEqual([]);
  });
  it('survives a cycle without hanging', () => {
    const rows = [claim('a', { supersedes: 'b' }), claim('b', { supersedes: 'a' })];
    expect(() => newestResults(rows)).not.toThrow();
  });
  it('lists chains by the root spoken_at, then checked_at, then id', () => {
    const rows = [claim('late', { spoken_at: at(5) }), root({ spoken_at: at(1) }), re('x', 8, { spoken_at: at(9) })];
    expect(ids(rows)).toEqual(['x', 'late']);
  });
});

describe('fetchSessionClaims', () => {
  it('reads one session, ordered, with one spare row beyond the cap', async () => {
    const client = fakePastClient(() => ({ data: [claim('a')] }));
    await fetchSessionClaims({ client, sessionId: 's1' });
    const [q] = client.log;
    expect(q.table).toBe('factcheck_claims');
    expect(hasCall(q, 'eq', 'session_id', 's1')).toBe(true);
    expect(q.calls.filter((c) => c[0] === 'order').map((c) => c[1])).toEqual(['spoken_at', 'checked_at', 'id']);
    expect(callArgs(q, 'range')).toEqual([0, CLAIM_CAP]);
    expect(CLAIM_CAP).toBe(500);
  });

  it('filters superseded and hidden rows from what it returns', async () => {
    const data = [claim('a'), claim('b', { supersedes: 'a' }), claim('h', { hidden_at: '2026-11-18T11:00:00Z' })];
    const out = await fetchSessionClaims({ client: fakePastClient(() => ({ data })), sessionId: 's1' });
    expect(out.ok).toBe(true);
    expect(out.claims.map((c) => c.id)).toEqual(['b']);
    expect(out.capped).toBe(false);
  });

  it('A1: a root still pending in a settled session is returned as not checked, with the ended note flag', async () => {
    const data = [claim('a', { status: 'pending', verdict: null, checked_at: null }), claim('b')];
    const out = await fetchSessionClaims({ client: fakePastClient(() => ({ data })), sessionId: 's1' });
    const a = out.claims.find((c) => c.id === 'a');
    expect(a.status).toBe('unchecked');
    expect(a.ended_unchecked).toBe(true);
    expect(out.claims.find((c) => c.id === 'b').status).toBe('checked');
    expect(out.claims.find((c) => c.id === 'b').ended_unchecked).toBeUndefined();
  });

  it('A1: a pending re-check never turns a checked root into not checked', async () => {
    const data = [claim('a'), claim('b', { supersedes: 'a', status: 'pending', verdict: null })];
    const out = await fetchSessionClaims({ client: fakePastClient(() => ({ data })), sessionId: 's1' });
    expect(out.claims.map((c) => [c.id, c.status])).toEqual([['a', 'checked']]);
  });

  it('A1: a pending root with a pending re-check shows one not-checked card', async () => {
    const data = [claim('a', { status: 'pending', verdict: null }), claim('b', { supersedes: 'a', status: 'pending', verdict: null })];
    const out = await fetchSessionClaims({ client: fakePastClient(() => ({ data })), sessionId: 's1' });
    expect(out.claims.map((c) => [c.id, c.status])).toEqual([['a', 'unchecked']]);
  });

  it('reports the cap when more than the cap exist, and keeps only the cap', async () => {
    const data = Array.from({ length: CLAIM_CAP + 1 }, (_, i) => claim(`c${String(i).padStart(4, '0')}`));
    const out = await fetchSessionClaims({ client: fakePastClient(() => ({ data })), sessionId: 's1' });
    expect(out.capped).toBe(true);
    expect(out.claims).toHaveLength(CLAIM_CAP);
  });

  it('exactly the cap is not capped', async () => {
    const data = Array.from({ length: CLAIM_CAP }, (_, i) => claim(`c${i}`));
    const out = await fetchSessionClaims({ client: fakePastClient(() => ({ data })), sessionId: 's1' });
    expect(out.capped).toBe(false);
  });

  it('maps an error to a plain failure with no server text', async () => {
    const out = await fetchSessionClaims({ client: fakePastClient(() => ({ error: { message: RAW } })), sessionId: 's1' });
    expect(out).toEqual({ ok: false });
  });
});

describe('deleteLiveSession (D7)', () => {
  it('deletes one live settled session by id and reports success when a row went', async () => {
    const client = fakePastClient(() => ({ data: [{ id: 's1' }] }));
    const out = await deleteLiveSession({ client, session: session(1) });
    expect(out).toEqual({ ok: true });
    const [q] = client.log;
    expect(q.table).toBe('factcheck_sessions');
    expect(q.calls.some((c) => c[0] === 'delete')).toBe(true);
    expect(hasCall(q, 'eq', 'id', 's1')).toBe(true);
    expect(hasCall(q, 'eq', 'video_kind', 'live')).toBe(true);
  });

  it('never sends a recorded session', async () => {
    const client = fakePastClient(() => ({ data: [{ id: 's2' }] }));
    const out = await deleteLiveSession({ client, session: session(2, { video_kind: 'recorded' }) });
    expect(out).toEqual({ ok: false });
    expect(client.log).toHaveLength(0);
  });

  it('never sends a session of unknown kind', async () => {
    const client = fakePastClient(() => ({ data: [] }));
    expect(await deleteLiveSession({ client, session: { id: 's3' } })).toEqual({ ok: false });
    expect(await deleteLiveSession({ client, session: null })).toEqual({ ok: false });
    expect(client.log).toHaveLength(0);
  });

  it('a delete that removed no row is a failure (the row policy refuses silently)', async () => {
    const out = await deleteLiveSession({ client: fakePastClient(() => ({ data: [] })), session: session(1) });
    expect(out).toEqual({ ok: false });
  });

  it('maps an error to a plain failure with no server text', async () => {
    const out = await deleteLiveSession({ client: fakePastClient(() => ({ error: { message: RAW } })), session: session(1) });
    expect(out).toEqual({ ok: false });
  });
});
