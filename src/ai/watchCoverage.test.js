import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The panel's real coverage functions against a fake database, so the default re-check is what is
// tested. `rows` is what the database holds; `calls` counts the questions.
const db = vi.hoisted(() => ({ rows: [], calls: 0 }));
vi.mock('../lib/supabaseClient.js', () => ({
  supabase: {
    from() {
      const chain = {
        select: () => chain,
        in: () => { db.calls += 1; return chain; },
        not: () => Promise.resolve({ data: db.rows, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('./useResearchThread.js', () => ({ default: () => ({}) }));

beforeEach(async () => {
  vi.useFakeTimers();
  (await import('../lib/corpusCoverage.js')).resetCoverageCache();
  db.rows = [];
  db.calls = 0;
});
afterEach(() => vi.useRealTimers());

// D9: a link made while the record is attached shows within a minute. Real timers drift, so the
// tick can fire when the last answer is a few ms short of its lifetime; the re-check must still
// ask, or the change waits a whole extra minute (seen in C5: more than 90 s).
it('by default each tick asks the database again, even when the last answer is a few ms inside its lifetime', async () => {
  const { watchCoverage } = await import('./AiPanel.jsx');
  const answers = [];
  const stop = watchCoverage('bill:2025:XLV', (s) => answers.push([...s]));
  await vi.advanceTimersByTimeAsync(0);
  expect(db.calls).toBe(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(db.calls).toBe(2);
  // The tick's lookup was stamped 10 ms late (drift); the admin links the record.
  vi.setSystemTime(Date.now() - 10);
  db.rows = [{ document_key: 'bill:2025:XLV' }];
  await vi.advanceTimersByTimeAsync(60_000);
  expect(db.calls).toBe(3);
  expect(answers.at(-1)).toEqual(['bill:2025:XLV']);
  stop();
});
