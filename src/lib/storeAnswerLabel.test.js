// F169 phase 4 (C4): a module served from the scheduled feed store (`served: 'store'`) is not a stored
// or old copy. Its header says how long ago the items were fetched ("Updated 5 min ago"), and
// "stored copy" stays for answers that really are stored (the archive, backup packs, embedded registers).
import { describe, expect, it } from 'vitest';
import { asOfLabel, isStoreAnswer, isStoredAnswer, plainSourceLine } from './plainSourceNote.js';
import { liveRefreshNote } from '../desks/DeskView.jsx';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const store = (fetchedAt, extra = {}) => ({
  ok: true, served: 'store', fallback: false, fetchedAt,
  rows: [{ title: 'A', date: '2026-10-15', source_url: 'https://wire.example/a' }],
  source: { adapter: 'news-search', links: ['https://feeds.bbci.co.uk/news/world/rss.xml'], note: '' },
  ...extra,
});

describe('asOfLabel for an answer from the store', () => {
  it('counts minutes, then hours past an hour, then days past a day', () => {
    expect(asOfLabel(store(ago(5 * MIN)), NOW)).toBe('updated 5 min ago');
    expect(asOfLabel(store(ago(59 * MIN + 59_000)), NOW)).toBe('updated 59 min ago');
    expect(asOfLabel(store(ago(60 * MIN)), NOW)).toBe('updated 1 h ago');
    expect(asOfLabel(store(ago(5 * HOUR + 40 * MIN)), NOW)).toBe('updated 5 h ago');
    expect(asOfLabel(store(ago(23 * HOUR + 59 * MIN)), NOW)).toBe('updated 23 h ago');
    expect(asOfLabel(store(ago(24 * HOUR)), NOW)).toBe('updated 1 d ago');
    expect(asOfLabel(store(ago(3 * DAY + 2 * HOUR)), NOW)).toBe('updated 3 d ago');
  });

  it('says "just now" under a minute, and for a clock that is a little ahead', () => {
    expect(asOfLabel(store(ago(20_000)), NOW)).toBe('updated just now');
    expect(asOfLabel(store(ago(0)), NOW)).toBe('updated just now');
    expect(asOfLabel(store(ago(-90_000)), NOW)).toBe('updated just now');
  });

  it('is by the time fetched, not by the newest record date', () => {
    const feed = store(ago(10 * MIN), { rows: [{ title: 'Old', date: '2024-01-01' }] });
    expect(asOfLabel(feed, NOW)).toBe('updated 10 min ago');
  });

  it('keeps "as of <date>" for a stored answer, even one with a fetched time that is not from the store', () => {
    const stored = { served: 'archive', fallback: true, fetchedAt: ago(5 * MIN), rows: [{ date: '2026-07-15' }], source: { adapter: 'embedded' } };
    expect(asOfLabel(stored, NOW)).toBe('as of 15 Jul 2026');
  });
});

describe('a store answer is not a stored copy', () => {
  it('isStoredAnswer is false for it, whatever adapter the live answer had', () => {
    for (const adapter of ['api', 'news-search', 'embedded', 'register', 'source-library']) {
      expect(isStoredAnswer(store(ago(MIN), { source: { adapter, links: [] } })), adapter).toBe(false);
    }
    expect(isStoreAnswer(store(ago(MIN)))).toBe(true);
  });

  it('real stored answers still are', () => {
    expect(isStoredAnswer({ source: { adapter: 'embedded' } })).toBe(true);
    expect(isStoredAnswer({ served: 'archive', source: { adapter: 'api' } })).toBe(true);
    expect(isStoredAnswer({ fallback: true, source: { adapter: 'api' } })).toBe(true);
    expect(isStoredAnswer({ source: { adapter: 'api' } })).toBe(false);
  });

  it('a "store" answer with no usable fetched time is not trusted as one', () => {
    expect(isStoreAnswer({ served: 'store', rows: [{ title: 'A' }] })).toBe(false);
    expect(isStoreAnswer({ served: 'store', fetchedAt: 'not a date' })).toBe(false);
    expect(isStoreAnswer({ served: 'live', fetchedAt: ago(MIN) })).toBe(false);
    expect(isStoreAnswer(null)).toBe(false);
  });

  it('the plain source line gives the age, not "Live"', () => {
    const feed = store(ago(12 * MIN), { rows: Array.from({ length: 24 }, (_, i) => ({ title: `S${i}`, outlet: 'BBC World' })) });
    expect(plainSourceLine(feed, NOW)).toBe('Updated 12 min ago · 24 stories from BBC World');
    expect(plainSourceLine(feed, NOW)).not.toMatch(/live|stored/i);
  });

  it('the page does not say "Updated live." over a store answer that replaced the archive', () => {
    expect(liveRefreshNote({ ...store(ago(MIN)), updatedLive: true })).toBeNull();
    expect(liveRefreshNote({ served: 'live', updatedLive: true })).toBe('Updated live.');
  });
});
