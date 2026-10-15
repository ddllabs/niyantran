// F193 (owner 2026-10-15): on a desk landing page or Home, an AI panel left open (an answer opened
// from the credits page) floats over the page on desktop instead of narrowing it; module pages keep
// the docked panel, and phones keep the stacked panel row.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const block = (() => {
  const at = css.indexOf('/* F193: on a desk landing page or Home');
  return at < 0 ? '' : css.slice(at, css.indexOf('\n}\n', at) + 2);
})();

it('gives a landing page or Home the whole width while AI is open, on desktop only', () => {
  expect(block).toContain('@media (min-width: 901px)');
  expect(block).toMatch(/\.workspace\.ai-open:is\(\.home, \.desk-guide-mode\) \{ grid-template-columns: minmax\(0, 1fr\) !important; \}/);
});

it('lays the panel over the page at its usual width, from the top of the workspace to the bottom', () => {
  expect(block).toMatch(/\.workspace\.ai-open:is\(\.home, \.desk-guide-mode\) > \.side-panel \{[^}]*position: absolute; top: 0; right: 0; bottom: 0;[^}]*width: clamp\(400px, var\(--panel-chosen, 50%\), 60%\);/);
});

it('leaves module pages docked', () => {
  expect(css).toMatch(/\.workspace\.ai-open \{\s*grid-template-columns: minmax\(0, 1fr\) clamp\(400px, var\(--panel-chosen, 50%\), 60%\) !important;/);
});
