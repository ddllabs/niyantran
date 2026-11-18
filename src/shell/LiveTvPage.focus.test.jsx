// F359: opening Live TV moves focus to the page heading once, and a re-render does not take it again.
// The REAL component runs with real effects (hookHarness.js); every null ref is an element stand-in
// whose focus() is recorded.
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness } from './hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  return { fetchLiveTvChannels: never, fetchLiveTvSchedule: never, fetchLiveTvVideos: never, fetchLiveTvArchive: never, fetchLiveTvTranscript: never };
});
vi.mock('./factcheck/useFactCheck.js', () => ({ useFactCheck: () => ({ view: null, actions: {} }) }));
vi.mock('./liveTv/useYoutubePlayer.js', () => ({ useYoutubePlayer: () => ({ iframeRef: { current: null }, requestMute() {}, getPositionS: () => 0 }) }));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');

const focused = [];
beforeEach(() => {
  harness.reset(); focused.length = 0;
  harness.refFactory = () => ({ focus: (options) => focused.push(options), requestFullscreen() {} });
});
const render = (open) => harness.render(LiveTvPage, { open, onClose() {}, onNavigateDesk() {} });

describe('the page heading', () => {
  it('is an h2 that can take focus but is not a tab stop', () => {
    harness.refFactory = null;
    const html = renderToStaticMarkup(<LiveTvPage open onClose={() => {}} />);
    expect(html).toMatch(/<h2[^>]*class="ltv-title"[^>]*tabindex="-1"[^>]*>NIYANTRAN LIVE TV<\/h2>/);
  });

  it('takes focus when the page opens, not while it is closed, and not again on a re-render', () => {
    render(false);
    expect(focused).toHaveLength(0);
    render(true);
    expect(focused).toHaveLength(1);
    expect(focused[0]).toMatchObject({ preventScroll: true });
    render(true);
    render(true);
    expect(focused).toHaveLength(1);
  });

  it('takes focus again on a later visit', () => {
    render(true);
    render(false);
    render(true);
    expect(focused).toHaveLength(2);
  });
});
