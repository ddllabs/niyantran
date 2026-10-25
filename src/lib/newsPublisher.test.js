import { describe, expect, it, vi } from 'vitest';
import { createPublisherReader, parsePublisherFront, parseArticleMetadata, NEWS_FRONT_URL } from '../../server/newsPublisher.mjs';
import { NEWS_RSS_URL, NEWS_TTL_MS, readNewsSource } from '../../server/newsRss.mjs';
const now = Date.parse('2026-10-25T00:00:00Z');
const card = (slug, title = slug) => `<article class="nx-card"><a class="nx-card__media" href="/articles/${slug}/"><img src="/assets/images/${slug}.png"></a><h3 class="nx-card__title"><a href="/articles/${slug}/">${title}</a></h3><p class="nx-card__kicker">State</p><p class="nx-card__dek">Public excerpt</p></article>`;
const front = cards => `<main><section data-section="top-stories">${cards}</section></main>`;
const article = (date = '2026-08-30', canonical = '') => `<html><head><meta property="article:published_time" content="2026-10-24T14:39:07Z"><meta name="author" content="News Desk">${canonical ? `<link rel="canonical" href="${canonical}">` : ''}</head><body><main><article><h1>Article</h1><time datetime="${date}">Published date</time><p>Private body must never reach the cards</p></article></main></body></html>`;
const response = html => new Response(html);

describe('public publisher selection and publication provenance', () => {
  it('imports compact explainer thumbnails without mistaking promotional logos for article images', () => {
    const compact = (slug, src) => `<article class="nx-card"><div class="has-thumb"><h3 class="nx-card__title"><a href="/articles/${slug}/">${slug}</a></h3><a class="nx-thumb" href="/articles/${slug}/" aria-hidden="true"><img src="${src}"></a></div><a class="nx-research"><img src="/assets/brand/nter-pro-mark.png"></a></article>`;
    const rows = parsePublisherFront(front(compact('autumn', '/assets/uploads/_t/autumn.png-240x160.webp') + compact('bhaipo', '/assets/uploads/_t/bhaipo.jpg-240x160.webp') + compact('unsafe', 'https://evil.example/photo.jpg')));
    expect(rows.map(row => row.img)).toEqual(['https://nter.news/assets/uploads/_t/autumn.png-240x160.webp', 'https://nter.news/assets/uploads/_t/bhaipo.jpg-240x160.webp', '']);
  });
  it('keeps editorial order, canonical deduplication, metadata and a bounded card count', () => {
    const rows = parsePublisherFront(front(card('kashmir') + card('shinde') + card('kashmir') + Array.from({ length: 30 }, (_, i) => card(`other-${i}`)).join('')));
    expect(rows).toHaveLength(24);
    expect(rows.slice(0, 2).map(row => row.title)).toEqual(['kashmir', 'shinde']);
    expect(rows[0]).toMatchObject({ img: 'https://nter.news/assets/images/kashmir.png', pub: null, dek: 'Public excerpt' });
  });
  it('rejects structural changes and ignores unsafe, hidden, duplicate and advertisement links', () => {
    expect(() => parsePublisherFront('<main><h1>Sign in</h1></main>')).toThrow();
    const rows = parsePublisherFront(front(card('safe', '₹ vote &amp; debate') + `<div hidden>${card('hidden')}</div>` + card('foreign').replaceAll('/articles/foreign/', 'https://evil.example/articles/foreign/') + card('script').replaceAll('/articles/script/', 'javascript:alert(1)') + '<a href="https://www.nter.pro/">Ad</a>'));
    expect(rows.map(row => row.title)).toEqual(['₹ vote & debate']);
    expect(() => parsePublisherFront(front(card('foreign').replaceAll('/articles/foreign/', 'https://evil.example/articles/foreign/')))).toThrow();
  });
  it('prefers visible article publication date over update metadata, preserving date-only precision', () => {
    expect(parseArticleMetadata(article(), 'https://nter.news/articles/kashmir/', now)).toEqual({ pub: '2026-08-30', author: 'News Desk' });
    expect(parseArticleMetadata(article('2026-10-24T19:59:56+05:30'), 'https://nter.news/articles/shinde/', now).pub).toBe('2026-10-24T19:59:56+05:30');
    expect(() => parseArticleMetadata(article('2026-08-30', 'https://evil.example/article/'), 'https://nter.news/articles/kashmir/', now)).toThrow();
  });
  it.each(['2026-02-31', 'yesterday', '2027-01-01', ''])('never invents a publication date for %s', date => {
    const html = article(date).replace('<meta property="article:published_time" content="2026-10-24T14:39:07Z">', '');
    expect(parseArticleMetadata(html, 'https://nter.news/articles/kashmir/', now).pub).toBeNull();
  });
});

describe('bounded publisher source orchestration', () => {
  it('uses at most four concurrent article reads, original dates and the existing five-minute cache', async () => {
    let active = 0; let maximum = 0; let time = now;
    const fetcher = vi.fn(async (url, options) => {
      expect(options.redirect).toBe('error');
      expect(new URL(url).hostname).toBe('nter.news');
      if (url === NEWS_FRONT_URL) return response(front(Array.from({ length: 10 }, (_, i) => card(`story-${i}`)).join('')));
      if (url === NEWS_RSS_URL) throw new Error('RSS unavailable: front page still works');
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return response(article());
    });
    const read = createPublisherReader({ fetcher, clock: () => time });
    const first = await read();
    expect(first).toMatchObject({ ok: true, delivery: 'publisher', source_url: NEWS_FRONT_URL });
    expect(first.rows).toHaveLength(10);
    expect(first.rows[0]).toMatchObject({ pub: '2026-08-30', date_source: 'https://nter.news/articles/story-0/', src: 'News Desk' });
    expect(JSON.stringify(first)).not.toContain('Private body');
    expect(maximum).toBe(4);
    const requests = fetcher.mock.calls.length;
    await read(); expect(fetcher).toHaveBeenCalledTimes(requests);
    time += NEWS_TTL_MS; await read(); expect(fetcher.mock.calls.length).toBeGreaterThan(requests);
  });
  it('keeps publication unknown on article failure instead of adopting RSS time', async () => {
    const fetcher = async url => {
      if (url === NEWS_FRONT_URL) return response(front(card('story')));
      if (url === NEWS_RSS_URL) return response('<rss><channel><item><title>Story</title><link>https://nter.news/articles/story/</link><pubDate>Sat, 24 Oct 2026 14:39:07 GMT</pubDate></item></channel></rss>');
      throw new Error('article unavailable');
    };
    const result = await createPublisherReader({ fetcher, clock: () => now })();
    expect(result.rows[0]).toMatchObject({ pub: null, published_at: null, date_source: null });
  });
  it('marks the previous verified edition stale on structure failures and clears it on a confirmed empty front page', async () => {
    let mode = 'live'; let time = now;
    const read = createPublisherReader({ clock: () => time, fetcher: async url => response(url === NEWS_FRONT_URL ? mode === 'live' ? front(card('story')) : mode === 'empty' ? front('') : '<main>Oops</main>' : article()) });
    await read(); mode = 'broken'; time += NEWS_TTL_MS;
    expect(await read()).toMatchObject({ ok: true, stale: true, rows: [expect.objectContaining({ pub: '2026-08-30' })] });
    mode = 'empty'; time += 30001;
    expect(await read({ fresh: true })).toMatchObject({ ok: true, stale: false, rows: [] });
  });
  it('bounds a slow edition to twelve seconds and leaves unverified dates absent', async () => {
    vi.useFakeTimers();
    try {
      const read = createPublisherReader({ clock: () => now, fetcher: async (url, { signal }) => {
        if (url === NEWS_FRONT_URL) return response(front(Array.from({ length: 10 }, (_, i) => card(`slow-${i}`)).join('')));
        if (url === NEWS_RSS_URL) return response('<rss><channel><title>Empty</title></channel></rss>');
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
      } });
      const pending = read();
      await vi.advanceTimersByTimeAsync(12000);
      const result = await pending;
      expect(result.rows).toHaveLength(10);
      expect(result.rows.every(row => row.pub === null)).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('never fetches foreign origins, arbitrary publisher endpoints or redirect targets', async () => {
    const fetcher = vi.fn();
    for (const url of ['https://evil.example/articles/x/', 'https://nter.news/api/private/', 'http://nter.news/articles/x/']) {
      await expect(readNewsSource(fetcher, url)).rejects.toThrow('Unapproved');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

});
