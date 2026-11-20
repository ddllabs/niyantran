// W: the page passes the panel the title of what is playing and the seconds left in a recorded video.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from './hookHarness.js';

const h = vi.hoisted(() => ({ channels: [], fcArgs: null, fcView: null, player: null, position: 40, recent: [] }));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  return {
    fetchLiveTvChannels: async () => ({ ok: true, channels: h.channels, categories: ['NEWS'] }),
    fetchLiveTvVideos: async () => ({ ok: true, dataOrigin: 'fallback', liveVideo: null, recentVideos: h.recent }),
    fetchLiveTvSchedule: never, fetchLiveTvArchive: never,
  };
});
vi.mock('./factcheck/useFactCheck.js', () => ({
  useFactCheck: (args) => { h.fcArgs = args; return { view: h.fcView, actions: { confirm() {}, choose() {} } }; },
}));
vi.mock('./liveTv/useYoutubePlayer.js', () => ({
  useYoutubePlayer: (_a, opts) => {
    h.player = opts;
    return { iframeRef: { current: null }, requestMute() {}, getPositionS: () => h.position, getPosition: () => (h.position == null ? null : { positionS: h.position, playerState: 1 }), seekS: () => true };
  },
}));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');

const CURATED = 'abcdefghijk';
const PASTED = 'dQw4w9WgXcQ';
const channel = () => ({ id: 'dd-news', name: 'DD News', category: 'NEWS', status: 'recent', lang: 'Hindi', defaultVideoId: CURATED, embedUrl: `https://www.youtube-nocookie.com/embed/${CURATED}?autoplay=1&mute=1&playsinline=1` });
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const render = () => harness.render(LiveTvPage, { open: true, onClose() {} });
const find = (out, pred) => [...elements(out)].find(pred);
const panel = (out) => find(out, (e) => e.props && 'videoTitle' in e.props && 'remainingSeconds' in e.props);
async function open() { h.channels = [channel()]; render(); await flush(); return render(); }
function paste(value) {
  find(render(), (e) => e.type === 'input' && e.props.id === 'ltv-paste-input').props.onChange({ target: { value } });
  find(render(), (e) => e.type === 'form' && /ltv-paste/.test(e.props.className || '')).props.onSubmit({ preventDefault() {} });
  return render();
}
const running = { flag: { available: true }, session: { status: 'idle', claims: [] }, rechecks: {} };

beforeEach(() => {
  harness.reset();
  Object.assign(h, { channels: [], fcArgs: null, fcView: running, player: null, position: 40, recent: [] });
});

describe('videoTitle', () => {
  it('is empty for a live channel stream', async () => {
    const out = await open();
    expect(panel(out).props.videoTitle).toBe('');
  });
  it("is the pasted video's title once the player reports it", async () => {
    await open();
    expect(panel(paste(PASTED)).props.videoTitle).toBe('');
    h.player.onInfo({ title: 'A long debate', durationS: 300, isLive: false });
    expect(panel(render()).props.videoTitle).toBe('A long debate');
    expect(h.fcArgs.start.seed.title).toBe('A long debate'); // the same title the session seed uses
  });
  it('is the title of a Channel Videos item being played', async () => {
    h.recent = [{ id: 'vvvvvvvvvvv', videoId: 'vvvvvvvvvvv', title: 'Budget debate', embedUrl: 'https://www.youtube-nocookie.com/embed/vvvvvvvvvvv?autoplay=1' }];
    await open();
    const play = find(render(), (e) => e.type === 'button' && e.props.children === 'Play Video');
    play.props.onClick();
    const out = render();
    expect(panel(out).props.videoTitle).toBe('Budget debate');
    expect(h.fcArgs.start.seed.title).toBe('Budget debate');
  });
});

describe('remainingSeconds', () => {
  it('is null in live mode, whatever the player says', async () => {
    await open();
    h.player.onInfo({ title: 'x', durationS: 300, isLive: false });
    expect(panel(render()).props.remainingSeconds).toBeNull();
  });

  it('is the duration minus the position for a pasted video the player says is not live', async () => {
    await open();
    paste(PASTED);
    h.player.onInfo({ title: 'T', durationS: 300, isLive: false });
    expect(panel(render()).props.remainingSeconds).toBe(260);
    h.position = 100;
    expect(panel(render()).props.remainingSeconds).toBe(200);
  });

  it.each([
    ['says it is live', { durationS: 300, isLive: true }],
    ['has not said whether it is live', { durationS: 300, isLive: null }],
    ['shows no duration', { durationS: 0, isLive: false }],
    ['shows a missing duration', { durationS: null, isLive: false }],
  ])('is null when the player %s', async (_n, info) => {
    await open();
    paste(PASTED);
    h.player.onInfo({ title: 'T', ...info });
    expect(panel(render()).props.remainingSeconds).toBeNull();
  });

  it('is null when the position is unknown, or past the end', async () => {
    await open();
    paste(PASTED);
    h.player.onInfo({ title: 'T', durationS: 300, isLive: false });
    h.position = null;
    expect(panel(render()).props.remainingSeconds).toBeNull();
    h.position = 400;
    expect(panel(render()).props.remainingSeconds).toBeNull();
  });

  it("never uses the previous video's duration: it waits for the first info of the current video", async () => {
    await open();
    paste(PASTED);
    h.player.onInfo({ title: 'A', durationS: 300, isLive: false });
    expect(panel(render()).props.remainingSeconds).toBe(260);
    // Reload Feed mounts a new player; the page still holds A's info until B's arrives
    find(render(), (e) => e.type === 'button' && e.props.title === 'Reload Live Feed').props.onClick();
    expect(panel(render()).props.remainingSeconds).toBeNull();
    h.player.onInfo({ title: 'A', durationS: 300, isLive: false });
    expect(panel(render()).props.remainingSeconds).toBe(260);
  });

  it('is already right in the render in which the start screen opens', async () => {
    await open();
    paste(PASTED);
    h.player.onInfo({ title: 'T', durationS: 300, isLive: false });
    h.fcView = { ...running, session: { status: 'choosing', claims: [] } };
    expect(panel(render()).props.remainingSeconds).toBe(260);
  });

  it('is a number for a recorded Channel Videos item only when the player says it is not live', async () => {
    h.recent = [{ id: 'vvvvvvvvvvv', videoId: 'vvvvvvvvvvv', title: 'Budget debate', embedUrl: 'https://www.youtube-nocookie.com/embed/vvvvvvvvvvv?autoplay=1' }];
    await open();
    find(render(), (e) => e.type === 'button' && e.props.children === 'Play Video').props.onClick();
    render();
    h.player.onInfo({ title: 'Budget debate', durationS: 600, isLive: null });
    expect(panel(render()).props.remainingSeconds).toBeNull();
    h.player.onInfo({ title: 'Budget debate', durationS: 600, isLive: false });
    expect(panel(render()).props.remainingSeconds).toBe(560);
  });
});
