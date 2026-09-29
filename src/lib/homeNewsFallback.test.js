// Found by the F21 lint probe: /data/news.json called snapshotNewsFile(),
// which 5e54af2 deleted, so the route threw a ReferenceError whenever nter.news
// had no live rows instead of answering with the honest empty payload.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../server/nterNews.mjs', async (original) => ({
  ...(await original()),
  serveNterLatest: vi.fn(async () => ({ ok: true, rows: [], note: 'no rows yet' })),
}));
import { handleHomeApi } from '../../server/homeApi.mjs';

describe('/data/news.json without live nter.news rows', () => {
  it('answers the cached nter.news snapshot (or the honest empty payload) instead of a 502', async () => {
    let body = '';
    const res = { statusCode: 200, setHeader() {}, end: (b) => { body = b; } };
    await handleHomeApi({ method: 'GET', url: '/data/news.json', headers: { host: 'localhost' } }, res, () => {});
    const json = JSON.parse(body);
    expect(res.statusCode).toBe(200);
    expect(json.error).toBeUndefined();
    expect(Array.isArray(json.rows)).toBe(true);
    expect(json.source).toBe('nter.news');
  });
});
