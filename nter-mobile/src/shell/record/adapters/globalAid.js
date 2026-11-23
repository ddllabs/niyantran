import { AID_COUNTRIES, compact, coveragePct, hydrateAppeal, money } from '../../../lib/globalAid.js';
import { countryPosition, regionPosition } from '../geoLookup.js';
import { dateLabel, presentRows } from './common.js';

/**
 * Global Aid (the humanitarian appeal register) → record panel (F121).
 *
 * Rows come through flattenAppeal (src/lib/globalAid.js), as the feed serves them. The figures reuse
 * that library, exactly as the dossier did: hydrateAppeal reads the row, money and compact format
 * it, and coveragePct is the only coverage % (null when the row has no funded figure, no
 * requirement, or marks the funded figure as not comparable, as for IDA21). Money is shown as the
 * register states it: one number per row, never converted. The register holds no coordinates, no
 * donors and no per-sector amounts, so the panel shows none. The pack carries no as-of of its own and
 * the feed sets none, so a row's `dataThrough` is its as-of date.
 */
const NOT_ON_RECORD = 'Not on record';
const NO_AS_OF = 'as-of not on record';

/** A field's text, or '' when it is empty or a placeholder dash or "not stated". */
function real(value) {
  const s = String(value ?? '').trim();
  return /^(|[—–-]|n\/a|not stated|unknown|none)$/i.test(s) ? '' : s;
}

/** A finite number, or null (hydrateAppeal turns unreadable text into NaN). */
const amount = (n) => (Number.isFinite(n) ? n : null);

function badgeOf(status) {
  const text = real(status);
  if (!text) return undefined;
  if (/^active/i.test(text)) return { text, tone: 'green' };
  if (/revised/i.test(text)) return { text, tone: 'amber' };
  return { text, tone: 'grey' };
}

/**
 * The countries the row names that a map can place: the register's own country for a country plan
 * (AID_COUNTRIES, since the geography text can be a phrase such as "Gaza Strip and West Bank"), else
 * the places in the geography text the lookup knows. A count statement such as "54 countries"
 * names none.
 */
function countriesOf(p) {
  if (Object.hasOwn(AID_COUNTRIES, p.id)) return [AID_COUNTRIES[p.id]];
  const text = real(p.geography);
  if (!text || /\d/.test(text)) return [];
  const parts = text.split(/\s*(?:[,;+]|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  return [...new Set(parts.filter((name) => countryPosition(name)))];
}

function mapOf(p, countries) {
  const shown = countries.map((name) => ({ name, where: countryPosition(name) })).filter((c) => c.where);
  if (shown.length) {
    return {
      type: 'map',
      title: 'Where the appeal lands',
      right: shown.length === 1 ? shown[0].name : `${shown.length} countries`,
      points: shown.map((c) => ({ ...c.where, label: c.name, tone: 'amber', main: true })),
      caption: `${shown.length} of ${countries.length} named countries shown, each at its approximate country centre; the register holds no coordinates. Markers show where the appeal is named, not funding or need.`,
    };
  }
  // Only when the row holds a region and no geography text at all (not a country, not "54 countries"): a known region, never a guess.
  const region = real(p.region);
  const where = !countries.length && !real(p.geography) && region ? regionPosition(region) : null;
  if (!where) return undefined;
  return {
    type: 'map',
    title: 'Where the appeal lands',
    right: region,
    points: [{ ...where, label: region, tone: 'amber', main: true }],
    caption: `No country is named; the register gives the region ${region}, shown at its approximate centre. The register holds no coordinates.`,
  };
}

const norm = (value) => String(value ?? '').trim().toLowerCase();
const sameAppeal = (a, b) => a === b || Boolean(a?.id && a.id === b?.id) || Boolean(norm(a?.name ?? a?.title) && norm(a?.name ?? a?.title) === norm(b?.name ?? b?.title));

/** Other appeals of the same agency in the feed rows, largest requirement first; never the selection or a copy of it. */
function sameAgency(rows, row, p) {
  const agency = norm(p.agency);
  if (!agency) return [];
  return (rows || [])
    .filter((r) => r && !sameAppeal(r, row) && norm(r.agency) === agency)
    .map((r) => ({ row: r, p: hydrateAppeal(r) }))
    .filter((x) => x.p?.name)
    .sort((a, b) => (amount(b.p.requirement) ?? -1) - (amount(a.p.requirement) ?? -1) || a.p.name.localeCompare(b.p.name));
}

export default function globalAid(row, ctx = {}) {
  const p = hydrateAppeal(row);
  const title = real(p.name) || 'Appeal';
  const agency = real(p.agency);
  const period = real(p.period);
  const requirement = amount(p.requirement);
  const funded = amount(p.funded);
  const target = amount(p.target);
  const need = amount(p.need);
  const coverage = coveragePct({ ...p, requirement, funded });
  const through = real(p.dataThrough);
  const asOf = through || dateLabel(ctx.feed?.meta?.asOf);
  const sectors = [...new Set((p.sectors || []).map((s) => String(s).trim()).filter(Boolean))];
  const countries = countriesOf(p);
  const geography = real(p.geography);
  const rows = ctx.rows || [];
  const peers = sameAgency(rows, row, p);
  const open = peers.slice(0, 3);
  const funding = real(p.fundingNote);
  const label = real(p.sourceLabel);
  const brief = real(p.brief);
  const latest = real(p.latest);
  const latestDate = real(p.latestDate);

  let fundedSub = 'no dated receipt on this row';
  if (funded !== null) {
    if (coverage !== null) fundedSub = `${coverage}% of the cited requirement`;
    else if (p.coverageComparable === false) fundedSub = 'not comparable with the requirement';
    else fundedSub = 'no requirement on record to compare';
  }

  const links = [
    ...(peers.length > 3 ? [{ title: `Other appeals by ${p.agency.trim()}`, detail: `${peers.length} on the register; the three largest open below` }] : []),
    ...open.map((x) => ({
      title: x.p.name,
      detail: `Same agency, ${p.agency.trim()}${amount(x.p.requirement) !== null ? `, ${money(x.p.requirement)} requirement` : ''}`,
      row: x.row,
    })),
  ];
  const seen = new Set();
  const uniqueLinks = links.filter((l) => !seen.has(l.title) && seen.add(l.title));

  return {
    title,
    meta: [agency, period].filter(Boolean),
    badge: badgeOf(p.status),
    links: /^https:\/\//i.test(String(p.source || '')) ? [{ label: label ? `Source: ${label}` : 'Source record', href: p.source }] : [],
    glance: {
      tiles: [
        { label: 'Requirement', value: requirement === null ? NOT_ON_RECORD : money(requirement), sub: requirement === null ? 'not stated in the cited summary' : 'requested financing, not cash received' },
        { label: 'Funded', value: funded === null ? NOT_ON_RECORD : money(funded), sub: fundedSub },
        { label: 'People targeted', value: target === null ? NOT_ON_RECORD : compact(target), sub: target === null ? 'not stated in the cited summary' : 'published planning target' },
        { label: 'Data through', value: through || NOT_ON_RECORD, sub: 'register entry' },
      ],
      visual: mapOf(p, countries),
      callout: funding ? { tone: 'amber', text: funding } : undefined,
    },
    about: {
      label: '02 · About this appeal',
      rows: presentRows([
        ['Agency', agency],
        ['Appeal type', real(p.type)],
        ['Plan period', period],
        ['Region', real(p.region)],
        ['Scope', geography],
        ['People in need', need === null ? '' : compact(need)],
        ['Coordinator', real(p.coordinator)],
        ['Delivery', real(p.delivery)],
      ]),
      chips: sectors,
      cards: [
        ...(latest ? [{ heading: latestDate ? `Latest on record · ${latestDate}` : 'Latest on record', body: latest }] : []),
        ...(brief ? [{ heading: 'Register brief (not a live assessment)', body: brief }] : []),
      ],
    },
    touches: {
      label: '03 · Appeal & where it lands',
      links: uniqueLinks,
    },
    footer: {
      ask: 'Ask AI about this appeal',
      provenance: {
        source: label ? `${label} (global aid appeal register)` : 'Global aid appeal register',
        asOf,
        flags: asOf ? [] : [NO_AS_OF],
      },
      note: 'Requirements are asks, contributions are commitments, and disbursements are neither. These are the register\'s own figures as of the date shown; the panel does not read the live OCHA Financial Tracking Service.',
    },
  };
}
