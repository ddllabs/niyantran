import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTerminalPrefetch } from './loadTerminal.js';

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
