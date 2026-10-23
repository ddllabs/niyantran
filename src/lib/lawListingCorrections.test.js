import { describe, expect, it } from 'vitest';
import { handleFeatureFeedRequest } from '../../server/featureFeed.mjs';
import nclt from '../../public/data/embedded_csv/judiciary_nclt_orders.json';
import ibbi from '../../public/data/embedded_csv/national_ibbi_announcements.json';
import { insolvencyRows, lawRows } from './lawPack.js';
import { prepareDeskFeed } from './prepareDeskFeed.js';
import { filterRows } from './normalise.js';
import { buildTableSearchIndex, searchTableRows } from './tableSearch.js';
import { toDeskRow } from './deskRows.js';

const feature = 'NCLT / NCLAT (Insolvency)';
const source = 'law:trib:IBBI_NCLT:ibbi_nclt-29f626f45865bd4a';
const url = 'https://ibbi.gov.in/uploads/order/7c2928dab0f907c71d2c2aa47f13b6ce.pdf';
const prepare = rows => prepareDeskFeed({ tier: 'judiciary', feature, rows }).rows;

describe('Globiz listing correction (F243)', () => {
  it('serves the correction through the feature-feed API', async () => {
    const res = { setHeader() {}, end(raw) { this.body = JSON.parse(raw); } };
    const query = new URLSearchParams({ tier: 'judiciary', feature });
    await handleFeatureFeedRequest({ method: 'GET', url: `/api/feature-feed?${query}`, headers: { host: 'localhost' } }, res, () => {});
    expect(res.body.rows.filter(row => row.source_url === url)).toHaveLength(1);
    expect(res.body.rows.find(row => row.source_url === url).source_key).toBe(source);
  });
  it('makes the indexed order discoverable by company and case in both listing search paths', () => {
    const rows = prepare(lawRows('nclt', { nclt, ibbi }));
    for (const query of ['Globiz Exim', 'C.P. (IB)/595/MB/2025']) {
      for (const found of [filterRows(rows, query), searchTableRows(rows, buildTableSearchIndex(rows), query)]) {
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ id: source, source_key: source, source_url: url, court: 'NCLT', date: '2026-07-08', remarks: 'Rejected' });
      }
    }
    const row = rows.find(r => r.source_key === source);
    expect(toDeskRow({ tier: 'law', feature, raw: row, snapshotAt: '2026-10-23T00:00:00Z' })).toMatchObject({ row_key: source.toLowerCase(), row: { source_key: source, source_url: url } });
  });

  it('preserves every original row and its identity, adding exactly one order', () => {
    const previous = prepare(insolvencyRows(nclt, ibbi));
    const next = prepare(lawRows('nclt', { nclt, ibbi }));
    expect(next).toHaveLength(previous.length + 1);
    expect(next.slice(0, previous.length)).toEqual(previous);
  });

  it('does not duplicate an exact URL already included in a later register', () => {
    const updated = [...nclt, { subject: 'Globiz Exim Private Limited', date: '2026-07-08', source_url: url }];
    const rows = lawRows('nclt', { nclt: updated, ibbi });
    expect(rows.filter(r => r.source_url === url)).toHaveLength(1);
  });
});
