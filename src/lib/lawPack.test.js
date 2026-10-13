import { describe, expect, it } from 'vitest';
import ibbi from '../../public/data/embedded_csv/national_ibbi_announcements.json';
import nclt from '../../public/data/embedded_csv/judiciary_nclt_orders.json';
import { insolvencyRows } from './lawPack.js';

// F128: IBBI announcements state the last date for claims; the shaper keeps it, as written, so the
// record panel's clock has a date the source gave. Nothing is computed from statute.
describe('insolvency rows keep what IBBI states', () => {
  const rows = insolvencyRows(nclt, ibbi);
  const announcements = rows.filter((r) => r.court === 'IBBI');

  it('keeps the claims deadline on every IBBI announcement, exactly as held', () => {
    expect(announcements).toHaveLength(ibbi.length);
    const byDebtorDate = new Map(ibbi.map((r) => [`${r.corporate_debtor}|${r.date}|${r.source_url}`, r.last_submission_date]));
    for (const r of announcements) expect(r.last_submission_date, r.title).toBe(byDebtorDate.get(`${r.entity}|${r.date}|${r.source_url}`));
    expect(announcements.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.last_submission_date))).toBe(true);
  });

  it('keeps the announcement type as written, and adds no deadline to an NCLT order', () => {
    expect(new Set(announcements.map((r) => r.process_type))).toEqual(new Set(ibbi.map((r) => r.type)));
    for (const r of rows.filter((x) => x.court === 'NCLT')) expect(r).not.toHaveProperty('last_submission_date');
  });
});
