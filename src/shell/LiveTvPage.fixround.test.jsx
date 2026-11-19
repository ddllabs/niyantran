// Review round on A2 and B4. The rule that holds everywhere: LIVE is shown only when the video being played
// is live. useFactCheck is a small stand-in with the controller's own rules for a target change: a start screen
// that is open is closed, and a running session starts to end.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from './hookHarness.js';

const h = vi.hoisted(() => ({ channels: [], lookup: null, videoCalls: [], fcArgs: null, setSt: null, actions: null, player: null, position: 77, status: 'idle', listGate: null }));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  return {
    fetchLiveTvChannels: async () => { if (h.listGate) await h.listGate; return { ok: true, channels: h.channels, categories: ['NEWS'] }; },
    fetchLiveTvVideos: (id) => { h.videoCalls.push(id); return h.lookup(id); },
    fetchLiveTvSchedule: never, fetchLiveTvArchive: never, fetchLiveTvTranscript: never,
  };
});
vi.mock('./factcheck/useFactCheck.js', async () => {
  const React = await import('react');
  return {
    useFactCheck: (args) => {
      const [st, setSt] = React.useState('idle');
      h.setSt = setSt;
      h.status = st;
      h.fcArgs = args;
      React.useEffect(() => { setSt((s) => (s === 'choosing' ? 'idle' : s === 'running' || s === 'starting' ? 'ending' : s)); }, [args.target]);
      h.actions = h.actions || { choose: vi.fn(), confirm: vi.fn() };
      h.actions.choose.mockImplementation(() => setSt('choosing'));
      return { view: { flag: { available: true }, ready: Boolean(args.target), session: { status: st, claims: [] }, rechecks: {} }, actions: h.actions };
    },
  };
});
vi.mock('./liveTv/useYoutubePlayer.js', () => ({
  useYoutubePlayer: (_a, opts) => {
    h.player = opts;
    return { iframeRef: { current: null }, requestMute() {}, getPositionS: () => h.position, getPosition: () => ({ positionS: h.position, playerState: 1 }), seekS: () => true };
  },
}));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');
const { ChannelCard } = await import('./liveTv/ChannelCard.jsx');

const CURATED = 'abcdefghijk';
const LIVE = 'zzzzzzzzzzz';
const LIVE2 = 'yyyyyyyyyyy';
const embed = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&playsinline=1`;
const channel = (over = {}) => ({ id: 'dd-news', name: 'DD News', category: 'NEWS', status: 'recent', lang: 'Hindi', defaultVideoId: CURATED, embedUrl: embed(CURATED), ...over });
const answer = (over = {}) => ({ ok: true, source: 'youtube-api', dataOrigin: 'youtube-api', status: 'live', liveVideo: { videoId: LIVE }, recentVideos: [], ...over });
const none = () => answer({ liveVideo: null, status: 'recent' });

const flush = async () => { for (let i = 0; i < 14; i += 1) await Promise.resolve(); };
const render = (open = true) => harness.render(LiveTvPage, { open, onClose() {} });
const find = (out, pred) => [...elements(out)].find(pred);
const frame = (out) => find(out, (e) => e.type === 'iframe');
const badge = (out) => find(out, (e) => /ltv-(live|recent|offline)-badge/.test(e.props?.className || ''))?.props.className;
const card = (out) => find(out, (e) => e.type === ChannelCard);
const tile = (out, id) => card(out).props.visible.find((c) => c.id === id);
async function open(channels = [channel(), channel({ id: 'wion', name: 'WION' })], lookup = async () => answer()) {
  h.channels = channels; h.lookup = lookup;
  render(); await flush();
  render(); await flush(); // the list arrived: the lookup for the channel shown is made and answered
  return render();
}
async function reopen() {
  render(false);
  render(true); await flush();
  return render();
}
const stateOf = async (st) => { h.setSt(st); await flush(); return render(); };

beforeEach(() => {
  harness.reset();
  harness.refFactory = null;
  Object.assign(h, { channels: [], lookup: null, videoCalls: [], fcArgs: null, setSt: null, actions: null, player: null, position: 77, listGate: null });
});

describe('1: a session on another channel does not block or consume the decision', () => {
  it('switches the new channel to its live video while the old session is still ending', async () => {
    const out0 = await open([channel(), channel({ id: 'wion', name: 'WION' })], async (id) => (id === 'wion' ? answer() : none()));
    expect(frame(out0).props.src).toContain(CURATED);
    await stateOf('running'); // a session on DD News
    card(render()).props.onSelectChannel({ id: 'wion' });
    render();
    expect(h.setSt).toBeTruthy();
    await flush();
    const out = render();
    expect(frame(out).props.src).toContain(`/embed/${LIVE}?`);
    expect(h.fcArgs.target).toBe(`wion|live|${LIVE}`);
    expect(badge(out)).toBe('ltv-live-badge');
  });

  it('a list entry that carries a live video id is not LIVE while the curated video plays under a session', async () => {
    h.channels = [channel()];
    h.lookup = () => new Promise(() => {});
    render(); await flush(); render();
    await stateOf('running'); // session on the curated video
    h.channels = [channel({ liveVideoId: LIVE })];
    render(false);
    render(true); await flush();
    const out = render();
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(badge(out)).toBe('ltv-recent-badge');
    expect(tile(out, 'dd-news').status).toBe('recent');
  });

  it('decides again when the session on this channel has ended', async () => {
    h.channels = [channel()];
    h.lookup = () => new Promise(() => {});
    render(); await flush(); render();
    await stateOf('running');
    h.channels = [channel({ liveVideoId: LIVE })];
    render(false); render(true); await flush(); render();
    expect(frame(render()).props.src).toContain(CURATED);
    const out = await stateOf('ended');
    expect(frame(out).props.src).toContain(`/embed/${LIVE}?`);
    expect(badge(out)).toBe('ltv-live-badge');
  });
});

describe('2: the switch follows what YouTube says now, and is reset when the page is opened again', () => {
  it('goes back to the curated video when a later lookup reports no live video', async () => {
    const out0 = await open();
    expect(frame(out0).props.src).toContain(LIVE);
    h.lookup = async () => none();
    const out = await reopen();
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(badge(out)).toBe('ltv-recent-badge');
    expect(tile(out, 'dd-news').status).toBe('recent');
  });

  it('follows a newer live video id', async () => {
    await open();
    h.lookup = async () => answer({ liveVideo: { videoId: LIVE2 } });
    const out = await reopen();
    expect(frame(out).props.src).toContain(`/embed/${LIVE2}?`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${LIVE2}`);
  });

  it('an answer that is not YouTube data does not bring the earlier live video back after opening again', async () => {
    await open();
    h.lookup = async () => ({ ok: true, dataOrigin: 'fallback', liveVideo: null, recentVideos: [] });
    const out = await reopen();
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
  });

  it('does not use the list from before the page was opened again, while the new list is on its way', async () => {
    const out0 = await open([channel({ liveVideoId: LIVE })], () => new Promise(() => {}));
    expect(frame(out0).props.src).toContain(LIVE);
    let release;
    h.listGate = new Promise((r) => { release = r; });
    h.channels = [channel()]; // the list now reports no live video
    render(false);
    render(true); await flush();
    expect(frame(render()).props.src).toContain(`/embed/${CURATED}?`); // the old list is not believed
    release(); await flush();
    expect(frame(render()).props.src).toContain(`/embed/${CURATED}?`);
  });

  it('never changes the video under a session running on this channel, not even on opening again', async () => {
    await open();
    await stateOf('running');
    h.lookup = async () => none();
    const out = await reopen();
    expect(frame(out).props.src).toContain(`/embed/${LIVE}?`);
    expect(h.fcArgs.target).toBe(`dd-news|live|${LIVE}`);
  });
});

describe('3: a tile says LIVE only when this client will play a live video when the channel is opened', () => {
  const sansad = () => channel({ id: 'sansad-tv', name: 'Sansad', defaultVideoId: 'live_stream', embedUrl: 'https://www.youtube-nocookie.com/embed/live_stream?channel=UC1&autoplay=1&mute=1', liveVideoId: LIVE2 });
  it('shows LIVE for a switchable channel that carries a liveVideoId, not for one that cannot be switched', async () => {
    const out = await open([channel(), channel({ id: 'wion', name: 'WION', liveVideoId: LIVE2 }), sansad()], async () => none());
    expect(tile(out, 'wion').status).toBe('live');
    expect(tile(out, 'sansad-tv').status).toBe('recent');
    expect(tile(out, 'dd-news').status).toBe('recent');
  });
  it('keeps a curated-live channel LIVE', async () => {
    const out = await open([channel({ status: 'live' }), channel({ id: 'wion', name: 'WION' })], async () => none());
    expect(tile(out, 'dd-news').status).toBe('live');
    expect(badge(out)).toBe('ltv-live-badge');
  });
  it('shows a switchable channel with a liveVideoId as playing live when it is opened', async () => {
    const out0 = await open([channel(), channel({ id: 'wion', name: 'WION', liveVideoId: LIVE2 })], async () => none());
    card(out0).props.onSelectChannel({ id: 'wion' });
    render(); await flush();
    const out = render();
    expect(frame(out).props.src).toContain(`/embed/${LIVE2}?`);
    expect(badge(out)).toBe('ltv-live-badge');
  });
});

describe('4: a start screen that was open is reopened for the live video', () => {
  it('ends on the start screen for the live video after the switch closed it', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    h.channels = [channel()];
    h.lookup = () => gate.then(() => answer());
    render(); await flush(); render();
    h.actions.choose(); // the user pressed the start control before the lookup arrived
    await flush();
    render();
    expect(h.status).toBe('choosing');
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
    release(); await flush();
    render(); await flush(); render();
    expect(h.fcArgs.target).toBe(`dd-news|live|${LIVE}`);
    expect(h.actions.choose).toHaveBeenCalledTimes(2);
    expect(h.status).toBe('choosing'); // what the panel shows
  });

  it('does not open a start screen the user did not open', async () => {
    await open();
    expect(h.actions.choose).not.toHaveBeenCalled();
  });
});

describe('5: the effective channel is used when the default channel is not in the list', () => {
  it('looks up and switches the channel that is shown', async () => {
    const out = await open([channel({ id: 'wion', name: 'WION' })], async (id) => (id === 'wion' ? answer() : none()));
    expect(h.videoCalls.at(-1)).toBe('wion');
    expect(frame(out).props.src).toContain(`/embed/${LIVE}?`);
    expect(h.fcArgs.target).toBe(`wion|live|${LIVE}`);
    expect(badge(out)).toBe('ltv-live-badge');
  });
  it('shows no LIVE when the shown channel has no live video', async () => {
    const out = await open([channel({ id: 'wion', name: 'WION' })], async () => none());
    expect(badge(out)).toBe('ltv-recent-badge');
    expect(frame(out).props.src).toContain(CURATED);
  });
});
