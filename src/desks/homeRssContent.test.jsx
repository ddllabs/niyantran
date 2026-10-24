import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const cache = vi.hoisted(() => ({ boot: null }));
vi.mock('../lib/homeCache.js', () => ({ loadHomeCache: () => cache.boot, homeCacheHasRows: () => true, isHomeCacheFresh: () => true, kickHomeRefreshIfDue: () => {}, saveHomeCache: () => {} }));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
import HomeDesk from './HomeDesk.jsx';
afterEach(() => { cache.boot = null; });
it('keeps the Home layout while sourcing its hero, ticker and both news areas from publisher articles', () => {
  cache.boot = { latest: { delivery: 'rss', checked_at: new Date().toISOString(), rows: [{ title: 'Fresh publisher headline', link: 'https://nter.news/articles/fresh/', pub: '2026-10-24T14:39:07Z', category: 'National', dek: 'Published summary', img: 'https://nter.news/assets/uploads/fresh.webp' }] }, markets: { rows: [] }, pulse: { rows: [] } };
  const html = renderToStaticMarkup(<HomeDesk onOpen={() => {}} onFeed={() => {}} onSelect={() => {}} />);
  expect(html).toMatch(/class="nh-hero"[\s\S]*Fresh publisher headline[\s\S]*Read on nter.news/);
  expect(html).toMatch(/class="nh-topics"[\s\S]*Fresh publisher headline/);
  expect(html).toContain('class="nh-grid"');
  expect(html).toContain('class="nh-main"');
  expect(html).toContain('class="nh-rail"');
  expect(html).toContain('MY WATCHLIST');
  expect(html).toContain('CONFLICT PULSE');
  expect(html).not.toContain("India&#x27;s Cyber-Crime Map Just Crossed a Line");
});
