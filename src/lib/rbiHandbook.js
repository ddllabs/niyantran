/**
 * F196: the RBI Handbook of Statistics on Indian States, read from its HTML table pages
 * (www.rbi.org.in/Scripts/PublicationsView.aspx?id=…). The spreadsheet downloads sit behind a
 * captcha and are never fetched; every table is also published as a plain HTML page, which is what
 * this reads.
 *
 * A table page holds one or more blocks (a long table is continued: "(Concld.)"), each an HTML table
 * whose first column names a state or union territory. Above the state rows are banner rows (the
 * block's title, its unit such as "(₹ Lakh)") and header rows (years, or categories and then years,
 * or a price base such as "Base: 2011-12"); below them a note row with the legend and the source.
 *
 * parseHandbookTable turns a page into long-form records, one per state, indicator and year:
 *   { state, indicator, year, value, unit, price_basis?, estimate?, year_label?, state_label?,
 *     aggregate?, nil?, table_no, table_title, source_url, as_of, edition, title }
 * - state: the repository's name (src/lib/rbiHandbookTables.js handbookState); the all-India and
 *   all-states rows are 'All India' with aggregate: true. Rows naming anything else are left out and
 *   listed in `unmapped`.
 * - indicator: the table's title without "State-wise" and its price basis, then any header categories
 *   ("Gross Enrolment Ratio · Secondary (Class IX to XII) · Total").
 * - year: the column's year ("2023-24", "2019-21", "2023"); its own header when it says more
 *   ("2022-23 (A)", "NFHS-5 (2019-21)", "2024-25*") is kept as year_label, and an estimate mark as
 *   estimate (Actual, Revised Estimates, Budget Estimates …). A column whose year is in neither its
 *   header nor its block's title is left out (dropped.no_year), never guessed.
 * - value: a number. "-" is not available and is left out (dropped.missing), unless the table's
 *   legend reads "-: Nil", when it is 0 with nil: true.
 * Records come newest year first, then in the table's column and row order.
 */
import { cellText, extractTables, gridOf } from './htmlTable.js';
import { HANDBOOK, HANDBOOK_BLOCK_MAX, HANDBOOK_TABLES, handbookState, handbookTableLabel, handbookVariant } from './rbiHandbookTables.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Dec 11, 2025" -> "2025-12-11", or '' when it is not such a date. */
export function isoFromRbiDate(text) {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec(String(text ?? ''));
  const month = m && MONTHS[m[1].toLowerCase()];
  if (!month) return '';
  const iso = `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return Number.isFinite(Date.parse(`${iso}T00:00:00Z`)) ? iso : '';
}

const FOOTNOTE_MARKS = /[*#@^$†‡]+/g;

/**
 * One cell's value: { value } a number (Indian digit grouping read; a trailing footnote mark
 * ignored), { missing: true } for "-", "NA", "..", { value: 0, nil: true } for "-" when the table's
 * legend says "-: Nil" (dashIsNil) or the cell says "Nil", { invalid: true } for anything else.
 */
export function parseHandbookValue(text, { dashIsNil = false } = {}) {
  const t = String(text ?? '').replace(/\s+/g, '').replace(FOOTNOTE_MARKS, '').replace(/^[–−]/, '-');
  if (/^[-–—]$/.test(t)) return dashIsNil ? { value: 0, nil: true } : { missing: true };
  // "." is "Not Applicable", ".." and "NA" not available.
  if (!t || /^(na|n\.a\.?|\.{1,2}|…|-+na-*)$/i.test(t)) return { missing: true };
  if (/^nil$/i.test(t)) return { value: 0, nil: true };
  if (/^-?(\d[\d,]*(\.\d+)?|\.\d+)$/.test(t)) {
    const n = Number(t.replace(/,/g, ''));
    if (Number.isFinite(n)) return { value: Object.is(n, -0) ? 0 : n };
  }
  return { invalid: true };
}

const YEAR = /\b((?:19|20)\d{2})(?:\s*[-–]\s*(\d{2,4}))?\b/;
const ESTIMATES = {
  A: 'Actual', RE: 'Revised Estimates', BE: 'Budget Estimates', P: 'Provisional', PE: 'Provisional Estimates',
  AE: 'Advance Estimates', Q: 'Quick Estimates', QE: 'Quick Estimates', FRE: 'First Revised Estimates',
  SRE: 'Second Revised Estimates', TRE: 'Third Revised Estimates',
};
const ESTIMATE = /\(\s*(A|RE|BE|P|PE|AE|Q|QE|FRE|SRE|TRE)\s*\)/;

/**
 * A header cell as a period: { year, label, estimate? } when it is a year with at most a short
 * word or two around it ("2022-23 (A)", "NFHS-4 (2015-16)", "As on March 31, 2024"), else null. A
 * price base ("Base: 2011-12") is not a period.
 */
export function periodOf(text) {
  const s = String(text ?? '').trim();
  if (!s || /^base\b/i.test(s)) return null;
  const m = YEAR.exec(s);
  if (!m) return null;
  const rest = s.replace(m[0], '').replace(ESTIMATE, '').replace(/[()*#@^$:,.\s–-]/g, '');
  if (rest.length > 12) return null;
  const year = m[2] ? `${m[1]}-${m[2]}` : m[1];
  const est = ESTIMATE.exec(s);
  return { year, label: s, ...(est ? { estimate: ESTIMATES[est[1]] } : {}) };
}

const clean = (text) => String(text ?? '').replace(FOOTNOTE_MARKS, '').replace(/\s+/g, ' ').replace(/\s+([),.])/g, '$1').trim();

/** The table's title without "State-wise", and its price basis ("Current prices"), if any. */
export function indicatorBase(title) {
  let base = String(title ?? '').replace(/^\s*table\s*\d+\s*:\s*/i, '').replace(/^state-?\s*wise\s+/i, '').trim();
  let prices = '';
  base = base.replace(/\s*\(\s*(current|constant)\s+prices\s*\)/i, (_w, kind) => {
    prices = `${kind[0].toUpperCase()}${kind.slice(1).toLowerCase()} prices`;
    return '';
  });
  return { base: clean(base), prices };
}

/** A grid row is a banner when every slot is the one cell (a title, a unit, a note across the table). */
function bannerText(row) {
  const ids = new Set(row.filter(Boolean).map((s) => s.id));
  return ids.size === 1 ? row.find(Boolean).text : null;
}

// Words that make a bracketed line a unit ("(₹ Lakh)", "(Per Thousand)", "(In Billion Cubic Meter)").
const UNIT_WORDS = /₹|\brs\.?(?=\s|$)|lakh|crore|\bper\b|percent|%|\bnumber|\bnos?\b\.?|thousand|'000|million|billion|tonnes?|\btons?\b|hectare|\bha\b|\bkm|kilomet|\bmw\b|megawatt|\bmu\b|million units|gwh|kwh|\bkg\b|kilogram|litre|\bdays?\b|\byears?\b|bales|quintal|cubic|\bbcm\b|\bmt\b|rupees|in units|index|score|ratio/i;
const bracketed = (text) => /^\(.*\)$/.test(String(text ?? '').trim()) && String(text).length < 100;
const unbracket = (text) => String(text ?? '').trim().replace(/^\((.*)\)$/, '$1').trim();
const isUnit = (text) => bracketed(text) && UNIT_WORDS.test(text);
// A column-number row under the headings ("1 | 2 | … | 13= (7 to 12)") is not a heading.
const isColumnNumber = (text) => /^\d{1,2}(\s*=.*)?$/.test(String(text ?? '').trim());
// A short code under a heading ("[R]", "[S-P]") names the column for the table's own sums; it is not a category.
const isColumnCode = (text) => /^\[[^\]]{1,12}\]$/.test(String(text ?? '').trim());
// A footnote number stuck to a heading's word ("Doctors3", "Required1").
const unfoot = (text) => String(text ?? '').replace(/(?<=[A-Za-z]{3})\d(?=[\s,;:]|$)/g, '');

function stateOf(label) {
  const text = String(label ?? '').trim();
  if (!text) return null;
  return handbookState(text.replace(FOOTNOTE_MARKS, ''));
}

/** Rows that look like data: a label and at least one value cell that is a number or a dash. */
function looksLikeData(row) {
  const values = row.slice(1).filter(Boolean).map((s) => s.text);
  return values.length > 0 && values.some((v) => !parseHandbookValue(v).invalid);
}

const CONTINUED = /\((?:concld|contd)\.?\)/gi;

/**
 * What a block's title line adds to the page title: its year ("… – 2023-24", "…, 2019-20") and any
 * bracketed category the page title does not have ("(Contd.) (Rural Female)").
 */
function titleBannerParts(banner, pageTitle) {
  const t = String(banner ?? '').replace(/^\s*table\s*\d+\s*:\s*/i, '');
  const page = String(pageTitle ?? '').toLowerCase();
  const categories = [...t.matchAll(/\(([^()]+)\)/g)]
    .map((m) => m[1].trim())
    .filter((c) => !/^(concld|contd)\.?$/i.test(c) && !page.includes(`(${c.toLowerCase()})`) && !periodOf(c) && !UNIT_WORDS.test(`(${c})`) && !/^(current|constant) prices$/i.test(c));
  const plain = t.replace(CONTINUED, '').replace(/\([^()]*\)\s*$/g, (m) => (categories.includes(m.slice(1, -1).trim()) ? '' : m)).trim();
  const m = /[-–:,\s]\s*((?:19|20)\d{2}(?:\s*[-–]\s*\d{2,4})?)\s*$/.exec(plain);
  return { period: m ? periodOf(m[1]) : null, categories };
}

/** The legend and source under a table, from its note rows: { notes, source, dashIsNil }. */
function readNotes(texts) {
  const notes = [...new Set(texts.map((t) => t.trim()).filter(Boolean))].join(' ');
  const source = /\bSources?\s*:\s*(.+)$/i.exec(notes)?.[1]?.trim() || '';
  const dashIsNil = /(^|[\s.])[-–]\s*:\s*Nil\b/i.test(notes);
  return { notes, source, dashIsNil };
}

/** A year in brackets inside a heading ("Annual Ground Water Extraction (2017)"), taken out of it. */
function bracketYear(part) {
  const m = /\(\s*((?:19|20)\d{2}(?:\s*[-–]\s*\d{2,4})?)\s*\)/.exec(part);
  if (!m) return null;
  return { period: periodOf(m[1]), rest: clean(part.replace(m[0], ' ')) };
}

/**
 * Parse one handbook table page. meta: { tableNo, title (default: the listing's), url (default: the
 * edition's page), edition }. Returns { table: { no, title, published, unit, notes, source, url },
 * records, dropped: { no_year, missing, invalid, unmapped_state, duplicate }, unmapped: [labels], error? }.
 *
 * Banner lines above a block: the block's title (its year and any category such as "(Rural Female)"),
 * a unit ("(₹ Crore)"), a date that stands for the whole table ("(As on 31 March 2024)", used for any
 * block or column without a year of its own), or a category ("(Rural Male)") added to the indicator.
 * Headings: a year (or a year in brackets inside a heading) is the column's year; "Base: 2011-12" is the
 * price basis; a bracketed unit under a heading is that column's unit (and is added to the indicator
 * when two columns would otherwise share a name); column numbers are skipped; the rest are categories.
 */
export function parseHandbookTable(html, meta = {}) {
  const known = HANDBOOK_TABLES.get(Number(meta.tableNo));
  const pageTitle = /class=["']?tableheader["']?[^>]*>\s*<b>\s*(Table\s*\d+\s*:[^<]+)</i.exec(String(html ?? ''))?.[1];
  const titleText = clean(cellText(pageTitle || '')).replace(/^table\s*\d+\s*:\s*/i, '') || meta.title || known?.title || '';
  const published = isoFromRbiDate(/Date\s*:\s*([A-Za-z]{3,9}\.?\s+\d{1,2},\s*\d{4})/.exec(String(html ?? ''))?.[1]) || '';
  const no = Number(meta.tableNo) || Number(/Table\s*(\d+)\s*:/i.exec(pageTitle || '')?.[1]) || null;
  const url = meta.url || known?.url || '';
  const edition = meta.edition || HANDBOOK.edition;
  const dropped = { no_year: 0, missing: 0, invalid: 0, unmapped_state: 0, duplicate: 0 };
  const unmapped = new Set();

  const grids = extractTables(html).map(gridOf).filter((grid) => grid.filter((row) => stateOf(row[0]?.text)).length >= 2);
  const noteTexts = [];
  let tablePeriod = null;
  const blocks = grids.map((grid) => {
    const banners = [];
    let firstData = grid.findIndex((row) => stateOf(row[0]?.text) && looksLikeData(row));
    if (firstData < 0) firstData = grid.length;
    const header = [];
    grid.forEach((row, r) => {
      const banner = bannerText(row);
      if (r < firstData) {
        if (banner != null) banners.push(banner);
        else header.push(row);
      } else if (banner != null) noteTexts.push(banner);
    });
    for (const b of banners) if (!tablePeriod && bracketed(b) && periodOf(unbracket(b))) tablePeriod = periodOf(unbracket(b));
    return { grid, firstData, header, banners };
  });
  // The legend decides what "-" means for every block.
  const { notes, source, dashIsNil } = readNotes(noteTexts);
  const { base, prices } = indicatorBase(titleText);
  let unit = '';
  const records = [];
  const held = new Map();

  for (const block of blocks) {
    const title = block.banners.find((b) => /^table\s*\d+/i.test(b)) || '';
    block.titled = titleBannerParts(title, titleText);
    block.continues = /\((?:concld|contd)\.?\)/i.test(title);
  }
  // A block without a title takes the year of the block that continues it ("TABLE 176: … - 2005 (Concld.)").
  blocks.forEach((block, i) => {
    const next = blocks[i + 1];
    if (!block.titled.period && next?.continues && next.titled.period) block.titled.period = next.titled.period;
  });

  for (const { grid, firstData, header, banners, titled } of blocks) {
    const unitBanner = banners.find(isUnit);
    const blockUnit = unitBanner ? unbracket(unitBanner) : unit;
    if (!unit && blockUnit) unit = blockUnit;
    const blockCategories = [
      ...banners.filter((b) => bracketed(b) && !isUnit(b) && !periodOf(unbracket(b)) && !/^as (on|at)\b/i.test(unbracket(b))).map(unbracket),
      ...titled.categories,
    ];
    const width = grid[0]?.length || 0;
    const columns = [];
    for (let c = 1; c < width; c += 1) {
      const parts = [];
      let last = null;
      for (const row of header) {
        const slot = row[c];
        if (!slot || slot.id === row[0]?.id || slot.id === last) continue;
        last = slot.id;
        if (slot.text && !isColumnNumber(slot.text) && !isColumnCode(slot.text)) parts.push(unfoot(slot.text));
      }
      let period = null;
      let basis = '';
      let colUnit = '';
      const named = [];
      for (const part of parts) {
        if (/^base\s*:?/i.test(part)) basis = `base ${part.replace(/^base\s*:?\s*/i, '').trim()}`;
        else if (!period && periodOf(part)) period = periodOf(part);
        else if (isUnit(part)) colUnit = unbracket(part);
        else named.push(part);
      }
      if (!period) {
        for (const [i, part] of named.entries()) {
          const inside = bracketYear(part);
          if (inside?.period) {
            period = inside.period;
            named[i] = inside.rest;
            break;
          }
        }
      }
      period = period || titled.period || tablePeriod;
      const priceBasis = [prices, basis].filter(Boolean).join(', ');
      columns.push({ c, period, unit: colUnit || blockUnit, ownUnit: Boolean(colUnit), indicator: [base, ...blockCategories, ...named].map(clean).filter(Boolean).join(' · '), priceBasis });
    }
    // Two columns of one year that share a name but not a unit ("Surplus (+) / Deficit (-)" in
    // Megawatt and in per cent) are told apart by their unit.
    const byName = new Map();
    for (const col of columns) byName.set(`${col.indicator}\u0000${col.period?.year}`, [...(byName.get(`${col.indicator}\u0000${col.period?.year}`) || []), col]);
    for (const same of byName.values()) {
      if (same.length > 1 && new Set(same.map((c) => c.unit)).size > 1) for (const col of same) if (col.ownUnit) col.indicator = `${col.indicator} (${col.unit})`;
    }

    for (let r = firstData; r < grid.length; r += 1) {
      const row = grid[r];
      if (bannerText(row) != null || !row[0]) continue;
      const label = row[0].text;
      if (!looksLikeData(row)) continue;
      const who = stateOf(label);
      if (!who) {
        dropped.unmapped_state += columns.length;
        unmapped.add(label);
        continue;
      }
      for (const col of columns) {
        const slot = row[col.c];
        if (!slot) continue;
        if (!col.period) {
          dropped.no_year += 1;
          continue;
        }
        const v = parseHandbookValue(slot.text, { dashIsNil });
        if (v.missing) {
          dropped.missing += 1;
          continue;
        }
        if (v.invalid) {
          dropped.invalid += 1;
          continue;
        }
        const rec = {
          state: who.state,
          indicator: col.indicator,
          year: col.period.year,
          value: v.value,
          unit: col.unit,
          table_no: no,
          table_title: titleText,
          source_url: url,
          as_of: published || meta.published || '',
          edition,
          title: `${who.state} · ${col.indicator} · ${col.period.year}`,
        };
        if (col.priceBasis) rec.price_basis = col.priceBasis;
        if (col.period.label !== col.period.year) rec.year_label = col.period.label;
        if (col.period.estimate) rec.estimate = col.period.estimate;
        if (who.aggregate) rec.aggregate = true;
        if (label !== who.state) rec.state_label = label;
        if (v.nil) rec.nil = true;
        // One record per state, indicator and year. A later row's figure replaces an earlier "Nil" (a
        // state listed twice, once before and once after a change of status); otherwise the first stays.
        const key = `${who.state}\u0000${col.indicator}\u0000${col.period.year}`;
        const before = held.get(key);
        dropped.duplicate += before ? 1 : 0;
        if (before && !(before.rec.nil && !rec.nil)) continue;
        if (before) before.rec = rec;
        else {
          const entry = { rec, order: records.length };
          held.set(key, entry);
          records.push(entry);
        }
      }
    }
  }
  // Newest year first; within a year, the table's own order.
  const sorted = records
    .sort((a, b) => b.rec.year.localeCompare(a.rec.year) || a.order - b.order)
    .map((x) => x.rec);
  const out = {
    table: { no, title: titleText, published, unit, notes, source, url },
    records: sorted,
    dropped,
    unmapped: [...unmapped],
  };
  if (!grids.length) out.error = 'no state-wise table on the page';
  return out;
}

/**
 * F201: a table's records in blocks of whole years, newest first, each of at most `max` records (one
 * store variant). Returns [{ from: its oldest year, through: its newest, years: newest first, count,
 * records: in their input order }]. A table of `max` records or fewer is one block. A year is never
 * split: one year alone over `max` throws a RangeError (nothing is cut).
 */
export function yearBlocks(records, max = HANDBOOK_BLOCK_MAX) {
  const list = records || [];
  const counts = new Map();
  for (const r of list) counts.set(r.year, (counts.get(r.year) || 0) + 1);
  const blocks = [];
  let current = null;
  for (const year of [...counts.keys()].sort((a, b) => String(b).localeCompare(String(a)))) {
    const n = counts.get(year);
    if (n > max) throw new RangeError(`${year}: ${n} figures in one year, over the ${max} one block holds`);
    if (!current || current.count + n > max) {
      current = { years: [], count: 0 };
      blocks.push(current);
    }
    current.years.push(year);
    current.count += n;
  }
  return blocks.map(({ years, count }) => {
    const held = new Set(years);
    return { from: years.at(-1), through: years[0], years, count, records: list.filter((r) => held.has(r.year)) };
  });
}

/**
 * F201: yearBlocks' blocks as the stored view lists them (meta.blocks): [{ value, variant, from,
 * through, count }]. The newest block is the table's own variant ("176", value '': no `years` asked);
 * each older one is "<table>@<its oldest year>" ("176@2005", value its oldest year).
 */
export function blockList(no, blocks) {
  return (blocks || []).map((b, i) => {
    const value = i ? b.from : '';
    return { value, variant: handbookVariant(no, value), from: b.from, through: b.through, count: b.count };
  });
}

/** The status line of every handbook module's answer. */
export const HANDBOOK_STATUS = 'RBI HANDBOOK · STATE LEVEL';

/**
 * F201: the `meta` of a handbook module's answer for block `index` of table `no` (the loader stores it as
 * meta.view; the live path answers it): { heading, table, block: { from, through }, blocks: blockList,
 * years: every year of the table, newest first, as_of, status }.
 */
export function handbookView(no, blocks, index, asOf = HANDBOOK.published) {
  const b = blocks[index];
  return {
    heading: handbookTableLabel(no),
    table: Number(no),
    block: { from: b.from, through: b.through },
    blocks: blockList(no, blocks),
    years: blocks.flatMap((x) => x.years),
    as_of: asOf || HANDBOOK.published,
    status: HANDBOOK_STATUS,
  };
}

/**
 * F201: what a handbook answer holds, for its note: "all 455 figures, 2011-12 to 2024-25" for a table in
 * one block, else "years 2023 to 2025, 1,824 of the table's 12,565 figures; older years are under the
 * Years control" (other years for an older block).
 */
export function handbookHeld(view, shown) {
  const blocks = view?.blocks || [];
  const n = (x) => Number(x).toLocaleString('en-IN');
  const { from, through } = view.block;
  const span = from === through ? from : `${from} to ${through}`;
  if (blocks.length <= 1) return `all ${n(shown)} figures, ${span}`;
  const total = blocks.reduce((sum, b) => sum + Number(b.count || 0), 0);
  const newest = blocks[0].from === from;
  return `${from === through ? 'year' : 'years'} ${span}, ${n(shown)} of the table's ${n(total)} figures; ${newest ? 'older' : 'other'} years are under the Years control`;
}

/**
 * The publication listing (AnnualPublications.aspx?head=Handbook…): { published, tables: [{ no, id,
 * title }] }. published is the first date heading on the page (the latest edition comes first).
 */
export function parseHandbookListing(html) {
  const text = String(html ?? '');
  const published = isoFromRbiDate(/class=["']?tableheader["']?[^>]*>\s*<b>\s*([A-Za-z]{3,9}\.?\s+\d{1,2},\s*\d{4})/i.exec(text)?.[1]) || '';
  const tables = [];
  for (const m of text.matchAll(/PublicationsView\.aspx\?id=(\d+)["']?>([^<]*)<\/a>/gi)) {
    const t = clean(cellText(m[2]));
    const n = /^Table\s*(\d+)\s*:\s*(.+)$/i.exec(t);
    if (n) tables.push({ no: Number(n[1]), id: Number(m[1]), title: n[2].trim() });
  }
  return { published, tables };
}
