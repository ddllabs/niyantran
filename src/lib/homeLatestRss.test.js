import { afterEach, expect, it, vi } from 'vitest';
const oldStore = vi.hoisted(() => vi.fn(async () => ({ ok: true, rows: [{ title: 'September seed', link: 'https://nter.news/articles/old/' }], source: 'nter.news' })));
vi.mock('../../server/nterNews.mjs', async original => ({ ...await original(), serveNterLatest: oldStore }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('serves the current public RSS article without reading the legacy Supabase news store', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<rss version="2.0"><channel><title>nter.news</title><item><title>Current publisher story</title><link>https://nter.news/articles/current/</link><pubDate>Sat, 24 Oct 2026 14:39:07 +0000</pubDate></item></channel></rss>')));
  const { serveHomeLatest } = await import('../../server/homeApi.mjs');
  const result = await serveHomeLatest({ fresh: true });
  expect(result.rows[0].title).toBe('Current publisher story');
  expect(oldStore).not.toHaveBeenCalled();
});
