import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * F148: Plan & billing in the dark theme. The terminal switches theme with a `.theme-dark` class on
 * its root (src/index.css), so the panel follows with `.theme-dark .plan-up-*` rules built from the
 * same tokens. These tests read the stylesheets, resolve each token and measure the contrast, so a
 * surface that stays light, or a text colour that falls under 4.5:1, fails here.
 */
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const index = read('../index.css');
const css = read('./upgrade.css');

const darkTokens = Object.fromEntries(
  [...index.match(/\.theme-dark \{([^}]*)\}/)[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);

// Every `.theme-dark` rule of upgrade.css, one entry per selector of a group, declarations merged.
const darkRules = new Map();
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
for (const [, selectors, body] of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  for (const raw of selectors.split(',')) {
    const selector = raw.trim();
    if (!selector.startsWith('.theme-dark ')) continue;
    const key = selector.replace(/^\.theme-dark /, '');
    const declared = darkRules.get(key) || {};
    for (const [, prop, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) declared[prop] = value.trim();
    darkRules.set(key, declared);
  }
}

const resolve = (value) => String(value || '').replace(/var\(--([\w-]+)\)/g, (_, name) => darkTokens[name] || '');
const rgb = (hex) => {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const colour = (selector, prop) => {
  const value = resolve(darkRules.get(selector)?.[prop]);
  return /^#[0-9a-f]{3,6}$/i.test(value) ? value : null;
};

describe('Plan & billing in the dark theme (F148)', () => {
  it('re-skins the surfaces, borders and the credits section', () => {
    for (const selector of [
      '.plan-up-card', '.plan-up-scrim', '.plan-up-x', '.plan-up-plan', '.plan-up-plan.on', '.plan-up-invoices li',
      '.plan-credits-lot', '.plan-credits-answer',
    ]) expect(darkRules.has(selector), `${selector} has no dark rule`).toBe(true);
    expect(darkRules.get('.plan-up-card').background).toBeTruthy();
    expect(darkRules.get('.plan-up-card')['border-color']).toBeTruthy();
    expect(darkRules.get('.plan-up-invoices li')['border-color']).toBeTruthy();
    expect(darkRules.get('.plan-credits-lot')['border-color']).toBeTruthy();
    // The panel's own words, and the credits' words, all have a colour of their own.
    for (const selector of [
      '.plan-up-head h2', '.plan-up-lead', '.plan-up-sub', '.plan-up-note', '.plan-up-selnote',
      '.plan-credits-balance strong', '.plan-credits-cycle', '.plan-credits-sub', '.plan-credits-when',
    ]) expect(darkRules.get(selector)?.color, `${selector} has no dark colour`).toBeTruthy();
  });

  it('uses the app tokens, not new light colours, for the main surfaces', () => {
    expect(darkRules.get('.plan-up-card').background).toBe('var(--panel)');
    expect(darkRules.get('.plan-up-card')['border-color']).toBe('var(--line)');
    expect(darkRules.get('.plan-up-plan').background).toMatch(/var\(--/);
  });

  // [text selector, surface selector]: the text sits on the surface's background.
  const PAIRS = [
    ['.plan-up-head h2', '.plan-up-card'],
    ['.plan-up-kicker', '.plan-up-card'],
    ['.plan-up-lead', '.plan-up-card'],
    ['.plan-up-selnote', '.plan-up-card'],
    ['.plan-up-sub', '.plan-up-card'],
    ['.plan-up-note', '.plan-up-card'],
    ['.plan-up-note a', '.plan-up-card'],
    ['.plan-up-inv-link', '.plan-up-card'],
    ['.plan-up-ok', '.plan-up-card'],
    ['.plan-up-err', '.plan-up-card'],
    ['.plan-up-x', '.plan-up-x'],
    ['.plan-up-plan', '.plan-up-plan'],
    ['.plan-up-plan .amt small', '.plan-up-plan'],
    ['.plan-up-plan .who', '.plan-up-plan'],
    ['.plan-up-plan em', '.plan-up-plan em'],
    ['.plan-up-plan.on', '.plan-up-plan.on'],
    ['.plan-up-plan.on .who', '.plan-up-plan.on'],
    ['.plan-up-pay', '.plan-up-pay'],
    ['.plan-up-renew', '.plan-up-renew'],
    ['.plan-up-invoices li', '.plan-up-card'],
    ['.plan-credits-balance strong', '.plan-up-card'],
    ['.plan-credits-negative strong', '.plan-up-card'],
    ['.plan-credits-owed', '.plan-up-card'],
    ['.plan-credits-cycle', '.plan-up-card'],
    ['.plan-credits-until', '.plan-up-card'],
    ['.plan-credits-sub', '.plan-up-card'],
    ['.plan-credits-when', '.plan-up-card'],
    ['.plan-credits-open', '.plan-up-card'],
    ['.plan-credits-open:hover', '.plan-credits-open:hover'],
  ];

  it.each(PAIRS)('%s keeps at least 4.5:1 on its surface', (text, surface) => {
    const fg = colour(text, 'color');
    const bg = colour(surface, 'background') || colour(surface, 'background-color');
    expect(fg, `${text} colour`).not.toBeNull();
    expect(bg, `${surface} background`).not.toBeNull();
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('follows the theme class the terminal root carries', () => {
    expect(index).toMatch(/\.theme-dark \{[^}]*--panel:/);
    const shell = read('./TerminalShell.jsx');
    expect(shell).toContain('theme-${theme}');
    // The credits page, and Plan and invoices in it (F184), render inside that root, not in a portal.
    expect(shell.indexOf('<CreditsPage')).toBeGreaterThan(shell.indexOf('theme-${theme}'));
    expect(read('./PlanBilling.jsx')).not.toContain('createPortal');
  });
});
