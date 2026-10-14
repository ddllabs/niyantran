// P12 (F171 B6): SheetJS 0.18.5 had a high-severity prototype-pollution and ReDoS advisory with no
// npm fix; the vendor's own 0.20.3 build is installed. Spreadsheets larger than the source limit are
// refused before they are parsed.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { extractBuffer } from '../../server/sourceExtract.mjs';

const require = createRequire(import.meta.url);

describe('SheetJS (P12)', () => {
  it('is 0.20.2 or later (the advisories are fixed there)', () => {
    const [major, minor, patch] = String(require('xlsx').version).split('.').map(Number);
    expect(major * 10_000 + minor * 100 + patch).toBeGreaterThanOrEqual(2002);
  });

  it('refuses a spreadsheet over 10 MB before parsing it', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
    const out = await extractBuffer(big, { kind: 'sheet', name: 'big.xlsx' });
    expect(out.error).toMatch(/too large/i);
    expect(out.text).toBeUndefined();
  });

  it('still reads a small spreadsheet', async () => {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['bill', 'year'], ['Data Bill', 2026]]), 'Bills');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const out = await extractBuffer(buf, { kind: 'sheet', name: 'small.xlsx' });
    expect(out.text).toContain('Data Bill,2026');
  });
});
