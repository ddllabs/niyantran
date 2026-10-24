import { afterEach, expect, it, vi } from 'vitest';
import { saveHomeCache, loadHomeCache } from './homeCache.js';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('news polling does not postpone market/conflict refresh, and rejects pre-RSS cached stories', () => {
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
  const before = saveHomeCache({ markets: { rows: [{ name: 'NIFTY' }] }, latest: { rows: [{ title: 'Old seed' }] } });
  expect(loadHomeCache().latest).toBeNull();
  vi.advanceTimersByTime(3600000);
  saveHomeCache({ latest: { delivery: 'rss', rows: [], checked_at: new Date().toISOString() } });
  expect(loadHomeCache().savedAt).toBe(before.savedAt);
  expect(loadHomeCache().latest.rows).toEqual([]);
});
