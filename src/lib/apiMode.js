/**
 * Live same-origin /api/* helpers.
 * - Local Vite: always on.
 * - Production: home desk routes (/api/home/*, /api/ohlc) are deployed on Vercel.
 * - Other desk APIs still opt in with VITE_LIVE_API=1 (D2).
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
