import { afterEach, expect, it, vi } from 'vitest';
import { fetchArchiveFeature } from './archiveFeed.js';

afterEach(() => vi.unstubAllGlobals());
it('does not fetch the CORS-blocked BBC RSS from the browser archive', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
  vi.stubGlobal('fetch', fetch);
  const result = await fetchArchiveFeature({ tier: 'sports', feature: 'Football Wire' });
  expect(fetch).not.toHaveBeenCalled();
  expect(result.rows).toEqual([]);
  expect(result.source.note).toMatch(/live host/i);
});
