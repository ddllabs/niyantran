// F344 S3: the player's position and state as the fact-check session reads them.
import { describe, expect, it } from 'vitest';
import { positionSample, remainingSecondsOf } from './position.js';

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

describe('remainingSecondsOf (W): seconds left in a video that is known not to be live', () => {
  it('is the duration minus the position, rounded down', () => {
    expect(remainingSecondsOf({ durationS: 300, positionS: 100.4 })).toBe(199);
  });
  it.each([
    ['no position', { durationS: 300, positionS: null }],
    ['no duration', { durationS: null, positionS: 5 }],
    ['a zero duration', { durationS: 0, positionS: 0 }],
    ['a negative duration', { durationS: -4, positionS: 0 }],
    ['an infinite duration', { durationS: Infinity, positionS: 5 }],
    ['a position past the end', { durationS: 100, positionS: 130 }],
    ['a position at the end', { durationS: 100, positionS: 100 }],
    ['a text duration', { durationS: '100', positionS: 5 }],
    ['nothing', null],
  ])('is null for %s', (_n, input) => {
    expect(remainingSecondsOf(input)).toBeNull();
  });
});
