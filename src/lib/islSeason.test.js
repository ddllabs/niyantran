import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * F169 T5. ESPN's ISL scoreboard without a date returns only today's matchday (1 match on
 * 2026-10-14, measured), which hid the season. The loader asks for the season's two calendar years
 * (measured: `dates=2026&limit=400` returned 154 matches, 57 upcoming); a date range answers 400.
 */
const event = (id, date, state = 'pre') => ({
  id,
  date,
  name: `Team ${id}A at Team ${id}B`,
  competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: `Team ${id}B` } }, { homeAway: 'away', team: { displayName: `Team ${id}A` } }], status: { type: { state, shortDetail: state === 'pre' ? 'Scheduled' : 'FT' } } }],
  links: [{ rel: ['desktop'], href: `https://www.espn.com/soccer/match/_/gameId/${id}` }],
});

function stubEspn() {
  const seen = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    seen.push(u);
    const year = /[?&]dates=(\d{4})\b/.exec(u)?.[1];
    const events = year === '2026' ? [event(1, '2026-09-20T14:00Z', 'post'), event(2, '2026-12-01T14:00Z')] : year === '2027' ? [event(3, '2027-02-10T14:00Z')] : [event(9, '2026-10-14T14:00Z', 'in')];
    return { ok: true, status: 200, json: async () => ({ leagues: [{ name: 'Indian Super League' }], events }) };
  }));
  return seen;
}

describe('ISL Tracker season (F169 T5)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

  it('asks ESPN for the season years and returns every match, not only today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-10-14T12:00:00Z'));
    const seen = stubEspn();
    const { loadIsl } = await import('../../server/sportsApi.mjs');
    const out = await loadIsl();
    expect(seen.some((u) => /dates=2026\b/.test(u) && /limit=400/.test(u))).toBe(true);
    expect(seen.some((u) => /dates=2027\b/.test(u))).toBe(true);
    // Upcoming first (soonest first), then results; each marked.
    expect(out.rows.map((r) => [r.title, r.stage])).toEqual([
      ['Team 2A at Team 2B', 'Upcoming'],
      ['Team 3A at Team 3B', 'Upcoming'],
      ['Team 1A at Team 1B', 'Result'],
    ]);
  });

  it('early in a year asks for the previous year as well', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2027-03-01T12:00:00Z'));
    const seen = stubEspn();
    const { loadIsl } = await import('../../server/sportsApi.mjs');
    await loadIsl();
    expect(seen.some((u) => /dates=2026\b/.test(u))).toBe(true);
    expect(seen.some((u) => /dates=2027\b/.test(u))).toBe(true);
  });
});
