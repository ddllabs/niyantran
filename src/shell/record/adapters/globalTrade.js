import { NOT_ON_RECORD, WORLD_BANK_SOURCE, asOfOf, economyMap, num, pct, rankOn, yearOf } from './growthIndicators.js';
import { presentRows, sourceLinks } from './common.js';

/**
 * Global Trade (World Bank merchandise exports and trade share of GDP) → record panel (F121).
 *
 * Rows come from loadTrade (server/resourcesApi.mjs): `exports_bn` is merchandise exports in US$
 * billions grouped en-IN (or ''), `exports_raw` is the API number, `trade_gdp` is trade as a % of
 * GDP to one decimal or the literal "—". The row carries one year, the exports series' latest, and
 * the panel does not claim the trade share is for that year. Annual national series only: no
 * forecast, nowcast or live figure is implied. Ranks use `exports_raw`, never the grouped text.
 */
export default function globalTrade(row, ctx = {}) {
  const title = row.country || row.title || 'Economy';
  const year = yearOf(row);
  const rows = ctx.rows || [];
  const exportsText = String(row.exports_bn ?? '').trim() && num(row.exports_raw) !== null ? `US$ ${String(row.exports_bn).trim()} bn` : null;
  const share = pct(row.trade_gdp);
  const rank = rankOn(rows, row, (r) => num(r?.exports_raw));
  const { asOf, flags } = asOfOf(year);

  return {
    title,
    meta: ['Global trade', year].filter(Boolean),
    links: sourceLinks(row, 'World Bank: merchandise exports series'),
    glance: {
      tiles: [
        { label: 'Merchandise exports', value: exportsText || NOT_ON_RECORD, sub: year ? `goods only, ${year}` : 'goods only' },
        { label: 'Export rank', value: rank ? rank.text : NOT_ON_RECORD, sub: 'highest first, this board' },
        { label: 'Latest year', value: year || NOT_ON_RECORD, sub: 'merchandise exports series' },
      ],
      visual: {
        type: 'board',
        title: 'Latest published values',
        right: year ? `Exports: ${year}` : undefined,
        rows: [
          { label: 'Merchandise exports', value: exportsText || NOT_ON_RECORD, note: year ? `current US$, ${year}` : 'current US$' },
          { label: 'Trade share of GDP', value: share || NOT_ON_RECORD, note: 'exports + imports of goods and services' },
        ],
        caption: 'Each figure is the latest value the World Bank publishes for this series. The row records one year, the exports series\', so the trade share is not asserted to share it.',
      },
      visual2: economyMap(title),
    },
    about: {
      label: '02 · About this economy',
      rows: presentRows([
        ['Latest year (exports)', year],
        ['Series', 'Merchandise exports, trade share of GDP'],
      ]),
      cards: [{
        heading: 'How to read this',
        body: 'Merchandise exports are the value of goods sold abroad in current US dollars; services are not included. Trade share of GDP adds exports and imports of goods and services and divides by GDP. Both are annual national series from the World Bank, not forecasts or nowcasts.',
      }],
    },
    touches: {
      label: '03 · Economy & what it touches',
      links: [
        ...(rank ? [{ title: 'Rank on merchandise exports', detail: `${rank.text} economies on this board, highest first` }] : []),
        { title: 'Growth Indicators', detail: 'GDP growth, inflation and unemployment', to: { tab: 'global', feature: 'Growth Indicators' } },
      ],
    },
    footer: {
      ask: 'Ask AI about this economy',
      provenance: { source: WORLD_BANK_SOURCE, asOf, flags },
      note: 'Annual national series from the World Bank, not forecasts or nowcasts, and not a monthly figure.',
    },
  };
}
