// F182: the conflict snapshot is what an agent saved. The Open Fronts register (an embedded file)
// used to be saved as that snapshot and then labelled "Agent snapshot". It is no longer saved, and
// register copies already on disk (and the committed seed) are not read as an agent snapshot.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmp;
const cacheFile = () => path.join(tmp, 'niyantran', 'home-snapshots', 'conflict.json');

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'conflict-label-'));
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('TMPDIR', tmp);
  // No network: markets fall back to the archive, news to "waiting".
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const load = () => import('../../server/homeApi.mjs');

function writeSnapshot(body) {
  fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(cacheFile(), JSON.stringify({ updated: now, as_of: '', fetched_at: now, ...body }));
}

describe('F182: the conflict register is not labelled an agent snapshot', () => {
  it('a refresh does not save the register as the conflict snapshot', async () => {
    const { refreshHomeSnapshots } = await load();
    const out = await refreshHomeSnapshots();
    expect(out.conflict).toBeGreaterThan(0);
    expect(fs.existsSync(cacheFile())).toBe(false);
  });

  it('serveHomePulse and serveConflict answer the register under its own label, and save nothing', async () => {
    const { serveHomePulse, serveConflict } = await load();
    const pulse = await serveHomePulse({});
    const conflict = await serveConflict();
    for (const out of [pulse, conflict]) {
      expect(out.rows.length).toBeGreaterThan(0);
      expect(out.note).toMatch(/stored register/i);
      expect(out.note).not.toMatch(/agent snapshot/i);
      expect(out.source).not.toBe('snapshot');
    }
    expect(fs.existsSync(cacheFile())).toBe(false);
  });

  it('a register copy already on disk (written before the fix) is not read as an agent snapshot', async () => {
    const { serveConflict } = await load();
    const register = (await serveConflict()).rows;
    writeSnapshot({ rows: register, source: 'snapshot', note: '', meta: { unique: register.length, deduped: 0, window: 'embedded Open Fronts snapshot' } });
    const out = await serveConflict();
    expect(out.note).toMatch(/stored register/i);
    expect(out.note).not.toMatch(/agent snapshot/i);
  });

  it('a snapshot an agent really saved is still served, labelled as one', async () => {
    writeSnapshot({ rows: [{ title: 'Agent-written front', time: '2026', region: 'X', link: '', source: 'agent', outlets: '', event: '' }], source: 'snapshot', meta: { unique: 1, deduped: 0, window: 'agent snapshot' } });
    const { serveConflict, serveHomePulse } = await load();
    const out = await serveConflict();
    expect(out.note).toMatch(/agent snapshot/i);
    expect(out.rows[0].title).toBe('Agent-written front');
    expect((await serveHomePulse({})).rows[0].title).toBe('Agent-written front');
  });
});
