import { describe, expect, it, vi } from 'vitest';
import { DESK_CATALOGUE } from '../desks/landing/deskCatalogue.js';
import { loadDeskCatalogueSummary } from './deskCatalogueSummary.js';
const entryFor = tab => DESK_CATALOGUE.find(entry => entry.tab === tab);
const response = (feature, overrides = {}) => ({ ok: true, json: async () => ({ ok: true, version: 1, feature, resourceKey: feature, count: 0, availability: 'empty', sourceMode: 'stored', columns: [], sources: [], ...overrides }) });

describe('single-module catalogue summary', () => {
  it.each(['national','global','law','economics','carbon','sports','entertainment'])('loads only the selected %s entry through its validated adapter', async tab => {
    const entry = entryFor(tab), fetcher = vi.fn(async () => response(entry.feature));
    expect(await loadDeskCatalogueSummary(entry, { fetcher })).toMatchObject({ feature: entry.feature, count: 0, availability: 'empty' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const endpoint = new URL(fetcher.mock.calls[0][0], 'http://localhost');
    expect(endpoint.pathname).toBe(`/api/${tab === 'law' ? 'law' : tab}-landing`);
    expect(endpoint.searchParams.get('feature')).toBe(entry.feature);
  });
  it('uses the bill resource for the policy graph while returning graph coverage', async () => {
    const entry = DESK_CATALOGUE.find(entry => entry.feature === 'Policy Intelligence Graph');
    const fetcher = vi.fn(async () => response('Bill Passage Probability Index', { graphColumns: [{ key: 'title', label: 'Bill' }] }));
    expect(await loadDeskCatalogueSummary(entry, { fetcher })).toMatchObject({ feature: entry.feature, resourceKey: 'Bill Passage Probability Index', columns: [{ key: 'title', label: 'Bill' }] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('never fetches denied entries or already-aborted requests', async () => {
    const fetcher = vi.fn(), entry = entryFor('economics'), controller = new AbortController();
    expect(await loadDeskCatalogueSummary(entry, { lockedIds: ['economics'], fetcher })).toBeNull();
    controller.abort();
    expect(await loadDeskCatalogueSummary(entry, { signal: controller.signal, fetcher })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a forged destination before fetching', async () => {
    const fetcher = vi.fn();
    await expect(loadDeskCatalogueSummary({ ...entryFor('national'), tab: 'global' }, { fetcher })).rejects.toThrow('Unknown catalogue destination');
    await expect(loadDeskCatalogueSummary({ ...entryFor('national'), feature: 'unknown' }, { fetcher })).rejects.toThrow('Unknown catalogue destination');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('suppresses an in-flight aborted summary and aborts the adapter request', async () => {
    const controller = new AbortController();
    let finish, requestSignal;
    const entry = entryFor('sports');
    const fetcher = vi.fn((url, options) => { requestSignal = options.signal; return new Promise(resolve => { finish = resolve; }); });
    const pending = loadDeskCatalogueSummary(entry, { signal: controller.signal, fetcher });
    controller.abort(); finish(response(entry.feature));
    expect(await pending).toBeNull();
    expect(requestSignal.aborted).toBe(true);
  });
  it('keeps malformed/failing data uncounted and allows an explicit retry', async () => {
    const entry = entryFor('global');
    const fetcher = vi.fn().mockResolvedValueOnce(response('wrong', { count: 9999 })).mockResolvedValueOnce(response(entry.feature));
    expect(await loadDeskCatalogueSummary(entry, { fetcher })).toMatchObject({ count: null, availability: 'error' });
    expect(await loadDeskCatalogueSummary(entry, { fetcher })).toMatchObject({ count: 0, availability: 'empty' });
  });
});
