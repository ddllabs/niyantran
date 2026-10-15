// F123: getRecordBrief asks the desk-brief Edge Function (scope 'record') for the stored,
// platform-paid brief of one record. The server derives the row key and hash; the browser
// sends only the tier, the module and the row, with the signed-in user's bearer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({ value: { id: 'user-1', token: 'verified.jwt.token' } }));
vi.mock('./userStore.js', () => ({ verifiedLocalIdentity: vi.fn(async () => identity.value) }));
vi.mock('./supabaseClient.js', () => ({ functionsUrl: (name) => `https://project-ref.supabase.test/functions/v1/${name}` }));

import { getRecordBrief } from './deskBrief.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ROW = { conflict_name: 'Russia-Ukraine War', region: 'Eastern Europe', __rowIndex: 3 };

describe('getRecordBrief', () => {
  let fetchMock;
  beforeEach(() => {
    identity.value = { id: 'user-1', token: 'verified.jwt.token' };
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts scope record with the tier, module and row, and the bearer, to the Edge Function only', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, state: 'ready', headline: 'H', points: ['a', 'b', 'c'], model: 'm/x', writtenAt: '2026-10-15T06:00:00Z' }));
    const out = await getRecordBrief({ tier: 'geopolitics', feature: 'Open Fronts', row: ROW });
    expect(out).toEqual({ state: 'ready', headline: 'H', points: ['a', 'b', 'c'], model: 'm/x', writtenAt: '2026-10-15T06:00:00Z' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://project-ref.supabase.test/functions/v1/desk-brief');
    expect(init.headers.Authorization).toBe('Bearer verified.jwt.token');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ scope: 'record', tier: 'geopolitics', feature: 'Open Fronts', row: ROW });
    expect(body).not.toHaveProperty('hash');
  });

  it('maps pending, unavailable and failed, and treats any refusal as an error', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { ok: true, state: 'pending' }))
      .mockResolvedValueOnce(json(200, { ok: true, state: 'unavailable' }))
      .mockResolvedValueOnce(json(200, { ok: true, state: 'failed' }))
      .mockResolvedValueOnce(json(503, { error: 'AI research service is temporarily unavailable.' }))
      .mockResolvedValueOnce(json(200, { ok: true, state: 'ready', headline: '', points: [] }));
    const ask = () => getRecordBrief({ tier: 'national', feature: 'Bills', row: ROW });
    expect(await ask()).toEqual({ state: 'pending' });
    expect(await ask()).toEqual({ state: 'unavailable' });
    expect(await ask()).toEqual({ state: 'error' });
    expect(await ask()).toEqual({ state: 'error' });
    expect(await ask()).toEqual({ state: 'error' });
  });

  // Production 2026-10-15: the account check briefly answers nothing while supabase-js re-announces
  // the account (tab focus, token refresh); a stored brief then showed "not available yet".
  it('retries the account check before giving up, so a re-announce does not hide the brief', async () => {
    const { verifiedLocalIdentity } = await import('./userStore.js');
    verifiedLocalIdentity.mockResolvedValueOnce(null);
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, state: 'ready', headline: 'H', points: ['a'], model: 'm', writtenAt: null }));
    const out = await getRecordBrief({ tier: 'geopolitics', feature: 'Open Fronts', row: ROW });
    expect(out.state).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a signed-out reader gets unavailable without a request', async () => {
    identity.value = null;
    expect(await getRecordBrief({ tier: 'national', feature: 'Bills', row: ROW })).toEqual({ state: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends no request for a source-status row or without a module', async () => {
    expect(await getRecordBrief({ tier: 'national', feature: 'Bills', row: { status: 'source_status' } })).toEqual({ state: 'none' });
    expect(await getRecordBrief({ tier: 'national', feature: '', row: ROW })).toEqual({ state: 'none' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a very large row is sent slimmed, within the function bound', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, state: 'pending' }));
    const big = { title: 'Big', ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}`, 'x'.repeat(1000)])) };
    await getRecordBrief({ tier: 'national', feature: 'Bills', row: big });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).row;
    expect(new TextEncoder().encode(JSON.stringify(sent)).length).toBeLessThanOrEqual(32_768);
    expect(sent.title).toBe('Big');
  });

  it('passes an abort through', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(getRecordBrief({ tier: 'national', feature: 'Bills', row: ROW })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
