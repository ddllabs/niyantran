import { describe, expect, it } from 'vitest';
import sc from '../../../../public/data/embedded_csv/judiciary_sc_orders.json';
import { archiveOrderRows, scOrderRows } from '../../../lib/lawPack.js';
import { contractProblems } from '../modelContract.js';
import lawSupremeCourt, { lawOrdersByTopic, orderDateLabel } from './lawSupremeCourt.js';

// F128 L3: Supreme Court order and Orders-by-Topic record panels over the real stored table
// (220 rows, shaped exactly as the server and the client fallback shape them).
const scRows = scOrderRows(sc);
const archiveRows = archiveOrderRows(sc);
const scCtx = { rows: scRows, today: '2026-10-13' };
const archiveCtx = { rows: archiveRows, today: '2026-10-13' };
const bail = archiveRows.find((r) => r.topic === 'Bail / Criminal');
const other = archiveRows.find((r) => r.topic === 'Other / Unclassified');
const tile = (m, label) => m.glance.tiles.find((t) => t.label === label);
const board = (m) => Object.fromEntries(m.glance.visual2.rows.map((r) => [r.label, r.value]));
const rowOf = (extra) => ({ ...scRows[0], ...extra });

describe('Supreme Court order record panel (F128 L3)', () => {
  it('honours the contract for every real row, through both adapters', () => {
    expect(scRows).toHaveLength(220);
    expect(archiveRows).toHaveLength(220);
    for (const r of scRows) expect(contractProblems(lawSupremeCourt(r, scCtx)), r.title).toEqual([]);
    for (const r of archiveRows) expect(contractProblems(lawOrdersByTopic(r, archiveCtx)), r.title).toEqual([]);
  });

  it('answers the four questions in order with the good-law clock last', () => {
    const m = lawSupremeCourt(bail, scCtx);
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Court', 'Diary no.', 'Topic', 'Still good law?']);
    expect(tile(m, 'Court')).toMatchObject({ value: 'Supreme Court', sub: `order dated ${orderDateLabel(bail.order_date)}` });
    expect(tile(m, 'Diary no.').value).toBe(bail.diary_no);
    expect(tile(m, 'Topic')).toMatchObject({ value: 'Bail / Criminal', sub: 'classifier label, not a holding' });
    expect(m.glance.tiles[3]).toMatchObject({ value: 'Not checked', sub: 'no citator on this desk', clock: true });
    expect(m.glance.tiles.filter((t) => t.clock)).toHaveLength(1);
    expect(m.glance.visual).toBeUndefined();
  });

  it('puts the header, quick exits and footer words in the Court\'s terms', () => {
    const m = lawSupremeCourt(bail, scCtx);
    expect(m.title).toBe(bail.case_title);
    expect(m.meta).toEqual(['Supreme Court of India', `Order dated ${orderDateLabel(bail.order_date)}`]);
    expect(m.badge).toEqual({ text: 'Registry record', tone: 'green' });
    expect(m.links).toEqual([{ label: 'Order PDF (sci.gov.in)', href: bail.source_url }]);
    expect(m.quick.map((q) => q.label)).toEqual(['Case note', 'Synopsis & list of dates']);
    for (const q of m.quick) {
      expect(q.prompt).toContain(bail.case_title);
      expect(q.prompt).toMatch(/only the attached record and the order PDF/);
      expect(q.prompt).not.toMatch(/good law|treatment/i);
    }
    expect(m.about.label).toBe('02 · The pointers');
    expect(m.about.rows.map(([k]) => k)).toEqual(['Case', 'Diary no.', 'Order date', 'Topic', 'Court']);
    expect(m.about.cards[0].heading).toBe('What this record does not settle');
    expect(m.footer.ask).toBe('Ask AI about this order');
    expect(m.footer.provenance.source).toBe('Supreme Court of India order listings (stored table, sci.gov.in)');
    // The table's snapshot time (07 Sep 2026 in India), never the order date.
    expect(m.footer.provenance.asOf).toBe('07 Sep 2026');
    expect(m.footer.provenance.asOf).not.toBe(orderDateLabel(bail.order_date));
    expect(m.glance.callout.text).toMatch(/live court session/);
    expect(m.footer.note).toBe('Case titles print exactly as the Court lists them. A topic is a classifier label, not a recommendation or a finding.');
  });

  it('shows "Other / Unclassified" as Unclassified and relates it to nothing', () => {
    for (const adapter of [lawSupremeCourt, lawOrdersByTopic]) {
      const m = adapter(other, scCtx);
      expect(tile(m, 'Topic')).toMatchObject({ value: 'Unclassified', sub: 'the classifier left it unlabelled' });
      expect(JSON.stringify(m)).not.toMatch(/Other \/ Unclassified/);
      expect(m.touches.links).toEqual([]);
    }
    const blank = lawSupremeCourt(rowOf({ topic: '' }), scCtx);
    expect(tile(blank, 'Topic').value).toBe('Unclassified');
    expect(blank.touches.links).toEqual([]);
  });

  it('links up to three orders on the same topic, never the record itself', () => {
    const m = lawSupremeCourt(bail, scCtx);
    expect(m.touches.links).toHaveLength(3);
    for (const l of m.touches.links) {
      expect(l.row.topic).toBe('Bail / Criminal');
      expect(l.row).not.toBe(bail);
      expect(l.title).toBe(l.row.case_title);
      expect(l.detail).toBe(`Same topic · ${orderDateLabel(l.row.order_date)}`);
    }
    for (const r of scRows) {
      for (const adapter of [lawSupremeCourt, lawOrdersByTopic]) {
        for (const l of adapter(r, scCtx).touches.links) {
          expect(l.row).not.toBe(r);
          expect(l.row.diary_no).not.toBe(r.diary_no);
        }
      }
    }
    // A copy of the record handed in by the host is still the record.
    const copy = { ...bail };
    for (const l of lawSupremeCourt(copy, scCtx).touches.links) expect(l.row.diary_no).not.toBe(copy.diary_no);
    // The only Land / Property order has nothing to relate to.
    const lone = scRows.find((r) => r.topic === 'Land / Property');
    expect(lawSupremeCourt(lone, scCtx).touches.links).toEqual([]);
  });

  it('counts topics from the data for the Orders by Topic panel', () => {
    const m = lawOrdersByTopic(bail, archiveCtx);
    expect(m.glance.tiles.map((t) => t.label)).toEqual(['Topic', 'Orders on this topic', 'Order date', 'Still good law?']);
    expect(tile(m, 'Orders on this topic')).toMatchObject({ value: '5', sub: 'of 220 in the table' });
    expect(tile(m, 'Order date').value).toBe(orderDateLabel(bail.order_date));
    expect(m.glance.tiles[3]).toMatchObject({ value: 'Not checked', clock: true });
    const viz = m.glance.visual;
    expect(viz).toMatchObject({ type: 'board', title: 'Orders in the table by topic' });
    expect(Object.fromEntries(viz.rows.map((r) => [r.label, r.value]))).toEqual({
      Unclassified: '208', 'Tax / Financial': '6', 'Bail / Criminal': '5', 'Land / Property': '1',
    });
    expect(viz.rows.map((r) => r.label)).toEqual(['Unclassified', 'Tax / Financial', 'Bail / Criminal', 'Land / Property']);
    expect(viz.rows.filter((r) => r.note === 'this record').map((r) => r.label)).toEqual(['Bail / Criminal']);
    expect(viz.rows.find((r) => r.note).tone).toBe('blue');
    expect(viz.caption).toMatch(/not weights/);
    expect(viz.caption).toMatch(/208 of 220/);
    const un = lawOrdersByTopic(other, archiveCtx);
    expect(tile(un, 'Orders on this topic').value).toBe('208');
    expect(un.glance.visual.rows.find((r) => r.note).label).toBe('Unclassified');
  });

  it('computes the unclassified callout and the health strip from the rows on hand', () => {
    const t = lawOrdersByTopic(bail, archiveCtx);
    expect(t.glance.callout).toEqual({ tone: 'amber', text: '208 of 220 orders in this table are unclassified. The topic is a keyword classifier\'s label, not a reading of the order.' });
    expect(t.footer.health).toEqual([['Rows', '220'], ['Classified', '5%'], ['Order PDFs', '100%']]);
    const few = scRows.slice(0, 4).map((r, i) => ({ ...r, topic: i < 1 ? 'Bail / Criminal' : 'Other / Unclassified', source_url: i < 2 ? r.source_url : '', pdf_url: i < 2 ? r.pdf_url : '' }));
    const m = lawOrdersByTopic(few[0], { rows: few });
    expect(m.glance.callout.text).toMatch(/^3 of 4 orders/);
    expect(m.footer.health).toEqual([['Rows', '4'], ['Classified', '25%'], ['Order PDFs', '50%']]);
    expect(lawSupremeCourt(few[0], { rows: few }).footer.health).toEqual(m.footer.health);
  });

  it('copes with no table on hand', () => {
    const m = lawOrdersByTopic(bail, {});
    expect(contractProblems(m)).toEqual([]);
    expect(tile(m, 'Orders on this topic').value).toBe('Not on the row');
    expect(m.glance.visual).toBeUndefined();
    expect(m.footer.health).toEqual([]);
    expect(m.glance.callout.text).toBe('The topic is a keyword classifier\'s label, not a reading of the order.');
    expect(contractProblems(lawSupremeCourt(bail))).toEqual([]);
  });

  it('parses dates strictly: DD-Mon-YYYY and ISO only, never a guess', () => {
    expect(orderDateLabel('03-Jul-2026')).toBe('03 Jul 2026');
    expect(orderDateLabel('3-jul-2026')).toBe('03 Jul 2026');
    expect(orderDateLabel('2026-07-03')).toBe('03 Jul 2026');
    expect(orderDateLabel('29-Feb-2024')).toBe('29 Feb 2024');
    for (const bad of ['', null, undefined, 'garbage', '31-Feb-2026', '29-Feb-2026', '00-Jul-2026', '32-Jul-2026', '03-Foo-2026', '03/07/2026', 'July 3, 2026', '2026-13-01', '2026-02-30', '03-Jul-26', '2026-07-03T10:00:00Z']) {
      expect(orderDateLabel(bad), String(bad)).toBe('');
    }
    // Every real date reads back as the same day, in the Court's own month.
    for (const r of scRows) {
      const [d, mon, y] = r.order_date.split('-');
      expect(orderDateLabel(r.order_date)).toBe(`${d} ${mon} ${y}`);
    }
  });

  it('never shows an empty tile or a guessed date for an undated, bare row', () => {
    const bare = rowOf({ order_date: 'garbage', date: 'garbage', diary_no: '', topic: '', source_url: '', pdf_url: '', as_of: '' });
    for (const adapter of [lawSupremeCourt, lawOrdersByTopic]) {
      const m = adapter(bare, scCtx);
      expect(contractProblems(m)).toEqual([]);
      for (const t of m.glance.tiles) expect(t.value.trim()).not.toBe('');
      expect(m.footer.provenance.asOf).toBeUndefined();
      expect(m.footer.provenance.flags).toEqual(['as-of not on record']);
      expect(m.meta).toEqual(['Supreme Court of India']);
      expect(m.links).toEqual([]);
    }
    const m = lawSupremeCourt(bare, scCtx);
    expect(tile(m, 'Court').sub).toBe('order date not on the row');
    expect(tile(m, 'Diary no.').value).toBe('Not on the row');
    expect(lawOrdersByTopic(bare, scCtx).glance.tiles.find((t) => t.label === 'Order date').value).toBe('Not on the row');
    expect(board(m)['Order PDF']).toBe('Not on the row');
  });

  it('marks each needed field from the row itself', () => {
    for (const adapter of [lawSupremeCourt, lawOrdersByTopic]) {
      const m = adapter(bail, scCtx);
      expect(m.glance.visual2.title).toBe('What a lawyer needs · what this row has');
      expect(m.glance.visual2.rows.map((r) => r.label)).toEqual([
        'Diary number', 'Neutral citation', 'Reported citation', 'Coram and bench strength', 'Result',
        'Provisions engaged', 'Holding', 'Subsequent treatment', 'Order PDF',
      ]);
      expect(board(m)).toEqual({
        'Diary number': 'On the row', 'Neutral citation': 'Not on the row', 'Reported citation': 'Not on the row',
        'Coram and bench strength': 'Not on the row', Result: 'Not on the row', 'Provisions engaged': 'Not on the row',
        Holding: 'Not on the row', 'Subsequent treatment': 'Not on the row', 'Order PDF': 'On the row',
      });
      expect(m.glance.visual2.right).toBe('2 of 9 on the row');
      const pdf = m.glance.visual2.rows.find((r) => r.label === 'Order PDF');
      expect(pdf).toMatchObject({ tone: 'green', note: 'may need a live court session' });
      expect(m.glance.visual2.rows.find((r) => r.label === 'Result').tone).toBe('red');
    }
    const noPdf = lawSupremeCourt({ ...bail, source_url: '', pdf_url: '' }, scCtx);
    expect(board(noPdf)['Order PDF']).toBe('Not on the row');
    expect(noPdf.glance.visual2.right).toBe('1 of 9 on the row');
    const noDiary = lawSupremeCourt({ ...bail, diary_no: '' }, scCtx);
    expect(board(noDiary)['Diary number']).toBe('Not on the row');
    expect(noDiary.glance.visual2.right).toBe('1 of 9 on the row');
    const insecure = lawSupremeCourt({ ...bail, source_url: 'http://www.sci.gov.in/x.pdf' }, scCtx);
    expect(board(insecure)['Order PDF']).toBe('Partial');
    expect(insecure.glance.visual2.rows.find((r) => r.label === 'Order PDF').tone).toBe('amber');
    expect(insecure.links).toEqual([]);
    // A field the row does hold is counted, so the board is not hard-coded.
    const cited = lawSupremeCourt({ ...bail, neutral_citation: '2026 INSC 1', coram: 'Bench of three' }, scCtx);
    expect(board(cited)['Neutral citation']).toBe('On the row');
    expect(board(cited)['Coram and bench strength']).toBe('On the row');
    expect(cited.glance.visual2.right).toBe('4 of 9 on the row');
  });

  it('prints names exactly as listed and keeps unstated things out', () => {
    const m = lawSupremeCourt(bail, scCtx);
    expect(m.title).toBe(bail.case_title);
    const text = JSON.stringify(m);
    expect(text).not.toMatch(/overrul|affirm|dismiss|allowed|good law\b(?!\?)/i);
  });
});
