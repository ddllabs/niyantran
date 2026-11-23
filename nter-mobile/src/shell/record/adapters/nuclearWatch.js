import { othersSharing } from '../touchRules.js';
import { cap, dateLabel, presentRows, sourceLinks } from './common.js';

/**
 * Nuclear Watch (the embedded public-source facility register) → record panel (F121 batch 3).
 *
 * Rows come through flattenNuclear (src/lib/strategicAssets.js), as the feed serves them. A record
 * holds a status, a class, a country, an operator, a published capacity, safeguards text, a source
 * and the date it was checked, plus one position and a label for how precise that position is
 * ("Exact public site centroid", "Public approximate facility area", "Country centroid · not a
 * facility", ...). No record names a front, and none is guessed. The panel makes no
 * assessment of safety, weapons potential or compliance: status is the public record's own word.
 */
const NOT_ON_RECORD = 'Not on record';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * Only the register's "Exact …" labels vouch for the facility itself. Any other label (a complex,
 * campus or mine-area centroid, an approximate area, a regional or country centroid) or no label at
 * all is treated as approximate.
 */
const APPROXIMATE = { test: (precision) => !/^exact\b/i.test(String(precision || '').trim()) };
const COUNTRY_LEVEL = /country centroid/i;
const MAX_FACILITY_LINKS = 3;

const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');
const norm = (value) => text(value).toLowerCase();

/** The recorded status as a badge. Plain "Operating" is green; any qualifier on it is blue, so the qualifier is read. */
function statusOf(status) {
  const name = text(status);
  if (!name) return null;
  const s = name.toLowerCase();
  if (/suspend/.test(s)) return { text: cap(name), tone: 'red' };
  if (/disput/.test(s)) return { text: cap(name), tone: 'amber' };
  if (s === 'operating') return { text: cap(name), tone: 'green' };
  if (/^operating\b/.test(s)) return { text: cap(name), tone: 'blue' };
  if (/construction|\bcommissioning|licensing|development/.test(s)) return { text: cap(name), tone: 'amber' };
  return { text: cap(name), tone: 'grey' };
}

/** "24 Aug 2026" from the register's own "24 Aug 2026" (day padded) or from an ISO date; '' for anything else. */
function checkedLabel(value) {
  const s = text(value);
  const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(s);
  if (m) return MONTHS.includes(m[2]) && Number(m[1]) >= 1 && Number(m[1]) <= 31 ? `${m[1].padStart(2, '0')} ${m[2]} ${m[3]}` : '';
  return /^\d{4}-\d{2}(-\d{2}.*)?$/.test(s) ? dateLabel(s) : '';
}

/** A coordinate as a finite number within `limit` degrees, from a number or a plain decimal string; null otherwise (Number(null) would be 0). */
function coordinate(value, limit) {
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(value.trim())) n = Number(value.trim());
  else return null;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/** The record's position, or null. A position at exactly 0, 0 is "unknown", not a site in the Gulf of Guinea. */
function position(row) {
  const lat = coordinate(row.lat, 90);
  const lon = coordinate(row.lon, 180);
  if (lat == null || lon == null || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}

/** Approximate positions are shown to two decimals, exact ones to four (as the old site map did). */
const coordText = (where, precision) => {
  const d = APPROXIMATE.test(precision) ? 2 : 4;
  return `${where.lat.toFixed(d)}, ${where.lon.toFixed(d)}`;
};

/** The other records in this record's country, real facilities first; the selection (or a copy of it) is never among them. */
function othersInCountry(rows, row) {
  const country = norm(row.country);
  const list = Array.isArray(rows) ? rows : [];
  if (!country) return [];
  const self = list.includes(row) ? row : list.find((r) => (row.id != null && r?.id === row.id) || (row.title && r?.title === row.title));
  const others = list.filter((r) => r && r !== self && norm(r.country) === country);
  return [...others.filter((r) => !COUNTRY_LEVEL.test(r.precision)), ...others.filter((r) => COUNTRY_LEVEL.test(r.precision))];
}

function mapCaption(name, precision, countryLevel) {
  if (!precision) return `${name}: the register does not state how precise this position is, so treat it as approximate.`;
  if (countryLevel) return `${name}: ${precision}. The marker is a country centre, an approximate position.`;
  if (APPROXIMATE.test(precision)) return `${name}: the register records this position as "${precision}", so treat the marker as approximate.`;
  return `${name}: position as published in the register, "${precision}".`;
}

export default function nuclearWatch(row, ctx = {}) {
  const title = text(row.name) || text(row.title) || 'Facility';
  const kind = text(row.facility_kind) || text(row.kind);
  const country = text(row.country);
  const operator = text(row.operator) || text(row.operators);
  const capacity = text(row.capacity);
  const precision = text(row.precision);
  const sourceLabel = text(row.source_label);
  const badge = statusOf(row.status);
  const checked = checkedLabel(row.checked);
  const countryLevel = COUNTRY_LEVEL.test(precision);
  const noun = countryLevel ? 'record' : 'facility';
  const where = position(row);
  const approximate = APPROXIMATE.test(precision);
  const asOf = checked || dateLabel(ctx.feed?.meta?.asOf);

  const sameCountry = othersInCountry(ctx.rows, row);
  const sameClass = kind ? othersSharing(ctx.rows, { ...row, facility_kind: kind }, 'facility_kind') : 0;

  return {
    title,
    meta: [kind, country].filter(Boolean),
    badge: badge || undefined,
    links: sourceLinks(row, sourceLabel || 'Source record'),
    glance: {
      tiles: [
        { label: 'Status', value: badge?.text || NOT_ON_RECORD, sub: 'recorded status', tone: badge?.tone === 'grey' ? undefined : badge?.tone },
        { label: 'Class', value: kind || NOT_ON_RECORD, sub: text(row.region) || undefined },
        { label: 'Capacity', value: capacity || NOT_ON_RECORD, sub: 'as published' },
        { label: 'Checked', value: checked || NOT_ON_RECORD, sub: checked && sourceLabel ? `against ${sourceLabel}` : undefined },
      ],
      visual: where ? {
        type: 'map',
        title: 'Facility on the map',
        right: badge?.text,
        points: [{ ...where, label: title, tone: badge?.tone === 'grey' || !badge ? 'blue' : badge.tone, main: true, ...(approximate ? { approximate: true } : {}) }],
        caption: mapCaption(title, precision, countryLevel),
      } : undefined,
      callout: { tone: 'amber', text: 'Status here is what the public record says, not an assessment of safety or of weapons potential. Nothing on this desk should be read as a proliferation judgement.' },
    },
    about: {
      label: `02 · About this ${noun}`,
      rows: presentRows([
        ['Operator', operator],
        ['Facility class', kind],
        ['Scope', text(row.scope)],
        ['Capacity', capacity],
        ['Material / activity', text(row.material)],
        ['Safeguards / oversight', text(row.safeguards)],
        ['Region', text(row.region)],
        ['Position', [precision, where ? coordText(where, precision) : ''].filter(Boolean).join(' · ')],
      ]),
      cards: [
        ...(countryLevel ? [{ heading: 'Record type', body: 'This is a country-level uranium resource record, not a facility.' }] : []),
        ...(text(row.latest) ? [{ heading: checked ? `Latest public record · checked ${checked}` : 'Latest public record', body: text(row.latest) }] : []),
        ...(text(row.role) ? [{ heading: 'Role in the register', body: text(row.role) }] : []),
      ],
    },
    touches: {
      label: `03 · ${countryLevel ? 'Record' : 'Facility'} & what it touches`,
      links: [
        ...(sameCountry.length ? [{ title: `Records in ${country}`, detail: `${sameCountry.length} more on the register` }] : []),
        ...sameCountry.slice(0, MAX_FACILITY_LINKS).map((r) => ({
          title: text(r.name) || text(r.title) || 'Facility',
          detail: [text(r.facility_kind) || text(r.kind), text(r.status)].filter(Boolean).join(' · ') || country,
          row: r,
        })),
        ...(sameClass ? [{ title: `Same class: ${kind}`, detail: `${sameClass} more on the register` }] : []),
      ],
    },
    footer: {
      ask: `Ask AI about this ${noun}`,
      provenance: { source: sourceLabel || 'Nuclear Watch register (public sources)', asOf, flags: asOf ? [] : ['as-of not on record'] },
      note: 'A public-source register, not a claim to list every facility, and not a live count. Each status carries the date it was checked. Absence of a public entry is not evidence of absence or non-compliance. Positions marked approximate are generalised.',
    },
  };
}
