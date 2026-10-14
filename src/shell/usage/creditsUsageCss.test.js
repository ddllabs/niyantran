import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * F153: the Credits usage page in both themes. Its surfaces and words use the app tokens, which the
 * terminal root's .theme-dark redefines (src/index.css); the series colours and status pills carry
 * their own dark values. These tests resolve every colour in each theme and measure the contrast, so
 * a word that falls under 4.5:1 on its surface, or a series that falls under 3:1, fails here.
 */
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const index = read('../../index.css');
const css = read('./creditsUsage.css');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

const tokens = (selector) => Object.fromEntries(
  [...index.match(new RegExp(`${selector.replace('.', '\\.')} \\{([^}]*)\\}`))[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);
const THEMES = { light: tokens(':root'), dark: { ...tokens(':root'), ...tokens('.theme-dark') } };

// selector -> declarations, separately for the base rules and the .theme-dark rules.
function rules(dark) {
  const out = new Map();
  for (const [, selectors, body] of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const raw of selectors.split(',')) {
      const selector = raw.trim();
      if (selector.startsWith('@') || selector.startsWith('.theme-dark ') !== dark) continue;
      const key = selector.replace(/^\.theme-dark /, '');
      const declared = out.get(key) || {};
      for (const [, prop, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) declared[prop] = value.trim();
      out.set(key, declared);
    }
  }
  return out;
}
const BASE = rules(false);
const DARK = rules(true);

function value(theme, selector, prop) {
  const own = theme === 'dark' ? { ...BASE.get(selector), ...DARK.get(selector) } : BASE.get(selector) || {};
  const raw = own[prop];
  const resolved = String(raw || '').replace(/var\(--([\w-]+)\)/g, (_, name) => THEMES[theme][name] || '');
  return /^#[0-9a-f]{3,6}$/i.test(resolved) ? resolved : null;
}
function series(theme, slot) {
  const root = theme === 'dark' ? { ...BASE.get('.cu-root'), ...DARK.get('.cu-root') } : BASE.get('.cu-root');
  return root[`--cu-s${slot}`];
}

const rgb = (hex) => {
  const h = hex.replace('#', '');
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

// [text selector, surface selector]
const PAIRS = [
  ['.cu-head h2', '.cu-page'], ['.cu-kicker', '.cu-page'], ['.cu-sub', '.cu-card'], ['.cu-h4', '.cu-card'],
  ['.cu-note', '.cu-card'], ['.cu-caption', '.cu-card'], ['.cu-error', '.cu-card'], ['.cu-owed', '.cu-fig'],
  ['.cu-fig-label', '.cu-fig'], ['.cu-fig-value', '.cu-fig'], ['.cu-fig-sub', '.cu-fig'], ['.cu-inr', '.cu-fig'],
  ['.cu-inr', '.cu-card'], ['.cu-top-num', '.cu-card'], ['.cu-top-name', '.cu-card'], ['.cu-link', '.cu-card'],
  ['.cu-x', '.cu-x'], ['.cu-seg-ctl button', '.cu-seg-ctl'], ['.cu-seg-ctl button.on', '.cu-seg-ctl button.on'],
  ['.cu-select', '.cu-card'], ['.cu-select select', '.cu-select select'], ['.cu-btn', '.cu-btn'], ['.cu-switch', '.cu-card'],
  ['.cu-leg-name', '.cu-card'], ['.cu-leg-share', '.cu-card'], ['.cu-tip', '.cu-tip'], ['.cu-disclose', '.cu-card'],
  ['.cu-table thead th', '.cu-card'], ['.cu-table th', '.cu-card'], ['.cu-chat-open', '.cu-card'], ['.cu-chat-model', '.cu-card'],
  ['.cu-question', '.cu-detail > td'], ['.cu-free', '.cu-detail > td'], ['.cu-mark', '.cu-mark'],
  ['.cu-pill-succeeded', '.cu-pill-succeeded'], ['.cu-pill-failed', '.cu-pill-failed'],
  ['.cu-pill-stopped', '.cu-pill-stopped'], ['.cu-pill-running', '.cu-pill-running'],
];

describe('Credits usage styles (F153)', () => {
  for (const theme of ['light', 'dark']) {
    it.each(PAIRS)(`${theme}: %s keeps at least 4.5:1 on %s`, (text, surface) => {
      const fg = value(theme, text, 'color');
      const bg = value(theme, surface, 'background') || value(theme, surface, 'background-color');
      expect(fg, `${text} colour`).not.toBeNull();
      expect(bg, `${surface} background`).not.toBeNull();
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: every chart series stands out from the card at 3:1 or more`, () => {
      const card = value(theme, '.cu-card', 'background');
      for (let slot = 0; slot < 8; slot++) expect(contrast(series(theme, slot), card), `slot ${slot}`).toBeGreaterThanOrEqual(3);
    });
  }

  it('keeps the series and pills in a dark rule of their own, and the surfaces on tokens', () => {
    for (const slot of [0, 7]) expect(series('dark', slot)).not.toBe(series('light', slot));
    for (const pill of ['.cu-pill-succeeded', '.cu-pill-failed', '.cu-pill-stopped', '.cu-pill-running']) expect(DARK.has(pill), pill).toBe(true);
    for (const surface of ['.cu-page', '.cu-card', '.cu-fig', '.cu-tip']) expect(BASE.get(surface).background).toMatch(/^var\(--/);
  });

  it('respects reduced motion and names only cu- classes, with no dollar', () => {
    expect(bare).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.cu-seg \{ transition/);
    const classes = bare.match(/\.[a-z][\w-]*/g) || [];
    expect(classes.filter((c) => !c.startsWith('.cu-') && c !== '.theme-dark' && c !== '.on' && c !== '.off')).toEqual([]);
    expect(css).not.toMatch(/\$|usd|dollar/i);
  });
});
