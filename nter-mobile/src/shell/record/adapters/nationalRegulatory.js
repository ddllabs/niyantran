import { analysisFor, buildRecordModel, DESKS } from '../../../lib/impactRecord.js';
import { cap, dateLabel, plural, presentRows } from './common.js';
import { parseFeedDate } from './feedDate.js';
import { plainText as feedPlainText, text } from './feedText.js';

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

/** Feed text with markup, written out or escaped, removed (feedText.js, F127). */
const plainText = (value) => feedPlainText(value, { stripMarkup: true });

/**
 * The instant a row's date names, or null (feedDate.js, F127). IST is India time (both feeds are Indian
 * regulators'), and an RFC 822 time with no zone (the live RBI feed's form) gives the day as written.
 */
const parseIssued = (value) => parseFeedDate(value, { ist: true, zonelessDay: true });

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
    caption: `A rolling window of ${plural(all.length, 'notice')} on hand, not a full history: notices outside it are not held, so this notice's place says nothing about what came before or after.${undated ? ` ${undated === 1 ? '1 has no readable date and is not placed' : `${undated} have no readable date and are not placed`}.` : ''}`,
  };
}

/** The sector and class names the panel can draw, from the impact model and the ontology. */
function impactNames(impact, ontology, routine, title) {
  if (!impact) return { classes: [], sectors: [], companies: [] };
  const seg = (impact.segments || []).find((s) => s.kind === 'institution' && String(s.id).startsWith('inst:'));
  const inst = seg ? (ontology?.institutions || []).find((i) => `inst:${i.id}` === seg.id) : null;
  const sectorNames = new Map((ontology?.sectors || []).map((s) => [s.id, s.name]));
  const classes = (inst?.governs || []).map((id) => sectorNames.get(id)).filter(Boolean);
  const sectors = (impact.sectors || []).filter((s) => s.band === 'Strong').map((s) => s.name).filter(Boolean);
  const hay = norm(title);
  const companies = routine ? [] : (impact.companies || []).filter((c) => c.path === 'P1' && c.name && hay.includes(norm(c.name))).map((c) => c.name);
  return { classes, sectors, companies };
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

  const { classes, sectors, companies } = impactNames(impact, packs?.ontology, routine, row.title);

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
          ? `${regulator || 'RBI and SEBI'} notice register (latest stored copy)`
          : `Regulator news feed${feedHost ? ` (${feedHost})` : ''}`,
        asOf,
        flags: asOf ? [] : ['as-of not on record'],
      },
      note: `A rolling window, not a full history: it holds only the ${plural(onHand.length, 'notice')} on hand (RBI and SEBI; TRAI and CCI are not held), so it cannot answer what applies to a given firm or whether an earlier rule still stands. Entity classes come from the regulator's entry in the platform's reference list, and sector tags from keyword matches on the title and register summary; neither is an assessed impact. A company appears only when its full name is in the title.`,
    },
  };
}
