/**
 * Honest UI shaping for Global boards that still lack full field schemas.
 * Fills display gaps with "Not reported" — does not invent shares or names.
 */

function empty(v) {
  return v == null || String(v).trim() === '' || String(v).trim() === '—';
}

function nr(v) {
  return empty(v) ? 'Not reported' : v;
}

function guessPeriodType(row) {
  const t = String(row.period_type || row.type || row.series_type || '').toLowerCase();
  if (/forecast|proj/i.test(t)) return 'Forecast';
  if (/quarter|q[1-4]/i.test(t) || /quarter/i.test(String(row.period || ''))) return 'Observed quarterly';
  if (/annual|year|wdi/i.test(t)) return 'Observed annual';
  if (row.year || row.period) return 'Observed annual';
  return 'Not reported';
}

export function shapeGrowthIndicatorRows(rows) {
  return (rows || []).map((r) => {
    if (r?.status === 'source_status') return r;
    const period = r.period || r.year || r.date || '';
    return {
      ...r,
      economy: r.economy || r.country || r.title || '',
      title: r.title || r.country || r.economy || '',
      period: period || 'Not reported',
      year: r.year || period || '',
      period_type: guessPeriodType(r),
      real_gdp_growth: empty(r.real_gdp_growth) ? nr(r.gdp_growth) : r.real_gdp_growth,
      gdp_growth: nr(r.gdp_growth),
      inflation: nr(r.inflation),
      unemployment: nr(r.unemployment),
      fiscal_balance: nr(r.fiscal_balance ?? r.fiscal_balance_pct),
      source: r.source || r.sourceName || 'World Bank WDI',
      revision: nr(r.revision || r.revised),
      unit_note: '% unless noted · comparable period = latest year in row',
    };
  });
}

export function shapeCriticalMineralRows(rows) {
  return (rows || []).map((r) => {
    if (r?.status === 'source_status') return r;
    return {
      ...r,
      mineral: r.mineral || r.name || r.title || '',
      title: r.title || r.mineral || r.name || '',
      producers: r.producers || r.topProducers || 'Not reported',
      note: r.note || r.strategic_note || '',
      top3_share: nr(r.top3_share ?? r.top_3_share ?? r.chinaShare),
      top_processor: nr(r.top_processor ?? r.processor),
      import_dependency: nr(r.import_dependency ?? r.import_dep),
      risk: nr(r.risk ?? r.status),
      data_year: nr(r.data_year ?? r.year ?? r.as_of),
      methodology:
        r.methodology ||
        'Producer lists may be prose. Share %, processor, import dependency, and risk stay Not reported until structured fields arrive. Risk basis and vintage belong in the side panel.',
    };
  });
}

export function applyGlobalBoardShapingToFeed(feed) {
  if (!feed?.feature || !Array.isArray(feed.rows)) return feed;
  const f = feed.feature;
  if (/^growth indicators$/i.test(f)) {
    const rows = shapeGrowthIndicatorRows(feed.rows);
    return {
      ...feed,
      rows,
      meta: {
        ...(feed.meta || {}),
        boardNote:
          'Units are percent. Period type is labelled when known. Fiscal balance and revisions show Not reported until those series are connected.',
      },
    };
  }
  if (/^critical minerals$/i.test(f)) {
    const rows = shapeCriticalMineralRows(feed.rows);
    return {
      ...feed,
      rows,
      meta: {
        ...(feed.meta || {}),
        boardNote:
          'Leading producers stay as text when that is all we have. Top-3 share, processor, import dependency, risk, and data year show Not reported when the source does not give them; nothing is invented.',
        sensitiveTitle: 'Concentration register — structured shares incomplete',
      },
    };
  }
  return feed;
}
