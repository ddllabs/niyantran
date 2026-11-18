/**
 * Live TV's address in the terminal (F359, docs/specs/2026-11-18-live-tv-page.md): the shell page
 * #/livetv. The old hash #livetv and the window event nter:open-livetv lead to the same page.
 * The hash is the only source of truth: the page is open exactly while the address names it, so it
 * can never be open together with an account page or a desk (both are other addresses).
 */
import { backFromRestrictedDesk, rememberDeskNavigation } from './deskRouteHistory.js';

export const LIVETV_HASH = '#/livetv';
export const OPEN_LIVETV_EVENT = 'nter:open-livetv';

/** True when an address names Live TV: #/livetv (any case, optional trailing slash or query) or the old #livetv. */
export function parseLiveTvHash(hash = typeof location !== 'undefined' ? location.hash : '') {
  const raw = String(hash || '').replace(/^#/, '').replace(/^\/+/, '').split('?')[0].replace(/\/+$/, '').toLowerCase();
  return raw === 'livetv';
}

/** Opens the page. The new history entry is marked as entered from inside the app, so Back can use history. */
export function goLiveTv(browser = window) {
  const { hash, pathname, search } = browser.location;
  if (parseLiveTvHash(hash)) {
    // Already here: no second entry (Back would land on Live TV again); the old #livetv is rewritten in place.
    if (hash !== LIVETV_HASH) browser.history.replaceState(browser.history.state, '', `${pathname}${search}${LIVETV_HASH}`);
    return;
  }
  rememberDeskNavigation(() => { browser.location.hash = LIVETV_HASH; }, browser);
}

/**
 * Back from the page: one step back in history when the page was entered from inside the app, else
 * onDefault (the shell's default desk). The same rule restricted desks use (deskRouteHistory.js).
 */
export function backFromLiveTv(onDefault, browser = window) {
  backFromRestrictedDesk(onDefault, browser);
}

/**
 * Calls onChange(open) whenever the address moves onto or off Live TV (back, forward, links), and turns
 * the nter:open-livetv event into navigation to the page. Returns the unsubscribe function.
 */
export function watchLiveTv(onChange, browser = window) {
  const sync = () => onChange(parseLiveTvHash(browser.location.hash));
  const onEvent = () => goLiveTv(browser);
  browser.addEventListener('hashchange', sync);
  browser.addEventListener('popstate', sync);
  browser.addEventListener(OPEN_LIVETV_EVENT, onEvent);
  return () => {
    browser.removeEventListener('hashchange', sync);
    browser.removeEventListener('popstate', sync);
    browser.removeEventListener(OPEN_LIVETV_EVENT, onEvent);
  };
}
