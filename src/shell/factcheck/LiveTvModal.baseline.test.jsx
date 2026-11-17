// F344 T6: with the flag off the modal must look exactly as it did before fact-check existed.
// The fixture is the player region (from the body to the lower tabs) rendered before the change.
// If Live TV's own markup changes on purpose, regenerate the fixture in the same commit.
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LiveTvModal from '../LiveTvModal.jsx';

const region = (html) => html.slice(html.indexOf('<div class="ltv-body'), html.indexOf('<div class="ltv-deck-tabs"'));

describe('Live TV with fact-check off', () => {
  const html = renderToStaticMarkup(<LiveTvModal open onClose={() => {}} />);

  it('renders the player region exactly as before', () => {
    const expected = readFileSync(new URL('./fixtures/ltv-body-player-region.html', import.meta.url), 'utf8').trimEnd();
    expect(region(html)).toBe(expected);
  });

  it('adds no fact-check markup, class or text anywhere', () => {
    expect(html).not.toMatch(/fc-|Fact-check|fact-check/);
  });

  it('keeps the four tabs and their ids', () => {
    for (const id of ['schedule', 'videos', 'archive', 'transcript']) expect(html).toContain(`id="ltv-tab-${id}"`);
  });
});
