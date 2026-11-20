// F366 fix round: page behaviour that needs real effects (hookHarness.js), not static markup. The page's
// children are not rendered; the elements it returns are read and their handlers called.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from '../hookHarness.js';

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
const seen = { view: null, choose: vi.fn() };
vi.mock('../../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  const channels = [
    { id: 'dd-news', name: 'DD News', category: 'NEWS', status: 'live', lang: 'Hindi', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdefghijk' },
    { id: 'aaj-tak', name: 'Aaj Tak', category: 'NEWS', status: 'live', lang: 'Hindi', embedUrl: 'https://www.youtube-nocookie.com/embed/lmnopqrstuv' },
  ];
  return { fetchLiveTvChannels: async () => ({ ok: true, channels, categories: ['NEWS'] }), fetchLiveTvSchedule: never, fetchLiveTvVideos: never, fetchLiveTvArchive: never };
});
vi.mock('./useFactCheck.js', () => ({
  useFactCheck: () => ({ view: seen.view, actions: { choose: seen.choose, cancel() {}, confirm() {}, stop() {}, retry() {}, dismiss() {} } }),
}));
vi.mock('./PastSessions.jsx', () => ({ PastSessions: () => null }));
vi.mock('../liveTv/useYoutubePlayer.js', () => ({ useYoutubePlayer: () => ({ iframeRef: { current: null }, requestMute() {}, getPositionS: () => 0 }) }));
const { default: LiveTvPage } = await import('../LiveTvPage.jsx');
const { ChannelCard } = await import('../liveTv/ChannelCard.jsx');
const { FactCheckPanel } = await import('./FactCheckPanel.jsx');

const session = { status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0, transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, final: null, endReason: null, error: null };
const viewWith = (available = true) => ({ flag: { available, creditsPerMinute: 500, userId: available ? 'u1' : null }, supported: true, ready: true, session, announcement: '', balance: 10000 });
const settle = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
const find = (out, type) => [...elements(out)].find((e) => e.type === type);
const tabButtons = (out) => [...elements(out)].filter((e) => e.type === 'button' && e.props.role === 'tab');

beforeEach(() => { harness.reset(); seen.choose.mockClear(); seen.view = viewWith(); });

describe('the start screen is opened by the user only', () => {
  it('opening the page and changing channel never calls choose; pressing the panel entry does', async () => {
    let out = harness.render(LiveTvPage, { open: true, onClose() {} });
    await settle(); // the channels arrive: now a video is playing and the old page would have opened the start screen
    out = harness.render(LiveTvPage, { open: true, onClose() {} });
    expect(find(out, ChannelCard).props.channels).toHaveLength(2);
    find(out, ChannelCard).props.onSelectChannel({ id: 'aaj-tak' });
    out = harness.render(LiveTvPage, { open: true, onClose() {} });
    expect(seen.choose).not.toHaveBeenCalled();
    find(out, FactCheckPanel).props.onChoose();
    expect(seen.choose).toHaveBeenCalledTimes(1);
  });
});

describe('the lower tabs', () => {
  it('fall back to Channel Videos when My sessions is active and stops being offered', () => {
    let out = harness.render(LiveTvPage, { open: true, onClose() {} });
    tabButtons(out).find((b) => b.props.id === 'ltv-tab-sessions').props.onClick();
    out = harness.render(LiveTvPage, { open: true, onClose() {} });
    expect(tabButtons(out).find((b) => b.props.id === 'ltv-tab-sessions').props.tabIndex).toBe(0);
    seen.view = viewWith(false);
    out = harness.render(LiveTvPage, { open: true, onClose() {} });
    const tabs = tabButtons(out);
    expect(tabs.map((t) => t.props.id)).not.toContain('ltv-tab-sessions');
    expect(tabs.find((t) => t.props.id === 'ltv-tab-videos').props.tabIndex).toBe(0);
    expect(tabs.filter((t) => t.props.tabIndex === 0)).toHaveLength(1);
    const panel = [...elements(out)].find((e) => e.props?.id === 'ltv-tab-panel');
    expect(panel.props['aria-labelledby']).toBe('ltv-tab-videos');
  });
});
