import { describe, expect, it, vi } from 'vitest';
import { createNewsReader, parseNewsRss, NEWS_RSS_URL, NEWS_TTL_MS, NEWS_STALE_MS, NEWS_MAX_BYTES } from '../../server/newsRss.mjs';
const now = Date.parse('2026-10-25T00:00:00Z');
const item = (title = 'Today &amp; tomorrow', slug = 'today', date = 'Sat, 24 Oct 2026 14:39:07 +0000') => `<item><title>${title}</title><link>https://nter.news/articles/${slug}/</link><pubDate>${date}</pubDate><dc:creator>News Desk</dc:creator><category>State</category><description><![CDATA[<p>₹500 — real <b>reporting</b>.</p>]]></description><media:content url="https://nter.news/assets/uploads/story.webp"/></item>`;
const feed = (items = item()) => `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>nter.news</title>${items}</channel></rss>`;
const response = xml => new Response(xml, { headers: { 'content-type': 'application/rss+xml' } });

describe('public nter.news metadata', () => {
  it('retains Unicode, decodes entities and strips excerpt markup without importing full bodies', () => {
    const row = parseNewsRss(feed(item('Shinde&#8217;s bid &amp; the ₹ vote')), now)[0];
    expect(row).toMatchObject({ title: 'Shinde’s bid & the ₹ vote', dek: '₹500 — real reporting .', pub: '2026-10-24T14:39:07.000Z', author: 'News Desk', category: 'State', img: 'https://nter.news/assets/uploads/story.webp' });
    expect(row).not.toHaveProperty('content');
  });
  it('sorts by original publication date and deduplicates canonical article links', () => {
    const rows = parseNewsRss(feed(item('Old', 'old', 'Fri, 23 Oct 2026 10:00:00 +0000') + item('New', 'new') + item('Duplicate', 'new')), now);
    expect(rows.map(row => row.title)).toEqual(['New', 'Old']);
  });
  it.each(['<html><body>Oops</body></html>', '<rss><channel></rss>', '<!DOCTYPE rss [<!ENTITY e "x">]><rss><channel/></rss>'])('rejects malformed or entity-declaring input', xml => {
    expect(() => parseNewsRss(xml, now)).toThrow();
  });
  it('does not turn bad dates, foreign URLs, javascript links or future dates into articles', () => {
    const xml = feed(item() + item('No date', 'bad', 'unknown') + item('Future', 'future', 'Thu, 29 Oct 2026 10:00:00 +0000') + item('Foreign', 'foreign').replace('https://nter.news/articles/foreign/', 'https://evil.example/articles/foreign/') + item('Script', 'script').replace('https://nter.news/articles/script/', 'javascript:alert(1)'));
    expect(parseNewsRss(xml, now)).toHaveLength(1);
  });
  it('drops foreign image URLs and rejects oversized feeds', () => {
    expect(parseNewsRss(feed(item().replace('https://nter.news/assets/uploads/story.webp', 'https://evil.example/x.png')), now)[0].img).toBe('');
    expect(() => parseNewsRss(' '.repeat(NEWS_MAX_BYTES + 1), now)).toThrow();
  });
});

describe('bounded read-only feed cache', () => {
  it('fetches only the fixed source, clamps output and caches for five minutes', async () => {
    let time = now;
    const fetcher = vi.fn(async () => response(feed(item())));
    const read = createNewsReader({ fetcher, clock: () => time });
    const first = await read({ limit: 200 });
    expect(first).toMatchObject({ delivery: 'rss', archive: false, checked_at: new Date(now).toISOString() });
    time += NEWS_TTL_MS - 1;
    await read();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(NEWS_RSS_URL);
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    time += 1;
    await read();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('shares concurrent fetches and allows manual revalidation', async () => {
    const fetcher = vi.fn(async () => response(feed()));
    const read = createNewsReader({ fetcher, clock: () => now });
    await Promise.all([read(), read(), read()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await read({ fresh: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('marks previous articles stale on errors, backs off, and expires them after one day', async () => {
    let time = now;
    const fetcher = vi.fn().mockResolvedValueOnce(response(feed())).mockRejectedValue(new Error('down'));
    const read = createNewsReader({ fetcher, clock: () => time });
    await read(); time += NEWS_TTL_MS;
    const stale = await read();
    expect(stale).toMatchObject({ archive: true, stale: true, checked_at: new Date(now).toISOString() });
    expect(stale.rows[0].fallback).toBe(true);
    await read({ fresh: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    time = now + NEWS_STALE_MS + 1;
    expect(await read()).toMatchObject({ ok: false, rows: [], archive: true });
  });
  it('clears prior articles when the publisher successfully returns an empty channel', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(feed())).mockResolvedValueOnce(response(feed('')));
    const read = createNewsReader({ fetcher, clock: () => now });
    await read();
    expect(await read({ fresh: true })).toMatchObject({ ok: true, rows: [], stale: false });
  });
  it('returns an honest unavailable response on a cold failure or oversized stream', async () => {
    const offline = createNewsReader({ fetcher: async () => { throw new Error('offline'); }, clock: () => now });
    expect(await offline()).toMatchObject({ ok: false, archive: true, rows: [], checked_at: null });
    const oversized = createNewsReader({ fetcher: async () => response('x'.repeat(NEWS_MAX_BYTES + 1)), clock: () => now });
    expect(await oversized()).toMatchObject({ ok: false, rows: [] });
  });
  it('aborts an upstream request after eight seconds', async () => {
    vi.useFakeTimers();
    try {
      let signal;
      const read = createNewsReader({ fetcher: async (_url, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError'))));
      }, clock: () => now });
      const pending = read();
      await vi.advanceTimersByTimeAsync(8000);
      expect(signal.aborted).toBe(true);
      expect(await pending).toMatchObject({ ok: false, rows: [], checked_at: null });
    } finally { vi.useRealTimers(); }
  });

});
