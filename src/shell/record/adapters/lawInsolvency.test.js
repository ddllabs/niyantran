import { describe, expect, it } from 'vitest';
import ibbi from '../../../../public/data/embedded_csv/national_ibbi_announcements.json';
import nclt from '../../../../public/data/embedded_csv/judiciary_nclt_orders.json';
import { insolvencyRows } from '../../../lib/lawPack.js';
import { contractProblems } from '../modelContract.js';
import lawInsolvency from './lawInsolvency.js';

// F128 L2: NCLT / NCLAT (Insolvency) record panel over the real stored pack (148 NCLT orders and
// 286 IBBI announcements, shaped exactly as the server and the client fallback shape them).
const rows = insolvencyRows(nclt, ibbi);
const TODAY = '2026-10-13';
const ctx = { rows, today: TODAY };
const kobelco = rows.find((r) => r.court === 'IBBI' && /^KOBELCO MACHINERY/.test(r.title));
const order = rows.find((r) => r.court === 'NCLT' && /CMP EURO TECHNOPLAST/.test(r.title));
const tile = (m, label) => m.glance.tiles.find((t) => t.label === label);
const board = (m) => Object.fromEntries(m.glance.visual2.rows.map((r) => [r.label, r.value]));

describe('NCLT / IBBI record panel (F128)', () => {
  it('honours the contract for every real row', () => {
    expect(rows).toHaveLength(434);
    for (const r of rows) expect(contractProblems(lawInsolvency(r, ctx)), r.title).toEqual([]);
  });

  it('answers the four questions for an IBBI announcement, with the stated claims date as the clock', () => {
    const m = lawInsolvency(kobelco, ctx);
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Process', 'Applicant', 'Insolvency professional', 'Claims due']);
    expect(tile(m, 'Process').value).toBe('Voluntary liquidation');
    expect(tile(m, 'Insolvency professional').value).toBe('Rachna Anchalia');
    expect(tile(m, 'Applicant').sub).toBe('same as the corporate debtor');
    expect(m.glance.tiles[3].clock).toBe(true);
  });

  it('marks a passed claims deadline as closed, an open one with the days left, and none without today', () => {
    const closed = tile(lawInsolvency(kobelco, ctx), 'Claims due');
    expect(closed).toMatchObject({ value: 'Closed', tone: 'red' });
    expect(closed.sub).toBe('04 Sep 2026 · 39 days ago');
    const open = tile(lawInsolvency(kobelco, { rows, today: '2026-09-01' }), 'Claims due');
    expect(open).toMatchObject({ value: '3 days left', tone: 'amber' });
    expect(open.sub).toBe('04 Sep 2026');
    expect(tile(lawInsolvency(kobelco, { rows, today: '2026-09-04' }), 'Claims due').value).toBe('Closes today');
    const undated = tile(lawInsolvency(kobelco, { rows }), 'Claims due');
    expect(undated.value).toBe('04 Sep 2026');
    expect(undated.tone).toBeUndefined();
  });

  it('draws the timeline from held dates only', () => {
    const steps = lawInsolvency(kobelco, ctx).glance.visual.steps;
    expect(steps.map((s) => s.label)).toEqual(['Public announcement', 'Last date for claims']);
    expect(steps.map((s) => s.detail)).toEqual(['08 Aug 2026', '04 Sep 2026']);
    expect(steps.every((s) => s.done)).toBe(true);
    expect(steps.some((s) => s.now)).toBe(false);
    const open = lawInsolvency(kobelco, { rows, today: '2026-09-01' }).glance.visual.steps;
    expect(open[1]).toMatchObject({ done: false, now: true });
  });

  it('marks each needed field from the row itself', () => {
    const m = lawInsolvency(kobelco, ctx);
    expect(board(m)).toMatchObject({ 'Corporate debtor': 'On the row', 'Claims deadline': 'On the row', CIN: 'Not on the row', 'NCLT bench': 'Not on the row' });
    expect(m.glance.visual2.right).toBe('6 of 8 on the row');
    const noDeadline = lawInsolvency({ ...kobelco, last_submission_date: '' }, ctx);
    expect(board(noDeadline)['Claims deadline']).toBe('Not on the row');
    expect(tile(noDeadline, 'Claims due').value).toBe('Not on the row');
    expect(noDeadline.glance.visual2.right).toBe('5 of 8 on the row');
  });

  it('says "Not on the row" for a missing name, never an empty tile', () => {
    const bare = { ...kobelco, applicant: '', insolvency_professional: '' };
    const m = lawInsolvency(bare, ctx);
    expect(tile(m, 'Applicant').value).toBe('Not on the row');
    expect(tile(m, 'Insolvency professional').value).toBe('Not on the row');
    expect(contractProblems(m)).toEqual([]);
    const orderless = lawInsolvency({ ...order, entity: '', remarks: '' }, ctx);
    expect(contractProblems(orderless)).toEqual([]);
  });

  it('gives an NCLT order the case number as written and no invented next date', () => {
    const m = lawInsolvency(order, ctx);
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Order', 'Forum', 'Corporate debtor', 'Next date']);
    expect(tile(m, 'Order').value).toBe('Admission - Final Order');
    expect(tile(m, 'Forum').sub).toBe('C.P. (IB)/1231(MB)2025');
    expect(tile(m, 'Next date')).toMatchObject({ value: 'Not on the row', clock: true });
    expect(JSON.stringify(m)).not.toMatch(/Mumbai/);
  });

  it('links the same company across NCLT and IBBI, never the record itself', () => {
    let linked = 0;
    for (const r of rows) {
      const links = lawInsolvency(r, ctx).touches.links.filter((l) => l.row);
      for (const l of links) expect(l.row).not.toBe(r);
      linked += links.length ? 1 : 0;
    }
    expect(linked).toBeGreaterThan(60);
    const cross = rows.find((r) => r.court === 'IBBI' && lawInsolvency(r, ctx).touches.links.some((l) => l.row?.court === 'NCLT'));
    expect(cross).toBeTruthy();
  });

  it('computes the health strip from the rows on hand', () => {
    expect(lawInsolvency(kobelco, ctx).footer.health).toEqual([['Rows', '434'], ['IBBI notices', '286'], ['NCLT orders', '148'], ['Claims date on row', '100%']]);
  });

  it('offers Quick exit requests that name the record and ask for nothing beyond it', () => {
    const m = lawInsolvency(kobelco, ctx);
    expect(m.quick.map((q) => q.label)).toEqual(['Claim note', 'Deadline sheet', 'Client status update']);
    for (const q of m.quick) expect(q.prompt).toContain('KOBELCO MACHINERY INDIA PRIVATE LIMITED');
  });
});
