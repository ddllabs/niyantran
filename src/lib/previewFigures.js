// F144 (owner 2026-10-14): the homepage preview's figures that our data backs under their current
// labels, computed from the same snapshot files the terminal's desks read. scripts/build-preview-
// figures.mjs writes src/data/preview-figures.json from this; previewFigures.test.js recomputes it from
// the files and fails if they drift. Figures without data, or that would need a new label, are listed
// for the client in docs/research/2026-10-14-homepage-preview-for-client.md.
const key = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
// Spellings of one state or territory in the MP report card; "Nominated" is not a place.
const STATE_ALIASES = { 'jammu & kashmir': 'jammu and kashmir', 'national capital territory of delhi': 'nct of delhi' };
const NOT_A_STATE = new Set(['', 'nominated']);
// A true constant of the world: the Lok Sabha has 543 elected seats (Article 81, as fixed by the 2002
// delimitation). It is not a count from our data.
export const LOK_SABHA_SEATS = 543;
export const BILL_STAGES = ['Pending', 'Passed', 'Assented', 'Withdrawn'];

// A repeated key keeps its last row, as desk_rows does (the loader upserts in file order); checked
// against NTER on 2026-10-14: Pending 689, Passed 169, Assented 3,391, Withdrawn 361.
const distinctBy = (rows, pick) => {
  const seen = new Map();
  for (const row of rows || []) {
    const k = pick(row);
    if (k) seen.set(k, row);
  }
  return [...seen.values()];
};
const distinctCount = (rows, pick) => new Set((rows || []).map(pick).filter(Boolean)).size;

/** Unique source endpoint URLs across a registry's `sourceUrls` lists (newline- or pipe-separated). */
export function registryEndpointCount(registry) {
  const urls = new Set();
  for (const entry of registry || []) {
    for (const url of String(entry?.sourceUrls || '').split(/\s*\|\s*|\s+/)) if (/^https?:\/\//.test(url)) urls.add(url);
  }
  return urls.size;
}

const label = (v) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };

export function computePreviewFigures({ bills, fronts, mps, macro, regulatory, registry }) {
  const uniqueBills = distinctBy(bills, (r) => String(r.id || '').trim());
  const years = uniqueBills.map((r) => Number(String(r.date_introduced || '').slice(0, 4))).filter((y) => y > 1900);
  const stages = Object.fromEntries(BILL_STAGES.map((s) => [s, uniqueBills.filter((r) => key(r.current_stage) === s.toLowerCase()).length]));
  return {
    bills: {
      total: uniqueBills.length,
      houses: distinctCount(uniqueBills, (r) => key(r.house)),
      seriesStart: years.length ? Math.min(...years) : null,
      seriesEnd: years.length ? Math.max(...years) : null,
      stages,
    },
    fronts: {
      fronts: distinctCount(fronts, (r) => key(r.conflict_name)),
      regions: distinctCount(fronts, (r) => key(r.region)),
      // Fronts by current_stage, largest first; each front counted once, by its name.
      stages: Object.entries(
        distinctBy(fronts, (r) => key(r.conflict_name)).reduce((o, r) => { const k = label(r.current_stage); if (k) o[k] = (o[k] || 0) + 1; return o; }, {}),
      ).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    },
    mps: {
      states: new Set((mps || []).map((r) => STATE_ALIASES[key(r.state)] || key(r.state)).filter((s) => !NOT_A_STATE.has(s))).size,
    },
    macro: {
      series: (macro || []).length,
      publishers: distinctCount(macro, (r) => key(r.source)),
    },
    regulatory: {
      notices: distinctCount(regulatory, (r) => String(r.id || '').trim()),
      regulators: distinctCount(regulatory, (r) => key(r.regulator)),
    },
    // Unique source endpoint URLs in src/data/source-registry.json (the homepage's "Source endpoints").
    endpoints: registryEndpointCount(registry),
  };
}

/** A bar of the bill stage chart: [label, count, share label, width %, tone]. */
export function stageBar(label, figures, tone = '') {
  const count = figures.bills.stages[label];
  const share = figures.bills.total ? (count / figures.bills.total) * 100 : 0;
  // The printed share is exact; the drawn bar has a 2% floor so a small stage stays visible.
  return [label, count, `${share >= 10 ? Math.round(share) : share.toFixed(1)}%`, Math.max(share, 2), tone];
}

/** Bars for a list of [label, count] pairs, as a share of their total; same tuple shape as stageBar. */
export function shareBars(pairs, tones = ['', 'sand', '', 'red', '']) {
  const total = pairs.reduce((n, [, c]) => n + c, 0);
  return pairs.map(([name, count], i) => {
    const share = total ? (count / total) * 100 : 0;
    return [name, count, `${share >= 10 ? Math.round(share) : share.toFixed(1)}%`, Math.max(share, 2), tones[i % tones.length]];
  });
}
