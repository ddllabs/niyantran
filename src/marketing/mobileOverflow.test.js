import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The homepage scrolled sideways at 375px (2026-10-14): the trivia band is a .mkt-wrap (full width
// less the gutters) with its own padding and border added on top, 47px too wide on phones; at
// 1440px it started at x=1 instead of the 24px gutter (F80, F171 B16). Its padding and border sit
// inside its width at every width (measured: no sideways scroll at 320, 768 or 1440px).
it('keeps the trivia band inside the page gutter at every width', () => {
  const css = readFileSync(new URL('./marketing.css', import.meta.url), 'utf8');
  const top = css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
  expect(/\.mkt-trivia-inner\s*\{[^}]*box-sizing:\s*border-box/.test(top)).toBe(true);
});
