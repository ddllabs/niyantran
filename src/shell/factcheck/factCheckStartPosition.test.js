// F348: the start position is read when the user confirms, whole seconds, and only for a recorded video.
import { describe, expect, it } from 'vitest';
import { withPosition } from './useFactCheck.js';

const base = { videoId: 'v', channelId: 'c', videoKind: 'recorded', startPositionS: null, seed: {} };

describe('withPosition', () => {
  it('uses the position read at confirm time', () => {
    let pos = 12;
    const start = { ...base, getStartPositionS: () => pos };
    pos = 95;
    const out = withPosition(start);
    expect(out.startPositionS).toBe(95);
    expect('getStartPositionS' in out).toBe(false);
  });
  it('stays null when the position is unknown or invalid (live, or the embed did not answer)', () => {
    for (const v of [null, undefined, NaN, -1, 3.5, '7']) {
      expect(withPosition({ ...base, getStartPositionS: () => v }).startPositionS).toBeNull();
    }
  });
  it('passes params without a getter through unchanged', () => {
    expect(withPosition(base)).toBe(base);
  });
});
