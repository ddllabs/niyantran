// F359: Live TV is a page at #/livetv. The route is plain functions over a browser-like object, so
// it runs here without a DOM (the vitest environment is node).
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from './fakeBrowser.js';
import { LIVETV_HASH, backFromLiveTv, goLiveTv, parseLiveTvHash, watchLiveTv } from './liveTvRoute.js';

describe('parseLiveTvHash', () => {
  it.each(['#/livetv', '#/LiveTV', '#/livetv/', '#livetv', '#/livetv?x=1'])('opens the page for %s', (hash) => {
    expect(parseLiveTvHash(hash)).toBe(true);
  });
  it.each(['', '#', '#/', '#/home', '#/national', '#/account/credits', '#/livetvs', '#/national/livetv'])('does not for %s', (hash) => {
    expect(parseLiveTvHash(hash)).toBe(false);
  });
});

describe('watchLiveTv', () => {
  it('opens on the hash #/livetv', () => {
    const b = fakeBrowser('#/home');
    const seen = [];
    watchLiveTv((open) => seen.push(open), b);
    b.location.hash = '#/livetv';
    expect(seen).toEqual([true]);
  });
  it('opens on the old hash #livetv', () => {
    const b = fakeBrowser('#/home');
    const seen = [];
    watchLiveTv((open) => seen.push(open), b);
    b.location.hash = '#livetv';
    expect(seen).toEqual([true]);
  });
  it('opens on the event nter:open-livetv, and the address becomes #/livetv', () => {
    const b = fakeBrowser('#/national');
    const seen = [];
    watchLiveTv((open) => seen.push(open), b);
    b.dispatchEvent({ type: 'nter:open-livetv' });
    expect(b.location.hash).toBe(LIVETV_HASH);
    expect(seen.at(-1)).toBe(true);
  });
  it('closes when the address leaves #/livetv (hashchange and popstate)', () => {
    const b = fakeBrowser('#/livetv');
    const seen = [];
    watchLiveTv((open) => seen.push(open), b);
    b.location.hash = '#/national';
    expect(seen).toEqual([false]);
    b._hash = '#/livetv';
    b.dispatchEvent({ type: 'popstate' });
    b._hash = '#/home';
    b.dispatchEvent({ type: 'popstate' });
    expect(seen).toEqual([false, true, false]);
  });
  it('stops listening when unsubscribed', () => {
    const b = fakeBrowser('#/home');
    const off = watchLiveTv(() => {}, b);
    expect(b.count('hashchange') + b.count('popstate') + b.count('nter:open-livetv')).toBe(3);
    off();
    expect(b.count('hashchange') + b.count('popstate') + b.count('nter:open-livetv')).toBe(0);
  });
});

describe('Back from Live TV', () => {
  it('goes back in history when the page was entered from inside the app', () => {
    const b = fakeBrowser('#/national');
    goLiveTv(b);
    expect(b.location.hash).toBe(LIVETV_HASH);
    const home = vi.fn();
    backFromLiveTv(home, b);
    expect(b.backCalls).toBe(1);
    expect(home).not.toHaveBeenCalled();
  });
  it('goes to the default desk when the page was opened by a link or a reload', () => {
    const b = fakeBrowser('#/livetv');
    const home = vi.fn();
    backFromLiveTv(home, b);
    expect(home).toHaveBeenCalledTimes(1);
    expect(b.backCalls).toBe(0);
  });

  // F359: opening from the old address must not stack a second Live TV entry, or Back lands on Live TV again.
  it('opening while the address already names Live TV pushes no entry', () => {
    const b = fakeBrowser('#/livetv');
    goLiveTv(b);
    expect(b.navigations).toBe(0);
    expect(b.pushed).toEqual([]);
    expect(b.replaced).toEqual([]);
  });
  it('opening from the old #livetv rewrites it to #/livetv in place', () => {
    const b = fakeBrowser('#livetv');
    goLiveTv(b);
    expect(b.navigations).toBe(0);
    expect(b.location.hash).toBe('#/livetv');
    expect(b.replaced).toEqual(['/app#/livetv']);
  });
});
