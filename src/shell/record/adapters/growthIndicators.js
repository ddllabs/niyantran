import { countryPosition } from '../geoLookup.js';
import { presentRows, sourceLinks } from './common.js';

/**
 * Growth Indicators (World Bank GDP growth, inflation, unemployment) → record panel (F121).
 *
 * Rows come from loadGrowth (server/resourcesApi.mjs): one row per economy, `year` is the latest
 * published year of GDP growth, and `inflation` / `unemployment` are a one-decimal string or the
 * literal "—" when the World Bank has no value. The row carries one year only, so the panel dates
 * GDP growth and does not claim the other two series share that year. Everything here is an annual
 * national series: no forecast, nowcast or live figure is implied.
 *
 * The helpers marked "shared" are also used by globalTrade.js (the same World Bank row shape).
 */

export const WORLD_BANK_SOURCE = 'World Bank open data (World Development Indicators)';
export const NOT_ON_RECORD = 'Not on record';
export const NO_AS_OF = 'as-of not on record';

/** shared: a finite number from a row field, or null for '', "—", null or anything non-numeric. */
export function num(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** shared: the row's four-digit data year, or ''. */
export const yearOf = (row) => {
  const year = String(row?.year ?? '').trim();
  return /^\d{4}$/.test(year) ? year : '';
};

/** shared: "7.4%" for a numeric field, or null when it is not on record. */
export function pct(value) {
  const n = num(value);
  return n === null ? null : `${n.toFixed(1)}%`;
}

/** shared: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
}

/** shared: the same economy, by identity or by name (the selection may be a copy of its feed row). */
const sameEconomy = (a, b) => a === b || Boolean(a?.country && a.country === b?.country);

/**
 * shared: where `row` stands among `rows` on a numeric value, highest first. Ties share a rank.
 * Null when the row has no value or there is nothing to compare it with.
 * Returns { rank, total, tied, text } where text reads "joint 4th of 7".
 */
export function rankOn(rows, row, valueOf) {
  const mine = valueOf(row);
  if (mine === null) return null;
  const others = (rows || []).filter((r) => !sameEconomy(r, row)).map(valueOf).filter((v) => v !== null);
  if (!others.length) return null;
  const rank = 1 + others.filter((v) => v > mine).length;
  const tied = others.some((v) => v === mine);
  const total = others.length + 1;
  return { rank, total, tied, text: `${tied ? 'joint ' : ''}${ordinal(rank)} of ${total}` };
}

/** shared: the country map (approximate), or undefined when the lookup does not know the country. */
export function economyMap(country) {
  const where = countryPosition(country);
  if (!where) return undefined;
  return {
    type: 'map',
    title: 'Economy on the map',
    right: country,
    points: [{ ...where, label: country, tone: 'blue', main: true }],
    caption: `${country} is placed at country level (approximate); the data holds no coordinates.`,
  };
}

/** shared: the as-of text and flags for a data year. */
export const asOfOf = (year) => (year
  ? { asOf: `${year} (latest published year)`, flags: [] }
  : { asOf: '', flags: [NO_AS_OF] });

export default function growthIndicators(row, ctx = {}) {
  const title = row.country || row.title || 'Economy';
  const year = yearOf(row);
  const rows = ctx.rows || [];
  const gdp = num(row.gdp_growth);
  const gdpText = pct(row.gdp_growth);
  const inflation = pct(row.inflation);
  const unemployment = pct(row.unemployment);
  const rank = rankOn(rows, row, (r) => num(r?.gdp_growth));
  const sameYear = year ? rows.filter((r) => !sameEconomy(r, row) && yearOf(r) === year).length : 0;
  const { asOf, flags } = asOfOf(year);
  const fall = gdp !== null && gdp < 0;

  return {
    title,
    meta: ['Growth indicators', year].filter(Boolean),
    links: sourceLinks(row, 'World Bank: GDP growth series'),
    glance: {
      tiles: [
        { label: 'GDP growth', value: gdpText || NOT_ON_RECORD, sub: year ? `annual %, ${year}` : 'annual %', tone: fall ? 'red' : undefined },
        { label: 'Rank on GDP growth', value: rank ? rank.text : NOT_ON_RECORD, sub: 'highest first, this board' },
        { label: 'Latest year', value: year || NOT_ON_RECORD, sub: 'GDP growth series' },
      ],
      visual: {
        type: 'board',
        title: 'Latest published values',
        right: year ? `GDP growth: ${year}` : undefined,
        rows: [
          { label: 'GDP growth', value: gdpText || NOT_ON_RECORD, note: year ? `annual %, ${year}` : 'annual %', tone: fall ? 'red' : undefined },
          { label: 'Inflation', value: inflation || NOT_ON_RECORD, note: 'consumer prices, annual %' },
          { label: 'Unemployment', value: unemployment || NOT_ON_RECORD, note: '% of labour force' },
        ],
        caption: 'Each figure is the latest value the World Bank publishes for this series. The row records one year, GDP growth\'s, so inflation and unemployment are not asserted to share it.',
      },
      visual2: economyMap(title),
    },
    about: {
      label: '02 · About this economy',
      rows: presentRows([
        ['Latest year (GDP growth)', year],
        ['Series', 'GDP growth, inflation, unemployment'],
      ]),
      cards: [{
        heading: 'How to read this',
        body: 'GDP growth is the yearly change in real (constant-price) GDP. Inflation is the yearly change in consumer prices. Unemployment is the share of the labour force without work. All three are annual national series from the World Bank, not forecasts or nowcasts.',
      }],
    },
    touches: {
      label: '03 · Economy & what it touches',
      links: [
        ...(rank ? [{ title: 'Rank on GDP growth', detail: `${rank.text} economies on this board, highest first` }] : []),
        ...(sameYear ? [{ title: `Economies with ${year} data`, detail: `${sameYear} more on this board` }] : []),
        { title: 'Global Trade', detail: 'Merchandise exports and trade share of GDP', to: { tab: 'global', feature: 'Global Trade' } },
      ],
    },
    footer: {
      ask: 'Ask AI about this economy',
      provenance: { source: WORLD_BANK_SOURCE, asOf, flags },
      note: 'Annual national series from the World Bank, not forecasts or nowcasts, and not a monthly figure.',
    },
  };
}
