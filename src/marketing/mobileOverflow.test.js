import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// The homepage scrolled sideways at 375px (2026-10-14): the trivia band is a .mkt-wrap (full width
// less the gutters) with its own padding and border added on top, 47px too wide on phones. Up to
// 768px, where the gutters shrink to 16px, its padding and border sit inside its width.
it('keeps the trivia band inside the page on phones and tablets', () => {
  const css = readFileSync(new URL('./marketing.css', import.meta.url), 'utf8');
  const blocks = [...css.matchAll(/@media \(max-width: 768px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  expect(blocks.some((b) => /\.mkt-trivia-inner\s*\{[^}]*box-sizing:\s*border-box/.test(b))).toBe(true);
});
