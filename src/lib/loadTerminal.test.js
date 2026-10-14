import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTerminalPrefetch, reloadForStaleChunk } from './loadTerminal.js';

// F145: sign-in and sign-up fetch the terminal in the background, once, when the browser is idle,
// so signing in does not wait for it.
describe('terminal prefetch', () => {
  it('loads the terminal once, when the browser is idle', () => {
    let loads = 0;
    const idle = [];
    const prefetch = createTerminalPrefetch({ load: () => { loads += 1; return Promise.resolve(); }, idle: (fn) => idle.push(fn) });
    prefetch();
    prefetch();
    expect(loads).toBe(0);
    idle.forEach(fn => fn());
    expect(loads).toBe(1);
  });

  it('swallows a failed prefetch; the real load retries on sign-in', async () => {
    const prefetch = createTerminalPrefetch({ load: () => Promise.reject(new Error('offline')), idle: (fn) => fn() });
    expect(() => prefetch()).not.toThrow();
    await new Promise(r => setTimeout(r, 0));
  });

  it('is started by the sign-in and sign-up pages', () => {
    for (const page of ['LoginPage.jsx', 'SignupPage.jsx']) {
      const src = readFileSync(new URL(`../marketing/${page}`, import.meta.url), 'utf8');
      expect(src, page).toMatch(/import \{ prefetchTerminal \} from '\.\.\/lib\/loadTerminal\.js';/);
      expect(src, page).toMatch(/useEffect\(\(\) => \{ prefetchTerminal\(\); \}, \[\]\);/);
    }
  });
});

// Review: after a deploy, a visitor who opened the site earlier asks for the old terminal file, which
// is gone. Vite reports it as 'vite:preloadError'; a fresh load fetches the new names. Once a minute
// at most, so a real outage shows the error screen instead of reloading in a loop.
describe('stale chunk after a deploy', () => {
  const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

  it('reloads the page once, then leaves the error to the boundary', () => {
    const storage = memory();
    let reloads = 0;
    const event = { preventDefault() { this.prevented = true; } };
    expect(reloadForStaleChunk(event, { storage, reload: () => { reloads += 1; }, now: () => 1000 })).toBe(true);
    expect(event.prevented).toBe(true);
    expect(reloadForStaleChunk({ preventDefault() {} }, { storage, reload: () => { reloads += 1; }, now: () => 30_000 })).toBe(false);
    expect(reloads).toBe(1);
    expect(reloadForStaleChunk({ preventDefault() {} }, { storage, reload: () => { reloads += 1; }, now: () => 62_000 })).toBe(true);
    expect(reloads).toBe(2);
  });

  it('is installed by App.jsx, which also starts the terminal at once for a signed-in visitor', () => {
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
    expect(app).toMatch(/window\.addEventListener\('vite:preloadError', \(e\) => reloadForStaleChunk\(e\)\)/);
    expect(app).toMatch(/if \(typeof sessionStorage !== 'undefined' && isSignedIn\(\)\) loadTerminal\(\)\.catch\(\(\) => \{\}\);/);
    expect(app).toMatch(/<ChunkBoundary>/);
  });
});

