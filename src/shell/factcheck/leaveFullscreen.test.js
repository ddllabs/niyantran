// F366 fix round: "See why" must leave fullscreen first, then do its work.
import { describe, expect, it, vi } from 'vitest';
import { leaveFullscreenThen } from './leaveFullscreen.js';

describe('leaveFullscreenThen', () => {
  it('runs at once when nothing is fullscreen', async () => {
    const run = vi.fn();
    leaveFullscreenThen({ fullscreenElement: null, exitFullscreen: vi.fn() }, run);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('exits fullscreen first and runs after it has finished', async () => {
    const order = [];
    let finish;
    const doc = { fullscreenElement: {}, exitFullscreen: () => new Promise((r) => { finish = r; order.push('exit'); }) };
    leaveFullscreenThen(doc, () => order.push('run'));
    expect(order).toEqual(['exit']);
    finish();
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(['exit', 'run']);
  });
  it('still runs when leaving fullscreen is refused, or the browser cannot', async () => {
    const run = vi.fn();
    leaveFullscreenThen({ fullscreenElement: {}, exitFullscreen: () => Promise.reject(new Error('no')) }, run);
    await Promise.resolve(); await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    const run2 = vi.fn();
    leaveFullscreenThen({ fullscreenElement: {} }, run2);
    expect(run2).toHaveBeenCalledTimes(1);
  });
});
