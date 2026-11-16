import { describe, expect, it, vi } from 'vitest';
import { createMuteController } from './muteController.js';

const YT = { src: 'https://www.youtube-nocookie.com/embed/a' };

function setup({ iframe = YT, snap = {} } = {}) {
  const state = { iframe, snap: { ready: true, muted: true, ...snap } };
  const bridge = { setMuted: vi.fn(), getSnapshot: () => state.snap };
  const timers = [];
  const onFallback = vi.fn();
  const onMutedChange = vi.fn();
  const c = createMuteController({
    bridge, getIframe: () => state.iframe, onFallback, onMutedChange, timeoutMs: 3000,
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; },
    clearTimeoutFn: (id) => { if (timers[id]) timers[id].live = false; },
  });
  const fire = () => timers.filter((t) => t.live).forEach((t) => { t.live = false; t.fn(); });
  return { c, state, bridge, onFallback, onMutedChange, timers, fire };
}

describe('mute controller', () => {
  it('confirmed mute: no fallback', () => {
    const t = setup();
    t.c.request(false);
    expect(t.bridge.setMuted).toHaveBeenCalledWith(false);
    expect(t.timers[0].ms).toBe(3000);
    t.state.snap = { ready: true, muted: false };
    t.fire();
    expect(t.onFallback).not.toHaveBeenCalled();
  });
  it('unconfirmed mute: falls back once at the deadline', () => {
    const t = setup();
    t.c.request(false);
    t.fire(); t.fire();
    expect(t.onFallback).toHaveBeenCalledTimes(1);
  });
  it('arms on every toggle: a ready player that stays at the old value still falls back', () => {
    const t = setup({ snap: { ready: true, muted: true } });
    t.c.request(true); // already true: confirmed at once
    t.fire();
    expect(t.onFallback).not.toHaveBeenCalled();
    t.c.request(false);
    t.fire();
    expect(t.onFallback).toHaveBeenCalledTimes(1);
  });
  it('iframe changed before the deadline: no fallback', () => {
    const t = setup();
    t.c.request(false);
    t.state.iframe = { src: 'https://www.youtube-nocookie.com/embed/b' };
    t.fire();
    expect(t.onFallback).not.toHaveBeenCalled();
  });
  it('non-YouTube iframe: immediate fallback, no timer, no command', () => {
    const t = setup({ iframe: { src: 'https://example.com/v' } });
    t.c.request(false);
    expect(t.onFallback).toHaveBeenCalledTimes(1);
    expect(t.timers).toHaveLength(0);
    expect(t.bridge.setMuted).not.toHaveBeenCalled();
  });
  it('no iframe: immediate fallback', () => {
    const t = setup({ iframe: null });
    t.c.request(true);
    expect(t.onFallback).toHaveBeenCalledTimes(1);
  });
  it('dispose clears the timer', () => {
    const t = setup();
    t.c.request(false);
    t.c.dispose();
    t.fire();
    expect(t.onFallback).not.toHaveBeenCalled();
  });
  it('a new toggle replaces the earlier timer', () => {
    const t = setup({ snap: { ready: true, muted: null } });
    t.c.request(false);
    t.c.request(true);
    expect(t.timers.filter((x) => x.live)).toHaveLength(1);
  });
  it('player-initiated change is reported and sends no command', () => {
    const t = setup();
    t.c.notifyMuted(false);
    expect(t.onMutedChange).toHaveBeenCalledWith(false);
    expect(t.bridge.setMuted).not.toHaveBeenCalled();
  });
  it('while a request is pending, stale values are not reported and the confirming value cancels the timer', () => {
    const t = setup();
    t.c.request(false);
    t.c.notifyMuted(true); // old value still arriving
    expect(t.onMutedChange).not.toHaveBeenCalled();
    t.c.notifyMuted(false);
    expect(t.onMutedChange).not.toHaveBeenCalled(); // our own change, the UI already shows it
    t.fire();
    expect(t.onFallback).not.toHaveBeenCalled();
  });
});
