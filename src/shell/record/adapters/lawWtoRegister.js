import { countryPosition } from '../geoLookup.js';
import { dateLabel, presentRows, sourceLinks } from './common.js';

/**
 * WTO Dispute Settlement register → record panel (F129; docs/specs/2026-10-13-wto-register.md).
 * Rows are the WTO's own register as collected by scripts/collect-wto-disputes.mjs: DS number,
 * title, short title, complainants, respondent, third parties, the date consultations were
 * requested, the stage the WTO last recorded and its date, whether reports were adopted, the
 * agreements cited and the official case page.
 *
 * The four tiles answer the Law reference's questions: the stage, the parties, the agreements, and
 * the clock. The register states no compliance date, so the clock reads "Not on the row"; none is
 * computed from the reasonable-period rules. Members are printed as the WTO names them; the European
 * Union is not a place and is left off the map.
 */
const NOT_ON_ROW = 'Not on the row';
const ON_ROW = 'On the row';
const MAX_RELATED = 3;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const list = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : clean(v) ? clean(v).split(/;\s*/) : []);
const isRegisterRow = (r) => Boolean(r && typeof r === 'object' && clean(r.ds_number));

/** A member name as the map knows it; '' for a member that is not one place (the EU). */
const MAP_NAME = { 'Chinese Taipei': 'Taiwan', 'Hong Kong, China': 'Hong Kong', 'Türkiye': 'Turkey' };
const NOT_A_PLACE = /^european (union|communities)$/i;
const positionOf = (name) => (NOT_A_PLACE.test(name) ? null : countryPosition(MAP_NAME[name] || name));

function needsBoard(row, complainants, respondents) {
  const status = clean(row.status);
  const compliance = /complian|retaliat|implementation|reasonable period|21\.5|22\.6/i.test(status);
  const needs = [
    { label: 'DS number', value: ON_ROW },
    { label: 'Complainant and respondent', value: complainants.length && respondents.length ? ON_ROW : NOT_ON_ROW },
    { label: 'Measure at issue', value: clean(row.title) ? ON_ROW : NOT_ON_ROW, note: 'the dispute title' },
    { label: 'Agreements cited', value: list(row.agreements).length ? ON_ROW : NOT_ON_ROW },
    { label: 'Current stage with its date', value: status && clean(row.status_date) ? ON_ROW : status ? 'Partial' : NOT_ON_ROW },
    { label: 'Third parties', value: list(row.third_parties).length ? ON_ROW : NOT_ON_ROW },
    { label: 'Panel composition', value: NOT_ON_ROW },
    { label: 'Compliance and retaliation status', value: compliance ? 'Partial' : NOT_ON_ROW, ...(compliance ? { note: 'only as the stage names it' } : {}) },
  ];
  const held = needs.filter((n) => n.value === ON_ROW).length;
  return {
    type: 'board',
    title: 'What a lawyer needs · what this row has',
    right: `${held} of ${needs.length} on the row`,
    rows: needs.map((n) => ({ ...n, tone: n.value === ON_ROW ? 'green' : n.value === NOT_ON_ROW ? 'red' : 'amber' })),
    caption: 'Marked from this row. Panel reports, compliance deadlines and arbitration awards are on the official case page; they have not been read here.',
  };
}

function partiesMap(complainants, respondents) {
  const points = [];
  const unplaced = [];
  for (const [names, tone, main] of [[complainants, 'blue', false], [respondents, 'red', true]]) {
    for (const name of names) {
      const at = positionOf(name);
      if (at) points.push({ ...at, label: name, tone, ...(main ? { main: true } : {}) });
      else unplaced.push(name);
    }
  }
  if (!points.length) return undefined;
  const missing = [...new Set(unplaced)];
  return {
    type: 'map',
    title: 'Complainant → respondent',
    right: 'DS register',
    points,
    caption: `Complainants in blue, the respondent in red, at approximate country centres.${missing.length ? ` Not drawn: ${missing.join(', ')} (not a single place, or no position on record).` : ''}`,
  };
}

function relatedLinks(row, rows) {
  const others = rows.filter((r) => isRegisterRow(r) && r !== row && r.ds_number !== row.ds_number);
  const short = clean(row.short_title);
  const respondent = clean(row.respondent);
  const sameMatter = short ? others.filter((r) => clean(r.short_title) === short) : [];
  const sameRespondent = respondent ? others.filter((r) => clean(r.respondent) === respondent && !sameMatter.includes(r)).sort((a, b) => (b.ds || 0) - (a.ds || 0)) : [];
  const detail = (r, lead) => [lead, list(r.complainants).join(', '), clean(r.status)].filter(Boolean).join(' · ');
  return [
    ...sameMatter.slice(0, MAX_RELATED).map((r) => ({ title: `${r.ds_number}: ${clean(r.short_title) || clean(r.title)}`, detail: detail(r, 'Same matter'), row: r })),
    ...sameRespondent.slice(0, 2).map((r) => ({ title: `${r.ds_number}: ${clean(r.short_title) || clean(r.title)}`, detail: detail(r, 'Same respondent'), row: r })),
  ];
}

function health(rows) {
  const register = rows.filter(isRegisterRow);
  if (!register.length) return [];
  return [
    ['Disputes', String(register.length)],
    ['In consultations', String(register.filter((r) => /^in consultations$/i.test(clean(r.status))).length)],
    ['Reports adopted', String(register.filter((r) => r.reports_adopted === true).length)],
  ];
}

export default function lawWtoRegister(row, ctx = {}) {
  const rows = Array.isArray(ctx.rows) ? ctx.rows : [];
  const ds = clean(row.ds_number);
  const short = clean(row.short_title);
  const title = clean(row.title);
  const complainants = list(row.complainants);
  const respondents = list(row.respondent);
  const thirdParties = list(row.third_parties);
  const agreements = list(row.agreements);
  const status = clean(row.status);
  const statusDate = dateLabel(row.status_date);
  const requested = dateLabel(row.consultations_requested);
  const asOf = dateLabel(row.as_of);
  const parties = complainants.length && respondents.length ? `${complainants.join(', ')} v. ${respondents.join(', ')}` : '';
  const brief = short || title || ds;

  return {
    title: short ? `${ds}: ${short}` : `${ds}: ${title || 'Dispute'}`,
    meta: ['WTO dispute settlement', requested ? `Consultations requested ${requested}` : ''].filter(Boolean),
    badge: { text: 'WTO register', tone: 'green' },
    links: sourceLinks(row, 'Official case page (wto.org)'),
    glance: {
      tiles: [
        { label: 'Stage', value: status || NOT_ON_ROW, sub: statusDate ? `as recorded ${statusDate}` : 'as the WTO records it' },
        { label: 'Parties', value: parties || NOT_ON_ROW, sub: 'complainant v. respondent' },
        { label: 'Agreements cited', value: agreements.length ? agreements.slice(0, 2).join(', ') + (agreements.length > 2 ? ` +${agreements.length - 2}` : '') : NOT_ON_ROW, sub: agreements.length ? `${agreements.length} cited in the request` : 'none on the row' },
        { label: 'Compliance period ends', value: NOT_ON_ROW, sub: 'the register states no compliance date', clock: true },
      ],
      visual: partiesMap(complainants, respondents),
      visual2: needsBoard(row, complainants, respondents),
      callout: { tone: 'amber', text: 'The register gives the stage the WTO last recorded, with its date. The reports, the measure\'s details and any compliance deadline are on the official case page.' },
    },
    about: {
      label: '02 · The pointers',
      rows: presentRows([
        ['DS number', ds],
        ['Short title', short],
        ['Measure', title],
        ['Complainant', complainants.join('; ')],
        ['Respondent', respondents.join('; ')],
        ['Third parties', thirdParties.length ? `${thirdParties.length}: ${thirdParties.join(', ')}` : ''],
        ['Consultations requested', requested],
        ['Stage', status],
        ['Stage recorded', statusDate],
        ['Reports adopted', row.reports_adopted === true ? 'Yes' : row.reports_adopted === false ? 'No' : ''],
        ['Agreements cited', agreements.join('; ')],
        ['Last updated by the WTO', dateLabel(row.last_updated)],
      ]),
      cards: [{ heading: 'What this record does not settle', body: 'What the panel or Appellate Body found, whether the respondent has complied, and any compliance deadline. Those are in the reports and decisions on the official case page.' }],
    },
    quick: [
      { label: 'Dispute brief', prompt: `Draft a dispute brief on WTO ${ds} (${brief}). Use only the attached register row and the official case page it links, and flag anything they do not state.` },
      { label: 'Chronology', prompt: `Draft a chronology of WTO ${ds} (${brief}) from the attached register row and the official case page it links. Do not state a date the sources do not give.` },
    ],
    touches: {
      label: '03 · Dispute & what it touches',
      lanes: ['COMPLAINANT', 'DISPUTE', 'RESPONDENT', 'THIRD PARTIES'],
      nodes: {
        left: complainants.length ? { l1: complainants[0], l2: complainants.length > 1 ? `+${complainants.length - 1} more` : 'complainant' } : undefined,
        center: { code: 'DS', l1: ds, l2: statusDate || undefined },
        right: respondents.length ? { l1: respondents[0], l2: respondents.length > 1 ? `+${respondents.length - 1} more` : 'respondent' } : undefined,
        far: thirdParties.length ? { l1: `${thirdParties.length} third ${thirdParties.length === 1 ? 'party' : 'parties'}`, l2: 'reserved rights' } : undefined,
      },
      links: relatedLinks(row, rows),
    },
    footer: {
      ask: 'Ask AI about this dispute',
      provenance: { source: 'WTO dispute settlement register (wto.org)', asOf: asOf || undefined, flags: asOf ? [] : ['as-of not on record'] },
      health: health(rows),
      note: 'Parties, stages and dates as the WTO records them; members are named as the WTO names them. The official case page is the authority; this row is an index to it.',
    },
  };
}

export { isRegisterRow };
