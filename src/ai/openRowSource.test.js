import { beforeEach, describe, expect, it } from 'vitest';
import { deskRowKey } from '../lib/deskRows.js';
import { openInDesk, pendingDeskRow, takePendingDeskRow } from './openRowSource.js';

const BILL = {
  id: '156-Lok Sabha-2026-08-09-THE NATIONAL CO-OPERATIVE DEVELOPMENT CO',
  bill_name: 'THE NATIONAL CO-OPERATIVE DEVELOPMENT CORPORATION (AMENDMENT) BILL, 2026',
  bill_number: '156',
  house: 'Lok Sabha',
};

const citation = {
  id: 1,
  kind: 'row',
  tier: 'national',
  feature: 'Bill Passage Probability Index',
  row_key: deskRowKey(BILL),
  title: BILL.bill_name,
  row_snapshot: BILL,
  snapshot_at: '2026-09-07T18:02:04.432Z',
};

describe('openInDesk / takePendingDeskRow', () => {
  beforeEach(() => {
    // drain any request left by a previous test
    takePendingDeskRow({ feature: pendingDeskRow()?.feature, rows: [] }, pendingDeskRow()?.tab);
  });

  it('resolves the route and leaves a pending request (no window here, so no navigation)', () => {
    const p = openInDesk(citation);
    expect(p).toEqual({ tab: 'national', feature: 'Bill Passage Probability Index', row_key: citation.row_key });
    expect(pendingDeskRow()).toEqual(p);
    expect(openInDesk({ kind: 'text' })).toBeNull();
  });

  it('returns the feed row whose desk key matches, and clears the request', () => {
    openInDesk(citation);
    const other = { ...BILL, id: 'other', bill_name: 'Another bill' };
    const feed = { feature: 'Bill Passage Probability Index', rows: [{ status: 'source_status' }, other, { ...BILL, extra: 'the live row' }] };
    const row = takePendingDeskRow(feed, 'national');
    expect(row?.extra).toBe('the live row');
    expect(pendingDeskRow()).toBeNull();
  });

  it('returns null and clears when the loaded module lacks the row', () => {
    openInDesk(citation);
    expect(takePendingDeskRow({ feature: 'Bill Passage Probability Index', rows: [{ ...BILL, id: 'gone' }] }, 'national')).toBeNull();
    expect(pendingDeskRow()).toBeNull();
  });

  it('stays pending while another desk or module is what loaded', () => {
    openInDesk(citation);
    expect(takePendingDeskRow({ feature: 'Open Fronts', rows: [BILL] }, 'global')).toBeNull();
    expect(pendingDeskRow()).not.toBeNull();
    expect(takePendingDeskRow({ feature: 'Policy Intelligence Graph', rows: [BILL] }, 'national')).toBeNull();
    expect(pendingDeskRow()).not.toBeNull();
    expect(takePendingDeskRow(null, 'national')).toBeNull();
    expect(takePendingDeskRow({ feature: 'Bill Passage Probability Index', rows: [BILL] }, 'national')).toBe(BILL);
  });
});
