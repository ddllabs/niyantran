import { describe, expect, it, vi } from 'vitest';
import { nowPlayingPx, watchNowPlayingHeight } from './aboveSplit.js';

describe('nowPlayingPx', () => {
  it('rounds a measured height to whole pixels', () => {
    expect(nowPlayingPx(96.4)).toBe(96);
  });
  it('is null for numbers that mean nothing', () => {
    expect(nowPlayingPx(Number.NaN)).toBeNull();
    expect(nowPlayingPx(0)).toBeNull();
    expect(nowPlayingPx(-4)).toBeNull();
  });
});

describe('watchNowPlayingHeight', () => {
  const split = () => ({ style: { setProperty: vi.fn() } });
  const row = (height) => ({ getBoundingClientRect: () => ({ height }) });
  it('writes the variable at once and again when the row changes size, and stops when cleaned up', () => {
    const s = split(); const np = row(96);
    let observed; let disconnected = false;
    class RO { constructor(fn) { this.fn = fn; observed = this; } observe() {} disconnect() { disconnected = true; } }
    const stop = watchNowPlayingHeight(s, np, RO);
    expect(s.style.setProperty).toHaveBeenLastCalledWith('--ltv-np-h', '96px');
    np.getBoundingClientRect = () => ({ height: 131 }); // the buttons wrapped onto a third line
    observed.fn();
    expect(s.style.setProperty).toHaveBeenLastCalledWith('--ltv-np-h', '131px');
    stop();
    expect(disconnected).toBe(true);
  });
  it('does nothing without elements, and leaves the stylesheet value in place without a ResizeObserver', () => {
    expect(() => watchNowPlayingHeight(null, null)()).not.toThrow();
    const s = split();
    watchNowPlayingHeight(s, row(80), null)();
    expect(s.style.setProperty).toHaveBeenCalledTimes(1);
  });
});
