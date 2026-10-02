import { describe, expect, it, vi } from 'vitest';
import { MAX_THUMBNAILS, THUMB_WIDTH, createThumbnailCache, requestThumbnail, thumbnailKey } from './thumbnailCache.js';

function fakeUrls() {
  let n = 0;
  const live = new Set();
  return {
    live,
    createUrl: vi.fn(() => { const url = `blob:t${++n}`; live.add(url); return url; }),
    revokeUrl: vi.fn((url) => { live.delete(url); }),
  };
}

describe('createThumbnailCache', () => {
  it('keeps each thumbnail as an object URL, served again from the cache', () => {
    const urls = fakeUrls();
    const cache = createThumbnailCache(urls);
    const url = cache.put('d1:p:4', { type: 'image/webp' });
    expect(cache.get('d1:p:4')).toBe(url);
    expect(cache.get('d1:p:5')).toBeUndefined();
  });

  it(`keeps at most ${MAX_THUMBNAILS}, dropping and revoking the least recently used`, () => {
    const urls = fakeUrls();
    const cache = createThumbnailCache({ ...urls, max: 3 });
    const first = cache.put('a', {});
    cache.put('b', {});
    cache.put('c', {});
    cache.get('a'); // a is used again, so b is now the least recently used
    cache.put('d', {});
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(first);
    expect(urls.live.size).toBe(3);
  });

  it('replacing a key revokes its old URL; clear revokes everything', () => {
    const urls = fakeUrls();
    const cache = createThumbnailCache(urls);
    const old = cache.put('a', {});
    cache.put('a', {});
    expect(urls.revokeUrl).toHaveBeenCalledWith(old);
    cache.put('b', {});
    cache.clear();
    expect(urls.live.size).toBe(0);
    expect(cache.get('b')).toBeUndefined();
  });
});

describe('thumbnailKey', () => {
  it('names the document, its stored file, and the page, so a replaced file is not served old thumbnails', () => {
    const parts = [{ part_index: 0, byte_size: 1200 }, { part_index: 1, byte_size: 800 }];
    expect(thumbnailKey('d1', parts, 4)).toBe('d1:1200-800:4');
    expect(thumbnailKey('d1', [{ part_index: 0, byte_size: 999 }], 4)).not.toBe(thumbnailKey('d1', parts, 4));
  });
});

describe('requestThumbnail', () => {
  function fakePool() {
    const jobs = [];
    return {
      jobs,
      request: vi.fn((job) => {
        const handle = { cancel: vi.fn(), setPriority: vi.fn() };
        jobs.push({ job, handle });
        return handle;
      }),
    };
  }
  const canvas = () => ({ toBlob: vi.fn(function toBlob(done, type) { done({ type }); }) });

  it('answers a cached thumbnail at once, without drawing', () => {
    const urls = fakeUrls();
    const cache = createThumbnailCache(urls);
    const url = cache.put('k', {});
    const pool = fakePool();
    const onReady = vi.fn();
    requestThumbnail({ pool, cache, key: 'k', page: 4, priority: 0, onReady, createCanvas: canvas });
    expect(onReady).toHaveBeenCalledWith(url);
    expect(pool.request).not.toHaveBeenCalled();
  });

  it(`draws an uncached page as a thumbnail ${THUMB_WIDTH} px wide, keeps it as WebP, and answers its URL`, () => {
    const cache = createThumbnailCache(fakeUrls());
    const pool = fakePool();
    const onReady = vi.fn();
    const made = canvas();
    requestThumbnail({ pool, cache, key: 'k', page: 4, priority: 3, onReady, createCanvas: () => made });
    const { job } = pool.jobs[0];
    expect(job).toMatchObject({ page: 4, kind: 'thumb', priority: 3, canvas: made, textLayer: null });
    expect(job.scaleFor({ width: 600, height: 800 })).toBe(THUMB_WIDTH / 600);
    job.onDone({ status: 'done' });
    expect(made.toBlob.mock.calls[0][1]).toBe('image/webp');
    expect(onReady).toHaveBeenCalledWith(cache.get('k'));
  });

  it('a cancelled request keeps nothing and answers nothing', () => {
    const cache = createThumbnailCache(fakeUrls());
    const pool = fakePool();
    const onReady = vi.fn();
    const handle = requestThumbnail({ pool, cache, key: 'k', page: 4, priority: 0, onReady, createCanvas: canvas });
    handle.cancel();
    expect(pool.jobs[0].handle.cancel).toHaveBeenCalled();
    pool.jobs[0].job.onDone({ status: 'done' });
    expect(cache.get('k')).toBeUndefined();
    expect(onReady).not.toHaveBeenCalled();
  });
});
