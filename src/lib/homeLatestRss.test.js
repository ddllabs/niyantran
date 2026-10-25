import { afterEach, expect, it, vi } from 'vitest';
const oldStore = vi.hoisted(() => vi.fn(async () => ({ ok: true, rows: [{ title: 'September seed', link: 'https://nter.news/articles/old/' }], source: 'nter.news' })));
vi.mock('../../server/nterNews.mjs', async original => ({ ...await original(), serveNterLatest: oldStore }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('serves the current public RSS article without reading the legacy Supabase news store', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => new Response(url === 'https://nter.news/' ? '<main><section data-section="top-stories"><article class="nx-card"><h3 class="nx-card__title"><a href="/articles/current/">Current publisher story</a></h3></article></section></main>' : '<main><article><h1>Current publisher story</h1><time datetime="2026-10-24">24 October</time></article></main>')));
  const { serveHomeLatest } = await import('../../server/homeApi.mjs');
  const result = await serveHomeLatest({ fresh: true });
  expect(result.rows[0].title).toBe('Current publisher story');
  expect(oldStore).not.toHaveBeenCalled();
});

it('follows publisher front-page order and article dates instead of RSS update order', async () => {
  const rss = '<rss><channel><item><title>RSS first</title><link>https://nter.news/articles/rss-first/</link><pubDate>Sat, 24 Oct 2026 14:39:07 GMT</pubDate></item><item><title>Kashmir</title><link>https://nter.news/articles/kashmir/</link><pubDate>Sat, 24 Oct 2026 14:38:53 GMT</pubDate></item></channel></rss>';
  const front = '<main><section data-section="top-stories"><article class="nx-card"><h3 class="nx-card__title"><a href="/articles/kashmir/">Kashmir</a></h3></article><article class="nx-card"><h3 class="nx-card__title"><a href="/articles/new/">New report</a></h3></article></section></main>';
  vi.stubGlobal('fetch', vi.fn(async url => new Response(url.endsWith('/feed.xml') ? rss : url === 'https://nter.news/' ? front : '<main><article><h1>Story</h1><time datetime="2026-08-30">30 August 2026</time></article></main>')));
  const { serveHomeLatest } = await import('../../server/homeApi.mjs');
  const result = await serveHomeLatest({ fresh: true });
  expect(result.rows.map(row => row.title)).toEqual(['Kashmir', 'New report']);
  expect(result.rows[0].pub).toBe('2026-08-30');
});
