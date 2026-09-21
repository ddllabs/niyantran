/**
 * Live same-origin /api/* helpers.
 * - Local Vite: always on.
 * - Production: home desk + feature-feed are deployed on Vercel.
 * - Set VITE_LIVE_API=0 to force static archive only.
 */
export function liveApiEnabled() {
  try {
    if (import.meta.env.VITE_LIVE_API === '1') return true;
    if (import.meta.env.VITE_LIVE_API === '0') return false;
    return Boolean(import.meta.env.DEV);
  } catch {
    return false;
  }
}

/** Home markets / nter.news / pulse / ohlc — available on live and local. */
export function homeLiveApiEnabled() {
  try {
    if (import.meta.env.VITE_LIVE_API === '0') return false;
    return true;
  } catch {
    return true;
  }
}

/** Desk /api/feature-feed — shipped on Vercel; same default as home APIs. */
export function featureFeedApiEnabled() {
  try {
    if (import.meta.env.VITE_LIVE_API === '0') return false;
    return true;
  } catch {
    return true;
  }
}
