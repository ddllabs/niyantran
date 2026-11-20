// F367: LIVE means the video this page plays is live. A per-channel video lookup that says "live" but is not
// YouTube data (a fallback answer) must not change the header badge or the tile. (F377: one that is YouTube data
// does; see LiveTvPage.livevideo.test.jsx.)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from './hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  const channels = [
    { id: 'dd-news', name: 'DD News', category: 'NEWS', status: 'recent', lang: 'Hindi', defaultVideoId: 'abcdefghijk', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1' },
  ];
  return {
    fetchLiveTvChannels: async () => ({ ok: true, channels, categories: ['NEWS'] }),
    fetchLiveTvVideos: async () => ({ ok: true, source: 'youtube-api', dataOrigin: 'fallback', status: 'live', liveVideo: { videoId: 'zzzzzzzzzzz' }, recentVideos: [] }),
    fetchLiveTvSchedule: never, fetchLiveTvArchive: never, fetchLiveTvTranscript: never,
  };
});
vi.mock('./factcheck/useFactCheck.js', () => ({ useFactCheck: () => ({ view: null, actions: {} }) }));
vi.mock('./liveTv/useYoutubePlayer.js', () => ({ useYoutubePlayer: () => ({ iframeRef: { current: null }, requestMute() {}, getPositionS: () => 0 }) }));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');
const { ChannelCard } = await import('./liveTv/ChannelCard.jsx');

beforeEach(() => harness.reset());

describe('a per-channel lookup that says live without YouTube data', () => {
  it('does not change the header badge or the tile: only the channel list says what is playing', async () => {
    const page = () => harness.render(LiveTvPage, { open: true, onClose() {} });
    page();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    const out = page();
    const badge = [...elements(out)].find((e) => /ltv-(live|recent|offline)-badge/.test(e.props?.className || ''))?.props.className;
    expect(badge).toBe('ltv-recent-badge');
    const card = [...elements(out)].find((e) => e.type === ChannelCard);
    expect(card.props.visible[0].status).toBe('recent');
  });
});
