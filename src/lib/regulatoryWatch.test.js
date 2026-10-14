import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F169 T6. Regulatory Body Watch stopped at the first feed that answered (RBI notifications, about
 * 10 items), so RBI press releases and SEBI were never read and the 121 stored rows were hidden.
 * It now reads the three feeds together and keeps the stored rows behind them, newest first.
 */
const rss = (items) =>
  `<?xml version="1.0"?><rss><channel>${items
    .map(([t, link, date]) => `<item><title>${t}</title><link>${link}</link><pubDate>${date}</pubDate></item>`)
    .join('')}</channel></rss>`;

function stub() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    const body = /notifications_rss/.test(u)
      ? rss([['Master Direction on KYC amended', 'https://rbi.org.in/n1', 'Tue, 14 Oct 2026 09:00:00 GMT']])
      : /pressreleases_rss/.test(u)
        ? rss([['RBI announces the auction of state government securities', 'https://rbi.org.in/p1', 'Mon, 13 Oct 2026 09:00:00 GMT']])
        : /sebi\.gov\.in/.test(u)
          ? rss([['SEBI issues a circular on mutual fund disclosures', 'https://www.sebi.gov.in/s1', 'Sun, 12 Oct 2026 09:00:00 GMT']])
          : null;
    if (body == null) return { ok: false, status: 404, url: u, headers: new Headers(), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, url: u, headers: new Headers({ 'content-type': 'application/rss+xml' }), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  }));
}

describe('Regulatory Body Watch reads every feed (F169 T6)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('merges RBI notifications, RBI press releases and SEBI, then the stored rows, newest first', async () => {
    stub();
    const { serveFeatureFeed } = await import('../../server/featureFeed.mjs');
    const out = await serveFeatureFeed(new URLSearchParams({ tier: 'national', feature: 'Regulatory Body Watch (RBI/SEBI/TRAI/CCI)' }));
    const titles = out.rows.map((r) => r.title);
    expect(titles.slice(0, 3)).toEqual([
      'Master Direction on KYC amended',
      'RBI announces the auction of state government securities',
      'SEBI issues a circular on mutual fund disclosures',
    ]);
    expect(out.rows.slice(0, 3).map((r) => r.regulator)).toEqual(['RBI', 'RBI', 'SEBI']);
    // The stored register stays behind the live items.
    expect(out.rows.length).toBeGreaterThan(100);
  });
});
