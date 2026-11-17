// F344 S3: the player's position and state as the fact-check session reads them.
import { describe, expect, it } from 'vitest';
import { positionSample } from './position.js';

describe('positionSample', () => {
  it('returns the position and the player state from the bridge snapshot', () => {
    expect(positionSample({ positionS: 125.7, playerState: 1 })).toEqual({ positionS: 125.7, playerState: 1 });
  });
  it('keeps an unknown state as null', () => {
    expect(positionSample({ positionS: 3, playerState: null })).toEqual({ positionS: 3, playerState: null });
  });
  it('is null when the position is unknown', () => {
    for (const snap of [{ positionS: null, playerState: 1 }, {}, null, undefined, { positionS: Number.NaN }, { positionS: -1 }, { positionS: '4' }]) {
      expect(positionSample(snap)).toBeNull();
    }
  });
});
