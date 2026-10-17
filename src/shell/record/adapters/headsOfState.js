import leadersPack from '../../../data/leaders.json';
import { countryPosition } from '../geoLookup.js';
import { othersSharing } from '../touchRules.js';
import { dateLabel, presentRows } from './common.js';

/**
 * Heads of State (the embedded world-leaders register) → record panel (F121).
 *
 * The rows come through flattenLeader (src/lib/globalResources.js), which fills defaults that are not
 * data: status 'Tracked' (or 'Not verified'), next_transition 'Not reported', authority 'De jure (as
 * listed)', a placeholder name 'Not verified', and the Wikidata home page as source_url. The pack's
 * profiles set none of those fields, so each default reads as "not on record" here and is shown only
 * when a profile really sets a different value. A dash in party or ideology and a missing age are
 * absent too. Positions are country centres; the register holds no coordinates.
 */
const DEFAULT_STATUS = /^(tracked|not verified)$/i;
const DEFAULT_AUTHORITY = /^de jure \(as listed\)$/i;

/** A field's text, or '' when it is empty, a dash, or the "Not reported" default. */
function real(value) {
  const s = String(value ?? '').trim();
  return /^(|[—–-]|not reported|n\/a)$/i.test(s) ? '' : s;
}

/** A date or month the register writes in ISO form ("2020-05", "2020-05-17"); dateLabel would also read a bare year as 1 January. */
const ISO = /^\d{4}-(0[1-9]|1[0-2])(-\d{2}.*)?$/;

/** A full date or month as a label ("May 2020"); a bare year or any other text as written. */
function sinceLabel(value) {
  const s = real(value);
  return ISO.test(s) ? dateLabel(s) || s : s;
}

/** An as-of label from a date, month or year; '' when the text is not one (a bare year stays a year). */
function asOfLabel(value) {
  const s = real(value);
  if (/^\d{4}$/.test(s)) return s;
  return ISO.test(s) ? dateLabel(s) : '';
}

function badgeOf(status) {
  const s = real(status);
  if (!s || DEFAULT_STATUS.test(s)) return null;
  return { text: s, tone: /acting|interim|caretaker|disputed/i.test(s) ? 'amber' : 'grey' };
}

export default function headsOfState(row, ctx = {}) {
  const name = real(row.name ?? row.title);
  const unverified = !name || /^not verified$/i.test(name);
  const office = real(row.office || row.role);
  const country = real(row.country);
  const title = unverified ? [office, country].filter(Boolean).join(', ') || 'Leader' : name;
  const badge = unverified ? { text: 'Not verified', tone: 'amber' } : badgeOf(row.status);
  const since = sinceLabel(row.term_start || row.since);
  const age = real(row.age);
  const party = real(row.party);
  const ideology = real(row.ideology);
  const next = real(row.next_transition);
  const authority = DEFAULT_AUTHORITY.test(real(row.authority)) ? '' : real(row.authority);
  const latest = real(row.latest);
  const where = countryPosition(country);
  // The row's own check date when it is real, then the feed's, then the pack's: it always has one.
  const asOf = asOfLabel(row.last_verified || row.as_of) || asOfLabel(ctx.feed?.meta?.asOf) || asOfLabel(leadersPack.asOf);
  // Never group on an empty ideology: nine profiles share the dash.
  const sameIdeology = ideology ? othersSharing(ctx.rows, row, 'ideology') : 0;

  return {
    title,
    meta: unverified ? ['Heads of State register'] : [country, office].filter(Boolean),
    badge: badge || undefined,
    links: /^https:\/\/www\.wikidata\.org\/wiki\/Q[1-9][0-9]*$/.test(String(row.source_url || ''))
      ? [{ label: 'Wikidata source record', href: row.source_url }] : [],
    glance: {
      tiles: [
        { label: 'Office', value: office || 'Not on record' },
        { label: 'In office since', value: since || 'Not on record', sub: since ? 'as listed' : undefined },
        ...(age ? [{ label: 'Age', value: age, sub: 'as listed in the register' }] : []),
        ...(party ? [{ label: 'Party', value: party }] : next ? [{ label: 'Next transition', value: next, sub: 'as listed' }] : []),
      ],
      visual: where ? {
        type: 'map',
        title: 'Country on the map',
        right: country,
        points: [{ ...where, label: country, tone: unverified ? 'amber' : 'blue', main: true }],
        caption: `${country} is placed at its approximate country centre; the register holds no coordinates, and the marker is the country, not the leader.`,
      } : undefined,
      callout: unverified ? { tone: 'amber', text: 'The register holds a placeholder for this office, not a verified name. Only the office and country are shown.' } : undefined,
    },
    about: {
      label: '02 · About this leader',
      rows: presentRows([['Country', country], ['Office', office], ['Party', party], ['Ideology', ideology], ['Next transition', next], ['Authority', authority]]),
      cards: latest ? [{ heading: 'Latest', body: latest }] : [],
    },
    touches: {
      label: '03 · Leader & what it touches',
      links: sameIdeology ? [{ title: `Same ideology: ${ideology}`, detail: `${sameIdeology} more on the register` }] : [],
    },
    footer: {
      ask: 'Ask AI about this leader',
      provenance: { source: 'World leaders register (stored on the platform)', asOf, flags: unverified ? ['name not verified'] : [] },
      note: `This is the platform's register of office-holders as of ${asOf}. Office-holders change, and this is a register, not a live feed.`,
    },
  };
}
