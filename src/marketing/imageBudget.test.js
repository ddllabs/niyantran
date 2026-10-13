import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// F145: a first visit downloaded a 34 MB GIF and 2.3 MB of Earth images. Every /brand image the
// site's own code names stays small, and the replaced files are gone.
const SRC = new URL('../', import.meta.url);
const PUBLIC = new URL('../../public/', import.meta.url);
const BUDGET = 600 * 1024;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(jsx?|css)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [url] : [];
  });
}

describe('image weight', () => {
  const named = new Set(sourceFiles(SRC).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/\/brand\/[\w./-]+\.(?:png|jpe?g|gif|webp|svg)/g)].map((m) => m[0])));

  it('keeps every /brand image the code names under 600 KB', () => {
    expect(named.size).toBeGreaterThan(5);
    for (const path of named) {
      const file = new URL(path.slice(1), PUBLIC);
      expect(existsSync(file), path).toBe(true);
      expect(statSync(file).size, path).toBeLessThan(BUDGET);
    }
  });

  it('removes the replaced files: the GIF, the JPEG textures and stand-in, the large globe', () => {
    for (const path of ['brand/globe.gif', 'brand/globe.png', 'brand/auth-earth/day.jpg', 'brand/auth-earth/clouds.jpg', 'brand/auth-earth/oceans.jpg', 'brand/auth-earth/fallback.jpg']) {
      expect(existsSync(new URL(path, PUBLIC)), path).toBe(false);
    }
  });

  it('shows the logo from its small copy wherever it is drawn small', () => {
    const pages = ['marketing/MarketingSite.jsx', 'marketing/HomePage.jsx', 'marketing/LoginPage.jsx', 'marketing/SignupPage.jsx', 'marketing/ForgotPasswordPage.jsx', 'marketing/ResetPasswordPage.jsx', 'shell/TerminalShell.jsx', 'shell/DeskSidebar.jsx', 'admin/AdminApp.jsx', 'admin/AdminLogin.jsx'];
    for (const page of pages) {
      const src = readFileSync(new URL(page, SRC), 'utf8');
      expect(src, page).not.toMatch(/<img[^>]*src="\/brand\/logo\.png/);
      expect(src, page).toContain('/brand/logo-128.webp');
    }
    // The favicon and share image stay the full logo (siteSettingsStore.js).
    expect(readFileSync(new URL('lib/siteSettingsStore.js', SRC), 'utf8')).toContain("faviconUrl: '/brand/logo.png?v=2'");
  });
});
