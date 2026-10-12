import { countryPosition } from '../geoLookup.js';
import { othersSharing } from '../touchRules.js';
import { cap, dateLabel, plural, presentRows, sourceLinks } from './common.js';

/** Infra (strategic infrastructure register) → record panel (F121). Positions are country level. */
function statusOf(status) {
  const s = String(status || '').toLowerCase();
  if (/partial/.test(s)) return { text: 'Partly operational', tone: 'green' };
  if (/operational|implemented|complete/.test(s)) return { text: cap(status.replace(/\s*\(.*\)/, '')), tone: 'green' };
  if (/construction|development/.test(s)) return { text: cap(status), tone: 'amber' };
  if (/negotiat/.test(s)) return { text: 'Under negotiation', tone: 'amber' };
  if (/ongoing/.test(s)) return { text: 'Ongoing', tone: 'blue' };
  return status ? { text: cap(status), tone: 'grey' } : null;
}

export default function infra(row, ctx = {}) {
  const title = row.name || row.title || 'Asset';
  const badge = statusOf(row.status);
  const where = countryPosition(row.country);
  const asOf = dateLabel(ctx.feed?.meta?.asOf);
  const sameCountry = othersSharing(ctx.rows, row, 'country');
  const sameSector = othersSharing(ctx.rows, row, 'sector');

  return {
    title,
    meta: [row.region, row.sector].filter(Boolean),
    badge: badge || undefined,
    links: sourceLinks(row, row.source_label || 'Source record'),
    glance: {
      tiles: [
        { label: 'Status', value: badge?.text || 'Not on record', sub: 'as published', tone: badge?.tone === 'grey' ? undefined : badge?.tone },
        ...(row.expected ? [{ label: 'Expected', value: String(row.expected), sub: 'completion, as published' }] : []),
        { label: 'Sector', value: row.sector || 'Not on record' },
        { label: 'Country', value: row.country || 'Not on record' },
      ],
      visual: where ? {
        type: 'map',
        title: 'Asset on the map',
        right: badge?.text,
        points: [{ ...where, label: row.country, tone: 'blue', main: true }],
        caption: `${title} is placed at country level; the register holds no site coordinates.`,
      } : undefined,
    },
    about: {
      label: '02 · About this asset',
      rows: presentRows([['Region', row.region], ['Country', row.country], ['Sector', row.sector]]),
      cards: row.detail ? [{ heading: 'Project note', body: row.detail }] : [],
    },
    touches: {
      label: '03 · Asset & what it touches',
      lanes: ['COUNTRY', 'ASSET', 'SAME COUNTRY', 'SAME SECTOR'],
      nodes: {
        left: row.country ? { l1: row.country } : undefined,
        center: { code: 'A', l1: 'This asset', l2: badge?.text },
        right: sameCountry ? { l1: `${plural(sameCountry, 'other asset')} in ${row.country}` } : undefined,
        far: sameSector ? { l1: row.sector, l2: `${sameSector} more on record` } : undefined,
      },
      links: [
        ...(sameCountry ? [{ title: `Assets in ${row.country}`, detail: `${sameCountry} more on the register` }] : []),
        ...(sameSector ? [{ title: `Other: ${row.sector}`, detail: `${sameSector} more on the register` }] : []),
      ],
    },
    footer: {
      ask: 'Ask AI about this asset',
      provenance: { source: row.source_label || 'Strategic infrastructure register (curated)', asOf, flags: [] },
      note: 'A curated watch list of strategic infrastructure, not a project database. Positions are country level.',
    },
  };
}
