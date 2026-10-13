// F142 (owner 2026-10-14): the marketing pages start from the measured figures and take the live
// counts from /api/site-figures when they arrive; one request per page load.
import { describe, expect, it, vi } from 'vitest';
import { fetchSiteFigures, mergeLiveFigures, resetLiveFigures } from './liveFigures.js';
import { SITE_FIGURES } from './siteFigures.js';

describe('live figures', () => {
  it('takes each live count that is a positive whole number, and keeps modules and endpoints from the code', () => {
    const merged = mergeLiveFigures(SITE_FIGURES, { bills: 9901, documents: 3500, ministries: 57, fronts: 0, modules: 1, endpoints: 1, source: 'live' });
    expect(merged).toMatchObject({ bills: 9901, documents: 3500, ministries: 57, fronts: SITE_FIGURES.fronts, modules: SITE_FIGURES.modules, endpoints: SITE_FIGURES.endpoints });
    expect(mergeLiveFigures(SITE_FIGURES, null)).toBe(SITE_FIGURES);
    expect(mergeLiveFigures(SITE_FIGURES, { bills: '9901' }).bills).toBe(SITE_FIGURES.bills);
  });

  it('asks the server once per page load, and survives a failed request', async () => {
    resetLiveFigures();
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ bills: 9901 }) }));
    const [a, b] = await Promise.all([fetchSiteFigures(fetchImpl), fetchSiteFigures(fetchImpl)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/site-figures');
    expect(a).toEqual({ bills: 9901 });
    expect(b).toBe(a);
    resetLiveFigures();
    expect(await fetchSiteFigures(async () => { throw new Error('offline'); })).toBeNull();
    resetLiveFigures();
    expect(await fetchSiteFigures(async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
  });
});

// Review (2026-10-14): a failed request is not kept for the whole visit, and a long-open tab refreshes.
describe('live figures over a visit', () => {
  it('asks again after a failure, and after 15 minutes', async () => {
    resetLiveFigures();
    let t = 0;
    const now = () => t;
    const failing = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchSiteFigures(failing, now)).toBeNull();
    const ok = vi.fn(async () => ({ ok: true, json: async () => ({ bills: 9901 }) }));
    expect(await fetchSiteFigures(ok, now)).toEqual({ bills: 9901 });
    t = 14 * 60 * 1000;
    await fetchSiteFigures(ok, now);
    expect(ok).toHaveBeenCalledTimes(1);
    t = 15 * 60 * 1000 + 1;
    await fetchSiteFigures(ok, now);
    expect(ok).toHaveBeenCalledTimes(2);
  });
});
