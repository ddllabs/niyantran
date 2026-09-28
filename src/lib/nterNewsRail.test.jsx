import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { serveNterLatest } from '../../server/nterNews.mjs';
import { fetchNterLatest } from './nterNewsClient.js';
import NterLatestRail from '../marketing/NterLatestRail.jsx';

describe('CR-12 — NTER.news on Home Page / Live Latest Rail', () => {
  beforeEach(async () => {
    const seed = await serveNterLatest({ limit: 8 });
    global.fetch = vi.fn().mockImplementation((url) => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(seed),
      });
    });
  });

  it('retrieves valid data contract from server serveNterLatest()', async () => {
    const res = await serveNterLatest({ limit: 8 });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('nter.news');
    expect(Array.isArray(res.rows)).toBe(true);
    expect(typeof res.note).toBe('string');

    if (res.rows.length > 0) {
      const first = res.rows[0];
      expect(first.title).toBeDefined();
      expect(typeof first.title).toBe('string');
      expect(first.link).toBeDefined();
      expect(first.src).toBeDefined();
    }
  });

  it('client fetchNterLatest falls back gracefully and handles API responses', async () => {
    const data = await fetchNterLatest({ limit: 4 });
    expect(data).toBeDefined();
    expect(data.ok).toBe(true);
    expect(data.source).toBe('nter.news');
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.rows.length).toBeGreaterThan(0);
  });

  it('renders NterLatestRail with live badge and headline content', () => {
    const html = renderToStaticMarkup(<NterLatestRail limit={4} />);
    expect(html).toContain('nter-rail-section');
    expect(html).toContain('NTER.news Intelligence Rail');
    expect(html).toContain('Live Latest');
    expect(html).toContain('https://nter.news');
  });

  it('each rendered news item contains required metadata attributes', async () => {
    const data = await fetchNterLatest({ limit: 4 });
    expect(data.rows.length).toBeGreaterThan(0);

    const first = data.rows[0];
    expect(first.title).toBeTruthy();
    expect(first.link).toMatch(/^https?:\/\//);
    expect(first.dek).toBeDefined();
    expect(first.src).toBeDefined();
  });
});
