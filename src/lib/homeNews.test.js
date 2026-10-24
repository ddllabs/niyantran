import { describe, expect, it } from 'vitest';
import { savedHomeNews, newsCheckLabel, newsPublication, NEWS_CACHE_MS } from './homeNews.js';
const now = Date.parse('2026-10-25T00:00:00Z');
const body = { delivery: 'rss', rows: [{ title: 'Current' }], checked_at: new Date(now).toISOString(), updated: '2026-10-24T14:39:07Z' };
describe('news cache and publication labels', () => {
  it('rejects the old seed/cache and expired or undated saved news', () => {
    expect(savedHomeNews({ rows: [{ title: 'September seed' }] }, now)).toBeNull();
    expect(savedHomeNews({ ...body, checked_at: null }, now)).toBeNull();
    expect(savedHomeNews(body, now + 86400_001)).toBeNull();
  });
  it('keeps old publication time separate from the latest successful source check', () => {
    expect(savedHomeNews(body, now)).toMatchObject({ archive: false, stale: false });
    expect(newsCheckLabel(body, now)).toBe('checked · just now');
    expect(newsPublication(body.updated)).toBe('24 Oct 2026');
    expect(newsPublication('invalid')).toBe('');
  });
  it('marks saved results stale after five minutes, including a successful empty feed', () => {
    expect(savedHomeNews(body, now + NEWS_CACHE_MS).archive).toBe(true);
    expect(newsCheckLabel(body, now + NEWS_CACHE_MS)).toBe('previously fetched · 5m ago');
    expect(savedHomeNews({ ...body, rows: [] }, now).rows).toEqual([]);
  });
});
