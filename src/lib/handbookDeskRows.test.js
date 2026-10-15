/**
 * F201 T9b: the RBI Handbook register as desk_rows, so the AI's structured search
 * (search_desk_rows) can find a figure by state, indicator, table and year, and by a date range.
 *
 * The date-range check below is a JS reading of public.desk_row_date / desk_row_date_in
 * (supabase/migrations/20261015210000_desk_rows_date_range.sql) for the forms these rows hold; the SQL
 * is authoritative; the same three questions were run through it on a local database loaded with the
 * whole register (F201 T9b report).
 */
import { describe, expect, it } from 'vitest';
import { HANDBOOK_DESK_FIELDS, handbookDeskRows, handbookYearDate } from './handbookDeskRows.js';

const URL = (no) => `https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=${23449 + no}`;
const rec = (table_no, state, indicator, year, value, extra = {}) => ({
  state,
  indicator,
  year,
  value,
  unit: extra.unit ?? '',
  table_no,
  table_title: extra.table_title ?? `Table ${table_no}`,
  source_url: URL(table_no),
  as_of: '2025-12-11',
  edition: '2024-25',
  title: `${state} · ${indicator} · ${year}`,
  ...extra,
});

const REGISTER = {
  edition: '2024-25',
  published: '2025-12-11',
  fetched_at: '2026-10-15T16:08:00.000Z',
  records: [
    rec(21, 'Maharashtra', 'Gross State Domestic Product', '2019-20', 265680647, { unit: '₹ Lakh', table_title: 'Gross State Domestic Product (Current Prices)', price_basis: 'Current prices, base 2011-12' }),
    rec(21, 'Maharashtra', 'Gross State Domestic Product', '2020-21', 263250000, { unit: '₹ Lakh' }),
    rec(21, 'Kerala', 'Gross State Domestic Product', '2019-20', 81030000, { unit: '₹ Lakh' }),
    rec(176, 'Bihar', 'Composition of Outstanding Liabilities · SDLs', '2005', 10463, { unit: '₹ Crore' }),
    rec(176, 'Bihar', 'Composition of Outstanding Liabilities · SDLs', '2006', 11200, { unit: '₹ Crore' }),
    rec(176, 'Bihar', 'Composition of Outstanding Liabilities · Power Bonds', '2005', 1594, { unit: '₹ Crore' }),
    rec(151, 'Kerala', 'Number of Schools · Total Schools · All Management', '2019-20', 16665),
    rec(151, 'Kerala', 'Number of Schools · Total Schools · All Management', '2020-21', 16550),
    rec(16, 'Assam', 'Infant Mortality Rate', '2019-21', 31),
    // Table 19 is held by two modules (State Economic Data and District Economic & Livelihood).
    rec(19, 'Goa', 'Net State Domestic Product', '2019-2020', 64000, { unit: '₹ Lakh' }),
    // Not a figure: no numeric value.
    { ...rec(21, 'Goa', 'Gross State Domestic Product', '2019-20', null), value: null },
  ],
};

const byFeature = (feature) => handbookDeskRows(REGISTER).find((m) => m.feature === feature);

// public.desk_row_date / desk_row_date_in for 'YYYY-MM-DD' and 'YYYY' (the only forms these rows hold).
const rowDate = (v) => (/^\d{4}-\d{2}-\d{2}/.exec(v) || /^\d{4}(?=\D|$)/.exec(v) || [null])[0];
const dateIn = (v, from, to) => {
  const d = rowDate(String(v ?? ''));
  return d != null && (!from || d >= from.slice(0, d.length)) && (!to || d <= to.slice(0, d.length));
};
// search_desk_rows: `row @> filters` (exact, values as text), then the date range.
const search = (rows, { filters = {}, from = null, to = null } = {}) =>
  rows.filter((r) => Object.entries(filters).every(([k, v]) => r.row[k] === v) && (!from && !to ? true : dateIn(r.row.date, from, to)));

describe('F201 T9b: a handbook year as a date the date-range filter reads', () => {
  it('a calendar year is that year; a financial year starts on its 1 April; a longer period is dated by its first year', () => {
    expect(handbookYearDate('2005')).toEqual({ date: '2005', period: 'calendar year' });
    expect(handbookYearDate('2019-20')).toEqual({ date: '2019-04-01', period: 'financial year' });
    expect(handbookYearDate('1999-00')).toEqual({ date: '1999-04-01', period: 'financial year' });
    expect(handbookYearDate('2019-2020')).toEqual({ date: '2019-04-01', period: 'financial year' });
    expect(handbookYearDate('1993-97')).toEqual({ date: '1993', period: 'period of years' });
    expect(handbookYearDate('2019-21')).toEqual({ date: '2019', period: 'period of years' });
    expect(handbookYearDate('1996-2000')).toEqual({ date: '1996', period: 'period of years' });
  });

  it('anything that is not a handbook year has no date', () => {
    for (const y of ['', 'n.a.', '2019-18', '19-20', '2019/20', '2019-2031', null, undefined]) expect(handbookYearDate(y), String(y)).toBeNull();
  });
});

describe('F201 T9b: the register as desk_rows', () => {
  it('one entry per handbook module, on the State desk, each holding only its own tables', () => {
    const modules = handbookDeskRows(REGISTER);
    expect(modules.map((m) => m.id)).toEqual([
      'state:State Economic Data (GSDP, sectors)',
      'state:State Fiscal Deep-Dive',
      'state:NITI Aayog State Indices',
      'state:District Health & Nutrition Indicators',
      'state:District Education Indicators',
      'state:District Economic & Livelihood Indicators',
      'state:District Agriculture & Rural Indicators',
      'state:District Infrastructure & Connectivity',
    ]);
    for (const m of modules) expect(m.tier).toBe('state');
    expect(byFeature('State Economic Data (GSDP, sectors)').rows.map((r) => r.row.table_no).sort()).toEqual(['19', '21', '21', '21']);
    expect(byFeature('State Fiscal Deep-Dive').rows).toHaveLength(3);
    expect(byFeature('District Education Indicators').rows).toHaveLength(2);
    expect(byFeature('District Health & Nutrition Indicators').rows).toHaveLength(1);
    // A table two modules hold is a row of each.
    expect(byFeature('District Economic & Livelihood Indicators').rows.map((r) => r.row.table_no)).toEqual(['19']);
    expect(byFeature('NITI Aayog State Indices').rows).toHaveLength(0);
  });

  it('a record that is not a figure is left out and counted', () => {
    const m = byFeature('State Economic Data (GSDP, sectors)');
    expect(m.dropped).toEqual({ bad_record: 1 });
    expect(m.rows.some((r) => r.row.state === 'Goa' && r.row.table_no === '21')).toBe(false);
  });

  it('every row carries the fields the AI filters on, a date and its period, and reads as the figure', () => {
    for (const f of ['state', 'indicator', 'year', 'value', 'unit', 'table_no', 'table_title', 'as_of', 'source_url']) expect(HANDBOOK_DESK_FIELDS).toContain(f);
    const [gsdp] = search(byFeature('State Economic Data (GSDP, sectors)').rows, { filters: { state: 'Maharashtra', year: '2019-20' } });
    expect(gsdp.row).toMatchObject({
      state: 'Maharashtra',
      indicator: 'Gross State Domestic Product',
      year: '2019-20',
      value: '265680647',
      unit: '₹ Lakh',
      table_no: '21',
      table_title: 'Gross State Domestic Product (Current Prices)',
      as_of: '2025-12-11',
      source_url: URL(21),
      date: '2019-04-01',
      period: 'financial year',
      price_basis: 'Current prices, base 2011-12',
    });
    expect(gsdp.record_text).toContain('265680647');
    expect(gsdp.record_text).toContain('Gross State Domestic Product');
    expect(gsdp.document_key).toBeNull();
    expect(gsdp.snapshot_at).toBe('2025-12-11T00:00:00.000Z');
  });

  it('each figure has its own key: one per table, state, indicator and year, and the same on every load', () => {
    const all = handbookDeskRows(REGISTER).flatMap((m) => m.rows.map((r) => `${m.feature}|${r.row_key}`));
    expect(new Set(all).size).toBe(all.length);
    const [a] = byFeature('State Fiscal Deep-Dive').rows;
    expect(a.row_key).toMatch(/^hb:t176:[0-9a-f]{16}$/);
    expect(handbookDeskRows(REGISTER).find((m) => m.feature === 'State Fiscal Deep-Dive').rows[0].row_key).toBe(a.row_key);
    expect(handbookDeskRows(REGISTER).every((m) => m.collisions.length === 0)).toBe(true);
    // The key is not part of what the model reads.
    expect(a.record_text).not.toContain('hb:t176');
  });

  it('only the modules asked for', () => {
    expect(handbookDeskRows(REGISTER, { only: ['State Fiscal Deep-Dive'] }).map((m) => m.feature)).toEqual(['State Fiscal Deep-Dive']);
  });
});

describe('F201 T9b: three questions, answered by search_desk_rows-style filtering', () => {
  it("Maharashtra's GSDP in 2019-20: by its fields, or by the financial year's dates", () => {
    const rows = byFeature('State Economic Data (GSDP, sectors)').rows;
    const byFields = search(rows, { filters: { state: 'Maharashtra', table_no: '21', year: '2019-20' } });
    const byDates = search(rows, { filters: { state: 'Maharashtra', table_no: '21' }, from: '2019-04-01', to: '2020-03-31' });
    expect(byFields.map((r) => r.row.value)).toEqual(['265680647']);
    expect(byDates.map((r) => r.row.value)).toEqual(['265680647']);
  });

  it("Bihar's outstanding SDLs in 2005 (Table 176's oldest block, held only since F201)", () => {
    const rows = byFeature('State Fiscal Deep-Dive').rows;
    const hit = search(rows, { filters: { state: 'Bihar', indicator: 'Composition of Outstanding Liabilities · SDLs' }, from: '2005-01-01', to: '2005-12-31' });
    expect(hit.map((r) => [r.row.year, r.row.value, r.row.unit])).toEqual([['2005', '10463', '₹ Crore']]);
  });

  it("Kerala's schools in 2019-20 (Table 151's older block), and a period of years found by a range over its first year", () => {
    const schools = search(byFeature('District Education Indicators').rows, { filters: { state: 'Kerala', table_no: '151' }, from: '2019-04-01', to: '2020-03-31' });
    expect(schools.map((r) => [r.row.year, r.row.value])).toEqual([['2019-20', '16665']]);
    const imr = search(byFeature('District Health & Nutrition Indicators').rows, { filters: { state: 'Assam' }, from: '2019-01-01', to: '2019-12-31' });
    expect(imr.map((r) => [r.row.year, r.row.period])).toEqual([['2019-21', 'period of years']]);
  });
});
