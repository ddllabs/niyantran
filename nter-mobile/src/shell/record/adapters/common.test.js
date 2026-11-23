import { describe, expect, it } from 'vitest';
import { todayInIndia } from './common.js';

// F128: a stated deadline is marked passed against India's date, which runs 05:30 ahead of UTC.
describe('todayInIndia', () => {
  it('reads the India date across the UTC midnight boundary', () => {
    expect(todayInIndia(new Date('2026-09-03T19:00:00Z'))).toBe('2026-09-04');
    expect(todayInIndia(new Date('2026-09-03T18:29:00Z'))).toBe('2026-09-03');
    expect(todayInIndia(new Date('2026-09-04T12:00:00Z'))).toBe('2026-09-04');
  });
});
