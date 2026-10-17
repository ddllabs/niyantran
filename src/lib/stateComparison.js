/**
 * F196: Cross-State Comparison Engine. One handbook table (src/lib/rbiHandbookTables.js), every state
 * side by side: for each of the table's indicators, the states' figures for one year, ranked, with
 * the year before for comparison.
 *
 * compareStates(records, { year }) takes the table's long-form records (src/lib/rbiHandbook.js) and
 * returns one row per indicator and state:
 *   { rank, of, state, indicator, year, value, unit, previous_year?, previous_value?, change_pct?,
 *     price_basis?, estimate?, aggregate?, table_no, table_title, source_url, as_of, edition, title }
 * - year: the exact year asked for, else the indicator's latest year with figures.
 * - rank: 1 is the highest value among the states and union territories with a figure that year (`of`
 *   of them); ties share a rank. The all-India row is shown under its states, unranked. A rank says
 *   which figure is larger, not which is better: for a deficit or a death rate, 1 is the largest.
 * - previous_year: the immediately preceding calendar/financial period, when the state has a figure;
 *   change_pct the change from it, when both are numbers and the earlier one is not 0.
 * Rows come by indicator in the table's order, then by rank.
 */

const COPIED = ['unit', 'price_basis', 'estimate', 'year_label', 'state_label', 'table_no', 'table_title', 'source_url', 'as_of', 'edition'];

/**
 * The years a table's records cover, newest first. Pass whole years only (wholeYearsOf for a stored
 * page that may be short of its table): every year listed is then one with all of its figures.
 */
export function comparisonYears(records) {
  return [...new Set((records || []).map((r) => r.year).filter(Boolean))].sort((a, b) => b.localeCompare(a));
}

/**
 * A stored table's first page as whole years. The page holds the table's figures newest year first; when
 * it holds fewer than the table's `total`, its oldest year may have been cut, so that year is left out.
 * (A table loaded by scripts/fetch-rbi-handbook.mjs fits one page; this covers one loaded before that.)
 */
export function wholeYearsOf(records, total) {
  const list = records || [];
  if (!(Number(total) > list.length)) return list;
  const oldest = comparisonYears(list).at(-1);
  return list.filter((r) => r.year !== oldest);
}

/**
 * At most `max` of compareStates' rows, whole indicators only (each indicator's ranking is complete):
 * { rows, indicators: how many are shown, of: how many there are }.
 */
export function rankedWithin(rows, max) {
  const groups = [];
  for (const r of rows || []) {
    if (groups.at(-1)?.indicator !== r.indicator) groups.push({ indicator: r.indicator, rows: [] });
    groups.at(-1).rows.push(r);
  }
  const shown = [];
  let indicators = 0;
  for (const g of groups) {
    if (shown.length + g.rows.length > max) break;
    shown.push(...g.rows);
    indicators += 1;
  }
  return { rows: shown, indicators, of: groups.length };
}

export function compareStates(records, { year = '' } = {}) {
  const byIndicator = new Map();
  for (const r of records || []) {
    if (!r || typeof r.value !== 'number' || !Number.isFinite(r.value) || !r.indicator || !r.year || !r.state) continue;
    if (!byIndicator.has(r.indicator)) byIndicator.set(r.indicator, []);
    byIndicator.get(r.indicator).push(r);
  }
  const rows = [];
  for (const [indicator, list] of byIndicator) {
    const years = comparisonYears(list);
    const chosen = year || years[0];
    const current = list.filter((r) => r.year === chosen);
    const states = current.filter((r) => !r.aggregate).sort((a, b) => b.value - a.value || a.state.localeCompare(b.state, 'en'));
    const m = /^(\d{4})(?:-(\d{2}))?$/.exec(chosen);
    const previous = m ? `${Number(m[1]) - 1}${m[2] ? `-${String(Number(m[1]) % 100).padStart(2, '0')}` : ''}` : '';
    const previousOf = state => list.find(r => r.state === state && r.year === previous);
    let rank = 0;
    let last = null;
    const ranked = states.map((r, i) => {
      if (r.value !== last) rank = i + 1;
      last = r.value;
      return { r, rank };
    });
    const all = [...ranked, ...current.filter((r) => r.aggregate).map((r) => ({ r, rank: null }))];
    for (const { r, rank: place } of all) {
      const prev = previousOf(r.state);
      const row = {
        ...(place != null ? { rank: place, of: states.length } : {}),
        state: r.state,
        indicator,
        year: chosen,
        value: r.value,
      };
      for (const k of COPIED) if (r[k] !== undefined && r[k] !== '') row[k] = r[k];
      if (r.aggregate) row.aggregate = true;
      if (prev) {
        row.previous_year = prev.year;
        row.previous_value = prev.value;
        if (prev.value !== 0) row.change_pct = Math.round(((r.value - prev.value) / Math.abs(prev.value)) * 1000) / 10;
      }
      if (!prev) row.previous_status = 'Previous period unavailable';
      row.title = `${r.state} · ${indicator} · ${chosen}`;
      rows.push(row);
    }
    // The selected period never borrows a figure from a different year. Historical
    // rows establish which states/indicators are known, not their missing values.
    if (year) {
      const present = new Set(current.map(r => r.state));
      const known = new Map(list.map(r => [r.state, r]));
      for (const [state, sample] of known) if (!present.has(state)) {
        const gap = { state, indicator, year, value: null, data_status: 'No figure for selected year',
          title: `${state} · ${indicator} · ${year} · No figure for selected year` };
        for (const k of ['unit','table_no','table_title','source_url','as_of','edition']) if (sample[k] !== undefined) gap[k] = sample[k];
        rows.push(gap);
      }
    }
  }
  return rows;
}

/**
 * F201 review: a year the Cross-State Comparison Engine ranks by, as the handbook writes one: "YYYY" or
 * "YYYY-YY" with YY the next year, from 1990 to next year. The server reads `year` with it and the Year
 * control offers only such years, so the control never shows a year the answer was not ranked for.
 */
export function isComparisonYear(value, now = new Date()) {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!m) return false;
  const y = Number(m[1]);
  if (y < 1990 || y > now.getFullYear() + 1) return false;
  return m[2] === undefined || Number(m[2]) === (y + 1) % 100;
}
