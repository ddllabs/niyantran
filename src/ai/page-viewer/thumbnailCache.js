/**
 * Page thumbnails (docs/specs/2026-10-02-viewer-continuous.md, section 5): drawn by the part pool
 * behind every page render, kept as small WebP images (object URLs), at most 300, the least
 * recently used dropped. Thumbnails are images, not canvases, so they cost no canvas memory.
 */

/** Thumbnails kept at once. */
export const MAX_THUMBNAILS = 300;
/** A thumbnail's CSS width; drawn at twice that, so it stays sharp on dense screens. */
export const THUMB_WIDTH = 120;
const THUMB_DPR = 2;
const WEBP_QUALITY = 0.75;

const defaultCreateUrl = blob => URL.createObjectURL(blob);
const defaultRevokeUrl = url => URL.revokeObjectURL(url);

/** An LRU of object URLs by key; a dropped or replaced URL is revoked. */
export function createThumbnailCache({ max = MAX_THUMBNAILS, createUrl = defaultCreateUrl, revokeUrl = defaultRevokeUrl } = {}) {
  const urls = new Map();
  return {
    get(key) {
      const url = urls.get(key);
      if (url === undefined) return undefined;
      urls.delete(key);
      urls.set(key, url);
      return url;
    },
    put(key, blob) {
      const old = urls.get(key);
      if (old !== undefined) {
        urls.delete(key);
        revokeUrl(old);
      }
      const url = createUrl(blob);
      urls.set(key, url);
      while (urls.size > max) {
        const [oldestKey, oldestUrl] = urls.entries().next().value;
        urls.delete(oldestKey);
        revokeUrl(oldestUrl);
      }
      return url;
    },
    clear() {
      for (const url of urls.values()) revokeUrl(url);
      urls.clear();
    },
  };
}

/** A thumbnail's key: the document, its stored file (the parts' sizes), and the page. */
export function thumbnailKey(documentId, parts, page) {
  return `${documentId}:${(parts ?? []).map(p => p.byte_size).join('-')}:${page}`;
}

const defaultCreateCanvas = () => document.createElement('canvas');

/**
 * `onReady(url)` with page `page`'s thumbnail: at once from the cache, else drawn by the pool as a
 * thumbnail job (after every page) and kept. Answers `{cancel, setPriority}`; a cancelled request
 * keeps nothing and answers nothing.
 */
export function requestThumbnail({ pool, cache, key, page, priority, onReady, createCanvas = defaultCreateCanvas }) {
  const cached = cache.get(key);
  if (cached !== undefined) {
    onReady(cached);
    return { cancel() {}, setPriority() {} };
  }
  let cancelled = false;
  const canvas = createCanvas();
  const handle = pool.request({
    page,
    canvas,
    textLayer: null,
    kind: 'thumb',
    priority,
    dpr: THUMB_DPR,
    scaleFor: base => THUMB_WIDTH / base.width,
    onDone: () => {
      if (cancelled) return;
      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        onReady(cache.put(key, blob));
      }, 'image/webp', WEBP_QUALITY);
    },
    onError: () => {},
  });
  return {
    cancel() {
      cancelled = true;
      handle.cancel();
    },
    setPriority: value => handle.setPriority(value),
  };
}
