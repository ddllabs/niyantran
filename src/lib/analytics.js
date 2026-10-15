import { nationalOverview } from './nationalKpi.js';
import { sourceNames } from './plainSourceNote.js';

const SKIP = new Set([
  'date',
  'title',
  'source_url',
  'reporting_search',
  'detail',
  'latest_development',
  'summary',
  'id',
  'url',
  'link',
  'brief',
  'why_it_matters',
  'watch_for',
  'tags',
]);

const INTENSITY_ORDER = ['Critical', 'High', 'Medium', 'Low'];
const TREND_ORDER = ['Escalating', 'Stable', 'Easing'];

export function dataRows(rows) {
  return (rows || []).filter((r) => r && r.status !== 'source_status');
}

function val(row, key) {
  if (!key) return '';
  const v = row[key];
  if (v == null) return '';
  return String(v).trim();
}

function findKey(rows, names) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0] || {});
  for (const n of names) {
    const hit = keys.find((k) => k.toLowerCase() === n.toLowerCase());
    if (hit) return hit;
  }
  return '';
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

function cardinality(rows, key) {
  const s = new Set();
  for (const r of rows) {
    const v = val(r, key);
    if (v && v.length < 80) s.add(v);
  }
  return s.size;
}

function inferCats(rows) {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0]).filter((k) => !SKIP.has(k));
  const scored = keys
    .map((k) => {
      const c = cardinality(rows, k);
      const preferred = /region|intens|status|stage|trend|house|sector|ministr|country|type|party|exchange/i.test(k)
        ? 8
        : 0;
      return { key: k, c, score: preferred + (c >= 2 && c <= 18 ? 6 : c > 18 && c <= 40 ? 2 : -4) };
    })
    .filter((x) => x.c >= 2 && x.c <= 40)
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.key);
}

function countBy(rows, key, mapFn, order) {
  const m = new Map();
  for (const r of rows) {
    const k = mapFn ? mapFn(val(r, key)) : val(r, key);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  if (order?.length) {
    const rest = [...m.keys()].filter((k) => !order.includes(k)).sort((a, b) => m.get(b) - m.get(a));
    return [...order.filter((k) => m.has(k)), ...rest].map((label) => ({ label, value: m.get(label) }));
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
}

function crosstab(rows, rowKey, colKey, colOrder, rowLimit = 10) {
  const colSet = new Set();
  const rowSet = [];
  const seenRow = new Set();
  const grid = new Map();
  for (const r of rows) {
    let ck = val(r, colKey);
    if (colOrder) ck = intensityBucket(ck) || ck;
    const rk = val(r, rowKey);
    if (!rk || !ck) continue;
    colSet.add(ck);
    if (!seenRow.has(rk)) {
      seenRow.add(rk);
      rowSet.push(rk);
    }
    const k = `${rk}\t${ck}`;
    grid.set(k, (grid.get(k) || 0) + 1);
  }
  const cols = colOrder?.length ? colOrder : [...colSet];
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
  return { cols, rows: body, colTotals, grand, colMax, hidden };
}

function onsetYear(raw) {
  const years = String(raw || '').match(/\b(?:19|20)\d{2}\b/g);
  if (!years) return null;
  return Number(years[0]);
}

function yearSeries(rows, key, fromYear = 2004) {
  const counts = new Map();
  let older = 0;
  for (const r of rows) {
    const y = onsetYear(val(r, key));
    if (!y) continue;
    if (y < fromYear) older += 1;
    else counts.set(y, (counts.get(y) || 0) + 1);
  }
  if (!counts.size) return null;
  const maxY = Math.max(...counts.keys());
  const series = [];
  for (let y = fromYear; y <= maxY; y++) series.push({ year: y, n: counts.get(y) || 0 });
  const peak = series.reduce((a, b) => (b.n > a.n ? b : a), series[0]);
  return { series, peak, from: fromYear, through: maxY, older };
}

function pct(part, whole) {
  if (!whole) return '—';
  return `${Math.round((100 * part) / whole)}%`;
}

function barTone(label, variant) {
  const s = String(label || '').toLowerCase();
  if (variant === 'trend') {
    if (/escalat/.test(s)) return 'escalate';
    if (/eas/.test(s)) return 'ease';
    return 'stable';
  }
  if (variant === 'intensity') {
    if (/critic/.test(s)) return 'escalate';
    if (/high/.test(s)) return 'highbar';
    if (/low/.test(s)) return 'ease';
    return 'stable';
  }
  if (variant === 'infra') {
    if (/operational|implemented/.test(s)) return 'ease';
    if (/construction|development|negotiation/.test(s)) return 'escalate';
    return 'highbar';
  }
  if (variant === 'posture') {
    if (/low-intensity|frozen|inactive/.test(s)) return 'gradient';
    return 'stable';
  }
  return 'gradient';
}

function withTones(items, variant) {
  return items.map((it) => ({ ...it, tone: barTone(it.label, variant) }));
}

function nnum(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function inr(x) {
  return Math.round(x).toLocaleString('en-IN');
}

function sumKey(rows, key) {
  return rows.reduce((s, r) => s + nnum(r[key]), 0);
}

function meanKey(rows, key) {
  return rows.length ? sumKey(rows, key) / rows.length : 0;
}

function stationLabel(r) {
  const ac = r.ac != null && r.ac !== '' ? `${r.ac}/` : '';
  return `${ac}${r.booth || ''} ${(r.station || r.title || '').slice(0, 22)}`.trim();
}

function geoBoothOverview(feature, rows, base) {
  const f = String(feature || '');

  if (/^booth register$/i.test(f)) {
    const elec = sumKey(rows, 'electors');
    const hh = sumKey(rows, 'households');
    const bins = [
      { label: 'under 300', value: 0, filterCol: 'sizeBand' },
      { label: '300–600', value: 0, filterCol: 'sizeBand' },
      { label: '600–900', value: 0, filterCol: 'sizeBand' },
      { label: '900–1200', value: 0, filterCol: 'sizeBand' },
      { label: '1200+', value: 0, filterCol: 'sizeBand' },
    ];
    rows.forEach((r) => {
      const e = nnum(r.electors);
      bins[e < 300 ? 0 : e < 600 ? 1 : e < 900 ? 2 : e < 1200 ? 3 : 4].value += 1;
    });
    base.title = 'SIZE CHARTS';
    base.note = 'Every polling booth in scope with electors, households and average booth size.';
    base.kpis = [
      { label: 'BOOTHS', value: inr(rows.length), sub: 'polling stations in scope' },
      { label: 'ELECTORS', value: inr(elec), sub: 'final SIR roll' },
      { label: 'AVG BOOTH', value: inr(elec / Math.max(rows.length, 1)), sub: 'electors per booth' },
      { label: 'HOUSEHOLDS', value: inr(hh), sub: 'on the roll' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'BOOTHS BY SIZE',
        hint: 'Electors per polling station. Click a band to filter the register.',
        filterCol: 'sizeBand',
        items: withTones(bins, 'gradient'),
      },
    ];
    return base;
  }

  if (/^booth demography$/i.test(f)) {
    const male = sumKey(rows, 'male');
    const female = sumKey(rows, 'female');
    const ratio = male ? Math.round((female / male) * 1000) : 0;
    base.title = 'ANALYTICS CHARTS';
    base.note = 'Sex ratio, mean age and senior share at booth level, from the final SIR roll.';
    base.kpis = [
      { label: 'F / 1,000 M', value: inr(ratio), sub: 'females per 1,000 males' },
      { label: 'MEAN AGE', value: meanKey(rows, 'meanAge').toFixed(1), sub: 'booth average' },
      { label: 'SENIOR SHARE', value: `${meanKey(rows, 'senior').toFixed(1)}%`, sub: 'aged 60+, booth average' },
      { label: 'BOOTHS', value: inr(rows.length), sub: 'in this view' },
    ];
    const oldest = [...rows].sort((a, b) => nnum(b.meanAge) - nnum(a.meanAge)).slice(0, 10);
    const femaleShare = rows
      .filter((r) => nnum(r.male) > 50)
      .sort((a, b) => nnum(b.sexRatio) - nnum(a.sexRatio))
      .slice(0, 10);
    base.charts = [
      {
        type: 'bars',
        title: 'OLDEST ROLLS — MEAN AGE',
        hint: 'Ten booths with the highest mean age on the final SIR roll.',
        items: withTones(oldest.map((r) => ({ label: stationLabel(r), value: Number(nnum(r.meanAge).toFixed(1)) })), 'gradient'),
      },
      {
        type: 'bars',
        title: 'HIGHEST FEMALE SHARE (F/1,000 M)',
        hint: 'Booths with more than 50 male electors, ranked by sex ratio.',
        items: withTones(femaleShare.map((r) => ({ label: stationLabel(r), value: Math.round(nnum(r.sexRatio)) })), 'gradient'),
      },
    ];
    return base;
  }

  if (/^booth bloc composition$/i.test(f)) {
    const t = { catholic: 0, muslim: 0, st: 0, obc: 0, general: 0, sc: 0 };
    rows.forEach((r) => {
      const raw = r._blocRaw || r;
      Object.keys(t).forEach((k) => {
        t[k] += nnum(raw[k]);
      });
    });
    const hindu = t.st + t.obc + t.general + t.sc;
    const elec = sumKey(rows, 'electors');
    const uncl = Math.max(0, elec - hindu - t.catholic - t.muslim);
    base.title = 'BLOC STRIPS';
    base.note =
      'Religion and caste mix from surname tags on the booth roll — estimated shares, not a census. Tiny cells and thin booths are blanked.';
    base.kpis = [
      { label: 'HINDU', value: inr(hindu), sub: `${elec ? Math.round((hindu / elec) * 100) : 0}% of electors` },
      { label: 'CATHOLIC', value: inr(t.catholic), sub: `${elec ? Math.round((t.catholic / elec) * 100) : 0}% of electors` },
      { label: 'MUSLIM', value: inr(t.muslim), sub: `${elec ? Math.round((t.muslim / elec) * 100) : 0}% of electors` },
      { label: 'BOOTHS', value: inr(rows.length), sub: 'surname-classified roll' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'RELIGION ON THE ROLL',
        hint: 'Electors classified from the booth roll, not a survey.',
        items: withTones(
          [
            { label: 'Hindu', value: hindu },
            { label: 'Catholic', value: t.catholic },
            { label: 'Muslim', value: t.muslim },
            { label: 'Other / uncl.', value: uncl },
          ].filter((x) => x.value > 0),
          'gradient',
        ),
      },
      {
        type: 'bars',
        title: 'CASTE AMONG HINDU ELECTORS',
        hint: 'Counts inside the Hindu classified roll.',
        items: withTones(
          [
            { label: 'OBC', value: t.obc },
            { label: 'General', value: t.general },
            { label: 'SC', value: t.sc },
            { label: 'ST', value: t.st },
          ].filter((x) => x.value > 0),
          'gradient',
        ),
      },
      {
        type: 'bars',
        title: 'BOOTHS BY LARGEST BLOC',
        hint: 'Row counts by the leading community at the booth. Click a bloc to filter.',
        items: withTones(
          countBy(rows, 'bloc').map((it) => ({ ...it, filterCol: 'bloc' })),
          'gradient',
        ),
      },
    ];
    return base;
  }

  if (/^booth-level roll churn$/i.test(f)) {
    const added = sumKey(rows, 'added');
    const removed = sumKey(rows, 'removed');
    const busiest = [...rows].sort((a, b) => nnum(b.added) + nnum(b.removed) - (nnum(a.added) + nnum(a.removed)))[0];
    const movers = [...rows]
      .sort((a, b) => Math.abs(nnum(b.net)) - Math.abs(nnum(a.net)))
      .slice(0, 10);
    base.title = 'NET-MOVEMENT CHARTS';
    base.note = 'Names added and removed at each booth between the draft and the final roll.';
    base.kpis = [
      { label: 'ADDED', value: `+${inr(added)}`, sub: 'draft → final', tone: 'ok' },
      { label: 'REMOVED', value: `−${inr(removed)}`, sub: 'draft → final', tone: 'warn' },
      {
        label: 'BUSIEST',
        value: busiest ? `${busiest.ac}/${busiest.booth}` : '—',
        sub: busiest ? `+${inr(busiest.added)} / −${inr(busiest.removed)}` : 'no movement',
      },
      { label: 'BOOTHS', value: inr(rows.length), sub: 'SIR revision' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'NET MOVEMENT — BOOTHS THAT MOVED MOST',
        hint: 'Added minus removed. The ten largest moves in either direction.',
        items: movers.map((r) => {
          const net = nnum(r.net);
          return {
            label: `${stationLabel(r)} · ${net >= 0 ? '+' : '−'}${Math.abs(net)}`,
            value: Math.abs(net),
            tone: net >= 0 ? 'ease' : 'escalate',
          };
        }),
      },
    ];
    return base;
  }

  return null;
}

function lawOverview(feature, rows, base) {
  const f = String(feature || '');
  if (/^supreme court order|^order archive by topic/i.test(f)) {
    const topics = new Set(rows.map((r) => val(r, 'topic')).filter(Boolean)).size;
    const withPdf = rows.filter((r) => /^https?:\/\//i.test(String(r.pdf_url || ''))).length;
    const unclassified = rows.filter((r) => /other|unclassified/i.test(val(r, 'topic'))).length;
    const thin = rows.length < 30 || unclassified / Math.max(1, rows.length) > 0.5;
    base.title = 'ORDERS';
    base.note = thin
      ? `Extracted Supreme Court order table (${rows.length} rows). This is a thin slice of SCI output — not a live docket. SCI “view-pdf” links often need a browser session and may fail (403 / blank) outside it; treat a dead PDF as a source limit, not a missing order.`
      : 'Extracted Supreme Court order table. Topic is a classifier from the pack, not a legal opinion. SCI PDF links may require a live court session.';
    base.kpis = [
      { label: 'ORDERS', value: inr(rows.length), sub: thin ? 'thin extracted slice' : 'in this view' },
      { label: 'TOPICS', value: topics, sub: 'subject buckets' },
      { label: 'PDF LINKS', value: inr(withPdf), sub: 'may need SCI session' },
      { label: 'SOURCE', value: 'INGESTED', sub: 'order table, not news' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'ORDERS BY TOPIC',
        hint: 'Counts from the extracted order table. Click a topic to filter.',
        items: withTones(countBy(rows, 'topic').slice(0, 8), 'gradient').map((it) => ({ ...it, filterCol: 'topic' })),
      },
    ];
    return base;
  }
  if (/^nclt/i.test(f)) {
    const nclt = rows.filter((r) => /nclt/i.test(val(r, 'court'))).length;
    const ibbi = rows.filter((r) => /ibbi/i.test(val(r, 'court'))).length;
    base.title = 'INSOLVENCY';
    base.note = 'NCLT orders and IBBI announcements from the published sources. Not a news search.';
    base.kpis = [
      { label: 'ROWS', value: inr(rows.length), sub: 'orders + announcements' },
      { label: 'NCLT', value: inr(nclt), sub: 'tribunal orders' },
      { label: 'IBBI', value: inr(ibbi), sub: 'public announcements' },
      { label: 'SOURCE', value: 'STORED', sub: 'from the published sources' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'BY ORDER TYPE',
        hint: 'NCLT remarks and IBBI announcement types. Click to filter.',
        items: withTones(countBy(rows, 'remarks').slice(0, 8), 'gradient').map((it) => ({ ...it, filterCol: 'remarks' })),
      },
    ];
    return base;
  }
  if (/supreme courts & precedent — united states/i.test(f)) {
    base.title = 'SCOTUS';
    base.note = 'CourtListener opinion search. Not a news search.';
    base.kpis = [
      { label: 'OPINIONS', value: inr(rows.length), sub: 'in this pull' },
      { label: 'COURT', value: 'SCOTUS', sub: 'US Supreme Court' },
      { label: 'SOURCE', value: 'LIVE', sub: 'CourtListener' },
      { label: 'STATUS', value: new Set(rows.map((r) => val(r, 'status')).filter(Boolean)).size, sub: 'distinct labels' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'BY STATUS',
        filterCol: 'status',
        items: withTones(countBy(rows, 'status'), 'gradient'),
      },
    ];
    return base;
  }
  return null;
}

function financeOverview(feature, rows, base, feed) {
  const f = String(feature || '');
  if (/^nse\/bse delayed market feed$/i.test(f)) {
    const nse = rows.filter((r) => /nse/i.test(val(r, 'exchange'))).length;
    const bse = rows.filter((r) => /bse/i.test(val(r, 'exchange'))).length;
    base.title = 'MARKET BOARD';
    base.note = feed?.source?.note || 'Extracted NSE/BSE quote snapshot. Not a recommendation.';
    base.kpis = [
      { label: 'QUOTES', value: inr(rows.length), sub: 'in this snapshot' },
      { label: 'NSE', value: inr(nse), sub: 'indices / names' },
      { label: 'BSE', value: inr(bse), sub: 'names' },
      { label: 'SOURCE', value: feed?.source?.kind === 'finance-pack' ? 'REGISTER' : 'LIVE', sub: 'delayed quotes' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'BY VENUE',
        hint: 'Counts from the quote table. Last prices are delayed or frozen — not a trade signal.',
        items: withTones(countBy(rows, 'exchange'), 'gradient').map((it) => ({ ...it, filterCol: 'exchange' })),
      },
    ];
    return base;
  }
  if (/^live global stock exchanges$/i.test(f)) {
    base.title = 'WORLD BOARD';
    base.note = feed?.source?.note || 'Yahoo last quotes for venue indices.';
    base.kpis = [
      { label: 'INDICES', value: inr(rows.length), sub: 'venue benchmarks' },
      { label: 'VENUES', value: new Set(rows.map((r) => val(r, 'venue') || val(r, 'exchange')).filter(Boolean)).size, sub: 'named exchanges' },
      { label: 'SOURCE', value: 'LIVE', sub: 'Yahoo last quote' },
      { label: 'AS OF', value: [...new Set(rows.map((r) => val(r, 'date')).filter(Boolean))][0] || '—', sub: 'quote date' },
    ];
    return base;
  }
  if (/^economic overview of all countries$/i.test(f)) {
    const year = [...new Set(rows.map((r) => val(r, 'year')).filter(Boolean))][0] || '—';
    base.title = 'COUNTRY ECONOMIES';
    base.note = feed?.source?.note || 'World Bank GDP (current US$).';
    base.kpis = [
      { label: 'ECONOMIES', value: inr(rows.length), sub: 'countries, not aggregates' },
      { label: 'YEAR', value: year, sub: 'most recent published' },
      { label: 'SOURCE', value: 'LIVE', sub: 'World Bank' },
      { label: 'UNIT', value: 'US$ BN', sub: 'current dollars' },
    ];
    return base;
  }
  if (/^key financial indicators/i.test(f)) {
    const year = [...new Set(rows.map((r) => val(r, 'year')).filter(Boolean))][0] || '—';
    base.title = 'KEY INDICATORS';
    base.note = feed?.source?.note || 'World Bank growth, CPI, emp-to-pop. PMI is not in this table.';
    base.kpis = [
      { label: 'ECONOMIES', value: inr(rows.length), sub: 'World Bank countries' },
      { label: 'YEAR', value: year, sub: 'indicator vintage' },
      { label: 'SOURCE', value: 'LIVE', sub: 'World Bank' },
      { label: 'PMI', value: 'EXCLUDED', sub: 'S&P Global licence' },
    ];
    return base;
  }
  if (/^trade agreements/i.test(f)) {
    const years = new Set(rows.map((r) => val(r, 'year')).filter(Boolean)).size;
    base.title = 'TRADE POLICY';
    base.note = feed?.source?.note || 'Extracted DGFT notifications.';
    base.kpis = [
      { label: 'NOTICES', value: inr(rows.length), sub: 'DGFT notifications' },
      { label: 'YEARS', value: years, sub: 'FTP years in view' },
      { label: 'SOURCE', value: 'INGESTED', sub: 'India trade policy' },
      { label: 'TARIFFS', value: 'ABSENT', sub: 'WTO schedule not licensed' },
    ];
    return base;
  }
  if (/^sector policy/i.test(f)) {
    const years = rows.map((r) => Number(val(r, 'year'))).filter(Number.isFinite);
    base.title = 'SECTOR SERIES';
    base.note = feed?.source?.note || 'World Bank India electricity access. Not a ministry gazette.';
    base.kpis = [
      { label: 'POINTS', value: inr(rows.length), sub: 'annual observations' },
      { label: 'FROM', value: years.length ? Math.min(...years) : '—', sub: 'first year' },
      { label: 'THROUGH', value: years.length ? Math.max(...years) : '—', sub: 'latest year' },
      { label: 'SOURCE', value: 'LIVE', sub: 'World Bank India' },
    ];
    return base;
  }
  if (/^top financial & business players$/i.test(f)) {
    const cos = new Set(rows.map((r) => val(r, 'company')).filter(Boolean)).size;
    base.title = 'BUSINESS LEADERS';
    base.note = feed?.source?.note || 'Wikidata identity only. No rankings, no market cap.';
    base.kpis = [
      { label: 'PEOPLE', value: inr(rows.length), sub: 'named chief executives' },
      { label: 'FIRMS', value: inr(cos), sub: 'Indian enterprises' },
      { label: 'SOURCE', value: 'LIVE', sub: 'Wikidata SPARQL' },
      { label: 'RANKINGS', value: 'ABSENT', sub: 'Forbes/Fortune proprietary' },
    ];
    return base;
  }
  if (/^prediction market political odds$/i.test(f)) {
    base.title = 'POLITICAL MARKETS';
    base.note = feed?.source?.note || 'Manifold political markets by volume.';
    base.kpis = [
      { label: 'MARKETS', value: inr(rows.length), sub: 'political only' },
      { label: 'SOURCE', value: feed?.fallback ? 'STORED' : 'LIVE', sub: feed?.fallback ? '31-row snapshot' : 'Manifold' },
      { label: 'INDIA', value: 'NONE', sub: 'not an India-election board' },
      { label: 'VOL 24H', value: inr(rows.filter((r) => nnum(r.volume_24h) > 0).length), sub: 'with recent volume' },
    ];
    return base;
  }
  return null;
}

function carbonOverview(feature, rows, base, feed) {
  const f = String(feature || '');
  if (/^carbon border/i.test(f)) {
    const jus = new Set(rows.map((r) => val(r, 'jurisdiction')).filter(Boolean)).size;
    base.title = 'CBAM watch';
    base.note = feed?.source?.note || 'Extracted EU/UK CBAM milestones with official sources.';
    base.kpis = [
      { label: 'Milestones', value: inr(rows.length), sub: 'dated instruments' },
      { label: 'Jurisdictions', value: jus, sub: 'EU, UK, India' },
      { label: 'Source', value: 'Register', sub: 'not a news search' },
      { label: 'Regime', value: '2026', sub: 'EU definitive year' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'By jurisdiction',
        hint: 'Counts from the milestone table. Click to filter.',
        items: withTones(countBy(rows, 'jurisdiction'), 'gradient').map((it) => ({ ...it, filterCol: 'jurisdiction' })),
      },
    ];
    return base;
  }
  if (/^global carbon pricing tracker$/i.test(f)) {
    const withPrice = rows.filter((r) => nnum(r.weighted_price_usd) > 0).length;
    const ets = rows.filter((r) => /ets/i.test(val(r, 'ets_status')) && !/^no ets$/i.test(val(r, 'ets_status'))).length;
    base.title = 'Carbon pricing';
    base.note = feed?.source?.note || 'Jurisdiction carbon prices. World Bank CO2 emissions were not used.';
    base.kpis = [
      { label: 'Jurisdictions', value: inr(rows.length), sub: 'with a listed instrument' },
      { label: 'With price', value: inr(withPrice), sub: 'USD / tCO2e printed' },
      { label: 'ETS', value: inr(ets), sub: 'not “No ETS”' },
      { label: 'Source', value: 'Register', sub: 'OWID carbon prices' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'ETS status',
        hint: 'Instrument labels from the extracted table. Click to filter.',
        items: withTones(countBy(rows, 'ets_status').slice(0, 8), 'gradient').map((it) => ({ ...it, filterCol: 'ets_status' })),
      },
    ];
    return base;
  }
  if (/^carbon price monitor$/i.test(f)) {
    const years = new Set(rows.map((r) => val(r, 'year')).filter(Boolean)).size;
    const jus = new Set(rows.map((r) => val(r, 'jurisdiction')).filter(Boolean)).size;
    base.title = 'Price series';
    base.note = feed?.source?.note || 'Emissions-weighted USD/tCO2e by jurisdiction and year.';
    base.kpis = [
      { label: 'Points', value: inr(rows.length), sub: 'jurisdiction-years' },
      { label: 'Jurisdictions', value: inr(jus), sub: 'in this series' },
      { label: 'Years', value: inr(years), sub: 'span of the records' },
      { label: 'Source', value: 'Register', sub: 'not a live ticker' },
    ];
    return base;
  }
  if (/^ets & tax adoption timeline$/i.test(f)) {
    const first = rows.map((r) => Number(val(r, 'first_instrument_year'))).filter(Number.isFinite);
    base.title = 'Adoption timeline';
    base.note = feed?.source?.note || 'First carbon-pricing year, ETS against tax.';
    base.kpis = [
      { label: 'Jurisdictions', value: inr(rows.length), sub: 'with a first year' },
      { label: 'From', value: first.length ? Math.min(...first) : '—', sub: 'earliest instrument' },
      { label: 'Instruments', value: new Set(rows.map((r) => val(r, 'instruments')).filter(Boolean)).size, sub: 'ETS / tax / both' },
      { label: 'Source', value: 'Register', sub: 'adoption table' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'By instrument mix',
        items: withTones(countBy(rows, 'instruments'), 'gradient').map((it) => ({ ...it, filterCol: 'instruments' })),
      },
    ];
    return base;
  }
  if (/^india ccts/i.test(f)) {
    base.title = 'India CCTS';
    base.note = feed?.source?.note || 'CCTS and Green Credit Programme milestones.';
    base.kpis = [
      { label: 'Milestones', value: inr(rows.length), sub: 'legal basis and notices' },
      { label: 'From', value: rows[0] ? val(rows[0], 'date') : '—', sub: 'first in table' },
      { label: 'Through', value: rows.length ? val(rows[rows.length - 1], 'date') : '—', sub: 'latest in table' },
      { label: 'Source', value: 'Register', sub: 'MoP / BEE / MoEFCC' },
    ];
    return base;
  }
  if (/^carbon registry wire$/i.test(f)) {
    const regs = new Set(rows.map((r) => val(r, 'registry')).filter(Boolean)).size;
    base.title = 'Registry wire';
    base.note = feed?.source?.note || 'Dated registry publications.';
    base.kpis = [
      { label: 'Notices', value: inr(rows.length), sub: 'in this pull' },
      { label: 'Registries', value: inr(regs), sub: 'named in the table' },
      {
        label: 'Source',
        value: feed?.source?.kind === 'carbon-pack' ? 'Register' : 'Live',
        sub: feed?.source?.kind === 'carbon-pack' ? 'snapshot' : 'Verra feed + snapshot',
      },
      { label: 'Puro', value: 'Not listed', sub: 'no public feed' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'By registry',
        items: withTones(countBy(rows, 'registry'), 'gradient').map((it) => ({ ...it, filterCol: 'registry' })),
      },
    ];
    return base;
  }
  if (/^climate newswire$/i.test(f)) {
    const outlets = new Set(rows.map((r) => val(r, 'outlet')).filter(Boolean)).size;
    base.title = 'Climate wire';
    base.note = feed?.source?.note || 'Carbon Brief, Mongabay India, Climate Home News.';
    base.kpis = [
      { label: 'Headlines', value: inr(rows.length), sub: 'in this pull' },
      { label: 'Outlets', value: inr(outlets), sub: 'named in the table' },
      {
        label: 'Source',
        value: feed?.source?.kind === 'carbon-pack' ? 'Register' : 'Live',
        sub: feed?.source?.kind === 'carbon-pack' ? 'snapshot' : 'outlet feeds',
      },
      { label: 'Coverage', value: 'Outlet feeds', sub: 'not a generic search' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'By outlet',
        items: withTones(countBy(rows, 'outlet'), 'gradient').map((it) => ({ ...it, filterCol: 'outlet' })),
      },
    ];
    return base;
  }
  return null;
}

function sportsOverview(feature, rows, base, feed) {
  const f = String(feature || '');
  if (/^cricket wire$|^football wire$|^indian sports wire$/i.test(f)) {
    const outlets = new Set(rows.map((r) => val(r, 'outlet')).filter(Boolean)).size;
    base.title = 'SPORTS WIRE';
    base.note = feed?.source?.note || 'Live outlet feeds.';
    base.kpis = [
      { label: 'HEADLINES', value: inr(rows.length), sub: 'in this pull' },
      { label: 'OUTLETS', value: inr(outlets), sub: 'named in the table' },
      { label: 'SOURCE', value: 'LIVE', sub: 'outlet feeds' },
      { label: 'NEWS SEARCH', value: 'NOT USED', sub: 'straight from the outlets' },
    ];
    return base;
  }
  if (/^fixtures & results/i.test(f) || /^isl tracker$/i.test(f)) {
    const leagues = new Set(rows.map((r) => val(r, 'league')).filter(Boolean)).size;
    const results = rows.filter((r) => /result/i.test(val(r, 'status'))).length;
    base.title = /^isl/i.test(f) ? 'ISL' : 'WORLD LEAGUES';
    base.note = feed?.source?.note || 'Live fixtures and results.';
    base.kpis = [
      { label: 'EVENTS', value: inr(rows.length), sub: 'fixtures + results' },
      { label: 'LEAGUES', value: inr(leagues), sub: 'named in the table' },
      { label: 'RESULTS', value: inr(results), sub: 'with a printed score' },
      { label: 'SOURCE', value: 'LIVE', sub: /^isl/i.test(f) ? 'ESPN / SportsDB' : 'TheSportsDB' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'BY LEAGUE',
        items: withTones(countBy(rows, 'league'), 'gradient').map((it) => ({ ...it, filterCol: 'league' })),
      },
    ];
    return base;
  }
  if (/^sports business/i.test(f)) {
    const owned = rows.filter((r) => val(r, 'owner') && val(r, 'owner') !== '—').length;
    base.title = 'SPORTS BUSINESS';
    base.note = feed?.source?.note || 'Wikidata Indian leagues. Not rights valuations.';
    base.kpis = [
      { label: 'LEAGUES', value: inr(rows.length), sub: 'Indian competitions' },
      { label: 'WITH OWNER', value: inr(owned), sub: 'P127 on Wikidata' },
      { label: 'SOURCE', value: 'LIVE', sub: 'Wikidata SPARQL' },
      { label: 'RIGHTS', value: 'ABSENT', sub: 'valuations not in this pull' },
    ];
    return base;
  }
  if (/^athlete index$/i.test(f)) {
    const sports = new Set(rows.map((r) => val(r, 'sport')).filter((s) => s && s !== '—')).size;
    base.title = 'ATHLETE INDEX';
    base.note = feed?.source?.note || 'Wikidata identity. Not rankings or endorsements.';
    base.kpis = [
      { label: 'ATHLETES', value: inr(rows.length), sub: 'Indian nationality' },
      { label: 'SPORTS', value: inr(sports), sub: 'named on the record' },
      { label: 'SOURCE', value: 'LIVE', sub: 'Wikidata SPARQL' },
      { label: 'RANKINGS', value: 'ABSENT', sub: 'not in this pull' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'BY SPORT',
        items: withTones(countBy(rows, 'sport').slice(0, 8), 'gradient').map((it) => ({ ...it, filterCol: 'sport' })),
      },
    ];
    return base;
  }
  return null;
}

function entertainmentOverview(feature, rows, base, feed) {
  const f = String(feature || '');
  if (/^tv & streaming tonight$/i.test(f)) {
    const countries = new Set(rows.map((r) => val(r, 'country')).filter(Boolean)).size;
    const nets = new Set(rows.map((r) => val(r, 'network')).filter((s) => s && s !== '—')).size;
    base.title = 'TONIGHT';
    base.note = feed?.source?.note || 'TVmaze India and US schedule.';
    base.kpis = [
      { label: 'LISTINGS', value: inr(rows.length), sub: 'in this pull' },
      { label: 'NETWORKS', value: inr(nets), sub: 'named in the table' },
      { label: 'COUNTRIES', value: inr(countries), sub: 'IN + US' },
      { label: 'NEWS SEARCH', value: 'NOT USED', sub: 'straight from the outlets' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'BY NETWORK',
        items: withTones(countBy(rows, 'network').slice(0, 8), 'gradient').map((it) => ({
          ...it,
          filterCol: 'network',
        })),
      },
    ];
    return base;
  }
  if (/^box office tracker$/i.test(f)) {
    const withBo = rows.filter((r) => val(r, 'box_office') && val(r, 'box_office') !== '—').length;
    base.title = 'BOX OFFICE';
    base.note = feed?.source?.note || 'Wikidata Indian films. Not weekend BOI charts.';
    base.kpis = [
      { label: 'FILMS', value: inr(rows.length), sub: 'India origin, 2024+' },
      { label: 'WITH P2142', value: inr(withBo), sub: 'Wikidata box office' },
      { label: 'SOURCE', value: 'LIVE', sub: 'Wikidata SPARQL' },
      { label: 'WEEKEND', value: 'ABSENT', sub: 'BOI / Mojo not public' },
    ];
    return base;
  }
  if (/^entertainment news wire$|^bollywood & film wire$/i.test(f)) {
    const outlets = new Set(rows.map((r) => val(r, 'outlet')).filter(Boolean)).size;
    base.title = /^bollywood/i.test(f) ? 'BOLLYWOOD WIRE' : 'SCREEN TRADE';
    base.note = feed?.source?.note || 'Live outlet feeds.';
    base.kpis = [
      { label: 'HEADLINES', value: inr(rows.length), sub: 'in this pull' },
      { label: 'OUTLETS', value: inr(outlets), sub: 'named in the table' },
      { label: 'SOURCE', value: 'LIVE', sub: 'outlet feeds' },
      { label: 'NEWS SEARCH', value: 'NOT USED', sub: 'straight from the outlets' },
    ];
    return base;
  }
  if (/^music charts/i.test(f)) {
    const artists = new Set(rows.map((r) => val(r, 'artist')).filter(Boolean)).size;
    base.title = /india/i.test(f) ? 'INDIA TOP 25' : 'US TOP 25';
    base.note = feed?.source?.note || 'Apple Music most-played.';
    base.kpis = [
      { label: 'TRACKS', value: inr(rows.length), sub: 'chart positions' },
      { label: 'ARTISTS', value: inr(artists), sub: 'named in the table' },
      { label: 'SOURCE', value: 'LIVE', sub: 'Apple Music / iTunes' },
      { label: 'NEWS SEARCH', value: 'NOT USED', sub: 'straight from the outlets' },
    ];
    return base;
  }
  if (/^ott & studio intelligence$/i.test(f)) {
    const ott = rows.filter((r) => /^ott$/i.test(val(r, 'kind'))).length;
    const owned = rows.filter((r) => val(r, 'owner') && val(r, 'owner') !== '—').length;
    base.title = 'OTT & STUDIOS';
    base.note = feed?.source?.note || 'Wikidata identity. Not TRAI or subscriber tables.';
    base.kpis = [
      { label: 'ENTITIES', value: inr(rows.length), sub: 'Indian OTT + studios' },
      { label: 'OTT', value: inr(ott), sub: 'video on demand' },
      { label: 'WITH OWNER', value: inr(owned), sub: 'P127 on Wikidata' },
      { label: 'TRAI', value: 'ABSENT', sub: 'subscribers not in this pull' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'BY KIND',
        items: withTones(countBy(rows, 'kind'), 'gradient').map((it) => ({ ...it, filterCol: 'kind' })),
      },
    ];
    return base;
  }
  if (/^celebrity influence index$/i.test(f)) {
    const withF = rows.filter((r) => val(r, 'followers') && val(r, 'followers') !== '—').length;
    base.title = 'CELEBRITY INDEX';
    base.note = feed?.source?.note || 'Wikidata followers. Not brand slates.';
    base.kpis = [
      { label: 'PEOPLE', value: inr(rows.length), sub: 'Indian screen / music' },
      { label: 'WITH P8687', value: inr(withF), sub: 'public follower count' },
      { label: 'SOURCE', value: 'LIVE', sub: 'Wikidata SPARQL' },
      { label: 'BRANDS', value: 'ABSENT', sub: 'endorsements not in this pull' },
    ];
    return base;
  }
  return null;
}

function isNationalFeature(feature, feed) {
  if (feed?.tier === 'national') return true;
  return /bill passage|policy intelligence|policy pipeline|parliamentary question|regulatory body|candidate affidavit|delimitation|manifestos|mp profiles|statement|morning brief|central tender|agmut|bureaucratic transfers|cabinet decisions|centre-sanctioned|budget utilisation|industry updates/i.test(
    String(feature || ''),
  );
}

function stampBarItems(c) {
  if (c.type !== 'bars' || !c.items?.length) return c;
  const col = c.filterCol || c.items.find((it) => it.filterCol)?.filterCol;
  const map = c.filterMap || c.items.find((it) => it.filterMap)?.filterMap;
  if (!col) return c;
  return {
    ...c,
    filterCol: col,
    filterMap: map,
    items: c.items.map((it) => ({
      ...it,
      filterCol: it.filterCol || col,
      filterValue: it.filterValue ?? it.label,
      filterMap: it.filterMap || map,
    })),
  };
}

function stampOverviewFilters(o) {
  if (!o?.charts) return o;
  return { ...o, charts: o.charts.map(stampBarItems) };
}

export function tableFilterGroups(feed) {
  const overview = feedOverview(feed);
  const groups = [];
  const seen = new Set();
  for (const c of overview.charts || []) {
    if (c.type !== 'bars') continue;
    const items = (c.items || []).filter((it) => it.filterCol);
    if (!items.length) continue;
    const col = items[0].filterCol;
    const map = items[0].filterMap || c.filterMap || '';
    const key = `${col}|${map}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({
      id: key,
      title: c.title,
      col,
      map,
      options: items.map((it) => ({
        label: it.label,
        n: it.value,
        filterCol: it.filterCol,
        filterValue: it.filterValue || it.label,
        filterMap: it.filterMap || map,
        filterValues: it.filterValues,
      })),
    });
  }
  const rows = dataRows(feed?.rows);
  for (const key of inferCats(rows)) {
    if (seen.has(`${key}|`)) continue;
    const items = countBy(rows, key).slice(0, 24);
    if (items.length < 2) continue;
    seen.add(`${key}|`);
    groups.push({
      id: key,
      title: labelize(key),
      col: key,
      map: '',
      options: items.map((it) => ({
        label: it.label,
        n: it.value,
        filterCol: key,
        filterValue: it.label,
      })),
    });
  }
  return groups;
}

const KPI_LABELS = {
  ROWS: 'RECORDS',
  LIVE: 'FEED STATE',
  ADAPTER: 'FEED TYPE',
  FIELDS: 'COLUMNS',
  'LARGEST GROUP': 'TOP CATEGORY',
  SOURCE: 'DATA SOURCE',
  COVERAGE: 'COVERAGE',
};

function humanizeKpi(k) {
  let label = String(k?.label || '').trim();
  if (!label) return k;
  if (KPI_LABELS[label]) label = KPI_LABELS[label];
  else if (/_/.test(label) || /^[A-Z]\d{2,}$/.test(label)) {
    label = label.replace(/_/g, ' ').replace(/\b\w+/g, (w) => w.toUpperCase());
  }
  return { ...k, label };
}

/** Cap at four decision-useful KPIs; never surface raw schema tokens as labels. */
export function feedOverview(feed) {
  const ov = stampOverviewFilters(computeFeedOverview(feed));
  ov.kpis = (ov.kpis || []).slice(0, 4).map(humanizeKpi);
  return ov;
}

function computeFeedOverview(feed) {
  const rows = dataRows(feed?.rows);
  const n = rows.length;
  const feature = feed?.feature || 'Feed';
  if (isNationalFeature(feature, feed)) return nationalOverview(feed);
  const base = {
    title: overviewTitle(feature),
    kpis: [],
    charts: [],
    note: feed?.source?.note || '',
  };
  if (!n) {
    base.kpis = [
      { label: 'ROWS', value: 0, sub: 'no records in this view' },
      { label: 'LIVE', value: '—', sub: 'no table to summarise' },
      { label: 'COVERAGE', value: '—', sub: feed?.coverage?.from || 'see source status' },
      { label: 'ADAPTER', value: (feed?.source?.adapter || '—').toUpperCase(), sub: 'labelled status only' },
    ];
    return base;
  }

  const geo = geoBoothOverview(feature, rows, base);
  if (geo) return geo;

  const law = lawOverview(feature, rows, base);
  if (law) return law;

  const finance = financeOverview(feature, rows, base, feed);
  if (finance) return finance;

  const carbon = carbonOverview(feature, rows, base, feed);
  if (carbon) return carbon;

  const sports = sportsOverview(feature, rows, base, feed);
  if (sports) return sports;

  const entertainment = entertainmentOverview(feature, rows, base, feed);
  if (entertainment) return entertainment;

  if (/^infra$/i.test(feature)) {
    const operational = rows.filter((r) => /^(operational|implemented)/i.test(val(r, 'status'))).length;
    const regions = new Set(rows.map((r) => val(r, 'region') || val(r, 'country')).filter(Boolean)).size;
    const sectors = new Set(rows.map((r) => val(r, 'sector')).filter(Boolean)).size;
    base.title = 'KEY INDICATORS';
    base.kpis = [
      { label: 'PROJECTS', value: n, sub: 'strategic assets' },
      { label: 'OPERATIONAL', value: operational, sub: 'commissioned', tone: 'ok' },
      { label: 'REGIONS', value: regions, sub: 'covered' },
      { label: 'SECTORS', value: sectors, sub: 'ports, corridors…' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'PROJECTS BY STATUS',
        hint: 'Counts from this register. Status is the latest public milestone, not a delivery score.',
        filterCol: 'status',
        items: withTones(countBy(rows, 'status'), 'infra'),
      },
    ];
    return base;
  }

  if (/^satellite infrastructure$/i.test(feature)) {
    const providers = new Set(rows.map((r) => val(r, 'provider')).filter(Boolean)).size;
    const pads = new Set(rows.map((r) => val(r, 'pad') || val(r, 'country')).filter(Boolean)).size;
    base.title = 'KEY INDICATORS';
    base.kpis = [
      { label: 'LAUNCHES', value: n, sub: 'upcoming roster' },
      { label: 'PROVIDERS', value: providers, sub: 'in this window' },
      { label: 'PADS', value: pads, sub: 'launch geographies' },
      { label: 'SOURCE', value: 'LIVE', sub: 'The Space Devs' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'BY STATUS',
        filterCol: 'status',
        items: withTones(countBy(rows, 'status'), 'infra'),
      },
    ];
    return base;
  }

  if (/^world constitutions$/i.test(feature)) {
    const years = rows.map((r) => Number(val(r, 'enacted'))).filter((y) => Number.isFinite(y) && y > 0);
    const latest = years.length ? Math.max(...years) : '—';
    const oldest = years.length ? Math.min(...years) : '—';
    base.title = 'KEY INDICATORS';
    base.kpis = [
      { label: 'IN FORCE', value: n, sub: 'constitutions' },
      { label: 'LATEST', value: latest, sub: 'year enacted' },
      { label: 'EARLIEST', value: oldest, sub: 'year enacted' },
      { label: 'SOURCE', value: 'LIVE', sub: 'Constitute Project' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'ENACTED BY DECADE',
        hint: 'Counts from Constitute Project in-force records. Year is enactment, not last amendment.',
        filterCol: 'enacted',
        filterMap: 'decade',
        items: withTones(
          countBy(rows, 'enacted', (y) => {
            const yr = Number(y);
            if (!Number.isFinite(yr) || yr < 1000) return 'Unknown';
            return `${Math.floor(yr / 10) * 10}s`;
          }),
          'infra',
        ),
      },
    ];
    return base;
  }

  if (/^growth indicators$/i.test(feature)) {
    const withGdp = rows.filter((r) => val(r, 'gdp_growth')).length;
    const year = [...new Set(rows.map((r) => val(r, 'year')).filter(Boolean))][0] || '—';
    base.note =
      feed?.meta?.boardNote ||
      'Units are percent. Fiscal balance and revisions stay Not reported until those series are connected.';
    base.kpis = [
      { label: 'ECONOMIES', value: n, sub: 'World Bank set' },
      { label: 'WITH GDP', value: withGdp, sub: 'most recent year' },
      { label: 'YEAR', value: year, sub: 'latest comparable period' },
      { label: 'SOURCE', value: 'World Bank', sub: 'WDI' },
    ];
    return base;
  }

  if (/^heads of state$/i.test(feature)) {
    const withHog = rows.filter((r) => val(r, 'head_of_government') && val(r, 'head_of_government') !== '—').length;
    const verified = rows.filter((r) => val(r, 'name') && !/^not verified$/i.test(val(r, 'name'))).length;
    base.title = 'KEY INDICATORS';
    base.note =
      'Cards use Country · Name · Office · Status · Term start · Next transition · Last verified. Placeholder titles show as Not verified — not a ranking.';
    base.kpis = [
      { label: 'STATES', value: n, sub: 'in this table' },
      { label: 'NAMED', value: verified || withHog || n, sub: 'verified display names' },
      { label: 'SOURCE', value: feed?.fallback ? 'REGISTER' : 'LIVE', sub: feed?.fallback ? 'curated list' : 'Wikidata' },
      { label: 'COVERAGE', value: feed?.fallback ? (feed?.meta?.asOf || '—') : 'UN', sub: feed?.fallback ? 'as of' : 'member states' },
    ];
    return base;
  }

  if (/^global commodities$/i.test(feature)) {
    const groups = new Set(rows.map((r) => val(r, 'group')).filter(Boolean)).size;
    const up = rows.filter((r) => /^\+/.test(val(r, 'change'))).length;
    const down = rows.filter((r) => /^-/.test(val(r, 'change'))).length;
    base.title = 'KEY INDICATORS';
    base.kpis = [
      { label: 'BENCHMARKS', value: n, sub: 'in this board' },
      { label: 'COMPLEXES', value: groups || 4, sub: 'energy, metals…' },
      { label: 'UP', value: up, sub: 'printed change', tone: 'ok' },
      { label: 'DOWN', value: down, sub: 'printed change' },
    ];
    base.charts = [
      {
        type: 'bars',
        title: 'BY GROUP',
        hint: 'Counts from the HTML commodity board. Levels are as-of the pack date, not a live ticker.',
        filterCol: 'group',
        items: withTones(countBy(rows, 'group'), 'infra'),
      },
    ];
    return base;
  }

  if (/^global trade$/i.test(feature)) {
    const withShare = rows.filter((r) => val(r, 'trade_gdp') && val(r, 'trade_gdp') !== '—').length;
    const year = [...new Set(rows.map((r) => val(r, 'year')).filter(Boolean))][0] || '—';
    base.title = 'KEY INDICATORS';
    base.kpis = [
      { label: 'ECONOMIES', value: n, sub: 'World Bank set' },
      { label: 'WITH TRADE/GDP', value: withShare, sub: 'published share' },
      { label: 'YEAR', value: year, sub: 'indicator vintage' },
      { label: 'SOURCE', value: 'LIVE', sub: 'World Bank' },
    ];
    return base;
  }

  if (/^critical minerals$/i.test(feature)) {
    base.title = 'KEY INDICATORS';
    base.note =
      feed?.meta?.boardNote ||
      'Producer lists may be prose. Top-3 share, processor, import dependency, and risk stay Not reported until structured fields arrive.';
    base.kpis = [
      { label: 'MINERALS', value: n, sub: 'in this register' },
      { label: 'BASIS', value: 'USGS', sub: 'commodity summaries' },
      { label: 'AS OF', value: feed?.meta?.asOf || '2025', sub: 'curated reference' },
      { label: 'FEED', value: 'REGISTER', sub: 'not a live ticker' },
    ];
    return base;
  }

  const intensityKey = findKey(rows, ['intensity']);
  const regionKey = findKey(rows, ['region', 'country', 'countryname']);
  const stageKey = findKey(rows, ['current_stage', 'stage']);
  const trendKey = findKey(rows, ['trend']);
  const typeKey = findKey(rows, ['conflict_type', 'type']);
  const houseKey = findKey(rows, ['house']);
  const sectorKey = findKey(rows, ['sector', 'ministry']);
  const startedKey = findKey(rows, ['started', 'date_introduced', 'date', 'year']);
  const cats = inferCats(rows);

  if (intensityKey && regionKey) {
    const active = rows.filter((r) => /active|fighting|hostil/i.test(val(r, stageKey))).length;
    const high = rows.filter((r) => /critic|high/i.test(val(r, intensityKey))).length;
    const esc = rows.filter((r) => /escalat/i.test(val(r, trendKey))).length;
    base.title = /front/i.test(feature) ? 'FRONTS OVERVIEW' : overviewTitle(feature);
    base.kpis = [
      { label: 'CONFLICTS TRACKED', value: n, sub: 'active / recent worldwide' },
      { label: 'ACTIVE HOSTILITIES', value: active, sub: 'currently fighting' },
      { label: 'HIGH INTENSITY', value: pct(high, n), sub: `${high} critical / high` },
      { label: 'ESCALATING', value: pct(esc, n), sub: `${esc} trending upward` },
    ];
    base.charts.push({
      type: 'matrix',
      title: 'CONCENTRATION — REGION × INTENSITY',
      hint: 'Cell counts from this table. Empty cells have no rows. Not a statistical measure. Click a region or intensity label to filter.',
      rowFilterCol: regionKey,
      colFilterCol: intensityKey,
      colFilterMap: 'intensity',
      matrix: crosstab(rows, regionKey, intensityKey, INTENSITY_ORDER, 10),
    });
    if (trendKey) {
      base.charts.push({
        type: 'bars',
        title: 'ESCALATION MOMENTUM',
        hint: 'Row counts by the trend field in this table.',
        filterCol: trendKey,
        filterMap: 'trend',
        items: withTones(countBy(rows, trendKey, trendBucket, TREND_ORDER), 'trend'),
      });
    }
    base.charts.push({
      type: 'bars',
      title: 'INTENSITY PROFILE',
      hint: 'Row counts by the intensity field in this table.',
      filterCol: intensityKey,
      filterMap: 'intensity',
      items: withTones(countBy(rows, intensityKey, intensityBucket, INTENSITY_ORDER), 'intensity'),
    });
    if (typeKey) {
      base.charts.push({
        type: 'bars',
        title: 'CONFLICT TYPOLOGY',
        hint: 'Row counts by conflict type. Top groups shown.',
        filterCol: typeKey,
        items: withTones(countBy(rows, typeKey).slice(0, 8), 'gradient'),
      });
    }
    if (stageKey) {
      base.charts.push({
        type: 'bars',
        title: 'CONFLICT POSTURE',
        hint: 'Row counts by current stage in this table.',
        filterCol: stageKey,
        items: withTones(countBy(rows, stageKey), 'posture'),
      });
    }
    const spark = yearSeries(rows, startedKey);
    if (spark) {
      base.charts.push({
        type: 'spark',
        title: 'CONFLICT ONSETS BY YEAR',
        hint: spark.older
          ? `Onsets ${spark.from}–${spark.through} from the started field. ${spark.older} earlier records are outside this window.`
          : `Onsets ${spark.from}–${spark.through} from the started field.`,
        ...spark,
      });
    }
    return base;
  }

  if (/bill passage/i.test(feature)) {
    const passed = rows.filter((r) => /pass|enact|assent/i.test(val(r, 'current_stage') || val(r, 'status'))).length;
    const ls = rows.filter((r) => /lok/i.test(val(r, houseKey))).length;
    const col = cats.find((k) => k !== houseKey) || 'current_stage';
    base.title = 'BILLS OVERVIEW';
    base.kpis = [
      { label: 'BILLS IN VIEW', value: n, sub: feed?.coverage?.exhaustive ? 'full list + live' : 'rows loaded' },
      { label: 'LOK SABHA', value: ls, sub: `${n - ls} other house / unmarked` },
      { label: 'PASSED / ENACTED', value: passed, sub: 'stage label in the table' },
      { label: 'FROM', value: (feed?.coverage?.from || '—').slice(0, 4) || '—', sub: feed?.coverage?.through || '' },
    ];
    base.charts.push({
      type: 'matrix',
      title: `COUNTS — HOUSE × ${String(col).replace(/_/g, ' ').toUpperCase()}`,
      hint: 'Counts from this table, not a statistical measure. Click a house or column label to filter.',
      rowFilterCol: houseKey,
      colFilterCol: col,
      matrix: crosstab(rows, houseKey, col, null, 8),
    });
    base.charts.push({
      type: 'bars',
      title: 'BY HOUSE',
      filterCol: houseKey,
      items: withTones(countBy(rows, houseKey), 'gradient'),
      hint: 'Row counts by house.',
    });
    if (findKey(rows, ['current_stage'])) {
      base.charts.push({
        type: 'bars',
        title: 'BY STAGE',
        filterCol: 'current_stage',
        items: withTones(countBy(rows, 'current_stage').slice(0, 8), 'posture'),
        hint: 'Row counts by current stage.',
      });
    }
    const spark = yearSeries(rows, startedKey, 1952);
    if (spark) {
      base.charts.push({
        type: 'spark',
        title: 'INTRODUCED BY YEAR',
        hint: spark.hint || `Year parsed from the date field (${spark.from}–${spark.through}).`,
        ...spark,
      });
    }
    return base;
  }

  if (/parliamentary question/i.test(feature)) {
    const starred = rows.filter((r) => /star/i.test(val(r, 'question_type'))).length;
    const mins = new Set(rows.map((r) => val(r, 'ministry')).filter(Boolean)).size;
    base.title = 'KEY INDICATORS';
    base.kpis = [
      { label: 'QUESTIONS', value: n, sub: 'in this view' },
      { label: 'STARRED', value: starred, sub: `${n - starred} unstarred / other` },
      { label: 'MINISTRIES', value: mins, sub: 'named in this table' },
      { label: 'SOURCE', value: feed?.fallback ? 'STORED' : 'LIVE', sub: 'Sansad / register' },
    ];
    base.charts = [{ type: 'bars', title: 'BY MINISTRY', filterCol: 'ministry', items: withTones(countBy(rows, 'ministry').slice(0, 8), 'gradient'), hint: 'Row counts by ministry.' }];
    return base;
  }

  if (/regulatory body watch/i.test(feature)) {
    base.title = 'KEY INDICATORS';
    base.kpis = [
      { label: 'ITEMS', value: n, sub: 'circulars / notices' },
      { label: 'REGULATORS', value: new Set(rows.map((r) => val(r, 'regulator')).filter(Boolean)).size, sub: 'in this view' },
      { label: 'SOURCE', value: feed?.fallback ? 'STORED' : 'LIVE', sub: 'feeds or register' },
      { label: 'FEED', value: 'WATCH', sub: 'not an enforcement score' },
    ];
    base.charts = [{ type: 'bars', title: 'BY REGULATOR', filterCol: 'regulator', items: withTones(countBy(rows, 'regulator'), 'infra'), hint: 'Row counts by issuing regulator.' }];
    return base;
  }

  if (/candidate affidavit/i.test(feature)) {
    const withCases = rows.filter((r) => Number(val(r, 'criminal_cases')) > 0).length;
    base.title = 'KEY INDICATORS';
    base.kpis = [
      { label: 'CANDIDATES', value: n, sub: 'in this register' },
      { label: 'WITH CASES', value: withCases, sub: 'criminal_cases > 0' },
      { label: 'PARTIES', value: new Set(rows.map((r) => val(r, 'party')).filter(Boolean)).size, sub: 'named' },
      { label: 'SOURCE', value: 'REGISTER', sub: 'MyNeta / ADR basis' },
    ];
    return base;
  }

  if (/mp profiles/i.test(feature)) {
    base.title = 'KEY INDICATORS';
    base.kpis = [
      { label: 'MEMBERS', value: n, sub: 'in this roster' },
      { label: 'PARTIES', value: new Set(rows.map((r) => val(r, 'party')).filter(Boolean)).size, sub: 'named' },
      { label: 'STATES', value: new Set(rows.map((r) => val(r, 'state')).filter(Boolean)).size, sub: 'named' },
      { label: 'SOURCE', value: feed?.fallback ? 'STORED' : 'LIVE', sub: 'Sansad / register' },
    ];
    return base;
  }

  const a = cats[0] || sectorKey;
  const b = cats[1];
  const distinct = a ? new Set(rows.map((r) => val(r, a)).filter(Boolean)).size : 0;
  const grouped = a ? countBy(rows, a) : [];
  const top = grouped[0];
  base.kpis = [
    { label: 'ROWS', value: n, sub: feed?.fallback ? 'rows in this view' : 'live feed' },
    { label: a ? String(a).replace(/_/g, ' ').toUpperCase() : 'FIELDS', value: distinct || Object.keys(rows[0] || {}).length, sub: a ? 'distinct values' : 'columns present' },
    { label: 'LARGEST GROUP', value: top ? pct(top.value, n) : '—', sub: top ? String(top.label).slice(0, 42) : 'no category field' },
    {
      label: 'SOURCE',
      value: feed?.tier === 'local' ? 'REGISTER' : feed?.fallback ? 'REGISTER' : 'LIVE',
      // F165: readable source names, never the internal adapter id.
      sub: feed?.tier === 'local' ? 'stored for this desk' : sourceNames(feed?.source?.links).slice(0, 2).join(', '),
    },
  ];
  if (a && b && a !== b) {
    base.charts.push({
      type: 'matrix',
      title: `COUNTS — ${labelize(a)} × ${labelize(b)}`,
      hint: 'Counts from this table, not a statistical measure. Click a row or column label to filter.',
      rowFilterCol: a,
      colFilterCol: b,
      matrix: crosstab(rows, a, b, null, 10),
    });
  }
  for (const key of cats.slice(0, 3)) {
    base.charts.push({
      type: 'bars',
      title: labelize(key),
      hint: `Row counts by ${key.replace(/_/g, ' ')}.`,
      filterCol: key,
      items: withTones(countBy(rows, key).slice(0, 8), 'gradient'),
    });
  }
  const spark = yearSeries(rows, startedKey, 2000);
  if (spark) {
    base.charts.push({
      type: 'spark',
      title: 'BY YEAR',
      hint: `Years parsed from dated fields (${spark.from}–${spark.through}).`,
      ...spark,
    });
  }
  return base;
}

function labelize(k) {
  return String(k || '').replace(/_/g, ' ').toUpperCase();
}

function overviewTitle(feature) {
  const f = String(feature || 'FEED').toUpperCase();
  if (/OPEN FRONTS|FRONT/.test(f)) return 'FRONTS OVERVIEW';
  if (/^ALLIANCES$/.test(f.trim())) return 'EVENT ANALYTICS';
  if (/^SANCTIONS$/.test(f.trim())) return 'EVENT ANALYTICS';
  if (/^GLOBAL AID$/.test(f.trim())) return 'EVENT ANALYTICS';
  if (/^INFRA$/.test(f.trim())) return 'KEY INDICATORS';
  if (/^NUCLEAR WATCH$/.test(f.trim())) return 'EVENT ANALYTICS';
  if (/^SATELLITE INFRASTRUCTURE$/.test(f.trim())) return 'KEY INDICATORS';
  if (/^WORLD CONSTITUTIONS$/.test(f.trim())) return 'KEY INDICATORS';
  if (/^GROWTH INDICATORS$/.test(f.trim())) return 'KEY INDICATORS';
  if (/^HEADS OF STATE$/.test(f.trim())) return 'KEY INDICATORS';
  if (/^GLOBAL COMMODITIES$/.test(f.trim())) return 'KEY INDICATORS';
  if (/^GLOBAL TRADE$/.test(f.trim())) return 'KEY INDICATORS';
  if (/^CRITICAL MINERALS$/.test(f.trim())) return 'KEY INDICATORS';
  if (/^ENERGY$/.test(f.trim())) return 'EVENT ANALYTICS';
  if (/^BOOTH REGISTER$/.test(f.trim())) return 'SIZE CHARTS';
  if (/^BOOTH DEMOGRAPHY$/.test(f.trim())) return 'ANALYTICS CHARTS';
  if (/^BOOTH BLOC COMPOSITION$/.test(f.trim())) return 'BLOC STRIPS';
  if (/BOOTH-?LEVEL ROLL CHURN/.test(f)) return 'NET-MOVEMENT CHARTS';
  if (/BILL PASSAGE|POLICY INTELLIGENCE GRAPH|PARLIAMENTARY QUESTION|REGULATORY BODY WATCH|CANDIDATE AFFIDAVIT|MP PROFILES|POLICY PIPELINE|CABINET|CENTRAL TENDER|AGMUT|BUDGET|INDUSTRY UPDATES|MANIFESTOS|DELIMITATION|MORNING BRIEF|STATEMENT/.test(f)) {
    return 'KEY INDICATORS';
  }
  if (/BILL/.test(f)) return 'BILLS OVERVIEW';
  const short = f.replace(/[^A-Z0-9 ]/g, '').split(' ').slice(0, 3).join(' ');
  return `${short || 'FEED'} OVERVIEW`;
}

const TONE_RGB = {
  crit: [192, 80, 80],
  high: [196, 110, 48],
  med: [196, 150, 40],
  low: [56, 130, 88],
};

export function matrixCellStyle(colLabel, value, colMax, sequential) {
  if (sequential) {
    if (!value) return { background: '#d7dde6', color: 'transparent' };
    const t = Math.min(1, value / Math.max(colMax || 1, 1));
    const mix = 0.42 + t * 0.58;
    const r = Math.round(255 + (40 - 255) * mix);
    const g = Math.round(255 + (70 - 255) * mix);
    const b = Math.round(255 + (110 - 255) * mix);
    return { background: `rgb(${r},${g},${b})`, color: mix > 0.58 ? '#fff' : '#243044' };
  }
  const s = String(colLabel || '').toLowerCase();
  let tone = 'med';
  if (/critic/.test(s)) tone = 'crit';
  else if (/^high/.test(s)) tone = 'high';
  else if (/low/.test(s)) tone = 'low';
  else if (/medium|moderat/.test(s)) tone = 'med';
  if (!value) {
    return { background: '#f3f4f6', color: 'transparent' };
  }
  const t = Math.min(1, value / Math.max(colMax || 1, 1));
  const [r, g, b] = TONE_RGB[tone];
  const mix = 0.28 + t * 0.72;
  const rr = Math.round(255 + (r - 255) * mix);
  const gg = Math.round(255 + (g - 255) * mix);
  const bb = Math.round(255 + (b - 255) * mix);
  const dark = mix > 0.55;
  return { background: `rgb(${rr},${gg},${bb})`, color: dark ? '#fff' : '#3f3f46' };
}
