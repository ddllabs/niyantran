import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const cache = vi.hoisted(() => ({ boot: null }));
vi.mock('../lib/homeCache.js', () => ({ loadHomeCache: () => cache.boot, homeCacheHasRows: () => true, isHomeCacheFresh: () => true, kickHomeRefreshIfDue: () => {}, saveHomeCache: () => {} }));
vi.mock('../lib/supabaseClient.js', () => ({ supabase: null }));
import HomeDesk from './HomeDesk.jsx';
afterEach(() => { cache.boot = null; });
it('keeps the Home layout while sourcing its hero, ticker and both news areas from publisher articles', () => {
  cache.boot = { latest: { delivery: 'publisher', checked_at: new Date().toISOString(), rows: [{ title: 'Fresh publisher headline', link: 'https://nter.news/articles/fresh/', pub: '2026-10-24T14:39:07Z', category: 'National', dek: 'Published summary', img: 'https://nter.news/assets/uploads/fresh.webp' }] }, markets: { rows: [] }, pulse: { rows: [] } };
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
it('features the newest dated story while retaining publisher order, original dates and card structure elsewhere', () => {
  cache.boot = { latest: { delivery: 'publisher', checked_at: new Date().toISOString(), rows: [
    { title: 'Kashmir pinned lead', link: 'https://nter.news/articles/kashmir/', pub: '2026-08-30', img: 'https://nter.news/assets/images/photo.png' },
    { title: 'Shinde second', link: 'https://nter.news/articles/shinde/', pub: '2026-10-24' },
    { title: 'Siang third', link: 'https://nter.news/articles/siang/', pub: null },
  ] }, markets: { rows: [] }, pulse: { rows: [] } };
  const html = renderToStaticMarkup(<HomeDesk onOpen={() => {}} onFeed={() => {}} onSelect={() => {}} />);
  const hero = html.match(/<article class="nh-hero">[\s\S]*?<\/article>/)[0];
  expect(hero).toContain('Shinde second');
  expect(hero).toContain('24 Oct 2026');
  expect(hero).not.toContain('Kashmir pinned lead');
  expect(html).toMatch(/class="nh-news-lead[\s\S]*Kashmir pinned lead[\s\S]*30 Aug 2026/);
  expect(html).toMatch(/class="nh-news-card no-img"[\s\S]*Siang third/);
  expect(html).toContain('aria-label="nter.news"');
  expect(html).toContain('nter-news-mark-red');
  expect(html).not.toContain('1970');
});
it('uses publication time to choose the hero, retains publisher order for ties and omits a duplicate main-feed card', () => {
  cache.boot = { latest: { delivery: 'publisher', checked_at: new Date().toISOString(), rows: [
    { title: 'Undated first', link: 'https://nter.news/articles/unknown/', pub: null },
    { title: 'Morning', link: 'https://nter.news/articles/morning/', pub: '2026-10-24T08:00:00+05:30' },
    { title: 'Evening first', link: 'https://nter.news/articles/evening/', pub: '2026-10-24T19:00:00+05:30' },
    { title: 'Evening tie', link: 'https://nter.news/articles/tie/', pub: '2026-10-24T19:00:00+05:30' },
  ] }, markets: { rows: [] }, pulse: { rows: [] } };
  const html = renderToStaticMarkup(<HomeDesk onOpen={() => {}} onFeed={() => {}} onSelect={() => {}} />);
  expect(html.match(/<article class="nh-hero">[\s\S]*?<\/article>/)[0]).toContain('Evening first');
  const feed = html.match(/<section class="nh-news"[\s\S]*?<\/section>/)[0];
  expect(feed).not.toContain('Evening first');
  expect(feed.indexOf('Undated first')).toBeLessThan(feed.indexOf('Morning'));
  expect(feed.indexOf('Morning')).toBeLessThan(feed.indexOf('Evening tie'));
});
it('keeps an undated edition usable without inventing a hero date', () => {
  cache.boot = { latest: { delivery: 'publisher', checked_at: new Date().toISOString(), rows: [
    { title: 'Unknown publication', link: 'https://nter.news/articles/unknown/', pub: null },
  ] }, markets: { rows: [] }, pulse: { rows: [] } };
  const html = renderToStaticMarkup(<HomeDesk onOpen={() => {}} onFeed={() => {}} onSelect={() => {}} />);
  const hero = html.match(/<article class="nh-hero">[\s\S]*?<\/article>/)[0];
  expect(hero).toContain('Unknown publication');
  expect(hero).not.toContain('1970');
});
