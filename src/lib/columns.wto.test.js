import { describe, expect, it } from 'vitest';
import register from '../../public/data/embedded_csv/judiciary_wto_disputes.json';
import { feedColumns } from './columns.js';
import { wtoRows } from './lawPack.js';

// F129: the WTO table shows the register's columns, and news rows (the fallback) keep the generic ones.
describe('WTO table columns', () => {
  it('uses the register columns for register rows', () => {
    expect(feedColumns('WTO Dispute Settlement', wtoRows(register)).filter((c) => c.default).map((c) => c.label)).toEqual(['DS', 'DISPUTE', 'COMPLAINANT', 'RESPONDENT', 'STAGE', 'REQUESTED']);
  });

  it('falls back to the generic columns for news rows', () => {
    const news = [{ date: 'Mon, 12 Oct 2026 09:00:00 GMT', title: 'WTO panel rules - Reuters', publisher: 'Reuters', summary: 'x', source_url: 'https://news.google.com/x' }];
    const labels = feedColumns('WTO Dispute Settlement', news).map((c) => c.label);
    expect(labels).toContain('PUBLISHER');
    expect(labels).not.toContain('REQUESTED');
  });
});
