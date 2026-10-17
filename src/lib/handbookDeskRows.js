/**
 * F201 T9b: the RBI Handbook register (scripts/fetch-rbi-handbook.mjs's JSON, every figure of every
 * table) as `desk_rows` inserts, so the AI's structured search (search_desk_rows) finds a figure by its
 * fields and by a date range. scripts/load-desk-rows.mjs --handbook <file> loads them; nothing here
 * reads a file or the network.
 *
 * One entry per handbook module (src/lib/rbiHandbookTables.js HANDBOOK_MODULES), on the State desk,
 * with a row for each figure of the module's tables: a table two modules hold is a row of each, as on
 * the page. A row holds the figure's own fields (state, indicator, year, value, unit, table_no,
 * table_title, as_of, source_url and the handbook's qualifiers), a `date` and its `period`.
 *
 * The stored date is a stable anchor. Since handbook_period_ranges, date-range searches
 * over hb:t keys use year/period interval overlap, without reloading any rows. Other
 * modules still read `date`, compared at its own
 * precision: public.desk_row_date_in. The anchors remain:
 *   - a calendar year ("2005") is that year, "2005": in any range that overlaps 2005;
 *   - a financial year ("2019-20", "1999-00", "2019-2020") is its first day, "2019-04-01": in a range
 *     that holds 1 April 2019, so the range 2019-04-01 to 2020-03-31 finds 2019-20 and no other year;
 *   - a period of more than one year ("1993-97", "2019-21": averages and survey rounds) is its first
 *     year, "1993": in a range that overlaps that year.
 * `period` says which of the three it is. Without an explicit date, flattenRow would take the year
 * itself as the date and desk_row_date would read "2019-20" as the month 20 of 2019.
 *
 * Each figure's row_key is "hb:t<table>:" and an FNV-1a hash of its state, indicator and year: stable
 * across loads and editions, unique per table, and short (rowPinKey keeps 160 characters, and an
 * indicator alone can be longer). It is never in the record text the model reads.
 */
import { fnv1a64, toDeskRow } from './deskRows.js';
import { HANDBOOK, HANDBOOK_MODULES } from './rbiHandbookTables.js';

/** A row's fields, in this order, when the record has them (the stored register's, without its title). */
export const HANDBOOK_DESK_FIELDS = Object.freeze([
  'state',
  'indicator',
  'year',
  'value',
  'unit',
  'price_basis',
  'estimate',
  'year_label',
  'state_label',
  'aggregate',
  'nil',
  'table_no',
  'table_title',
  'as_of',
  'edition',
  'source_url',
]);

/**
 * A handbook year as { date, period } (see the header), or null when it is not one: "2005", "2019-20",
 * "2019-2020", "1993-97", "1996-2000". A span must end 1 to 10 years after it starts.
 */
export function handbookYearDate(year) {
  const m = /^((?:19|20)\d{2})(?:-(\d{2}|\d{4}))?$/.exec(String(year ?? '').trim());
  if (!m) return null;
  const start = Number(m[1]);
  if (m[2] === undefined) return { date: m[1], period: 'calendar year' };
  const tail = Number(m[2]);
  const end = m[2].length === 4 ? tail : start - (start % 100) + tail + (tail <= start % 100 ? 100 : 0);
  if (end <= start || end > start + 10) return null;
  if (end === start + 1) return { date: `${m[1]}-04-01`, period: 'financial year' };
  return { date: m[1], period: 'period of years' };
}

const isFigure = (r) => Boolean(r?.state && r.indicator && r.year)
  && typeof r.value === 'number' && Number.isFinite(r.value)
  && /^https:\/\/www\.rbi\.org\.in\//.test(String(r.source_url || ''));

/** One figure as the row the desk keeps: its fields, a title, its key, its date and period. */
function deskRaw(r) {
  const raw = {
    id: `hb:t${Number(r.table_no)}:${fnv1a64(`${r.state}|${r.indicator}|${r.year}`)}`,
    title: r.title || `${r.state} · ${r.indicator} · ${r.year}`,
  };
  for (const k of HANDBOOK_DESK_FIELDS) if (r[k] !== undefined && r[k] !== null && r[k] !== '') raw[k] = r[k];
  raw.table_no = Number(r.table_no);
  const when = handbookYearDate(r.year);
  if (when) Object.assign(raw, when);
  return raw;
}

/**
 * The register as desk_rows, per module: [{ id, tier, feature, rows, dropped: { bad_record }, undated,
 * collisions }]. `only` limits it to the named features. snapshot_at is the edition's publication date.
 */
export function handbookDeskRows(register, { modules = HANDBOOK_MODULES, only = null } = {}) {
  const published = String(register?.published || HANDBOOK.published);
  const snapshotAt = new Date(`${published.slice(0, 10)}T00:00:00.000Z`).toISOString();
  const records = Array.isArray(register?.records) ? register.records : [];
  const out = [];
  for (const [id, spec] of Object.entries(modules)) {
    const [tier, feature] = id.split(/:(.*)/s);
    if (only && !only.includes(feature)) continue;
    const tables = new Set(spec.tables);
    const byKey = new Map();
    const collisions = [];
    let bad = 0;
    let undated = 0;
    for (const r of records) {
      if (!tables.has(Number(r?.table_no))) continue;
      if (!isFigure(r)) {
        bad += 1;
        continue;
      }
      const raw = deskRaw(r);
      if (!raw.date) undated += 1;
      const row = toDeskRow({ tier, feature, raw, snapshotAt });
      if (byKey.has(row.row_key)) collisions.push(row.row_key);
      byKey.set(row.row_key, row);
    }
    out.push({ id, tier, feature, rows: [...byKey.values()], dropped: bad ? { bad_record: bad } : {}, undated, collisions, snapshotAt });
  }
  return out;
}
