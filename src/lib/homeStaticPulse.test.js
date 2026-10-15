// F182: when /api/home/pulse is unavailable the browser reads /data/conflict.json itself. On Vercel that
// is the committed seed, a stored copy of the register carrying an old GDELT note. It must not be shown
// as a snapshot; the register is read from its own file and says what it is.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REGISTER_WINDOW } from './conflictRegister.js';
import { homePulseFromStatic } from './homeStatic.js';

const WAR = [
  { conflict_name: 'Front A', started: '2022', region: 'R', source_url: '', conflict_type: 'T', latest_development: 'd' },
  { conflict_name: '', started: 'x' },
];

function serve(files) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const body = files[String(url)];
    return body === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => body };
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('homePulseFromStatic', () => {
  it('skips the seed that is a stored copy of the register, and says nothing about GDELT', async () => {
    serve({
      '/data/conflict.json': {
        updated: '2026-09-28T08:12:32.111Z',
        rows: [{ title: 'Stale seed front' }],
        source: 'snapshot',
        gdelt: false,
        note: 'Original HTML Open Fronts table (geopolitics_war_tracker). GDELT live wire was unreachable. No records were invented.',
        meta: { unique: 1, deduped: 0, window: REGISTER_WINDOW },
      },
      '/data/embedded_csv/geopolitics_war_tracker.json': WAR,
    });
    const out = await homePulseFromStatic();
    expect(out.rows.map((r) => r.title)).toEqual(['Front A']);
    expect(out.note).toMatch(/stored register/i);
    expect(out.note).not.toMatch(/gdelt/i);
    expect(out.meta.window).toBe(REGISTER_WINDOW);
    expect(out.gdelt).toBe(false);
    expect(out).not.toHaveProperty('updated');
  });

  it('skips a cache from the GDELT era (no agent marker)', async () => {
    serve({
      '/data/conflict.json': { updated: '2026-01-01T00:00:00Z', rows: [{ title: 'Old' }], source: 'snapshot', gdelt: true, note: 'Live GDELT.' },
      '/data/embedded_csv/geopolitics_war_tracker.json': WAR,
    });
    const out = await homePulseFromStatic();
    expect(out.gdelt).toBe(false);
    expect(out.rows[0].title).toBe('Front A');
  });

  it('still reads a real agent snapshot', async () => {
    serve({ '/data/conflict.json': { updated: new Date().toISOString(), rows: [{ title: 'Agent front' }], source: 'agent', note: 'From the agent.' } });
    const out = await homePulseFromStatic();
    expect(out.rows[0].title).toBe('Agent front');
    expect(out.note).toBe('From the agent.');
  });
});
