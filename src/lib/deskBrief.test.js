// ensureDeskBrief: when the direct Edge Function call does not produce a
// brief, the /api/ai/desk-brief fallback must carry the same verified bearer,
// because the Vercel route now refuses unauthenticated generation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({ value: { id: 'user-1', token: 'verified.jwt.token' } }));

vi.mock('./userStore.js', () => ({ verifiedLocalIdentity: vi.fn(async () => identity.value) }));
vi.mock('./supabaseClient.js', () => ({ functionsUrl: (name) => `https://project-ref.supabase.test/functions/v1/${name}` }));

import { ensureDeskBrief } from './deskBrief.js';

const BRIEF = { ok: true, headline: 'What the Act does', summary: ['Purpose: revise duty rates'] };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const row = () => ({ title: `Customs Tariff Bill ${Math.random()}`, status: 'Passed' });

describe('ensureDeskBrief fallback POST', () => {
  let fetchMock;
  beforeEach(() => {
    identity.value = { id: 'user-1', token: 'verified.jwt.token' };
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the verified bearer to /api/ai/desk-brief when the Edge Function is not deployed', async () => {
    fetchMock
      .mockResolvedValueOnce(json(404, { error: 'Function not found' }))
      .mockResolvedValueOnce(json(200, BRIEF));

    const out = await ensureDeskBrief({ feature: 'Bills', tier: 'Legislative', row: row(), force: true, scope: 'substance' });

    expect(out.headline).toBe(BRIEF.headline);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [edgeUrl, edgeInit] = fetchMock.mock.calls[0];
    expect(edgeUrl).toBe('https://project-ref.supabase.test/functions/v1/desk-brief');
    expect(edgeInit.headers.Authorization).toBe('Bearer verified.jwt.token');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/ai/desk-brief');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer verified.jwt.token');
  });

  it('falls back when the Edge Function cannot be reached', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(200, BRIEF));

    const out = await ensureDeskBrief({ feature: 'Bills', tier: 'Legislative', row: row(), force: true, scope: 'substance' });

    expect(out.headline).toBe(BRIEF.headline);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://project-ref.supabase.test/functions/v1/desk-brief',
      '/api/ai/desk-brief',
    ]);
  });

  it('does not pay for the same failed brief twice: an Edge Function error is final', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { ok: false, error: 'AI research service is temporarily unavailable.' }));

    await expect(
      ensureDeskBrief({ feature: 'Bills', tier: 'Legislative', row: row(), force: true, scope: 'substance' }),
    ).rejects.toThrow('AI research service is temporarily unavailable.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends no Authorization header when there is no verified identity', async () => {
    identity.value = null;
    fetchMock.mockResolvedValueOnce(json(401, { ok: false, error: 'Sign in required.' }));

    await expect(
      ensureDeskBrief({ feature: 'Bills', tier: 'Legislative', row: row(), force: true, scope: 'substance' }),
    ).rejects.toThrow('Sign in required.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/ai/desk-brief');
    expect(init.headers.Authorization).toBeUndefined();
  });
});
