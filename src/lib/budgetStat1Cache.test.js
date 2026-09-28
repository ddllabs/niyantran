// The STAT-1 (Budget Statement 1) parse is a cache. It used to be written
// over the committed seed public/data/centre_state_fund_flow.json (and
// silently failed on Vercel). It now lives under writablePath('stat1.json');
// the committed file is only the last-resort seed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/data/centre_state_fund_flow.json');
const sha = () => crypto.createHash('sha256').update(fs.readFileSync(SEED)).digest('hex');

function stat1Workbook(label) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Expenditure Profile 2026-2027'],
    ['(In ₹ Crores)'],
    ['', '1.', label, '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '', '12'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Statement 1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('STAT-1 cache', () => {
  it('writes the parsed pack outside public/ and serves it after a cold start', async () => {
    const label = `Cache probe ${Date.now()}`;
    const before = sha();
    const buf = stat1Workbook(label);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buf })));
    const live = await (await import('../../server/budgetStat1.mjs')).loadCentreStateFundFlow();
    expect(live.rows[0].category).toBe(label);
    expect(sha()).toBe(before);

    // A new instance whose download fails reads the cache, not the seed.
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const cold = await (await import('../../server/budgetStat1.mjs')).loadCentreStateFundFlow();
    expect(cold.stale).toBe(true);
    expect(cold.rows[0].category).toBe(label);
  });
});
