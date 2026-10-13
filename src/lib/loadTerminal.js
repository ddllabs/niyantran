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
