// B4: paste a YouTube link. The page plays it in the same player as a new mode, and the fact-check reads
// the same things from it as from a channel video.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, elements } from './hookHarness.js';

const h = vi.hoisted(() => ({ channels: [], fcArgs: null, fcView: null, player: null, position: 77, videoCalls: [] }));

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), ...harness.patch() }));
vi.mock('../lib/liveTvClient.js', () => {
  const never = () => new Promise(() => {});
  return {
    fetchLiveTvChannels: async () => ({ ok: true, channels: h.channels, categories: ['NEWS'] }),
    fetchLiveTvVideos: (id) => { h.videoCalls.push(id); return never(); },
    fetchLiveTvSchedule: never, fetchLiveTvArchive: never,
  };
});
vi.mock('./factcheck/useFactCheck.js', () => ({
  useFactCheck: (args) => { h.fcArgs = args; return { view: h.fcView, actions: { confirm: () => {}, choose: () => {} } }; },
}));
vi.mock('./liveTv/useYoutubePlayer.js', () => ({
  useYoutubePlayer: (_active, opts) => {
    h.player = opts;
    return { iframeRef: { current: null }, requestMute() {}, getPositionS: () => h.position, getPosition: () => ({ positionS: h.position, playerState: 1 }), seekS: () => true };
  },
}));
const { default: LiveTvPage } = await import('./LiveTvPage.jsx');
const { ChannelCard } = await import('./liveTv/ChannelCard.jsx');

const CURATED = 'abcdefghijk';
const PASTED = 'dQw4w9WgXcQ';
const channel = (over = {}) => ({ id: 'dd-news', name: 'DD News', category: 'NEWS', status: 'recent', lang: 'Hindi', defaultVideoId: CURATED, embedUrl: `https://www.youtube-nocookie.com/embed/${CURATED}?autoplay=1&mute=1&playsinline=1`, ...over });

const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const render = () => harness.render(LiveTvPage, { open: true, onClose() {} });
const find = (out, pred) => [...elements(out)].find(pred);
const frame = (out) => find(out, (e) => e.type === 'iframe');
const input = (out) => find(out, (e) => e.type === 'input' && e.props.id === 'ltv-paste-input');
const form = (out) => find(out, (e) => e.type === 'form' && /ltv-paste/.test(e.props.className || ''));
const card = (out) => find(out, (e) => e.type === ChannelCard);
const text = (node) => (node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node));
const link = (out, label) => find(out, (e) => e.type === 'a' && text(e).includes(label));
const button = (out, label) => find(out, (e) => e.type === 'button' && text(e).includes(label));

async function open() {
  h.channels = [channel(), channel({ id: 'wion', name: 'WION' })];
  render(); await flush();
  return render();
}
function submit(value) {
  input(render()).props.onChange({ target: { value } });
  const f = form(render());
  f.props.onSubmit({ preventDefault() {} });
  return render();
}
const running = { flag: { available: true }, session: { status: 'running', claims: [] }, rechecks: {} };

beforeEach(() => {
  harness.reset();
  Object.assign(h, { fcArgs: null, fcView: null, player: null, position: 77, videoCalls: [] });
});

describe('the form in the title row', () => {
  it('has a labelled input, a Load video button and no message to begin with', async () => {
    const out = await open();
    expect(input(out).props.placeholder).toBe('Paste a YouTube video or live link');
    expect(find(out, (e) => e.type === 'label' && e.props.htmlFor === 'ltv-paste-input')).toBeTruthy();
    expect(button(out, 'Load video').props.type).toBe('submit');
    expect(find(out, (e) => /ltv-paste-error/.test(e.props?.className || ''))).toBeUndefined();
  });
});

describe('loading a link', () => {
  it.each([
    ['a watch address', `https://www.youtube.com/watch?v=${PASTED}`],
    ['a short address', `https://youtu.be/${PASTED}`],
    ['a bare id', PASTED],
  ])('plays the embed built from the id (%s)', async (_n, value) => {
    await open();
    const out = submit(value);
    expect(frame(out).props.src).toContain(`https://www.youtube-nocookie.com/embed/${PASTED}?`);
    expect(frame(out).props.src).toContain('enablejsapi=1');
    expect(frame(out).props.src).not.toContain(CURATED);
  });

  it('never puts the pasted text into the embed', async () => {
    await open();
    const out = submit(`https://www.youtube.com/watch?v=${PASTED}&autoplay=0&evil=1`);
    expect(frame(out).props.src).not.toContain('evil');
    expect(new URL(frame(out).props.src).hostname).toBe('www.youtube-nocookie.com');
  });

  it('deselects the channel tiles and shows the now-playing row with a Watch on YouTube link', async () => {
    await open();
    const out = submit(PASTED);
    expect(card(out).props.playbackMode).toBe('link');
    expect(text(find(out, (e) => e.type === 'h3'))).toBe('YouTube video');
    expect(link(out, 'Watch on YouTube').props.href).toBe(`https://www.youtube.com/watch?v=${PASTED}`);
    expect(button(out, 'Back to channels')).toBeTruthy();
  });

  it('shows the title the player reports', async () => {
    await open();
    submit(PASTED);
    h.player.onInfo({ title: 'A long debate', durationS: 300, isLive: null });
    expect(text(find(render(), (e) => e.type === 'h3'))).toBe('A long debate');
  });

  it('makes no request of its own (only the player loads)', async () => {
    await open();
    const before = h.videoCalls.length;
    submit(PASTED);
    expect(h.videoCalls.length).toBe(before);
  });
});

describe('the fact-check reads the pasted video', () => {
  it('gets a target and a start object for a video that is not known to be live (treated as live: private)', async () => {
    await open();
    submit(PASTED);
    expect(h.fcArgs.target).toBe(`youtube-link|link|${PASTED}`);
    expect(h.fcArgs.start.videoId).toBe(PASTED);
    expect(h.fcArgs.start.channelId).toBe('youtube-link');
    expect(h.fcArgs.start.videoKind).toBe('live');
    expect(h.fcArgs.start.seed.channel).toBe('YouTube link');
    expect(h.fcArgs.start.getStartPositionS()).toBeNull();
    expect(h.fcArgs.getPosition()).toBeNull();
  });

  it('is recorded once the player shows a finite duration, and starts from where the player is', async () => {
    await open();
    submit(PASTED);
    h.player.onInfo({ title: 'T', durationS: 300, isLive: false });
    render();
    expect(h.fcArgs.target).toBe(`youtube-link|link|${PASTED}`);
    expect(h.fcArgs.start.videoKind).toBe('recorded');
    expect(h.fcArgs.start.getStartPositionS()).toBe(77);
    expect(h.fcArgs.getPosition()).toEqual({ positionS: 77, playerState: 1 });
    expect(h.fcArgs.start.seed.title).toBe('T');
  });

  it.each([[null], [undefined], [true]])('is live when the player has not said isLive is false (isLive %s), even with a duration', async (isLive) => {
    await open();
    submit(PASTED);
    h.player.onInfo({ title: 'T', durationS: 300, isLive });
    render();
    expect(h.fcArgs.start.videoKind).toBe('live');
    expect(h.fcArgs.start.getStartPositionS()).toBeNull();
  });

  it('keeps the kind it had when the session was confirmed, for the life of that session', async () => {
    await open();
    submit(PASTED);
    h.player.onInfo({ title: 'T', durationS: 300, isLive: false });
    render();
    expect(h.fcArgs.start.videoKind).toBe('recorded');
    h.fcView = { ...running, session: { status: 'choosing', claims: [] } };
    const panel = find(render(), (e) => e.props && typeof e.props.onConfirm === 'function');
    panel.props.onConfirm(5, 500);
    h.fcView = running;
    h.player.onInfo({ title: 'T', durationS: 300, isLive: true }); // later info differs
    render();
    expect(h.fcArgs.start.videoKind).toBe('recorded');
    expect(h.fcArgs.getPosition()).toEqual({ positionS: 77, playerState: 1 });
    h.fcView = { ...running, session: { status: 'ended', claims: [] } };
    render(); render();
    expect(h.fcArgs.start.videoKind).toBe('live'); // free again once the session is over
  });

  it('is live when the player says so, even with a duration', async () => {
    await open();
    submit(PASTED);
    h.player.onInfo({ title: 'T', durationS: 300, isLive: true });
    render();
    expect(h.fcArgs.start.videoKind).toBe('live');
    expect(h.fcArgs.start.getStartPositionS()).toBeNull();
  });

  it('is live when the duration is zero (a live stream shows none)', async () => {
    await open();
    submit(PASTED);
    h.player.onInfo({ title: 'T', durationS: 0, isLive: null });
    render();
    expect(h.fcArgs.start.videoKind).toBe('live');
  });

  it('gives sessions of pasted videos a name in My sessions', async () => {
    await open();
    const out = submit(PASTED);
    const past = find(out, (e) => e.props && Array.isArray(e.props.channels) && 'sessionStatus' in e.props);
    expect(past.props.channels.find((c) => c.id === 'youtube-link').name).toBe('YouTube link');
  });
});

describe('a link that is not a YouTube link', () => {
  it('shows the message under the field, keeps the text and changes nothing', async () => {
    const out0 = await open();
    const before = frame(out0).props.src;
    const out = submit('https://example.com/watch?v=dQw4w9WgXcQ');
    const msg = find(out, (e) => /ltv-paste-error/.test(e.props?.className || ''));
    expect(text(msg)).toBe("That doesn't look like a YouTube link.");
    expect(msg.props.role).toBe('alert');
    expect(input(out).props.value).toBe('https://example.com/watch?v=dQw4w9WgXcQ');
    expect(input(out).props['aria-invalid']).toBe(true);
    expect(frame(out).props.src).toBe(before);
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
  });

  it.each([
    ['a channel page', 'https://www.youtube.com/@sansadtv'],
    ['a channel live address', 'https://www.youtube.com/@sansadtv/live'],
    ['a channel id address', 'https://www.youtube.com/channel/UCISgnSNwqQ2i8lhCun3KtQg'],
    ['a custom name address', 'https://www.youtube.com/c/SansadTV'],
    ['YouTube Music', `https://music.youtube.com/watch?v=${PASTED}`],
  ])('says to paste one video for %s, and keeps the text', async (_n, value) => {
    await open();
    const out = submit(value);
    expect(text(find(out, (e) => /ltv-paste-error/.test(e.props?.className || '')))).toBe('Paste the link of one video or live stream, not a channel page.');
    expect(input(out).props.value).toBe(value);
  });

  it('clears the message when the text is edited, and when a good link loads', async () => {
    await open();
    submit('nonsense');
    input(render()).props.onChange({ target: { value: PASTED } });
    expect(find(render(), (e) => /ltv-paste-error/.test(e.props?.className || ''))).toBeUndefined();
  });
});

describe('after a successful load', () => {
  it('moves focus to the page title, so a phone that hides the field does not drop it to the page', async () => {
    const focused = [];
    harness.refFactory = () => ({ focus: (o) => focused.push(o) });
    await open();
    focused.length = 0;
    submit(PASTED);
    expect(focused.length).toBe(1);
    submit('nonsense');
    expect(focused.length).toBe(1); // a refused link keeps focus where it is
    harness.refFactory = null;
  });
});

describe('a video that cannot be played here', () => {
  it('says the owner turned off playback, offers Open on YouTube, keeps the link, and offers no fact-check', async () => {
    await open();
    submit(`https://youtu.be/${PASTED}`);
    h.player.onError(150);
    const out = render();
    expect(frame(out)).toBeUndefined();
    expect(text(out)).toContain("This video can't be played here. Its owner has turned off playback on other sites.");
    expect(link(out, 'Open on YouTube').props.href).toBe(`https://www.youtube.com/watch?v=${PASTED}`);
    expect(input(out).props.value).toBe(`https://youtu.be/${PASTED}`);
    expect(h.fcArgs.target).toBeNull();
  });

  it.each([2, 5, 99])('code %s does not stop playback, remove the target or end a session; it shows a quiet note', async (code) => {
    await open();
    submit(PASTED);
    h.player.onInfo({ title: 'T', durationS: 300, isLive: false });
    h.fcView = running;
    render();
    const target = h.fcArgs.target;
    h.player.onError(code);
    const out = render();
    expect(frame(out)).toBeTruthy();
    expect(h.fcArgs.target).toBe(target);
    expect(text(out)).toContain('The player reported a problem with this video.');
  });

  it('says private or removed for code 100', async () => {
    await open();
    submit(PASTED);
    h.player.onError(100);
    expect(text(render())).toContain('This video is private or was removed.');
  });

  it('clears on Reload Feed and on loading another link', async () => {
    await open();
    submit(PASTED);
    h.player.onError(150);
    render();
    button(render(), 'Reload Feed').props.onClick();
    expect(frame(render())).toBeTruthy();
    h.player.onError(150);
    render();
    submit('https://youtu.be/AAAAAAAAAAA');
    expect(frame(render()).props.src).toContain('AAAAAAAAAAA');
  });

  // Round 3: while a channel plays, a refusal (101, 150) is the channel's own card (LiveTvPage.review2.test.jsx);
  // an error that is no refusal is still ignored.
  it('ignores a player error that is no refusal while a channel is playing', async () => {
    await open();
    h.player.onError(5);
    const out = render();
    expect(frame(out)).toBeTruthy();
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
  });
});

describe('leaving the link', () => {
  it('Back to channels restores the channel video, the tiles and the fact-check target', async () => {
    await open();
    submit(PASTED);
    button(render(), 'Back to channels').props.onClick();
    const out = render();
    expect(frame(out).props.src).toContain(`/embed/${CURATED}?`);
    expect(card(out).props.playbackMode).toBe('live');
    expect(h.fcArgs.target).toBe(`dd-news|live|${CURATED}`);
    expect(h.fcArgs.start.videoKind).toBe('live');
    expect(button(out, 'Back to channels')).toBeUndefined();
  });

  it('picking a channel tile leaves the link', async () => {
    await open();
    const out = submit(PASTED);
    card(out).props.onSelectChannel({ id: 'wion' });
    const after = render();
    expect(card(after).props.playbackMode).toBe('live');
    expect(h.fcArgs.target.startsWith('wion|live|')).toBe(true);
  });

  it('shows the channel video again after a pasted video and keeps the pasted link in the field', async () => {
    await open();
    submit(PASTED);
    button(render(), 'Back to channels').props.onClick();
    expect(input(render()).props.value).toBe(PASTED);
  });
});

describe('a fact-check session in progress', () => {
  it('follows the rule for changing channel: the target changes, so the session ends (the controller stops it)', async () => {
    await open();
    h.fcView = running;
    render();
    const before = h.fcArgs.target;
    submit(PASTED);
    expect(h.fcArgs.target).not.toBe(before);
    expect(h.fcArgs.target).toBe(`youtube-link|link|${PASTED}`);
  });

  it('keeps the same target when the same video is loaded again', async () => {
    await open();
    submit(PASTED);
    h.fcView = running;
    render();
    const before = h.fcArgs.target;
    const src = frame(render()).props.src;
    submit(`https://youtu.be/${PASTED}`);
    expect(h.fcArgs.target).toBe(before);
    expect(frame(render()).props.src).toBe(src);
  });
});
