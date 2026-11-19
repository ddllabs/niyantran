// F363: on a recorded video the page hands the fact-check hook a seek that really moves the player.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen = { args: [], seeks: [] };
// The page starts in 'live'; this makes the first state it declares 'video' (a recorded video).
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, useState: (init) => real.useState(init === 'live' ? 'video' : init) };
});
vi.mock('./useFactCheck.js', () => ({
  useFactCheck: (args) => {
    seen.args.push(args);
    return { view: null, actions: {} };
  },
}));
vi.mock('../liveTv/useYoutubePlayer.js', () => ({
  useYoutubePlayer: () => ({ iframeRef: { current: null }, requestMute() {}, getPositionS: () => 77, getPosition: () => null, seekS: (s) => { seen.seeks.push(s); return true; } }),
}));
const { default: LiveTvPage } = await import('../LiveTvPage.jsx');

beforeEach(() => { seen.args = []; seen.seeks = []; });

describe('seek wiring on a recorded video', () => {
  it('calls the player seekS with the second', () => {
    renderToStaticMarkup(<LiveTvPage open onClose={() => {}} />);
    expect(seen.args[0].start.videoKind).toBe('recorded');
    expect(seen.args[0].seek(130)).toBe(true);
    expect(seen.seeks).toEqual([130]);
  });
});
