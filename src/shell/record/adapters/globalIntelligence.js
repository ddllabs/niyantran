import { countryPosition } from '../geoLookup.js';
import { originCountry } from '../touchRules.js';
import { cap, dateLabel, plural, presentRows, provenanceFlags, sourceLinks } from './common.js';

/**
 * Global Intelligence (Indian defence procurement watch list) → record panel (F121). The register
 * states a stage, a vendor and a note; it holds no contract values or step dates, so neither is shown.
 */
const STEPS = ['Negotiation or development', 'Contract or sanction', 'Trials', 'Deliveries', 'In service'];

function stageOf(stage) {
  const s = String(stage || '').toLowerCase();
  if (/inducted/.test(s)) return { index: 4, badge: { text: 'Inducted', tone: 'green' } };
  if (/^delivered/.test(s)) return { index: 3, badge: { text: 'Delivered', tone: 'green' }, detail: 'complete per register' };
  if (/deliver/.test(s)) return { index: 3, badge: { text: 'Deliveries under way', tone: 'blue' } };
  if (/tested/.test(s)) return { index: 2, badge: { text: 'Tested', tone: 'blue' } };
  if (/contract|signed/.test(s)) return { index: 1, badge: { text: 'Contract signed', tone: 'green' } };
  if (/negotiat/.test(s)) return { index: 0, badge: { text: 'Under negotiation', tone: 'amber' } };
  return { index: -1, badge: stage ? { text: cap(stage), tone: 'grey' } : null };
}

export default function globalIntelligence(row, ctx = {}) {
  const title = row.program_name || row.title || 'Programme';
  const { index, badge, detail } = stageOf(row.stage);
  const origin = originCountry(row.vendor_or_origin);
  const where = countryPosition(origin);
  const asOf = dateLabel(row.as_of);
  const rows = ctx.rows || [];
  const others = rows.filter((r) => r !== row && (r.program_name || r.title) !== title);
  const sameOrigin = origin ? others.filter((r) => originCountry(r.vendor_or_origin) === origin).length : 0;
  const sameCategory = row.category ? others.filter((r) => r.category === row.category).length : 0;

  return {
    title,
    meta: ['Defence procurement register', row.category].filter(Boolean),
    badge: badge || undefined,
    links: sourceLinks(row),
    glance: {
      tiles: [
        { label: 'Stage', value: badge?.text || 'Not on record', sub: 'procurement stage', tone: badge?.tone === 'grey' ? undefined : badge?.tone },
        { label: 'As of', value: asOf || 'Not on record', sub: 'register entry' },
        { label: 'Category', value: row.category || 'Not on record', sub: 'platform class' },
        { label: 'Value', value: 'Not on record', sub: 'quoted only if published' },
      ],
      visual: index >= 0 ? {
        type: 'timeline',
        title: 'Procurement stage',
        right: asOf ? `as of ${asOf}` : undefined,
        steps: STEPS.map((label, i) => ({ label, done: i < index, now: i === index, detail: i === index ? detail : undefined })),
        caption: 'Stage from the register entry. Earlier steps are implied by the current stage, not dated.',
      } : undefined,
      visual2: where ? {
        type: 'map',
        title: 'Origin on the map',
        right: row.vendor_or_origin,
        points: [{ ...where, label: origin, tone: 'blue', main: true }],
        caption: 'Vendor origin, at country level.',
      } : undefined,
    },
    about: {
      label: '02 · About this programme',
      rows: presentRows([
        ['Vendor / origin', row.vendor_or_origin],
        ['Register', 'Indian defence procurement watch list'],
      ]),
      cards: row.detail ? [{ heading: 'Programme note', body: row.detail }] : [],
    },
    touches: {
      label: '03 · Programme & what it touches',
      links: [
        ...(sameOrigin ? [{ title: `Programmes from ${origin}`, detail: `${sameOrigin} more on the watch list` }] : []),
        ...(sameCategory ? [{ title: `More ${String(row.category).toLowerCase()}`, detail: `${sameCategory} more on the watch list` }] : []),
      ],
    },
    footer: {
      ask: 'Ask AI about this programme',
      provenance: { source: 'Defence procurement register (published announcements)', asOf, flags: provenanceFlags(row) },
      note: `This register is a watch list${rows.length ? ` of ${plural(rows.length, 'programme')}` : ''}, not a procurement database. The panel states the stage on record and when it was last checked.`,
    },
  };
}
