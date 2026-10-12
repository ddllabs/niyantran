import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// CC BY 4.0 credit for the globe textures lives in the site footer.
it('credits the Earth imagery and its licence in the marketing footer', () => {
  const site = readFileSync(new URL('./MarketingSite.jsx', import.meta.url), 'utf8');
  const footer = site.slice(site.indexOf('<footer'), site.indexOf('</footer>'));
  expect(footer).toContain('https://ssi.solarsystemscope.com/textures/');
  expect(footer).toContain('https://creativecommons.org/licenses/by/4.0/');
});
