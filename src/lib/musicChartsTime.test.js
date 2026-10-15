import { afterEach, describe, expect, it, vi } from 'vitest';
import { REFRESH_DEFAULTS } from '../../server/feedStore.mjs';

/**
 * Task B (2026-10-16): Music Charts timed out at the refresh's 20 s module limit on 9 of 17 runs on
 * 2026-10-15 (India 7 of 10, Global 2 of 7). The loader asked Apple's chart feed with a 20 s limit and only then
 * fell back to iTunes, so one hanging Apple request used the module's whole limit; with one request at a
 * time per host, the other chart waited behind it. Each chart request now has a shorter limit, so a hang
 * on either host leaves time for the fallback inside the module limit.
 */
const ITUNES_JSON = {
  feed: {
    entry: [
      { 'im:name': { label: 'Song One' }, 'im:artist': { label: 'Artist One' }, link: { attributes: { href: 'https://music.apple.com/in/album/1' } } },
      { 'im:name': { label: 'Song Two' }, 'im:artist': { label: 'Artist Two' }, link: { attributes: { href: 'https://music.apple.com/in/album/2' } } },
    ],
  },
};

/** Apple's marketing-tools host never answers (until the request is aborted); iTunes answers at once. */
function stubAppleHang() {
  vi.stubGlobal('fetch', vi.fn((input, init) => {
    const u = String(input?.url || input);
    if (/rss\.marketingtools\.apple\.com/.test(u)) {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    return Promise.resolve(new Response(JSON.stringify(ITUNES_JSON), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Music Charts: a hanging chart host leaves time for the fallback', () => {
  it('each chart request is limited so that both fit inside the refresh module limit with room to spare', async () => {
    const { CHART_FETCH_MS } = await import('../../server/entertainmentApi.mjs');
    expect(CHART_FETCH_MS).toBeGreaterThanOrEqual(5_000);
    expect(2 * CHART_FETCH_MS).toBeLessThanOrEqual(REFRESH_DEFAULTS.moduleMs - 4_000);
  });

  it('India Top 25 answers from iTunes once Apple has not answered within the chart limit', async () => {
    vi.useFakeTimers();
    stubAppleHang();
    const { loadMusicIndia } = await import('../../server/entertainmentApi.mjs');
    let got = null;
    loadMusicIndia().then((v) => { got = v; });
    // Well inside the refresh's 20 s module limit.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(got).toMatchObject({ ok: true, source: 'itunes' });
    expect(got.rows.map((r) => r.title || r.name || r.song)).toHaveLength(2);
  });

  it('Global Top 25 the same', async () => {
    vi.useFakeTimers();
    stubAppleHang();
    const { loadMusicUs } = await import('../../server/entertainmentApi.mjs');
    let got = null;
    loadMusicUs().then((v) => { got = v; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(got).toMatchObject({ ok: true, source: 'itunes' });
  });
});
