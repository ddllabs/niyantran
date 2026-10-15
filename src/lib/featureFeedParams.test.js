// F190: switching MLA Directory's state must not show another state's list. fetchFeature keeps no
// answers of its own: the request URL carries params, so each state is its own request (and its own
// edge-cache entry, since Vercel's cache key is the full URL).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiMode.js', () => ({ featureFeedApiEnabled: () => true, liveApiEnabled: () => true }));
vi.mock('./archiveFeed.js', async (importOriginal) => ({ ...(await importOriginal()), fetchArchiveFeature: vi.fn(async () => null) }));
import { fetchFeature } from './featureFeed.js';
import { mlaStateVariant } from '../../server/feedSchedule.mjs';

const listFor = (url) => {
  const state = new URL(url, 'http://x').searchParams.get('state');
  return { ok: true, tier: 'state', feature: 'MLA Directory', rows: [{ title: `MLA of ${state || 'all states'}` }], source: { adapter: 'register', note: '' }, fallback: false };
};

describe('fetchFeature with MLA Directory state (F190)', () => {
  const original = globalThis.fetch;
  let urls;
  beforeEach(() => {
    urls = [];
    globalThis.fetch = vi.fn(async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => listFor(url) }; });
  });
  afterEach(() => { globalThis.fetch = original; });

  const ask = (state) => fetchFeature({ tier: 'state', feature: 'MLA Directory', ...(state === undefined ? {} : { params: { state } }) });

  it('puts the state in the request and sends none for "All states"', async () => {
    await ask('Kerala');
    await ask(undefined);
    await ask('');
    expect(new URL(urls[0], 'http://x').searchParams.get('state')).toBe('Kerala');
    expect(urls[1]).not.toMatch(/state=/);
    expect(urls[2]).not.toMatch(/state=/);
    expect(urls[1]).toBe(urls[2]);
  });

  it('asks again for each switch, and each answer is the state asked for', async () => {
    const first = await ask('Kerala');
    const second = await ask('Assam');
    const back = await ask('Kerala');
    const all = await ask(undefined);
    expect(urls).toHaveLength(4);
    expect(new Set(urls).size).toBe(3);
    expect([first, second, back, all].map((a) => a.rows[0].title)).toEqual(['MLA of Kerala', 'MLA of Assam', 'MLA of Kerala', 'MLA of all states']);
  });

  it('carries a name with an ampersand whole, and the server reads it back as the same variant', async () => {
    await ask('Jammu & Kashmir');
    expect(urls[0]).toMatch(/state=Jammu\+%26\+Kashmir/);
    expect(new URL(urls[0], 'http://x').searchParams.get('state')).toBe('Jammu & Kashmir');
    expect(mlaStateVariant(new URL(urls[0], 'http://x').searchParams.get('state'))).toBe('Jammu & Kashmir');
  });

  it('cannot be made to overwrite tier or feature through params', async () => {
    await fetchFeature({ tier: 'state', feature: 'MLA Directory', params: { state: 'Kerala', tier: 'national', feature: 'Cabinet Decisions' } });
    const q = new URL(urls[0], 'http://x').searchParams;
    expect([q.get('tier'), q.get('feature'), q.get('state')]).toEqual(['state', 'MLA Directory', 'Kerala']);
  });
});
