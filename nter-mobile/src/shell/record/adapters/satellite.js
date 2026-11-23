import { othersSharing } from '../touchRules.js';
import { cap, presentRows, sourceLinks } from './common.js';

/**
 * Satellite Infrastructure (upcoming launches from The Space Devs) → record panel (F121). Rows come
 * from `flattenLaunch` in server/assetsApi.mjs: a launch, its provider, its pad and a NET time. They
 * hold nothing about the spacecraft, so the panel states no orbit, satellite count or constellation.
 * The pad position is the one exact position in the Global panels: the library publishes it.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NOT_ON_RECORD = 'Not on record';

const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

/** The Space Devs status name → badge. A partial failure is amber: the launch flew but fell short. */
function statusOf(status) {
  const name = text(status);
  if (!name) return null;
  const s = name.toLowerCase();
  if (/partial/.test(s)) return { text: cap(name), tone: 'amber' };
  if (/fail/.test(s)) return { text: cap(name), tone: 'red' };
  if (/success|payload deployed|^go(\s|$)/.test(s)) return { text: cap(name), tone: 'green' };
  if (/to be confirmed|to be determined|\btbc\b|\btbd\b|hold/.test(s)) return { text: cap(name), tone: 'amber' };
  return { text: cap(name), tone: 'grey' };
}

/**
 * "20 Oct 2026, 14:30 UTC" from the row's "YYYY-MM-DD HH:MM" NET, which is UTC. The time is not
 * converted to any local zone. A date with no time stays a date; anything else is not a date.
 */
function netLabel(net) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(text(net));
  if (!m) return '';
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map((v) => (v == null ? null : Number(v)));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return '';
  if (hour != null && (hour > 23 || minute > 59)) return '';
  const date = `${m[3]} ${MONTHS[month - 1]} ${year}`;
  return hour == null ? date : `${date}, ${m[4]}:${m[5]} UTC`;
}

/**
 * A coordinate as a finite number within `limit` degrees, from a number or a plain decimal string
 * (the library sends strings). Null, blank, partial and non-numeric input is not a coordinate;
 * Number(null) and Number('') are 0, which would put a pad on the equator.
 */
function coordinate(value, limit) {
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(value.trim())) n = Number(value.trim());
  else return null;
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/** The pad's exact position, or null. A pad at exactly 0, 0 is the library's "unknown", not a site. */
function padPosition(row) {
  const lat = coordinate(row.lat, 90);
  const lon = coordinate(row.lon, 180);
  if (lat == null || lon == null || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}

export default function satellite(row, ctx = {}) {
  const title = text(row.title) || text(row.name) || 'Launch';
  const provider = text(row.provider);
  const site = text(row.pad) || text(row.region);
  const country = text(row.country);
  const badge = statusOf(row.status);
  const scheduled = netLabel(row.net);
  const where = padPosition(row);
  const sameProvider = othersSharing(ctx.rows, row, 'provider');

  return {
    title,
    meta: ['Launch', provider].filter(Boolean),
    badge: badge || undefined,
    links: sourceLinks(row, text(row.source_label) || 'The Space Devs'),
    glance: {
      tiles: [
        { label: 'Status', value: badge?.text || NOT_ON_RECORD, sub: 'launch status', tone: badge?.tone === 'grey' ? undefined : badge?.tone },
        { label: 'Scheduled', value: scheduled || NOT_ON_RECORD, sub: scheduled ? 'NET: no earlier than (UTC)' : 'NET: no earlier than' },
        { label: 'Provider', value: provider || NOT_ON_RECORD, sub: 'launch provider' },
        { label: 'Country', value: country || NOT_ON_RECORD, sub: 'launch site country' },
      ],
      visual: where ? {
        type: 'map',
        title: 'Launch site on the map',
        right: badge?.text,
        points: [{ ...where, label: site || 'Launch pad', tone: 'blue', main: true }],
        caption: `${site ? `${site}: pad` : 'Launch pad'} position as published by The Space Devs.`,
      } : undefined,
    },
    about: {
      label: '02 · About this launch',
      rows: presentRows([
        ['Launch site', site],
        ['Provider', provider],
        ['Country', country],
        ['Status', badge?.text],
      ]),
    },
    touches: {
      label: '03 · Launch & what it touches',
      links: sameProvider ? [{ title: `Other ${provider} launches`, detail: `${sameProvider} more in this list` }] : [],
    },
    footer: {
      ask: 'Ask AI about this launch',
      // The feed envelope (server/featureFeed.mjs) carries no fetch time, so there is no as-of date.
      provenance: { source: 'The Space Devs Launch Library', flags: ['as-of not on record'] },
      note: 'The list is fetched live from The Space Devs Launch Library and cached for 30 minutes, so it carries no as-of time. Launch times move: NET means no earlier than, and is shown in UTC. Each row describes a launch, not the spacecraft it carries.',
    },
  };
}
