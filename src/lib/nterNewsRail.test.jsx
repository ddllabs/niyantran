import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fetchNterLatest } from './nterNewsClient.js';
import NterLatestRail from '../marketing/NterLatestRail.jsx';
const result = { ok: true, delivery: 'publisher', source: 'nter.news', checked_at: new Date().toISOString(), rows: [{ title: 'Publisher story', link: 'https://nter.news/articles/story/', pub: '2026-10-24T10:00:00Z', dek: 'Public excerpt', src: 'News Desk' }] };
afterEach(() => vi.unstubAllGlobals());
describe('publisher RSS client and public rail', () => {
  it('uses the RSS API contract and requests revalidation only for manual refresh', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchNterLatest({ limit: 4, fresh: true })).toEqual(result);
    expect(fetcher.mock.calls[0][0]).toBe('/api/home/latest?limit=4&fresh=1');
    expect(fetcher.mock.calls[0][1].cache).toBe('no-store');
  });
  it.each([new Response('<html>Oops</html>'), new Response(JSON.stringify({ ok: true, rows: [{ title: 'September seed' }] }))])('never substitutes the old seed for unavailable or invalid responses', async response => {
    vi.stubGlobal('fetch', vi.fn(async () => response));
    expect(await fetchNterLatest()).toMatchObject({ ok: false, rows: [], stale: true });
  });
  it('keeps source failure metadata from a 503 response', async () => {
    const unavailable = { ...result, ok: false, rows: [], checked_at: null, stale: true };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(unavailable), { status: 503 })));
    expect(await fetchNterLatest()).toEqual(unavailable);
  });
  it('propagates cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }));
    await expect(fetchNterLatest()).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('keeps the existing rail layout and identifies its publisher', () => {
    const html = renderToStaticMarkup(<NterLatestRail limit={4} />);
    expect(html).toContain('nter-rail-section');
    expect(html).toContain('NTER.news Intelligence Rail');
    expect(html).toContain('Selected from');
    expect(html).toContain('aria-label="nter.news"');
    expect(html).toContain('nter-news-mark-red');
    expect(html).toContain('https://nter.news');
  });
});
