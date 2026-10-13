import { analysisFor, buildRecordModel, DESKS } from '../../../lib/impactRecord.js';
import { cap, dateLabel, plural, presentRows } from './common.js';

/**
 * Regulatory Body Watch → record panel (F124 N4). A row has one of two shapes:
 *  - a live feed row: only { date (RFC 822), title, source_url, summary (at most 400 characters) },
 *    with no regulator, action type, PDF or id (server/featureFeed.mjs parseRssOrXml and flattenRow);
 *  - an embedded register row: { id, regulator, title, date (ISO), detail_url, pdf_url, action_type,
 *    source_url } for RBI and SEBI. No TRAI or CCI notice is held.
 * The analysis pack (ctx.packs, loaded by the panel host) adds a category, a brief and possible
 * effects for the embedded rows it covers. The panel shows a field only when the row or the pack
 * holds it. It builds from what it is handed and makes no network call.
 *
 * Two choices differ from a plain read of the impact model, and each rests on the data:
 *  - "Entity classes" are the classes the ontology says the regulator governs (banks, NBFCs for
 *    RBI), not the model's theme segments. A theme is a keyword match, and the word "auction"
 *    attaches "Spectrum & telecom policy" to every government-securities auction.
 *  - A company is drawn only when its full name is in the notice title. The impact model also
 *    matches "Central Bank" inside "Co-operative Central Bank" and a rate quoted from the State Bank
 *    of India. A routine notice draws no company, as the current view withholds them.
 */
const NOT_ON_RECORD = 'Not on record';
const MAX_RELATED = 3;
const IST_MINUTES = 330;

const ACTIONS = {
  routine: { label: 'Routine', badge: { text: 'Routine', tone: 'grey' } },
  other: { label: 'Other' },
  master_direction: { label: 'Master direction', badge: { text: 'Master direction', tone: 'amber' } },
  penalty: { label: 'Penalty', badge: { text: 'Penalty', tone: 'red' } },
  direction: { label: 'Direction', badge: { text: 'Direction', tone: 'amber' } },
};

const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '');

/** Control characters (whitespace aside) and the bidirectional marks, which can hide or reorder what a reader sees. */
const isInvisible = (code) => code <= 8 || (code >= 14 && code <= 31) || (code >= 127 && code <= 159)
  || code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
const withoutInvisible = (s) => Array.from(s).filter((ch) => !isInvisible(ch.codePointAt(0))).join('');
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };

/**
 * Feed text as one line of plain text: markup, written out or escaped, removed; the few entities
 * RSS leaves behind decoded once (never `&lt;` or `&gt;`, so nothing can turn back into markup);
 * invisible controls removed; whitespace collapsed. It stays a string; nothing here builds HTML.
 */
const plainText = (value) => withoutInvisible(text(value))
  .replace(/&lt;[^&]{0,200}?&gt;/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&(?:amp|quot|apos|#39|#x27|nbsp);/gi, (m) => ENTITIES[m.toLowerCase()])
  .replace(/\s+/g, ' ')
  .trim();

// A date. Read strictly, as newsWire does: new Date(text) would guess and would read the machine's zone.
/** RFC 822 zone names, in minutes east of UTC. IST is read as India time because both feeds are Indian regulators'. */
const ZONES = { GMT: 0, UT: 0, UTC: 0, Z: 0, IST: IST_MINUTES, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/i;
const RFC_DATE = /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+([A-Za-z]{1,3}|[+-]\d{4}))?)?$/;

/** A real instant from calendar parts and a UTC offset in minutes, or null. Reads no local zone. */
function instant(year, month, day, hour, minute, second, offset) {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(ms);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return new Date(ms - offset * 60000);
}

const offsetOf = (zone) => {
  if (/^[+-]\d{4}$/.test(zone)) {
    const minutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5));
    return Number(zone.slice(3, 5)) > 59 ? null : (zone[0] === '-' ? -minutes : minutes);
  }
  const key = zone.toUpperCase();
  return Object.hasOwn(ZONES, key) ? ZONES[key] : null;
};

/**
 * The instant a row's date names, or null. Two shapes are read:
 *  - RFC 822 pubDate "Tue, 13 Oct 2026 10:16:00 +0530" (a listed zone name or a ±hhmm offset);
 *  - ISO 8601 "2026-07-03" or "2026-10-12T14:30:00+01:00" (a zone is required with a time).
 * A bare calendar date is that day, and so is an RFC 822 date whose time carries no zone (the RBI
 * feed's form): the day is read as written and the time is not converted. Anything else, an
 * impossible date, or an ISO time with no zone is not a date.
 */
function parseIssued(value) {
  const t = text(value);
  if (!t) return null;
  let m = ISO_DATE.exec(t);
  if (m) {
    const [year, month, day] = m.slice(1, 4).map(Number);
    if (m[4] == null) return instant(year, month, day, 0, 0, 0, 0);
    const zone = m[7].toUpperCase();
    const offset = zone === 'Z' ? 0 : (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2))) * (zone[0] === '-' ? -1 : 1);
    if (zone !== 'Z' && Number(zone.slice(-2)) > 59) return null;
    return instant(year, month, day, Number(m[4]), Number(m[5]), Number(m[6] || 0), offset);
  }
  m = RFC_DATE.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    if (!month) return null;
    if (m[4] == null) return instant(Number(m[3]), month, Number(m[1]), 0, 0, 0, 0);
    // The live RBI feed writes its time with no zone ("Mon, 12 Oct 2026 23:55:00"). The time is not
    // converted; the calendar day it names is read as written, the time checked only for validity.
    if (m[7] == null) {
      return Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] || 0) > 59 ? null : instant(Number(m[3]), month, Number(m[1]), 0, 0, 0, 0);
    }
    const offset = offsetOf(m[7]);
    return offset == null ? null : instant(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0), offset);
  }
  return null;
}

/** { at, key: 'YYYY-MM-DD' (India date), label: '03 Jul 2026' } for a row's date, or null. */
function issuedOf(row) {
  const at = parseIssued(row?.date);
  if (!at) return null;
  return { at, key: new Date(at.getTime() + IST_MINUTES * 60000).toISOString().slice(0, 10), label: dateLabel(at.toISOString()) };
}

const httpsOnly = (u) => (/^https:\/\//i.test(text(u)) ? text(u) : '');
const isGoogleNews = (u) => /news\.google\.com/i.test(u);
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
const isPdf = (u) => /\.pdf(\?|$)/i.test(u);
const norm = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

const isNotice = (r) => Boolean(r) && typeof r === 'object' && !Array.isArray(r) && r.status !== 'source_status';

/** The same notice: the same object, the same id, or (when ids are absent) the same link, or the same headline and date. */
function sameNotice(a, b) {
  if (a === b) return true;
  const ia = text(a?.id);
  const ib = text(b?.id);
  if (ia && ib) return ia === ib;
  const ua = text(a?.source_url);
  const ub = text(b?.source_url);
  if (ua || ub) return ua === ub;
  return Boolean(text(a?.title)) && text(a?.title) === text(b?.title) && text(a?.date) === text(b?.date);
}
/** A copy of the selection: the same notice, or another row with its headline and date. */
const isCopy = (a, b) => sameNotice(a, b) || (Boolean(text(a?.title)) && text(a?.title) === text(b?.title) && text(a?.date) === text(b?.date));

function actionOf(row) {
  const key = text(row?.action_type).toLowerCase();
  if (!key) return null;
  return Object.hasOwn(ACTIONS, key) ? ACTIONS[key] : { label: cap(key.replace(/_/g, ' ')) };
}

/** Where this notice sits among the notices on hand: earliest, this notice, latest. Dated rows only. */
function windowVisual(here, all) {
  if (!here) return undefined;
  const dated = all.map(issuedOf).filter(Boolean);
  const undated = all.length - dated.length;
  const first = dated.reduce((a, b) => (b.key < a.key ? b : a), here);
  const last = dated.reduce((a, b) => (b.key > a.key ? b : a), here);
  const only = first.key === here.key && last.key === here.key;
  const placed = [here.label, first.key === here.key && !only ? 'earliest on hand' : '', last.key === here.key && !only ? 'latest on hand' : '', only && dated.length > 1 ? 'every dated notice on hand shares this date' : ''].filter(Boolean);
  const steps = [
    ...(first.key < here.key ? [{ label: 'Earliest on hand', detail: first.label, done: true }] : []),
    { label: 'This notice', detail: placed.join(' · '), now: true },
    ...(last.key > here.key ? [{ label: 'Latest on hand', detail: last.label }] : []),
  ];
  return {
    type: 'timeline',
    title: 'The rolling window',
    right: plural(all.length, 'notice'),
    steps,
    caption: `A rolling window of ${plural(all.length, 'notice')} on hand, not an archive: notices outside it are not held, so this notice's place says nothing about what came before or after.${undated ? ` ${undated === 1 ? '1 has no readable date and is not placed' : `${undated} have no readable date and are not placed`}.` : ''}`,
  };
}

/** The sector and class names the panel can draw, from the impact model and the ontology. */
function impactNodes(impact, ontology, routine, title) {
  if (!impact) return { classes: [], sectors: [], companies: [] };
  const seg = (impact.segments || []).find((s) => s.kind === 'institution' && String(s.id).startsWith('inst:'));
  const inst = seg ? (ontology?.institutions || []).find((i) => `inst:${i.id}` === seg.id) : null;
  const sectorNames = new Map((ontology?.sectors || []).map((s) => [s.id, s.name]));
  const classes = (inst?.governs || []).map((id) => sectorNames.get(id)).filter(Boolean);
  const sectors = (impact.sectors || []).filter((s) => s.band === 'Strong').map((s) => s.name).filter(Boolean);
  const hay = norm(title);
  const companies = routine ? [] : (impact.companies || []).filter((c) => c.path === 'P1' && c.name && hay.includes(norm(c.name))).map((c) => c.name);
  return { institution: inst?.name || '', classes, sectors, companies };
}

export default function nationalRegulatory(row, ctx = {}) {
  const packs = ctx.packs?.ready ? ctx.packs : null;
  const a = packs ? analysisFor(row, packs.analysis) : null;
  const impact = packs ? buildRecordModel(row, a, packs.ontology, DESKS.regulatory) : null;
  const title = plainText(row.title) || 'Regulatory notice';
  const regulator = plainText(row.regulator);
  const action = actionOf(row);
  const issued = issuedOf(row);
  const summary = plainText(row.summary);
  const category = plainText(a?.category);
  const routine = impact ? impact.routine : text(row.action_type).toLowerCase() === 'routine';
  const embedded = Boolean(regulator || action);
  const kinds = [regulator, action?.label].filter(Boolean);

  const source = httpsOnly(row.detail_url) || httpsOnly(row.source_url);
  const page = source && !isGoogleNews(source) ? source : '';
  const pdf = [httpsOnly(row.pdf_url), httpsOnly(a?.pdf_url), isPdf(page) ? page : ''].find((u) => u && !isGoogleNews(u)) || '';
  const links = [
    ...(pdf ? [{ label: 'Instrument (PDF)', href: pdf }] : []),
    ...(page && page !== pdf ? [{ label: regulator ? `Notice on ${regulator}` : 'Source notice', href: page }] : []),
  ];

  const { institution, classes, sectors, companies } = impactNodes(impact, packs?.ontology, routine, row.title);

  const notices = (Array.isArray(ctx.rows) ? ctx.rows : []).filter(isNotice);
  // The notices on hand, counting the selection once even when the list holds a copy of it.
  const onHand = notices.some((r) => sameNotice(r, row)) ? notices : [row, ...notices];
  const others = regulator
    ? notices.filter((r) => !isCopy(r, row) && plainText(r.regulator).toLowerCase() === regulator.toLowerCase())
      .sort((x, y) => (issuedOf(y)?.at.getTime() ?? -Infinity) - (issuedOf(x)?.at.getTime() ?? -Infinity))
    : [];
  const seen = new Set();
  const related = others.filter((r) => {
    const t = plainText(r.title);
    if (!t || seen.has(t)) return false;
    seen.add(t);
    return true;
  }).slice(0, MAX_RELATED);

  const feedHost = embedded ? '' : hostOf(page);
  const asOf = issued?.label;

  return {
    title,
    meta: kinds.length ? kinds : ['Regulatory notice'],
    badge: action?.badge,
    links,
    glance: {
      tiles: [
        { label: 'Issued', value: asOf || NOT_ON_RECORD, sub: asOf ? (embedded ? 'date on the register' : 'publication date in the feed') : undefined },
        { label: 'Regulator', value: regulator || NOT_ON_RECORD, sub: regulator ? 'issuing regulator' : 'this row names none' },
        ...(action ? [{ label: 'Action type', value: action.label, sub: 'as classified in the register', tone: action.badge && action.badge.tone !== 'grey' ? action.badge.tone : undefined }] : []),
        ...(category ? [{ label: 'Category', value: category, sub: 'register analysis' }] : []),
      ].slice(0, 4),
      visual: windowVisual(issued, onHand),
    },
    about: {
      label: '02 · About this notice',
      rows: presentRows([
        ['Regulator', regulator],
        ['Action type', action?.label],
        ['Issued', asOf],
        ['Category (register analysis)', category],
        ['Detail page', hostOf(page)],
        ['Instrument PDF', pdf ? 'On record' : ''],
        ['Entity classes the regulator governs', classes.join(' · ')],
        ['Sectors named in the text', sectors.join(' · ')],
      ]),
      cards: [
        ...(summary ? [{ heading: 'Summary as published by the feed', body: summary }] : []),
        ...(a?.brief ? [{ heading: 'Summary (register analysis)', body: plainText(a.brief) }] : []),
        ...(Array.isArray(a?.possible_effects) && a.possible_effects.length ? [{ heading: 'Possible effects (register analysis)', body: a.possible_effects.map(plainText).filter(Boolean).join(' · ') }] : []),
      ].filter((c) => c.body),
    },
    touches: {
      label: '03 · Notice & what it touches',
      lanes: ['REGULATOR', 'INSTRUMENT', 'ENTITY CLASSES', 'SECTORS'],
      nodes: {
        left: regulator ? { l1: regulator, l2: institution && institution.toLowerCase() !== regulator.toLowerCase() ? institution : 'issuing regulator' } : undefined,
        center: { code: 'N', l1: 'This notice', l2: action?.label || 'type not on record' },
        right: classes.length ? { l1: classes[0], l2: classes.length > 1 ? `+${classes.length - 1} more` : 'regulated class' } : undefined,
        far: sectors.length ? { l1: sectors[0], l2: sectors.length > 1 ? `+${sectors.length - 1} more` : 'named in the text' } : undefined,
      },
      links: [
        ...related.map((r) => ({ title: plainText(r.title), detail: [actionOf(r)?.label, issuedOf(r)?.label].filter(Boolean).join(' · '), row: r })),
        ...(others.length > related.length ? [{ title: `Other ${regulator} notices`, detail: `${others.length} in this window` }] : []),
        ...(companies.length ? [{ title: 'Companies named in the title', detail: `${companies.slice(0, 3).join(' · ')}${companies.length > 3 ? ` +${companies.length - 3} more` : ''}` }] : []),
        ...(routine ? [{ title: 'Company links withheld', detail: 'Routine notice: it does not fan out to companies.' }] : []),
      ],
    },
    footer: {
      ask: 'Ask AI about this instrument',
      provenance: {
        source: embedded
          ? `${regulator || 'RBI and SEBI'} notice register (last-known-good archive)`
          : `Regulator RSS feed${feedHost ? ` (${feedHost})` : ''}`,
        asOf,
        flags: asOf ? [] : ['as-of not on record'],
      },
      note: `A rolling window, not an archive: it holds only the ${plural(onHand.length, 'notice')} on hand (RBI and SEBI; TRAI and CCI are not held), so it cannot answer what applies to a given firm or whether an earlier rule still stands. Entity classes come from the regulator's entry in the ontology and sector tags from keyword matches on the title and register summary; neither is an assessed impact. A company appears only when its full name is in the title.`,
    },
  };
}
