/**
 * F145: the terminal loads on demand (App.jsx), so a signed-out visitor does not download it. The
 * sign-in and sign-up pages start fetching it in the background, once, when the browser is idle;
 * App's lazy TerminalShell uses the same loader, so the chunk is fetched once.
 */
export const loadTerminal = () => import('../shell/TerminalShell.jsx');

const whenIdle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));

export function createTerminalPrefetch({ load = loadTerminal, idle = whenIdle } = {}) {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    // A failed prefetch is harmless: signing in loads the terminal again.
    idle(() => { load().catch(() => {}); });
  };
}

export const prefetchTerminal = createTerminalPrefetch();

const STALE_RELOAD_KEY = 'niyantranChunkReload';

/**
 * F145 review: after a deploy, a page opened earlier asks for terminal files that no longer exist.
 * Vite reports that as 'vite:preloadError'; reloading fetches the new names. At most once a minute,
 * so a real outage shows the error screen (ChunkBoundary) instead of reloading in a loop.
 */
export function reloadForStaleChunk(event, { storage = sessionStorage, reload = () => location.reload(), now = Date.now } = {}) {
  const last = storage.getItem(STALE_RELOAD_KEY);
  if (last !== null && now() - Number(last) < 60_000) return false;
  storage.setItem(STALE_RELOAD_KEY, String(now()));
  event.preventDefault();
  reload();
  return true;
}

