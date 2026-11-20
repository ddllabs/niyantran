import { describe, expect, it, vi } from 'vitest';
import { aboveSplitPx, watchAboveSplit } from './aboveSplit.js';

describe('aboveSplitPx', () => {
  it('is the distance from the top of the body to the split, plus the 16px margin', () => {
    expect(aboveSplitPx({ mainTop: 100, splitTop: 247 })).toBe(163); // the old assumed card: 16 + 115 + 16, plus 16
  });
  it('counts what the body has scrolled', () => {
    expect(aboveSplitPx({ mainTop: 100, mainScrollTop: 50, splitTop: 197 })).toBe(163);
  });
  it('grows with a taller bar', () => {
    expect(aboveSplitPx({ mainTop: 0, splitTop: 200 })).toBeGreaterThan(aboveSplitPx({ mainTop: 0, splitTop: 147 }));
  });
  it('is null for numbers that mean nothing', () => {
    expect(aboveSplitPx({ mainTop: 0, splitTop: Number.NaN })).toBeNull();
    expect(aboveSplitPx({ mainTop: 500, splitTop: 0 })).toBeNull();
  });
});

describe('watchAboveSplit', () => {
  const el = (top, scrollTop = 0) => ({ getBoundingClientRect: () => ({ top }), scrollTop, style: { setProperty: vi.fn() } });
  it('writes the variable at once and again when the bar changes size, and stops when cleaned up', () => {
    const main = el(100); const split = el(247); const bar = el(120);
    let observed; let disconnected = false;
    class RO { constructor(fn) { this.fn = fn; observed = this; } observe() {} disconnect() { disconnected = true; } }
    const stop = watchAboveSplit(main, split, bar, RO);
    expect(main.style.setProperty).toHaveBeenLastCalledWith('--ltv-above-split', '163px');
    split.getBoundingClientRect = () => ({ top: 290 }); // the bar became taller
    observed.fn();
    expect(main.style.setProperty).toHaveBeenLastCalledWith('--ltv-above-split', '206px');
    stop();
    expect(disconnected).toBe(true);
  });
  it('does nothing without elements, and leaves the stylesheet value in place without a ResizeObserver', () => {
    expect(() => watchAboveSplit(null, null, null)()).not.toThrow();
    const main = el(0); const split = el(100);
    watchAboveSplit(main, split, null, null)();
    expect(main.style.setProperty).toHaveBeenCalledTimes(1);
  });
});
