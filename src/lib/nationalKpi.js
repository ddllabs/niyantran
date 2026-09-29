import { DELIM_STATES, FLAGSHIP_PROGRAMMES, LS18_PROFILE, LS18_SEATS, BUDGET_SCHEMES, UNION_PROMISES } from '../data/nationalCurated.js';
import { pigClassify, pigStagePassed } from './pigModel.js';

export function dataRows(rows) {
  return (rows || []).filter((r) => r && r.status !== 'source_status');
}

function val(row, key) {
  if (!key) return '';
  const v = row[key];
  if (v == null) return '';
  return String(v).trim();
}

function toNum(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

export function parseINR(s) {
  const head = String(s == null ? '' : s).split('~')[0];
  const d = head.replace(/[^0-9]/g, '');
  return d ? parseInt(d, 10) : 0;
}

function yearOf(v) {
  const m = String(v == null ? '' : v).match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

function pct(a, b) {
  return b ? Math.round((a / b) * 100) : 0;
}

function fmtCr(n) {
  if (n == null) return '-';
  if (n >= 1e7) return `${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1)} Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} L`;
  return n.toLocaleString('en-IN');
}

function countBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const v = val(r, key);
    if (!v) continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

function countByFn(rows, fn) {
  const m = new Map();
  for (const r of rows) {
    const v = fn(r);
    if (v == null || v === '') continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

function topPairs(map, n = 8) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function minYear(rows, key) {
  let lo = null;
  for (const r of rows) {
    const y = yearOf(r[key]);
    if (y != null && (lo == null || y < lo)) lo = y;
  }
  return lo;
}

function maxYear(rows, key) {
  let hi = null;
  for (const r of rows) {
    const y = yearOf(r[key]);
    if (y != null && (hi == null || y > hi)) hi = y;
  }
  return hi;
}

function bars(pairs, { total, pctMode, filterCol, fmt } = {}) {
  const max = Math.max(1, ...pairs.map((p) => p[1]));
  return pairs.map(([label, value]) => ({
    label,
    value,
    display: fmt
      ? fmt(value)
      : pctMode
        ? `${value}%`
        : total
          ? `${value.toLocaleString('en-IN')} · ${pct(value, total)}%`
          : value.toLocaleString('en-IN'),
    tone: 'gradient',
    filterCol,
    filterValue: label,
  }));
}

export function crimBand(row) {
  const n = toNum(row?.criminal_cases) || 0;
  return n === 0 ? '0 (clean)' : n <= 2 ? '1-2' : n <= 5 ? '3-5' : '6+';
}

export function assetBand(row) {
  const v = parseINR(row?.total_assets);
  return v < 1e7 ? '< ₹1 Cr' : v < 5e7 ? '₹1-5 Cr' : v < 25e7 ? '₹5-25 Cr' : '₹25 Cr+';
}

export function questionBand(row) {
  const q = toNum(row?.questions_asked);
  if (q == null) return '';
  return q === 0 ? '0' : q <= 50 ? '1-50' : q <= 150 ? '51-150' : q <= 300 ? '151-300' : '300+';
}

export function deadlineLabel(row) {
  const d = parseDeadline(row?.deadline);
  return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
}

function intensityBucket(raw) {
  const s = String(raw || '').toLowerCase();
  if (/critic/.test(s)) return 'Critical';
  if (/\bhigh\b/.test(s)) return 'High';
  if (/medium|moderat/.test(s)) return 'Medium';
  if (/\blow\b|calm|minor/.test(s)) return 'Low';
  return '';
}

function trendBucket(raw) {
  const s = String(raw || '').toLowerCase();
  if (/escalat/.test(s)) return 'Escalating';
  if (/eas(e|ing)|de-?escalat|improving/.test(s)) return 'Easing';
  if (/stable|unchanged|static/.test(s)) return 'Stable';
  return raw ? String(raw) : '';
}

function decadeBucket(raw) {
  const yr = Number(raw);
  if (!Number.isFinite(yr) || yr < 1000) return 'Unknown';
  return `${Math.floor(yr / 10) * 10}s`;
}

function sizeBandOf(electors) {
  const e = Number(electors) || 0;
  if (e < 300) return 'under 300';
  if (e < 600) return '300-600';
  if (e < 900) return '600-900';
  if (e < 1200) return '900-1200';
  return '1200+';
}

export function vizFilterList(f) {
  if (!f) return [];
  if (Array.isArray(f)) return f.filter((x) => x && x.col);
  if (f.col) return [f];
  return [];
}

export function vizFilterOn(active, col, value, map) {
  const want = String(value ?? '');
  const wantMap = String(map || '');
  return vizFilterList(active).some(
    (x) => x.col === col && String(x.value) === want && String(x.map || '') === wantMap,
  );
}

function applyOneVizFilter(row, f) {
  if (!f?.col || !row) return true;
  if (f.col === '_crim_band') return crimBand(row) === f.value;
  if (f.col === '_asset_band') return assetBand(row) === f.value;
  if (f.col === '_q_band') return questionBand(row) === f.value;
  if (f.col === '_deadline_label') return deadlineLabel(row) === f.value;
  const want = String(f.value ?? '').trim();
  if (f.map === 'intensity') return intensityBucket(row[f.col]) === want;
  if (f.map === 'trend') return trendBucket(row[f.col]) === want;
  if (f.map === 'decade') return decadeBucket(row[f.col]) === want;
  if (f.col === 'sizeBand') {
    const band = String(row.sizeBand || sizeBandOf(row.electors)).trim();
    return band === want;
  }
  const v = String(row[f.col] ?? '').trim();
  if (f.values?.length) return f.values.map(String).includes(v);
  return v === want;
}

export function applyVizFilter(row, f) {
  const list = vizFilterList(f);
  if (!list.length || !row) return true;
  const groups = new Map();
  for (const clause of list) {
    const k = `${clause.col}|${clause.map || ''}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(clause);
  }
  for (const clauses of groups.values()) {
    if (!clauses.some((c) => applyOneVizFilter(row, c))) return false;
  }
  return true;
}

function sparkLast(rows, key, last, title) {
  const counts = new Map();
  for (const r of rows) {
    const y = yearOf(r[key]);
    if (y) counts.set(y, (counts.get(y) || 0) + 1);
  }
  if (!counts.size) return null;
  const maxY = Math.max(...counts.keys());
  const from = Math.max(Math.min(...counts.keys()), maxY - (last - 1));
  const series = [];
  for (let y = from; y <= maxY; y++) series.push({ year: y, n: counts.get(y) || 0 });
  const peak = series.reduce((a, b) => (b.n > a.n ? b : a), series[0]);
  return {
    type: 'spark',
    title,
    series,
    peak,
    from,
    through: maxY,
    hint: `Peak annotated at ${peak.n} in ${peak.year}.`,
  };
}

function sparkFull(rows, key, fromYear, title) {
  const counts = new Map();
  for (const r of rows) {
    const y = yearOf(r[key]);
    if (y) counts.set(y, (counts.get(y) || 0) + 1);
  }
  if (!counts.size) return null;
  const maxY = Math.max(...counts.keys());
  const from = Math.min(fromYear, Math.min(...counts.keys()));
  const series = [];
  for (let y = from; y <= maxY; y++) series.push({ year: y, n: counts.get(y) || 0 });
  const peak = series.reduce((a, b) => (b.n > a.n ? b : a), series[0]);
  return { type: 'spark', title, series, peak, from, through: maxY };
}

function crosstab(rows, rowKey, colKey, rowLimit = 10) {
  const colSet = new Set();
  const rowSet = [];
  const seen = new Set();
  const grid = new Map();
  for (const r of rows) {
    const rk = val(r, rowKey);
    const ck = val(r, colKey);
    if (!rk || !ck) continue;
    colSet.add(ck);
    if (!seen.has(rk)) {
      seen.add(rk);
      rowSet.push(rk);
    }
    const k = `${rk}\t${ck}`;
    grid.set(k, (grid.get(k) || 0) + 1);
  }
  const cols = [...colSet];
  let body = rowSet.map((rk) => {
    const cells = cols.map((ck) => grid.get(`${rk}\t${ck}`) || 0);
    return { label: rk, cells, total: cells.reduce((a, b) => a + b, 0) };
  });
  body.sort((a, b) => b.total - a.total);
  const hidden = Math.max(0, body.length - rowLimit);
  body = body.slice(0, rowLimit);
  const colTotals = cols.map((_, i) => body.reduce((s, r) => s + r.cells[i], 0));
  const grand = body.reduce((s, r) => s + r.total, 0);
  const colMax = cols.map((_, i) => Math.max(1, ...body.map((r) => r.cells[i]), colTotals[i]));
  return { cols, rows: body, colTotals, grand, colMax, hidden, sequential: true };
}

function emptyKpis(note) {
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'RECORDS', value: 0, sub: note || 'no dataset wired' },
      { label: 'STATUS', value: ' - ', sub: 'labelled absence, not a zero' },
      { label: 'CHARTS', value: ' - ', sub: 'nothing to plot' },
      { label: 'SOURCE', value: ' - ', sub: '' },
    ],
    charts: [],
    note,
  };
}

function billsViz(all) {
  const total = all.length;
  const sc = countBy(all, 'current_stage');
  const passedBoth = sc.get('Passed Both Houses') || 0;
  const introduced = sc.get('Introduced') || 0;
  const inCommittee = (sc.get('Committee Stage') || 0) + (sc.get('Report Presented') || 0);
  const passedOne = (sc.get('Passed LS') || 0) + (sc.get('Passed RS') || 0);
  const notYet = introduced + inCommittee + passedOne;
  const stageOrder = [
    ['Introduced', introduced, ['Introduced']],
    ['In Committee', inCommittee, ['Committee Stage', 'Report Presented']],
    ['Passed One House', passedOne, ['Passed LS', 'Passed RS']],
    ['Passed Both Houses', passedBoth, ['Passed Both Houses']],
  ].filter((s) => s[1] > 0);
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'BILLS TRACKED', value: total.toLocaleString('en-IN'), sub: `since ${minYear(all, 'date_introduced') || ' - '}` },
      { label: 'PASSED BOTH HOUSES', value: passedBoth.toLocaleString('en-IN'), sub: `${pct(passedBoth, total)}% of tracked`, tone: 'ok' },
      { label: 'NOT YET ENACTED', value: notYet.toLocaleString('en-IN'), sub: 'introduced → single house', tone: 'warn' },
      { label: 'POLICY SECTORS', value: String(countBy(all, 'sector').size), sub: 'distinct sectors' },
    ],
    charts: [
      {
        type: 'bars',
        title: 'Legislative status by stage',
        hint: 'Count and share of the corpus. Click a bar to cross-filter the feed.',
        items: stageOrder.map(([label, value, filterValues]) => ({
          label,
          value,
          display: `${value.toLocaleString('en-IN')} · ${pct(value, total)}%`,
          tone: 'gradient',
          filterCol: 'current_stage',
          filterValue: label,
          filterValues,
        })),
      },
      sparkLast(all, 'date_introduced', 15, 'Bills introduced per year'),
      {
        type: 'bars',
        title: 'Legislative agenda by sector',
        hint: 'Top 8 sector tags already on the bill rows. Click to cross-filter.',
        items: bars(topPairs(countBy(all, 'sector'), 8), { filterCol: 'sector' }),
      },
    ].filter(Boolean),
    note: 'Passed-per-year is not drawn: the register holds date_introduced, not a passing date.',
  };
}

function policyGraphKpis(all) {
  const total = all.length;
  const by = { Primary: { n: 0, passed: 0 }, Secondary: { n: 0, passed: 0 }, Services: { n: 0, passed: 0 } };
  const domains = new Set();
  all.forEach((r) => {
    const cls = pigClassify(r.sector);
    domains.add(cls.dom);
    by[cls.sec].n += 1;
    if (pigStagePassed(r.current_stage)) by[cls.sec].passed += 1;
  });
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'BILLS', value: total.toLocaleString('en-IN'), sub: `${domains.size} domains · live` },
      { label: 'PRIMARY', value: by.Primary.n, sub: `18% GDP · ${by.Primary.passed} passed` },
      { label: 'SECONDARY', value: by.Secondary.n, sub: `27% GDP · ${by.Secondary.passed} passed` },
      { label: 'SERVICES', value: by.Services.n, sub: `55% GDP · ${by.Services.passed} passed` },
    ],
    charts: [sparkFull(all, 'date_introduced', 1952, 'Bills introduced by year  -  1952-present')].filter(Boolean),
    note: 'Passed counts are derived from current_stage, not from a passing date. They tell you how many have passed, never when.',
  };
}

function affidavitViz(all) {
  const total = all.length;
  const withCrim = all.filter((r) => (toNum(r.criminal_cases) || 0) > 0).length;
  const crore = all.filter((r) => parseINR(r.total_assets) >= 1e7).length;
  const assetVals = all.map((r) => parseINR(r.total_assets)).filter((v) => v > 0).sort((a, b) => a - b);
  const median = assetVals.length ? assetVals[Math.floor(assetVals.length / 2)] : null;
  const crimBuckets = countByFn(all, (r) => {
    const n = toNum(r.criminal_cases) || 0;
    return n === 0 ? '0 (clean)' : n <= 2 ? '1-2' : n <= 5 ? '3-5' : '6+';
  });
  const crimPairs = ['0 (clean)', '1-2', '3-5', '6+'].map((k) => [k, crimBuckets.get(k) || 0]).filter((p) => p[1]);
  const assetBuckets = countByFn(all, (r) => {
    const v = parseINR(r.total_assets);
    return v < 1e7 ? '< ₹1 Cr' : v < 5e7 ? '₹1-5 Cr' : v < 25e7 ? '₹5-25 Cr' : '₹25 Cr+';
  });
  const assetPairs = ['< ₹1 Cr', '₹1-5 Cr', '₹5-25 Cr', '₹25 Cr+'].map((k) => [k, assetBuckets.get(k) || 0]).filter((p) => p[1]);
  const byParty = {};
  all.forEach((r) => {
    const p = (r.party || '').trim();
    if (!p) return;
    byParty[p] = byParty[p] || { n: 0, c: 0 };
    byParty[p].n += 1;
    if ((toNum(r.criminal_cases) || 0) > 0) byParty[p].c += 1;
  });
  const partyPairs = Object.entries(byParty)
    .filter(([, v]) => v.n >= 5)
    .map(([p, v]) => [p, pct(v.c, v.n)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'CANDIDATES', value: total.toLocaleString('en-IN'), sub: 'affidavits analysed' },
      { label: 'WITH CRIMINAL CASES', value: `${pct(withCrim, total)}%`, sub: `${withCrim.toLocaleString('en-IN')} candidates`, tone: 'bad' },
      { label: 'CROREPATI', value: `${pct(crore, total)}%`, sub: 'assets > ₹1 Cr', tone: 'warn' },
      { label: 'MEDIAN ASSETS', value: fmtCr(median), sub: 'declared net worth' },
    ],
    charts: [
      { type: 'bars', title: 'Criminal antecedents', items: bars(crimPairs, { filterCol: '_crim_band' }), hint: 'Buckets from criminal_cases. Click to cross-filter the register.' },
      { type: 'bars', title: 'Declared assets distribution', items: bars(assetPairs, { filterCol: '_asset_band' }), hint: 'Parsed from the pre-formatted total_assets string. Click to cross-filter.' },
      { type: 'bars', title: 'Candidates with cases, by party (%)', items: bars(partyPairs, { pctMode: true, filterCol: 'party' }), hint: 'Parties with n ≥ 5 only. Percentage, not a ranking. Click a party to filter.' },
    ],
  };
}

function questionsViz(all) {
  const minY = minYear(all, 'date');
  const maxY = new Date().getFullYear();
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'QUESTIONS', value: all.length.toLocaleString('en-IN'), sub: 'in loaded sample' },
      { label: 'MINISTRIES', value: String(countBy(all, 'ministry').size), sub: 'addressed' },
      { label: 'MEMBERS', value: String(countBy(all, 'mp_name').size), sub: 'asking questions' },
      { label: 'COVERAGE', value: `${minY || ' - '}-${maxY}`, sub: 'by date' },
    ],
    charts: [
      {
        type: 'bars',
        title: 'Scrutiny pressure by ministry',
        items: bars(topPairs(countBy(all, 'ministry'), 8), { filterCol: 'ministry' }),
        hint: 'Top 8. Click to cross-filter.',
      },
      sparkLast(all, 'date', 12, 'Questions over time'),
      {
        type: 'bars',
        title: 'By question type',
        items: bars(topPairs(countBy(all, 'question_type'), 6), { filterCol: 'question_type' }),
        hint: 'Starred vs unstarred as labelled by the source.',
      },
    ].filter(Boolean),
    note: 'Answer text is absent from every row. Volume is not the gap.',
  };
}

function regulatoryViz(all) {
  const byReg = countBy(all, 'regulator');
  const dates = all.map((r) => new Date(String(r.date))).filter((d) => !Number.isNaN(d.getTime()));
  const latest = dates.length ? new Date(Math.max(...dates)) : null;
  const last30 = latest
    ? all.filter((r) => {
        const d = new Date(String(r.date));
        return !Number.isNaN(d.getTime()) && latest - d <= 30 * 864e5;
      }).length
    : 0;
  const top = topPairs(byReg, 1);
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'ACTIONS', value: String(all.length), sub: 'notifications/orders' },
      { label: 'REGULATORS', value: String(byReg.size), sub: byReg.size === 1 ? 'RBI-only in this register' : 'tracked' },
      { label: 'LAST 30 DAYS', value: String(last30), sub: 'vs latest row, not today', tone: 'warn' },
      { label: 'MOST ACTIVE', value: top.length ? top[0][0] : ' - ', sub: top.length ? `${top[0][1]} actions` : '' },
    ],
    charts: [
      {
        type: 'bars',
        title: 'Actions by regulator',
        items: bars(topPairs(byReg, 8), { total: all.length, filterCol: 'regulator' }),
      },
      sparkLast(all, 'date', 8, 'Regulatory cadence'),
    ].filter(Boolean),
  };
}

function parseDeadline(raw) {
  const s = String(raw || '').replace(/-/g, ' ');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function tenderCloseBand(row, now = Date.now()) {
  const d = parseDeadline(row.deadline);
  if (!d) return { key: 'none', label: 'no date', tone: '' };
  const days = (d.getTime() - now) / 864e5;
  const pretty = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  if (days < 0) return { key: 'closed', label: `closed ${pretty}`, tone: 'closed' };
  if (days < 1) return { key: 'today', label: 'closes today', tone: 'today' };
  if (days <= 7) return { key: '7d', label: `closes in ${Math.ceil(days)}d`, tone: 'soon' };
  if (days <= 14) return { key: '14d', label: `closes in ${Math.ceil(days)}d`, tone: 'ok' };
  return { key: 'later', label: `closes ${pretty}`, tone: 'later' };
}

function tendersViz(all) {
  const vals = all.map((r) => parseINR(r.value_inr)).filter((v) => v > 0);
  const valueEmpty = vals.length === 0;
  const sectorFilled = all.filter((r) => val(r, 'sector')).length;
  const now = Date.now();
  const open = all.filter((r) => {
    const d = parseDeadline(r.deadline);
    return d && d.getTime() > now;
  }).length;
  const soon = all.filter((r) => {
    const d = parseDeadline(r.deadline);
    return d && d.getTime() - now <= 14 * 864e5 && d.getTime() - now > 0;
  }).length;
  const byDeadline = countByFn(all, (r) => {
    const d = parseDeadline(r.deadline);
    return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  });
  const sectorItems = sectorFilled
    ? bars(topPairs(countBy(all, 'sector'), 8), { filterCol: 'sector' })
    : [];
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'TENDERS', value: String(all.length), sub: `${open} still open by deadline` },
      {
        label: 'TOTAL VALUE',
        value: valueEmpty ? 'Not published' : `₹${fmtCr(vals.reduce((a, b) => a + b, 0))}`,
        sub: valueEmpty ? 'value_inr empty in every row' : 'estimated',
      },
      { label: 'CLOSING ≤14D', value: String(soon), sub: soon ? 'deadline soon' : 'all deadlines have passed', tone: 'warn' },
      {
        label: 'SECTORS',
        value: sectorFilled ? String(countBy(all, 'sector').size) : 'Not published',
        sub: sectorFilled ? 'covered' : 'sector column empty in every row',
      },
    ],
    charts: [
      {
        type: 'bars',
        title: 'Tenders by deadline',
        hint: 'LIVE CPPP TENDERS · COUNT PER CLOSING DATE',
        items: bars(topPairs(byDeadline, 8), { filterCol: '_deadline_label' }),
      },
      {
        type: 'bars',
        title: 'Tenders by status',
        items: bars(topPairs(countBy(all, 'status'), 6), { filterCol: 'status' }),
      },
      sectorItems.length
        ? { type: 'bars', title: 'Tenders by sector', items: sectorItems }
        : { type: 'note', title: 'Tenders by sector', hint: 'No sector data  -  the column is empty in all rows, so nothing plots.' },
    ].filter(Boolean),
    note: valueEmpty
      ? 'Procurement value is not charted: value_inr is empty, so a ₹0 bar would be a false reading.'
      : '',
  };
}

function transfersViz(all) {
  const dates = all.map((r) => new Date(String(r.order_date).replace(/-/g, ' '))).filter((d) => !Number.isNaN(d.getTime()));
  const latest = dates.length ? new Date(Math.max(...dates)) : null;
  const recent = latest
    ? all.filter((r) => {
        const d = new Date(String(r.order_date).replace(/-/g, ' '));
        return !Number.isNaN(d.getTime()) && latest - d <= 90 * 864e5;
      }).length
    : 0;
  const jurKey = all[0] && 'jurisdiction' in all[0] ? 'jurisdiction' : 'cadre';
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'TRANSFERS', value: String(all.length), sub: 'posting changes' },
      { label: 'JURISDICTIONS', value: String(countBy(all, jurKey).size), sub: 'state / UT for AGMUT' },
      { label: 'LAST 90 DAYS', value: String(recent), sub: 'recent moves', tone: 'warn' },
      { label: 'BATCHES', value: String(countBy(all, 'batch_year').size), sub: 'seniority span' },
    ],
    charts: [
      {
        type: 'bars',
        title: 'Transfer volume by state / UT',
        hint: 'For an AGMUT cadre, jurisdiction is the state/UT dimension.',
        items: bars(topPairs(countBy(all, jurKey), 8), { filterCol: jurKey }),
      },
      { type: 'bars', title: 'Officers by batch year', items: bars(topPairs(countBy(all, 'batch_year'), 8), { filterCol: 'batch_year' }) },
    ],
    note: '29 rows  -  ordering and any rate reading stay provisional.',
  };
}

function mpViz(all) {
  const qNums = all.map((r) => toNum(r.questions_asked)).filter((v) => v != null).sort((a, b) => a - b);
  const median = qNums.length ? qNums[Math.floor(qNums.length / 2)] : 0;
  const withAtt = all.filter((r) => toNum(r.attendance_pct) != null).length;
  const byParty = {};
  all.forEach((r) => {
    const p = (r.party || '').trim();
    if (!p) return;
    const q = toNum(r.questions_asked);
    byParty[p] = byParty[p] || { n: 0, q: 0 };
    byParty[p].n += 1;
    if (q != null) byParty[p].q += q;
  });
  const partyAvg = Object.entries(byParty)
    .filter(([, v]) => v.n >= 5)
    .map(([p, v]) => [p, Math.round(v.q / v.n)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const buckets = countByFn(all, (r) => {
    const q = toNum(r.questions_asked);
    if (q == null) return null;
    return q === 0 ? '0' : q <= 50 ? '1-50' : q <= 150 ? '51-150' : q <= 300 ? '151-300' : '300+';
  });
  const bucketPairs = ['0', '1-50', '51-150', '151-300', '300+'].map((k) => [k, buckets.get(k) || 0]).filter((p) => p[1]);
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'MEMBERS', value: all.length.toLocaleString('en-IN'), sub: 'tracked' },
      { label: 'MEDIAN QUESTIONS', value: String(median), sub: 'per member' },
      { label: 'PARTIES', value: String(countBy(all, 'party').size), sub: 'represented' },
      {
        label: 'ATTENDANCE DATA',
        value: `${pct(withAtt, all.length)}%`,
        sub: withAtt ? 'of members' : 'empty in every row  -  not a zero attendance',
        tone: withAtt ? '' : 'bad',
      },
    ],
    charts: [
      { type: 'bars', title: 'Party seat share  -  18th Lok Sabha', hint: '543 seats · public record · curated. Click a named party to filter the roster.', items: bars(LS18_SEATS, { filterCol: 'party' }).map((it) => (it.label === 'Others' ? { ...it, filterCol: undefined } : it)) },
      { type: 'bars', title: 'House profile', items: bars(LS18_PROFILE) },
      { type: 'bars', title: 'Legislative activity by party (avg questions)', items: bars(partyAvg, { filterCol: 'party' }) },
      { type: 'bars', title: 'Engagement distribution', items: bars(bucketPairs, { filterCol: '_q_band' }), hint: 'Questions asked, bucketed. Click to cross-filter.' },
      { type: 'bars', title: 'Members by party', items: bars(topPairs(countBy(all, 'party'), 8), { filterCol: 'party' }) },
    ],
    note: 'MPLADS and attendance are named absences. Empty is not “did not attend”.',
  };
}

function genericViz(all) {
  const keys = Object.keys(all[0] || {});
  const catKeys = keys.filter((k) => /stage|status|priority|ministry|topic|sector|party|type|regulator/i.test(k));
  const dateKey = keys.find((k) => /date|reported|year/i.test(k));
  const cat = catKeys[0];
  const cat2 = catKeys[1];
  const kpis = [{ label: 'RECORDS', value: all.length.toLocaleString('en-IN'), sub: 'tracked in this module' }];
  if (cat) {
    const tp = topPairs(countBy(all, cat), 1)[0];
    if (tp) kpis.push({ label: `TOP ${cat.replace(/_/g, ' ').toUpperCase()}`, value: String(tp[0]).slice(0, 20), sub: `${pct(tp[1], all.length)}% of records` });
  }
  if (dateKey) {
    const last = maxYear(all, dateKey);
    kpis.push({ label: 'LATEST YEAR', value: last || ' - ', sub: 'most recent year present' });
  }
  if (cat2) kpis.push({ label: cat2.replace(/_/g, ' ').toUpperCase(), value: String(countBy(all, cat2).size), sub: 'distinct tracked' });
  while (kpis.length < 4) kpis.push({ label: 'SOURCE', value: 'REGISTER', sub: '' });
  const charts = [];
  if (cat) charts.push({ type: 'bars', title: `By ${cat.replace(/_/g, ' ')}`, items: bars(topPairs(countBy(all, cat), 8), { filterCol: cat }) });
  if (cat2) charts.push({ type: 'bars', title: `By ${cat2.replace(/_/g, ' ')}`, items: bars(topPairs(countBy(all, cat2), 8), { filterCol: cat2 }) });
  if (cat && cat2) {
    charts.push({
      type: 'matrix',
      title: `Concentration  -  ${cat.replace(/_/g, ' ')} × ${cat2.replace(/_/g, ' ')}`,
      hint: 'Sequential ramp starts above a 2:1 contrast floor so the lowest cell still reads as a shape.',
      matrix: crosstab(all, cat, cat2),
    });
  }
  return { title: 'Desk snapshot', kpis: kpis.slice(0, 4), charts };
}

function delimViz(rows) {
  const data = rows?.length ? rows : allocateSeats(753);
  const gain = data.filter((r) => r.d > 0).sort((a, b) => b.d - a.d)[0];
  const lose = data.filter((r) => r.d < 0).sort((a, b) => a.d - b.d)[0];
  const house = data.reduce((s, r) => s + r.proj, 0);
  const now = data.reduce((s, r) => s + r.now, 0);
  const net = house - now;
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'SEATS BEFORE', value: String(now), sub: 'current house' },
      { label: 'SEATS AFTER', value: String(house), sub: 'this scenario' },
      { label: 'NET CHANGE', value: `${net > 0 ? '+' : ''}${net}`, sub: 'signed', tone: net >= 0 ? 'ok' : 'bad' },
      { label: 'LARGEST GAINER', value: gain?.name || ' - ', sub: gain ? `+${gain.d}` : '' },
      ...(lose ? [{ label: 'LARGEST LOSER', value: lose.name, sub: String(lose.d), tone: 'bad' }] : []),
    ],
    charts: [
      {
        type: 'bars',
        title: 'Net seat change by state',
        hint: 'Largest remainder · NCP 2011-36 projections · illustrative. Diverging scale, not red-to-green.',
        items: data.slice(0, 12).map((r) => ({
          label: r.name,
          value: Math.abs(r.d),
          display: `${r.d > 0 ? '+' : ''}${r.d}`,
          tone: r.d > 0 ? 'cyan' : r.d < 0 ? 'lost' : 'stable',
          filterCol: 'name',
          filterValue: r.name,
        })),
      },
    ],
    note: 'SIMULATION · LARGEST REMAINDER · NCP 2011-36 PROJECTIONS · ILLUSTRATIVE',
  };
}

function manifestoViz(all) {
  const years = new Set(all.map((r) => yearOf(r.year || r.cycle) || 2024));
  const byDomain = countBy(all, 'domain');
  const byStatus = countBy(all, 'verifiable_status');
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'PROMISES', value: String(all.length), sub: 'Union 2024 tracker' },
      { label: 'YEARS COVERED', value: [...years].sort().join('-') || '2024', sub: 'one national cycle' },
      { label: 'DOMAINS', value: String(byDomain.size), sub: 'in this tracker' },
      { label: 'PARTIES', value: 'Union', sub: '2024 tracker  -  not all parties, all elections' },
    ],
    charts: [
      { type: 'bars', title: 'Commitments by domain', items: bars(topPairs(byDomain, 8), { filterCol: 'domain' }) },
      {
        type: 'bars',
        title: 'Evidence status distribution',
        hint: 'Verifiable status, not a fulfilled/broken verdict.',
        items: bars(topPairs(byStatus, 8), { filterCol: 'verifiable_status' }),
      },
    ],
    note: 'CURATED · AS OF JAN 2026 · VERIFY AGAINST GAZETTE / PIB. No % fulfilled on a named party.',
  };
}

function budgetViz() {
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'TOTAL EXPENDITURE', value: '₹50.65 L Cr', sub: 'Union Budget 2025-26 BE', tone: 'ok' },
      { label: 'CAPITAL EXPENDITURE', value: '₹11.21 L Cr', sub: 'budget estimate' },
      { label: 'FISCAL DEFICIT', value: '4.4% GDP', sub: 'target' },
      { label: 'SCHEMES CHARTED', value: '8', sub: 'allocation only  -  no utilisation' },
    ],
    charts: [
      {
        type: 'bars',
        title: 'Major scheme allocations',
        hint: 'Union Budget 2025-26 BE · ₹ crore · APPROXIMATE. Verify against indiabudget.gov.in. PDF is authoritative.',
        items: bars(BUDGET_SCHEMES, { fmt: (v) => `₹${v.toLocaleString('en-IN')} Cr`, filterCol: 'scheme' }),
      },
    ],
    note: 'Every figure is an allocation. Scheme-level utilisation exists in no free or paid Indian source  -  utilisation, if shown later, is ministry-level only.',
  };
}

function projectsViz(all) {
  const active = all.filter((r) => /active/i.test(r.activity || r.status)).length;
  const inactive = all.length - active;
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'FLAGSHIP PROGRAMMES', value: String(all.length), sub: 'curated reference, not a project register' },
      { label: 'ACTIVE', value: String(active), sub: `${inactive} inactive  -  label + colour`, tone: 'ok' },
      { label: 'TOTAL BUDGET', value: 'Not in this source', sub: 'PAIMANA not wired  -  no invented cost' },
      { label: 'WINNING BIDDER', value: 'Dropped', sub: 'refuted: no OCDS publisher; CPPP award page is captcha-gated' },
    ],
    charts: [
      { type: 'bars', title: 'Programmes by domain', items: bars(topPairs(countBy(all, 'domain'), 8), { filterCol: 'domain' }) },
    ],
    note: 'CURATED · AS OF JAN 2026 · VERIFY AGAINST MINISTRY DASHBOARDS. Cost overrun charts wait on PAIMANA.',
  };
}

export function allocateSeats(H) {
  const totalPop = DELIM_STATES.reduce((s, r) => s + r[1], 0);
  const rows = DELIM_STATES.map((s) => {
    const q = (s[1] / totalPop) * H;
    return { name: s[0], pop: s[1], now: s[2], q, base: Math.floor(q), rem: q - Math.floor(q), bumped: false };
  });
  rows.forEach((r) => {
    if (r.base < 1) {
      r.base = 1;
      r.bumped = true;
    }
  });
  let assigned = rows.reduce((s, r) => s + r.base, 0);
  let leftover = H - assigned;
  if (leftover > 0) {
    [...rows].sort((a, b) => b.rem - a.rem).slice(0, leftover).forEach((r) => {
      r.base += 1;
    });
  } else if (leftover < 0) {
    [...rows]
      .filter((r) => !r.bumped && r.base > 1)
      .sort((a, b) => a.rem - b.rem)
      .slice(0, -leftover)
      .forEach((r) => {
        r.base -= 1;
      });
  }
  return rows
    .map((r) => ({ name: r.name, title: r.name, pop: r.pop, now: r.now, proj: r.base, d: r.base - r.now }))
    .sort((a, b) => b.d - a.d || b.proj - a.proj);
}

function industryViz(rows) {
  const manf = rows.filter((r) => /manufac/i.test(String(r.indicator || r.title || '')));
  const use = manf.length ? manf : rows;
  const series = use
    .map((r) => ({ year: yearOf(r.date || r.year), n: toNum(r.value) }))
    .filter((p) => p.year && p.n != null)
    .sort((a, b) => a.year - b.year);
  const last = series[series.length - 1];
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'MANUFACTURING % GDP', value: last ? last.n.toFixed(1) : 'Unreachable', sub: last ? `India · ${last.year} · World Bank` : 'World Bank  -  will retry' },
      { label: 'SERIES YEARS', value: series.length || ' - ', sub: '15-year trend when the API resolves' },
      { label: 'ISSUING AUTHORITY', value: 'World Bank', sub: 'NV.IND.MANF.ZS / NV.IND.TOTL.ZS' },
      { label: 'REVISION STATUS', value: 'WDI', sub: 'as published by the Bank' },
    ],
    charts: series.length
      ? [
          {
            type: 'spark',
            title: 'Manufacturing share of GDP  -  15-year trend',
            hint: 'India · % of GDP · World Bank',
            series: series.map((p) => ({ year: p.year, n: p.n })),
            peak: series.reduce((a, b) => (b.n > a.n ? b : a), series[0]),
            from: series[0].year,
            through: last.year,
          },
          {
            type: 'bars',
            title: 'Series in this pull',
            hint: 'Click an indicator to filter the live rows.',
            items: bars(topPairs(countBy(rows, rows[0]?.indicator ? 'indicator' : 'title'), 8), {
              filterCol: rows[0]?.indicator ? 'indicator' : 'title',
            }),
          },
        ]
      : [],
    note: series.length
      ? 'v1 World Bank series only. Fiscal deficit, forex, IIP and WPI are named not-wired. No Moody’s. Implications are not asserted.'
      : 'World Bank open-data API unreachable from this network  -  it will retry automatically. Fiscal deficit, forex, IIP and WPI are not wired.',
  };
}

function statementsViz(feed, rows) {
  const vol = Array.isArray(feed?.meta?.volume) ? feed.meta.volume : [];
  const peak = vol.length ? vol.reduce((a, b) => (b.n > a.n ? b : a), vol[0]) : null;
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'ITEMS', value: String(rows.length), sub: 'in this window' },
      { label: 'PERSONAS TRACKED', value: '8', sub: 'public officials  -  no portraits' },
      { label: 'WINDOW', value: '7 days', sub: 'GDELT TimelineVol when the wire resolves' },
      { label: 'KIND', value: 'COVERAGE', sub: 'media volume, not statements' },
    ],
    charts: vol.length
      ? [
          {
            type: 'spark',
            title: 'Coverage volume  -  7 days',
            hint: `${feed?.meta?.person || 'Selected official'} · GDELT TimelineVol · news reporting search`,
            series: vol,
            peak,
            from: vol[0]?.year,
            through: vol[vol.length - 1]?.year,
          },
        ]
      : [],
    note: 'This desk measures how much a named person is written about. It does not hold their statements and cannot compare positions. No contradiction verdict.',
  };
}

function morningViz(feed, rows) {
  return {
    title: 'Desk snapshot',
    kpis: [
      { label: 'ITEMS', value: String(rows.length), sub: 'in this window' },
      { label: 'PIB', value: feed?.meta?.pib || 'OFFLINE', sub: 'government wire' },
      { label: 'WINDOW', value: '7 days', sub: 'GDELT TimelineVol when the wire resolves' },
      { label: 'KIND', value: 'DIGEST', sub: 'panel, not a table' },
    ],
    charts: [],
    note: 'PIB releases arrive through the backend (/api/rss) and it is not reachable  -  labelled offline, not left loading.',
  };
}

export function nationalOverview(feed) {
  const feature = String(feed?.feature || '');
  const rows = dataRows(feed?.rows);
  const kind = feed?.kind || feed?.meta?.kind || '';
  if (/delimitation/i.test(feature) || kind === 'simulator') return delimViz(rows.filter((r) => r.name && r.proj != null));
  if (/manifestos/i.test(feature)) {
    const data = rows.length
      ? rows
      : UNION_PROMISES.map(([promise, domain, verifiable_status]) => ({
          promise,
          domain,
          verifiable_status,
          title: promise,
          cycle: '2024',
        }));
    return manifestoViz(data);
  }
  if (/industry updates/i.test(feature)) return industryViz(rows);
  if (/budget/i.test(feature)) return budgetViz();
  if (/statement/i.test(feature)) return statementsViz(feed, rows);
  if (/morning brief/i.test(feature)) return morningViz(feed, rows);
  if (/centre-sanctioned|central projects/i.test(feature)) {
    const data = rows.length
      ? rows
      : FLAGSHIP_PROGRAMMES.map(([programme, domain, verifiable_status, activity]) => ({
          programme,
          domain,
          verifiable_status,
          activity,
          title: programme,
        }));
    return projectsViz(data);
  }
  if (!rows.length) return emptyKpis(feed?.source?.note || 'No live dataset is wired to this module yet.');
  if (/bill passage/i.test(feature)) return billsViz(rows);
  if (/policy intelligence graph/i.test(feature)) return policyGraphKpis(rows);
  if (/parliamentary question/i.test(feature)) return questionsViz(rows);
  if (/regulatory body watch/i.test(feature)) return regulatoryViz(rows);
  if (/candidate affidavit/i.test(feature)) return affidavitViz(rows);
  if (/mp profiles|mp report/i.test(feature)) return mpViz(rows);
  if (/central tender/i.test(feature)) return tendersViz(rows);
  if (/agmut|bureaucratic transfers/i.test(feature)) return transfersViz(rows);
  if (/policy pipeline/i.test(feature)) return genericViz(rows);
  if (/cabinet decisions/i.test(feature)) {
    const all = rows.filter((r) => r.status !== 'source_status');
    if (!all.length) return emptyKpis('No English cabinet rows on this host yet.');
    const byMinistry = topPairs(countBy(all, 'ministry'), 8);
    return {
      title: 'Desk snapshot',
      kpis: [
        { label: 'DECISIONS', value: all.length.toLocaleString('en-IN'), sub: 'English titles on this board' },
        {
          label: 'TOP MINISTRY',
          value: byMinistry[0] ? String(byMinistry[0][0]).slice(0, 28) : '-',
          sub: byMinistry[0] ? `${byMinistry[0][1]} releases` : '',
        },
        { label: 'MINISTRIES', value: String(countBy(all, 'ministry').size), sub: 'distinct on record' },
        { label: 'SOURCE', value: 'PIB', sub: 'Press Information Bureau' },
      ],
      charts: [
        {
          type: 'bars',
          title: 'By ministry',
          items: bars(byMinistry, { filterCol: 'ministry' }),
          hint: 'Grouped by ministry / issuing office, not by individual headline.',
        },
      ],
    };
  }
  return genericViz(rows);
}

export function sequentialCellStyle(value, colMax) {
  if (!value) return { background: '#d7dde6', color: 'transparent' };
  const t = Math.min(1, value / Math.max(colMax || 1, 1));
  const mix = 0.42 + t * 0.58;
  const r = Math.round(255 + (40 - 255) * mix);
  const g = Math.round(255 + (70 - 255) * mix);
  const b = Math.round(255 + (110 - 255) * mix);
  return { background: `rgb(${r},${g},${b})`, color: mix > 0.58 ? '#fff' : '#243044' };
}
