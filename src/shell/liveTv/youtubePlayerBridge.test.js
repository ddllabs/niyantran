// F348: the postMessage bridge to the YouTube embed. Fake window and iframe, no browser.
import { describe, expect, it, vi } from 'vitest';
import { createYoutubePlayerBridge } from './youtubePlayerBridge.js';

const NC = 'https://www.youtube-nocookie.com';

function setup(src = `${NC}/embed/abc?enablejsapi=1`) {
  const listeners = new Set();
  let timer = null;
  const win = {
    addEventListener: (t, fn) => { if (t === 'message') listeners.add(fn); },
    removeEventListener: (t, fn) => { if (t === 'message') listeners.delete(fn); },
    setInterval: (fn) => { timer = fn; return 1; },
    clearInterval: () => { timer = null; },
  };
  const contentWindow = { postMessage: vi.fn() };
  const iframe = { src, contentWindow };
  const holder = { iframe };
  const bridge = createYoutubePlayerBridge({ getIframe: () => holder.iframe, win });
  const send = (data, over = {}) => {
    const ev = { source: contentWindow, origin: NC, data: typeof data === 'string' ? data : JSON.stringify(data), ...over };
    for (const fn of [...listeners]) fn(ev);
  };
  return { bridge, win, holder, contentWindow, send, tick: () => timer && timer(), listeners, hasTimer: () => timer !== null };
}
const info = (extra) => ({ event: 'infoDelivery', info: { currentTime: 42.7, duration: 300, playerState: 1, muted: true, ...extra } });

describe('handshake', () => {
  it('posts listening to the iframe origin on each tick until a message arrives, never *', () => {
    const t = setup();
    t.bridge.start(); // posts once at once
    t.tick();
    const calls = t.contentWindow.postMessage.mock.calls;
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0][0])).toEqual({ event: 'listening', id: 1, channel: 'widget' });
    expect(calls.every((c) => c[1] === NC)).toBe(true);
    t.send(info());
    t.tick();
    expect(t.contentWindow.postMessage).toHaveBeenCalledTimes(2);
  });

  it('stop removes the listener and the timer', () => {
    const t = setup();
    t.bridge.start();
    expect(t.listeners.size).toBe(1);
    t.bridge.stop();
    expect(t.listeners.size).toBe(0);
    expect(t.hasTimer()).toBe(false);
  });

  it('re-handshakes when the iframe element changes and forgets the old state', () => {
    const t = setup();
    t.bridge.start();
    t.send(info());
    expect(t.bridge.getSnapshot().ready).toBe(true);
    const next = { src: `${NC}/embed/zzz?enablejsapi=1`, contentWindow: { postMessage: vi.fn() } };
    t.holder.iframe = next;
    t.tick();
    expect(t.bridge.getSnapshot().ready).toBe(false);
    expect(t.bridge.getSnapshot().positionS).toBeNull();
    expect(next.contentWindow.postMessage).toHaveBeenCalledTimes(1);
  });

  it('does not post to an iframe that is not a YouTube origin', () => {
    const t = setup('https://example.com/embed/x');
    t.bridge.start();
    t.tick();
    expect(t.contentWindow.postMessage).not.toHaveBeenCalled();
    t.bridge.setMuted(false);
    expect(t.contentWindow.postMessage).not.toHaveBeenCalled();
  });
});

describe('incoming messages are untrusted', () => {
  it('ignores another origin and another window', () => {
    const t = setup();
    t.bridge.start();
    t.send(info({ currentTime: 999 }), { origin: 'https://evil.example' });
    t.send(info({ currentTime: 999 }), { source: { postMessage() {} } });
    t.send(info({ currentTime: 999 }), { origin: 'https://www.youtube.com.evil.example' });
    expect(t.bridge.getSnapshot().positionS).toBeNull();
    expect(t.bridge.getSnapshot().ready).toBe(false);
  });

  it('accepts www.youtube.com too', () => {
    const t = setup(`https://www.youtube.com/embed/abc?enablejsapi=1`);
    t.bridge.start();
    t.send(info(), { origin: 'https://www.youtube.com' });
    expect(t.bridge.getSnapshot().positionS).toBe(42.7);
  });

  it('ignores malformed data and wrong types', () => {
    const t = setup();
    t.bridge.start();
    for (const d of ['not json', '"str"', '42', 'null', '[1]', JSON.stringify({ event: 7 })]) t.send(d);
    t.send({ event: 'infoDelivery', info: { currentTime: '12', duration: null, playerState: 'x', muted: 'yes' } });
    t.send({ event: 'infoDelivery', info: { currentTime: Number.NaN } });
    t.send({ event: 'infoDelivery', info: 'nope' });
    t.send({ event: 'other', info: { currentTime: 5 } });
    const s = t.bridge.getSnapshot();
    expect(s.positionS).toBeNull();
    expect(s.durationS).toBeNull();
    expect(s.playerState).toBeNull();
    expect(s.muted).toBeNull();
  });

  it('does not throw on an object data field', () => {
    const t = setup();
    t.bridge.start();
    expect(() => t.send(null, { data: { event: 'infoDelivery' } })).not.toThrow();
    expect(() => t.send(null, { data: undefined })).not.toThrow();
  });
});

describe('snapshot', () => {
  it('starts with nulls and fills from infoDelivery', () => {
    const t = setup();
    t.bridge.start();
    expect(t.bridge.getSnapshot()).toEqual({ ready: false, positionS: null, durationS: null, playerState: null, muted: null, updatedAt: null });
    t.send(info());
    expect(t.bridge.getSnapshot()).toMatchObject({ ready: true, positionS: 42.7, durationS: 300, playerState: 1, muted: true });
    expect(typeof t.bridge.getSnapshot().updatedAt).toBe('number');
    t.send(info({ currentTime: 50 }));
    expect(t.bridge.getSnapshot().positionS).toBe(50);
  });
});

describe('setMuted', () => {
  it('posts the command to the iframe origin when ready', () => {
    const t = setup();
    t.bridge.start();
    t.send(info());
    t.bridge.setMuted(false);
    const [data, origin] = t.contentWindow.postMessage.mock.calls.at(-1);
    expect(JSON.parse(data)).toEqual({ event: 'command', func: 'unMute', args: [] });
    expect(origin).toBe(NC);
    t.bridge.setMuted(true);
    expect(JSON.parse(t.contentWindow.postMessage.mock.calls.at(-1)[0]).func).toBe('mute');
    expect(t.contentWindow.postMessage.mock.calls.every((c) => c[1] !== '*')).toBe(true);
  });

  it('remembers a request made before ready and sends it once ready', () => {
    const t = setup();
    t.bridge.start();
    t.bridge.setMuted(false);
    const commands = () => t.contentWindow.postMessage.mock.calls.filter((c) => JSON.parse(c[0]).event === 'command');
    expect(commands()).toHaveLength(0);
    t.send(info());
    const cmds = t.contentWindow.postMessage.mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.event === 'command');
    expect(cmds).toEqual([{ event: 'command', func: 'unMute', args: [] }]);
    t.send(info());
    expect(t.contentWindow.postMessage.mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.event === 'command')).toHaveLength(1);
  });
});

describe('review fixes', () => {
  it('initialDelivery alone is not ready and does not flush a pending mute', () => {
    const t = setup();
    t.bridge.start();
    t.bridge.setMuted(false);
    t.send({ event: 'initialDelivery', info: { currentTime: 1, muted: true } });
    expect(t.bridge.getSnapshot().ready).toBe(false);
    expect(t.contentWindow.postMessage.mock.calls.filter((c) => JSON.parse(c[0]).event === 'command')).toHaveLength(0);
    t.send({ event: 'onReady' });
    expect(t.bridge.getSnapshot().ready).toBe(true);
    expect(t.contentWindow.postMessage.mock.calls.filter((c) => JSON.parse(c[0]).event === 'command')).toHaveLength(1);
  });

  it('reports a mute change the player made, once per change, and sends nothing back', () => {
    const seen = [];
    const t = setup();
    const bridge = createYoutubePlayerBridge({ getIframe: () => t.holder.iframe, win: t.win, onMutedChange: (m) => seen.push(m) });
    bridge.start();
    t.send(info({ muted: true }));
    t.send(info({ muted: true }));
    t.send(info({ muted: false }));
    expect(seen).toEqual([true, false]);
    expect(t.contentWindow.postMessage.mock.calls.filter((c) => JSON.parse(c[0]).event === 'command')).toHaveLength(0);
  });

  it('shows an empty snapshot as soon as the iframe is another element, before the next tick', () => {
    const t = setup();
    t.bridge.start();
    t.send(info());
    t.holder.iframe = { src: `${NC}/embed/zzz`, contentWindow: { postMessage: vi.fn() } };
    expect(t.bridge.getSnapshot().positionS).toBeNull();
    expect(t.bridge.getSnapshot().ready).toBe(false);
  });
});

// F363: seekTo, sent the way mute is: only to the iframe's own YouTube origin, only once the player is ready.
describe('seekTo', () => {
  const commands = (t) => t.contentWindow.postMessage.mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.event === 'command');
  it('posts a seekTo command to the iframe origin when ready, never *', () => {
    const t = setup();
    t.bridge.start();
    t.send(info());
    expect(t.bridge.seekTo(130.9)).toBe(true);
    expect(commands(t)).toEqual([{ event: 'command', func: 'seekTo', args: [130, true] }]);
    const call = t.contentWindow.postMessage.mock.calls.at(-1);
    expect(call[1]).toBe(NC);
    expect(t.contentWindow.postMessage.mock.calls.every((c) => c[1] !== '*')).toBe(true);
  });

  it('posts nothing before the player is ready', () => {
    const t = setup();
    t.bridge.start();
    expect(t.bridge.seekTo(130)).toBe(false);
    expect(commands(t)).toHaveLength(0);
  });

  it('posts nothing to an iframe that is not a YouTube origin', () => {
    const t = setup('https://example.com/embed/x');
    t.bridge.start();
    t.send(info(), { origin: 'https://example.com' });
    expect(t.bridge.seekTo(130)).toBe(false);
    expect(t.contentWindow.postMessage).not.toHaveBeenCalled();
  });

  it('posts nothing for a position that is not a non-negative number', () => {
    const t = setup();
    t.bridge.start();
    t.send(info());
    for (const v of [-1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, '12']) expect(t.bridge.seekTo(v)).toBe(false);
    expect(commands(t)).toHaveLength(0);
  });

  it('posts nothing once the iframe is another element that has not shaken hands', () => {
    const t = setup();
    t.bridge.start();
    t.send(info());
    t.holder.iframe = { src: `${NC}/embed/zzz?enablejsapi=1`, contentWindow: { postMessage: vi.fn() } };
    expect(t.bridge.seekTo(130)).toBe(false);
    expect(t.holder.iframe.contentWindow.postMessage).not.toHaveBeenCalled();
  });

  it('forgets the position it had when the command is sent, until the player reports a new one', () => {
    const t = setup();
    t.bridge.start();
    t.send(info({ currentTime: 300 }));
    expect(t.bridge.getSnapshot().positionS).toBe(300);
    t.bridge.seekTo(130);
    expect(t.bridge.getSnapshot().positionS).toBeNull();
    expect(t.bridge.getSnapshot().ready).toBe(true);
    t.send(info({ currentTime: 131 }));
    expect(t.bridge.getSnapshot().positionS).toBe(131);
  });

  it('keeps the position when no command was sent', () => {
    const t = setup();
    t.bridge.start();
    t.send(info({ currentTime: 300 }));
    t.bridge.seekTo(-1);
    expect(t.bridge.getSnapshot().positionS).toBe(300);
  });

  it('refuses when the same iframe element turns into a non-YouTube address after the handshake', () => {
    const t = setup();
    t.bridge.start();
    t.send(info());
    t.holder.iframe.src = 'https://example.com/embed/x';
    t.contentWindow.postMessage.mockClear();
    expect(t.bridge.seekTo(130)).toBe(false);
    expect(t.contentWindow.postMessage).not.toHaveBeenCalled();
  });
});
