import { hydrateSanction } from '../../../lib/sanctions.js';
import { countryPosition } from '../geoLookup.js';
import { dateLabel, cap, plural, presentRows, sourceLinks } from './common.js';

/**
 * Sanctions (the embedded programme register) → record panel (F121). Rows come through
 * flattenSanction (src/lib/sanctions.js), which the feed serves unchanged. A row holds a programme,
 * its issuing authorities as one text ("US OFAC · EU · UK"), a map anchor, sectors, measures,
 * exceptions, a watch list, a trail and source links. It holds no measure per authority, no list
 * date, no listed party and no programme code, so the panel states none of them and says that it
 * does not read the authorities' lists. The figures the old dossier computed are carried over from
 * hydrateSanction.
 */
const NOT_ON_RECORD = 'Not on record';

const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

/** A coordinate as a finite number within `limit` degrees, from a number or a plain decimal string; Number(null) and Number('') are 0, which is not a coordinate. */
function coordinate(value, limit) {
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(value.trim())) n = Number(value.trim());
  else return null;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/** The register's map position for the target, or null. Exactly (0, 0) is the "unknown" position, not a place. */
function targetPosition(row) {
  const lat = coordinate(row.lat, 90);
  const lon = coordinate(row.lon, 180);
  if (lat == null || lon == null || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}

/**
 * The state a named authority stands for, by the start of its label, or null for the EU, the UN and
 * anything else that is not one state. issuerTokens matches substrings, so it reads "AUS" as the
 * United States as well as Australia; the label's start is matched instead.
 */
const AUTHORITY_STATES = [
  [/^US\b/, 'United States'],
  [/^UK\b/, 'United Kingdom'],
  [/^Canada\b/i, 'Canada'],
  [/^Japan\b/i, 'Japan'],
  [/^(Australia|AUS)\b/, 'Australia'],
  [/^(S\.|South) Korea\b/i, 'South Korea'],
];
const stateOf = (label) => AUTHORITY_STATES.find(([pattern]) => pattern.test(label))?.[1] || null;

/** The authorities a row names, in order, one per distinct label. */
function authoritiesOf(issuer) {
  const labels = [...new Set(String(issuer ?? '').split('·').map((s) => s.trim()).filter(Boolean))];
  return labels.map((label) => ({ label, state: stateOf(label) }));
}

function badgeOf(status) {
  const name = cap(text(status).replace(/[-_]+/g, ' '));
  if (!name) return null;
  const s = name.toLowerCase();
  if (/active|escalat|in force/.test(s)) return { text: name, tone: 'red' };
  if (/review/.test(s)) return { text: name, tone: 'amber' };
  return { text: name, tone: 'grey' };
}

const joined = (list, sep) => list.map(text).filter(Boolean).join(sep);

export default function sanctions(row, ctx = {}) {
  const p = hydrateSanction(row || {}) || {};
  const title = text(row?.title) || text(row?.name) || text(p.name) || 'Sanctions programme';
  const sectors = (p.sectors || []).map(text).filter(Boolean);
  const instruments = (p.instruments || []).map(text).filter(Boolean);
  const exemptions = (p.exemptions || []).map(text).filter(Boolean);
  const target = text(p.target);
  const entities = text(p.entities);
  const region = text(p.region);
  const type = text(p.type);
  const authorities = authoritiesOf(p.issuer);
  const badge = badgeOf(p.status);
  const asOf = dateLabel(ctx.feed?.meta?.asOf);

  const sourceList = (p.sources || []).filter((s) => Array.isArray(s) && /^https:\/\//i.test(text(s[1])));
  const sourceLinked = sourceList.map(([label, href]) => ({ label: text(label) || 'Source record', href: text(href) }));
  const links = (sourceLinked.length ? sourceLinked : sourceLinks(row || {})).filter((l, i, all) => all.findIndex((o) => o.href === l.href) === i);
  const linkedLabels = [...new Set(links.map((l) => l.label))];

  // Map: the target at the register's anchor (a map position the register assigns, not a surveyed
  // location, so it is approximate), the issuing states at approximate country centres.
  const where = targetPosition(row || {});
  const placed = [];
  const unplaced = [];
  for (const a of authorities) {
    const pos = a.state ? countryPosition(a.state) : null;
    if (pos && !placed.some((q) => q.state === a.state)) placed.push({ ...a, pos });
    else if (!pos) unplaced.push(a.label);
  }
  const anchor = /thematic|network/i.test(type);
  const mapPoints = [
    ...(where ? [{ ...where, label: target ? `Target: ${target}` : 'Target', tone: 'red', main: true, approximate: true }] : []),
    ...placed.map((a) => ({ ...a.pos, label: a.label, tone: 'blue' })),
  ];
  const mapCaption = [
    where ? 'The red marker is the position the register holds for the target.' : placed.length ? 'The register holds no position for the target.' : '',
    where && anchor ? 'This programme is thematic or network-based, so the marker is a map anchor, not a location of the target.' : '',
    placed.length ? 'Blue markers are issuing states at approximate country centres.' : '',
    unplaced.length ? `Not placed on the map (no single country position): ${unplaced.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  const mapRight = [authorities.length ? plural(authorities.length, 'authority', 'authorities') : '', where ? '1 target' : ''].filter(Boolean).join(' · ');

  const board = authorities.length ? {
    type: 'board',
    title: 'Issuing authorities',
    right: plural(authorities.length, 'authority', 'authorities'),
    rows: authorities.map((a) => ({ label: a.label, value: 'Named issuer', note: a.state && countryPosition(a.state) ? undefined : 'not on the map' })),
    caption: 'The register names these authorities as issuers of the programme and lists its measures for the programme as a whole (see Measures on record). It does not say which authority imposes which measure.',
  } : undefined;

  // Other programmes in the same register region, never the selection (the row may be a copy of its feed row).
  const isSelf = (r) => r === row || (text(row?.id) !== '' && r?.id === row.id) || (text(row?.id) === '' && text(row?.title) !== '' && r?.title === row.title);
  const related = region
    ? (ctx.rows || []).filter((r) => r && !isSelf(r) && text(r.region).toLowerCase() === region.toLowerCase() && (text(r.title) || text(r.name)))
    : [];
  const relatedLinks = [];
  for (const r of related) {
    const name = text(r.title) || text(r.name);
    if (relatedLinks.length < 3 && !relatedLinks.some((l) => l.title === name)) relatedLinks.push({ title: name, detail: `Also in ${region}`, row: r });
  }

  const watch = (p.watch || []).filter((w) => Array.isArray(w) && text(w[0]));
  const trail = (p.trail || []).filter((t) => Array.isArray(t) && text(t[0]) && text(t[1]));
  const cards = [
    instruments.length ? { heading: 'Measures on record', body: instruments.join('; ') } : null,
    exemptions.length ? { heading: 'Licences and exceptions', body: exemptions.join('; ') } : null,
    watch.length ? { heading: 'Monitor now', body: `${watch.map((w) => `${text(w[0])}${text(w[1]) ? ` (${text(w[1])})` : ''}${text(w[2]) ? `: ${text(w[2])}` : ''}`).join('; ')}. Evidence categories, not a score.` } : null,
    trail.length ? { heading: 'Trail on record', body: trail.map((t) => `${text(t[0])}: ${text(t[1])}`).join('; ') } : null,
  ].filter(Boolean);

  return {
    title,
    meta: [text(p.issuer), type].filter(Boolean),
    badge: badge || undefined,
    links,
    glance: {
      tiles: [
        { label: 'Authorities', value: authorities.length ? String(authorities.length) : NOT_ON_RECORD, sub: authorities.length ? 'named as issuers' : undefined },
        { label: 'Target', value: target || NOT_ON_RECORD, sub: target ? 'recorded perimeter' : undefined },
        ...(entities ? [{ label: 'Listed scope', value: entities, sub: 'register descriptor' }] : []),
        ...(sectors.length ? [{ label: 'Sectors', value: String(sectors.length), sub: sectors.slice(0, 2).join(' · ') }] : []),
      ],
      visual: mapPoints.length ? { type: 'map', title: 'Who listed whom', right: mapRight || undefined, points: mapPoints, caption: mapCaption } : undefined,
      visual2: board,
      callout: { tone: 'red', text: 'A programme record, not a screening result. It does not establish that a named party is listed, whether a licence or wind-down authorisation applies, or secondary-sanctions exposure; those need a check against the issuing authority\'s current list.' },
    },
    about: {
      label: '02 · About this programme',
      rows: presentRows([['Policy objective', text(p.reason)], ['Legal basis', text(p.basis)], ['Region', region], ['Sectors', joined(sectors, ' · ')]]),
      cards,
    },
    touches: {
      label: '03 · Programme & what it touches',
      links: relatedLinks,
    },
    footer: {
      ask: 'Ask AI about this programme',
      provenance: {
        source: 'Sanctions programme register (stored on the platform)',
        asOf: asOf || undefined,
        flags: ['issuing lists not read', ...(links.length ? [] : ['no issuing list linked']), ...(asOf ? [] : ['as-of not on record'])],
      },
      note: `Programme descriptions are the platform's own register${asOf ? ` as of ${asOf}` : ''}. ${linkedLabels.length ? `Linked for reference: ${linkedLabels.join(', ')}. ` : ''}This panel does not read any issuing authority's list, so it shows no listing, programme code or list date.`,
    },
  };
}
