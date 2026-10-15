import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockList, parseHandbookListing, parseHandbookTable, parseHandbookValue, yearBlocks } from './rbiHandbook.js';
import {
  HANDBOOK, HANDBOOK_BLOCK_MAX, HANDBOOK_MODULES, HANDBOOK_STATES, HANDBOOK_TABLES, handbookState, handbookTableVariant, handbookVariant, parseHandbookVariant,
} from './rbiHandbookTables.js';
import { cellText, extractTables, gridOf } from './htmlTable.js';

/**
 * F196: the RBI Handbook of Statistics on Indian States, read from its HTML table pages. The fixtures
 * are trimmed excerpts of five real pages (fetched 2026-10-15): two continued blocks with a price base
 * (Table 21), sub-columns and a year only in each block's title (Table 1), estimate marks and minus
 * values (Table 164), paired sub-columns and "-: Nil" (Table 178), survey rounds as years (Table 10).
 */
const fixture = (name) => readFileSync(new URL(`./__fixtures__/rbi/${name}`, import.meta.url), 'utf8');
const find = (records, where) => records.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
const one = (records, where) => {
  const hits = find(records, where);
  expect(hits, JSON.stringify(where)).toHaveLength(1);
  return hits[0];
};

describe('HTML tables', () => {
  it('reads cells as text and expands rowspan and colspan on a grid', () => {
    const [t] = extractTables('<table><tr><td rowspan="2">State</td><td colspan="2">2023 &amp; <b>2024</b></td></tr><tr><td>A</td><td>B&#8377;</td></tr></table>');
    expect(t.rows.map((r) => r.map((c) => c.text))).toEqual([['State', '2023 & 2024'], ['A', 'B₹']]);
    const grid = gridOf(t);
    expect(grid.map((r) => r.map((c) => c.text))).toEqual([['State', '2023 & 2024', '2023 & 2024'], ['State', 'A', 'B₹']]);
    expect(grid[0][1].id).toBe(grid[0][2].id);
  });

  it('keeps a nested table out of the cell that holds it', () => {
    const tables = extractTables('<table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>');
    expect(tables.map((t) => t.rows[0][0].text)).toEqual(['inner', 'outer']);
    expect(cellText('a<br>b &nbsp; c')).toBe('a b c');
  });
});

describe('handbook values', () => {
  it('reads Indian digit grouping, minus values and the not-available mark', () => {
    expect(parseHandbookValue('3,79,40,203')).toEqual({ value: 37940203 });
    expect(parseHandbookValue('-1,332')).toEqual({ value: -1332 });
    expect(parseHandbookValue('0.05')).toEqual({ value: 0.05 });
    expect(parseHandbookValue('12.5*')).toEqual({ value: 12.5 });
    expect(parseHandbookValue('-')).toEqual({ missing: true });
    expect(parseHandbookValue('NA')).toEqual({ missing: true });
    expect(parseHandbookValue('-', { dashIsNil: true })).toEqual({ value: 0, nil: true });
    expect(parseHandbookValue('see note')).toEqual({ invalid: true });
  });
});

describe('handbook states', () => {
  it('names every state as the repository does, and the all-India rows as All India', () => {
    expect(HANDBOOK_STATES).toHaveLength(36);
    expect(handbookState('NCT Delhi')).toEqual({ state: 'Delhi', aggregate: false });
    expect(handbookState('Jammu & Kashmir*')).toEqual({ state: 'Jammu & Kashmir', aggregate: false });
    expect(handbookState('Jammu and Kashmir (UT)')).toEqual({ state: 'Jammu & Kashmir', aggregate: false });
    expect(handbookState('Andaman and Nicobar Islands')).toEqual({ state: 'Andaman & Nicobar Islands', aggregate: false });
    expect(handbookState('Dadra & Nagar Haveli and Daman & Diu')).toEqual({ state: 'Dadra & Nagar Haveli and Daman & Diu', aggregate: false });
    expect(handbookState('Orissa')).toEqual({ state: 'Odisha', aggregate: false });
    // Goa's name is as short as a state code; the 2024-25 edition's own misspellings; serial and footnote numbers.
    expect(handbookState('Goa')).toEqual({ state: 'Goa', aggregate: false });
    for (const [label, state] of [['Andhra Pradhesh', 'Andhra Pradesh'], ['Gujrat', 'Gujarat'], ['Tamilnadu', 'Tamil Nadu'], ['Telengana', 'Telangana'], ['Arunanchal Pradesh', 'Arunachal Pradesh'], ['5 NCT of Delhi', 'Delhi'], ['Odisha3', 'Odisha'], ['Jammu & Kashmir UT', 'Jammu & Kashmir']]) {
      expect(handbookState(label), label).toEqual({ state, aggregate: false });
    }
    expect(handbookState('ALL INDIA2')).toEqual({ state: 'All India', aggregate: true });
    expect(handbookState('Jammu & Kashmir and Ladakh')).toBeNull();
    for (const label of ['ALL INDIA', 'All States and UTs', 'Total']) expect(handbookState(label), label).toEqual({ state: 'All India', aggregate: true });
    // A former union territory, a region or a note is not a state.
    for (const label of ['Daman & Diu', 'North-East', 'Source: NSO', 'UP']) expect(handbookState(label), label).toBeNull();
  });

  it('takes a table by number only when the module holds it', () => {
    const economic = HANDBOOK_MODULES['state:State Economic Data (GSDP, sectors)'];
    expect(handbookTableVariant(economic, '21')).toBe('21');
    expect(handbookTableVariant(economic, 'Table 22')).toBe('22');
    expect(handbookTableVariant(economic, '164')).toBe('');
    expect(handbookTableVariant(economic, '')).toBe('');
  });
});

describe('handbook table pages', () => {
  it('Table 21: both continued blocks, the price base, the unit and the publication date', () => {
    const out = parseHandbookTable(fixture('handbook-t21-gsdp.html'), { tableNo: 21, url: HANDBOOK_TABLES.get(21).url });
    expect(out.table).toMatchObject({
      no: 21,
      title: 'Gross State Domestic Product (Current Prices)',
      published: '2025-12-11',
      unit: '₹ Lakh',
    });
    expect(out.table.source).toMatch(/^National Statistical Office/);
    const ap = one(out.records, { state: 'Andhra Pradesh', year: '2011-12' });
    expect(ap).toMatchObject({
      indicator: 'Gross State Domestic Product',
      value: 37940203,
      unit: '₹ Lakh',
      price_basis: 'Current prices, base 2011-12',
      table_no: 21,
      table_title: 'Gross State Domestic Product (Current Prices)',
      source_url: 'https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=23470',
      as_of: '2025-12-11',
      edition: HANDBOOK.edition,
    });
    expect(one(out.records, { state: 'Andhra Pradesh', year: '2024-25' }).value).toBe(159306198);
    // "Jammu & Kashmir*" keeps its footnote as the row's own label.
    expect(one(out.records, { state: 'Jammu & Kashmir', year: '2024-25' })).toMatchObject({ value: 26245807, state_label: 'Jammu & Kashmir*' });
    expect(one(out.records, { state: 'Ladakh', year: '2022-23' }).value).toBe(656469);
    // Not available ("-") is left out, never stored as zero.
    expect(find(out.records, { state: 'Andaman & Nicobar Islands', year: '2024-25' })).toEqual([]);
    expect(find(out.records, { state: 'Ladakh', year: '2019-20' })).toEqual([]);
    expect(out.dropped.missing).toBe(7);
    expect(out.records).toHaveLength(18 + 32 - 7);
    // Newest year first.
    expect(out.records[0].year).toBe('2024-25');
  });

  it('Table 1: sub-columns become the indicator; a block with no year is left out, not guessed', () => {
    const out = parseHandbookTable(fixture('handbook-t1-ger.html'), { tableNo: 1 });
    expect(out.table.title).toBe('State-wise Gross Enrolment Ratio');
    const bihar = one(out.records, { state: 'Bihar', year: '2024-25', indicator: 'Gross Enrolment Ratio · Secondary (Class IX to XII) · Total' });
    expect(bihar.value).toBe(44.7);
    expect(one(out.records, { state: 'Bihar', year: '2023-24', indicator: 'Gross Enrolment Ratio · Foundational (Pre-Primary to Class II) · Female' }).value).toBe(24.2);
    expect(one(out.records, { state: 'All India', year: '2024-25', indicator: 'Gross Enrolment Ratio · Middle (Class VI to Class VIII) · Male' })).toMatchObject({ value: 88.3, aggregate: true, state_label: 'ALL INDIA' });
    // The first block names no year (on the page or in its title): 2 rows x 12 columns are left out.
    expect(out.dropped.no_year).toBe(24);
    expect(out.records).toHaveLength(2 * 12 * 2);
    expect(new Set(out.records.map((r) => r.year))).toEqual(new Set(['2023-24', '2024-25']));
  });

  it('Table 164: estimate marks, minus values, NCT Delhi and the all-states row', () => {
    const out = parseHandbookTable(fixture('handbook-t164-gfd.html'), { tableNo: 164 });
    expect(out.table.unit).toBe('₹ Crore');
    expect(one(out.records, { state: 'Arunachal Pradesh', year: '2022-23' })).toMatchObject({ value: 1738, estimate: 'Actual', year_label: '2022-23 (A)', indicator: 'Gross Fiscal Deficit' });
    expect(one(out.records, { state: 'Arunachal Pradesh', year: '2023-24' })).toMatchObject({ value: 3758, estimate: 'Revised Estimates' });
    expect(one(out.records, { state: 'Arunachal Pradesh', year: '2024-25' })).toMatchObject({ value: 2993, estimate: 'Budget Estimates' });
    expect(one(out.records, { state: 'Arunachal Pradesh', year: '2006-07' }).value).toBe(-106);
    expect(one(out.records, { state: 'Delhi', year: '2022-23' })).toMatchObject({ value: -4565, state_label: 'NCT Delhi' });
    expect(find(out.records, { state: 'Puducherry', year: '2004-05' })).toEqual([]);
    expect(one(out.records, { state: 'All India', year: '2024-25' })).toMatchObject({ value: 1039138, aggregate: true, state_label: 'All States and UTs' });
    expect(one(out.records, { state: 'Arunachal Pradesh', year: '2013-14' }).estimate).toBeUndefined();
  });

  it('Table 178: paired sub-columns, a block without a unit row, and "-" read as Nil where the table says so', () => {
    const out = parseHandbookTable(fixture('handbook-t178-borrowings.html'), { tableNo: 178 });
    expect(one(out.records, { state: 'Uttar Pradesh', year: '2021-22', indicator: 'Market Borrowings of State Governments · Gross Amount Raised' }).value).toBe(62500);
    expect(one(out.records, { state: 'Uttar Pradesh', year: '2021-22', indicator: 'Market Borrowings of State Governments · Repayments' }).value).toBe(20145);
    expect(one(out.records, { state: 'Uttar Pradesh', year: '2021-22', indicator: 'Market Borrowings of State Governments · Repayments' }).unit).toBe('₹ Crore');
    expect(one(out.records, { state: 'Tripura', year: '2017-18', indicator: 'Market Borrowings of State Governments · Repayments' })).toMatchObject({ value: 0, nil: true });
    expect(one(out.records, { state: 'Uttar Pradesh', year: '2024-25', indicator: 'Market Borrowings of State Governments · Repayments' })).toMatchObject({ value: 4233, year_label: '2024-25*' });
    expect(out.dropped.missing).toBe(0);
    expect(out.records).toHaveLength(3 * 6 + 3 * 6 + 3 * 4);
  });

  it('Table 10: a survey round with its years is the year; the round is kept as its label', () => {
    const out = parseHandbookTable(fixture('handbook-t10-mpi.html'), { tableNo: 10 });
    const bihar = one(out.records, { state: 'Bihar', year: '2019-21', indicator: 'Poverty Estimates - Multi-dimensional Poverty Index · Headcount Ratio (Per cent)' });
    expect(bihar).toMatchObject({ value: 33.76, year_label: 'NFHS-5 (2019-21)' });
    expect(one(out.records, { state: 'Lakshadweep', year: '2019-21', indicator: 'Poverty Estimates - Multi-dimensional Poverty Index · MPI' }).value).toBe(0);
    expect(out.table.source).toMatch(/NITI Aayog/);
    expect(out.records).toHaveLength(3 * 6);
  });

  it('Table 8: a bracketed line above a block is a category, not a unit; "." is not applicable', () => {
    const out = parseHandbookTable(fixture('handbook-t8-unemployment.html'), { tableNo: 8 });
    const base = 'Unemployment Rate: Usual Status (Adjusted) (Rural)';
    expect(one(out.records, { state: 'Bihar', year: '2023-24', indicator: `${base} · Rural Male` })).toMatchObject({ value: 33, unit: 'Per Thousands' });
    expect(one(out.records, { state: 'Bihar', year: '2023-24', indicator: `${base} · Rural Female` }).value).toBe(9);
    expect(one(out.records, { state: 'Bihar', year: '2023-24', indicator: `${base} · Rural Overall` }).value).toBe(26);
    expect(find(out.records, { state: 'Ladakh', year: '2018-19' })).toEqual([]);
    expect(out.dropped.duplicate).toBe(0);
    expect(out.dropped.invalid).toBe(0);
  });

  it('Table 107: a year in brackets inside a heading is the year, and leaves the heading', () => {
    const out = parseHandbookTable(fixture('handbook-t107-groundwater.html'), { tableNo: 107 });
    expect(one(out.records, { state: 'West Bengal', year: '2024', indicator: 'Status of Ground Water Extraction in India · Stage of Ground Water Extraction (%)' }).value).toBe(45.63);
    expect(one(out.records, { state: 'West Bengal', year: '2017', indicator: 'Status of Ground Water Extraction in India · Annual Ground Water Extraction' })).toMatchObject({ value: 11.84, unit: 'In Billion Cubic Meter' });
    expect(out.dropped.no_year).toBe(0);
  });

  it('Table 142: units under the headings; one name in two units is told apart; a minus sign is not available', () => {
    const out = parseHandbookTable(fixture('handbook-t142-peak.html'), { tableNo: 142 });
    const base = 'Actual Power Supply Position in terms of Peak Demand vis-à-vis Peak Met';
    expect(one(out.records, { state: 'Delhi', year: '2013-14', indicator: `${base} · Peak Demand` })).toMatchObject({ value: 6035, unit: 'Megawatt' });
    expect(one(out.records, { state: 'Delhi', year: '2013-14', indicator: `${base} · Surplus(+) / Deficit(-) (Megawatt)` }).value).toBe(-382);
    expect(one(out.records, { state: 'Delhi', year: '2013-14', indicator: `${base} · Surplus(+) / Deficit(-) (Per cent)` })).toMatchObject({ value: -6.3, unit: 'Per cent' });
    expect(find(out.records, { state: 'Telangana', year: '2013-14' })).toEqual([]);
    expect(out.unmapped).toContain('North-Eastern Region');
    expect(out.dropped.duplicate).toBe(0);
  });

  it('Table 176: column numbers are not headings; an untitled block takes the year of the block that concludes it', () => {
    const out = parseHandbookTable(fixture('handbook-t176-liabilities.html'), { tableNo: 176 });
    const base = 'Composition of Outstanding Liabilities';
    expect(one(out.records, { state: 'Puducherry', year: '2005', indicator: `${base} · NSSF` }).value).toBe(591);
    expect(one(out.records, { state: 'Puducherry', year: '2005', indicator: `${base} · Outstanding Liabilities` }).value).toBe(1549);
    expect(one(out.records, { state: 'All India', year: '2006', indicator: `${base} · SDLs` }).value).toBe(228926);
    expect(out.records.some((r) => /· \d/.test(r.indicator))).toBe(false);
    expect(out.dropped.no_year).toBe(0);
  });

  it('Table 11: a serial number before the state is ignored', () => {
    const out = parseHandbookTable(fixture('handbook-t11-growth.html'), { tableNo: 11 });
    expect(one(out.records, { state: 'Delhi', year: '2013', indicator: 'Natural Population Growth Rate · Urban' })).toMatchObject({ value: 12.9, state_label: '5 NCT of Delhi', unit: 'Per Cent' });
    expect(out.records).toHaveLength(2 * 9);
  });

  it('Table 95: a date over the whole table is the year of columns that have none', () => {
    const out = parseHandbookTable(fixture('handbook-t95-ridf.html'), { tableNo: 95 });
    const r = one(out.records, { state: 'Tripura', indicator: 'RIDF Sanction and Disbursements · Tranche XXV · Amount Sanctioned in Current Tranche' });
    expect(r).toMatchObject({ year: '2024', year_label: 'As on 31 March 2024', value: 222 });
  });

  it('leaves column codes and footnote numbers out of the indicator (Table 16 layout)', () => {
    const html = `<td align="center" class="tableheader"><b>Table 16: State-wise Health Infrastructure - Doctors and Specialists</b></td>
      <table><tr><td rowspan="3">State/Union Territory</td><td colspan="2">2023</td></tr>
      <tr><td>Required1</td><td>Shortfall</td></tr><tr><td>[R]</td><td>[R-P]</td></tr>
      <tr><td>Bihar</td><td>1,519</td><td>*</td></tr><tr><td>Kerala</td><td>871</td><td>&minus;</td></tr></table>`;
    const out = parseHandbookTable(html, { tableNo: 16 });
    expect(out.records.map((r) => [r.state, r.indicator, r.value])).toEqual([
      ['Bihar', 'Health Infrastructure - Doctors and Specialists · Required', 1519],
      ['Kerala', 'Health Infrastructure - Doctors and Specialists · Required', 871],
    ]);
    expect(out.dropped.missing).toBe(2);
  });

  it('says so when a page has no state table (a block page, a changed layout)', () => {
    const out = parseHandbookTable('<html><body><p>Please try again later.</p></body></html>', { tableNo: 21 });
    expect(out.records).toEqual([]);
    expect(out.error).toMatch(/no state-wise table/);
  });
});

describe('the handbook listing', () => {
  it('reads the edition, its date and each table page', () => {
    const html = `<tr><td class="tableheader"><b>Dec 11, 2025<b></td></tr>
      <a class='link2' href=PublicationsView.aspx?id=23448>Foreword</a>
      <a class='link2' href=PublicationsView.aspx?id=23470>Table 21: Gross State Domestic Product (Current Prices)</a>
      <a class='link2' href=PublicationsView.aspx?id=23614>Table165: State-wise Revenue Deficit</a>
      <title>Handbook of Statistics on Indian States 2024-25</title>`;
    const out = parseHandbookListing(html);
    expect(out.published).toBe('2025-12-11');
    expect(out.tables).toEqual([
      { no: 21, id: 23470, title: 'Gross State Domestic Product (Current Prices)' },
      { no: 165, id: 23614, title: 'State-wise Revenue Deficit' },
    ]);
  });
});

// F201: a table's figures in whole-year blocks of at most HANDBOOK_BLOCK_MAX (one store variant, the most
// feed_record takes in one record). Synthetic records shaped like Table 176 (2024-25 edition): 21 years,
// 2005 to 2025, of 608 figures each (19 indicators x 32 states).
const T176_YEARS = Array.from({ length: 21 }, (_, i) => String(2025 - i));
const t176Like = (perYear = 608) => T176_YEARS.flatMap((year) => Array.from({ length: perYear }, (_, i) => ({ year, indicator: `I${i % 19}`, state: `S${Math.floor(i / 19)}`, i })));

describe('F201: whole-year blocks', () => {
  it('Table 176\'s shape is 7 blocks of 3 whole years, newest first, the newest 2023 to 2025 with 1,824 figures', () => {
    const recs = t176Like();
    const blocks = yearBlocks(recs);
    expect(HANDBOOK_BLOCK_MAX).toBe(2000);
    expect(blocks).toHaveLength(7);
    expect(blocks.map((b) => [b.from, b.through, b.count])).toEqual([
      ['2023', '2025', 1824], ['2020', '2022', 1824], ['2017', '2019', 1824], ['2014', '2016', 1824],
      ['2011', '2013', 1824], ['2008', '2010', 1824], ['2005', '2007', 1824],
    ]);
    expect(blocks[0].years).toEqual(['2025', '2024', '2023']);
    // Every record once, in its input order, in the block of its year.
    expect(blocks.flatMap((b) => b.records)).toHaveLength(recs.length);
    for (const b of blocks) {
      expect(b.records.every((r) => b.years.includes(r.year))).toBe(true);
      expect(b.records.map((r) => recs.indexOf(r))).toEqual([...b.records.map((r) => recs.indexOf(r))].sort((x, y) => x - y));
    }
  });

  it('a table of the limit or fewer is one block; no block passes the limit or splits a year', () => {
    const small = t176Like().slice(0, 2000);
    expect(yearBlocks(small).map((b) => b.count)).toEqual([2000]);
    expect(yearBlocks([])).toEqual([]);
    const uneven = ['2025', '2025', '2025', '2024', '2024', '2023', '2023', '2023', '2023', '2022'].map((year) => ({ year }));
    const blocks = yearBlocks(uneven, 5);
    expect(blocks.map((b) => [b.years, b.count])).toEqual([[['2025', '2024'], 5], [['2023', '2022'], 5]]);
    for (const b of yearBlocks(uneven, 4)) {
      expect(b.count).toBeLessThanOrEqual(4);
      expect(b.records.length).toBe(uneven.filter((r) => b.years.includes(r.year)).length);
    }
  });

  it('one year over the limit is refused, never cut', () => {
    expect(() => yearBlocks(t176Like(), 600)).toThrow(RangeError);
    expect(() => yearBlocks(t176Like(), 600)).toThrow(/2025: 608 figures in one year/);
  });

  it('the blocks as the stored view lists them: the newest is the table\'s own variant, each older one "<table>@<its oldest year>"', () => {
    const list = blockList(176, yearBlocks(t176Like()));
    expect(list[0]).toEqual({ value: '', variant: '176', from: '2023', through: '2025', count: 1824 });
    expect(list.at(-1)).toEqual({ value: '2005', variant: '176@2005', from: '2005', through: '2007', count: 1824 });
    expect(list.map((b) => b.variant)).toEqual(['176', '176@2020', '176@2017', '176@2014', '176@2011', '176@2008', '176@2005']);
  });

  it('variant names: the table alone, or the table and a handbook year; anything else is not a variant', () => {
    expect(handbookVariant(176)).toBe('176');
    expect(handbookVariant(176, '2005')).toBe('176@2005');
    expect(parseHandbookVariant('176')).toEqual({ no: 176, from: '' });
    expect(parseHandbookVariant('151@2019-20')).toEqual({ no: 151, from: '2019-20' });
    expect(parseHandbookVariant('10@1993-97')).toEqual({ no: 10, from: '1993-97' });
    for (const bad of ['', '176@', '176@junk', '176@1899', 'T176', '176@2005@2006', null, '1760@2005']) expect(parseHandbookVariant(bad), String(bad)).toBeNull();
  });

  it('a request\'s table and years as a variant: only a table the module holds, and a years value only when it is a year', () => {
    const fiscal = HANDBOOK_MODULES['state:State Fiscal Deep-Dive'];
    expect(handbookTableVariant(fiscal, '176')).toBe('176');
    expect(handbookTableVariant(fiscal, '176', '2005')).toBe('176@2005');
    expect(handbookTableVariant(fiscal, 'Table 176', '2005')).toBe('176@2005');
    expect(handbookTableVariant(fiscal, '176', 'junk')).toBe('176');
    expect(handbookTableVariant(fiscal, '176', '2005; drop')).toBe('176');
    expect(handbookTableVariant(fiscal, '21', '2005')).toBe('');
    expect(handbookTableVariant(fiscal, '', '2005')).toBe('');
  });
});

